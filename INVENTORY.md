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
| [start.bat](start.bat) / [start.ps1](start.ps1) | Launchers desktop-clickable (CMD pour bypass PS policy) |
| [stop.bat](stop.bat) / [stop.ps1](stop.ps1) | Stop gracieux |
| [reindex.ps1](reindex.ps1) | Re-analyze forcé d'un repo existant |
| [scripts/install-duckdb-extension.mjs](scripts/install-duckdb-extension.mjs) | Vendoré depuis `gitnexus@a418c47` |
| [scripts/patch-lbug-staleness.mjs](scripts/patch-lbug-staleness.mjs) | Patch runtime du bug stale-lbug-connection (adaptateur REST) |

**Pourquoi une image dérivée** : `:1.6.3` upstream ship avec 2 bugs connus dans son `Dockerfile.cli` (mkdir `hf-cache` sans `node:node` → EACCES, et oubli de `gitnexus/scripts/` → DuckDB FTS+VECTOR non installés). Notre layer fixe les deux.

### B.2 Time-travel + analytics
**Implémentation : patches sur upstream** (clone gitignoré, deltas sérialisés dans [patches/upstream-all.diff](patches/upstream-all.diff) — taille re-générée à chaque feature).

#### Endpoints backend (ajoutés à `docker-server.mjs`)
| Endpoint | Fonction |
|---|---|
| `POST /snapshot` + `GET /snapshots` | Snapshots manuels d'un repo à un commit donné |
| `POST /snapshot/bulk` + `GET /snapshot/bulk/:jobId` | Bulk N commits sur Y jours, SSE progress |
| `GET /api/graph` (étendu) | Diff visuel rouge/vert/gris entre 2 repos |
| `GET /churn` | Heatmap de volatilité des nodes sur la timeline |
| `GET /coupling` | Paires de fichiers qui changent ensemble (couplage temporel) |
| `GET /growth` | Counts par catégorie dans le temps |
| `GET /lifespan` | Buckets foundational / recent / discontinued / ephemeral |
| `GET /entropy` | Densité × modularité du graphe par snapshot |
| `GET /ownership` | Bus factor par fichier (`git log --name-only`) |
| `GET /dissonance` | Compare domaines déclarés (`.gitnexus-domains.json`) vs communities détectées, purity + misplaced |
| `GET /semantic-labels` + `POST` | Cache des labels LLM par community (LLM appelé côté frontend) |
| `GET /coupling/cross` | Couplage cross-repo via bucketing temporel sur `git log` multi-repo |
| `GET /growth/cross` | Timeline union des snapshots avec counts par-repo (migration des centres de gravité) |
| `GET /similarity` | Vecteur d'Identité (v1=5 dims, v2=10 dims via `?identityVersion=2` par défaut, opt-out `?identityVersion=1`) + cube 2×2×2 (structural × semantic × temporal) par paire, lit `.gitnexus.json > policy` (ou legacy `.gitnexus-policy.json`) + auto warnings (LICENSE / age / auteurs). Axe sémantique = dense cosine sur embedding centroids quand ≥80% des labels embeddés (Tier 2.5b.bis), sinon cosine BoW lexical (Tier 2.5b), sinon null (param `?lexicalSemantic=false` pour désactiver). Réponse inclut `galaxyXY[]` par repo (Tier 2.6, projection PCA 2D pure JS) + `repoId` + `normalizedRemote` (Tier 2bis.5). |
| `GET /repos/by-id/:repoId` | Résout un repoId stable (`sha256(firstCommitSha + normalizedRemote)[:16]`) vers un ou plusieurs `<base>` indexés. Tier 2bis.5. |
| `GET /entropy/commits` | Attribue à chaque commit dans la fenêtre sa part du delta entropy observé entre snapshots bracketants (poids = filesTouched). MVP par interpolation, pas de Leiden in-memory. Params: `?repo=&from=&to=&days=&format=csv`. Tier 2bis.2. |
| `GET /watches` | Liste les watches déclarées dans `.gitnexus.json > watches` à travers tous les repos + leur dernier état d'évaluation in-memory. Le cron interne (interval `WATCH_INTERVAL_MS`, debounce `WATCH_DEBOUNCE_MS`) évalue et fire les webhooks Slack-compatible. 5 métriques supportées : entropy.{density,modularity}, ownership.{busFactor,topAuthorShare}, dissonance.purity. Tier 2bis.3. |
| `GET /commit/footprint` | Files touched par un commit (status A/M/D) via `git show --name-status`. Params: `?repo=&sha=`. Permet l'overlay commit sur le graph côté frontend (highlight des nodes par `filePath` match). Honest : c'est le footprint, pas le graph reconstruit au commit. Tier 2bis.2 follow-up. |
| `POST /snapshot/auto` | Auto-snapshot des commits aux pics d'entropy (Phase A du chantier incremental-snapshots). Body : `{ topPercent, windowDays, debounceDays, minDelta, excludeMerges, metric, dryRun, maxToCreate }`. Toujours dryRun=true en premier (compute lourd). Cap hard `maxToCreate ≤ 5` (env `AUTO_SNAPSHOT_HARD_CAP`). Config par-repo via `.gitnexus.json > auto_snapshot`. |
| `POST /snapshot/from-pr` | PR-mode snapshot on-demand (Phase B). Params: `?repo=&base=&head=`, body `{ dryRun }`. Résout les 2 refs (branches/tags/SHAs/HEAD~N) via `git rev-parse`, snapshotte les 2 si pas déjà, retourne `{ base, head, diffUrl }` où diffUrl pointe vers la diff-visual UI existante. Degenerate case base==head géré avec warning. Agnostique de la forge (pas d'auth GitHub). |
| `POST /snapshot/incremental` | Per-commit incremental diff (Phase C PoC). Params: `?repo=&commit=`, body `{ filters, force, reuseDump }`. Re-use le machinery incremental natif gitnexus (patch `patch-incremental-dump.mjs` dumpe le subgraph avant write-back LBugDB). 6 filtres paramétrables + gzip/brotli, persiste `.gitnexus/incremental/<sha>.json.gz` avec `_meta` (filtres + stats). `reuseDump` re-filtre le dernier dump sans re-analyze (1ms). Benché : Standard = 40 KB/commit gzippé. Reste reconstruction `/api/graph?commit=` pour Phase C complète. |
| `POST /ghosts/sync` | Parse `<repo>/ROADMAP.md` via le builtin source + tous les ghost-sources enregistrés via `registerGhostSource()`, merge par id (builtin gagne), écrit `<repo>/roadmap.yml` (versionné) + `<repo>/.gitnexus/ghosts.json` (runtime latest). Réponse `{ synced: true, syncedAt, syncedCommit, ghosts: [...] }`. Idempotent — un second appel sans changement produit le même JSON. Tier 3.x foundation. |
| `GET /ghosts` | Renvoie le `ghosts.json` latest (404 si jamais sync). Chaque ghost porte `{ id, declared, plannedAt, materializedAt, cancelledAt, links, source }`. |
| `GET /ghosts/at` | Renvoie le `ghosts.json` historique d'un snapshot. Params: `?repo=&commit=<shortHash>` (key directory = `safeSnapshotKey(commit.shortHash)`). 404 si snapshot inconnu. Auto-écrit par chaque `createSnapshot` (4 entry points : `/snapshot`, `/snapshot/bulk`, `/snapshot/auto`, `/snapshot/from-pr`). |
| `GET /ghost-audit` | Audit roadmap (Tier roadmap-predictive Audit view, 2026-05-27). Agrège 6 métriques sur la base du `ghosts.json` latest : `summary` (totals + cancellationRate), `leadTime` (médian/p25/p75/max + distribution buckets), `slippage` (early/onTime/late/noTarget vs `expectedBy`), `planChurn` (top churners cross-snapshot), `velocity` (rolling 28j), `expired` (Update 1, alertLevel). 404 si `/ghosts/sync` jamais lancé. Cache disque mtime-invalidé sur `ghosts.json`. MCP tool `gitnexus_ghost_audit` (19ème). |
| `GET /listdir` | Folder browser server-side |
| `GET /export` + `POST /import` | Bundle ou index-only, register-only mode |
| `?format=csv` partout | Serializer partagé `docker-server-csv.mjs` |

#### Composants frontend (React/TS, dans `gitnexus-web/src/`)
- `Timeline.tsx` — slider + play/pause auto-animation + **Preload all snapshots** (bouton Download/Check, fetch parallel pool=3 du graphe de chaque snapshot, cache `useAppState.snapshotCacheRef` Map, switchRepo sert depuis le cache → frame swap instantané pendant le Play, sans LoadingOverlay entre frames)
- `EntropyBadge.tsx` — densité × trend, inline dans Timeline (auto-hide si <2 points)
- `OwnershipPanel.tsx` — header repo-level, filtre path/auteur, slider bus-factor, click-to-highlight
- `CouplingPanel.tsx`, `GrowthChart.tsx` (SVG natif), `LifespanPanel.tsx`
- `CouplingPanel` + `GrowthChart` ont un toggle interne **cross-repo** (Layers icon) → fetch `/coupling/cross` ou `/growth/cross`
- `DissonancePanel.tsx` — purity score + misplaced files + bouton ✨ pour générer les labels LLM
- `WhatIfPanel.tsx` — form rename/move/delete, file queue de mutations, preview qui réutilise le diff coloring
- `SimilarityPanel.tsx` — matrice N×N OU Galaxy view PCA 2D (toggle), drill-down par paire (scores/warnings/dominant features/policy/per-pair semantic mode badge `emb|lex`), table des identity vectors avec badge version + badges L/E par repo, bouton ✨ Embed labels (Tier 2.5a/b/b.bis/c/2.6). Galaxy view = SVG scatter avec edges proportionnels à la force moyenne du couplage, click-to-select-nearest-pair.
- `EntropyCommitTimeline.tsx` — sparkline SVG par-commit montée au-dessus de la Timeline (Tier 2bis.2 UI). Toggle "Commit Δ" dans Timeline, switch density/modularity, window input, click sur barre → drill-down avec copy-SHA + snippet git-show + bouton **Show on graph** qui fetch `/commit/footprint` et highlight les nodes touchés sur le graph courant (commit overlay, Tier 2bis.2 follow-up).
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
| [patches/README.md](patches/README.md) | Comment ré-appliquer les patches sur un clone frais |
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
