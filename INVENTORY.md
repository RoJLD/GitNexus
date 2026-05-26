# GitNexus — État des lieux

**Snapshot daté : 2026-05-26**
**Base upstream : `v1.6.3`** (commit `247b1bd5`, 2026-04-24)
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
| `GET /similarity` | Vecteur d'Identité 5-dim par repo + score structural × temporal par paire, lit `.gitnexus-policy.json` + auto warnings (LICENSE / age / auteurs) |
| `GET /listdir` | Folder browser server-side |
| `GET /export` + `POST /import` | Bundle ou index-only, register-only mode |
| `?format=csv` partout | Serializer partagé `docker-server-csv.mjs` |

#### Composants frontend (React/TS, dans `gitnexus-web/src/`)
- `Timeline.tsx` — slider + play/pause auto-animation
- `EntropyBadge.tsx` — densité × trend, inline dans Timeline (auto-hide si <2 points)
- `OwnershipPanel.tsx` — header repo-level, filtre path/auteur, slider bus-factor, click-to-highlight
- `CouplingPanel.tsx`, `GrowthChart.tsx` (SVG natif), `LifespanPanel.tsx`
- `CouplingPanel` + `GrowthChart` ont un toggle interne **cross-repo** (Layers icon) → fetch `/coupling/cross` ou `/growth/cross`
- `DissonancePanel.tsx` — purity score + misplaced files + bouton ✨ pour générer les labels LLM
- `WhatIfPanel.tsx` — form rename/move/delete, file queue de mutations, preview qui réutilise le diff coloring
- `SimilarityPanel.tsx` — matrice N×N color-coded par quadrant, drill-down par paire (scores/warnings/dominant features/policy), table des identity vectors (Tier 2.5a)
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

#### Dépendances ajoutées
- `react-force-graph-3d`, `three` (pour le mode 3D) — déclarées dans `gitnexus-web/package.json`

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
- ✅ 2.5a Cross-repo similarity v1 — plan structural × temporal (4 quadrants sur 8), identity vector 5-dim, policy JSON, warnings auto. v1.1 (axe sémantique LLM) + v1.2 (Galaxie UMAP) restent à faire.

**Pending — Tier 2bis (plate-forme, ~3 semaines cumulées, à livrer avant le reste)** :
- ⏳ 2bis.1 MCP exposure des analytics time-travel (3-5j)
- ⏳ 2bis.2 Commit-level entropy delta (1 semaine)
- ⏳ 2bis.3 Alerting continu (watch + webhook) (1-2 semaines)
- ⏳ 2bis.4 Unified `.gitnexus.yaml` (2-3j)
- ⏳ 2bis.5 Repo ID stable (3-5j)

**Pending — Tier 2 résiduel** :
- ⏳ 2.5b Cross-repo similarity — axe sémantique (cube 2×2×2 complet via embeddings client-side des labels LLM) — requiert un client embeddings dans `semantic-labeler.ts`
- ⏳ 2.5c Cross-repo similarity — Vecteur d'Identité v2 (entropie + growth_rate + churn_concentration + file_size_pareto + language_diversity + tree_depth)
- ⏳ 2.6 Galaxie UMAP / Carte de l'écosystème — séparée de 2.5, requiert 2.5c

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
| `v1.6.3` (notre base) | 2026-04-24 | 0 — point de départ |
| `v1.6.5` (dernier stable) | 2026-05-16 | **+211 commits** |
| `origin/main` HEAD | 2026-05-22 | **+275 commits** |
| `v1.6.6-rc.67` (RC en cours) | 2026-05-22+ | ≈ même |

> Note : "ahead/behind" git pur ne s'applique pas car les historiques sont sans ancêtre commun (notre branche `deployment` a 2 commits "snapshot", pas une vraie dérivation). Le chiffre ci-dessus est : "depuis le tag `v1.6.3` que nous avons pris comme base, combien de commits sont arrivés upstream".

Côté nous : **2 commits** sur `deployment` (initial + Tier 1) qui contiennent tout le travail listé en partie B.

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
