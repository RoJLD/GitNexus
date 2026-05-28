# GitNexus deployment — Test inventory

> ⚠️ **Phase 1b en attente d'upgrade Node 22 LTS**
> Les tests de cette doc sont documentés mais pas tous implémentés. La
> Phase 1a (helpers, fixture, CI scaffolding) est livrée. La Phase 1b
> (38 fichiers de tests vitest + Playwright) sera livrée après upgrade
> de Node 21 → 22. Voir
> `docs/superpowers/decisions/2026-05-26-defer-node22-upgrade.md`.

Dernière mise à jour automatique : voir `git log tests/README.md`.

## Commandes

| Command | Tourne | Durée cible |
|---|---|---|
| `cd tests && npm run test:smoke` | health + routes attendues | ~30s |
| `cd tests && npm run test:unit` | unit (pures + composants React) | ~30s |
| `cd tests && npm run test:integ` | docker stack + endpoints | ~6min |
| `cd tests && npm run test:e2e` | Playwright sur UI live | ~5min |
| `cd tests && npm test` | unit + integ | ~7min |
| `cd tests && npm run test:all` | tout y compris e2e | ~12min |

Pré-requis local : Rancher Desktop running, **Node ≥ 22 LTS**. CI : `.github/workflows/test.yml`.

## Couverture

### Pure logic units
| Test | Fichier | Couvre |
|---|---|---|
| CSV serializer | `unit/csv-serializer.test.mjs` | `escapeCsvCell`, `toCsv` |
| Entropy math | `unit/entropy-math.test.mjs` | `density`, `modularityRatio`, `entropyForSnapshot` |
| Bus factor | `unit/ownership-bus-factor.test.mjs` | `busFactor`, `topAuthors` |
| Dissonance overlap | `unit/dissonance-overlap.test.mjs` | `clusterPurity`, `misplacedFiles` |
| Ghost parser | `unit/ghosts-parser.test.mjs` | `parseRoadmap` (tables + Tier sections + `warnMissingExpectedBy`) |
| Ghost YAML | `unit/ghosts-yaml.test.mjs` | `renderRoadmapYml` deterministic + `expectedBy` emit |
| Ghost matching | `unit/ghosts-matching.test.mjs` | `matchExpectedLinks` suffix + glob |
| Ghost lifecycle | `unit/ghosts-lifecycle.test.mjs` | `computeStatus` + `parseTargetDate` + expired |
| Ghost registry | `unit/ghosts-registry.test.mjs` | `registerGhostSource` (Update 2 plugin registry) |
| Ghost audit — summary | `unit/ghost-audit-summary.test.mjs` | `computeSummary` |
| Ghost audit — slippage | `unit/ghost-audit-slippage.test.mjs` | `parseTargetDate` + `computeSlippage` |
| Ghost audit — lead time | `unit/ghost-audit-lead-time.test.mjs` | `computeLeadTime` percentiles |
| Ghost audit — churn | `unit/ghost-audit-churn.test.mjs` | `computePlanChurn` cross-snapshot |
| Ghost audit — velocity | `unit/ghost-audit-velocity.test.mjs` | `computeVelocity` rolling window |
| Ghost audit — expired | `unit/ghost-audit-expired.test.mjs` | `computeExpired` (Update 1) |
| Ghost audit — cache | `unit/ghost-audit-cache.test.mjs` | `isCacheValid` |
| Ghost layout — pure | `unit/ghost-layout.test.mjs` | `matchExistingNodes` + `computeGhostLayout` + `tierColor` + `passesFilter` + `derivedStatus` + `DEFAULT_GHOST_FILTERS` |
| Ghost layout — decay | `unit/ghost-layout-decay.test.mjs` | `computeGhostVisualState` (Update 1 du spec — 4 alertLevels) |
| Ghosts client | `unit/ghosts-client.test.mjs` | fetch `/ghosts` + 30s cache + 404 graceful + per-repo + refresh |
| Ghost cleanup prompt | `unit/ghost-cleanup-prompt.test.mjs` | `buildCleanupPrompt` + `parseCleanupResponse` (pure fns) |
| Connectors fuzzy match | `unit/connectors-fuzzy-match.test.mjs` | `tokenize` + `jaccardSimilarity` + `fuzzyMatchTicketToGhost` |
| Connectors Plane | `unit/connectors-plane.test.mjs` | Plane connector — fetchOpenWorkItems / fetchClosedWorkItems (mocked fetch) |
| Gantt layout | `unit/gantt-layout.test.mjs` | computeTimeWindow + dateScale + computeGanttRows |
| Gantt layout — decay | `unit/gantt-layout-decay.test.mjs` | pickBarColor (Update 1) |
| Spec parser | `unit/ghost-from-spec-parser.test.mjs` | deriveId + extractTitle + extractDescription + extractTier + extractExpectedLinks |
| Managed section upsert | `unit/ghost-from-spec-roadmap.test.mjs` | upsertManagedSection (create / upsert / idempotent) |
| Install hooks | `unit/install-brainstorm-hooks.test.mjs` | Claude merge + git-hook template + GHA workflow template |
| SysML — PlantUML renderer | unit/sysml-export-plantuml.test.mjs | safeId + renderPlantUml + tier filter + satisfy + deriveReqt |
| SysML — Mermaid renderer | unit/sysml-export-mermaid.test.mjs | renderMermaid (graph TD + subgraphs) |
| Timeline zoom — pure date/position fns | `unit/timeline-zoom.test.mjs` | computeZoomWindow + mapDateToPosition + mapPositionToDate + snapToNearestSnapshot + applyWheelZoom (anchor-preserving, clamp min span / full range, shift-to-fit — 24 cases) |
| Timeline zoom — useAppState slice | `unit/use-app-state-timeline.test.tsx` | cursorA/B + zoomWindow + graphMode init + auto-swap + mutual exclusion (8 cases) |
| Timeline zoom — intra-repo graph diff | `unit/graph-diff-between-snapshots.test.mjs` | diffBetweenSnapshots alias + edges by triple + empty snapshots (5 cases) |
| Code Wiki — schedule pure fns | `unit/wiki-schedule.test.mjs` | parseAutoEvery (h/d/off/malformed) + isWikiRegenDue (never/elapsed/not-elapsed/broken — 12 cases) |
| Temporal filter — pure client fns | `unit/temporal-filter-modes.test.mjs` | computeStrictFilter + computeNormalFilter (intersection + union) |
| Temporal filter — backend core | `unit/nodes-alive-between-core.test.mjs` | filterSnapshotsInWindow + unionSnapshotNodeIds |
| Temporal filter — useAppState slice | `unit/use-app-state-temporal-filter.test.tsx` | 4 modes + localStorage persist + restore |
| Augmented Timeline — pure fns | `unit/augmented-timeline.test.mjs` | selectGhostsAt (closest-prior + lock mode + empty + before-earliest) + computeTransitions (materializing/cancelling/dedup) + resolveAugmentedTimelineMode (lock + skew tolerance) |
| Augmented Timeline — snapshot ghosts cache | `unit/snapshot-ghosts-cache.test.mjs` | parallel pool fetch + 30s TTL cache hit + cap 50 + abort signal propagation |
| Clusters parser | `unit/ghosts-clusters-parser.test.mjs` | `parseClusters` from ROADMAP.md |
| Clusters auto-derive | `unit/ghosts-clusters-auto-derive.test.mjs` | Union-Find sur `dependsOn` |
| Cluster status | `unit/ghosts-clusters-status.test.mjs` | aggregate + synthesis + expired + override |
| Cluster layout | `unit/cluster-layout.test.mjs` | convex hull + swimlanes + `pointInPolygon` |
| Layout cache | `unit/layout-cache.test.mjs` | `saveLayoutPositions` + `loadLayout` round-trip + version guard + `applyLayoutToGraph` coverage + `clearLayout` + `clearAllLayouts` (5 cases) |
| Lifespan windowed — pure fn | `unit/lifespan-windowed-core.test.mjs` | computeWindowedBuckets (4 buckets + ephemeral filter, 5 cases) |
| Timeline URL — pure fns | `unit/timeline-url.test.mjs` | serializeTimelineToParams + parseTimelineParams (clean-URL set/remove, defaults, validation, round-trip — 9 cases) |

### Components React (unit)
| Test | Fichier | Couvre |
|---|---|---|
| EntropyBadge | `unit/components/EntropyBadge.test.tsx` | Auto-hide <2 points + density display |
| OwnershipPanel | `unit/components/OwnershipPanel.test.tsx` | Render + slider filter + click |
| CouplingPanel | `unit/components/CouplingPanel.test.tsx` | Render + default sort |
| GrowthChart | `unit/components/GrowthChart.test.tsx` | SVG + legend |
| LifespanPanel | `unit/components/LifespanPanel.test.tsx` | Non-empty buckets only |
| LifespanPanel windowed | `unit/components/LifespanPanel.windowed.test.tsx` | Header "(window)" + badge daterange when windowed data present |
| DissonancePanel | `unit/components/DissonancePanel.test.tsx` | Global score + misplaced list |
| DiffBanner | `unit/components/DiffBanner.test.tsx` | Counts + repo names |
| Timeline | `unit/components/Timeline.test.tsx` | Slider + play advances |
| SnapshotsPanel | `unit/components/SnapshotsPanel.test.tsx` | List + delete |
| BulkSnapshotModal | `unit/components/BulkSnapshotModal.test.tsx` | Inputs + confirm |
| Ghost audit — AuditPanel | `unit/components/audit/AuditPanel.test.tsx` | Container render + loading/error/success states |
| Ghost audit — AuditSummary | `unit/components/audit/AuditSummary.test.tsx` | Summary cards + expired counts |
| Ghost audit — GhostTable | `unit/components/audit/GhostTable.test.tsx` | Sortable table + highlightedId sync |
| Ghost audit — LeadTimeHistogram | `unit/components/audit/LeadTimeHistogram.test.tsx` | SVG histogram + percentile lines |
| Ghost audit — PlanChurnList | `unit/components/audit/PlanChurnList.test.tsx` | Top churners + onSelectChurner callback |
| Ghost audit — SlippageBar | `unit/components/audit/SlippageBar.test.tsx` | Stacked bar early/onTime/late/noTarget |
| Ghost audit — VelocitySparkline | `unit/components/audit/VelocitySparkline.test.tsx` | SVG sparkline rolling 28j |
| Augmented graph — GhostTooltip | `unit/components/GhostTooltip.test.tsx` | render + matched/unmatched + Open ROADMAP button |
| Augmented graph — Filters | `unit/components/Filters.test.tsx` | master "Show ghosts" + per-Tier + cancelled toggles |
| Ghost cleanup — CleanupModal | `unit/components/audit/CleanupModal.test.tsx` | closed / empty / populated list with LLM prompts |
| GanttPanel | `unit/components/GanttPanel.test.tsx` | render + filter + swimlanes + sort + CSV |
| GanttAxis | `unit/components/gantt/GanttAxis.test.tsx` | monthly ticks + today line |
| GanttBar | `unit/components/gantt/GanttBar.test.tsx` | 4 kinds rendered |
| GanttRow | `unit/components/gantt/GanttRow.test.tsx` | label + bars area + click |
| ClusterTooltip | `unit/components/ClusterTooltip.test.tsx` | popup render + click member |
| ClustersCard | `unit/components/audit/ClustersCard.test.tsx` | 7ème card + drill-down |
| Augmented Timeline — Animate button | `unit/components/Timeline.augmented.test.tsx` | Animate roadmap button visible + click sets cursor/animationActive/ghostFilters + banner shown when animationActive |

### Stack health
| Test | Fichier | Couvre |
|---|---|---|
| Health + routes | `integration/stack-health.test.mjs` | `/health`, présence des 16 routes |

### Endpoints integration
| Test | Fichier | Couvre |
| Nodes alive between | `integration/endpoints/nodes-alive-between.test.mjs` | GET 200 + 400 missing params + 404 unknown repo + cache hit |
|---|---|---|
| Snapshots | `integration/endpoints/snapshot.test.mjs` | `POST /snapshot`, `GET /snapshots` |
| Snapshots bulk | `integration/endpoints/snapshot-bulk.test.mjs` | `POST /snapshot/bulk` + status |
| Diff | `integration/endpoints/diff.test.mjs` | `GET /api/graph?diff=A,B` |
| Churn | `integration/endpoints/churn.test.mjs` | `/churn` schema + golden |
| Coupling | `integration/endpoints/coupling.test.mjs` | `/coupling` schema + golden |
| Coupling cross | `integration/endpoints/coupling-cross.test.mjs` | `/coupling/cross?repos=` |
| Growth | `integration/endpoints/growth.test.mjs` | `/growth` schema + golden |
| Growth cross | `integration/endpoints/growth-cross.test.mjs` | `/growth/cross?repos=` |
| Lifespan | `integration/endpoints/lifespan.test.mjs` | `/lifespan` buckets + golden |
| Lifespan windowed | `integration/endpoints/lifespan-windowed.test.mjs` | GET 200 global + 200 windowed + 400 partial params + 400 invalid range + alias resolution (5 cases) |
| Code Wiki endpoints | `integration/endpoints/wiki.test.mjs` | `/wiki` 200-html-or-404 + missing-repo 400 + `/wiki/status` 200-or-502 shape + `/wiki/generate` 202/409/404/502 proxy |
| Entropy | `integration/endpoints/entropy.test.mjs` | `/entropy` schema + range + golden |
| Ownership | `integration/endpoints/ownership.test.mjs` | `/ownership` bus factor + golden |
| Dissonance | `integration/endpoints/dissonance.test.mjs` | `/dissonance` schema + range + golden |
| Semantic labels | `integration/endpoints/semantic-labels.test.mjs` | `/semantic-labels` GET + POST |
| CSV format universel | `integration/endpoints/csv-format.test.mjs` | `?format=csv` sur 7 routes |
| Export / Import | `integration/endpoints/export-import.test.mjs` | `/export` bundle + indexOnly |
| Ghosts sync | `integration/endpoints/ghosts-sync.test.mjs` | `POST /ghosts/sync` idempotent |
| Ghosts read | `integration/endpoints/ghosts.test.mjs` | `GET /ghosts` 404/200 |
| Ghosts at commit | `integration/endpoints/ghosts-at.test.mjs` | `GET /ghosts/at` historical snapshot |
| Ghosts in snapshot | `integration/endpoints/ghosts-snapshot.test.mjs` | snapshot auto-sync writes ghosts.json per dir |
| Ghost audit endpoint | `integration/endpoints/ghost-audit.test.mjs` | `GET /ghost-audit` shape |
| Ghost audit cache | `integration/endpoints/ghost-audit-cache.test.mjs` | mtime invalidation flow |
| Ghost cleanup prompt | `integration/endpoints/ghost-cleanup-prompt.test.mjs` | `POST /ghosts/cleanup-prompt` expired list + prompts |
| Ghost connector suggestions | `integration/endpoints/ghost-connector-suggestions.test.mjs` | `GET /ghosts/connector-suggestions` empty-config + Plane path |
| Brainstorm-hook e2e | `integration/endpoints/brainstorm-hook-e2e.test.mjs` | script run → ROADMAP managed section → CORE parser emits planned ghost |
| SysML endpoint | integration/endpoints/sysml-export.test.mjs | GET 200 (text/plain), 400 missing repo, 400 invalid format |
| MCP ghost_audit | `integration/mcp/ghost_audit.test.mjs` | stdio JSON-RPC tool call |
| Clusters endpoint | `integration/endpoints/clusters.test.mjs` | `GET /clusters` 200/400/404 + filter |

### UI flows e2e
| Test | Fichier | Couvre |
|---|---|---|
| Home + repo list | `e2e/specs/01-analyze-and-snapshot.spec.ts` | Home loads, lists sample-repo |
| Timeline navigation | `e2e/specs/02-timeline-navigation.spec.ts` | Slider + play/pause |
| Panels render | `e2e/specs/03-analytics-panels.spec.ts` | 5 panels open, render content |
| CSV download | `e2e/specs/04-csv-download.spec.ts` | Download icon → .csv file |
| Diff view | `e2e/specs/05-diff-view.spec.ts` | Diff banner appears |
| E2E audit panel | `e2e/specs/03-ghost-audit-panel.spec.ts` | panel renders + churner highlight |
| Augmented graph | `e2e/specs/04-augmented-graph.spec.ts` | "Show ghosts" master toggle → per-Tier + cancelled sub-toggles visibles |
| Gantt panel | `e2e/specs/05-gantt-panel.spec.ts` | toggle button + swimlanes |
| Timeline zoom + cursor diff | `e2e/specs/timeline-zoom-and-diff.spec.ts` | Cursors A/B render + Zoom button + Compare button + Z & Shift+D shortcuts + duration indicator + mousewheel zoom in/out (Task 11 diff coloring wiring deferred) |
| Timeline Temporal Filter | `e2e/specs/timeline-temporal-filter.spec.ts` | 4 modes dropdown + localStorage + backend call (permissive) + composition with Compare A↔B (8 cases) |
| E2E cluster halos | `e2e/specs/06-cluster-halos.spec.ts` | toggle + halo + tooltip |
| E2E Augmented Timeline | `e2e/specs/07-augmented-timeline.spec.ts` | Scrub cursorB with ghosts ON (skip if no snapshots) + Animate roadmap button shows banner |
| Lifespan windowed | `e2e/specs/lifespan-windowed.spec.ts` | Header + badge toggle on filter mode change (3 cases) |
| Timeline URL persistence | `e2e/specs/timeline-url-persistence.spec.ts` | write tl* params (filter+compare) + reload restore + clear on default + zoom param write/clear (4 cases) |
| Code Wiki panel | `e2e/specs/wiki-panel.spec.ts` | open Wiki panel (iframe or empty-state) + Regenerate fires POST /wiki/generate (2 cases) |

## Tests désactivés / connus fragiles

| Test | Statut | Pourquoi |
|---|---|---|
| (aucun pour l'instant) | | |

## Comment ajouter un test

1. Identifier la famille (unit / integration endpoint / e2e).
2. Copier un test existant de la même famille comme template.
3. Ajouter une ligne dans le bon tableau ci-dessus.
4. Lancer la suite localement, vérifier vert.
5. Push, vérifier que GH Actions passe.
6. Le check `inventory-check` du workflow fait échouer toute PR qui crée un test sans l'inscrire ici.
