# Graph Platform — P2.2: betweenness + eigenvector + metric selector — Design

**Date**: 2026-06-03
**Status**: current
**Builds on**: `2026-06-03-graph-platform-p2-1-graph-theory-design.md` (the engine + endpoint + MCP + overlay).
**Decomposes**: the P2.1 spec §6 / roadmap "P2.2+" backlog → **P2.2 (this slice)** + **P2.3 (the rest)**.

## 1. Context / problem

P2.1 shipped a pure-JS graph-theory engine (degree + PageRank + Louvain) exposed
via `GET /graph/metrics/:name` + the `gitnexus_graph_metrics` MCP tool + a node
overlay (size = PageRank, color = community), over the common `{nodes,edges}`
render shape, for sidecar graphs. The roadmap named the centrality set as
**PageRank / betweenness / eigenvector** — P2.1 delivered only PageRank. P2.2
completes the centrality trio and makes the overlay let the user choose *which*
centrality to visualize. Everything else in the P2.1 §6 backlog stays in P2.3.

## 2. Goal

`computeMetrics` returns **betweenness** and **eigenvector** centrality per node
(alongside degree/PageRank/community), and the overlay gains a **selector** to
size nodes by any of the four centralities. The endpoint and MCP tool surface the
new fields with no shape change. Pure-JS, same surface, no new container.

## 3. Design

### 3.1 Engine — two new pure-JS functions

In `upstream/docker-server-graph-theory-core.mjs` (still zero-dep), over
`{nodes,edges}`:

- **`betweenness(graph)`** — **Brandes' algorithm** (exact betweenness, O(V·E)),
  graph treated **undirected** (consistent with degree/Louvain), result
  **normalized** to [0,1] by the max possible pair count `(N-1)(N-2)/2` (or by the
  observed max, falling back to 0 when N<3). Pure-JS (BFS + dependency
  accumulation — the standard formulation).
- **`eigenvector(graph, {maxIter = 200, tol = 1e-9})`** — eigenvector centrality
  via **power iteration on the (undirected) adjacency matrix** (the PageRank
  machinery minus damping/teleport), L2- or sum-normalized each iteration.
  *Degeneracy handled:* on an edgeless or fully-disconnected graph eigenvector
  centrality is ill-defined; the function returns a safe uniform/zero result
  under the iteration cap rather than diverging or NaN-ing. (The baseline-adding
  variant — Katz — is deferred to P2.3.)
- **`computeMetrics(graph)`** gains two per-node fields:
  `{ id, degree, pagerank, betweenness, eigenvector, community }`. The `summary`
  is unchanged. Existing fields/behavior are byte-identical.

### 3.2 Endpoint + MCP — fields flow through, no shape change

`GET /graph/metrics/:name` returns `computeMetrics(graph)` verbatim, so the two
new per-node fields appear automatically; the handler is **unchanged**. The
`gitnexus_graph_metrics` MCP tool likewise returns them; only its description is
updated to mention betweenness/eigenvector (it returns the full payload — the
caller picks the metric).

### 3.3 Overlay — a size-metric selector

Today the overlay sizes nodes by PageRank (fixed) and colors by community. P2.2
adds a **selector** (a small segmented control / dropdown, shown only when the
"Metrics" toggle is on) to choose which centrality drives **node size**:
`degree | pagerank | betweenness | eigenvector`. **Node color stays = community.**

- `upstream/gitnexus-web/src/services/graph-theory-client.ts`: the
  `GraphMetricNode` interface gains `betweenness: number` + `eigenvector: number`.
- `upstream/gitnexus-web/src/lib/research-graph-adapter.ts`: the optional metrics
  param carries all metrics; a new `sizeBy` argument (`'degree'|'pagerank'|
  'betweenness'|'eigenvector'`, default `'pagerank'`) selects which value drives
  size (normalized by that metric's max across the map). The community-color path
  and the no-metrics path are unchanged.
- `upstream/gitnexus-web/src/components/GraphCanvas.tsx`: a `sizeMetric` state +
  the selector UI (rendered next to the Metrics toggle, only when metrics are on);
  the metrics map carries all four metrics; the render effect passes `sizeBy` to
  the adapter and includes `sizeMetric` in the cacheKey + deps.

*Rejected for v1:* coloring nodes by a continuous centrality (a **heatmap**) — that
is the P2.3 "heatmaps" item; v1 keeps color = community and the selector controls
size only.

## 4. Testing (pure, deterministic — synthetic graphs)

- **Core** (`tests/unit/graph-theory-core.test.mjs`, extend): betweenness on a
  **path** A–B–C (B strictly highest), a **star** (hub highest), the **barbell**
  (the two bridge nodes rank highest); eigenvector ranks the more-connected nodes
  higher and is symmetric on a cycle; `computeMetrics` now exposes `betweenness` +
  `eigenvector`; an edgeless graph degrades (betweenness 0, eigenvector safe).
- **Client** (`tests/unit/graph-theory-client.test.mjs`, extend): the returned
  nodes carry `betweenness` + `eigenvector`.
- **Overlay selector**: a light client/state test where practical; the selector →
  re-size wiring is verified on the live stack.

## 5. Scope boundaries

- **Algorithms:** betweenness + eigenvector centrality **only** (completing the
  trio). No structural algorithms, no embeddings.
- **Surface:** the existing `/graph/metrics/:name` + MCP + overlay; sidecar graphs
  only. Selector controls **size**, color stays community.
- Pure-JS, zero-dep, no new container, cohabitation-safe.

## 6. Deferred to P2.3 (carried over from P2.1 §6, unchanged)

Structural: **articulation points + bridges**, connected components (weak/strong),
k-core, clustering coefficient/transitivity, assortativity, density,
diameter/eccentricity. Community: Leiden, label propagation, multi-level Louvain +
resolution, comparison vs the ASTKG's index-time Leiden. Centrality: closeness,
Katz, harmonic. **Embeddings:** node2vec/DeepWalk. **Sources:** the **ASTKG** (via
`/api/graph`), lenses, group/merged graphs (+ the caching + large-graph handling
they require). **Surfaces:** centrality **heatmap coloring**, community
filter/isolate, **top-N panel**, metrics **export** (CSV/JSON), full MCP coverage.
Synergy with the IA/Model-as-graph vision (dead-weights/hot-paths) + P3.

## 7. Open questions

- **Betweenness directedness** — v1 fixes undirected (matches degree/Louvain);
  a directed-betweenness option is P2.3.
- **Eigenvector vs Katz on disconnected graphs** — v1 ships plain eigenvector with
  the degeneracy guard; Katz (baseline-adding, robust on disconnected graphs) is
  P2.3.
- **Selector default** — `pagerank` (preserves the current overlay's behavior when
  metrics are toggled on).
