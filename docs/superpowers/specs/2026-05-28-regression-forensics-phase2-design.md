# Regression Forensics Phase 2 (ownership + dissonance + coupling) — Design

**Date** : 2026-05-28
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Supersedes** : néant — **étend** [`2026-05-28-regression-forensics-mvp-design.md`](2026-05-28-regression-forensics-mvp-design.md) (Phase 1, entropy). Le skeleton Phase 1 (`/regression`, METRIC_REGISTRY, locateRegression, rankCulprits) est réutilisé tel quel ; Phase 2 le généralise.
**Depends on** : Phase 1 livré (Tier 57). `/ownership`, `/dissonance`, `/coupling` (Tiers 1.1 / 2.2 / 1.2), `/commit/footprint`, `listSnapshotNamesAndDates`, le git-log bucketing de `docker-server-entropy-commits.mjs`.

---

## 1. Context / problem

Phase 1 a livré `/regression` pour entropy (density/modularity) en réutilisant 3 endpoints : série temporelle (`/entropy`), attribution par commit (`/entropy/commits`), footprint (`/commit/footprint`). Le skeleton (registry + `locateRegression` + `rankCulprits`) a été conçu pour s'étendre.

Phase 2 veut couvrir **ownership** (bus-factor, top-author-share), **dissonance** (purity), **coupling**. Deux obstacles, confirmés à l'exploration :

1. **Aucune série scalaire par snapshot** n'existe pour ces métriques. `/ownership` lit l'historique git *live* (pas de borne temporelle). `/dissonance` interroge le graphe *live* via Cypher. `/coupling` est un batch full-timeline pairwise (pas de scalaire repo-level).
2. **Aucune attribution par commit** (pas de `/xxx/commits` comme entropy). Le coupable doit donc être déterminé par heuristique : *suspects dans la fenêtre de régression classés par `filesTouched`*.

## 2. Goal

Généraliser le skeleton `/regression` pour qu'un `metric=ownership.busFactor|ownership.topAuthorShare|dissonance.purity|coupling` retourne le même verdict (régression localisée + commit(s) suspect(s) + fichiers impliqués), avec une **fidélité étiquetée honnêtement** (entropy = attribution principielle ; les nouvelles = suspects heuristiques). Aucun nouvel endpoint (`/regression` inchangé), aucune UI.

Succès = `GET /regression?repo=hmm_studio&metric=ownership.busFactor` retourne `{ regressed, window, before, after, steepestDrop, worstCommit (suspect), attribution:'suspects' }`, idem pour les 4 nouveaux scalaires.

## 3. Décisions cadres (validées en brainstorm 2026-05-28)

| Décision | Choix | Raison |
|---|---|---|
| Couverture Phase 2 | **TOUT en un spec** : ownership + dissonance + coupling | Choix utilisateur (tout). Fidélité étiquetée par métrique. |
| Attribution (nouvelles métriques) | **`window-suspects`** : commits de la fenêtre de régression classés par `filesTouched` | Pas d'attribution par commit pour ces métriques ; honnête + réutilise le git-log bucketing existant. |
| Foundation partagée | **`docker-server-git-utils.mjs`** (extrait de `entropy-commits`) + refactor `entropy-commits` pour l'importer | DRY ; une seule implémentation du parse/bucketing git-log. |
| Scalaire coupling | **`pairsAboveThreshold@0.5`** (count de paires avec Jaccard ≥ 0.5) | Entier interprétable ; pas de scalaire repo-level existant. Seuil configurable. |
| Série ownership | `/ownership?until=<iso>` (ajout `--until=<date>` au git log) + itération snapshots | 1-ligne ; rend ownership genuinely per-snapshot. |
| Série coupling | `/coupling?asOf=<iso>` (truncate la timeline) + itération snapshots | Le batch full-timeline devient cumulatif jusqu'à S. |
| Série dissonance | `fetchFileCommunities` reçoit `repo@sha` (Cypher snapshot) + domain-config du snapshot source dir, **fallback live** | Le plus fragile ; best-effort (skip si graphe snapshot non chargé). |
| Directions "pire" | busFactor ↓, topAuthorShare ↑, purity ↓, coupling ↑ = pire | Aligné sur la sémantique de seuil du moteur watches. |

### Alternatives écartées

| Alternative | Pourquoi écartée |
|---|---|
| Vraie attribution par commit pour chaque métrique (recalcul de la métrique par commit) | Coûteux (`/graph/at-commit` ~50s/commit). Les suspects heuristiques suffisent au MVP. |
| Phaser ownership seul d'abord | L'utilisateur veut tout en un incrément. |
| `meanJaccardTopN` pour coupling | Moins interprétable qu'un count de paires fortement couplées. |
| Ne pas refactorer entropy-commits (juste copier le git-log util) | Duplication ; le refactor DRY est validé par le test d'intégration entropy existant. |

## 4. Design

### 4.1 Fichiers

```
upstream/
├── docker-server-git-utils.mjs        NEW  parseGitLog + resolveWindowEnd + commitsInWindow + listSnapshotNamesAndDates (exportés)
├── docker-server-entropy-commits.mjs   MOD  importe git-utils (refactor DRY, comportement inchangé)
├── docker-server-regression-core.mjs   MOD  registry étendu (seriesProvider + attribution) + rankSuspects (pur)
├── docker-server-regression.mjs        MOD  dispatch par registry : series provider + mode attribution
├── docker-server-ownership.mjs         MOD  + param ?until=<iso> (--until sur le git log)
├── docker-server-coupling.mjs          MOD  + param ?asOf=<iso> (truncate timeline) + scalaire dérivé dans la réponse
├── docker-server-dissonance.mjs        MOD  Cypher snapshot (repo@sha) + domain-config snapshot+fallback
└── Dockerfile.web                      MOD  COPY docker-server-git-utils.mjs

mcp-server/server.mjs                   (inchangé — gitnexus_regression passe déjà metric through)

tests/
├── unit/regression-suspects.test.mjs                NEW  rankSuspects + registry Phase 2 rows
├── integration/endpoints/regression-phase2.test.mjs NEW  /regression pour les 4 nouveaux scalaires
└── integration/endpoints/ (ownership until, coupling asOf — assertions ajoutées aux tests existants si présents, sinon nouveaux)

ROADMAP.md / INVENTORY.md / tests/README.md / CLAUDE.md   MOD
patches/upstream-all.diff                                 REGEN
```

### 4.2 Foundation — `docker-server-git-utils.mjs`

Extrait de `docker-server-entropy-commits.mjs` (exporté) :
- `parseGitLog(stdout)` → `[{ sha, shortSha, date, author, files: string[] }]`.
- `resolveWindowEnd(repoPath, ref)` → ISO date (SHA ou ISO ou `live`/`oldest`).
- `commitsInWindow(repoPath, fromIso, toIso)` → `parseGitLog` du `git log --since --until --name-only --no-merges`, avec `filesTouched = files.length` par commit.
- `listSnapshotNamesAndDates(repoName)` → `[{ name:'<repo>@<sha>', date, isLive:false }]` (la version canonique, exportée).

`entropy-commits` est refactoré pour importer ces fns (suppression de ses copies privées). Le test d'intégration entropy existant + le build valident l'absence de régression.

### 4.3 Skeleton généralisé — `docker-server-regression-core.mjs`

```js
export const METRIC_REGISTRY = {
  density:    { worseDirection: 'up',   series: 'entropy:density',    attribution: 'entropy-commits', attrField: 'attributedDensityDelta' },
  modularity: { worseDirection: 'down', series: 'entropy:modularity', attribution: 'entropy-commits', attrField: 'attributedModularityDelta' },
  'ownership.busFactor':     { worseDirection: 'down', series: 'ownership:repoBusFactor',        attribution: 'window-suspects' },
  'ownership.topAuthorShare':{ worseDirection: 'up',   series: 'ownership:topAuthorShare',       attribution: 'window-suspects' },
  'dissonance.purity':       { worseDirection: 'down', series: 'dissonance:purity',              attribution: 'window-suspects' },
  coupling:                  { worseDirection: 'up',   series: 'coupling:pairsAboveThreshold',   attribution: 'window-suspects' },
};

// NEW pure fn — rank commits in the regression window by filesTouched (suspects).
export function rankSuspects(commitsInWindow) {
  // sort desc by (filesTouched ?? files?.length ?? 0); ties → most recent first.
}
// locateRegression, rankCulprits (Phase 1) unchanged.
```

`series` is an opaque `"<source>:<field>"` tag the I/O layer maps to a provider. The pure core stays pure (no I/O); it only declares directions + which provider/attribution to use.

### 4.4 I/O — `docker-server-regression.mjs` (generalized)

The route reads `cfg = METRIC_REGISTRY[metric]`, then:
1. **Series** — `getSeries(cfg.series, repo)` dispatches:
   - `entropy:*` → `/entropy` timeline (Phase 1 path).
   - `ownership:*` → for each snapshot (`listSnapshotNamesAndDates` + live), `GET /ownership?repo=<base>&until=<snapDate>` → `repoBusFactor` / `repoAuthors[0].share`.
   - `coupling:pairsAboveThreshold` → for each snapshot, `GET /coupling?repo=<base>&asOf=<snapDate>` → derived `pairsAboveThreshold`.
   - `dissonance:purity` → for each snapshot, `GET /dissonance?repo=<base>@<sha>` → `purity` (skip snapshots that error).
2. `locateRegression(series, cfg.worseDirection)` (unchanged).
3. **Attribution**:
   - `entropy-commits` → existing Phase 1 path (`/entropy/commits` + `rankCulprits`).
   - `window-suspects` → `commitsInWindow(repoPath, worstPair[0].date, worstPair[1].date)` (or the whole [from,to] if no steepest pair) → `rankSuspects` → top suspect + runners-up.
4. **Footprint** of the top culprit/suspect (`/commit/footprint`) — unchanged.
5. Response adds `attribution: 'attributed' | 'suspects'`. In suspects mode, `worstCommit.attributedDelta = null` and a `filesTouched` count is included so fidelity is explicit. Shape otherwise identical to Phase 1.

### 4.5 Endpoint param additions

- **`/ownership?until=<iso>`** : when present, append `--until=<iso>` to the `git log`. Absent → unchanged (full history). Backward-compat.
- **`/coupling?asOf=<iso>`** : when present, truncate `listSnapshotNamesAndDates` to snapshots with `date <= asOf` before the co-occurrence loop, and include `pairsAboveThreshold` (count of `pairs` with `jaccard >= COUPLING_REGRESSION_THRESHOLD`, default 0.5) in the response. Absent → unchanged.
- **`/dissonance`** (snapshot support) : `fetchFileCommunities` passes the full `repoName` (with `@sha`) to the `/api/query` Cypher `repo` param ; domain config is read from the snapshot's source dir if present, else the live config. Live calls (`repo` without `@sha`) unchanged.

## 5. Edge cases

| Cas | Comportement |
|---|---|
| Métrique inconnue | 400 (Phase 1 path inchangé) |
| < 2 snapshots | `regressed:false` + note (Phase 1) |
| ownership `until` antérieur au 1er commit | git log vide → busFactor 0 / share 0 ; série gère via skip null |
| coupling `asOf` avant 2 snapshots | timeline tronquée < 2 → scalaire 0 ou null (skip) |
| dissonance : graphe snapshot non chargé dans l'API | `/dissonance?repo=@sha` échoue → provider skip ce snapshot (best-effort) |
| dissonance : pas de domain-config (ni snapshot ni live) | `/dissonance` retourne déjà son erreur "no config" → série vide → `regressed:false` + note |
| window-suspects : fenêtre sans commit (stragglers) | `worstCommit:null`, `runnersUp:[]` |
| Tie filesTouched | most-recent-first |

## 6. Testing strategy

- **Unit** (`tests/unit/regression-suspects.test.mjs`) : `rankSuspects` (tri par filesTouched desc, tie→récent, vide) ; `METRIC_REGISTRY` Phase 2 rows (directions + attribution mode + series tags corrects pour les 4 scalaires).
- **Integration** (`tests/integration/endpoints/regression-phase2.test.mjs`) : `/regression?metric=ownership.busFactor|ownership.topAuthorShare|dissonance.purity|coupling` → 200, shape `{ metric, regressed (bool), attribution:'suspects', worstCommit (object|null), runnersUp (array) }`. Plus assertions sur les params : `/ownership?until=<iso>` retourne un busFactor (≤ full) ; `/coupling?asOf=<iso>` retourne `pairsAboveThreshold` (number).
- **Régression entropy** : le test d'intégration entropy-commits existant DOIT rester vert après le refactor git-utils (preuve de non-régression du DRY).
- **Smoke loop** (CLAUDE.md) : `curl /regression?repo=hmm_studio&metric=ownership.busFactor` → 200 (+ 1 ligne par nouveau scalaire si souhaité, ou une seule représentative).
- **MCP smoke** : `gitnexus_regression(metric:'ownership.busFactor')` → objet avec `metric` + `regressed`.

## 7. Out of scope (futurs)

- **Vraie attribution par commit** pour les nouvelles métriques (vs suspects heuristiques) — demande un recalcul par commit (coûteux).
- **"Auto" regression forensics** (déclenchement sur watch threshold-crossing) — commun à Phase 1.
- **UI** highlight.
- **Coupling scalaire alternatif** (meanJaccardTopN) — `pairsAboveThreshold` retenu ; l'autre est un ajout trivial si besoin.

## 8. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| Refactor git-utils casse `/entropy/commits` | Moyen | Test d'intégration entropy-commits existant + build valident ; extract = déplacement, pas réécriture. |
| dissonance per-snapshot fragile (graphe snapshot non chargé) | **Moyen/Élevé** | Best-effort : skip les snapshots qui échouent ; étiqueter dissonance comme la plus basse fidélité dans la réponse + doc. Si trop de skips → série courte → `regressed:false` honnête. |
| N appels HTTP par série (ownership/dissonance/coupling) | Moyen | Séquentiel, endpoints rapides ; fenêtre = sous-ensemble de snapshots. On-demand. Cache hors-scope. |
| coupling `asOf` truncation change la sémantique du batch | Faible | Param opt-in ; sans `asOf`, comportement inchangé. |
| Attribution suspects de basse fidélité prise pour une vérité | Faible | `attribution:'suspects'` + `attributedDelta:null` explicites dans la réponse. |

## 9. Effort estimate

| Tâche | Effort |
|---|---|
| git-utils extraction + refactor entropy-commits | ~1j |
| Skeleton généralisé (registry + rankSuspects + dispatch) + unit | ~1j |
| Ownership series (`?until=` + provider) | ~1j |
| Coupling series (`?asOf=` + scalaire dérivé + provider) | ~1-1½j |
| Dissonance series (Cypher snapshot + config + provider) | ~1½-2j |
| Integration tests + MCP smoke | ~1j |
| Docs + build + smoke | ~½j |
| **Total** | **~7-9 jours (~12-14 tasks)** |

## 10. Document updates checklist (à la livraison)

- `ROADMAP.md` : nouvelle ligne "Déjà livré" (Phase 2) + dans la table enterprise, "Auto regression forensics" reste 🟡 mais noter Phase 2 livrée (4 métriques de plus) ; "auto" + UI restent les seuls restants. Bump date header.
- `INVENTORY.md` : `/regression` couvre 6 scalaires ; nouveaux params `/ownership?until=`, `/coupling?asOf=` ; module `docker-server-git-utils.mjs` ; dissonance snapshot support.
- `CLAUDE.md` : smoke loop +1 ligne regression (ownership) ; noter les nouveaux params.
- `tests/README.md` : unit regression-suspects + integration regression-phase2.
- `patches/upstream-all.diff` : regen.
