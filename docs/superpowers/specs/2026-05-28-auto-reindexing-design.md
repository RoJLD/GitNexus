# Auto-Reindexing the Code Graph — Design

**Date** : 2026-05-28
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Origine** : Item "Auto-reindexing" de l'évaluation de l'offre enterprise upstream (ROADMAP § "Enterprise / commercial offering", verdict 🟡 partiel — analytics/snapshots auto-refresh mais le graphe de code se ré-indexe à la main).
**Depends on** : le serveur API gitnexus (`POST /api/analyze`, incrémental quand `force` absent), le moteur watches/cron (Tier 2bis.3), le parser `.gitnexus.json` (Tier 2bis.4), `git` présent dans le conteneur web (`Dockerfile.web` : `apt-get install git` + `git config --system --add safe.directory '*'`).

---

## 1. Context / problem

Le graphe de connaissances gitnexus se construit via `gitnexus analyze`. La ré-analyse incrémentale **existe** (hash des fichiers, détection des dirty, re-parse des seuls fichiers changés — `upstream/gitnexus/src/core/run-analyze.ts`), mais elle est **manuelle** : déclenchée par `reindex.ps1` (qui POST `/api/analyze` avec `force:true`) ou le bouton re-analyze de l'UI. Aucun watcher / daemon / git-hook.

Conséquence : après de nouveaux commits sur un repo indexé, le graphe live reste périmé jusqu'à une ré-analyse manuelle. Nos automatismes existants (auto-snapshot Tier 35, watches cron Tier 2bis.3) rafraîchissent les *snapshots* et les *analytics*, **pas** le graphe de code lui-même. L'offre enterprise upstream vend un "auto-reindexing" — c'est le gap qu'on ferme.

## 2. Goal

Détecter automatiquement les nouveaux commits sur chaque repo indexé et déclencher une ré-analyse **incrémentale**, piloté par **notre cron watches existant**. Opt-in par repo, observable via un endpoint read-only. Zéro nouveau process, zéro changement Dockerfile (tout vit dans le conteneur web qui a déjà `git` + accès `/api/analyze`).

Succès = je commite sur un repo indexé avec `auto_reindex.onCommit: true` ; dans la minute du prochain tick cron (≤ 5 min), le graphe se ré-analyse incrémentalement sans action manuelle ; `GET /auto-reindex` montre l'état.

## 3. Décisions cadres (validées en brainstorm 2026-05-28)

| Décision | Choix retenu | Raison |
|---|---|---|
| Signal de déclenchement | **Changement de HEAD SHA** (nouveaux commits) | Propre, cheap, prévisible (1 reindex par batch de commits par tick). Les éditions non-committées (working-tree) sont ignorées. |
| Surface | **Backend + endpoint read-only `GET /auto-reindex`** (config-driven, défaut off) | Comportement de fond ; observabilité comme `GET /watches`, sans churn React. |
| Architecture | **Tout dans le cron du conteneur web + module dédié** | `git` est dans le conteneur web ; `/api/analyze` existe déjà sur le serveur API. Pas de worker ni de patch Dockerfile.cli (contrairement au Code Wiki). |
| Type de ré-analyse | **Incrémentale** (`POST /api/analyze { path }` sans `force`) | Cheap — ne re-parse que les fichiers dirty. `force:true` = full, réservé à `reindex.ps1`. |
| Cadence | **Réutilise le cron watches** (`WATCH_INTERVAL_MS`, défaut 5 min) | Pas de nouveau timer ; latence de détection ≤ 1 tick. |
| Persistance de l'état | **Sidecar `<repo>/.gitnexus/_auto-reindex.json`** | Conforme à la convention sidecar du projet (ghosts.json, clusters.json, repo-id.json) ; survit aux redémarrages → détecte un commit arrivé pendant un downtime. |
| Écriture du sidecar | **Optimiste au déclenchement** (lastIndexedSha = HEAD courant) | Déduplique naturellement (tick suivant : HEAD == lastIndexedSha → pas de re-trigger). Limite documentée : un job échoué n'est pas re-tenté avant le prochain commit. |

### Alternatives écartées

| Alternative | Pourquoi écartée |
|---|---|
| Worker dans le conteneur `gitnexus` (façon `wiki-worker.mjs`) | Inutile : `/api/analyze` existe déjà sur le serveur API ; le cron web peut l'appeler directement. |
| Git hooks (post-commit) dans chaque repo | Intrusif (installe des hooks dans les repos users), ne marche pas pour les repos indexés depuis le registry sans setup hook. |
| Watcher filesystem (chokidar / fs.watch) | `fs.watch` sur bind-mounts Docker (hôte Windows) est peu fiable ; le polling de `git rev-parse HEAD` est robuste et trivial. |
| Working-tree dirty (`git status --porcelain`) comme déclencheur | Bruyant/coûteux (re-index à chaque tick tant que dirty), nécessite un debounce. Reporté (HEAD-only en v1, cf § 7). |
| Écrire le sidecar seulement après succès du job (polling jobId) | Plus robuste mais ajoute du polling. Reporté (cf § 7). |

## 4. Design

### 4.1 Fichiers

```
upstream/
├── docker-server-auto-reindex.mjs   NEW  shouldReindex (pure) + maybeReindexRepo (I/O) + handleAutoReindexRoute (GET /auto-reindex)
├── docker-server-watches.mjs        MOD  cronTick appelle maybeReindexRepo par repo
├── docker-server-config.mjs         MOD  parse la section auto_reindex
├── docker-server.mjs                MOD  monte handleAutoReindexRoute (avant le static fallthrough)
└── Dockerfile.web                   MOD  COPY docker-server-auto-reindex.mjs

tests/
├── unit/auto-reindex.test.mjs                       NEW  shouldReindex + parse config
└── integration/endpoints/auto-reindex.test.mjs      NEW  GET /auto-reindex shape

ROADMAP.md / INVENTORY.md / tests/README.md / CLAUDE.md (smoke loop)   MOD
patches/upstream-all.diff                                              REGEN
```

Aucun nouveau conteneur/process. Aucun changement `Dockerfile.cli`. Aucune nouvelle dépendance (Node http + child_process + fs, `git` déjà présent).

### 4.2 `docker-server-auto-reindex.mjs`

**Pure (testable) :**

```js
// Decide whether to trigger a reindex. Pure — no I/O.
//  enabled    : auto_reindex.onCommit from config
//  currentSha : `git rev-parse HEAD` (or null if not resolvable)
//  lastSha    : sidecar lastIndexedSha (or null on first sight / unreadable)
export function shouldReindex({ enabled, currentSha, lastSha }) {
  if (!enabled) return false;
  if (!currentSha) return false;       // not a git repo / rev-parse failed
  if (lastSha === null || lastSha === undefined) return false; // first sight: record, don't trigger
  return currentSha !== lastSha;
}
```

First-sight returns `false` so a fresh repo (or first run) records its baseline SHA without an immediate re-index storm. The caller writes the sidecar on first sight too (so the *next* commit triggers).

**I/O helper** `maybeReindexRepo(repo, apiBase)` :
1. `repoPath = repo.repoPath || repo.path`; skip if missing or `repo.name` contains `@` (snapshot).
2. `cfg = await getConfig(repoPath)`; `enabled = cfg.auto_reindex.onCommit`. If not enabled → return.
3. `currentSha = gitRevParse(repoPath)` — `execFile('git', ['-C', repoPath, 'rev-parse', 'HEAD'])`, trimmed; null on error.
4. Read sidecar `<repoPath>/.gitnexus/_auto-reindex.json` → `{ lastIndexedSha, lastTriggeredAt, lastJobId }` (null if absent/unreadable).
5. If `lastIndexedSha` absent and `currentSha` present → write sidecar `{ lastIndexedSha: currentSha, lastTriggeredAt: null, lastJobId: null }` (baseline), return (first sight).
6. If `shouldReindex({ enabled, currentSha, lastSha: lastIndexedSha })` :
   - `POST ${apiBase}/api/analyze` with JSON `{ path: repoPath }` (no `force` ⇒ incremental). Capture `jobId` from the response (best-effort).
   - Write sidecar `{ lastIndexedSha: currentSha, lastTriggeredAt: new Date().toISOString(), lastJobId }`.
   - `process.stderr.write('[auto-reindex] triggered for <name> @ <sha>\n')`.
   - All wrapped in try/catch — any failure logs + returns (best-effort, retried next tick if sidecar not updated).

**Route** `handleAutoReindexRoute(req, url, res, opts)` → `Promise<boolean>` :
- `GET /auto-reindex` → for each non-snapshot repo: read config + sidecar + `gitRevParse`, build `{ repo, enabled, lastIndexedSha, lastTriggeredAt, lastJobId, headSha, dueNow }` where `dueNow = shouldReindex({enabled, currentSha: headSha, lastSha: lastIndexedSha})`. Respond `{ reposScanned, autoReindex: [...] }`. Optional `?repo=` filter (like `/watches`).
- Returns `false` for other paths.

### 4.3 Wiring

- **`docker-server-watches.mjs`** : in `cronTick`'s repo loop (after the watch eval + wiki regen), add `await maybeReindexRepo(repo, apiBase).catch(() => {});`. Import from `./docker-server-auto-reindex.mjs`. Reuses the existing repo enumeration + 5-min interval.
- **`docker-server-config.mjs`** : add `parseAutoReindex(parsed)` returning `{ onCommit: !!(parsed?.auto_reindex?.onCommit) }`, default `{ onCommit: false }`. Include `auto_reindex` in the returned config object (both the `!repoPath` early return and the main path), mirroring how `wiki` was added.
- **`docker-server.mjs`** : import `handleAutoReindexRoute`; mount `if (await handleAutoReindexRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;` BEFORE the static-asset block (alongside `handleWikiRoute`).
- **`Dockerfile.web`** : `COPY docker-server-auto-reindex.mjs ./docker-server-auto-reindex.mjs` (mirror neighbor style).

### 4.4 Config shape

```json
{ "auto_reindex": { "onCommit": true } }
```

Default `{ onCommit: false }` (opt-in per repo). A future `watchWorkingTree` flag fits here without rework.

## 5. Edge cases

| Cas | Comportement |
|---|---|
| Repo non-git / `rev-parse` échoue | `gitRevParse` → null ; `shouldReindex` → false ; skip silencieux |
| Premier passage (pas de sidecar) | Enregistre la baseline SHA, ne déclenche PAS (évite un reindex storm) |
| auto_reindex absent / off | `shouldReindex` → false ; aucune action |
| Analyze déjà en cours | Le serveur API possède le lock LadybugDB et sérialise les jobs — un trigger est sûr |
| Sidecar illisible / JSON cassé | Traité comme first-sight (lastSha = null → pas de trigger, ré-écrit la baseline) |
| Snapshot (`name@sha`) | Skippé (même garde que le cron existant) |
| HEAD changé pendant un downtime serveur | Détecté au 1er tick après redémarrage (sidecar persistant) |
| Job analyze échoue | Sidecar déjà mis à jour optimiste ⇒ pas de re-try avant le prochain commit (limite documentée § 7) ; `lastJobId`/`lastTriggeredAt` visibles via `/auto-reindex` |

## 6. Testing strategy

- **Unit** (`tests/unit/auto-reindex.test.mjs`) : `shouldReindex` — disabled→false, no currentSha→false, first-sight (lastSha null)→false, unchanged→false, changed→true. Plus `parseAutoReindex` — absent→`{onCommit:false}`, `{onCommit:true}`→true, garbage→false.
- **Integration** (`tests/integration/endpoints/auto-reindex.test.mjs`) : `GET /auto-reindex` → 200, body `{ reposScanned, autoReindex: [...] }` ; each entry has `repo`, `enabled` (bool), `dueNow` (bool). Mirror the harness of an existing endpoint test (e.g. `lifespan-windowed.test.mjs`).
- **Smoke loop** (CLAUDE.md) : `curl /auto-reindex` → 200.
- No e2e (no UI surface).

## 7. Out of scope (futurs)

Enregistrés comme enhancements futurs (à porter en ROADMAP) :
- **Working-tree dirty detection** (`watchWorkingTree`) — re-index sur éditions non-committées (avec debounce).
- **Success-confirmation** : écrire le sidecar seulement après succès du job (polling `/api/analyze/:jobId`), pour re-tenter les jobs échoués.
- **UI surface** : badge Header "auto-reindex ⟳" + toggle écrivant `.gitnexus.json`.
- **Couplage post-reindex** : déclencher auto-snapshot / wiki regen après une ré-analyse (chaînage des automatismes).

## 8. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| `/api/analyze` sans `force` ne fait pas d'incrémental | Moyen | Vérifié en Task 1 du plan (lire le handler analyze upstream / tester `{path}` sans force). Si force requise pour incrémental, ajuster le body. |
| `git rev-parse` lent sur gros repo | Faible | Quasi-instantané ; N appels rapides par tick |
| Reindex storm si sidecar mal géré | Moyen | First-sight ne déclenche jamais ; écriture optimiste déduplique |
| Coût CPU des ré-analyses fréquentes | Faible/Moyen | Incrémental (fichiers dirty seulement) + opt-in défaut off + 1 par batch de commits |
| Couplage au cron watches (si WATCHES_ENABLED=false, pas d'auto-reindex) | Faible | Documenté ; cohérent avec le choix "réutiliser le cron". Le reindex manuel marche toujours. |

## 9. Effort estimate

| Tâche | Effort |
|---|---|
| `shouldReindex` + parse config + unit tests | ~½j |
| `docker-server-auto-reindex.mjs` (maybeReindexRepo + git + sidecar + route) | ~1j |
| Wiring (watches cron + docker-server mount + Dockerfile.web) | ~½j |
| Integration test + smoke | ~½j |
| Docs (ROADMAP/INVENTORY/CLAUDE/tests) + patch regen + build validation | ~½j |
| **Total** | **~2-3 jours** |

## 10. Document updates checklist (à la livraison)

- `ROADMAP.md` : nouvelle ligne "Déjà livré" + passer le verdict Auto-reindexing de 🟡 à ✅ dans la table enterprise + bump date header.
- `INVENTORY.md` : nouvel endpoint `GET /auto-reindex` + le module + le sidecar `_auto-reindex.json` + la passe cron.
- `CLAUDE.md` : ajouter `/auto-reindex` au smoke loop ; noter le comportement auto-reindex (opt-in, HEAD-change).
- `tests/README.md` : nouveaux tests (unit auto-reindex, integ auto-reindex).
- `patches/upstream-all.diff` : regen.
