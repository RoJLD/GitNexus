# Graph Platform A.1 — encash the engine in the UI

**Date**: 2026-06-11
**Status**: current
**Context**: P2.3-backlog (directed metrics, multi-level community, spectral embeddings),
P-IA.2 (observability), and the render-prop passthrough all shipped, but most of their
output is **API/MCP-only** — the canvas surfaces only the base 9 centralities + flat
community. This slice "encashes" the engine: makes the new fields visible + interactive.

## 1. Context / problem

The metrics engine returns, behind opt-in params, far more than the canvas shows:
- `?directed=1` → `inDegree`/`outDegree`/`hubs`/`authorities`/`sccId` (the size selector
  only offers the 9 undirected centralities; HITS + in/out degree are invisible).
- `?hierarchy=1` → `communityPath[]` per node + `hierarchy.levelCount` (the canvas colors
  only by the single flat `community` — the dendrogram is invisible).
- `?embed=spectral` → `embedding[]` per node (no spectral layout, no similarity view).
The engine work is real but unreachable from the UI. A.1 surfaces four pieces:
directed metrics in the selector, a community-level slider, a spectral layout, and a
kNN similarity panel.

## 2. Goal

On a research/model graph, the user can: pick a **directed metric** (in/out-degree, HITS
hubs/authorities) for size/heatmap; **slide through community levels** (multi-level
Louvain); choose a **spectral layout** (nodes positioned by their embedding); and select a
node to see its **k nearest neighbours by embedding** highlighted + listed. Each is
opt-in; absent it, the canvas is unchanged.

## 3. Design

### 3.1 Client surface — `graph-theory-client.ts`

- `MetricsOpts` gains `directed?: boolean; hierarchy?: boolean; embed?: 'spectral'; dims?: number`.
  `metricsQuery` sets `directed=1`/`hierarchy=1`/`embed=spectral`/`dims=<n>` when present
  (the backend route already parses these).
- `GraphMetricNode` gains optional `inDegree?`, `outDegree?`, `hubs?`, `authorities?`,
  `sccId?`, `communityPath?: number[]`, `embedding?: number[]`.
- `GraphMetrics.summary` gains optional `directed?`, `stronglyConnectedComponentCount?`,
  `embedding?: { method: string; dims: number }`, and `hierarchy?` exposed at the top
  level of `GraphMetrics` as `hierarchy?: { levelCount: number; levels: {...}[]; method: string }`.
- `SizeMetric` stays the 9 base; a separate `DirectedSizeMetric = 'inDegree'|'outDegree'|'hubs'|'authorities'`
  union + a combined `type SizeMetricAny = SizeMetric | DirectedSizeMetric` used by the
  selector when directed is on.

### 3.2 Pure lib — `gitnexus-web/src/lib/embedding-tools.ts` (graphology-free, host-tested)

- `nearestNeighbors(embeddingById: Map<string, number[]>, id: string, k = 8): { id: string; sim: number }[]`
  — cosine similarity of `id`'s vector vs every other node's; top-k by sim desc (tie-break
  id asc); excludes `id` itself; empty/absent → `[]`. Zero-vector guard (sim 0).
- `spectralLayout(embeddingById: Map<string, number[]>, ids: string[], { scale = 300 } = {}): Map<string, { x: number; y: number }>`
  — x = `emb[0]`, y = `emb[1]` (0 if dim absent), centered (subtract mean) + scaled to
  ~`scale` radius (divide by max abs, ×scale). Deterministic; nodes without an embedding →
  origin. Used like `layeredLayout` (precomputed positions).
- Pure, no imports (mirrors `metrics-view.ts`/`graph-diff-view.ts` so vitest loads the `.ts`).

### 3.3 Adapter — `research-graph-adapter.ts`

The adapter's `metricsById` value type widens to include the optional directed fields
(`inDegree?`, `outDegree?`, `hubs?`, `authorities?`) so `sizeBy` can select them; `sizeBy`
type widens to `SizeMetricAny`. New `opts`:
- `communityOverrideById?: Map<string, number>` — when present, a node's community color
  uses `communityOverrideById.get(id) ?? m.community` (the level-sliced community). Additive.
- `precomputedPositions?: Map<string, { x: number; y: number }>` — when present AND
  `layoutMode === 'spectral'`, nodes use these positions (mirroring how
  `layoutMode === 'hierarchical'` uses `layeredLayout`). `layoutMode` union gains `'spectral'`.
- `knnIds?: Set<string>` — when present, those nodes get the highlight attrs
  (`highlighted: true, zIndex: 2`) — reuses the articulation/dead highlight path so the kNN
  set pops. Additive.

All additive: absent the new opts/`sizeBy` values, behavior is byte-identical.

### 3.4 GraphCanvas — toggles, slider, layout option, panel

- **Directed toggle** (`directedOn`): adds `directed: true` to the metrics fetch; when on,
  the size-metric `<select>` gains an optgroup with in/out-degree + hubs + authorities; the
  `metricsById` map is built including those fields from `metricsData.nodes`.
- **Hierarchy + level slider** (`hierarchyOn` + `communityLevel`): `hierarchyOn` adds
  `hierarchy: true` to the fetch; when on AND `metricsData.hierarchy.levelCount > 1`, a
  range slider [0 .. levelCount-1] sets `communityLevel`; GraphCanvas computes
  `communityOverrideById = Map(node.id → node.communityPath[communityLevel])` and passes it
  to the adapter. Label shows "level L / L_max".
- **Spectral layout**: the layout `<select>` gains a `spectral` option; selecting it adds
  `embed: 'spectral'` to the fetch, GraphCanvas builds `embeddingById` from
  `metricsData.nodes[].embedding` and `precomputedPositions = spectralLayout(embeddingById, ids)`,
  passed to the adapter with `layoutMode: 'spectral'`.
- **kNN similarity panel**: when `embed` data is present and a node is selected
  (`useSigma.selectedNode`), a small panel lists `nearestNeighbors(embeddingById, selectedId, 8)`
  (id + sim%); the panel's neighbour set is passed as `knnIds` to highlight them on the
  canvas. A "Similar nodes" toggle gates the panel (and ensures `embed: 'spectral'` is
  fetched). Reuses the existing selected-node plumbing (NodeInspector already reads
  `selectedNode`).

Fetch coalescing: `directed`/`hierarchy`/`embed` are independent opt-ins added to the
single metrics fetch; enabling any triggers a re-fetch (added to the fetch effect deps).
Below all toggles → the fetch + render are unchanged.

### 3.5 Verification

- **Unit (host-native vitest)** — `embedding-tools.test.mjs`: `nearestNeighbors` (cosine
  ranking on hand vectors: a node's nearest is the most-aligned; self excluded; k respected;
  empty → []); `spectralLayout` (x/y from dims 0/1, centered, scaled; missing-embedding →
  origin; deterministic). `graph-theory-client` query test if present (directed/hierarchy/
  embed/dims set in the query string).
- **Web image build (tsc)** gates the adapter + GraphCanvas + client `.ts`/`.tsx`.
- No backend change → patch regen covers only the `gitnexus-web/src` files; drift green.
- Live browser-QA best-effort (dev-stack port hold may block the test stack — report, don't
  claim).

## 4. Scope boundaries

**In scope**: client param/type extension, the pure `embedding-tools` lib, adapter opts
(directed sizeBy, community-level override, spectral positions, kNN highlight), and the
GraphCanvas wiring (directed toggle, hierarchy slider, spectral layout option, kNN panel).

**Out of scope (deferred)**:
- **Edge-weight-aware overlays** (activation edge-width, weighted-edge metrics) — a separate
  follow-up now that the sidecar passthrough is deployed; A.1 is node-centric surfacing.
- **SCC as a color mode** (color by `sccId`) — the directed toggle surfaces `sccId` in the
  data + `summary.stronglyConnectedComponentCount`; a dedicated SCC color mode is a thin
  follow-up (community color already conveys grouping).
- **kNN on the code-graph lens** + **3D surfacing** of these (Graph3DCanvas) — v1 is the 2D
  research/model canvas.
- **Embedding-seeded clustering** — the embedding is surfaced for layout + similarity; using
  it as a clusterer is later.

## 5. Open questions

- **Similarity metric (cosine).** Cosine is the natural embedding similarity; if euclidean
  proves more intuitive for spectral coords, expose a toggle later.
- **Spectral layout legibility.** First-2-dims is the standard spectral drawing; for graphs
  where dims 2–3 carry the separation, a dim-picker is a follow-up.
- **Slider perf.** Re-coloring on every slider tick recomputes the override map (O(N)) +
  re-renders; fine at canvas sizes (≤ LoD cap). Debounce if it stutters.
