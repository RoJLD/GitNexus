# Graph Platform — P2.3.1: structural algorithms + remaining centralities + community methods — Design

**Date**: 2026-06-09
**Status**: current
**Builds on**: `2026-06-03-graph-platform-p2-2-betweenness-eigenvector-design.md` (the pure-JS
engine + `/graph/metrics/:name` + MCP tool + overlay size-metric selector).
**Decomposes**: the P2.2 spec §6 "Deferred to P2.3" backlog → **P2.3.1 (this slice)** +
**P2.3.2 (ASTKG-as-source, "B")** + **P2.3.3 (visualization surfaces, "C")**.

## 1. Context / problem

P2.1 and P2.2 built a pure-JS, zero-dep graph-theory engine over the common
`{nodes,edges}` sidecar render shape, exposed via `GET /graph/metrics/:name`, the
`gitnexus_graph_metrics` MCP tool, and a node overlay with a size-metric selector.
The engine currently computes **degree, PageRank, betweenness, eigenvector**
centrality + **Louvain** communities — the centrality trio plus one community method.

The P2.2 §6 backlog ("Deferred to P2.3") is not one feature: it spans pure-JS
**structural algorithms**, **more centralities**, **more community methods**,
**embeddings**, a new **ASTKG source**, and **visualization surfaces**. Those are
independent subsystems with different infra costs, so P2.3 is split:

- **P2.3.1 (this slice)** — everything that is *pure-JS over the existing surface*:
  structural algorithms (A) + the remaining centralities and community methods (D).
  Zero new infrastructure; directly parallels P2.2.
- **P2.3.2 ("B")** — run metrics over the **code graph** (the ASTKG via the
  `GITNEXUS_API` internal channel, like the `imports-deps` lens), with the caching
  and large-graph handling that requires. *Deferred — recorded in the roadmap.*
- **P2.3.3 ("C")** — visualization **surfaces**: centrality heatmap coloring,
  community-method picker, bridge/articulation rendering, community filter/isolate,
  top-N panel, metrics export (CSV/JSON). *Deferred — recorded in the roadmap.*

Embeddings (node2vec/DeepWalk) and directed-graph variants stay deferred beyond P2.3.

## 2. Goal

The engine computes the full set of **structural** algorithms (articulation points,
bridges, connected components, k-core, clustering coefficient/transitivity, density),
the remaining **centralities** (closeness, Katz, harmonic), and **three** community
methods (resolution-tunable Louvain, label propagation, Leiden). `/graph/metrics/:name`
surfaces all of it **backward-compatibly** (existing fields/behaviour byte-identical),
with optional query params to choose the community method and resolution. The overlay's
existing size-metric selector gains the new numeric centralities. Pure-JS, zero-dep, no
new container, cohabitation-safe.

## 3. Design

### 3.1 Engine — new pure-JS functions

All in `upstream/docker-server-graph-theory-core.mjs` (still zero-dep), over the
common `{nodes,edges}` shape, treated **undirected** (consistent with
degree/Louvain/betweenness/eigenvector). All build on the existing `undirectedAdj`
helper.

**Structural (A):**

- **`connectedComponents(graph)`** → `Map<id, componentId>` (BFS flood-fill, component
  ids assigned in node-iteration order so the result is deterministic). Summary gets
  `componentCount`.
- **`articulationPointsAndBridges(graph)`** → `{ articulation: Set<id>, bridges: Array<[u,v]> }`
  via **Tarjan low-link**: a single DFS per component (forest over a disconnected graph),
  tracking `disc`/`low`; a non-root `u` is an articulation point if some child `c` has
  `low[c] >= disc[u]`; the root is one iff it has ≥2 DFS children; edge `(u,c)` is a bridge
  iff `low[c] > disc[u]`. Iterative DFS (explicit stack) to avoid recursion-depth limits on
  large graphs. Bridges emitted with `u`/`v` in the graph's node-id order for determinism.
- **`kCore(graph)`** → `Map<id, coreness>` by **degeneracy peeling**: repeatedly remove the
  min-degree node, recording the core number; standard bucket/linear implementation.
- **`clusteringCoefficient(graph)`** → `Map<id, coeff>` local clustering
  `2·(triangles through v) / (deg(v)·(deg(v)−1))` (0 when deg<2), plus **global
  transitivity** `3·triangles / triads` for the summary. Triangle counting over the
  undirected adjacency (intersect neighbour sets).
- **`density(graph)`** → `2E / (N·(N−1))` undirected (0 when N<2). Summary field.

**Centrality (D):**

- **`closeness(graph)`** → BFS shortest paths from each node; **component-aware
  Wasserman–Faust**: `C(v) = (r−1)/Σd · (r−1)/(N−1)` where `r` = reachable count
  (including v), `Σd` = sum of distances to reachable nodes. Isolated node → 0. This is
  robust on disconnected graphs (does not divide by an infinite distance).
- **`harmonic(graph)`** → `Σ_{u≠v} 1/d(v,u)` over reachable `u`, normalized by `(N−1)`;
  unreachable pairs contribute 0 (natively disconnection-safe). Same BFS sweep as closeness.
- **`katz(graph, {alpha = 0.1, beta = 1})`** → power iteration `x ← α·A·x + β` until L2
  convergence (`tol = 1e-9`, `maxIter = 200`), then L2-normalize. **α=0.1 is a safe default**
  (Katz requires `α < 1/λmax`; we do not compute λmax, so a small fixed α is documented as
  the v1 choice — a λmax-aware α is future work). Edgeless graph → uniform `β`-driven result,
  then normalized; no NaN/divergence.

**Community (D) — three methods:**

- **`louvain(graph, {resolution = 1.0, seed})`** — the existing single-level
  modularity local-moving, **refactored to accept a `resolution` (γ) parameter**: the gain
  uses `γ` in the expected-edges term (`ΔQ ∝ k_{i,in} − γ·(Σtot·k_i)/(2m)`). **Default
  `γ=1.0` keeps the result byte-identical to P2.1/P2.2** (regression-guarded by an existing
  test). Higher γ → more, smaller communities; lower γ → fewer, larger.
- **`labelPropagation(graph, {seed, maxIter = 100})`** — each node adopts the most
  frequent label among its neighbours; ties broken **deterministically** (lowest community
  id, then node id) and node visit order is a seeded permutation (`mulberry32`, the existing
  seeded RNG) so runs are reproducible. Converges when no node changes (or `maxIter`).
  Returns `Map<id, communityId>` with ids renumbered `0..k−1` in first-seen order.
- **`leiden(graph, {resolution = 1.0, seed})`** — Louvain local-moving **+ a refinement
  phase** that splits any internally-disconnected community into its connected
  sub-communities. The refinement is what distinguishes Leiden from Louvain: it
  **guarantees every output community is internally connected** (Louvain can produce
  disconnected communities; Leiden cannot). **Single-level**, matching this engine's
  Louvain — multi-level super-node aggregation is deferred (it would re-architect Louvain
  too; see Open Questions). Pure-JS, seeded-deterministic. Returns `Map<id, communityId>`
  renumbered `0..k−1`.

### 3.2 `computeMetrics` — extended, back-compat

`computeMetrics(graph, { community = 'louvain', resolution = 1.0, seed } = {})`:

- **Per-node** fields become
  `{ id, degree, pagerank, betweenness, eigenvector, closeness, katz, harmonic, coreness, clustering, articulation, componentId, community }`.
  Existing fields (`degree, pagerank, betweenness, eigenvector, community`) are
  **byte-identical** under the default options.
- **`articulation`** is a boolean (node is a cut vertex); **`componentId`** is the node's
  connected-component index; **`community`** reflects the **chosen** method
  (`'louvain'` default → unchanged).
- **Top-level `bridges`**: `Array<{ source, target }>` (edge-level — does not fit the per-node
  array). `computeMetrics` maps each `[u,v]` pair from `articulationPointsAndBridges` to
  `{ source: u, target: v }`. Empty array when none.
- **`summary`** gains `density`, `componentCount`, `transitivity`; existing
  `nodeCount, edgeCount, communityCount, modularity` unchanged (`modularity`/`communityCount`
  computed for the chosen method's partition).

Response shape:
```json
{ "nodes": [ { "id": "...", "degree": 0, "pagerank": 0.0, "betweenness": 0.0,
              "eigenvector": 0.0, "closeness": 0.0, "katz": 0.0, "harmonic": 0.0,
              "coreness": 0, "clustering": 0.0, "articulation": false,
              "componentId": 0, "community": 0 } ],
  "bridges": [ { "source": "a", "target": "b" } ],
  "summary": { "nodeCount": 0, "edgeCount": 0, "communityCount": 0, "modularity": 0.0,
               "density": 0.0, "componentCount": 0, "transitivity": 0.0 } }
```

### 3.3 Endpoint — optional query params, default unchanged

`GET /graph/metrics/:name?community=louvain|leiden|labelprop&resolution=<float>`
in `upstream/docker-server-graph-theory.mjs`:

- Parse `community` (default `'louvain'`; unknown value → 400) and `resolution` (default
  `1.0`; non-finite/≤0 → 400). Pass both to `computeMetrics`.
- A bare `GET /graph/metrics/:name` (no query) is **identical to today** — same partition,
  same fields plus the new ones. No callers break.
- Same 404-on-missing / 500-on-compute-error behaviour as P2.2.

### 3.4 MCP — pass-through params + description

`gitnexus_graph_metrics` in `mcp-server/server.mjs`: add optional `community`
(enum `louvain|leiden|labelprop`) and `resolution` (number) args; the handler appends
them to the query string when present. Description updated to list the structural
algorithms + closeness/Katz/harmonic + the three community methods. Returns the full
payload (the caller picks fields), as today.

### 3.5 Overlay — extend the existing size selector only

`upstream/gitnexus-web/src/...`:

- `services/graph-theory-client.ts`: `GraphMetricNode` gains `closeness, katz, harmonic,
  coreness, clustering: number` + `articulation: boolean` + `componentId: number`; a
  `GraphMetrics` wrapper type carries the top-level `bridges` + extended `summary`.
- `lib/research-graph-adapter.ts`: the `sizeBy` union extends to
  `'degree'|'pagerank'|'betweenness'|'eigenvector'|'closeness'|'katz'|'harmonic'|'coreness'|'clustering'`;
  size = `4 + 16·sqrt(value/maxOfThatMetric)` (the existing formula). Non-numeric metrics
  (articulation/componentId/community) are **not** selectable for size. The community-color
  path and the no-metrics path are **unchanged**.
- `components/GraphCanvas.tsx`: the existing size-metric `<select data-testid="metric-select">`
  gains the five new numeric options; the metrics map carries the new fields. `sizeMetric`
  state, cacheKey, and deps already accommodate it (P2.2 wiring).

**Deferred to P2.3.3 ("C"), explicitly not in this slice:** community-method picker UI,
heatmap coloring by a continuous centrality, bridge/articulation rendering, community
filter/isolate, top-N panel, CSV/JSON export.

## 4. Testing (pure, deterministic — synthetic graphs)

Reuse the existing fixtures (`STAR`, `BARBELL`, `PATH3`, `CYCLE4`) and add a couple of
small purpose-built graphs (a 2-component graph; a graph with a clear cut vertex + bridge;
a triangle for clustering).

- **Core** (`tests/unit/graph-theory-core.test.mjs`, extend):
  - *Structural:* barbell → the bridge edge is in `bridges` and the two bridge endpoints are
    articulation points; a 2-component graph → `componentCount===2` and the two halves get
    distinct `componentId`s; a triangle → clustering 1.0 for each node and transitivity 1.0;
    a star → leaf clustering 0; k-core: a triangle has coreness 2, a path has coreness 1;
    density of `K_n` is 1.0; edgeless graph → no bridges, no articulation points,
    `componentCount===N`, density 0.
  - *Centrality:* path A–B–C → B has the highest closeness and harmonic; harmonic is finite
    on a 2-component graph (closeness component-aware, no Infinity); Katz ranks the
    more-connected nodes higher and is finite/positive on a star; edgeless → Katz uniform,
    closeness/harmonic 0.
  - *Community:* `louvain` at `resolution:1` is **byte-identical** to the existing result
    (regression guard); higher resolution yields **≥** as many communities; `labelPropagation`
    on the barbell finds the two cliques (deterministic across seeded runs); `leiden` on the
    barbell finds the two cliques and every returned community is internally connected;
    all three return ids renumbered `0..k−1`.
  - *computeMetrics:* exposes the new per-node fields + top-level `bridges` + summary
    `density`/`componentCount`/`transitivity`; default options keep existing fields
    byte-identical; `community:'leiden'`/`'labelprop'` switch the partition.
- **Endpoint params** (`tests/unit/` or integration): unknown `community` → 400; bad
  `resolution` → 400; bare call returns the new fields with the Louvain default.
- **Client** (`tests/unit/graph-theory-client.test.mjs`, extend): returned nodes carry the
  new numeric fields; the metrics wrapper carries `bridges`.
- **Stack e2e** (final verification, not a committed test): on a real sidecar graph,
  `GET /graph/metrics/:name` returns finite values for every new field and a `bridges`
  array; `?community=leiden` and `?resolution=2` change the partition.

## 5. Scope boundaries

- **In:** the pure-JS structural algorithms (articulation points, bridges, connected
  components, k-core, clustering/transitivity, density), closeness/Katz/harmonic centrality,
  three community methods (resolution-Louvain + label propagation + Leiden), the
  backward-compatible endpoint params + MCP args, and the **size-selector extension** only.
- **Out (recorded in roadmap as later P2.3 parts):** ASTKG-as-source (**P2.3.2/B**); all
  visualization surfaces beyond the size selector — heatmap, community-method picker, bridge
  rendering, filter/isolate, top-N, CSV export (**P2.3.3/C**); directed-graph variants;
  embeddings.
- Pure-JS, zero-dep, no new container, cohabitation-safe (edits an already-COPY'd module +
  already-COPY'd web sources; **no Dockerfile.web change**, mirroring P2.2).

## 6. Open questions

- **Katz α** — v1 ships a fixed `α=0.1` (documented); a λmax-aware α is future work.
- **Which community method colors the overlay** — stays **Louvain (default)** this slice;
  the community-method picker is **P2.3.3 (C)**. The endpoint/MCP already expose all three
  for programmatic use.
- **Leiden refinement determinism** — seeded via `mulberry32`; the test asserts internal
  connectivity of every community rather than an exact partition (refinement order can vary
  while still being correct).
- **Multi-level (aggregation) community detection** — both Louvain and Leiden here are
  **single-level** (local-moving, no super-node aggregation pass). Multi-level aggregation
  (which would benefit both) is deferred; single-level is sufficient at sidecar-graph scale
  and keeps the two methods architecturally consistent.
