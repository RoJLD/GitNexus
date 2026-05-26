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

### Components React (unit)
| Test | Fichier | Couvre |
|---|---|---|
| EntropyBadge | `unit/components/EntropyBadge.test.tsx` | Auto-hide <2 points + density display |
| OwnershipPanel | `unit/components/OwnershipPanel.test.tsx` | Render + slider filter + click |
| CouplingPanel | `unit/components/CouplingPanel.test.tsx` | Render + default sort |
| GrowthChart | `unit/components/GrowthChart.test.tsx` | SVG + legend |
| LifespanPanel | `unit/components/LifespanPanel.test.tsx` | Non-empty buckets only |
| DissonancePanel | `unit/components/DissonancePanel.test.tsx` | Global score + misplaced list |
| DiffBanner | `unit/components/DiffBanner.test.tsx` | Counts + repo names |
| Timeline | `unit/components/Timeline.test.tsx` | Slider + play advances |
| SnapshotsPanel | `unit/components/SnapshotsPanel.test.tsx` | List + delete |
| BulkSnapshotModal | `unit/components/BulkSnapshotModal.test.tsx` | Inputs + confirm |

### Stack health
| Test | Fichier | Couvre |
|---|---|---|
| Health + routes | `integration/stack-health.test.mjs` | `/health`, présence des 16 routes |

### Endpoints integration
| Test | Fichier | Couvre |
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
| Entropy | `integration/endpoints/entropy.test.mjs` | `/entropy` schema + range + golden |
| Ownership | `integration/endpoints/ownership.test.mjs` | `/ownership` bus factor + golden |
| Dissonance | `integration/endpoints/dissonance.test.mjs` | `/dissonance` schema + range + golden |
| Semantic labels | `integration/endpoints/semantic-labels.test.mjs` | `/semantic-labels` GET + POST |
| CSV format universel | `integration/endpoints/csv-format.test.mjs` | `?format=csv` sur 7 routes |
| Export / Import | `integration/endpoints/export-import.test.mjs` | `/export` bundle + indexOnly |

### UI flows e2e
| Test | Fichier | Couvre |
|---|---|---|
| Home + repo list | `e2e/specs/01-analyze-and-snapshot.spec.ts` | Home loads, lists sample-repo |
| Timeline navigation | `e2e/specs/02-timeline-navigation.spec.ts` | Slider + play/pause |
| Panels render | `e2e/specs/03-analytics-panels.spec.ts` | 5 panels open, render content |
| CSV download | `e2e/specs/04-csv-download.spec.ts` | Download icon → .csv file |
| Diff view | `e2e/specs/05-diff-view.spec.ts` | Diff banner appears |

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
