# GitNexus — Roadmap

État vivant des fonctionnalités déjà livrées et des prochaines pistes.
Dernière mise à jour : 2026-05-29 (Multi-repo unified graph livré (#65) — `GET /graph/merged?group=` fusionne les graphes per-repo au niveau fichier + arêtes cross-repo des contrats ; groupe synchronisé via `gitnexus group` (endpoints worker + `docker-server-group.mjs`) ; mode "Group graph" dans le canvas (`GroupGraphPanel` + `group-graph-adapter.ts`). **4/8 items enterprise couverts** (Code Wiki, Auto-reindexing, Regression forensics, Multi-repo support ✅). Avant : Regression forensics polish (#62) — coupling 6e métrique watchable/auto-forensiquable + "Locate regression" dans EntropyCommitTimeline. Aussi : Commit-level time-travel A+B+C COMPLET — mode Commits timeline (#60) + baseline auto-seed caché/promote (#61) + pré-chauffage des diffs (#63). Avant : "Auto" regression forensics (#59), Regression Phase 2 (#58), MVP (#57), Auto-reindexing (#56), Code Wiki UI (#55).).

> 📋 **Voir aussi** [INVENTORY.md](INVENTORY.md) — état des lieux complet :
> features upstream + nos ajouts + distance avec upstream. À utiliser
> comme base de brainstorming avant de décider du prochain Tier.

L'objectif global : transformer GitNexus en **outil d'archéologie + de
diagnostic structurel** pour un écosystème de dépôts, pas juste un
visualiseur de code. Chaque ligne ici décrit une promesse précise — pas
un nom marketing — et son premier pas concret.

---

## ✅ Déjà livré

| # | Feature | Endpoint(s) / Composant(s) |
|---|---|---|
| 1 | **Loading bars + UX path picker + folder browser server-side** | `/listdir` + `DropZone.LoadingCard`, `RepoAnalyzer` |
| 2 | **Export / Import (index-only + bundle)** + register-only mode | `/export`, `/import?registerOnly`, `BulkSnapshotModal` |
| 3 | **Diff visuel entre 2 repos** (rouge/vert/gris sur le graphe) | `/api/graph`, `graph-diff.ts`, `useSigma` reducer |
| 4 | **Stale-lbug-connection fix** côté serveur (patch upstream via [`scripts/patch-lbug-staleness.mjs`](scripts/patch-lbug-staleness.mjs)) | `Dockerfile.cli` |
| 5 | **Snapshots manuels** d'un repo à un commit donné | `/snapshot`, `/snapshots` |
| 6 | **Snapshots bulk** (N commits sur Y jours, SSE progress) | `/snapshot/bulk`, `BulkSnapshotModal` |
| 7 | **Timeline UI** (slider + play/pause auto-animation) | `Timeline.tsx` |
| 8 | **Churn heatmap** (volatilité des nodes sur le timeline) | `/churn`, `useSigma.churnColor` |
| 9 | **Coupling temporel** (paires de fichiers qui changent ensemble) | `/coupling`, `CouplingPanel.tsx` |
| 10 | **Growth chart** (counts par catégorie sur le temps, SVG natif) | `/growth`, `GrowthChart.tsx` |
| 11 | **Lifespan analysis** (foundational/recent/discontinued/ephemeral) | `/lifespan`, `LifespanPanel.tsx` |
| 12 | **Entropy / structural health badge** dans la Timeline (densité + trend) | `/entropy`, `EntropyBadge.tsx` |
| 13 | **CSV export** sur churn/coupling/growth/lifespan/entropy/ownership | `?format=csv` partout, `docker-server-csv.mjs` |
| 14 | **Ownership / bus factor** (per-file commit-share + repo-level summary) | `/ownership`, `OwnershipPanel.tsx` |
| 15 | **Dissonance** (declared domains vs detected communities, purity score, misplaced files) | `/dissonance`, `DissonancePanel.tsx`, `patches/example-gitnexus-domains.json` |
| 16 | **Semantic labels** (LLM-generated cluster names, cached on disk, integrated into Dissonance UI) | `/semantic-labels`, `semantic-labeler.ts` |
| 17 | **Cross-repo coupling** (git-log bucketing, multi-repo Jaccard) + UI toggle | `/coupling/cross`, `CouplingPanel` Layers toggle |
| 18 | **Cross-repo growth** (union timeline, per-repo step lines, label switcher) | `/growth/cross`, `GrowthChart` Layers toggle |
| 19 | **What-if simulator** (rename / move / delete symbolic mutations, preview via diff coloring) | `services/mutation-engine.ts`, `WhatIfPanel.tsx` |
| 20 | **VSCode extension v0.1** (status-bar bus factor for the active file) | `vscode-extension/` (separate package) |
| 21 | **Cross-repo similarity v1** (structural × temporal cube, 5-dim identity vector, `.gitnexus-policy.json`, auto warnings) — semantic axis pending v1.1 | `/similarity`, `SimilarityPanel.tsx`, `patches/example-gitnexus-policy.json` |
| 22 | **Cross-repo similarity v1.b** : axe sémantique lexical (cosine BoW sur labels LLM cachés) → cube 2×2×2 complet, partial-coverage handling | `/similarity?lexicalSemantic=…`, `SimilarityPanel` partial-coverage banner |
| 23 | **Cross-repo similarity v1.b.bis** : vrais embeddings (drop-in upgrade du lexical) — `createEmbeddingsModel` mirror `createChatModel`, button ✨ "Embed labels" dans SimilarityPanel, centroid cosine quand ≥80% des labels d'un repo sont embeddés | `core/llm/agent.ts` (`createEmbeddingsModel`), `services/semantic-labeler.ts` (`embedSemanticLabels`), `docker-server-semantic-labels.mjs` (schema embedding), `/similarity` (centroid priority) |
| 24 | **Cross-repo similarity v1.c** : Identity Vector v2 (10 dims = v1 + `growthRate`, `churnConcentration`, `fileSizePareto`, `languageDiversity`, `treeDepth`), opt-out via `?identityVersion=1` | `/similarity?identityVersion=…`, badge "v2 · 10 dims" dans le panel |
| 25 | **Galaxy view (Tier 2.6)** : projection 2D PCA des identity vectors (SVG scatter avec edges pour les paires fortes, click-to-select-nearest-pair). Power-iteration pure JS, zéro dep | `/similarity` (`galaxyXY[]`, `galaxyProjection`), `SimilarityPanel` `<GalaxyView>` + toggle Matrix/Galaxy |
| 26 | **Galaxy UMAP (Tier 2.6.bis)** : toggle PCA/UMAP dans le panel, calcul client-side (dynamic import de `umap-js` → out-of-bundle pour les users qui n'ouvrent jamais la galaxy), seed mulberry32 keyé sur le repo-set pour stabilité, nNeighbors adaptatif | dep `umap-js@^1.4.0` ajoutée, GalaxyView `setMethod('pca' \| 'umap')` |
| 27 | **MCP analytics sidecar (Tier 2bis.1)** : serveur stdio JSON-RPC 2.0 pure Node zéro-dep, 13 tools wrappant les endpoints REST (`list_repos`, `entropy`, `churn`, `coupling`, `growth`, `lifespan`, `ownership`, `dissonance`, `semantic_labels`, `coupling_cross`, `growth_cross`, `similarity`, `repo_by_id`). Sibling de `npx gitnexus mcp` upstream. Smoke 6/6 ✓ contre la stack live | `mcp-server/server.mjs`, `mcp-server/README.md`, `mcp-server/smoke.mjs` |
| 28 | **Unified `.gitnexus.json` config (Tier 2bis.4)** : un seul fichier par repo avec sections `domains` / `policy` / `budgets` (réservé 3.6) / `watches` (réservé 2bis.3). Backward-compat sur `.gitnexus-domains.json` + `.gitnexus-policy.json` avec deprecation warning stderr. JSON (pas YAML) par cohérence avec le reste du codebase | `upstream/docker-server-config.mjs`, `patches/example-gitnexus.json` (+ legacy files marqués DEPRECATED) |
| 29 | **Stable repoId (Tier 2bis.5)** : identifiant 16 hex chars = `sha256(firstCommitSha + normalizedRemote)[:16]`. Cache `<repoPath>/.gitnexus/repo-id.json`. Surface dans `/similarity` (`response.repos[].repoId` + `normalizedRemote`) et résoluble via `GET /repos/by-id/:repoId`. Survit aux re-clones et débloque la détection FN-2 de 2.5 (legacy + rewrite) | `upstream/docker-server-repo-id.mjs`, route `/repos/by-id/:repoId`, MCP tool `gitnexus_repo_by_id` |
| 30 | **Commit-level entropy delta (Tier 2bis.2)** : `GET /entropy/commits?repo=<base>&days=N` (ou `from/to` = SHA ou ISO date) attribue à chaque commit sa part du delta entropy observé entre snapshots bracketants (proportionnel à filesTouched). MVP par interpolation, pas de Leiden in-memory — assume des snapshots suffisamment denses. Stragglers (commits hors fenêtre snapshot) retournés avec `attributedDensityDelta: null` | `/entropy/commits`, MCP tool `gitnexus_entropy_commits` |
| 31 | **Watches + webhooks (Tier 2bis.3 MVP)** : cron interne toutes les `WATCH_INTERVAL_MS` (5 min default), debounce `WATCH_DEBOUNCE_MS` (1h default), POST webhook Slack-compatible quand seuil franchi. Watches déclarées dans `.gitnexus.json > watches` (déjà parsées par 2bis.4). 5 métriques supportées : entropy.{density,modularity}, ownership.{busFactor,topAuthorShare}, dissonance.purity. `GET /watches` liste les watches + leur dernier état | `/watches`, MCP tool `gitnexus_watches` |
| 32 | **Commit Δ sparkline frontend (Tier 2bis.2 UI)** : `EntropyCommitTimeline.tsx` au-dessus de la Timeline. Toggle Commit Δ dans la Timeline. SVG sparkline avec bars verticaux (rouge = dégradation / vert = amélioration / gris = straggler), boundaries snapshot marquées en dashed amber, drill-down par commit (sha + author + date + filesTouched + window deltas + copy-SHA + git-show snippet). Switch metric density/modularity. Window input | `components/EntropyCommitTimeline.tsx`, Timeline toggle Activity icon |
| 33 | **Snapshot preload (Play smoothness)** : bouton Preload dans la Timeline, fetch parallel pool=3 de tous les snapshots du base repo en mémoire, switchRepo sert depuis le cache → frame swap instantané (pas de LoadingOverlay entre frames du Play loop). Badge "N/M" cached + bouton clear + cancel-able. Invalidation auto au switch de base repo | `useAppState` cache Map + actions, `Timeline` Preload button |
| 34 | **Commit overlay (Tier 2bis.2 follow-up)** : `GET /commit/footprint?repo=&sha=` retourne files touched + status (A/M/D) via `git show --name-status`. Bouton "Show on graph" dans le drill-down de EntropyCommitTimeline → résout files → node IDs (par `filePath` match dans le graph chargé) → `setHighlightedNodeIds`. Banner partial-match si fichiers non-résolus (deletions, renames, configs non-tracked). MCP tool `gitnexus_commit_footprint`. **Honest framing** : ce n'est PAS le graph reconstruit au commit, c'est le footprint highlighté sur le snapshot le plus proche. Pour le vrai per-commit graph → snapshot incremental (chantier suivant) | `/commit/footprint`, MCP tool, `EntropyCommitTimeline` Show/Hide button |
| 35 | **Auto-snapshot aux pics — Phase A** : `POST /snapshot/auto?repo=` qui (1) attribue les deltas entropy par commit (réutilise l'algo de /entropy/commits), (2) garde top-P% par \|Δ\|, (3) filtre merges + minDelta + debounce, (4) cap maxToCreate ≤ 5 (HARD_CAP env-overrideable), (5) `dryRun: true` retourne le plan, (6) sinon createSnapshot séquentiel. Surface config `.gitnexus.json > auto_snapshot`. MCP tool `gitnexus_snapshot_auto` (17 tools). Live test : 1 snapshot créé end-to-end en 55s sur hmm_studio | `/snapshot/auto`, `upstream/docker-server-snapshot-auto.mjs`, parser config étendu |
| 36 | **PR-mode snapshot on-demand — Phase B** : `POST /snapshot/from-pr?repo=&base=&head=` qui résout 2 refs (branches/tags/SHAs/HEAD~N), snapshotte les 2 si pas déjà, retourne `{ base, head, diffUrl }`. Pas de GitHub API — refs génériques, agnostique de la forge. `dryRun: true` valide les refs sans payer le coût. Degenerate case (base==head) géré avec `warning`. MCP tool `gitnexus_snapshot_from_pr` (18 tools) | `/snapshot/from-pr`, `upstream/docker-server-snapshot-from-pr.mjs` |
| 37 | **Roadmap-predictive CORE (Tier 3.x foundation)** : parser `ROADMAP.md` → `ghosts.json` sidecars (table rows "Déjà livré" + Tier sections détectés, status `materialized` ✅ / `cancelled` 🗑️ / `planned` / `expired`). 3 endpoints (`POST /ghosts/sync`, `GET /ghosts`, `GET /ghosts/at`), auto-sync à chaque snapshot (4 entry points). Plugin-aware registry `registerGhostSource()` (builtin `roadmap-md` toujours présent, externes mergent par id avec builtin-wins). YAML serializer déterministe. `expectedBy` warning-on-missing (durcissement Update review externe). CLI wrapper `scripts/sync-ghosts.mjs` | `/ghosts`, `/ghosts/sync`, `/ghosts/at`, `upstream/docker-server-ghosts-core.mjs`, `upstream/docker-server-ghosts.mjs`, `scripts/sync-ghosts.mjs` |
| 38 | **Roadmap predictive — Audit view** : 6 métriques agrégées (summary, lead time, slippage vs expectedBy, plan churn cross-snapshot, velocity 28j, expired). `GET /ghost-audit?repo=` + cache disque mtime-invalidé + MCP tool `gitnexus_ghost_audit` (19ème) + `AuditPanel.tsx` avec 6 sous-composants (summary cards, histogram, slippage bar, sparkline, churn list, ghost table). Update 2 placementAccuracy deferred — nécessite Leiden communities backend non disponibles aujourd'hui. | `/ghost-audit`, `upstream/docker-server-ghost-audit-core.mjs`, `upstream/docker-server-ghost-audit.mjs`, `upstream/gitnexus-web/src/components/AuditPanel.tsx` + `audit/*` |
| 39 | **Roadmap predictive — Augmented graph** : toggle "Show ghosts" dans Filters (FileTreePanel), ghosts planifiés/expired affichés sur le graph Sigma (anchored à leurs `expectedLinks` matchés, satellite cluster top-right pour les unmatched). Encodage par Tier + opacité time-decaying (4 alertLevels : fresh ≥0.5 / mature 0.4 / late 0.3 orange / critical 0.2 rouge). Popup au click avec matched/unmatched + button "Open in ROADMAP.md". Pure frontend, zéro backend modifié. Sigma 3 NodeCircleProgram + canvas dashed outline (pragmatic v1, no new sigma dep). | `upstream/gitnexus-web/src/lib/ghost-layout.ts`, `upstream/gitnexus-web/src/services/ghosts-client.ts`, `upstream/gitnexus-web/src/lib/ghost-node-program.ts`, `upstream/gitnexus-web/src/components/{GhostTooltip,GhostFiltersSection,GraphCanvas,FileTreePanel}.tsx`, `upstream/gitnexus-web/src/hooks/{useSigma,useAppState}.tsx` |
| 40 | **Roadmap predictive — Cleanup + Multi-tool connectors** : (a) `POST /ghosts/cleanup-prompt?repo=` retourne les ghosts expirés (computeExpired) + un prompt LLM pré-construit par ghost (title, description, expectedBy, expectedLinks, matched nodes, recent commits). (b) Connector framework `connectors/` avec Plane primary (full Plane REST API impl), Linear/GitHub/Jira stubs (fail gracefully). `GET /ghosts/connector-suggestions?repo=` lit `.gitnexus.json > connectors.*`, fetch open + closed tickets, fuzzy-matche par Jaccard sur titre+description, retourne suggestions reaffirm/cancel. `CleanupModal.tsx` ouvert via 6ème card "Expired" de AuditSummary. LLM call : v1 le frontend copie le prompt (auto-call follow-up). | `/ghosts/cleanup-prompt`, `/ghosts/connector-suggestions`, `upstream/docker-server-ghost-cleanup-core.mjs`, `upstream/docker-server-ghost-cleanup.mjs`, `upstream/docker-server-connectors-core.mjs`, `upstream/docker-server-connectors.mjs`, `upstream/connectors/{plane,linear,github,jira}.mjs`, `upstream/gitnexus-web/src/components/audit/CleanupModal.tsx` |
| 41 | **Incremental snapshots — Phase C PoC** : `POST /snapshot/incremental?repo=&commit=` génère un diff per-commit en re-utilisant le machinery incremental natif de gitnexus (patch `patch-incremental-dump.mjs` dumpe le subgraph avant write-back LBugDB). 6 filtres paramétrables (dropGlobalNodes / dropEmptyFields / filterRelationships / includeLabels / includeRelationshipTypes / maxNodes / compress) + flag `reuseDump` (re-filtre sans re-analyze, 1ms). Benché 10 commits × 6 combos : **default Standard = 40 KB/commit gzippé (39 MB/1000 commits)**, gzip = levier dominant (17×). | `/snapshot/incremental`, `upstream/docker-server-snapshot-incremental.mjs`, `scripts/patch-incremental-dump.mjs`, `scripts/poc-incremental-bench.mjs`, `Dockerfile.cli` |
| 42 | **Roadmap predictive — Gantt opérationnel** : vue calendaire des ghosts (1 row par ghost, axe X = temps, 4 styles de bar : solid matérialisé / dashed planifié futur / dot planifié sans deadline / grey annulé). Couleur par Tier + **time-decaying color** sur les dashed (Update 1 : `late` → orange #e67e22, `critical` → rouge #c0392b). Toggle swimlanes (flat vs groupé par Tier major). Filtres via prop `ghostFilters` (réutilise `passesFilter` + `DEFAULT_GHOST_FILTERS` d'Augmented). Sort plannedAsc/tierAsc/status. Export CSV client-side. Pure frontend, zéro backend. | `upstream/gitnexus-web/src/lib/gantt-layout.ts`, `upstream/gitnexus-web/src/components/{GanttPanel,gantt/GanttAxis,gantt/GanttBar,gantt/GanttRow}.tsx` |
| 43 | **Roadmap predictive — Brainstorm-hook** : script `scripts/ghost-from-spec.mjs` qui parse un spec markdown (extrait id depuis filename, title H1, description, tier regex, expectedLinks heuristique paths) puis upsert un row dans la section managée `## 🧪 From spec brainstorms` de ROADMAP.md (markers `<!-- specs:start --> ... <!-- specs:end -->`). Idempotent. CORE parser étendu pour reconnaître cette section comme source de ghosts `planned`. Wizard `scripts/install-brainstorm-hooks.mjs` configure 3 triggers convergents (Claude PostToolUse / git post-commit / GitHub Actions). npm scripts `ghost:from-spec` + `setup:hooks`. | `scripts/ghost-from-spec.mjs`, `scripts/ghost-from-spec-parser.mjs`, `scripts/ghost-from-spec-roadmap.mjs`, `scripts/install-brainstorm-hooks.mjs`, `upstream/docker-server-ghosts-core.mjs` |
| 44 | **Roadmap predictive — SysML export** (bonus) : `GET /sysml-export?repo=&format=plantuml|mermaid&tier=N` retourne le graph augmenté en PlantUML SysML 1.7 ou Mermaid (fallback). Mapping : File → block, Ghost planned/expired → requirement, ghost.links → <<satisfy>>, dependsOn → <<deriveReqt>>, Tier sections → packages. v1 ne consomme PAS le graph gitnexus complet (juste les fichiers que les ghosts satisfont) pour éviter l'explosion combinatoire. Importable dans Capella / Cameo / VSCode PlantUML extension. | `/sysml-export`, `upstream/docker-server-sysml-export-core.mjs`, `upstream/docker-server-sysml-export.mjs` |
| 45 | **Incremental snapshots — Phase C reconstruction** : `GET /graph/at-commit?repo=&commit=[&lazy=true]` reconstruit le graph à n'importe quel commit = baseline snapshot ancêtre le plus proche + replay des diffs per-commit (delete writeSet files → insert subgraph → prune dangling rels). 409 + liste si diffs manquants, `?lazy=true` les génère à la volée. **Fidelity validée : 4387/4387 nodes structurels exacts** (label par label) vs full snapshot, même avec chaîne à filtres mixtes ; seuls les globaux Community/Process restent baseline-stale (design, cf §2.2). Reconstruction 4-commit en 1.8s. Identity case (chain=0) = baseline exact. | `/graph/at-commit`, `handleGraphAtCommitRoute` + `applyDiff` + `findNearestBaseline` dans `upstream/docker-server-snapshot-incremental.mjs` |
| 46 | **Incremental snapshots — Phase C frontend (Rebuild @ commit)** : bouton **Rebuild @ commit** dans le drill-down de `EntropyCommitTimeline` (à côté de "Show on graph"). Fetch `/graph/at-commit`, swap le `KnowledgeGraph` complet sur le canvas (vs footprint = highlight overlay), préserve le graph live pour le restore. Banner violet "Reconstructed graph @ <sha>" avec counts + baseline distance + warning "mixed filters", bouton **Back to live**. 409 → strip ambre "N diff(s) missing" + bouton **Generate & retry** (relance avec `?lazy=true`). | `useAppState` (`loadGraphAtCommit`/`exitGraphAtCommit` + état `atCommit*`), `components/EntropyCommitTimeline.tsx` (bouton History + banners) |
| 47 | **Timeline zoom + 2 cursors A/B (Phase 1 sur 2)** : drag cursors blue/orange directement sur la Timeline (auto-swap A≤B), bouton "Zoom to window" qui stretche [A,B] sur la largeur complète + mini-map collapsible (visible quand zoomed, état persisté localStorage), indicateur de durée adaptatif "[A]→[B] · Δ X (hours/days/years) · N snapshots", bouton "Compare A↔B" qui toggle graphMode (état mutuellement exclusif avec cross-repo diffMode), raccourcis clavier Z (zoom) + Shift+D (compare). `diffBetweenSnapshots` alias dans graph-diff.ts. **Task 11 (wiring du diff visuel intra-repo en App.tsx + useSigma) reste DEFERRED** — graphMode='diff' set l'état mais le canvas ne reflète pas encore (follow-up). Phase 2 — filtre temporel du graphe à la fenêtre — parquée out-of-scope. | `Timeline.tsx`, `lib/timeline-zoom.ts`, `lib/graph-diff.ts::diffBetweenSnapshots`, state cursorA/B/zoomWindow/graphMode dans `useAppState.tsx` |
| 48 | **Roadmap predictive — Ghost Cluster** (granularité intermédiaire) : convention markdown `## 🔗 Clusters` dans ROADMAP.md + auto-derivation Union-Find sur dependsOn[] connected components (≥ 2 ghosts). 4 surfaces UI : Augmented halo SVG overlay (convex hull) + Gantt swimlanes 3-state mode + Audit ClustersCard 7ème + Filters 3 toggles hiérarchiques. Sidecar `.gitnexus/clusters.json` + roadmap.yml clusters: section reflection. `GET /clusters?repo=&source=declared|auto` + MCP tool `gitnexus_clusters` (20ème). Status synthétisé (shipped/planned/cancelled/expired) avec declaredStatus override. | `/clusters`, `upstream/docker-server-ghosts-core.mjs` (parseClusters, deriveAutoClusters, computeClusterStatus), `upstream/docker-server-cluster-audit.mjs`, `upstream/gitnexus-web/src/lib/cluster-layout.ts`, `upstream/gitnexus-web/src/services/clusters-client.ts`, `upstream/gitnexus-web/src/components/{ClusterTooltip,GraphCanvas,GanttPanel,GhostFiltersSection,audit/ClustersCard,audit/ClusterDrillModal,audit/AuditSummary,AuditPanel}.tsx`, `upstream/gitnexus-web/src/hooks/{useSigma,useAppState}.tsx` |
| 49 | **Roadmap predictive — Augmented Timeline** : Timeline existante devient **ghost-time-aware**. Cursor < HEAD → ghosts au snapshot le plus proche (closest-prior). 3 activation triggers : (1) auto-detect (default, cursor < HEAD - 60s ⇒ time-aware), (2) Lock toggle Filters "Lock ghosts to today's view", (3) Animate roadmap button Timeline (auto-cursor earliest + auto-play + ghost overlay). Cross-fade 200ms via `useSigma.opacityOverride` + rAF loop quand un ghost matérialise pendant Play. Pure frontend, snapshot ghosts cache parallel pool (50 max, TTL 30s). 0 endpoint serveur (réutilise `/ghosts/at` du CORE). | `upstream/gitnexus-web/src/lib/augmented-timeline.ts`, `upstream/gitnexus-web/src/services/snapshot-ghosts-cache.ts`, `upstream/gitnexus-web/src/components/{Timeline,GraphCanvas,GhostFiltersSection,FileTreePanel}.tsx`, `upstream/gitnexus-web/src/hooks/{useSigma,useAppState}.tsx` |
| 50 | **Timeline Temporal Filter (3 modes : Strict / Normal / Permissive)** — Phase 2 Item #1 sur 5. Dropdown <select> à côté de "Compare A↔B" qui filtre les nodes du graphe à la fenêtre [A, B]. 3 modes : Strict (A ∩ B), Normal (A ∪ B), Permissive (union de tous les snapshots dans [A,B] — capture les éphémères, via backend `/nodes/alive-between`). Off par défaut + persisté en localStorage. Cumulable avec graphMode='diff' : filter = quel set, diff = coloring de ce set. | `/nodes/alive-between`, `lib/temporal-filter.ts`, dropdown dans `Timeline.tsx`, state `temporalFilterMode` + setter + effect watcher dans `useAppState`, hide-mask dans `useSigma.ts` node reducer |
| 51 | **Lanceur Elysium (splash, opt-in)** : intégration du lanceur-splash Windows Elysium (repo séparé `VScode/Elysium`, .NET WPF compilé) comme option de démarrage de gitnexus. `start.ps1 -Elysium` émet des marqueurs `[ELYSIUM] k/7` par phase + supprime ses `Read-Host` et l'ouverture du navigateur (le splash possède le cycle de vie) ; `elysium.json` déclare la commande + `successUrl` ; `start-elysium.bat` lance le splash. `start.bat` console **reste le défaut** (zéro régression). | `start.ps1` (`-Elysium`), `elysium.json`, `start-elysium.bat` |
| 52 | **Lifespan Windowed (cursors A/B as bounds)** — Phase 2 Item #3 sur 5. Quand `temporalFilterMode !== 'off'` (Item #1), `/lifespan` recompute les 4 buckets (foundational/recent/discontinued/ephemeral) sur la fenêtre [cursorA, cursorB]. Backend : extension du `/lifespan?repo=&from=&to=` existant (backward-compat — sans params, global inchangé). Ephemeral fenêtré réutilise `/nodes/alive-between` machinery (filterSnapshotsInWindow + unionSnapshotNodeIds). UX : header "Lifespan (window)" + badge daterange compact quand `data.windowed` présent dans la réponse. Item #2 (Mode union) subsumed by Item #1 Permissive mode. | `/lifespan?from=&to=`, `docker-server-lifespan-windowed-core.mjs` (pure fn `computeWindowedBuckets`), branchement dans `useAppState` effect, header + badge dans `LifespanPanel.tsx` |
| 53 | **Timeline URL Persistence (shareable view links)** — Phase 2 Item #5 sur 5. Persiste tout l'état Timeline (cursorA/B, zoom, graphMode, temporalFilterMode) dans 5 query params préfixés `tl` (tlA/tlB/tlZoom/tlMode/tlFilter), shortHash-based (stable across re-index, `live` alias pour le head). Read one-shot guardé attendant snapshots ; write `replaceState` sur changement. Zoom restauré en différé (pendingZoom ref) une fois les cursors flushés. Lien partageable + résistance F5. Pure frontend, aucun endpoint. | `lib/timeline-url.ts` (serializeTimelineToParams + parseTimelineParams), `hooks/useTimelineUrlSync.ts`, mount dans `App.tsx` (`AppContent`) |
| 54 | **Timeline Wheel Zoom (mousewheel)** — Phase 2 Item #4 sur 5 (**dernier item Phase 2**). Zoom continu à la molette sur la Timeline, ancré sur la souris (A/B convergent autour du point pointé), auto enter/exit (scroll-in entre en zoom, scroll-out complet sort), continu avec snap aux snapshots au repos (debounce ~200ms). Couplé aux curseurs : la molette pilote `[cursorA,cursorB]` → persistance URL gratuite via `tlA/tlB/tlZoom` (Item #5). Pure fn `applyWheelZoom` + état transitoire `wheelWindow` + commit-on-settle ; `enterZoom` accepte des bornes explicites (fix stale-closure). Bouton "Zoom to window" + `Z` conservés. Pure frontend, aucun endpoint. | `lib/timeline-zoom.ts::applyWheelZoom`, listener `wheel` non-passif + `wheelWindow` dans `Timeline.tsx`, `enterZoom(a?,b?)` dans `useAppState` |
| 55 | **Code Wiki dans l'UI web + auto-update** (enterprise parity) : panel iframe affichant le wiki upstream généré (`.gitnexus/wiki/index.html`), bouton Regenerate + auto-régen sur intervalle configurable (`.gitnexus.json > wiki.autoEvery`, défaut off) via le cron watches. `wiki-worker.mjs` (conteneur `gitnexus`, 2e process via wrapper CMD) spawn la CLI publique `gitnexus wiki` headless (clé LLM en env serveur). Conteneur web sert l'HTML (volume partagé) + proxy generate/status. Couvre l'item enterprise "Auto-updating Code Wiki" (était 🟡 CLI-only upstream). | `wiki-worker.mjs` (racine), `Dockerfile.cli` (wrapper), `upstream/docker-server-wiki.mjs` (`/wiki`, `/wiki/generate`, `/wiki/status`), `WikiPanel.tsx`, `lib/wiki-schedule.ts`, `docker-server-config.mjs` (wiki.autoEvery), cron dans `docker-server-watches.mjs` |
| 56 | **Auto-reindexing du graphe de code** (enterprise parity) : le cron watches détecte un changement de HEAD SHA par repo (`git rev-parse`) et déclenche une ré-analyse **incrémentale** (`POST /api/analyze` sans `force`). Opt-in par repo (`.gitnexus.json > auto_reindex.onCommit`, défaut off). Sidecar `.gitnexus/_auto-reindex.json` (écriture optimiste ; first-sight = baseline sans trigger). `GET /auto-reindex` expose l'état par repo (enabled/headSha/lastIndexedSha/dueNow). Tout dans le conteneur web (git + /api/analyze déjà dispos) — zéro worker, zéro changement Dockerfile.cli. | `upstream/docker-server-auto-reindex.mjs` (`shouldReindex`, `maybeReindexRepo`, `GET /auto-reindex`), cron dans `docker-server-watches.mjs`, `auto_reindex` dans `docker-server-config.mjs` |
| 57 | **Regression Forensics MVP — Phase 1 (entropy)** (enterprise parity, partiel) : `GET /regression?repo=&metric=density\|modularity&from=&to=` localise la régression (chute adverse la plus raide + delta net), classe le commit coupable (réutilise `/entropy/commits`), joint les fichiers impliqués (`/commit/footprint`). Skeleton générique (METRIC_REGISTRY + locateRegression + rankCulprits, purs + 10 tests) prêt pour Phase 2 (ownership/dissonance/coupling sur le même skeleton). Endpoint + MCP tool `gitnexus_regression` (21e), on-demand. Convention worseDirection alignée sur `EntropyCommitTimeline` (density up = pire, modularity down = pire). | `upstream/docker-server-regression-core.mjs`, `upstream/docker-server-regression.mjs` (`GET /regression`), MCP tool `gitnexus_regression` |
| 58 | **Regression Forensics Phase 2 (ownership + dissonance + coupling)** : `/regression` couvre désormais **6 scalaires** (entropy density/modularity + `ownership.busFactor`/`ownership.topAuthorShare` + `dissonance.purity` + `coupling`). Skeleton généralisé : `METRIC_REGISTRY` gagne un tag `series` + un mode `attribution` ; `rankSuspects` (pur). Séries par snapshot : `/ownership?until=<iso>` (git-log borné), `/coupling?asOf=<iso>` (timeline tronquée) + scalaire dérivé `pairsAboveThreshold@0.5`, `/dissonance` snapshot-aware (Cypher sur le graphe du snapshot, best-effort). Attribution `window-suspects` (commits de la fenêtre par filesTouched) pour les nouvelles métriques — fidélité étiquetée `attribution:'suspects'` vs `'attributed'` (entropy). Foundation partagée `docker-server-git-utils.mjs` (DRY refactor d'entropy-commits). | `docker-server-git-utils.mjs`, `docker-server-regression-core.mjs` (`rankSuspects`), `docker-server-regression.mjs` (`getSeries`), params `/ownership?until=` + `/coupling?asOf=`(+`pairsAboveThreshold`) + `/dissonance` snapshot |
| 59 | **"Auto" regression forensics (watch → culprit)** : quand un watch (Tier 2bis.3) franchit son seuil et fire, le webhook est enrichi avec le verdict `/regression` complet (commit coupable + fichiers) + une ligne coupable dans le texte Slack ; `GET /watches` expose `state.lastCulprit`. Best-effort (le webhook fire même si `/regression` échoue/timeout) — appel au fire-time seulement (après debounce). Mapping `entropy.density→density` etc. **Complète l'item enterprise "Auto regression forensics"** (on-demand Tiers 57-58 + auto ici). Coupling non couvert (pas d'évaluateur watch). Pure helpers `mapWatchToRegressionMetric`/`buildWebhookPayload` testés. | `docker-server-watches.mjs` (`mapWatchToRegressionMetric`, `buildWebhookPayload`, `fetchRegressionVerdict`, enrichissement fire-time, `lastCulprit`) |
| 60 | **Commit-level time-travel — mode Commits timeline (pièce A)** : toggle Snapshots⇄Commits sur la timeline principale ; chaque commit devient un point, clic → reconstruction in-memory via `/graph/at-commit` (pas de download full / fenêtre overlay). Endpoint léger `GET /commits` (git log, pas d'analyze, newest-first capé). Fallback lazy sur diffs manquants. Spec `2026-05-28-commit-level-time-travel-design.md` §3.2. | `upstream/docker-server-commits.mjs` (`GET /commits`), toggle + commit-dots + strip dans `Timeline.tsx` (réutilise `loadGraphAtCommit`) |
| 61 | **Commit-level time-travel — baseline auto-seed caché + promote (pièce B)** : quand aucun jalon n'est ancêtre (`/graph/at-commit` → `needsBaseline:true`), `POST /snapshot/baseline-seed` lance un analyze complet en arrière-plan (statut pollable `GET .../:jobId`) et marque le snapshot `.hidden` (exclu de `/snapshots` sauf `?includeHidden=true` ; champ `hidden`) ; `POST /snapshot/promote` le révèle en jalon. `findNearestBaseline` voit toujours les cachés. UI : bouton "Seed baseline" + chip dans `Timeline.tsx`, sous-section "Internal baselines" + Promote dans `SnapshotsPanel.tsx`. Spec §3.3 (+ Update 2026-05-29). Reste pièce C (pré-chauffage des diffs). | `upstream/docker-server-baseline-seed.mjs`, `.hidden` marker + `hiddenMarkerPath`/`includeHidden` dans `docker-server-snapshots.mjs`, `needsBaseline` dans `docker-server-snapshot-incremental.mjs`, `atCommitNeedsBaseline`/`seedBaseline` dans `useAppState`, `Timeline.tsx`, `SnapshotsPanel.tsx` |
| 62 | **Regression forensics polish (coupling watch + UI highlight)** : (A) évaluateur watch `coupling` (`/coupling` → `pairsAboveThreshold`) + `coupling→coupling` dans le mapping auto-forensics ⇒ coupling devient la **6e métrique watchable ET auto-forensiquable**. (B) bouton "Locate regression" dans `EntropyCommitTimeline` : appelle `/regression` pour la métrique entropy active, bannière coupable + ring de la barre du commit fautif (amber, précédence sur le ring "selected") + clic → drill-down existant. Entropy-scoped, state local. **Caveat perf** : le *watch* coupling fire vite (1 appel `/coupling`), mais l'*enrichissement* auto-forensics coupling (`/regression?metric=coupling` ≈ 50s sur repo à nombreux snapshots — N coupling tronqués) dépasse souvent `WATCH_TIMEOUT_MS` (30s) ⇒ le webhook fire quand même mais sans le coupable coupling (best-effort). Optim future : cache de la série coupling. | `docker-server-watches.mjs` (évaluateur coupling + mapping), `EntropyCommitTimeline.tsx` (bouton + bannière + ring) |
| 63 | **Commit-level time-travel — pré-chauffage des diffs (pièce C)** : rend la nav par-commit fluide (pas de génération lazy ~50s au 1er clic) en pré-générant les diffs incrémentaux manquants en fond. **On-push** : la cron `watches` appelle `maybePrewarmRepo` par repo (opt-in `.gitnexus.json > incremental.preWarm` + `preWarmCommits` défaut 50), cap `PREWARM_PER_TICK` (5) par passage + garde anti-overlap. **On-era** : `POST /snapshot/prewarm?repo=&max=` (202 `{queued}`, fire-and-forget) déclenché par `Timeline.tsx` à l'entrée du mode Commits ; `GET /snapshot/prewarm` → `{total,warm,cold}`. Même cache `.gitnexus/incremental/<sha>.json.gz` que `/graph/at-commit`. **Clôt le chantier commit-level time-travel (A+B+C).** Spec §3.4 (+ Update 2026-05-29). | `upstream/docker-server-prewarm.mjs` (`maybePrewarmRepo`, `POST/GET /snapshot/prewarm`), `incremental` dans `docker-server-config.mjs`, hook cron dans `docker-server-watches.mjs`, fire on-era dans `Timeline.tsx` |
| 64 | **Paydown dette divergence upstream (Phase 1)** : scission du diff monolithique en deux artefacts — `patches/additive-files.diff` (~99 fichiers neufs, risque de conflit nul) et `patches/inplace-edits.diff` (17 édits in-place, vraie surface de conflit) ; shim additif `upstream/docker-server-routes.mjs` (`registerGitnexusRoutes` + `startGitnexusCron`) qui sort le câblage de routes de `docker-server.mjs` ; outil de bump `scripts/bump-upstream.mjs` (dry-run : clone cible, applique les deux diffs, écrit `patches/bump-dry-run-<target>.md`). Premier dry-run contre `main` : 107 clean / 0 conflict / 9 fail. La décision sur le format de cohabitation (diff plat vs subtree/submodule) est différée à la phase 2. Spec : [`docs/superpowers/specs/2026-05-29-upstream-divergence-paydown-design.md`](docs/superpowers/specs/2026-05-29-upstream-divergence-paydown-design.md). | `patches/additive-files.diff`, `patches/inplace-edits.diff`, `upstream/docker-server-routes.mjs`, `scripts/bump-upstream.mjs`, `patches/bump-dry-run-main.md` |
| 65 | **Multi-repo unified graph** (item enterprise "Multi-repo support") : graphe Sigma unique fusionnant plusieurs repos. Un *groupe* nommé est synchronisé via la CLI `gitnexus group create/add/sync` dans le conteneur serveur (endpoints worker `POST /group/sync` + `GET /group/status` ajoutés à `wiki-worker.mjs`, registry name == groupPath pour que `crossLink.repo` matche le nom indexé). `GET /graph/merged?group=` fusionne les graphes per-repo **au niveau fichier** (nodes `<repo>::<file>`, symboles repliés sur leur fichier, arêtes intra roulées-up + dédupliquées, self-loops drop) + ajoute les arêtes **cross-repo** des contrats (`crossLinks` joints par `symbolRef.filePath`, donc pas de map symbole→fichier). `contracts.json` lu depuis le volume partagé `gitnexus-data` ; `/api/graph` fetché par repo depuis le serveur API. Node cap (`GROUP_GRAPH_NODE_CAP` 8000, priorise les nodes cross-repo). Front : mode "Group graph" (`GroupGraphPanel` liste/crée/sync/View → `enterGroupGraph`), canvas merged-mode (adapter dédié `group-graph-adapter.ts`, nodes colorés par repo, arêtes cross-repo en amber, légende + back). Honnête : 2 repos sans contrat partagé ⇒ 2 clusters colorés, 0 arête cross-repo. Spec : [`docs/superpowers/specs/2026-05-29-multi-repo-unified-graph-design.md`](docs/superpowers/specs/2026-05-29-multi-repo-unified-graph-design.md). | `wiki-worker.mjs` (group endpoints), `upstream/docker-server-group.mjs` (`/groups`,`/group/sync`,`/group/status`), `docker-server-group-graph-core.mjs` (`collapseToFileLevel`/`mergeRepoGraphs`) + `docker-server-group-graph.mjs` (`GET /graph/merged`), `GroupGraphPanel.tsx` + `group-graph` mode dans `useAppState`, `group-graph-adapter.ts` + merged-mode dans `GraphCanvas.tsx` |
| 66 | **Contrat de cohabitation upstream (Phase 2)** : deux gardes automatisés — `scripts/check-patch-drift.mjs` (dérive interne : diffs commités vs clone `upstream/`, exit 1 si désynchronisés) + `scripts/check-upstream-releases.mjs` (veille externe : alerte exit 10 si une release stable plus récente que notre pin existe). Contrat de cohabitation formalisé dans la spec. Règle de bump conservatrice (bump ONLY si `v1.7.x+` livré ET besoin), playbook complet, décision différée sur subtree/submodule jusqu'au prochain bump. Spec : [`docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md`](docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md). | `scripts/check-patch-drift.mjs`, `scripts/check-upstream-releases.mjs` |
| 67 | **Graph templates — Stage 1 (research-artifacts)** : mécanisme de templates de graphe générique, **tout dans le conteneur web** (zéro Kùzu). Registry built-in (`research-artifacts`), importeur `research-fs` (walk `/data/projects/<source>` + frontmatter YAML → `ResearchGraph` JSON sur le volume `gitnexus-data`), 5 routes REST, 3 outils MCP, vue `?research=<name>` qui réutilise le canvas single-graph (adaptateur `research-graph-adapter.ts` + palette par type). POST handlers `try/catch → 500` (jamais de crash serveur). Vérifié **live** (scaffold→import→get JSON) ; sérialisé via le format **fork-cohabitation** (`cohabit drift` vert). **NB** : la baseline patches avait été corrompue par les commits multigraph (gutting 2026-05-31) — restaurée depuis `d2a9234a` le 2026-06-03, garde CI `build-gate` ajoutée. | `upstream/docker-server-graph-templates{,-core}.mjs`, `upstream/docker-server-research-fs-importer.mjs`, `upstream/gitnexus-web/src/{lib/research-graph-adapter.ts,lib/research-colors.ts,services/research-client.ts,components/GraphSidebar.tsx}`, +3 outils `mcp-server/server.mjs`, specs/plan `docs/superpowers/*/2026-06-02-graph-templates*` |

Toutes les analytics ci-dessus marchent dans un seul repo. La granularité
est le node gitnexus (File, Function, Class, Section, …).

---

## 🎯 Tier 1 — Prochaines briques à fort impact ✅ LIVRÉ

> Ces features s'appuient toutes sur ce qui existe déjà. Effort : jours à
> 2 semaines chacune. ROI immédiat pour le use case "reverse engineering
> du projet". **Toutes livrées dans le commit qui suit l'init.**

### 1.1 — Bus factor + knowledge silos ✅
**Promesse** : par fichier, qui contribue le plus, et quel est le risque
de bus (un seul dev sur du code critique).

**Premier pas** : pendant `createSnapshot`, après le `git checkout`, run
`git blame --line-porcelain` sur chaque fichier source. Stocker
`<snapshotDir>/blame/<filePath>.json` avec `{ author, lines }` par auteur.

**Nouvel endpoint** : `GET /authorship?repo=<base>` → pour chaque fichier,
top contributeurs et `bus_factor = ceil(authors_covering_80pct_of_lines)`.

**UI** : nouveau panneau `OwnershipPanel.tsx` qui liste les fichiers
critiques (très modifiés via `/churn` × bus_factor ≤ 1).

### 1.2 — Cross-repo coupling ✅
**Promesse** : détecte des dépendances invisibles entre dépôts
(`monorepo-A` change quand `monorepo-B` change).

**Premier pas** : étendre `/coupling` pour accepter `?repos=A,B,C`.
Snapshots des 3 repos pris au "même moment" (par horodatage proche → soft
match, ou par date manuelle). Pour chaque transition cross-repo, comptage
des paires de fichiers (a∈A, b∈B) qui ont changé dans la même fenêtre
de temps.

**Difficulté** : alignement temporel. Plusieurs heuristiques possibles
(fenêtre glissante de 1h, ou commits liés par PR si on intègre l'API
GitHub plus tard).

### 1.3 — Migration des centres de gravité ✅
**Promesse** : voir le poids de code se déplacer entre repos au fil du
temps (monolithe → microservices, ou inverse).

**Premier pas** : `GET /growth?repos=A,B,C` (au lieu de `?repo=`).
Renvoie un timeline aligné avec une série par repo, par catégorie.

**UI** : option dans `GrowthChart.tsx` pour basculer "single repo /
multi-repo". En multi-repo, stack-area chart au lieu de multi-line.

### 1.4 — Entropie structurelle ✅
**Promesse** : un seul chiffre — le **Coefficient de Cohérence
Structurelle** — qui monte quand l'architecture se dégrade et descend
après refactos. Trackable dans le temps.

**Définition** (proposée, à affiner) :
```
entropy = 1 - normalized_modularity(graph)
```
où `normalized_modularity` est calculé via Louvain ou Leiden sur le graph
des relations CALLS / IMPORTS. Plus le graph se découpe proprement en
communautés, plus l'entropie est basse.

**Premier pas** : `GET /entropy?repo=<base>` qui calcule un score par
snapshot du timeline. Affichage : nouvelle série dans `GrowthChart.tsx`
ou bandeau dédié au-dessus de la Timeline.

### 1.5 — Export CSV/JSON pour analyse externe ✅
**Promesse** : tu balances dans Excel / Jupyter / Looker pour ton propre
post-mortem.

**Premier pas** : ajouter `&format=csv` à
`/churn`, `/coupling`, `/growth`, `/lifespan`, `/snapshots`. Headers
adaptés (`Content-Type: text/csv`, `Content-Disposition: attachment`).

---

## 🚧 Tier 2 — Plus ambitieux, 1-2 mois

### 2.1 — Annotation sémantique des clusters ✅
**Promesse** : pour chaque communauté gitnexus, un label métier
("auth", "billing", "data ingestion") généré par LLM à partir des noms
des nodes.

**Premier pas** : pipeline MCP-driven (puisque le MCP gitnexus est déjà
exposé). Skill Claude qui lit la liste des nodes d'une Community via
cypher, génère un label, écrit dans une nouvelle table ou en cache.

**Endpoint** : `GET /semantic-labels?repo=<base>` → `{ communityId: { label, confidence, evidenceNodes } }`.

**UI** : affichage du label au-dessus des clusters sur le graph, et
overlay dans le panneau Filters existant.

### 2.2 — Dissonance score ✅
**Promesse** : compare le découpage *automatique* du code (Communities
gitnexus + labels LLM) avec le découpage *déclaré* du business (que tu
fournis comme YAML : `{ "auth": ["src/auth/**", "src/login/**"], … }`).
Plus le score est élevé, plus le code "fuit" hors de son domaine
théorique → signal de refacto.

**Premier pas** : format d'input `<repo>/.gitnexus-domains.yaml`,
endpoint `GET /dissonance?repo=<base>` qui :
- map chaque file vers son domaine déclaré
- map chaque file vers son cluster détecté
- calcule un Adjusted Mutual Information ou un score d'overlap par
  paire (domaine, cluster)
- liste les fichiers "mal placés" (dans un cluster qui ne correspond
  pas à leur domaine déclaré)

### 2.3 — What-if simulator (statique) ✅
**Promesse** : "Si je renomme `validateUser` en `verifyUser`, qu'est-ce
qui change ?", "Si je split `src/big_module/` en `src/auth/` et
`src/db/`, l'impact sur le graphe ?". Pas d'exécution réelle, juste une
manipulation symbolique du graph.

**Premier pas** : action `rename` déjà côté MCP gitnexus (`mcp__gitnexus__rename`).
Étendre avec `move`, `split-folder`. UI = formulaire dans un nouveau
panneau qui montre le diff prévisionnel via `graph-diff.ts`.

**Limitation honnête** : marche pour des mutations purement structurelles
(renames, moves). Pour des transformations sémantiques ("passer de SQL
à GraphQL"), ce n'est pas faisable sans un modèle profond du code.

### 2.4 — VSCode/Cursor extension ✅ (MVP v0.1)
**Promesse** : tu ouvres un fichier dans ton IDE, tu vois directement
les métriques GitNexus en overlay (churn, ownership, blast radius).
L'intuition remplace la documentation.

**Premier pas** : extension VSCode qui appelle le MCP server (déjà
fonctionnel à `localhost:4747/api/mcp`). Pour chaque symbole en focus :
- couleur du gutter selon le churn (rouge/amber/grey)
- tooltip avec `mcp__gitnexus__context`
- badge "bus factor X" si owner unique

Effort : 1-2 semaines pour un MVP minimal, plus si on veut une vraie
intégration polishée.

### 2.5 — Cross-repo similarity (Score de Correspondance)
**État** : **v1 (a) livré 2026-05-26** — plan structural × temporal (4
quadrants) + identity vector 5-dim + `.gitnexus-policy.json` + warnings
auto. L'axe sémantique (cube complet 2×2×2) reste pour v1.1 (b) —
demande des embeddings client-side via le même chemin LLM que
`/semantic-labels`. La galaxie UMAP reste pour v1.2 (c).

**Promesse** : pour 2+ repos indexés, un diagnostic à **3 axes**
(structurel, sémantique, couplage temporel) qui classe chaque paire dans
une grille **2×2×2** avec une recommandation par cellule. Garde-fou
manuel via la section `policy:` de `.gitnexus.yaml` (cf 2bis.4) pour
neutraliser les faux positifs (compliance, multi-tenant, freeze legacy,
fork OSS), et heuristiques automatiques de `warnings` (licence
divergente, last-commit-age, sets d'auteurs disjoints).

**v1 (a) — livré** : 5 dims `[density, modularity, busFactorNorm,
topAuthorShare, foundationalRatio]`, cosine sur le vecteur, Jaccard sur
les time-buckets co-actifs (fenêtre 90j). Policy = JSON par cohérence
avec `.gitnexus-domains.json` (Node n'a pas de YAML stdlib). Endpoint :
`GET /similarity?repos=A,B[,...][&windowDays=][&{structural,semantic,temporal}Threshold=]`.
Panel : `SimilarityPanel.tsx` — matrice N×N color-coded par quadrant,
drill-down par paire, table des identity vectors.

**v1.b (lexical semantic) — livré** : axe sémantique calculé comme
similarité cosinus sur des vecteurs token-frequency des labels LLM
cachés (`/semantic-labels`). Tokenisation = lowercase, split sur
non-alpha, filtre stopwords bilingues EN+FR, drop tokens ≤2 chars.
Pondération unitaire par label (les communities ont des tailles
comparables, pas la peine d'introduire IDF pour 2 repos). Trois états :
(1) **disponible** = ≥2 repos ont des labels → cube 2×2×2 complet ;
(2) **partial** = certaines paires l'ont, d'autres collapse vers la
grille 4-cells ; (3) **off** = aucun repo n'a de labels → bandeau
"générez d'abord via DissonancePanel ✨". Choix lexical et non
embeddings : la moitié des providers chat (Anthropic, OpenRouter, …)
n'ont pas d'API embeddings, et ajouter un slot "embeddings provider"
distinct est son propre chantier d'une semaine. Vrais embeddings restent
un upgrade-path documenté (2.5b.bis) — le contrat de l'endpoint est
inchangé quand on swappera. Toggle : `?lexicalSemantic=false` pour
forcer l'ancien comportement.

**Pré-requis** : Repo ID stable (cf 2bis.5) pour que la similarité porte
à travers les re-clones et identifie les paires legacy/rewrite (FN-2).

**Vecteur d'Identité v2** (par repo, features normalisées) :
- `entropy` (via `/entropy`)
- `growth_rate` (pente moyenne de `/growth`)
- `churn_concentration` (Gini des churns, dérivé de `/churn`)
- `bus_factor_distribution` (médiane + p10 de `/ownership`)
- `community_count` + `modularity` (Leiden upstream)
- `file_size_pareto` (Gini des tailles de fichiers — Pareto vs uniforme = signature forte)
- `language_diversity` (entropie Shannon sur la distribution des extensions — catch direct pour FN-1 "stacks opposés")
- `tree_depth` (profondeur médiane + max de l'arbre de répertoires)
- `test_to_source_ratio` (LOC tests / LOC source via détection heuristique des fichiers test)
- `top_N_semantic_labels` embedded — moyenne des embeddings des labels
  LLM des N plus gros clusters (via `/semantic-labels`)

**Score à 3 axes** :
- `structuralScore` = cosine similarity sur les 9 premières features du
  Vecteur d'Identité.
- `semanticScore` = cosine similarity sur les labels embedded.
- `temporalCoupling` = densité du couplage cross-repo via
  `/coupling/cross` sur une fenêtre récente (90 jours par défaut).

Position dans le **cube 2×2×2** selon trois seuils (0.7 / 0.7 / 0.5 par
défaut, ajustables par query param) :

| Structurel | Sémantique | Couplé | Diagnostic | Recommandation |
|---|---|---|---|---|
| Haut | Haut | Haut | Jumeaux actifs | Extraire en lib partagée |
| Haut | Haut | Bas | Jumeaux isolés | **Suspect** — vérifier `.gitnexus-policy.yaml` |
| Haut | Bas | Haut | Patterns + collision | Standardiser outillage |
| Haut | Bas | Bas | Patterns partagés | Standardiser (sans urgence) |
| Bas | Haut | Haut | Collision réelle | Orchestrer via API Gateway |
| Bas | Haut | Bas | Domaines parallèles | Surveiller, pas d'action |
| Bas | Bas | Haut | Couplage caché | Découpler |
| Bas | Bas | Bas | Indépendants | Aucune action |

**Configuration via `.gitnexus.yaml > policy`** (cf 2bis.4 pour le format
unifié qui remplace les multiples `.gitnexus-*.yaml`) :
```yaml
policy:
  isolation_required: true
  reason: "PCI compliance — code identique mais doit rester séparé"
  allow_merge_with: []   # whitelist optionnelle d'autres repos OK pour merge
```
Quand `isolation_required: true`, le quadrant "Jumeaux actifs" devient
"Jumeaux (isolation intentionnelle)" et la reco merge est supprimée.

**Heuristiques de `warnings[]`** (auto-générées par l'endpoint) :
- `LICENSE files diverge` — comparaison du fichier `LICENSE` à la racine
  de chaque repo.
- `Last commit > Xmo` — un repo gelé suggère version freeze ou
  abandonware.
- `Distinct author sets` — aucun committer en commun → fork ou équipes
  disjointes.
- `Domain names mismatched` — déclarés divergents dans
  `.gitnexus-domains.yaml`.

**Premier pas** : `GET /similarity?repos=A,B[,C,...]` qui :
1. Résout chaque `repo` en `repoId` stable via 2bis.5.
2. Agrège les features depuis les endpoints existants (pas de re-calcul).
3. Embed les top-N labels via le même chemin LLM que `/semantic-labels`.
4. Charge la section `policy:` de `.gitnexus.yaml` de chaque repo s'il existe.
5. Calcule les 3 scores + applique les heuristiques `warnings`.
6. Retourne :
```json
{
  "pairs": [{
    "a": "repo-A", "b": "repo-B",
    "structuralScore": 0.84, "semanticScore": 0.72, "temporalCoupling": 0.12,
    "quadrant": "Jumeaux isolés",
    "recommendation": "Suspect — vérifier .gitnexus-policy.yaml",
    "warnings": ["LICENSE files diverge", "Last commit on B > 6mo"],
    "dominantFeatures": ["entropy", "churn_concentration"],
    "policyApplied": null
  }]
}
```

**UI** : nouveau panneau `SimilarityPanel.tsx` — matrice N×N color-coded
par quadrant (8 couleurs), drill-down par paire sur les features
dominantes, warnings affichés en bandeau. La **vue Galaxie UMAP** est
extraite en feature dédiée 2.6.

**Modes d'échec à surveiller** :

| # | Scénario | Le modèle dit | Réalité | Mitigation |
|---|---|---|---|---|
| FP-1 | Réplication compliance (PCI / non-PCI, EU / US) | Jumeaux → merge | Isolation requise | `.gitnexus-policy.yaml` |
| FP-2 | Multi-tenant par isolation (1 repo / client) | Jumeaux → merge | Data leak si merge | `.gitnexus-policy.yaml` |
| FP-3 | Version freeze pour client legacy | Jumeaux → merge | Contrat figé | Warning `last_commit_age` |
| FP-4 | Fork OSS interne vs upstream public | Jumeaux → merge | Licences incompatibles | Warning `LICENSE diverge` |
| FN-1 | Même domaine, stacks opposés (Python ORM vs Go raw SQL) | Indépendants | Convergence ratée | `semanticScore` seul peut basculer en "Collision" |
| FN-2 | Legacy + rewrite | Indépendants | Réconciliation requise | Détection git remote ancestor (post-MVP) |
| FN-3 | Public API + private impl (contract coupling) | Indépendants | Collision sur le contrat | Axe `temporalCoupling` capture ce cas |

**Limitation honnête** : le vrai "Score de Collision" sur la donnée
métier (mêmes tables DB modifiées par les deux repos) reste hors scope —
demanderait l'annotation des schemas ou la lecture des migrations. L'axe
`temporalCoupling` via `/coupling/cross` est la meilleure approximation
disponible. Détection AST-pattern (design patterns récurrents type DI,
Factory) = cf 3.8 (Domain-specific AST extractors) — nécessite un
extracteur de patterns sur Tree-sitter.

**Effort** : 2-3 semaines pour l'endpoint complet (Vecteur v2 + 3 axes +
warnings + policy parser) + panneau matrice. Pré-requis 2bis.4 (unified
config, 2-3j) + 2bis.5 (repo ID stable, 3-5j). Vue Galaxie = 2.6
séparée. AST-fingerprint = 3.8.

---

## 🔧 Tier 2bis — Plate-forme avant de continuer à empiler

> Briques structurelles à livrer **avant** Tier 2.5/2.6 et tout Tier 3.
> Chacune rend les features suivantes plus rapides à produire et plus
> utilisables via les agents IA. Effort cumulé ~3 semaines, ROI permanent.

### 2bis.1 — MCP exposure des analytics time-travel ✅ LIVRÉ
**État** : livré 2026-05-26 sous forme de **sidecar stdio** dans
`mcp-server/` (hors `upstream/`, survit aux bumps). 12 tools exposés
en JSON-RPC 2.0 pure Node zéro-dep, transport stdio MCP 2024-11-05
(matches `@modelcontextprotocol/sdk@1.0.0` upstream). Smoke 6/6 ✓
contre la stack live, dont `gitnexus_list_repos` (6 repos) +
`gitnexus_entropy` (1 timeline point). Installation = une entrée
dans `~/.claude.json > mcpServers` (cf `mcp-server/README.md`).
**Choix sidecar vs patch upstream** : modifier
`upstream/gitnexus/src/mcp/*.ts` aurait introduit du merge work à
chaque bump upstream (v1.6.3→v1.6.5 a déjà touché ces fichiers). Le
sidecar coexiste avec `npx gitnexus mcp`, l'utilisateur l'ajoute à sa
config MCP comme une 2e entrée.

**Promesse** : chaque endpoint backend devient un tool MCP. Claude
(ou tout agent compatible) peut interroger `/churn`, `/entropy`,
`/ownership`, `/similarity`, etc. en langage naturel — sans curl ni
panneau frontend.

**Justification stratégique** : le principe **MCP first** des Principes
de design n'est aujourd'hui appliqué qu'au graphe upstream. Nos
analytics time-travel sont invisibles à l'agent. C'est le gap le plus
exploitable rapidement, et le pré-requis dur de 3.7 (AI-guided tour).

**Premier pas** : `upstream/docker-server-mcp-analytics.mjs` qui wrap
chaque endpoint REST en MCP tool avec description claire :
- `mcp__gitnexus__churn(repo, snapshotId?)`
- `mcp__gitnexus__entropy(repo, fromSnapshot?, toSnapshot?)`
- `mcp__gitnexus__ownership(repo, filePath?)`
- `mcp__gitnexus__dissonance(repo)`
- `mcp__gitnexus__similarity(repos)`
- `mcp__gitnexus__coupling_cross(repos)`
- `mcp__gitnexus__growth_cross(repos)`
- `mcp__gitnexus__lifespan(repo)`

**Effort** : 3-5 jours. Wrapper + tests manuels via Claude Code chat
("compare l'entropie de hmm_studio entre janvier et mars").

### 2bis.2 — Commit-level entropy delta ✅ LIVRÉ (MVP par interpolation, UI livrée)
**État** : livré 2026-05-26 via [`upstream/docker-server-entropy-commits.mjs`](upstream/docker-server-entropy-commits.mjs).
Endpoint `GET /entropy/commits?repo=<base>[&from=&to=][&days=N][&format=csv]`.
**Méthode MVP** : pas de Leiden in-memory (trop coûteux). À la place, pour
chaque commit dans la fenêtre, on attribue sa part du delta entropy
observé entre les snapshots bracketants, proportionnel à `filesTouched`.
Commits hors-fenêtre snapshot ressortent en `stragglers` avec
`attributedDensityDelta: null`. Honest framing : co-commits dans le
même bracket ne sont pas démêlables (split proportionnel). Pour du
vrai per-commit causal entropy, snapshotter chaque commit (déjà
supporté via `/snapshot/bulk`). MCP tool `gitnexus_entropy_commits`.
Test live sur hmm_studio : 99 commits sur 180j → 66 attribués, 33
stragglers, 4 windows dérivés de 5 snapshots.

**UI livrée** : [`components/EntropyCommitTimeline.tsx`](upstream/gitnexus-web/src/components/EntropyCommitTimeline.tsx),
sparkline SVG montée au-dessus de la Timeline. Toggle "Commit Δ" (icon
Activity) dans la Timeline. Bars verticaux pondérés par
`|attributedDelta|`, color-coded par signe selon la métrique (rouge =
bad : densifying pour density / less modular pour modularity). Boundaries
snapshot marquées en dashed amber. Stragglers en strip séparé à gauche
(petits dots). Drill-down par commit cliqué : sha + author + date +
filesTouched + window deltas + bouton copy-SHA + snippet `git show
<shortSha>`. Switch metric density/modularity, window input en jours.
Non-mutex avec les panels de droite.

**Promesse** : actuellement entropie calculée par snapshot. Étendre à un
**delta par commit** → identifie la PR exacte qui démarre la dégradation
de cohérence. Combo killer avec `git blame` → "cette PR a démarré la
perte d'architecture".

**Premier pas** : `GET /entropy/commits?repo=<base>&from=&to=` qui :
1. Liste les commits dans la fenêtre via `git log --pretty=format:%H %ai %an`.
2. Pour chaque commit, calcule en mémoire le delta de modularité Leiden
   sur les fichiers touchés + leurs voisins du graphe d'imports
   (approximation, mais bon enough pour détecter les sauts).
3. Renvoie `[{ sha, author, date, entropyDelta, filesTouched }]`.

**UI** : sparkline `EntropyCommitTimeline.tsx` au-dessus de la Timeline,
click sur un pic → diff visuel du commit + lien blame.

**Effort** : ~1 semaine.

### 2bis.3 — Alerting continu (watch + webhook) ✅ LIVRÉ (MVP)
**État** : livré 2026-05-26 via [`upstream/docker-server-watches.mjs`](upstream/docker-server-watches.mjs).
Cron interne démarré au boot par `startWatchesCron()` :
- Période `WATCH_INTERVAL_MS` (default 5 min)
- Debounce `WATCH_DEBOUNCE_MS` (default 1h) par (repo, watch)
- Désactivable via `WATCHES_ENABLED=false`

**Source des watches** : `.gitnexus.json > watches` de chaque repo,
parsé par 2bis.4. Pas de POST/DELETE au MVP — la déclarativité prime,
le user édite le JSON. La surface dynamique reste pour un 2bis.3b
quand un cas d'usage la justifie.

**5 métriques supportées** :
- `entropy.density` (du `/entropy` timeline, last point)
- `entropy.modularity` (idem)
- `ownership.busFactor` (repoBusFactor)
- `ownership.topAuthorShare` (repoAuthors[0].share)
- `dissonance.purity` (skip si pas de domains déclarés)

**Webhook payload Slack-compatible** : champs structurés
(`repoBase`, `metric`, `threshold`, `op`, `currentValue`, `triggeredAt`,
`source`) + un champ `text` pré-formaté pour Slack incoming webhooks
zéro-config.

**Endpoint** : `GET /watches[?repo=<base>]` → liste les watches + leur
dernier état d'évaluation (in-memory, perd l'historique au restart —
documenté). MCP tool `gitnexus_watches`.

**Limitation MVP** : seuils statiques. Apprentissage des seuils
normaux = Tier 3 ML, pas dans ce round.

**Promesse** : transformer GitNexus de "dashboard pull-only" à
"garde-fou actif". Endpoint `/watch` qui SSE des events quand un seuil
est franchi, couplé à webhooks (Slack / Email / Discord / Teams).

**Premier pas** :
- `POST /watches` → enregistre une watch dans LadybugDB : `{ repo,
  metric, threshold, op, webhookUrl }`.
- Cron interne (toutes les N minutes, configurable) qui rejoue chaque
  watch et déclenche le webhook si trigger.
- `GET /watches?repo=<base>` → liste + statut.
- `DELETE /watches/:id`.

**Format webhook POST** :
```json
{
  "repoBase": "hmm_studio",
  "metric": "entropy",
  "threshold": 0.6, "op": ">",
  "currentValue": 0.63,
  "snapshotId": "abc123",
  "triggeredAt": "2026-05-26T10:30:00Z"
}
```

**Configuration declarative** via `.gitnexus.yaml > watches:` (cf 2bis.4)
pour reproductibilité.

**Limitation** : seuils statiques pour le MVP. Pas d'apprentissage des
seuils "normaux" — ça relève d'un Tier 3 ML.

**Effort** : 1-2 semaines.

### 2bis.4 — Unified `.gitnexus.yaml` ✅ LIVRÉ (en JSON)
**État** : livré 2026-05-26 sous le nom `.gitnexus.json` (pas YAML —
Node n'a toujours pas de parser YAML stdlib, déjà tranché à 2.2 et
2.5). Sections supportées : `domains`, `policy`, `budgets` (réservé
3.6), `watches` (réservé 2bis.3). Parser dans
[`upstream/docker-server-config.mjs`](upstream/docker-server-config.mjs).
Backward-compatibilité : `.gitnexus-domains.json` et
`.gitnexus-policy.json` continuent de marcher avec deprecation
warning stderr ; précédence = unifié > legacy. Endpoints consommateurs
mis à jour : `/dissonance` et `/similarity`. Exemple canonique :
[`patches/example-gitnexus.json`](patches/example-gitnexus.json).

**Promesse** : consolider tous les fichiers de config par-repo sous un
unique `.gitnexus.yaml` avec sections. Évite l'explosion à 4-5 fichiers
config disjoints quand on empile policy, budget, alerting.

**Format unifié** :
```yaml
domains:                          # ex-`.gitnexus-domains.yaml` (Tier 2.2)
  auth: ["src/auth/**", "src/login/**"]
  billing: ["src/billing/**"]

policy:                           # consommé par Tier 2.5 (similarity)
  isolation_required: false
  reason: ""
  allow_merge_with: []

budgets:                          # consommé par Tier 3.6 (Architectural CI)
  entropy_max: 0.6
  coupling_max_per_file: 5
  bus_factor_min: 2

watches:                          # consommé par Tier 2bis.3 (alerting)
  - metric: entropy
    threshold: 0.6
    op: ">"
    webhook: "https://hooks.slack.com/..."
```

**Premier pas** : parser unifié `upstream/lib/gitnexus-config.mjs` qui :
1. Charge `.gitnexus.yaml` à la racine du repo.
2. Fallback sur les anciens fichiers (`.gitnexus-domains.yaml`,
   `.gitnexus-policy.yaml`) avec warning de dépréciation pour rétrocompat.
3. Expose `getConfig(repo)` consommé par `/dissonance`, `/similarity`,
   `/ci-check`, `/watches`.

**Effort** : 2-3 jours.

### 2bis.5 — Repo ID stable ✅ LIVRÉ (MVP)
**État** : livré 2026-05-26. Formule = `sha256(firstCommitSha + '\n' +
normalizedRemote)[:16]` (16 hex chars, 64 bits d'entropie — collision
négligeable au scale qu'on cible). `normalizedRemote` strip scheme +
user@ + `.git` + query/fragment, lowercase l'host, garde le path
case-sensitive (GitHub-style). Cache disque par-repo dans
`<repoPath>/.gitnexus/repo-id.json` avec la provenance (firstCommitSha
+ normalizedRemote + computedAt). Surface :
- `/similarity` → `response.repos[].repoId` + `normalizedRemote`
- `GET /repos/by-id/:repoId` → résout vers tous les `<base>` connus
- MCP tool `gitnexus_repo_by_id`

**Hors scope du MVP** (laissé à 2bis.5b) : refactor des cross-repo
endpoints (`/coupling/cross`, `/growth/cross`, `/similarity`) pour
accepter `<repoId>` interchangeablement avec `<base>`. La surface est
là, la migration des consommateurs viendra avec les premiers cas
d'usage réels (re-clone qui casse la similarité).

**Promesse** : chaque repo a un identifiant stable basé sur (a) le SHA
du premier commit et (b) le `git remote origin` normalisé. Survit aux
re-clones avec noms de dossier différents.

**Justification** : actuellement `<base>` = nom du dossier d'index.
Re-clone le même repo ailleurs → la Galaxie / similarity ne porte pas le
link, et la détection FN-2 (legacy + rewrite) est bloquée.

**Premier pas** :
- Au moment du snapshot, calculer `repoId = sha256(firstCommitSha + normalizedRemote)`.
- Stocker dans le snapshot metadata + index global.
- `GET /repos/by-id/:repoId` qui résout vers tous les `<base>` connus
  pour cet ID (utile quand un repo est cloné dans plusieurs paths).
- Tous les endpoints cross-repo acceptent désormais soit `<base>` soit
  `repoId` (auto-detect).

**Effort** : 3-5 jours, principalement à câbler dans les analytics
cross-repo qui prennent encore `<base>` (coupling/cross, growth/cross,
similarity).

---

### 2.6 — Galaxie OSS / Carte de l'écosystème
**Promesse** : projection UMAP 2D du Vecteur d'Identité de N repos.
Chaque repo = un point dans un espace 2D, distance euclidienne ≈
similarité. Permet de visualiser un écosystème entier comme une carte
stellaire : clusters = familles technologiques, points isolés =
exotiques ou anomalies de dette technique masquée.

**Justification de l'extraction de 2.5** : la matrice N×N (2.5) répond à
"quelle paire fusionner ?". La Galaxie répond à "à quoi ressemble mon
écosystème de repos ?". Public et use case différents (architecte
d'organisation vs ingénieur staff).

**Premier pas** : `GET /galaxy?repos=A,B,...` qui :
1. Calcule le Vecteur d'Identité de chaque repo (réutilise 2.5).
2. UMAP fit (umap-js côté backend Node, ou délégation à un script Python
   via subprocess si trop coûteux en JS).
3. K-means sur les coordonnées 2D pour identifier les clusters.
4. Renvoie `[{ repoId, label, x, y, dominantCluster, exoticnessScore }]`.

**`exoticnessScore`** = distance moyenne aux k plus proches voisins.
Repos isolés = forte exoticness → soit niche tech volontaire, soit
anomalie.

**UI** : nouveau panneau `GalaxyView.tsx` — canvas 2D avec points
color-codés par cluster K-means. Hover → nom + Vecteur d'Identité.
Click → drill-down panneau Similarity sur cette paire.

**Effort** : 1 semaine si on délègue UMAP à un script Python ; 1.5-2
semaines avec umap-js intégré côté backend Node.

**Extension future** : alimenter la Galaxie avec le dataset public OSS
(cf 3.9) → "votre repo est dans ce cluster, comparable à django/django
et flask/flask".

---

## 🔬 Tier 3 — Demande infrastructure ou validation forte

### 3.1 — Dead code via instrumentation runtime
**Idée** : couleur des nodes par fréquence d'exécution en production.

**Bloqué par** : nécessite un APM (OpenTelemetry, Datadog, Prometheus)
ou un agent custom dans l'app. Hors scope analyse statique.

**Si on s'y attaque** : adapter qui ingère des spans OTLP, mappe les
function names sur les nodes du graph, expose un endpoint `/heat`
similaire à `/churn` mais avec des comptes d'invocations.

### 3.2 — Mutation tracking / profils de devs
**Idée** : classifier le "style" de chaque dev (ajoute de la masse vs
refactore, augmente le couplage vs le réduit).

**Bloqué par** :
- Sociologiquement délicat (mesurer les gens via leur code → résistance
  équipe garantie). Demande accord explicite avant d'implémenter.
- Techniquement : faisable avec `git blame` + delta de complexité par
  commit-auteur.

### 3.3 — Conway's Law audit
**Idée** : compare le graphe de communication des équipes (qui review
qui, qui commit dans quel module) avec le graphe de code. Détecte les
décalages.

**Bloqué par** : demande accès à l'API GitHub/GitLab pour les PRs +
reviews. Plus des heuristiques pour mapper auteurs → équipes (qui
souvent ne sont pas explicites).

### 3.4 — Auto-PR de refactoring
**Idée** : GitNexus propose automatiquement des PRs pour aplatir un
couplage cyclique, déplacer une fonction mal placée, etc.

**Bloqué par** : codegen fiable est *très* dur. Cas réalistes possibles
pour un MVP : moves de fonctions entre fichiers (utilise les AST
gitnexus), extract method, dédoublonnage de fonctions quasi-identiques
(détection par hash de signature normalisée).

### 3.5 — Modèle prédictif de bugs
**Idée** : prédit où va apparaître le prochain bug en fonction du churn
× couplage × bus factor.

**Bloqué par** : nécessite des labels (commits de fix, tickets liés).
Pure R&D ML. À reporter loin.

### 3.6 — Architectural CI
**Promesse** : check PR-time qui calcule `entropy_delta`,
`max_coupling_delta`, `bus_factor_min_delta` entre la base branch et la
PR. Bloque (ou flag warning) si la PR dégrade au-delà des budgets
déclarés dans `.gitnexus.yaml > budgets`.

**Premier pas** :
- `POST /ci-check` qui prend `{ repo, baseCommit, headCommit }`,
  snapshotte les deux, diff les métriques, compare aux budgets.
- GitHub Action / GitLab CI wrapper qui poste un commentaire structuré
  sur la PR.
- Bouton "reviewer override" obligatoire pour les gros refactos légitimes.

**Concurrence directe** : Akon Labs vend déjà "PR Review — blast radius
automatique" en commercial ([INVENTORY A.11](INVENTORY.md#partie-a)).
**Choix stratégique à trancher** avant d'attaquer : est-ce qu'on veut
être en bataille frontale avec leur offre ?

**Difficulté** :
- Coût snapshot par PR. Mitigé si les snapshots sont cachables (cf
  Optimisations section).
- Faux positifs sur les gros refactos → override obligatoire.
- Compatibilité avec leur PolyForm-Noncommercial pour usage commercial
  partenaire.

**Effort** : 3-4 semaines (endpoint + GitHub Action + tests sur 2-3 PRs
réelles).

### 3.7 — AI-guided tour (Architect's Copilot)
**Promesse** : un agent LLM consomme tous les endpoints MCP (cf 2bis.1)
et produit une **interprétation narrative** du repo. Pas de nouvelle
analytique, juste une couche de synthèse — le moins coûteux pour le
plus de valeur perçue.

**Exemple de sortie** :
> "Votre repo a +18% d'entropie depuis mars 2026, principalement dans
> le cluster 'auth' (semantic label confiance 0.84). Le fichier
> `oauth.ts` a vu son bus factor chuter de 2 à 1 après le départ de
> Marie en mars. Recommandation : (a) refactorer `oauth.ts` en 3
> modules plus petits pour diluer le risque social, (b) auditer la
> dette technique du cluster auth via `/dissonance`."

**Premier pas** :
- Skill Claude (`.claude/skills/gitnexus-architect.md`) qui décrit la
  pipeline : appeler `/entropy`, `/ownership`, `/dissonance`,
  `/similarity` via MCP (cf 2bis.1) et synthétiser.
- Prompt template structuré : Constat → Causes → Recommandations →
  Niveau de confiance.
- Mode `/tour --depth=quick|standard|deep`.

**Dépendance dure** : 2bis.1 (MCP exposure) doit être livré avant.

**Effort** : 2-3 semaines (prompt engineering + tests sur 3-4 repos
réels).

### 3.8 — Domain-specific AST extractors
**Promesse** : aujourd'hui Tree-sitter parse en générique. Ajouter des
extracteurs spécialisés par stack qui exposent des **concepts métier**
(Django: Models / Views / Serializers, React: Components / Hooks,
Spring: Controllers / Services / Repositories) → analytics au niveau
"domaine technique".

**Exemples d'insights nouveaux** :
- "Tes Django Models ont grossi de 40% en fields mais tes Serializers
  n'ont pas suivi → drift API/DB."
- "Tes React Components ont 12 niveaux de prop drilling moyen →
  introduire Context."
- "Tes Spring Controllers exposent 3× plus d'endpoints que de
  Repositories → couche service sous-développée."

**Premier pas** : refactor le parser Tree-sitter pour accepter des
extracteurs en plugin (dépend de 3.10). Chaque extracteur expose :
```js
{ language: "python", framework: "django",
  patterns: [{ nodeType: "class_definition",
               classifier: node => isDjangoModel(node) ? "Model" : null }],
  analytics: [...] }
```

**Couvre aussi** la détection AST-pattern (DI, Factory, etc.)
mentionnée comme limitation de 2.5.

**Effort** : 1-2 semaines par stack supporté. Démarrage avec la stack
dominante de hmm_studio.

### 3.9 — Public reference dataset / industry baselines
**Promesse** : indexer N repos OSS publics (top GitHub par langage,
curated list) pour créer un dataset de référence. Permet de répondre à
"votre entropie 0.42, médiane des Django projects OSS = 0.31, p90 =
0.55".

**Premier pas** :
- Pipeline d'indexation batch : `gitnexus analyze` sur 100-1000 repos
  OSS curés (top par stars × diversité de stacks).
- Storage dédié (DuckDB partagé ou LadybugDB read-only).
- `GET /baseline?language=python&framework=django&metric=entropy` →
  `{ p10, p50, p90, n, sampledRepos: [...] }`.
- Intégration dans la Galaxie 2.6 : tes repos placés au milieu de la
  carte OSS.

**Difficulté** :
- Coût compute (1000 repos × 10 min indexation ≈ 1 semaine machine).
- Stockage (~100 GB ordre de grandeur).
- Mise à jour : ré-indexer mensuellement ? Trimestriellement ?
- Licence : indexation pour stats publiques OSS, mais l'embedding LLM
  des labels peut avoir des implications selon le provider.

**Moat compétitif** : aucun outil grand public n'expose ces baselines.
**Pivot stratégique potentiel** : si on attaque le Chemin C (SaaS / API
publique), ce dataset est le différenciateur.

**Effort** : 1 mois initial (compute + curation + endpoint), puis
1-2j/mois maintenance.

### 3.10 — Plugin architecture pour analytics
**Promesse** : registre déclaratif des analytics. Toute nouvelle
métrique = déclaration `{ name, inputs, outputSchema, ui, mcpExposure }`.
Le backend compose dynamiquement les endpoints REST, le CSV serializer,
les MCP tools, et les hints UI. **Lève le goulot d'inflation
horizontale** (chaque analytique = 5 fichiers à toucher aujourd'hui).

**Schéma de plugin** :
```js
// upstream/plugins/entropy.mjs
export default {
  name: "entropy",
  version: "1.0.0",
  inputs: { repo: "string", snapshotId: "string?" },
  outputSchema: {
    density: "number",
    modularity: "number",
    entropy: "number"
  },
  compute: async ({ repo, snapshotId }, ctx) => { /* ... */ },
  ui: { panel: "EntropyBadge", placement: "Timeline" },
  mcp: {
    description: "Calcule l'entropie structurelle d'un snapshot.",
    exposeAs: "mcp__gitnexus__entropy"
  },
  csv: { columns: ["density", "modularity", "entropy"] }
};
```

**Premier pas** :
1. Identifier 3 analytics représentatives (entropy, ownership,
   similarity) et les ré-implémenter via le plugin schema.
2. Backend qui scanne `upstream/plugins/*.mjs` au boot et enregistre :
   - route REST `GET /:name`
   - colonne CSV via le serializer partagé
   - tool MCP (cf 2bis.1)
   - hint UI (registry frontend qui consomme la liste des plugins)
3. Migrer les 18 analytics existantes une par une.

**Effort** : 1 mois (refonte backend + migration des analytics existantes).

**ROI** : permanent. Chaque future analytique économise 60-80% du
plumbing. Pré-requis tacite à toute évolution Tier 3 ultérieure.

---

## 🛠️ Optimisations d'existant à programmer

> Pas des nouvelles features — des durcissements à faire avant que la
> plate-forme casse sous le poids des features successives.

| Cible | Optimisation | Effort | Trigger |
|---|---|---|---|
| **Snapshot storage** | Audit LadybugDB pour structural sharing entre snapshots ; si non dispo, dé-dupe par hash de node | À auditer | À 200+ snapshots cumulés, vérifier la taille disque |
| **Semantic label cache** | Invalidation auto sur drift de community (re-fingerprint à chaque création snapshot) | 2-3j | Quand un label affiche un sens incorrect après reindex |
| **Frontend bundle** | Code-splitting par panel (lazy load Sigma, three.js, react-force-graph-3d) | 1 semaine | Cold start visible >3s sur un repo moyen |
| **Export/Import** | Round-trip integrity check + versioning du format export | 2-3j | Avant le premier "import a échoué silencieusement" en prod |
| **HTTP cache** | ETag sur analytics figées — les snapshots passés sont immuables, cachables ∞ | 3-5j | Quand le dashboard charge >5 endpoints en parallèle au démarrage |
| **Repo registry** | Index inversé sur `repoId` (cf 2bis.5) pour lookup multi-base | 1-2j | Quand on a 3+ clones du même repo sur des chemins différents |
| **Smoke tests** | Harness `curl + assert` qui tourne après `docker compose build` (CLAUDE.md note "no test suite") | 1 semaine | Avant la prochaine fois où un patch upstream casse un endpoint silencieusement |
| **Perf instrumentation** | Endpoint `/metrics` exposant latences p50/p95/p99 par endpoint + count de cache hits | 3-5j | Quand on n'arrive plus à diagnostiquer un slowdown |

---

## 🎯 Vision architecturale — trois chemins de maturité

Le produit actuel est une **plate-forme d'analytique de code historisée
+ social-aware**. Trois orientations stratégiques pour la maturité,
**exclusives en positionnement** même si techniquement compatibles :

| Chemin | Slogan | Features clés | Public visé | Modèle |
|---|---|---|---|---|
| **A — Architectural CI** | "Surveille votre architecture comme un garde-fou" | 3.6, 2bis.3, 2.4 | Team lead / eng manager | Workflow PR / GitHub Action |
| **B — Architect's Copilot** | "Architecte virtuel qui vous conseille" | 3.7, 2.5, 2.6, 3.4, principe MCP-first | Staff / principal engineer | Conversationnel / MCP |
| **C — Galaxie OSS / Industry baseline** | "Comparez votre repo à 10k projets publics" | 3.9, 2.6 étendue, 2.5 Galaxie | CTO, M&A diligence, OSS maintainers | SaaS / API publique |

**Recommandation actuelle (à valider explicitement avant pivot)** :
**Chemin B** pour le contexte single-user / écosystème adjacents. C'est
le moins en concurrence directe avec Akon Labs (qui vend déjà du Chemin
A via leur PR Review commercial — cf [INVENTORY A.11](INVENTORY.md#partie-a)),
et c'est le plus aligné avec l'usage agent-IA actuel.

**Important** : "Chemin B" ne signifie pas "abandonner le reste". Tier
1, Tier 2.1-2.4 ✅ livrés, Tier 2bis (plate-forme), 2.5, et la plupart
du Tier 3 sont indispensables à n'importe quel chemin. La vision sert à
**filtrer les futures additions** et à choisir le messaging — pas à
abandonner l'acquis.

---

## 🚨 Refactos structurels à surveiller

> Issues architecturales identifiées dans la revue 2026-05-26. À
> traiter **avant** que la plate-forme casse, pas après.

| Issue | Symptôme actuel | Quand devient critique | Fix |
|---|---|---|---|
| **Pas de méta-architecture analytics** | Chaque nouvelle métrique = 5 fichiers à toucher (endpoint, CSV, panel, types, MCP) | À 25+ analytics (on est à 18) | 3.10 Plugin architecture |
| **Pas d'observabilité produit** | Aucune perf metric, aucun SLO, "no test suite, manual curl" (CLAUDE.md) | Quand un endpoint régresse silencieusement | Smoke harness + `/metrics` endpoint (cf Optimisations) |
| **Repo ID instable** | `<base>` = chemin disque, re-clone casse les liens cross-repo | Dès qu'on a 2 clones du même repo | 2bis.5 |
| **Configs disjointes** | `.gitnexus-domains.yaml` existe déjà ; policy + budgets + watches arrivent | À 3+ fichiers config par repo | 2bis.4 Unified config |
| **MCP gap sur analytics** | Le MCP-first principle des Principes de design n'est appliqué qu'au graphe upstream | Dès qu'on veut utiliser Claude comme advisor (cf 3.7) | 2bis.1 MCP exposure |
| **Divergence upstream** | +275 commits behind main upstream ([INVENTORY C](INVENTORY.md#partie-c)) | Au prochain bump majeur (refactor LadybugDB ?) | Bumper + reapply, OU négocier plugin system upstream avec abhigyanpatwari |
| **Croissance UI horizontale** | Chaque feature = 1 panel ; on est à ~10 panels | À 15+ panels (inflation cognitive) | Consolidation UX + regroupement par contexte (Health / Social / Cross-repo) |

---

## 🏢 Enterprise / commercial offering (upstream) — à évaluer vs notre fork

> Liste annoncée par l'upstream gitnexus comme **offre enterprise** (SaaS
> managé ou self-hosted) + usage commercial de l'OSS sous licence.
> Capturée le 2026-05-28, **évaluée le 2026-05-28** contre le code réel
> (recherche dans `upstream/` core + nos `docker-server-*.mjs` + `mcp-server/`
> + INVENTORY/ROADMAP). Les verdicts ci-dessous sont **vérifiés** (preuves
> par chemin de fichier), plus des hypothèses. Légende : 🟡 partiel /
> 🔴 absent / ⚪ N/A.

| Feature enterprise (upstream) | Verdict vérifié + preuve | Aller plus loin |
|---|---|---|
| **PR Review** — blast-radius sur les PR | 🟡 **Partiel — primitives oui, automatisation non.** Primitive impact présente (`gitnexus_impact`, blast radius call-graph, `upstream/gitnexus/src/core/group/cross-impact.ts`). On a ajouté `/snapshot/from-pr` (`upstream/docker-server-snapshot-from-pr.mjs`, on-demand, résout 2 refs → diffUrl) + MCP `gitnexus_snapshot_from_pr`. **Pas** de webhook forge, pas d'auto-trigger, pas de review postée. Tier 3.6 (CI check) planifié non livré. | Couche d'intégration : API GitHub/GitLab + budget gate + commentaire de review posté, sur nos primitives existantes. |
| **Auto-updating Code Wiki** — doc toujours à jour | ✅ **LIVRÉ (Tier 55)** — était 🟡 (upstream CLI-only). Surfacé dans l'UI web (panel iframe) + génération in-product + auto-update. `gitnexus wiki` core upstream (`upstream/gitnexus/src/core/wiki/`) désormais déclenché par `wiki-worker.mjs` + servi par `docker-server-wiki.mjs` + affiché par `WikiPanel.tsx`. | ✅ Livré : voir Tier 55. **Enhancements futurs** (out-of-scope v1) : (1) ré-render React natif au lieu de l'iframe (viewer thémé), (2) régen *staleness-based* (sur changement matériel du graph) en plus de l'intervalle, (3) config LLM provider in-UI au lieu de l'env-only, (4) gist publishing depuis l'UI (`--gist` existe en CLI). |
| **Auto-reindexing** — graph rafraîchi automatiquement | ✅ **LIVRÉ (Tier 56)** — était 🟡. Le cron watches détecte un changement de HEAD SHA par repo et déclenche un `analyze` incrémental (`POST /api/analyze` sans force). Opt-in (`auto_reindex.onCommit`). `GET /auto-reindex` expose l'état. | ✅ Livré : voir Tier 56. **Futurs** : working-tree dirty detection (`watchWorkingTree`), success-confirmation (polling jobId pour re-tenter les échecs), badge UI + toggle. |
| **Multi-repo support** — graphe unifié | ✅ **LIVRÉ (Tier 65)** — était 🟡. Sigma unique fusionnant plusieurs repos au niveau fichier (`GET /graph/merged?group=`), nodes colorés par repo + arêtes cross-repo issues des contrats (`crossLinks`). Groupe synchronisé via `gitnexus group` (endpoints worker + `docker-server-group.mjs`). Mode "Group graph" dans le canvas (`GroupGraphPanel` + `group-graph-adapter.ts`). Complète l'analytics cross-repo préexistante (`/coupling/cross`, `/growth/cross`, `/similarity`, galaxy view). | ✅ Livré : voir Tier 65. **Futurs** : drill-in symbole (granularité sous-fichier), layout par cluster repo explicite, arêtes pondérées par confiance de contrat. |
| **OCaml support** — couverture langage | 🔴 **Absent.** Upstream supporte **16** langages (`upstream/gitnexus-shared/src/languages.ts` : JS, TS, Python, Java, C, C++, C#, Go, Ruby, Rust, PHP, Kotlin, Swift, Dart, Vue, COBOL). OCaml nulle part. Le fork n'ajoute aucun langage. | Implémenter un `LanguageProvider` OCaml (tree-sitter) — travail core upstream, mieux contribué en amont. Niche. |
| **Priority feature/language support** | ⚪ **N/A** — offre de service commercial, pas une feature logicielle. | Rien à construire. |
| **(Upcoming) Auto regression forensics** | ✅ **LIVRÉ (Tiers 57-59, 62)** — était 🔴. On-demand `GET /regression` (6 scalaires, Tiers 57-58) + auto (webhooks enrichis du coupable, Tier 59) + polish (coupling watchable/auto-forensiquable + UI highlight `EntropyCommitTimeline`, Tier 62). Sans ML. | ✅ Complet : on-demand + auto + coupling + UI highlight. Rien restant. |
| **(Upcoming) End-to-end test generation** | 🔴 **Absent, non planifié.** Aucune mention INVENTORY/ROADMAP. | Net-new, LLM-lourd, gros scope, ROI proche faible. |

**Lecture (impact/effort)** : les 3 items 🟡 sont les meilleurs leviers (on possède le difficile, le gap est une fine couche) — (1) **Code Wiki en UI + auto-update** (meilleur ratio, brainstorm en cours), (2) **Auto-reindexing du graphe** (étendre le cron), (3) **PR Review automation** (Tier 3.6, mais tire l'API forge + auth). Les 🔴 sont soit de gros chantiers (graphe multi-repo), soit core/niche (OCaml), soit R&D (regression forensics), soit hors-scope (E2E gen, priority support).

---

## 🗑️ Idées qui ne deviennent pas leur propre feature

Pour éviter la prolifération de "noms marketing" qui font miroiter sans
livrer, voici ce qui est **déjà** couvert par d'autres tickets :

| Nom proposé | Ce qu'on livre à la place |
|---|---|
| "Code en réalité augmentée cognitive / Holodeck" | Tier 2.4 (IDE extension) |
| "Conscience de l'architecture" | Tier 1.4 (Entropie) |
| "Nexus auto-guérissant" | Tier 3.4 (Auto-PR) — pas tier 1, soyons honnêtes |
| "Génétique logicielle" | Tier 3.2 (Mutation tracking) |
| "Cancer bénin / métastase" | Combinaison de Tier 1.1 (bus factor) + Tier 1.4 (entropie) + Tier 1.2 (cross-repo coupling) |
| "Dimension vivante / Time-lapse" | Déjà livré (Phase 3, bouton Play dans Timeline) |
| "Code City" 3D évolutif | Existe déjà en partie via `Graph3DCanvas`, à étendre avec Timeline → Phase 4D++ |

---

## Ordre d'exécution recommandé (post-revue 2026-05-26)

Ordonné par **ratio impact / effort** + dépendances. La **plate-forme
d'abord** (Tier 2bis), les features stratégiques ensuite, le R&D pour la
fin. Tout ce qui suit s'appuie sur Tier 1 + Tier 2.1-2.4 ✅ déjà livrés.

### Phase 0 — Acquis (rappel)
- ✅ Tier 1 complet (1.1 à 1.5)
- ✅ Tier 2.1 (semantic labels), 2.2 (dissonance), 2.3 (what-if), 2.4 (VSCode MVP)

### Phase 1 — Plate-forme (avant toute nouvelle feature horizontale) ✅ COMPLET
1. ✅ **2bis.1 MCP exposure** — sidecar `mcp-server/`, 15 tools, smoke 6/6.
2. ✅ **2bis.4 Unified `.gitnexus.json`** — parser `docker-server-config.mjs`, sections `domains` / `policy` / `budgets` (réservé 3.6) / `watches` (consommé par 2bis.3 livré), backward-compat sur les legacy avec deprecation warning.
3. ✅ **2bis.5 Repo ID stable** — `sha256(firstCommit + normalizedRemote)[:16]`, cache disque, endpoint `/repos/by-id/:repoId`, surface dans `/similarity`.

> **Sortie de Phase 1** : la plate-forme est prête. Phase 2 (diagnostic fin) et le reste de Tier 3 peuvent maintenant s'empiler proprement.

### Phase 2 — Diagnostic fin ✅ COMPLET
4. ✅ **2bis.2 Commit-level entropy delta** — `/entropy/commits` MVP par interpolation snapshot-bracketing.
5. ✅ **2bis.3 Alerting continu** — `/watches` + cron + webhook Slack-compatible, 5 métriques, debounce 1h.

### Phase 3 — Cross-repo (quand ≥3 repos indexés)
6. **2.5 Cross-repo similarity** — Score de Correspondance + cube 2×2×2. ~2-3 semaines.
7. **2.6 Galaxie UMAP** — carte de l'écosystème, K-means + exoticness. ~1-2 semaines.

### Phase 4 — Méta-architecture (lever le goulot horizontal)
8. **3.10 Plugin architecture** — registre déclaratif des analytics. ~1 mois.

> Trigger : quand on a 25+ analytics OU avant 3.8 (qui le requiert).

### Phase 5 — Stratégique (dépend du Chemin retenu)
9. **3.7 AI-guided tour** (Chemin B) — synthèse narrative MCP-driven. ~2-3 semaines. Requiert 2bis.1.
10. **3.6 Architectural CI** (Chemin A — vs commercial Akon Labs) — PR check + budgets. ~3-4 semaines. Décision stratégique requise.
11. **3.8 Domain-specific AST extractors** — Django/React/Spring concepts. ~1-2 sem/stack. Requiert 3.10.
12. **3.9 Public reference dataset** (Chemin C) — baseline industrie. ~1 mois initial + maintenance.

### Phase 6 — R&D long terme
13. **3.1 Dead code runtime** — APM-bloqué.
14. **3.2 Mutation tracking / profils devs** — social-sensible.
15. **3.3 Conway's Law audit** — GitHub API requise.
16. **3.4 Auto-PR refactoring** — codegen fiable difficile.
17. **3.5 Modèle prédictif de bugs** — pure R&D ML.

### En parallèle continu — Optimisations & refactos
- Smoke tests harness (avant que ça casse silencieusement).
- HTTP cache ETag (quand le dashboard rame).
- Bump upstream + reapply (quand on touche un fichier upstream majeur).
- Cf section "Optimisations d'existant" + "Refactos structurels".

---

## Principes de design

- **Une feature = une promesse précise**. Pas de noms qui font rêver sans
  livraison vérifiable.
- **Tout passe par un endpoint testable au curl**. Le frontend est un
  consommateur, pas le sanctuaire de la logique métier.
- **Mode dégradé doit toujours marcher**. Si tu n'as pas de snapshots,
  l'UI explique au lieu de planter. Si l'LLM annotation échoue, le
  cluster reste "Cluster #5" et c'est OK.
- **MCP first**. Toute nouvelle analytique doit aussi être queryable par
  Claude — c'est ce qui rend l'outil 10× plus puissant qu'un dashboard.
- **Le sandbox protège l'index existant**. Toute opération destructive
  (re-analyze, import écrasant) doit être consciente du staleness +
  poser un check.

---

## 🧩 Graph Platform — feuille de route (P0 → P3) 🚧

> Vision (décidée 2026-06-03, « tout cela » → décomposé) : faire de gitnexus un
> *graph studio* généraliste — templates de graphes multi-domaines + boîte à outils
> théorie-des-graphes + visualisations multiples — au-dessus de l'ASTKG Kùzu
> existant. Deux **sortes** de templates : **import** (construit un graphe depuis
> une source) et **lens** (requête Cypher + viz sauvegardée sur un graphe existant).
> Architecture : **sidecar Kùzu** (un conteneur à nous, pas de backend-fork) →
> préserve le contrat de cohabitation. Décision + alternatives rejetées dans le spec P0.

| # | Sous-projet | Contenu | État |
|---|---|---|---|
| **P0** | **Template SDK + sidecar Kùzu** | Conteneur `gitnexus-graphs` (Kùzu, à nous, cohabitation-safe — zéro patch backend) ; SDK (import + lens, `kind`+`ddl`) ; `research-artifacts` migré sur Kùzu ; rendu via le canvas single-graph. | ✅ **Livré 2026-06-03** — vérifié E2E (scaffold→import→render sur Kùzu via le sidecar). [spec](docs/superpowers/specs/2026-06-03-graph-platform-p0-kuzu-sidecar-design.md) · [plan](docs/superpowers/plans/2026-06-03-graph-platform-p0-kuzu-sidecar.md) |
| **P1** | **SDK prouvé sur 2ᵉ template de chaque sorte (academic-literature import multi-tables + imports-deps lens)** | 1 import-template (ex. littérature académique) + 1 lens-template (ex. call-graph/deps sur l'ASTKG) ; débloque lens-sur-ASTKG (compat version Kùzu). | ✅ **Livré 2026-06-03** |
| → | **Template Library** | **`research-graph`** (import du graphe de connaissances de recherche *curé* : Hypothesis/Experiment/Verdict/SDR + edges sémantiques `tests`/`validates`/`gated_by`/`supersedes` ; schéma générique `Entity`/`Relates` type-as-property ; réalise le M5 « GitNexus registration » d'Experiment.Crypto, débloqué par P0/P1) ✅ **Livré 2026-06-03** ([spec](docs/superpowers/specs/2026-06-03-research-graph-import-template-design.md)). Reste backlog : crypto/Experiment.Crypto (réseau de couplage), zettelkasten, research-artifacts++. | 🚧 1/N |
| **P2** | **Boîte à outils théorie-des-graphes** | Centralités, communautés, chemins/cycles, points d'articulation, embeddings — exposés par graphe (endpoints + MCP + overlays). **Décomposé** en P2.1 + P2.2 + P2.3.1 + P2.3.2 (a+b+c, source ASTKG complète) + P2.3.3 (a+b, surfaces de visualisation) — **tous livrés**. | ✅ **Livré** (P2.1·P2.2·P2.3.1·P2.3.2(a/b/c)·P2.3.3(a/b)) |
| **P2.1** | **Centralité + communautés (v1)** | Module pur-JS zéro-dép sur la forme commune `{nodes,edges}` : degree + PageRank (power-iteration) + Louvain (modularité). Endpoint `GET /graph/metrics/:name` + outil MCP `gitnexus_graph_metrics` + overlay (taille=PageRank, couleur=communauté). Source = graphes **sidecar** (research/academic/research-graph). [spec](docs/superpowers/specs/2026-06-03-graph-platform-p2-1-graph-theory-design.md) · [plan](docs/superpowers/plans/2026-06-03-graph-platform-p2-1-graph-theory.md) | ✅ **Livré 2026-06-03** |
| **P2.2** | **Compléter les centralités (betweenness + eigenvector + sélecteur)** | Betweenness (Brandes) + eigenvector (power-iteration), pur-JS, ajoutés à `computeMetrics` ; overlay gagne un sélecteur de métrique (taille = degree/pagerank/betweenness/eigenvector, couleur reste = communauté) ; endpoint/MCP inchangés (champs traversent). [spec](docs/superpowers/specs/2026-06-03-graph-platform-p2-2-betweenness-eigenvector-design.md) · [plan](docs/superpowers/plans/2026-06-03-graph-platform-p2-2-betweenness-eigenvector.md) | ✅ **Livré 2026-06-03** |
| **P2.3.1** | **Compléter le moteur pur-JS (structurel + centralités + communautés)** | Structurel : **points d'articulation + ponts** (Tarjan), composantes connexes, **k-core**, clustering/transitivité, densité. Centralités : **closeness** (Wasserman–Faust), **harmonic**, **Katz** (itération non-normalisée + α clampé à 0.85/Δ — bug de ranking par-normalisation-par-pas attrapé en revue). Communautés : **Louvain à résolution** (défaut γ=1 byte-identique) + **label-propagation** + **Leiden** (mono-niveau + raffinement par connexité, garantit des communautés connexes). `computeMetrics(graph,{community,resolution,seed})` rétro-compatible ; endpoint `?community=louvain\|leiden\|labelprop&resolution=` + args MCP + sélecteur de taille étendu (9 métriques). [spec](docs/superpowers/specs/2026-06-09-graph-platform-p2-3-1-structural-centrality-community-design.md) · [plan](docs/superpowers/plans/2026-06-09-graph-platform-p2-3-1-structural-centrality-community.md) | ✅ **Livré 2026-06-09** |
| **P2.3.2a (B)** | **Métriques sur un lens (ASTKG comme source)** | `computeMetrics` sur une **projection lens du graphe de code** : `GET /graph/metrics/lens/:lensId?repo=` récupère l'ASTKG via `/api/graph` (canal `GITNEXUS_API`, comme `imports-deps` — zéro couplage Kùzu), projette via un registre `LENSES` partagé (aujourd'hui `imports-deps` = graphe d'imports au niveau fichier), exécute `computeMetricsCapped` (garde node-cap : au-delà de 2000 nœuds les métriques super-linéaires sont skippées, `summary.capped`/`omittedMetrics`). Outil MCP `gitnexus_graph_lens_metrics` ; overlay étendu à la vue lens (toggle Metrics + sélecteur de taille). Surface les fichiers-hubs centraux, les **points d'articulation** (deps fragiles), les communautés = modules. [spec](docs/superpowers/specs/2026-06-09-graph-platform-p2-3-2a-metrics-over-lens-design.md) · [plan](docs/superpowers/plans/2026-06-09-graph-platform-p2-3-2a-metrics-over-lens.md) | ✅ **Livré 2026-06-09** |
| **P2.3.2b (B)** | **Collapse file-level complet de l'ASTKG** | Lens `file-graph` : projection `projectFileGraph` repliant **tous** les types de relations (pas juste `IMPORTS` — imports + calls + extends + …) au niveau fichier (une arête par paire, self-loops droppés), enregistrée dans le registre `LENSES` partagé → render (`/graph/lens/file-graph`) + métriques (`/graph/metrics/lens/file-graph`) + MCP gratuits (lens-agnostique, bâti en P2.3.2a). Image plus riche du couplage inter-fichiers que les seuls imports. [spec](docs/superpowers/specs/2026-06-09-graph-platform-p2-3-2b-file-graph-lens-design.md) · [plan](docs/superpowers/plans/2026-06-09-graph-platform-p2-3-2b-file-graph-lens.md) | ✅ **Livré 2026-06-09** |
| **P2.3.2c (B)** | **Niveau symbole + LoD + cache** | Lens `symbol-graph` (`projectSymbolGraph` — projection identité du graphe ASTKG brut au niveau symbole, fonctions/classes/fichiers, sans collapse) ; `?cap=` (node-cap configurable, défaut 2000, max 50000) ; `?approx=<N>` (au-delà du cap, betweenness/closeness/harmonic **estimés** par échantillonnage de N sources — Brandes–Pich, exact si N≥V — au lieu de zéros ; `summary.approximate`/`sampleSize`) ; **cache de résultats** TTL 300s + LRU (clé incluant cap/approx ; `?fresh=1` pour bypass). [spec](docs/superpowers/specs/2026-06-09-graph-platform-p2-3-2c-symbol-level-lod-caching-design.md) · [plan](docs/superpowers/plans/2026-06-09-graph-platform-p2-3-2c-symbol-level-lod-caching.md) | ✅ **Livré 2026-06-09** |
| **P2.3.3a (C)** | **Picker + top-N + export** | Sélecteur de méthode de communauté (re-fetch `?community=`), panneau top-N (classé par la métrique de taille), export JSON/CSV (`metrics-view.ts` pur + testé). [spec](docs/superpowers/specs/2026-06-09-graph-platform-p2-3-3a-picker-topn-export-design.md) | ✅ **Livré 2026-06-09** |
| **P2.3.3b (C)** | **Heatmap + ponts/articulation + isolation** | Coloration heatmap par centralité (`heatColor`), rendu des points d'articulation (halo) + arêtes-ponts (rouge épais), isolation de communauté (dim le reste) — via le 4ᵉ arg `opts` de l'adaptateur de rendu. [spec](docs/superpowers/specs/2026-06-09-graph-platform-p2-3-3b-heatmap-highlight-isolate-design.md) | ✅ **Livré 2026-06-09** · ⚠️ QA visuelle (navigateur) en attente |
| **P2.3 (reste)** | **Au-delà de P2.3.1–3** | Centralités directionnelles, Louvain/Leiden **multi-niveaux** (agrégation super-nœuds), assortativité, diamètre/excentricité, comparaison vs Leiden index-time ASTKG, **embeddings** node2vec/DeepWalk (lourd), couverture MCP complète. Détail : spec P2.1 §6 + P2.2 §6 + P2.3.1 §6. | 💡 Backlog |
| **P3** | **Paradigmes de visualisation** | Décomposé en P3.1 (sélecteur de layout + layout hiérarchique) + P3.2 (matrice d'adjacence) + P3.3 (graphes research/lens en 3D + parité métriques) + P3.4 (nav multigraph). **Tous livrés + QA navigateur.** | ✅ **Livré** (P3.1·P3.2·P3.3·P3.4) |
| **P3.1** | **Sélecteur de layout + layout hiérarchique** | Sélecteur `force \| hierarchical \| circular` sur le canvas research/lens ; `layeredLayout` BFS-rank fait-main (zéro-dép) ; `useSigma.setGraph` gagne `skipLayout` (positions finales, pas de FA2). [spec](docs/superpowers/specs/2026-06-10-graph-platform-p3-1-layout-selector-design.md) | ✅ **Livré 2026-06-10** (QA navigateur) |
| **P3.2** | **Vue matrice d'adjacence** | Toggle graph↔matrix ; canvas N×N ordonné par communauté (blocs), cellules colorées par communauté ; `orderNodes`/`matrixCells` purs ; cap N≤400. [spec](docs/superpowers/specs/2026-06-10-graph-platform-p3-2-adjacency-matrix-design.md) | ✅ **Livré 2026-06-10** (QA navigateur) |
| **P3.3** | **Research/lens en 3D + parité métriques** | `Graph3DCanvas` (était code-graph only) rend les graphes research/lens ; toggle Metrics 3D + sélecteur de taille → couleur communauté + taille centralité ; `researchTo3D` pur ; `COMMUNITY_PALETTE` extrait dans `research-colors.ts` (source unique 2D+3D). [spec](docs/superpowers/specs/2026-06-10-graph-platform-p3-3-research-lens-3d-design.md) | ✅ **Livré 2026-06-10** (QA navigateur) |
| **P3.4** | **Nav multigraph (méta→graphe→nœud→inspecteur)** | `GET /graph/list` (instances sidecar scaffoldées via `readIndex`) + outil MCP `gitnexus_list_graphs` ; `GraphSidebar` Stage 2 (liste les graphes, clic → `?research=` en **préservant `?multigraph=1`**, colonne pleine hauteur) ; `NodeInspector` (champs + métriques du nœud sélectionné, `nodeInspectorData` pur). [spec](docs/superpowers/specs/2026-06-10-graph-platform-p3-4-multigraph-nav-design.md) | ✅ **Livré 2026-06-10** (QA navigateur : liste/nav OK ; inspecteur câblé+testé unitaire) |
| → | **Domaines** | Recherche étendue (académique, zettelkasten, lignée d'expériences/hypothèses), lenses code-intel (call-graph/deps/API/infra/test-coverage), crypto/finance (Experiment.Crypto). **S'empilent comme templates une fois P0–P1 là.** | 📋 Backlog |
| 🔭 | **IA / Model as graph & as code** *(vision long-terme — spec écrite, parquée)* | Un modèle IA *est* un graphe (couches / opérateurs / poids) → le **visualiser** dans gitnexus, faire de l'**observabilité** (quelles zones/couches/neurones s'activent à l'inférence) et de l'**optimisation** au même titre que du code. 3 phases : import « model graph » (HMM-export / ONNX / PyTorch-FX → nœuds = ops/layers/états, arêtes = tensors/transitions), observabilité (statique = théorie des graphes : nœuds morts/dead-weights, hot-paths/centralité ; dynamique = lens overlay activations runtime), optimisation « as code » (analytics + P2 sur le model-graph, diff de versions de modèle). Hors-scope déféré : PAS d'entraînement, PAS de serving/inférence, PAS un remplaçant de profiler/TensorBoard. Vision unifiée = un model-graph est *un import-template de plus* sur le SDK. Dépend de P2 + P3. Spec : [`docs/superpowers/specs/2026-06-03-ia-model-as-graph-vision-design.md`](docs/superpowers/specs/2026-06-03-ia-model-as-graph-vision-design.md). | 💡 Vision parquée |

---

## 🧪 From spec brainstorms

> Auto-generated by `scripts/ghost-from-spec.mjs`. Edits between the markers
> below will be overwritten. Manage ghosts manually in the `## ✅ Déjà livré`
> table or in a Tier subsection above.

<!-- specs:start -->
| Spec | Tier | Title | Endpoint(s) / Composant(s) |
|---|---|---|---|
<!-- specs:end -->

---

## 🔗 Clusters

> Section gérée à la main. Chaque cluster regroupe 2+ ghosts liés thématiquement.
> Les ghosts non-déclarés ici peuvent être auto-groupés par le CORE via leurs
> `dependsOn[]`. Pour stabilité d'id, préférer la déclaration manuelle.

<!-- clusters:start -->
<!-- clusters:end -->
