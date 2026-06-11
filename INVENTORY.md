# GitNexus — État des lieux

**Snapshot daté : 2026-05-26 (post-bump v1.6.5)**
**Base upstream : `v1.6.5`** (commit `42d4fcaf`, 2026-05-16)
**Fork interne : [github.com/RoJLD/GitNexus](https://github.com/RoJLD/GitNexus) → branche `deployment`**

Document figé dans le temps, vocation : servir de base de brainstorming
pour les évolutions futures. À ré-éditer quand on bump la version
upstream ou qu'on livre un nouveau Tier de la roadmap.

---

## Partie A — Features du Gitnexus upstream (v1.6.3)

### A.1 Cœur produit
- Indexation de codebase → **knowledge graph** complet (dépendances, call chains, clusters, execution flows)
- Parsing **Tree-sitter** multi-langage : Python, JS/TS, Java, Go, Rust, C++, Kotlin, Swift, Dart, Proto, Ruby, PHP, etc.
- Stockage **LadybugDB** (natif CLI, WASM web)
- **Embeddings vectoriels** + FTS via DuckDB
- Détection de **communautés Leiden** pour découpage fonctionnel automatique

### A.2 Deux modes d'utilisation
| Axe | CLI + MCP | Web UI |
|---|---|---|
| Cible | Daily dev avec agents IA | Exploration / démos |
| Scale | Tout repo, taille illimitée | ~5k fichiers (browser memory) |
| Install | `npm i -g gitnexus` | gitnexus.vercel.app, zéro install |
| Storage | LadybugDB natif | LadybugDB WASM (per-session) |
| Privacy | Tout local | Tout in-browser |

Pont entre les deux : `gitnexus serve` → la web UI auto-détecte le backend local.

### A.3 CLI — commandes principales
- `setup` — configure MCP pour les éditeurs (one-time)
- `analyze [path]` — index un repo, avec flags `--force`, `--repair-fts`, `--skills`, `--embeddings`, `--workers <n>`, `--worker-timeout`, `--wal-checkpoint-threshold`, `--skip-embeddings`, `--skip-agents-md`, `--skip-git`, `--verbose`
- `mcp` — démarre serveur MCP (stdio)
- `serve` — démarre HTTP server multi-repo (port 4747)
- `list` / `status` / `clean` — gestion du registry global
- `wiki [path]` — génère wiki depuis le graph (LLM)
- `publish` — notifie le registry `understand-quickly`
- `group create/add/remove/list/sync/contracts/query/status` — multi-repo / monorepo

### A.4 Intégrations éditeurs
| Éditeur | MCP | Skills | Hooks |
|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ (PreToolUse + PostToolUse) |
| Cursor | ✅ | ✅ | ✅ (manuel) |
| Codex | ✅ | ✅ | — |
| Windsurf | ✅ | — | — |
| OpenCode | ✅ | ✅ | — |

### A.5 MCP tools exposés à l'agent
- `analyze_change` — blast radius / scope / affected processes / risk
- `generate_map` — architecture diagrams (mermaid)
- + tools de query du graphe (search, context, references, etc.)

### A.6 Skills agent (auto-installées dans `.claude/skills/`)
- **Exploring** — naviguer du code inconnu via le graphe
- **Debugging** — tracer un bug à travers les call chains
- **Impact Analysis** — analyser le blast radius avant changement
- **Refactoring** — planifier un refactor via dependency mapping
- + **Repo-specific skills** générés par `analyze --skills` (un `SKILL.md` par community Leiden détectée)

### A.7 Hooks Claude Code
- **PreToolUse** — enrichit Grep/Glob/Read avec contexte du graphe avant exécution
- **PostToolUse** — détecte un index stale après commit et prompte l'agent à réindexer

### A.8 Architecture multi-repo
- Registry global `~/.gitnexus/registry.json` (référence tous les repos indexés)
- Index par-repo dans `<repo>/.gitnexus/` (portable, gitignorable)
- MCP server unique sert tous les repos via connection pool LadybugDB (lazy open, eviction 5min, max 5 concurrent)

### A.9 Web UI
- Explorateur de graphe (Sigma 2D)
- Chat IA in-browser (BYO LLM)
- Mode bridge : auto-détection backend local
- Hébergé sur `gitnexus.vercel.app`

### A.10 Déploiement officiel
- 2 images Docker signées (Cosign) publiées sur **GHCR** + **Docker Hub** :
  - CLI/server (`ghcr.io/abhigyanpatwari/gitnexus:1.6.3`) — port 4747
  - Web UI (`ghcr.io/abhigyanpatwari/gitnexus-web:1.6.3`) — port 4173
- One-command : `docker compose up -d`

### A.11 Enterprise (hors OSS, mentionné dans README upstream)
- PR Review — blast radius automatique sur PRs
- Auto-updating Code Wiki
- Auto-reindexing
- Multi-repo support unifié
- OCaml support
- Priority feature requests

### A.12 Licence
PolyForm-Noncommercial-1.0.0 — usage non-commercial uniquement. Akon Labs vend la version commerciale.

---

## Partie B — Ce qu'on a ajouté côté `deployment`

### B.1 Bloc déploiement Docker interne
Fichiers à la racine du repo, qui rendent le setup reproductible sur poste Windows / Rancher Desktop sans toucher au code upstream :

| Fichier | Rôle |
|---|---|
| [Dockerfile.cli](Dockerfile.cli) | Image 9 lignes dérivée d'`upstream:1.6.3` — fixe permissions `/data/hf-cache` + vendor `install-duckdb-extension.mjs` manquant du tarball npm |
| [docker-compose.yml](docker-compose.yml) | Services + volumes globalement nommés + bind mount `PROJECTS_ROOT` |
| [.env.example](.env.example) | Template par-machine |
| [start.bat](start.bat) / [start.ps1](start.ps1) | Launchers desktop-clickable (CMD pour bypass PS policy). `start.ps1 -Elysium` émet des marqueurs `[ELYSIUM] k/7` + supprime ses `Read-Host` / l'ouverture navigateur (piloté par le splash Elysium ; mode normal inchangé). |
| [start-elysium.bat](start-elysium.bat) | Lance gitnexus derrière le splash Elysium (opt-in) : `Elysium.exe --manifest elysium.json`. `start.bat` reste le défaut console. Tier "Lanceur Elysium". |
| [elysium.json](elysium.json) | Manifeste Elysium : `name`/`accent`, commande (`powershell -File start.ps1 -Elysium`), `successUrl`, défauts des cases. Consommé par Elysium.exe (repo `VScode/Elysium`). |
| [stop.bat](stop.bat) / [stop.ps1](stop.ps1) | Stop gracieux |
| [reindex.ps1](reindex.ps1) | Re-analyze forcé d'un repo existant |
| [scripts/install-duckdb-extension.mjs](scripts/install-duckdb-extension.mjs) | Vendoré depuis `gitnexus@a418c47` |
| [scripts/patch-lbug-staleness.mjs](scripts/patch-lbug-staleness.mjs) | Patch runtime du bug stale-lbug-connection (adaptateur REST) |

**Pourquoi une image dérivée** : `:1.6.3` upstream ship avec 2 bugs connus dans son `Dockerfile.cli` (mkdir `hf-cache` sans `node:node` → EACCES, et oubli de `gitnexus/scripts/` → DuckDB FTS+VECTOR non installés). Notre layer fixe les deux.

### B.2 Time-travel + analytics
**Implémentation : patches sur upstream** (clone gitignoré, deltas sérialisés dans deux fichiers diff — voir ci-dessous).

#### B.2.0 Organisation des patches (Phase 1, 2026-05-29)
Le diff monolithique unique a été supprimé et remplacé par deux artefacts distincts :

| Fichier | Contenu | Risque de conflit au bump |
|---|---|---|
| [`patches/additive-files.diff`](patches/additive-files.diff) | ~99 fichiers neufs que nous possédons entièrement (tous les `docker-server-*.mjs`, les composants React additifs, les pure-function libs, les scripts, etc.) | **Nul** — ce sont des fichiers créés par nous, upstream ne les touche pas |
| [`patches/inplace-edits.diff`](patches/inplace-edits.diff) | 17 fichiers upstream modifiés en place (`docker-server.mjs`, `Dockerfile.web`, `App.tsx`, `useAppState.tsx`, `useSigma.ts`, `GraphCanvas.tsx`, `package.json`, `package-lock.json`, etc.) | **Toute la surface** — ces fichiers peuvent diverger à chaque bump |

**Shim `docker-server-routes.mjs` (additif)** : le câblage de routes (chaîne de dispatch + imports + lancement du cron) qui résidait en place dans `docker-server.mjs` a été extrait dans un fichier neuf `upstream/docker-server-routes.mjs` (exports `registerGitnexusRoutes` + `startGitnexusCron`). `docker-server.mjs` reste un fichier in-place mais son footprint est réduit — seuls les handlers utilitaires inline (`handleExport`/`handleImport`/`/listdir`) y demeurent par design.

**Outil de bump `scripts/bump-upstream.mjs`** : `node scripts/bump-upstream.mjs <tag-ou-branche>` clone l'upstream cible dans un répertoire jetable, applique `additive-files.diff` (doit être propre, sinon erreur), tente `inplace-edits.diff` avec `git apply --3way`, et écrit un rapport par fichier dans `patches/bump-dry-run-<target>.md` (résultat : clean / conflict / fail). First run contre `main` : résultat dans [`patches/bump-dry-run-main.md`](patches/bump-dry-run-main.md) — 107 clean / 0 conflict / 9 fail (les 9 fichiers in-place qui nécessiteront un re-merge manuel pour un bump vers `main`). La décision sur le format de cohabitation (rester en diff plat scindé vs migrer vers subtree/submodule) est différée à la Phase 2 — voir spec [`docs/superpowers/specs/2026-05-29-upstream-divergence-paydown-design.md`](docs/superpowers/specs/2026-05-29-upstream-divergence-paydown-design.md).

**Gardes de cohabitation (Phase 2, 2026-05-29)** : deux scripts complémentaires qui automatisent la surveillance du contrat upstream. Contrat formalisé dans [`docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md`](docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md).

| Script | Rôle |
|---|---|
| [`scripts/check-patch-drift.mjs`](scripts/check-patch-drift.mjs) | **Dérive interne** : compare les diffs commités (`additive-files.diff` / `inplace-edits.diff`) avec le clone `upstream/` actuel ; exit 1 + rapport si désynchronisés. À lancer avant tout commit touchant `upstream/`. |
| [`scripts/check-upstream-releases.mjs`](scripts/check-upstream-releases.mjs) | **Veille externe** : liste les tags upstream via `git ls-remote --tags` (pas d'API key) et compare la dernière release stable (`vX.Y.Z`) au pin dans `Dockerfile.cli` ; exit 10 si une version plus récente existe (alerte), exit 0 si à jour. |

#### Extraction Phase 3 (2026-05-29)

Le mécanisme de cohabitation upstream a été extrait dans un outil générique indépendant :
**`fork-cohabitation`** (dépôt frère `C:/Users/rdenis/VScode/fork-cohabitation`, CLI
`cohabit`). L'outil est piloté par :

- un fichier `cohabitation.config.json` déposé à la racine de chaque repo consommateur
  (champs : `upstreamUrl`, `cloneDir`, `additiveDiff`, `inplaceDiff`, `pinFile`,
  `pinPattern`) ;
- un registre multi-repo central `repos.json` dans `fork-cohabitation`, avec champs
  `name`, `path`, `tier` (priorité), `cadence` (fréquence de veille).

gitnexus est le **consommateur #1** : son `cohabitation.config.json` est présent à la
racine du repo et son entrée est enregistrée dans `fork-cohabitation/repos.json`.

Les 3 scripts locaux (`scripts/check-patch-drift.mjs`, `check-upstream-releases.mjs`,
`bump-upstream.mjs`) sont **conservés et gelés** : ils servent de référence autonome
et d'oracle de parité. Toute évolution de leur logique va désormais dans
`fork-cohabitation`. Leur suppression au profit du seul outil central est
conditionnée à l'onboarding d'un 2ᵉ repo consommateur.

Spec Phase 3 :
[`docs/superpowers/specs/2026-05-29-fork-cohabitation-extraction-design.md`](docs/superpowers/specs/2026-05-29-fork-cohabitation-extraction-design.md)

#### Endpoints backend (ajoutés à `docker-server.mjs`)
| Endpoint | Fonction |
|---|---|
| `POST /snapshot` + `GET /snapshots` | Snapshots manuels d'un repo à un commit donné |
| `POST /snapshot/bulk` + `GET /snapshot/bulk/:jobId` | Bulk N commits sur Y jours, SSE progress |
| `GET /api/graph` (étendu) | Diff visuel rouge/vert/gris entre 2 repos |
| `GET /churn` | Heatmap de volatilité des nodes sur la timeline |
| `GET /coupling` | Paires de fichiers qui changent ensemble (couplage temporel) |
| `GET /growth` | Counts par catégorie dans le temps |
| `GET /lifespan` | Buckets foundational / recent / discontinued / ephemeral. **Mode global (default)** : computed sur toute l'histoire (1er snapshot → live). **Mode windowed (Phase 2 Item #3)** : `?from=<shortHash\|oldest>&to=<shortHash\|live\|newest>` redéfinit "1er snapshot" → cursorA, "live" → cursorB. Backward-compat — sans params, comportement inchangé. Réponse en mode windowed inclut un champ `windowed: { from, to, snapshotCount }`. Ephemeral fenêtré nécessite snapshots intermédiaires (réutilise `/nodes/alive-between` machinery). |
| `GET /entropy` | Densité × modularité du graphe par snapshot |
| `GET /ownership` | Bus factor par fichier (`git log --name-only`) |
| `GET /dissonance` | Compare domaines déclarés (`.gitnexus-domains.json`) vs communities détectées, purity + misplaced |
| `GET /semantic-labels` + `POST` | Cache des labels LLM par community (LLM appelé côté frontend) |
| `GET /coupling/cross` | Couplage cross-repo via bucketing temporel sur `git log` multi-repo |
| `GET /growth/cross` | Timeline union des snapshots avec counts par-repo (migration des centres de gravité) |
| `GET /similarity` | Vecteur d'Identité (v1=5 dims, v2=10 dims via `?identityVersion=2` par défaut, opt-out `?identityVersion=1`) + cube 2×2×2 (structural × semantic × temporal) par paire, lit `.gitnexus.json > policy` (ou legacy `.gitnexus-policy.json`) + auto warnings (LICENSE / age / auteurs). Axe sémantique = dense cosine sur embedding centroids quand ≥80% des labels embeddés (Tier 2.5b.bis), sinon cosine BoW lexical (Tier 2.5b), sinon null (param `?lexicalSemantic=false` pour désactiver). Réponse inclut `galaxyXY[]` par repo (Tier 2.6, projection PCA 2D pure JS) + `repoId` + `normalizedRemote` (Tier 2bis.5). |
| `GET /nodes/alive-between` | Union des node IDs sur tous les snapshots dans [from, to] inclusive. Backend du mode "Permissive" du Timeline Temporal Filter (Phase 2 Item #1, Tier 50). Cache par `(repo, from, to, snapshotCount)` dans `.gitnexus/alive-between-cache.json`. |
| `GET /repos/by-id/:repoId` | Résout un repoId stable (`sha256(firstCommitSha + normalizedRemote)[:16]`) vers un ou plusieurs `<base>` indexés. Tier 2bis.5. |
| `GET /entropy/commits` | Attribue à chaque commit dans la fenêtre sa part du delta entropy observé entre snapshots bracketants (poids = filesTouched). MVP par interpolation, pas de Leiden in-memory. Params: `?repo=&from=&to=&days=&format=csv`. Tier 2bis.2. |
| `GET /watches` | Liste les watches déclarées dans `.gitnexus.json > watches` à travers tous les repos + leur dernier état d'évaluation in-memory. Le cron interne (interval `WATCH_INTERVAL_MS`, debounce `WATCH_DEBOUNCE_MS`) évalue et fire les webhooks Slack-compatible. **6 métriques supportées** (Tier 62) : entropy.{density,modularity}, ownership.{busFactor,topAuthorShare}, dissonance.purity, **coupling** (`pairsAboveThreshold`). Tier 2bis.3. **"Auto" regression forensics (Tier 59)** : au franchissement de seuil, le webhook est enrichi du verdict `/regression` complet (commit coupable + fichiers) + une ligne coupable dans le `text` Slack (best-effort, fire-time only) ; `GET /watches` `state` expose `lastCulprit`. Pure helpers `mapWatchToRegressionMetric`/`buildWebhookPayload`. **Coupling désormais watchable + auto-forensiquable (Tier 62)**. UI : bouton "Locate regression" dans `EntropyCommitTimeline` (bannière coupable + ring de barre + clic → drill-down). |
| `GET /commit/footprint` | Files touched par un commit (status A/M/D) via `git show --name-status`. Params: `?repo=&sha=`. Permet l'overlay commit sur le graph côté frontend (highlight des nodes par `filePath` match). Honest : c'est le footprint, pas le graph reconstruit au commit. Tier 2bis.2 follow-up. |
| `POST /snapshot/auto` | Auto-snapshot des commits aux pics d'entropy (Phase A du chantier incremental-snapshots). Body : `{ topPercent, windowDays, debounceDays, minDelta, excludeMerges, metric, dryRun, maxToCreate }`. Toujours dryRun=true en premier (compute lourd). Cap hard `maxToCreate ≤ 5` (env `AUTO_SNAPSHOT_HARD_CAP`). Config par-repo via `.gitnexus.json > auto_snapshot`. |
| `POST /snapshot/from-pr` | PR-mode snapshot on-demand (Phase B). Params: `?repo=&base=&head=`, body `{ dryRun }`. Résout les 2 refs (branches/tags/SHAs/HEAD~N) via `git rev-parse`, snapshotte les 2 si pas déjà, retourne `{ base, head, diffUrl }` où diffUrl pointe vers la diff-visual UI existante. Degenerate case base==head géré avec warning. Agnostique de la forge (pas d'auth GitHub). |
| `POST /snapshot/incremental` | Per-commit incremental diff (Phase C). Params: `?repo=&commit=`, body `{ filters, force, reuseDump }`. Re-use le machinery incremental natif gitnexus (patch `patch-incremental-dump.mjs` dumpe le subgraph avant write-back LBugDB). 6 filtres paramétrables + gzip/brotli, persiste `.gitnexus/incremental/<sha>.json.gz` avec `_meta` (filtres + stats). `reuseDump` re-filtre le dernier dump sans re-analyze (1ms). Benché : Standard = 40 KB/commit gzippé. |
| `GET /graph/at-commit` | Reconstruit le graph à n'importe quel commit (Phase C §4.3). Params: `?repo=&commit=[&lazy=true]`. Baseline = snapshot ancêtre le plus proche + replay des diffs incrémentaux (delete writeSet files → insert subgraph → prune dangling). 409 + liste si diffs manquants ; `?lazy=true` les génère à la volée. Retourne `{ baseline, replay, baselineCounts, reconstructedCounts, nodes, relationships }`. **Fidelity : structurel 100% exact vs full snapshot** ; globaux Community/Process baseline-stale par design. |
| `GET /commits` | **Commit lister (timeline Commits mode — commit-level time-travel, Plan 1/3)**, `docker-server-commits.mjs`. Liste légère des commits d'un repo via `git log` (pas d'analyze, pas de DB) pour le mode "Commits" de la timeline : un point par commit, clic → reconstruction in-memory via `/graph/at-commit`. Params: `?repo=&from=&to=&max=` (max capé à 2000, défaut 200), newest-first, réponse `{ repo, to, commits:[{hash,shortHash,message,author,email,date,parent}], truncated }`. `from` tronque la liste (inclusif). Réutilise `runCmd`/`findRepoByName` (docker-server-snapshots). Spec 2026-05-28. |
| `POST /snapshot/baseline-seed` · `GET /snapshot/baseline-seed/:jobId` · `POST /snapshot/promote` | **Baseline auto-seed (commit-level time-travel, Plan 2/3 — pièce B)**, `docker-server-baseline-seed.mjs`. `baseline-seed?repo=&commit=` → 202 + `{jobId}`, lance `createSnapshot` (analyze complet) en arrière-plan puis écrit le marqueur `.hidden` (baseline interne) ; statut **pollable** via `GET .../:jobId` → `{state, phase, snapshot?, error?}` (pas de SSE). `promote?repo=&commit=` supprime `.hidden` → le baseline devient un jalon visible. Le marqueur `.hidden` exclut le snapshot de `/snapshots` par défaut (champ `hidden` + `?includeHidden=true` pour le voir) ; `findNearestBaseline` voit tous les baselines (le marqueur ne masque que l'UI). Déclenché côté front quand `/graph/at-commit` renvoie `needsBaseline:true`. Spec 2026-05-28 §3.3. |
| `POST /snapshot/prewarm` · `GET /snapshot/prewarm` | **Diff pre-warming (commit-level time-travel, Plan 3/3 — pièce C)**, `docker-server-prewarm.mjs`. Pré-génère en fond les diffs incrémentaux manquants (via `/snapshot/incremental` sur soi-même) pour que `/graph/at-commit` soit instantané (vs ~50s lazy). `POST ?repo=&max=` → 202 `{queued}` (fire-and-forget, on-era à l'entrée du mode Commits). `GET ?repo=&max=` → `{total, warm, cold}` (état des N derniers commits, read-only). **On-push** : la cron `watches` appelle `maybePrewarmRepo` par repo, opt-in `.gitnexus.json > incremental.preWarm` (+ `preWarmCommits`, défaut 50), cap `PREWARM_PER_TICK` (5) par passage + garde anti-overlap. Même cache `.gitnexus/incremental/<sha>.json.gz`. Spec 2026-05-28 §3.4. |
| `POST /ghosts/sync` | Parse `<repo>/ROADMAP.md` via le builtin source + tous les ghost-sources enregistrés via `registerGhostSource()`, merge par id (builtin gagne), écrit `<repo>/roadmap.yml` (versionné) + `<repo>/.gitnexus/ghosts.json` (runtime latest). Réponse `{ synced: true, syncedAt, syncedCommit, ghosts: [...] }`. Idempotent — un second appel sans changement produit le même JSON. Tier 3.x foundation. |
| `GET /ghosts` | Renvoie le `ghosts.json` latest (404 si jamais sync). Chaque ghost porte `{ id, declared, plannedAt, materializedAt, cancelledAt, links, source }`. |
| `GET /ghosts/at` | Renvoie le `ghosts.json` historique d'un snapshot. Params: `?repo=&commit=<shortHash>` (key directory = `safeSnapshotKey(commit.shortHash)`). 404 si snapshot inconnu. Auto-écrit par chaque `createSnapshot` (4 entry points : `/snapshot`, `/snapshot/bulk`, `/snapshot/auto`, `/snapshot/from-pr`). |
| `GET /ghost-audit` | Audit roadmap (Tier roadmap-predictive Audit view, 2026-05-27). Agrège 6 métriques sur la base du `ghosts.json` latest : `summary` (totals + cancellationRate), `leadTime` (médian/p25/p75/max + distribution buckets), `slippage` (early/onTime/late/noTarget vs `expectedBy`), `planChurn` (top churners cross-snapshot), `velocity` (rolling 28j), `expired` (Update 1, alertLevel). 404 si `/ghosts/sync` jamais lancé. Cache disque mtime-invalidé sur `ghosts.json`. MCP tool `gitnexus_ghost_audit` (19ème). |
| `GET /wiki` · `POST /wiki/generate` · `GET /wiki/status` | **Code Wiki web UI (Tier 55)**, `docker-server-wiki.mjs`. `/wiki` sert `<repo>/.gitnexus/wiki/index.html` depuis le volume partagé (404 `no wiki yet` si absent) ; `/wiki/generate` + `/wiki/status` proxient le `wiki-worker.mjs` (2e process du conteneur `gitnexus`, `:4748` interne) qui spawn la CLI publique `gitnexus wiki` headless. Génération server-side ⇒ clé LLM en env (`GITNEXUS_API_KEY`). Auto-régen via cron watches (`.gitnexus.json > wiki.autoEvery`). |
| `GET /auto-reindex` | **Auto-reindexing (Tier 56)**, `docker-server-auto-reindex.mjs`. Read-only état par repo `{ enabled, headSha, lastIndexedSha, lastTriggeredAt, lastJobId, dueNow }`. Le cron watches (`maybeReindexRepo`) détecte un changement de HEAD SHA (`git rev-parse`) et POST `/api/analyze` sans `force` (incrémental). Opt-in via `.gitnexus.json > auto_reindex.onCommit` (défaut off). Sidecar `<repo>/.gitnexus/_auto-reindex.json` (écriture optimiste ; first-sight = baseline). Tout dans le conteneur web (git + /api/analyze déjà dispos), zéro worker. |
| `GET /regression` | **Regression Forensics MVP Phase 1 (Tier 57)**, `docker-server-regression.mjs` (I/O) + `docker-server-regression-core.mjs` (pur : `METRIC_REGISTRY`, `locateRegression`, `rankCulprits`). `?repo=&metric=density\|modularity&from=&to=` → `{ regressed, window, before, after, netDelta, steepestDrop, worstCommit:{sha,author,message,attributedDelta,files}, runnersUp[] }`. Localise la chute adverse la plus raide (série `/entropy`), classe le commit coupable (attribution `/entropy/commits`), joint les fichiers (`/commit/footprint`) — appels HTTP internes vers nos endpoints du web server. Skeleton générique prêt pour Phase 2 (ownership/dissonance/coupling). MCP tool `gitnexus_regression` (21e). Pas de ML ; worseDirection aligné sur `EntropyCommitTimeline` (density up / modularity down = pire). **Phase 2 (Tier 58)** : couvre désormais 6 scalaires (+ `ownership.busFactor`/`topAuthorShare`, `dissonance.purity`, `coupling`). `METRIC_REGISTRY` gagne tag `series` + mode `attribution` ; `getSeries` dispatch par snapshot (`/ownership?until=`, `/coupling?asOf=`+`pairsAboveThreshold@0.5`, `/dissonance` snapshot-aware) ; attribution `window-suspects` (commits de la fenêtre par filesTouched) pour les nouvelles, étiquetée `attribution:'suspects'`. Foundation partagée `docker-server-git-utils.mjs` (DRY d'entropy-commits). |
| `GET /groups` · `POST /group/sync` · `GET /group/status` · `GET /graph/merged` | **Multi-repo unified graph (Tier 65)**, `docker-server-group.mjs` + `docker-server-group-graph.mjs` (+ pur `docker-server-group-graph-core.mjs`). `/groups` liste les groupes synchronisés en lisant le volume partagé `gitnexus-data` (`/data/gitnexus/groups/<name>/{group.yaml,contracts.json}`, parse YAML minimal). `/group/sync`+`/group/status` proxient le `wiki-worker.mjs` (`:4748`) qui spawn `gitnexus group create --force / add <repo> <repo> / sync` (registry name == groupPath ⇒ `crossLink.repo` matche le nom indexé). `GET /graph/merged?group=` lit les repos membres + `crossLinks` du volume, fetch `/api/graph?repo=` par repo depuis le serveur API, replie chaque graphe au niveau fichier (`collapseToFileLevel` : nodes `<repo>::<file>`, symboles→fichier, arêtes intra roulées-up+dédupliquées, self-loops drop), fusionne + ajoute les arêtes cross-repo (`mergeRepoGraphs`, join par `symbolRef.filePath`). Node cap `GROUP_GRAPH_NODE_CAP` (8000, priorise cross-repo). Réponse `{ group, repos:[{name,color}], nodes, edges, crossRepoEdgeCount, capped }`. |
| `GET /graph/templates` · `POST /graph/scaffold` · `POST /graph/import` · `GET /graph/research[/:name]` | **Graph templates Stage 1 (Tier 67)**, `docker-server-graph-templates.mjs` (+ `-core` registry/store + `docker-server-research-fs-importer.mjs`). Registry de templates (`research-artifacts` built-in) ; **P0 (2026-06-03) — backed par le sidecar Kùzu `gitnexus-graphs`** : `scaffold`→crée un graphe Kùzu (DDL du template) via le sidecar + un index sur `gitnexus-data` ; `import`→importeur `research-fs` (walk `/data/projects/<source>` + frontmatter) → `ingest` Kùzu ; `research[/:name]`→`render` Cypher du sidecar (`{nodes,edges}`). Graphes en **vrai Kùzu** (plus de JSON). Sidecar = conteneur `gitnexus-graphs` (Node + `kuzu`, `Dockerfile.graphs`, service compose), **zéro patch backend**. Rendu front via le canvas single-graph (`?research=<name>`, `research-graph-adapter.ts`). POST handlers `try/catch → 500` (jamais de crash). 3 outils MCP : `gitnexus_list_graph_templates`, `gitnexus_create_graph_from_template`, `gitnexus_import_into_graph`. **P1 (2026-06-03) — SDK prouvé sur 2ᵉ template de chaque sorte** : template `academic-literature` (Paper/Author/Topic + AUTHORED/ABOUT), importeur `academic-json` lisant `papers.json` ; lens `imports-deps` (`GET /graph/lens/:id?repo=`) — projection file-level IMPORTS sur l'ASTKG via `/api/graph` (zéro couplage Kùzu). Sidecar `ingest`/`render` rendus schema-agnostics (`graphs-sidecar/kuzu-store.mjs`). Extractor offline `tools/academic-extract.mjs` (hôte uniquement, hors CI). **Template Library (2026-06-03)** : template `research-graph` (schéma générique `Entity`/`Relates`, type-as-property ; importeur `research-graph-json` lisant un `research-graph.json` curé → Hypothesis/Experiment/Verdict/SDR + edges sémantiques ; gitnexus-side, l'émetteur reste le travail Alten d'Experiment.Crypto). `GET /graph/templates` liste désormais research-artifacts + academic-literature (import), imports-deps (lens), research-graph (import). **P2.1 graph-theory (2026-06-03)** : `GET /graph/metrics/:name` — degree + PageRank + **betweenness (Brandes) + eigenvector** + Louvain (communautés) sur la forme commune `{nodes,edges}` d'un graphe sidecar, moteur pur-JS zéro-dép `docker-server-graph-theory-core.mjs` ; outil MCP `gitnexus_graph_metrics` ; overlay frontend (couleur=communauté, toggle « Metrics » + **sélecteur de métrique de taille** degree/pagerank/betweenness/eigenvector). **P2.2 (2026-06-03)** = betweenness+eigenvector+sélecteur. **P2.3.1 (2026-06-09)** : `computeMetrics(graph,{community,resolution,seed})` ajoute par-nœud `closeness`(Wasserman–Faust)/`katz`(itération non-normalisée, α clampé 0.85/Δ)/`harmonic`/`coreness`(k-core)/`clustering`/`articulation`(bool, Tarjan)/`componentId` ; top-level `bridges:[{source,target}]` ; `summary` gagne `density`/`componentCount`/`transitivity` ; **3 méthodes de communauté** sélectionnables via `GET /graph/metrics/:name?community=louvain\|leiden\|labelprop&resolution=` (Louvain à résolution défaut byte-identique, label-propagation, Leiden mono-niveau+raffinement-connexité) ; args MCP `community`/`resolution` ; sélecteur de taille étendu à 9 métriques (ajoute closeness/katz/harmonic/k-core/clustering). Rétro-compatible (appel nu = louvain@1 inchangé). **P2.3.2a (2026-06-09)** : `GET /graph/metrics/lens/:lensId?repo=<repo>[&community=&resolution=]` — métriques sur le **graphe de code** (ASTKG) via une projection lens. Récupère l'ASTKG depuis `${GITNEXUS_API}/api/graph?repo=` (canal interne, comme `imports-deps`, zéro couplage Kùzu), projette via un registre `LENSES` partagé (exporté de `docker-server-graph-lens-core.mjs` ; aujourd'hui `imports-deps` = graphe d'imports file-level), exécute `computeMetricsCapped`. Nouvelle garde `computeMetricsCapped(graph,{cap=2000})` + option `skipSuperLinear` sur `computeMetrics` : au-delà du cap les métriques super-linéaires (betweenness/closeness/harmonic/k-core/clustering) sont skippées (→ 0), `summary.capped`+`omittedMetrics` le signalent ; les métriques near-linéaires (degree/pagerank/eigenvector/katz/communauté/densité/composantes) restent. Route câblée avant la route sidecar ; la route sidecar passe aussi par `computeMetricsCapped` et ignore `/graph/metrics/lens/`. Outil MCP `gitnexus_graph_lens_metrics(lensId,repo,community?,resolution?)` ; overlay frontend étendu à la vue lens (`?lens=&repo=`). **P2.3.2b (2026-06-09)** : 2ᵉ lens `file-graph` (`projectFileGraph` — replie **tous** les types de relations, pas juste `IMPORTS`, au niveau fichier, une arête par paire) enregistré dans le registre `LENSES` partagé aux côtés d'`imports-deps` ; les deux sont rendables (`/graph/lens/:id`) et métriquables (`/graph/metrics/lens/:id`) sans nouveau code de route. **P2.3.2c (2026-06-09)** : 3ᵉ lens `symbol-graph` (`projectSymbolGraph` — projection identité du graphe ASTKG brut au niveau symbole, sans collapse, tous nœuds conservés) ; params `?cap=` (node-cap configurable, défaut 2000/max 50000), `?approx=<N>` (au-delà du cap, betweenness/closeness/harmonic estimés par échantillonnage de N sources — `betweennessApprox`/`closenessApprox`/`harmonicApprox`, exact si N≥V — au lieu d'être zérotés ; `summary.approximate`/`sampleSize`), `?fresh=1` (bypass cache) ; **cache de résultats** in-memory TTL 300s + LRU (`makeMetricsCache`, clé incluant cap/approx) sur les deux routes métriques. Ferme la ligne source-ASTKG (B) de P2.3.2. **P2.3.3 (surfaces, 2026-06-09)** : overlay frontend enrichi — **a)** sélecteur de méthode de communauté (re-fetch `?community=`), panneau **top-N** (classé par la métrique de taille), **export JSON/CSV** (lib pure `gitnexus-web/src/lib/metrics-view.ts` : `topNByMetric`/`metricsToCsv`/`metricsToJson`/`downloadText`, testée) ; **b)** coloration **heatmap** par centralité (`heatColor`), rendu des **points d'articulation** (halo `highlighted`) + **arêtes-ponts** (rouge épais), **isolation de communauté** (dim le reste) — via le 4ᵉ arg `opts` de `researchGraphToGraphology`. Tout frontend, zéro changement serveur/MCP/Dockerfile. **P2 (boîte à outils théorie-des-graphes) est complet** ; overlay **QA navigateur PASS 2026-06-10** (Playwright/Chromium — toutes les surfaces rendent, 0 erreur ; a trouvé+corrigé un bug de routing `?research`/`?lens`, `248fe373`). **P3 (visualisation) — P3.1/P3.2/P3.3 livrés 2026-06-10 (tous QA navigateur)** : P3.1 sélecteur de layout `force\|hierarchical\|circular` (`layeredLayout` BFS-rank, `useSigma.skipLayout`) ; P3.2 vue matrice d'adjacence (canvas, ordonné par communauté, `lib/adjacency-matrix.ts` + `AdjacencyMatrix.tsx`, toggle View graph↔matrix) ; P3.3 graphes research/lens rendus en **3D** (`Graph3DCanvas` + `lib/research-to-3d.ts`, toggle Metrics 3D + couleur communauté/taille centralité) ; `COMMUNITY_PALETTE` source unique dans `research-colors.ts`. **P3.4 (nav multigraph, 2026-06-10)** : `GET /graph/list` (instances sidecar via `readIndex`) + outil MCP `gitnexus_list_graphs` + client `listGraphs` ; `GraphSidebar` Stage 2 (liste les graphes scaffoldés, clic → `?research=` en préservant `?multigraph=1`, colonne pleine hauteur abs. `inset-y-0 left-0`) ; `NodeInspector` (`lib/node-inspector.ts` pur + composant) montre les champs + métriques du nœud sélectionné (via `useSigma.selectedNode`). **→ Graph Platform P0–P3 COMPLET** (QA navigateur PASS sur P2 overlay + P3.1/3.2/3.3/3.4 ; débloque la vision IA/Model-as-graph qui dépendait de P2+P3). **P2.3-backlog (moteur, 2026-06-10)** : `computeMetrics`/`computeMetricsCapped` gagnent 3 capacités opt-in additives (réponse byte-identique quand off) — **a)** `?directed=1` : `inDegree`/`outDegree`, **HITS** `hubs`/`authorities`, `sccId` (composantes fortement connexes, Tarjan itératif), betweenness directionnelle (remplace l'undirected en mode dirigé, même cap-gating) ; `summary.directed`+`stronglyConnectedComponentCount` ; **b)** `?hierarchy=1` : **Louvain multi-niveaux** (`louvainMultiLevel` — agrégation super-nœuds récursive, `louvain` refactoré via `localMoving`/`aggregate` en restant byte-identique) → `communityPath` par nœud + résumé top-level `hierarchy{levelCount,levels,method:'louvain'}` ; `community` plat = niveau 0 ; **c)** `?embed=spectral&dims=k` : **embeddings spectraux** (`spectralEmbedding` — Laplacian eigenmaps via power-iteration + déflation Gram–Schmidt, zéro-dép ; trivial eigenvector #0 jeté ; skippés au-delà du node-cap → `omittedMetrics`). `parseMetricsParams`+`metricsCacheKey` (désormais exporté) étendus des 4 params ; les 2 outils MCP (`gitnexus_graph_metrics`/`gitnexus_graph_lens_metrics`) exposent+forwardent `directed`/`hierarchy`/`embed`/`dims`. UI (slider de niveau, panneau kNN, layout spectral) = follow-up. [spec](docs/superpowers/specs/2026-06-10-graph-platform-p2.3-backlog-design.md). Reste backlog : assortativité, diamètre/excentricité, Leiden multi-niveaux, arêtes pondérées, consommation UI. **P-IA.1 (IA/Model-as-graph, 2026-06-10)** : template d'import `model-graph` (schéma dédié `ModelNode(id,type,label,layer)`/`ModelEdge(id,kind,weight)` — `type`=state/op/layer/observation, `kind`=transition/emission/tensor) + importeur `model-graph-json` (`docker-server-model-graph-importer.mjs`, lit un `model-graph.json` curé → ingest shape générique ; mirror exact de `research-graph` ; l'émetteur hmm_studio = follow-up) ; enregistré dans le registre + `IMPORTERS` ; render sur le canvas existant coloré par `type` (couleurs ajoutées à `research-colors.ts`) ; interrogeable par la boîte à outils P2 (incl. directionnel/SCC) + vues P3. **Zéro nouvelle architecture** (sidecar/routes/MCP template-driven inchangés). Fixture HMM synthétique (`tests/fixtures/model-graph/`) + tests unit/registre + round-trip d'intégration sidecar-gated. Premier slice de la vision IA/Model-as-graph (débloquée par P2+P3). [spec](docs/superpowers/specs/2026-06-10-ia-model-as-graph-p-ia-1-import-design.md). **P-IA.2 statique (observabilité structurelle, 2026-06-10)** : capacité moteur **générique** `reachability(graph,{outputs,inputs})` + `staticObservability(graph)` (BFS multi-source dirigée ; sorties = puits structurels out-degré 0/in-degré>0, entrées = sources) → **dead-weight** = nœud sans chemin dirigé vers une sortie (prunable). `?observability=1` (implique `directed`) ajoute par-nœud `reachesOutput`/`reachableFromInput`/`deadWeight` + `summary.deadWeightCount`/`outputCount`/`inputCount`/`observabilityDegenerate` ; additif/opt-in, near-linéaire (tourne même cappé, jamais dans `omittedMetrics`) ; clé de cache + les 2 outils MCP étendus. Hot-paths = réutilisent la centralité directionnelle (pas de nouveau champ). Highlight frontend dead-nodes (rouge `#ef4444` + toggle « Observability ») via `deadNodeIds` ajouté au 4ᵉ arg `opts` de `researchGraphToGraphology`. Tier *dynamique* (lens activations runtime) + `role` explicite = déférés. [spec](docs/superpowers/specs/2026-06-10-ia-model-as-graph-p-ia-2-static-observability-design.md). **P-IA.2 dynamique (overlay d'activations, 2026-06-10)** : tier dynamique de l'observabilité — overlay des magnitudes d'activation par-nœud (+ fréquences par-arête) d'un run d'inférence capturé, en heatmap. Contrat `model-activations.json` (à côté de `model-graph.json` dans le source dir, clé sur les ids de l'importeur — **résout la question « format de capture » vision §6**) ; `shapeActivations(doc)` pur dans `docker-server-graph-templates-core.mjs` ; route `GET /graph/activations/:name` (+`?run=`) ajoutée au `handleGraphTemplatesRoute` **déjà câblé** (lecture pure, **zéro nouveau module / zéro Dockerfile.web** — comme `/graph/list`) ; outil MCP `gitnexus_graph_activations`. Overlay frontend « Activations » (nœuds heat-colorés par magnitude via `heatColor`, `activationById`/`activationMax` au 4ᵉ arg `opts` de `researchGraphToGraphology` + toggle gated aux model-graphs). Le **producteur** (instrumentation runtime) = follow-up cross-repo. Fixture synthétique + tests unit/MCP/intégration (sidecar-gated) ; build web (tsc) vert. [spec](docs/superpowers/specs/2026-06-10-ia-model-as-graph-p-ia-2-dynamic-activations-design.md). **→ Tier observabilité (P-IA.2) COMPLET (statique + dynamique).** **P-IA.3 (« as code » + diff de versions, 2026-06-10)** : la pièce neuve = diff structurel de 2 model-graphs. `diffGraphs(a,b)` pur dans `docker-server-graph-templates-core.mjs` (forme universelle `{nodes,edges}` ; nœuds ajoutés/retirés/changés [type/label] ; arêtes ajoutées/retirées par id `${from}->${kind}->${to}` ou `source kind target` ; `summary.drift`) ; route `GET /graph/diff?a=&b=` (rend les 2 via `sidecarRender` + diff) au `handleGraphTemplatesRoute` déjà câblé (zéro nouveau module/Dockerfile) ; outil MCP `gitnexus_graph_diff`. **Distinct** du `computeGraphDiff` frontend (TS/KnowledgeGraph/presence-only) : backend, change-aware, MCP-accessible. Diff de poids + vue visuelle déférés. Le reste de P-IA.3 (communautés=modules, centralité=hot-paths, dead-weights, entropy/coupling sur le model-graph) est **déjà disponible** via les endpoints P2/P-IA.2 (un model-graph est juste un graphe). [spec](docs/superpowers/specs/2026-06-10-ia-model-as-graph-p-ia-3-model-diff-design.md). **Render-prop passthrough (enabler, 2026-06-10)** : `mapRenderRows` pur extrait dans `graphs-sidecar/render-map.mjs` (kuzu-free, host-testable) — `render` spread `...n`/`...r` puis champs calculés → **passthrough additif** de tout prop Kùzu stocké (poids d'arête, `layer`, …) vers les consommateurs (métriques/diff/canvas/MCP), réponse superset (consommateurs existants inchangés). Premier consommateur : `diffGraphs.edges.changed` (delta de `weight` sur arêtes communes) + `summary.changedEdges`. Débloque (déférés) activation edge-width + métriques pondérées. `graphs-sidecar/` = dir tracké (pas de patch) ; **rebuild du sidecar requis pour déployer**. [spec](docs/superpowers/specs/2026-06-10-graph-platform-render-prop-passthrough-design.md). **Vue diff visuelle (P-IA.3 frontend, 2026-06-10)** : le diff backend `/graph/diff` rendu sur le canvas model/research — libs pures graphology-free `gitnexus-web/src/lib/graph-diff-view.ts` (`buildDiffStatus` id→statut, `unionResearchGraphs` générique type-transparent, `DIFF_VIEW_COLORS` ajouté/retiré/changé/commun) host-testées ; `opts.diffStatusById` à l'adaptateur (couleur par statut) ; `getGraphDiff` client ; GraphCanvas « Compare ▾» (options via `listGraphs`) → rend l'union A+B colorée + légende de drift. Pendant canvas du diff snapshot code-graph. [spec](docs/superpowers/specs/2026-06-10-ia-model-as-graph-p-ia-3-visual-diff-design.md). **Convertisseur ONNX → model-graph (P-IA.1 neural, 2026-06-10)** : `tools/onnx-to-model-graph.mjs` (outil Node offline tracké, zéro-dép) — `onnxGraphToModelGraph(onnxGraph,{name,maxNodes})` mappe ops→nœuds (`type:'op'`) + flux de tenseurs→arêtes (`kind:'tensor'`, producteur→consommateur) → `model-graph.json` importé par le template P-IA.1 **existant** (zéro nouvel importeur). Parse `.onnx`→JSON = pré-étape Python offline documentée (`MessageToDict`, hors-CI). Garde `maxNodes` (échec bruyant). Échelle/LoD 10⁴–10⁶ ops = déférée. 6 unit verts. [spec](docs/superpowers/specs/2026-06-10-ia-model-as-graph-onnx-importer-design.md). **→ Producteurs model-graph : hmm_studio (structuré, repo HMMstudio branch feat/model-graph-export) + ONNX (neural, ce convertisseur).** **Render LoD v1 (2026-06-10)** : garde côté rendu pour gros graphes — lib pure `gitnexus-web/src/lib/graph-lod.ts` (`pruneForRender(graph,{maxNodes,by})` + `LOD_MAX_NODES`=1500, graphology-free host-testée) garde les top-N nœuds par degré + arêtes entre eux au-delà du seuil (sinon no-op, générique type-transparent) ; GraphCanvas l'applique avant le rendu (research/model + union de diff) + bannière « showing N of M » (`data-testid=lod-banner`, pas de troncature silencieuse). Collapse op-group/communauté + LoD 3D déférés. [spec](docs/superpowers/specs/2026-06-10-graph-platform-render-lod-design.md). |
| `GET /listdir` | Folder browser server-side |
| `GET /export` + `POST /import` | Bundle ou index-only, register-only mode |
| `?format=csv` partout | Serializer partagé `docker-server-csv.mjs` |

#### Composants frontend (React/TS, dans `gitnexus-web/src/`)
- `Timeline.tsx` — slider + play/pause auto-animation + **Preload all snapshots** (bouton Download/Check, fetch parallel pool=3 du graphe de chaque snapshot, cache `useAppState.snapshotCacheRef` Map, switchRepo sert depuis le cache → frame swap instantané pendant le Play, sans LoadingOverlay entre frames). **Timeline zoom + 2 cursors A/B Phase 1** (Tier 47, ROADMAP) : drag cursors blue/orange (auto-swap A≤B), "Zoom to window" stretche [A,B] sur la largeur + mini-map collapsible visible quand zoomed (localStorage persist), indicateur de durée adaptatif "[A]→[B] · Δ X (h/d/y) · N snapshots", "Compare A↔B" toggle graphMode mutuellement exclusif avec cross-repo diffMode, raccourcis Z + Shift+D. State dans `useAppState` : `cursorA`, `cursorB`, `zoomWindow`, `graphMode`. Pure fns dans `lib/timeline-zoom.ts`. `diffBetweenSnapshots` alias dans `lib/graph-diff.ts`. **Task 11 (App.tsx + useSigma wiring du diff visuel intra-repo) DEFERRED** — `graphMode='diff'` set l'état mais le canvas ne reflète pas encore. **Timeline Temporal Filter Phase 2 Item #1** (Tier 50) : dropdown 4 modes (Off / Strict A∩B / Normal A∪B / Permissive window-union) à côté de "Compare A↔B". State dans useAppState (`temporalFilterMode`, `temporalFilteredNodeIds`, etc.). Filter appliqué via hide-mask dans `useSigma.ts` node reducer (composable avec diff coloring). **Timeline Wheel Zoom Phase 2 Item #4** (Tier 54) : zoom molette continu ancré souris, couplé aux curseurs. Listener `wheel` non-passif sur `timelineBarRef`, état transitoire `wheelWindow` (update rAF-throttlé) rendu via `effectiveWindow`, commit-on-settle debouncé (`WHEEL_ZOOM_SETTLE_MS`) qui snappe aux snapshots puis appelle `setCursorA/B` + `enterZoom(a,b)`/`exitZoom`. Pure fn `applyWheelZoom` dans `lib/timeline-zoom.ts`. Persistance URL gratuite (couplage curseurs → `tlA/tlB/tlZoom`).
- `hooks/useTimelineUrlSync.ts` + `lib/timeline-url.ts` — **Timeline URL Persistence Phase 2 Item #5** (Tier 53) : sync bidirectionnel état Timeline ↔ URL via 5 params `tl*` (tlA/tlB/tlZoom/tlMode/tlFilter), shortHash-based (`live` alias pour le head, stable across re-index). `lib/timeline-url.ts` = 2 pure fns testées (`serializeTimelineToParams` → `{set, remove}` clean-URL, `parseTimelineParams` → `TimelineUrlState`). Le hook (monté dans `AppContent` de `App.tsx`) fait : READ one-shot guardé (`readDone` ref) attendant `repo.snapshots?.length`, puis WRITE `replaceState` sur changement. Zoom restauré en différé (`pendingZoom` ref → effect qui fire `enterZoom()` quand cursors flushés). Aligné sur le pattern `?project=`/`?server=` existant.
- `components/WikiPanel.tsx` + `lib/wiki-schedule.ts` — **Code Wiki web UI Phase (Tier 55)** : panel (ouvert via bouton "Wiki" du `Header`, modal overlay dans `App.tsx`) qui affiche en `<iframe>` le wiki généré servi par `/wiki`, avec bouton Regenerate (`POST /wiki/generate` + polling `/wiki/status` toutes 3s), badge "updated …", lien "Open ↗", empty-state et messages d'erreur. `lib/wiki-schedule.ts` = pure fns `isWikiRegenDue`/`parseAutoEvery` (testées) ; un jumeau runtime inline vit dans `docker-server-watches.mjs` (le cron est du JS pur ESM, ne peut pas importer le `.ts`). Génération côté serveur via `wiki-worker.mjs` (racine repo) + `Dockerfile.cli` wrapper (2 process). State `isWikiPanelOpen` dans `useAppState`.
- `EntropyBadge.tsx` — densité × trend, inline dans Timeline (auto-hide si <2 points)
- `OwnershipPanel.tsx` — header repo-level, filtre path/auteur, slider bus-factor, click-to-highlight
- `CouplingPanel.tsx`, `GrowthChart.tsx` (SVG natif), `LifespanPanel.tsx`
  **Lifespan Windowed Phase 2 Item #3** (Tier 52) : header text "(window)" + badge daterange "from → to · N snapshots" affichés quand `data.windowed` présent (i.e. quand temporalFilterMode actif).
- `CouplingPanel` + `GrowthChart` ont un toggle interne **cross-repo** (Layers icon) → fetch `/coupling/cross` ou `/growth/cross`
- `DissonancePanel.tsx` — purity score + misplaced files + bouton ✨ pour générer les labels LLM
- `WhatIfPanel.tsx` — form rename/move/delete, file queue de mutations, preview qui réutilise le diff coloring
- `SimilarityPanel.tsx` — matrice N×N OU Galaxy view PCA 2D (toggle), drill-down par paire (scores/warnings/dominant features/policy/per-pair semantic mode badge `emb|lex`), table des identity vectors avec badge version + badges L/E par repo, bouton ✨ Embed labels (Tier 2.5a/b/b.bis/c/2.6). Galaxy view = SVG scatter avec edges proportionnels à la force moyenne du couplage, click-to-select-nearest-pair.
- `EntropyCommitTimeline.tsx` — sparkline SVG par-commit montée au-dessus de la Timeline (Tier 2bis.2 UI). Toggle "Commit Δ" dans Timeline, switch density/modularity, window input, click sur barre → drill-down avec copy-SHA + snippet git-show + bouton **Show on graph** qui fetch `/commit/footprint` et highlight les nodes touchés sur le graph courant (commit overlay, Tier 2bis.2 follow-up). Bouton **Rebuild @ commit** (Phase C) : fetch `/graph/at-commit`, reconstruit et swap le graph entier sur le canvas (vs footprint = simple highlight), banner violet "Reconstructed graph @ <sha>" avec counts + baseline distance + flag mixed-filters + bouton **Back to live** (restore le graph live). 409 → strip ambre + bouton **Generate & retry** (`?lazy=true`).
- `components/GroupGraphPanel.tsx` + `lib/group-graph-adapter.ts` — **Multi-repo unified graph web UI (Tier 65)** : panel (ouvert via bouton "Group graph"/`Layers` du `Header`, modal dans `App.tsx`) qui liste les groupes (`/groups`), crée+synchronise un groupe (form name + checkboxes repos, snapshots `@` filtrés ; `POST /group/sync` + polling `/group/status`), et "View" → `enterGroupGraph(group)`. Mode `group-graph` dans `useAppState` (`groupGraphActive/Loading/Error/Data` + `enterGroupGraph`/`exitGroupGraph`, miroir du mode coupling). `GraphCanvas.tsx` : quand `groupGraphActive`, l'effet graphe normal est gardé (`if (groupGraphActive) return;`) et un effet dédié charge `groupGraphToGraphology(data)` (positions seedées par secteur repo, FA2 converge en clusters ; nodes colorés par repo, arêtes cross-repo amber `#fbbf24`) via `setSigmaGraph(cacheKey:'group:<name>')`, + overlay légende (repos/couleurs + count cross-repo + cap) et bouton "← Back to single repo".
- `core/llm/agent.ts` — `createEmbeddingsModel(config)` mirror de `createChatModel` (OpenAI/Azure/Gemini/Ollama supportés, autres providers retournent null), `providerSupportsEmbeddings(config)` (Tier 2.5b.bis)
- `services/semantic-labeler.ts` — étendu avec `embedSemanticLabels({repo, signal, overwrite, onProgress})` : batch embedDocuments + fallback one-by-one + POST avec champs embedding/embeddingProvider/embeddingModel
- `SnapshotsPanel.tsx`, `BulkSnapshotModal.tsx`, `DiffBanner.tsx`
- `Graph3DCanvas.tsx` (mode 3D via `react-force-graph-3d` + `three`)
- `services/semantic-labeler.ts` — pipeline LLM (worker pool, abort-aware, MCP-via-frontend)
- `services/mutation-engine.ts` — pure rename / move / delete sur un KnowledgeGraph (frontend-only, no backend round-trip)
- `lib/graph-diff.ts` — utilities diff visuel
- `lib/lucide-icons.tsx` — re-exports d'icônes ajoutées (Activity, Minus, TrendingDown, Users, Layers, Target, History, Sparkles, Pause)
- Color reducers dans `useSigma.ts` (churnColor, couplingColor)
- `DropZone.LoadingCard` + `RepoAnalyzer` (loading bars + path picker + folder browser)
- Edits sur composants existants : `App.tsx`, `hooks/useAppState.tsx`, `Header.tsx`, `GraphCanvas.tsx`, `DropZone.tsx`
- `services/backend-client.ts` — `cache: 'no-store'` sur `fetchRepos`
- **Layout persistence (2026-05-27)** — `upstream/gitnexus-web/src/lib/layout-cache.ts` persiste positions FA2 par snapshot dans localStorage (`gitnexus:layout:v1:<repoName>`, version-gated). `useSigma.setGraph(graph, { cacheKey })` restore positions si hit ≥80%, save sur convergence FA2. `useSigma.recomputeLayout(cacheKey)` wipe + re-run (bouton Header "Recompute layout", icône Network). `upstream/gitnexus-web/src/lib/layout-worker.ts` + `layout-worker-pool.ts` — Web Worker FA2 (pool 2) lancé pendant Preload all snapshots → premier Play roadmap = instant. Bridge `useAppState.recomputeLayout` ↔ `useSigma.recomputeLayout` via `registerRecomputeLayout` ref (GraphCanvas register on mount).

#### Roadmap-predictive CORE (Tier 3.x foundation, 2026-05-26)
- `upstream/docker-server-ghosts-core.mjs` — pure fns : `parseRoadmap` (tables + Tier sections + `warnMissingExpectedBy`), `renderRoadmapYml` (sérializer déterministe, expectedBy émis), `matchExpectedLinks` (suffix + glob), `computeStatus` (lifecycle : declared wins, auto-match upgrade, `expired` après `expectedBy + 30d`), `parseTargetDate` (ISO / `YYYY-MM` / `YYYY-QX`).
- `upstream/docker-server-ghosts.mjs` — I/O wrapper + 3 route handlers + plugin registry. Exports `registerGhostSource({ name, fetchGhosts })`, `listGhostSources()`, `_resetGhostSourcesForTests()`, `syncGhostsForRepo`, `syncGhostsForSnapshot`, `readLatestGhosts`, `readSnapshotGhosts`, `handleGhostsRoute`. Builtin source `roadmap-md` toujours enregistré, ne peut être remplacé. Merge par id : builtin gagne, externes mergés en ordre d'insertion. Auto-sync wired dans `createSnapshot` (couvre `/snapshot`, `/snapshot/bulk`, `/snapshot/auto`, `/snapshot/from-pr`).
- `scripts/sync-ghosts.mjs` — CLI wrapper qui POST `/ghosts/sync` avec un message utile (rappelle de committer `roadmap.yml`).
- **Storage par repo** : `<repo>/roadmap.yml` (versionné), `<repo>/.gitnexus/ghosts.json` (runtime latest), `<snapshotDir>/ghosts.json` (state historique par snapshot, sealed au sha).
- **Update 4 du spec (manifest path)** : v0 = `roadmap.yml` distinct ; v1 cible = section `roadmap:` dans `.gitnexus.json` quand Tier 2bis.4 sera stable. Migration future : `npm run gitnexus:migrate-config`.

#### Roadmap-predictive Audit view (Tier roadmap-predictive Audit, 2026-05-27)
- `upstream/docker-server-ghost-audit-core.mjs` — pure fns : `computeSummary`, `computeLeadTime` (p25/médian/p75/max + buckets), `computeSlippage` (early/onTime/late vs `expectedBy` ; `parseTargetDate` dupliqué ici plutôt que ré-importé du CORE — module self-contained par choix), `computePlanChurn` (cross-snapshot deltas), `computeVelocity` (rolling window 28j), `computeExpired` (Update 1, alertLevel green/yellow/red).
- `upstream/docker-server-ghost-audit.mjs` — I/O wrapper + route handler `GET /ghost-audit`, cache disque mtime-invalidé (`isCacheValid` lit `mtime` de `ghosts.json` et compare au `computedAt` cached). 404 si `/ghosts/sync` jamais joué.
- `upstream/gitnexus-web/src/components/AuditPanel.tsx` + sous-composants dans `upstream/gitnexus-web/src/components/audit/` :
  - `AuditSummary.tsx` — cards totaux + expired counts (Update 1)
  - `LeadTimeHistogram.tsx` — SVG histogram + percentile lines
  - `SlippageBar.tsx` — stacked bar early/onTime/late/noTarget
  - `VelocitySparkline.tsx` — SVG rolling 28j
  - `PlanChurnList.tsx` — top N churners, callback `onSelectChurner` → highlight cross-component
  - `GhostTable.tsx` — sortable table avec `highlightedId` synchro PlanChurnList
- Wiring : `App.tsx` importe `AuditPanel`, ajoute un state local `auditPanelOpen`, render l'overlay top-right + bouton flottant bottom-right (data-testid `audit-panel-toggle`).
- MCP : tool `gitnexus_ghost_audit` ajouté dans `mcp-server/server.mjs` (19ème).
- **Update 2 deferred** : `placementAccuracy` (ghosts placés vs vrais ghosts shipping) requiert accès Leiden communities côté backend → reporté quand cette API existera.

#### Roadmap-predictive Augmented graph view (2026-05-27)
Pure frontend overlay — aucune route serveur, consomme `/ghosts?repo=` du CORE :
- `upstream/gitnexus-web/src/lib/ghost-layout.ts` — pure fns : `matchExistingNodes` (suffix + glob), `computeGhostLayout` (centroid pour anchored, grid 5 cols top-right pour satellite unmatched), `tierColor`, `passesFilter`, `derivedStatus`, `computeGhostVisualState` (Update 1 du spec — opacité time-decaying 4 alertLevels : fresh ≥0.5 / mature 0.4 / late 0.3 orange / critical 0.2 rouge), `DEFAULT_GHOST_FILTERS`.
- `upstream/gitnexus-web/src/services/ghosts-client.ts` — fetch `/ghosts?repo=` avec cache mémoire 30s + 404 graceful + `invalidateGhostsCache()` exposé pour refresh manuel.
- `upstream/gitnexus-web/src/lib/ghost-node-program.ts` — extension Sigma 3 `NodeCircleProgram` + outline dashed dessiné en canvas (pragmatic v1, pas de nouvelle dep Sigma).
- `upstream/gitnexus-web/src/components/GhostTooltip.tsx` — popup React au click ghost : titre, description, liste expectedLinks avec ✓/✗ matched/unmatched, bouton "Open in ROADMAP.md".
- `upstream/gitnexus-web/src/components/GhostFiltersSection.tsx` — section "Roadmap predictive" hiérarchique dans `FileTreePanel.tsx` (pattern existant) : master "Show ghosts" + per-Tier + cancelled.
- `upstream/gitnexus-web/src/hooks/useSigma.ts` — étendu pour merger ghost nodes/edges dans le reducer + register `GhostNodeProgram`.
- `upstream/gitnexus-web/src/hooks/useAppState.tsx` — `ghostFilters` lifted en state global (réutilise pattern existant des autres filtres).
- `upstream/gitnexus-web/src/components/GraphCanvas.tsx` + `FileTreePanel.tsx` — wiring fetch `/ghosts` + dispatch click-ghost → GhostTooltip.
- Update 2 (Augmented Timeline — scrubber Timeline + ghosts par instant T) explicitement **out-of-scope** : la mécanique Timeline existe, la mécanique d'overlay ghosts existe, mais la fusion est une sub-spec dédiée à brainstormer si demandé.
- Tests écrits (5 unit + 1 e2e) mais Vitest local bloqué par Node 21 → débloquera après upgrade Node 22 LTS (cf `docs/superpowers/decisions/2026-05-26-defer-node22-upgrade.md`).

#### Roadmap-predictive Gantt opérationnel (Tier 3.x, 2026-05-27)
- `upstream/gitnexus-web/src/lib/gantt-layout.ts` — pure fns : `computeTimeWindow` (now ± 30j fallback, pad 7j gauche, étend à now + 90j minimum), `dateScale` (linear), `computeGanttRows` (4 bar kinds), `pickBarColor` (Update 1 time-decaying via `computeGhostVisualState`).
- `upstream/gitnexus-web/src/components/GanttPanel.tsx` — container, fetch via `ghosts-client`, applique `passesFilter`, toggle swimlanes, sort dropdown (plannedAsc/tierAsc/status), CSV export client-side via Blob.
- `upstream/gitnexus-web/src/components/gantt/GanttAxis.tsx` — ticks mensuels + year labels + today line orange.
- `upstream/gitnexus-web/src/components/gantt/GanttBar.tsx` — `<rect>` ou `<circle>` selon kind, `stroke-dasharray` pour dashed.
- `upstream/gitnexus-web/src/components/gantt/GanttRow.tsx` — label tronqué + bars area, click propagation.
- **Storage** : aucun — entièrement dérivé de `/ghosts` en mémoire.

#### Roadmap-predictive Cleanup + Connectors (Tier 3.x, 2026-05-27)
- `upstream/docker-server-ghost-cleanup-core.mjs` — `buildCleanupPrompt` + `parseCleanupResponse` (pure fns).
- `upstream/docker-server-ghost-cleanup.mjs` — `POST /ghosts/cleanup-prompt` handler. Reuses `computeExpired` from Audit + `matchExpectedLinks` from CORE.
- `upstream/docker-server-connectors-core.mjs` — `tokenize` + `jaccardSimilarity` + `fuzzyMatchTicketToGhost`.
- `upstream/docker-server-connectors.mjs` — `GET /ghosts/connector-suggestions` handler + module-level connector registry.
- `upstream/connectors/plane.mjs` — full Plane REST API connector (fetchOpenWorkItems / fetchClosedWorkItems). Auth via `X-API-Key` env var.
- `upstream/connectors/{linear,github,jira}.mjs` — stubs that throw "not implemented yet (v1 stub)".
- `upstream/gitnexus-web/src/components/audit/CleanupModal.tsx` — modal opened via the 6th "Expired" card in AuditSummary. Lists expired ghosts + LLM-ready prompts ; v1 user copies the prompt to their LLM, then edits ROADMAP.md manually.
- **Config** (`.gitnexus.json > connectors.<name>`) : `{ enabled, apiUrl, workspaceSlug, projectId, matchThreshold }`. API keys via env (PLANE_API_KEY, GITHUB_TOKEN, LINEAR_API_KEY, JIRA_API_TOKEN).

#### Roadmap-predictive Brainstorm-hook (Tier 3.x, 2026-05-27)
- `scripts/ghost-from-spec.mjs` — CLI entry point. Parse spec → upsert row in ROADMAP.md managed section → optional `POST /ghosts/sync` if `GITNEXUS_PORT` env set.
- `scripts/ghost-from-spec-parser.mjs` — pure fns : `deriveId`, `extractTitle`, `extractDescription`, `extractTier`, `extractExpectedLinks`, `parseSpec`.
- `scripts/ghost-from-spec-roadmap.mjs` — `upsertManagedSection` (create if missing, upsert by id, idempotent).
- `scripts/install-brainstorm-hooks.mjs` — wizard that merges `.claude/settings.local.json` (PostToolUse hook on Write to specs/), creates `.git/hooks/post-commit`, and `.github/workflows/roadmap-sync.yml`. Non-destructive.
- `upstream/docker-server-ghosts-core.mjs` — parser étendu pour reconnaître `## 🧪 From spec brainstorms` (Update — Brainstorm-hook integration sur le CORE spec).
- **Storage** : la section managée de ROADMAP.md est la source. Le CORE re-parse à chaque sync.
- **Triggers** : 4 convergents (manuel, Claude PostToolUse, git post-commit, GHA). Installable via `npm run setup:hooks`.

#### Roadmap-predictive SysML export (Tier 3.x bonus, 2026-05-27)
- `upstream/docker-server-sysml-export-core.mjs` — pure fns `safeId`, `renderPlantUml`, `renderMermaid`. Pas de dépendance externe.
- `upstream/docker-server-sysml-export.mjs` — I/O wrapper qui lit `.gitnexus/ghosts.json` via `readLatestGhosts`, agrège les fichiers référencés par `ghost.links[]`, appelle le renderer choisi.
- Endpoint : `GET /sysml-export?repo=<name>&format=plantuml|mermaid&tier=<n>`. Renvoie `text/plain`. 200 / 400 (missing/bad params) / 404 (no sync) / 500 (errors).
- **Mapping SysML** : File → block, Ghost planned/expired → requirement, ghost.links → `<<satisfy>>`, dependsOn → `<<deriveReqt>>`, Tier major → package.
- **Out** : XMI, SysML v2, CALLS/IMPORTS edges, rendering PNG/SVG (le user rend chez lui), composant frontend.
- **Usage** : `curl :4173/sysml-export?repo=hmm_studio > diagram.puml` puis ouvrir dans PlantUML server / VSCode extension.

#### Roadmap-predictive Augmented Timeline (Tier 3.x, 2026-05-27)
Pure frontend extension de la Timeline existante — aucune route serveur, réutilise `/ghosts/at` du CORE :
- `upstream/gitnexus-web/src/lib/augmented-timeline.ts` — pure fns : `selectGhostsAt` (closest-prior), `computeTransitions` (Play cross-fade window), `resolveAugmentedTimelineMode` (auto-detect : live ↔ time-aware via `lockGhostsToHead` + 60s skew tolerance).
- `upstream/gitnexus-web/src/services/snapshot-ghosts-cache.ts` — parallel pool fetch (POOL=3) des `<repo>/snapshot/<sha>/ghosts.json` via `/ghosts/at` CORE endpoint, Map<sha, SnapshotGhosts> cache 30s TTL, cap 50 snapshots, abort-aware.
- `upstream/gitnexus-web/src/components/Timeline.tsx` — bouton "🎬 Animate roadmap" (`data-testid="animate-roadmap-button"`) : auto-cursor earliest + auto-Play + setAnimationActive(true), banner `Animating roadmap…` (`data-testid="animate-roadmap-banner"`) pendant l'animation. Auto-clear `animationActive` à Stop / fin de Play.
- `upstream/gitnexus-web/src/components/GhostFiltersSection.tsx` — toggle "Lock ghosts to today's view" sous le bloc per-Tier, visible uniquement quand `showGhosts` ON. Câblage transmis via `FileTreePanel.tsx`.
- `upstream/gitnexus-web/src/components/GraphCanvas.tsx` — useEffect mode-resolution sur (`cursorB`, `lockGhostsToHead`, `animationActive`) : `resolveAugmentedTimelineMode` → live vs time-aware → `selectGhostsAt` choisit le ghost set effectif → `applyGhostLayer`. Pre-fetch déclenché sur repo change quand l'overlay est ON.
- `upstream/gitnexus-web/src/hooks/useSigma.ts` — `opacityOverrideRef` (ghost id → opacité) consulté par le node reducer + `startGhostCrossFade(id, ms)` / `startRealNodeCrossFade(id, ms)` / `clearCrossFades()`. Single shared rAF loop interpole linéairement et refresh Sigma une fois par frame.
- `upstream/gitnexus-web/src/hooks/useAppState.tsx` — nouveaux états `lockGhostsToHead: boolean` + `animationActive: boolean` + setters. Defaults `false`.
- **Réutilise 100%** des sidecars CORE existants (`/ghosts/at?repo=&commit=`). Aucun endpoint serveur nouveau.
- 3 activation triggers : (1) auto-detect quand cursor B < HEAD - 60s, (2) Lock toggle filters, (3) Animate roadmap button.

#### Roadmap-predictive Ghost Cluster (Tier 3.x, 2026-05-27)
- `upstream/docker-server-ghosts-core.mjs` — `parseClusters` (markdown), `deriveAutoClusters` (Union-Find sur dependsOn), `computeClusterStatus` (aggregate + synthesis + expired + override).
- `upstream/docker-server-ghosts.mjs` — `syncGhostsForRepo` écrit aussi `.gitnexus/clusters.json` sidecar. `readLatestClusters` / `readSnapshotClusters` exportés.
- `upstream/docker-server-cluster-audit.mjs` — `GET /clusters?repo=&source=`.
- `upstream/gitnexus-web/src/lib/cluster-layout.ts` — `convexHull`, `clusterHullPolygon`, `polygonCentroid`, `assignSwimlanes`, `pointInPolygon`.
- `upstream/gitnexus-web/src/services/clusters-client.ts` — 30s cache.
- 4 surfaces UI : `ClusterTooltip` popup (Augmented), `GanttPanel.swimlanes='cluster'` mode (3-state radio + showOnlyClusterBars option), `audit/ClustersCard` + `audit/ClusterDrillModal` (7ème card AuditSummary), `GhostFiltersSection` (3 nouveaux toggles hiérarchiques).
- MCP tool `gitnexus_clusters` (20ème) avec `formatClustersSummary`.
- Status synthétisé : `shipped` (all-terminal + ≥1 materialized), `cancelled` (all cancelled), `expired` (cluster expectedBy + grace dépassé), `planned` (sinon). `declaredStatus` override.
- Auto-cluster id = `auto-cluster-<sha256(sorted-memberIds)[:8]>` — instable si membres changent (limitation documentée).

#### Dépendances ajoutées
- `react-force-graph-3d`, `three` (pour le mode 3D) — déclarées dans `gitnexus-web/package.json`
- `umap-js` (Tier 2.6.bis) — dynamic-importé par `SimilarityPanel/GalaxyView` quand le user clique sur "UMAP", reste out-of-bundle sinon

### B.3 Documentation interne
| Fichier | Contenu |
|---|---|
| [README.md](README.md) | Setup deployment local (Rancher, .env, start.bat) |
| [ROADMAP.md](ROADMAP.md) | Tier 1 + 2 (1.2/1.3/2.1/2.2) ✅ livrés, 2.3/2.4 pending, Tier 3 reste à valider |
| [CLAUDE.md](CLAUDE.md) | Règles pour l'agent : maintenir ROADMAP + INVENTORY à chaque feature, rebuild after upstream edits |
| [../CLAUDE.md](../CLAUDE.md) | Règle workspace : tests CI/CD si module en a déjà |
| [patches/README.md](patches/README.md) | Comment ré-appliquer les patches sur un clone frais + procédure de bump dry-run |
| [patches/additive-files.diff](patches/additive-files.diff) | ~99 fichiers neufs que nous possédons (risque de conflit nul) |
| [patches/inplace-edits.diff](patches/inplace-edits.diff) | 17 édits in-place de fichiers upstream (vraie surface de conflit au bump) |
| [patches/bump-dry-run-main.md](patches/bump-dry-run-main.md) | Rapport du premier dry-run de bump contre `main` (107 clean / 0 conflict / 9 fail) |
| [scripts/bump-upstream.mjs](scripts/bump-upstream.mjs) | Outil de bump dry-run : clone la cible, applique les deux diffs, écrit le rapport |
| [patches/example-gitnexus-domains.json](patches/example-gitnexus-domains.json) | Template pour la feature Dissonance |
| [patches/example-gitnexus-policy.json](patches/example-gitnexus-policy.json) | Template policy par-repo pour la feature Cross-repo similarity (isolation_required, allow_merge_with) |
| [vscode-extension/README.md](vscode-extension/README.md) | Setup + scope de l'extension VSCode (Tier 2.4) |
| [mcp-server/README.md](mcp-server/README.md) | Setup + protocole du sidecar MCP analytics (Tier 2bis.1) — 12 tools stdio JSON-RPC 2.0 zéro-dep, à brancher dans `~/.claude.json > mcpServers` |
| [INVENTORY.md](INVENTORY.md) | Ce document |

### B.4 Mapping ROADMAP ↔ État de livraison
**Livré (Tier 1 complet)** :
- ✅ 1.1 Bus factor + knowledge silos (`/ownership`, `OwnershipPanel`)
- ✅ 1.2 Cross-repo coupling (`/coupling/cross`, toggle Layers dans `CouplingPanel`)
- ✅ 1.3 Migration des centres de gravité — growth multi-repo (`/growth/cross`, toggle Layers dans `GrowthChart`)
- ✅ 1.4 Entropie structurelle (`/entropy`, `EntropyBadge`)
- ✅ 1.5 Export CSV (`?format=csv` partout)
- ✅ Loading bars + UX path picker + folder browser
- ✅ Export/Import (index-only + bundle) + register-only
- ✅ Diff visuel entre 2 repos
- ✅ Stale-lbug-connection fix
- ✅ Snapshots manuels + bulk + SSE
- ✅ Timeline UI play/pause
- ✅ Churn / Coupling / Growth / Lifespan

**Livré (Tier 2 complet, MVP)** :
- ✅ 2.1 Annotation sémantique LLM (`/semantic-labels`, `services/semantic-labeler.ts`, intégré dans `DissonancePanel`)
- ✅ 2.2 Dissonance score (`/dissonance`, `DissonancePanel.tsx`, exemple `patches/example-gitnexus-domains.json`)
- ✅ 2.3 What-if simulator (`services/mutation-engine.ts`, `WhatIfPanel.tsx`, frontend-only)
- ✅ 2.4 VSCode extension v0.1 ([vscode-extension/](vscode-extension/) — status bar + 2 commandes)
- ✅ 2.5a Cross-repo similarity v1 — plan structural × temporal (4 quadrants sur 8), identity vector 5-dim, policy JSON, warnings auto.
- ✅ 2.5b Cross-repo similarity v1.b — axe sémantique lexical (cosine BoW sur labels LLM cachés), cube 2×2×2 complet, partial-coverage handling.
- ✅ 2.5b.bis Cross-repo similarity v1.b.bis — vrais embeddings via `createEmbeddingsModel` (OpenAI/Azure/Gemini/Ollama), bouton ✨ Embed labels dans le panel, centroid cosine quand ≥80% des labels embeddés. Fallback gracieux : embeddings → lexical → null par paire.
- ✅ 2.5c Cross-repo similarity v1.c — Identity Vector v2 (10 dims : v1 + growthRate, churnConcentration, fileSizePareto, languageDiversity, treeDepth), opt-out `?identityVersion=1` pour rétrocompat.
- ✅ 2.6 Galaxy view — projection 2D PCA pure JS (power iteration + deflation, zéro dep) ajoutée à la réponse `/similarity` (`galaxyXY` par repo + `galaxyProjection`), `SimilarityPanel` toggle Matrix/Galaxy avec SVG scatter (edges proportionnels à la force, click-to-nearest-pair).
- ✅ 2.6.bis Galaxy UMAP — toggle PCA/UMAP dans le GalaxyView, calcul client-side (dynamic import `umap-js` → out-of-bundle pour les users qui n'ouvrent pas la galaxy), seed mulberry32 keyé sur le repo-set pour stabilité au refetch, nNeighbors adaptatif min(15, N-1). Tier 2 100% complet.

**Livré (Tier 2bis — plate-forme)** :
- ✅ 2bis.1 MCP analytics sidecar — [`mcp-server/`](mcp-server/) — serveur stdio JSON-RPC 2.0 pure Node zéro-dep, 13 tools (12 endpoints + `gitnexus_repo_by_id`). Coexiste avec `npx gitnexus mcp` upstream (pas de patch dans `upstream/`). Smoke 6/6 ✓ (`mcp-server/smoke.mjs`).
- ✅ 2bis.4 Unified `.gitnexus.json` — parser [`upstream/docker-server-config.mjs`](upstream/docker-server-config.mjs) avec sections `domains` / `policy` / `budgets` (réservé 3.6) / `watches` (réservé 2bis.3). Backward-compat sur `.gitnexus-domains.json` + `.gitnexus-policy.json` avec deprecation warning stderr (one-shot par `repoPath:fichier`). JSON et pas YAML (pas de YAML stdlib Node, déjà tranché à 2.2). Exemple canonique [`patches/example-gitnexus.json`](patches/example-gitnexus.json).
- ✅ 2bis.5 Stable repoId — [`upstream/docker-server-repo-id.mjs`](upstream/docker-server-repo-id.mjs) — `sha256(firstCommitSha + normalizedRemote)[:16]`, cache `<repoPath>/.gitnexus/repo-id.json`. Endpoint `GET /repos/by-id/:repoId` résout vers les `<base>`. Surface dans `/similarity > response.repos[].repoId`. MCP tool `gitnexus_repo_by_id`. **MVP scope** : pas encore consommé par les endpoints cross-repo (refactor à `2bis.5b` quand un re-clone cassera la similarité).
- ✅ 2bis.2 Commit-level entropy delta — backend [`upstream/docker-server-entropy-commits.mjs`](upstream/docker-server-entropy-commits.mjs) + UI [`components/EntropyCommitTimeline.tsx`](upstream/gitnexus-web/src/components/EntropyCommitTimeline.tsx). `GET /entropy/commits?repo=&days=N` (ou `from/to` = SHA ou ISO). Attribue à chaque commit sa part proportionnelle (filesTouched) du delta entropy observé entre snapshots bracketants. Stragglers (hors-fenêtre snapshot) ressortent avec `attributedDensityDelta: null`. CSV export via `?format=csv`. MCP tool `gitnexus_entropy_commits`. UI : sparkline SVG au-dessus de la Timeline, toggle "Commit Δ" (Activity icon), bars rouge/vert/gris, boundaries snapshot dashed amber, drill-down par commit avec copy-SHA + snippet git-show, switch density/modularity, window input. Live test : hmm_studio sur 180j → 99 commits, 66 attribués, 33 stragglers, 4 windows.
- ✅ 2bis.3 Alerting continu (MVP) — [`upstream/docker-server-watches.mjs`](upstream/docker-server-watches.mjs) — cron interne démarré au boot par `startWatchesCron()` dans `docker-server.mjs`. Interval `WATCH_INTERVAL_MS` (default 5min), debounce `WATCH_DEBOUNCE_MS` (default 1h), désactivable via `WATCHES_ENABLED=false`. Source des watches = `.gitnexus.json > watches` (parsé par 2bis.4). 5 métriques évaluables : entropy.{density,modularity}, ownership.{busFactor,topAuthorShare}, dissonance.purity. Webhook payload Slack-compatible (champ `text` pré-formaté + champs structurés). `GET /watches[?repo=]` liste + dernier état. MCP tool `gitnexus_watches`. **Limitation MVP** : seuils statiques (apprentissage = Tier 3 ML), state in-memory (perd l'historique au restart).
- ✅ Phase A incremental-snapshots — [`upstream/docker-server-snapshot-auto.mjs`](upstream/docker-server-snapshot-auto.mjs) — `POST /snapshot/auto?repo=` qui détecte les commits aux pics d'entropy (top-P% par \|attributedDelta\|, réutilise l'algo de /entropy/commits), filtre merges + minDelta + debounce, cap maxToCreate ≤ 5 (HARD_CAP env-overrideable), et appelle `createSnapshot` séquentiellement. `dryRun: true` retourne le plan sans rien créer (recommandé d'abord — chaque snapshot = ~3-5 min compute). Config par-repo via `.gitnexus.json > auto_snapshot` (section parsée par `docker-server-config.mjs`). MCP tool `gitnexus_snapshot_auto`. Live test : 1 snapshot créé end-to-end en 55s sur hmm_studio. Couvre UC1/UC2/Q1/Q3/Q5 du brainstorm doc.
- ✅ Phase B incremental-snapshots — [`upstream/docker-server-snapshot-from-pr.mjs`](upstream/docker-server-snapshot-from-pr.mjs) — `POST /snapshot/from-pr?repo=&base=&head=` résout les 2 refs via `git rev-parse` (branches/tags/SHAs/HEAD~N supportés), snapshotte les 2 si pas déjà, retourne `{ base, head, diffUrl }`. Agnostique de la forge — pas de dépendance GitHub API. `dryRun: true` valide les refs sans payer le coût. Degenerate case (base==head) géré avec `warning` + `diffUrl: null`. MCP tool `gitnexus_snapshot_from_pr`. Couvre UC3/UC4/Q4/Q8 du brainstorm doc. **Tier 2bis Phase B = complet** ; Phase C (true incremental) parquée jusqu'à signal explicite après 3 mois d'usage.

**Pending — Tier 2bis (plate-forme, ~3 semaines cumulées, à livrer avant le reste)** :
- ⏳ 2bis.1 MCP exposure des analytics time-travel (3-5j)
- ⏳ 2bis.2 Commit-level entropy delta (1 semaine)
- ⏳ 2bis.3 Alerting continu (watch + webhook) (1-2 semaines)
- ⏳ 2bis.4 Unified `.gitnexus.yaml` (2-3j)
- ⏳ 2bis.5 Repo ID stable (3-5j)

**Tier 2 résiduel** : aucun. Tout livré.

**Pending — Tier 3 étendu (R&D + stratégique)** :
- ⏳ 3.1 à 3.5 : voir [ROADMAP.md](ROADMAP.md) (inchangé)
- ⏳ 3.6 Architectural CI (concurrence Akon Labs commercial)
- ⏳ 3.7 AI-guided tour / Architect's Copilot (requiert 2bis.1)
- ⏳ 3.8 Domain-specific AST extractors (requiert 3.10)
- ⏳ 3.9 Public reference dataset / industry baselines (Chemin C)
- ⏳ 3.10 Plugin architecture pour analytics (lève le goulot horizontal)

**Aussi dans ROADMAP** :
- 🛠️ Section "Optimisations d'existant à programmer" — 8 items (storage, cache, bundle, smoke tests, perf metrics, etc.)
- 🎯 Section "Vision architecturale — trois chemins" — A (Architectural CI) / B (Architect's Copilot, recommandé) / C (Galaxie OSS)
- 🚨 Section "Refactos structurels à surveiller" — 7 issues identifiées dans la revue 2026-05-26

---

## Partie C — Distance avec upstream

| Référence upstream | Date | Commits devant nous |
|---|---|---|
| `v1.6.5` (notre base actuelle) | 2026-05-16 | 0 — point de départ |
| `origin/main` HEAD | 2026-05-22 | **+64 commits** (depuis v1.6.5) |
| `v1.6.6-rc.67` (RC en cours) | 2026-05-22+ | ≈ même |

> Note : "ahead/behind" git pur ne s'applique pas car les historiques sont sans ancêtre commun (notre branche `deployment` a 2+ commits "snapshot", pas une vraie dérivation). Le chiffre ci-dessus est : "depuis le tag `v1.6.5` que nous avons pris comme base, combien de commits sont arrivés upstream".

**Bump v1.6.3 → v1.6.5 effectué le 2026-05-26** (commit suivant celui-ci). Détails :
- 4 conflits hard résolus : `Dockerfile.web` (alpine → bookworm-slim, apt syntax), `docker-server.mjs` (CodeQL inline path containment), `gitnexus-web/package.json` (versions bumpées), `package-lock.json` (régen via `npm install`).
- Bug upstream #1502 (install-duckdb-extension.mjs missing in runtime) **fixé en v1.6.5** → suppression de `scripts/install-duckdb-extension.mjs` + 1 ligne COPY dans `Dockerfile.cli`.
- Bug upstream "stale lbug connection in REST adapter" **toujours présent** → notre patch `scripts/patch-lbug-staleness.mjs` continue à s'appliquer et le script self-validant confirme que `ensureLbugInitialized` n'a pas changé.
- Peer deps non-déclarées de `react-force-graph-3d` → `three-render-objects` ajoutées : `polished`, `accessor-fn`, `float-tooltip`, `kapsule` (vite/rolldown plus strict en v1.6.5).
- Bug du script `apply-upstream-patches.mjs` corrigé (chemin relatif `patches/...` → `../patches/...` quand cwd=upstream/, et clone full-history pour `git apply --3way` fonctionne).

Côté nous : ≥15 commits sur `deployment` qui contiennent tout le travail listé en partie B.

---

## Partie D — Pour un brainstorming futur

Quelques angles d'attaque possibles, qui croisent notre travail + upstream :

1. **Bump version** — passer de `v1.6.3` à `v1.6.5` ou `v1.6.6-rc.67`. Effort : ré-application des patches avec résolution des conflits (~211 à 275 commits de churn sur les fichiers qu'on touche).
2. **Upstreamer nos analytics** — les endpoints time-travel sont génériques, ils pourraient devenir des PRs upstream. Question licensing (PolyForm-Noncommercial vs notre usage interne).
3. **Tier 1 résiduel** — 1.2 et 1.3 cross-repo. Demande qu'on ait ≥ 3 repos indexés et un alignement temporel.
4. **Tier 2.1 — LLM cluster annotation** — gros levier ROI sur la lisibilité des graphes. MCP-driven, donc faisable sans changement de stack.
5. **Tier 2.4 — IDE extension** — multiplicateur quotidien si l'équipe utilise VSCode/Cursor.
6. **Consolidation** — au lieu d'empiler des features, passer une itération à durcir : tests, perf des endpoints, UX des panneaux.

---

*Fin de l'état des lieux. Prochaine revue conseillée : après bump version
upstream OU après livraison du Tier 1.2/1.3 OU 3 mois (2026-08-26),
selon ce qui arrive en premier.*
