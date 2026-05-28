# Code Wiki in the Web UI + Auto-Update — Design

**Date** : 2026-05-28
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Origine** : Item "Auto-updating Code Wiki" de l'évaluation de l'offre enterprise upstream (ROADMAP § "Enterprise / commercial offering", verdict 🟡 partiel — existe upstream en CLI seulement).
**Depends on** : CLI `gitnexus wiki` upstream (`upstream/gitnexus/src/core/wiki/` + `cli/wiki.ts`), notre docker-server pattern, le moteur watches/cron (Tier 2bis.3), le parser `.gitnexus.json` (Tier 2bis.4).

---

## 1. Context / problem

L'upstream gitnexus a un **Code Wiki** pleinement implémenté : `gitnexus wiki <path>` génère une documentation HTML à partir du knowledge graph (un `.md` par module + un `index.html` auto-contenu via `html-viewer.ts`, rendu par marked + mermaid en CDN). Sortie dans `<repo>/.gitnexus/wiki/`.

**Limite** : c'est **CLI-only**. Zéro route/panel wiki dans `gitnexus-web`. Dans notre déploiement, un utilisateur qui veut le wiki doit lancer la CLI à la main sur l'hôte, et le résultat n'apparaît nulle part dans le produit. L'enterprise upstream vend en plus un wiki **auto-updating** — qu'on n'a pas du tout.

Contrainte structurelle découverte à l'exploration : `core/wiki` (et le binaire `gitnexus`) n'existent QUE dans le conteneur `gitnexus-server` (`Dockerfile.cli`), PAS dans `gitnexus-web` (`Dockerfile.web`, qui n'a que le bundle Vite + nos `docker-server-*.mjs`). Le conteneur web ne peut donc ni importer ni spawner le générateur. De plus, le générateur a besoin d'un LLM, et aujourd'hui notre conteneur ne fait **aucun** appel LLM côté serveur (la seule feature qui en a besoin, semantic-labels, fait l'appel côté navigateur avec les clés de l'utilisateur). Le wiki ne peut PAS suivre ce modèle (le générateur est une classe Node qui lit la LadybugDB + écrit des fichiers).

## 2. Goal

Surfacer le Code Wiki existant **dans l'UI web** de notre déploiement (panel avec iframe sur l'`index.html` généré), permettre sa **régénération à la demande** (bouton) et **automatiquement** sur un intervalle configurable, piloté par **notre moteur watches/cron existant**. Génération côté serveur (clé LLM en env), pure réutilisation du générateur upstream via sa **CLI publique** (stable across bumps).

Succès = depuis l'UI, l'utilisateur ouvre un onglet "Wiki", voit la doc rendue, clique "Regenerate" et la voit se rafraîchir ; et s'il a activé `wiki.autoEvery` dans `.gitnexus.json`, le cron la régénère tout seul.

## 3. Décisions cadres (validées en brainstorm 2026-05-28)

| Décision | Choix retenu | Raison |
|---|---|---|
| Scope | **Full** : serve + generate (in-product) + auto-update | C'est la vraie valeur ("auto-updating Code Wiki dans le produit"). |
| Trigger de génération | **Approche 1** : `wiki-worker.mjs` (notre fichier) dans le conteneur `gitnexus-server`, qui spawn la CLI `gitnexus wiki` ; le conteneur web proxy + sert | Seule option donnant bouton manuel **+** auto-update via NOTRE cron, sans patcher le serveur API upstream (fragile aux bumps). Utilise la CLI publique. |
| Cadence auto | **Intervalle configurable, défaut OFF** (`.gitnexus.json > wiki.autoEvery`) + bouton "Regenerate now" | Coût LLM par régénération ⇒ pas de surprise. Réutilise le moteur watches. |
| Affichage UI | **iframe** dans un panel "Wiki" | In-product, réutilise l'`index.html` auto-contenu tel quel (zéro ré-implémentation du viewer). |
| Credentials LLM | **Env côté serveur** (`GITNEXUS_API_KEY`/`GITNEXUS_MODEL`/`GITNEXUS_LLM_BASE_URL`) sur le service `gitnexus-server` | Le générateur tourne côté serveur ; il supporte le mode headless (non-TTY → env vars). Documenté, jamais commité. |

### Alternatives écartées

| Alternative | Pourquoi écartée |
|---|---|
| Patcher le serveur API upstream (port 4747) pour ajouter `/wiki/generate` | Modifie le routing/entrypoint upstream — couplage fragile aux bumps (risque "Divergence upstream" déjà listé au ROADMAP). |
| Cron pur dans le conteneur server, web sert seulement | Pas de bouton "Regenerate now" depuis l'UI ; planification hors de notre moteur watches. Contredit 2 décisions. |
| Génération côté navigateur (comme semantic-labels) | Impossible : le générateur lit la LadybugDB + écrit des fichiers, il est intrinsèquement côté serveur. |
| Ré-render React natif (fetch des `.md` + module_tree.json) | Ré-implémente le viewer upstream (marked + mermaid + nav arbre) — gros effort + maintenance. L'iframe réutilise le viewer livré. → reporté en futur (cf § 7). |
| Importer le `dist/core/wiki` compilé dans le worker | Le spawn de la CLI publique est plus simple et stable (surface publique vs API interne du `WikiGenerator`). |

## 4. Design

### 4.1 Fichiers

```
upstream/
├── wiki-worker.mjs                  NEW  conteneur server : HTTP :4748, spawn `gitnexus wiki`
├── Dockerfile.cli                   MOD  COPY wiki-worker.mjs + wrapper d'entrypoint (API server + worker)
├── docker-server-wiki.mjs           NEW  conteneur web : GET /wiki, POST /wiki/generate, GET /wiki/status
├── docker-server.mjs                MOD  monte handleWikiRoute dans la chaîne
├── docker-server-watches.mjs        MOD  sur tick cron : repos avec wiki.autoEvery dû → POST /wiki/generate
├── docker-server-config.mjs         MOD  parse la section `wiki` de .gitnexus.json
├── Dockerfile.web                   MOD  COPY docker-server-wiki.mjs
└── gitnexus-web/src/
    ├── lib/wiki-schedule.ts          NEW  pure fn isWikiRegenDue(lastGeneratedAt, autoEvery, now)
    ├── components/WikiPanel.tsx      NEW  iframe + Regenerate + status + empty/error states
    └── hooks/useAppState.tsx         MOD  isWikiPanelOpen + toggle

docker-compose.yml                    MOD  env LLM sur gitnexus-server (port 4748 interne, pas exposé)

tests/
├── unit/wiki-schedule.test.mjs                       NEW  isWikiRegenDue
├── integration/endpoints/wiki.test.mjs               NEW  /wiki serve + /wiki/status + /wiki/generate (worker mocké)
└── e2e/specs/wiki-panel.spec.ts                       NEW  ouvrir panel + empty-state/iframe + Regenerate fire

ROADMAP.md / INVENTORY.md / tests/README.md / CLAUDE.md (smoke loop)   MOD
patches/upstream-all.diff                                              REGEN
```

### 4.2 `wiki-worker.mjs` (conteneur `gitnexus-server`)

Tiny serveur HTTP zéro-dep sur le port **4748** (interne au réseau compose, non exposé à l'hôte). Endpoints :

- `POST /generate?repo=<name>` :
  1. Résout `repo` → chemin disque (via `GET http://localhost:4747/api/repos`, même résolution que le web container).
  2. Si une génération est déjà en cours pour ce repo (map en mémoire `inProgress`) → 409 `{ generating: true }`.
  3. Sinon : marque in-progress, **spawn** `gitnexus wiki <repoPath>` en mode non-interactif. Étant non-TTY, la CLI résout la config LLM via les env vars (`GITNEXUS_API_KEY`/`OPENAI_API_KEY`, `GITNEXUS_MODEL`, `GITNEXUS_LLM_BASE_URL`) — aucun flag `--provider/--model` requis (mais surchargeable si besoin). Le spawn hérite de l'env du conteneur. Retourne **immédiatement** `202 { started: true }` (génération = minutes, async fire-and-forget).
  4. À la fin du process : démarque in-progress, stocke `{ lastExitCode, lastError, finishedAt }`.
- `GET /status?repo=<name>` → `{ generating: bool, lastGeneratedAt: string|null, error: string|null }` (lastGeneratedAt lu via mtime de `<repoPath>/.gitnexus/wiki/meta.json`).

Robustesse : le worker tourne **non-fatal** — s'il crashe, le serveur API (4747) reste up (wrapper d'entrypoint, cf § 4.6).

### 4.3 `docker-server-wiki.mjs` (conteneur `gitnexus-web`)

Handler `handleWikiRoute(req, url, res, opts)` → `Promise<boolean>` (pattern existant) :

- `GET /wiki?repo=<name>` : résout repoPath (`findRepoByName`), `wikiIndex = join(repoPath, '.gitnexus', 'wiki', 'index.html')`. Si présent → `createReadStream(wikiIndex).pipe(res)` avec `Content-Type: text/html` (pattern static existant lignes ~580-652 de docker-server.mjs). Sinon → 404 JSON `{ error: 'no wiki yet' }` (le panel affiche l'empty-state).
- `POST /wiki/generate?repo=<name>` : proxy `POST http://gitnexus:4748/generate?repo=<name>`, relaie le code (202/409) + body.
- `GET /wiki/status?repo=<name>` : proxy `GET http://gitnexus:4748/status?repo=<name>`.

### 4.4 Auto-update via watches cron

Dans `docker-server-watches.mjs`, le cron existant (`startWatchesCron`, tous les `WATCH_INTERVAL_MS`) gagne une passe wiki : pour chaque repo dont `.gitnexus.json > wiki.autoEvery` ≠ `'off'`, calcule `isWikiRegenDue(lastGeneratedAt, autoEvery, now)` (pure fn) ; si dû et pas déjà en cours → `POST /wiki/generate?repo` (interne). Pas de nouveau cron : on étend la boucle existante.

`isWikiRegenDue(lastGeneratedAt, autoEvery, now)` (pure, `lib/wiki-schedule.ts`) :
- `autoEvery === 'off'` ou non défini → `false`.
- `lastGeneratedAt === null` (jamais généré) → `true`.
- sinon parse `autoEvery` (`'24h'`, `'7d'`, `'1h'` → ms) et retourne `now - lastGeneratedAt >= intervalMs`.

### 4.5 Frontend — `WikiPanel.tsx`

Panel (toggle `isWikiPanelOpen` dans useAppState, bouton dans la barre comme les autres panels) :
- Header : titre "Wiki", `lastGeneratedAt` ("updated 3h ago" / "never generated"), bouton **Regenerate** (POST `/wiki/generate`, puis poll `/wiki/status` toutes ~3s jusqu'à `generating:false`, puis reload de l'iframe via changement de `key`/`src?ts=`).
- Corps :
  - Wiki présent → `<iframe src="/wiki?repo=<base>&ts=<lastGeneratedAt>" />` (le `ts` casse le cache au reload).
  - 404 (pas de wiki) → empty-state : "No wiki yet — click Regenerate to build it." + le bouton.
  - `generating:true` → spinner "Generating wiki… (this can take a few minutes)".
  - `error` → message (ex. "Run `analyze` first" si le graph manque, "LLM key missing" si 401).

### 4.6 `Dockerfile.cli` + entrypoint

- `COPY wiki-worker.mjs ./wiki-worker.mjs`.
- L'entrypoint actuel lance le serveur API. Le remplacer par un petit wrapper qui lance **les deux** : le serveur API (foreground/principal) + `node wiki-worker.mjs &` (background, non-fatal). Si le worker meurt, le conteneur ne tombe pas (le process principal = API server reste le PID de santé).

### 4.7 `docker-compose.yml`

- Service `gitnexus-server` : ajouter les env `GITNEXUS_API_KEY`, `GITNEXUS_MODEL`, `GITNEXUS_LLM_BASE_URL` (valeurs via `${...}` depuis un `.env` local non commité ; documenter dans README).
- Le port 4748 reste **interne** (le conteneur web l'atteint via le DNS compose `gitnexus:4748`) — pas de `ports:` exposé à l'hôte.

## 5. Edge cases

| Cas | Comportement |
|---|---|
| Wiki jamais généré | `GET /wiki` → 404 ; panel empty-state avec CTA Regenerate |
| `analyze` pas lancé (pas de graph) | `gitnexus wiki` échoue ; worker capture le code/err ; `/status` renvoie `error` ; panel affiche "Run analyze first" |
| Clé LLM absente/invalide | CLI échoue (401/empty) ; surfacé via `/status.error` |
| Double trigger même repo | Worker 409 `{ generating: true }` ; le bouton est disabled pendant `generating` |
| Génération longue (minutes) | Trigger async (202 immédiat) + polling `/status` ; pas de requête HTTP bloquante |
| Crash du worker | Non-fatal : le serveur API reste up (wrapper entrypoint) |
| Volume partagé absent | **Risque bloquant** — le web doit lire `.gitnexus/wiki/` écrit par le server. Vérifié en Task 1 (cf § 8). |
| `autoEvery` malformé | `isWikiRegenDue` retourne `false` sur parse invalide (pas de régen sur config cassée) |

## 6. Testing strategy

- **Unit** (`tests/unit/wiki-schedule.test.mjs`) : `isWikiRegenDue` — off, never-generated (true), interval pas écoulé (false), écoulé (true), parse `24h`/`7d`/`1h`, malformé (false).
- **Integration** (`tests/integration/endpoints/wiki.test.mjs`) : `/wiki` 200 quand le fichier existe (fixture) / 404 sinon ; `/wiki/status` shape ; `/wiki/generate` proxy renvoie 202 (worker mocké via un stub HTTP). Pas d'appel LLM réel.
- **E2E** (`tests/e2e/specs/wiki-panel.spec.ts`) : ouvrir le panel Wiki → empty-state OU iframe présent ; cliquer Regenerate → le `POST /wiki/generate` part (intercept réseau) + le statut passe "generating". **Pas** de génération LLM réelle (trop lent/coûteux) — on teste le câblage, pas la sortie LLM.
- **Smoke loop** (CLAUDE.md) : ajouter `/wiki?repo=hmm_studio` (peut 404 si jamais généré — accepter 200/404) + `/wiki/status?repo=hmm_studio` (200).

## 7. Out of scope — **enregistré en ROADMAP futur** (à la demande)

Reportés en enhancements futurs du Code Wiki (cf ROADMAP § Enterprise / Code Wiki) :
- **Ré-render React natif** du wiki (fetch `.md` + `module_tree.json`, viewer thémé) au lieu de l'iframe — meilleure intégration visuelle.
- **Régen staleness-based** (régénérer quand le graph a matériellement changé : N fichiers, delta entropy) en plus de l'intervalle.
- **Config LLM provider in-UI** (au lieu de l'env-only) — éviter d'éditer docker-compose.
- **Gist publishing** depuis l'UI (la CLI a déjà `--gist`).

## 8. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| Volume partagé ne couvre pas le chemin repo data | **Élevé** | Task 1 du plan vérifie le `volumes:` de docker-compose AVANT tout. Si absent, l'ajouter. |
| 2e process dans le conteneur server | Moyen | Wrapper entrypoint ; worker non-fatal ; API server reste le process de santé |
| Coût/temps LLM par régen | Moyen | Async + défaut OFF + cadence configurable + bouton manuel |
| Clé LLM côté serveur (sécurité) | Moyen | Via `.env` non commité + doc README ; jamais dans le repo |
| iframe + CDN marked/mermaid | Faible | L'app est déjà web ; nécessite réseau navigateur (acceptable). Vérifier qu'aucune CSP stricte ne bloque l'iframe same-origin. |
| Divergence upstream sur la CLI `gitnexus wiki` | Faible | On appelle la **surface publique** (CLI args), pas l'API interne ; robuste aux bumps |

## 9. Effort estimate

| Tâche | Effort |
|---|---|
| `isWikiRegenDue` pure + unit | ~½j |
| `wiki-worker.mjs` + Dockerfile.cli wrapper | ~1-1½j |
| `docker-server-wiki.mjs` (serve+proxy+status) + mount | ~1j |
| Watches cron auto-regen + config parse | ~½j |
| `WikiPanel.tsx` + toggle + polling | ~1½j |
| docker-compose env + integration + e2e | ~1j |
| Docs (ROADMAP/INVENTORY/CLAUDE smoke/tests) + patch regen | ~½j |
| **Total** | **~6-7 jours** |

## 10. Document updates checklist (à la livraison)

- `ROADMAP.md` : nouvelle ligne "Déjà livré" + passer le verdict Code Wiki de 🟡 à ✅ (partiel→livré) dans la table enterprise + bump date header.
- `INVENTORY.md` : nouveau panel + 2 endpoints web (`/wiki`, `/wiki/generate`, `/wiki/status`) + le worker dans le conteneur server.
- `CLAUDE.md` : ajouter `/wiki` + `/wiki/status` au smoke loop ; noter le 2e process du conteneur server + l'env LLM requis.
- `tests/README.md` : nouveaux tests (unit wiki-schedule, integ wiki, e2e wiki-panel).
- `patches/upstream-all.diff` : regen.
