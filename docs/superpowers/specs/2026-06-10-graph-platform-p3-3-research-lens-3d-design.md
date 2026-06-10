# Graph Platform — P3.3: research/lens graphs in 3D + metrics parity — Design

**Date**: 2026-06-10
**Status**: current
**Builds on**: the existing `Graph3DCanvas` (react-force-graph-3d, code-graph-only), the
research/lens render path (`research-client`: `getResearchGraph`/`applyLens`), the metrics
client (`graph-theory-client`: `getGraphMetrics`/`getGraphLensMetrics`), and the P2.3.3b
overlay palette (`COMMUNITY_PALETTE`, now exported).
**Decomposes**: P3 → P3.1 (done) + P3.2 (done) + **P3.3 (this)** + P3.4 (multigraph nav).

## 1. Context / problem

`Graph3DCanvas` renders only the **code graph** (`useAppState().graph`); it ignores
`?research`/`?lens` and has no metrics integration. So toggling 2D→3D on a research/lens graph
shows nothing relevant, and the P2 metrics (community/centrality) the 2D overlay surfaces have no
3D equivalent. P3.3 teaches the 3D canvas the research/lens path **and** metrics parity, so the
2D/3D toggle works on research/lens graphs with community color + centrality size.

## 2. Goal

When `?research`/`?lens` is active, `Graph3DCanvas` fetches that render (like GraphCanvas) and
draws it in 3D; a **Metrics** toggle + **size-metric** selector (parity with the 2D overlay)
color nodes by **community** and size them by a chosen **centrality** (fetched via the same
metrics endpoints). Research/lens nodes are display-only (no code-panel). The code-graph 3D path
is unchanged when no research/lens param is present. Dep-free, frontend-only.

## 3. Design

### 3.1 Pure mapping — `upstream/gitnexus-web/src/lib/research-to-3d.ts` (new, unit-tested)

```ts
import type { ResearchGraph } from './research-graph-adapter';
export interface Node3DLite { id: string; name: string; label: string; baseColor: string; val: number; research: true }
export interface Link3DLite { source: string; target: string; type: string; baseColor: string }

/** Map a ResearchGraph (+ optional metrics) to the 3D node/link shapes. Community color +
 *  centrality size when metricsById present, else research-type color + fixed size. Dedups
 *  edges, drops self-loops + dangling. Pure. */
export function researchTo3D(
  rg: ResearchGraph,
  metricsById?: Map<string, { community: number } & Record<string, number>>,
  sizeBy?: string,
): { nodes: Node3DLite[]; links: Link3DLite[] }
```

- **Nodes:** for each `rg.nodes` (dedup by id) → `{ id, name: node.label, label: node.type,
  baseColor, val, research: true }`. With metrics: `baseColor = COMMUNITY_PALETTE[m.community %
  len]`, `val = 2 + 8·sqrt((m[sizeBy] ?? 0)/maxV)` (maxV = max of `sizeBy` across the map, ≥1e-9).
  Without: `baseColor = RESEARCH_COLORS[type] || RESEARCH_FALLBACK_COLOR`, `val = 4`.
- **Links:** `rg.edges` with both endpoints present, `source !== target`, deduped per
  `(source,target)` → `{ source, target, type: kind, baseColor: '#475569' }`.
- Pure, deterministic, no THREE/DOM. The testable core. (`COMMUNITY_PALETTE`/`RESEARCH_COLORS`
  imported from the existing libs.)

### 3.2 `Graph3DCanvas` — research/lens data path + metrics

- Read `researchName = ?research`, `lensId = ?lens`, `lensRepo = ?repo` from the URL (mirror
  GraphCanvas).
- A fetch effect: when `researchName` → `getResearchGraph(researchName)`; else when `lensId &&
  lensRepo` → `applyLens(lensId, lensRepo)`; → local `researchData` state (else null).
- `metricsOn` state + a metrics fetch effect: when `metricsOn && (researchName || (lensId &&
  lensRepo))` → `getGraphMetrics(researchName)` / `getGraphLensMetrics(lensId, lensRepo)` → a
  `metricsById3D` map (id → {community, + numeric metrics}); cleared when off. (Cancellation guard,
  like GraphCanvas.)
- `sizeMetric3D` state (`SizeMetric` union, default `pagerank`).
- **`data` branch:** the `data` useMemo gains a research/lens branch — when `researchData` is set,
  return `researchTo3D(researchData, metricsOn ? metricsById3D : undefined, sizeMetric3D)` (mapped
  to the component's `Node3D`/`Link3D` — the `Node3DLite` fields are a subset; set `raw: undefined`
  + `research: true`). When no research/lens → today's code-graph build (unchanged).
- **Node typing:** `Node3D.raw` becomes optional (`raw?: GraphNode`) + a `research?: boolean` flag.
  `onNodeClick` guards: `if (n.research || !n.raw) return;` before `setSelectedNode(n.raw)` —
  research nodes are display-only (hover name still works). The styling fns (`nodeColorFn`/
  `nodeValFn`/etc.) already fall through to `baseColor`/`val` when there's no `appSelectedNode`/
  highlight (which is the case for research nodes), so community color + centrality size render
  directly.
- **3D overlay controls** (top-right, shown when research/lens active): a **Metrics** toggle
  (`data-testid="metrics-toggle-3d"`) and, when on, a **size-metric** `<select
  data-testid="metric-select-3d">` (the 9 `SizeMetric` options). Placed near the existing "2D"
  button. (The fuller 2D overlay suite — heatmap/highlight/isolate/community-picker/top-N/export —
  is **not** ported in v1; 3D parity = community color + size-by-metric.)

### 3.3 Out of scope (→ later)

Heatmap/highlight/isolate/community-method-picker/top-N/export in 3D; click-to-inspect for research
nodes; depth-filter/diff on research nodes; layout selector in 3D; the adjacency matrix in 3D.
P3.4 (multigraph nav). No new deps, no server/MCP/Dockerfile change.

## 4. Testing

- **Unit** (`tests/unit/research-to-3d.test.mjs`, new): `researchTo3D` — no-metrics path uses
  research-type colors + fixed val + `research:true`; with-metrics path uses community palette +
  size scaled by the chosen metric (bigger metric → bigger val); edges dedup + self-loop/dangling
  drop; node `name`/`label` mapping (name=label text, label=type).
- **Web build** type-checks the `Node3D` optional-`raw` change + the data branch + controls.
- **Browser-QA** (Playwright): load `?research=qa`, click the **3D** button (toggleViewDimension) →
  the research graph renders in 3D (screenshot the three.js canvas); toggle the 3D Metrics on →
  nodes recolor by community + resize; toggle back to **2D**. 0 console/page errors.

## 5. Scope boundaries

- **In:** `research-to-3d.ts` (pure) + `Graph3DCanvas` research/lens fetch + `data` branch +
  optional-`raw`/`research` node flag + a 3D Metrics toggle & size-metric selector (community
  color + centrality size).
- **Out:** §3.3.
- Frontend-only, dep-free. The code-graph 3D path is **unchanged** when no `?research`/`?lens`
  (the `data` branch only triggers on `researchData`); `raw` going optional is additive (code-graph
  nodes still set it). No server/MCP/Dockerfile.web change.

## 6. Open questions

- **3D val scaling** (`2 + 8·sqrt`) — a guess vs the code-graph `NODE_SIZES`; tune in visual-QA so
  research nodes read at a comparable scale.
- **Selection of research nodes** — display-only in v1 (no code symbol behind them); a research-node
  inspector (showing metrics/anchor) is a later enhancement, shared with a 2D equivalent.
- **Force layout in 3D** — react-force-graph-3d runs its own d3-force-3d; the P3.1 layered/circular
  layouts are 2D-only. A 3D layered layout is future.
