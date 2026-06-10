# Graph Platform — P2.3 backlog: directed metrics, multi-level community, spectral embeddings

**Date**: 2026-06-10
**Status**: current
**Related**: `2026-06-03-graph-platform-p2-graph-theory-design.md` (the P2 toolkit
this extends), the P2.3.1/.2/.3 shipped slices. ROADMAP.md → "Graph Platform" →
P2 backlog row. Engine: `upstream/docker-server-graph-theory-core.mjs`; routes:
`upstream/docker-server-graph-theory.mjs`.

## 1. Context / problem

P2 shipped a complete **undirected, single-level, structural** graph-theory
toolkit: degree/PageRank/betweenness/eigenvector/closeness/Katz/harmonic
centralities, Louvain/Leiden/label-prop community, and structural metrics
(components, articulation/bridges, k-core, clustering). Three capabilities were
explicitly deferred to the P2.3 backlog because the P2/P3 surfaces had to land
first:

1. **Direction is thrown away.** `undirectedAdj` symmetrizes every edge, so an
   `IMPORTS`/`CALLS`/`transition` edge — which is inherently directed — is
   analyzed as if it were bidirectional. The one exception is PageRank (already
   uses out-adjacency). For a code graph (who-calls-whom) or a model graph
   (tensor flow), direction carries most of the signal.
2. **Community is single-level.** Louvain/Leiden run local-moving once and stop;
   there is no super-node aggregation, so the natural *hierarchy* of modules
   (function → file → package) is invisible. Real Louvain is multi-level.
3. **No embeddings.** There is no vector representation of nodes, so we can't do
   structural similarity (nearest-neighbour "which nodes play the same role"),
   spectral layout, or feed a downstream clusterer.

These are the last graph-theory gaps before the engine is "complete enough" to
point at the IA/Model-as-graph vision (which depends on exactly these: directed
hot-path analysis, module hierarchy, structural similarity of ops).

## 2. Goal

The metrics engine analyses **directed** graphs when asked, exposes the **full
community hierarchy**, and produces a **spectral embedding** per node — all three
through the existing `/graph/metrics/:name` and `/graph/metrics/lens/:lensId`
routes (new opt-in query params), the same pure-JS zero-dep engine, the same
response envelope (additive fields), and the same MCP tools. No new route, no new
service, no new dependency. Backward compatible: absent the new params, responses
are byte-identical to today.

## 3. Design

All three are **additive, opt-in** extensions of `computeMetrics` /
`computeMetricsCapped`, gated by new query params parsed in `parseMetricsParams`.
The universal `{nodes:[{id}], edges:[{source,target}]}` shape and the existing
helpers (`nodeIds`, `cleanEdges`, `mulberry32`, the power-iteration pattern from
`eigenvector`) are reused throughout.

### 3.1 Directed metrics — `?directed=1`

A new `directedAdj(graph)` helper returns `{ ids, out, in }` neighbour lists over
the **direction-preserving** cleaned edge set (`cleanEdges` already returns
ordered `[s,t]`; today only the undirected path consumes it). When `directed` is
set, `computeMetrics` additionally computes and emits per node:

| Field | Algorithm | Notes |
|---|---|---|
| `inDegree`, `outDegree` | count over `in`/`out` adjacency | always cheap; the existing combined `degree` stays |
| `hubs`, `authorities` | **HITS** — power iteration on `a ← Aᵀh`, `h ← Aa`, L2-normalize each step, to convergence | reuses the eigenvector iteration shape; the canonical directed centrality pair |
| `sccId` | **strongly-connected components** — iterative (stack-based) Tarjan | distinct from the existing weakly-connected `componentId`, which is retained |
| `betweenness` (directed variant) | Brandes on **out-adjacency**, normalized by `(N−1)(N−2)` (no `/2`) | only when `directed`; replaces the undirected betweenness in the response |

**Kept undirected even in directed mode:** eigenvector, Katz, closeness,
harmonic, community, clustering, k-core, density. Rationale: directed eigenvector
needs the dominant left/right eigenvector pair (that *is* HITS, which we add
separately); directed Katz/closeness/harmonic are definable but low marginal
value for these graphs and would multiply the test surface — deferred, noted in
`summary`. `summary` gains `directed: true|false`; in directed mode it also
carries `stronglyConnectedComponentCount`.

**Rejected:** a separate `/graph/metrics/directed/...` route. Direction is a
property of *how you analyse the same graph*, not a different resource — a query
param is the honest model and keeps the cache key / MCP surface uniform.

### 3.2 Multi-level community — `?hierarchy=1`

A new `louvainMultiLevel(graph, {seed, resolution})` performs the **full** Louvain:

1. Local-moving (the existing `louvain` logic, extracted to operate on a weighted
   adjacency) produces level-0 communities.
2. **Aggregate**: build a weighted super-graph where each community becomes one
   node and edge weights sum (self-loops = intra-community weight).
3. Recurse on the super-graph; map super-node communities back down to original
   node ids → level 1, level 2, …
4. Stop when a level produces no merges (modularity no longer improves).

Returns `levels: [{communities:{id→c}, modularity, communityCount}]`, finest
first. When `?hierarchy=1`, the response gains:

```
hierarchy: { levelCount, levels: [{ modularity, communityCount }] }
```

and each node gains `communityPath: [c0, c1, …, c_{L-1}]` (its community id at
each level). The flat `community` field stays = level-0 (back-compat). The UI can
later add a level slider reading `communityPath[level]`; that UI is **out of
scope here** (engine + API + response only; a follow-up does the slider).

**Resolution + seed** flow through unchanged. Leiden multi-level (refinement at
every level) is **deferred** — single-level Leiden stays; multi-level is Louvain
only for now (noted in `summary.hierarchyMethod = 'louvain'`).

**Rejected:** returning the full per-node dendrogram tree object. The flat
`communityPath` array per node + per-level summary is everything the UI needs and
is trivially cacheable/serializable; a nested tree is harder to diff and render.

### 3.3 Spectral embeddings — `?embed=spectral&dims=<k>`

A new `spectralEmbedding(graph, {dims=8, seed=1})` computes **Laplacian
eigenmaps** via the same power-iteration machinery already proven in
`eigenvector`:

1. Build the symmetric normalized adjacency  Â = D^{-1/2} A D^{-1/2}  (undirected;
   isolated nodes → zero row, handled).
2. Find the top `k+1` eigenvectors of Â by **power iteration with Gram–Schmidt
   deflation** (orthogonalize each candidate against all previously-found
   eigenvectors every iteration — the same trick as eigenvector centrality,
   extended to multiple vectors).
3. **Discard the trivial top eigenvector** (≈ D^{1/2}·1, eigenvalue 1 — the
   constant component, carries no structure), keep the next `k` → each node's
   `embedding: [e_1 … e_k]`. (Top eigenvectors of Â = smallest non-trivial
   eigenvalues of the normalized Laplacian L = I − Â, i.e. classic Laplacian
   eigenmaps.)

`dims` defaults to 8, clamped to `[2, min(32, N−1)]`. When `?embed=spectral`,
each node gains `embedding: number[]` and `summary.embedding = { method:
'spectral', dims }`. Embeddings are **skipped on capped graphs** (super-linear-ish
and large-N is where eigen-iteration is slow); `summary.omittedMetrics` reports
it, consistent with the existing cap behaviour.

**Use cases this unlocks (consumers, not built here):** kNN structural similarity,
a spectral layout option (first 2–3 dims feed P3.1's `layeredLayout` sibling),
and embedding-seeded clustering. The embedding is **display/analysis data** in the
response; wiring it into a similarity panel or a layout is a follow-up.

**Rejected — node2vec/DeepWalk:** random-walk + skip-gram needs SGD with negative
sampling; in pure JS with no numeric lib that's a large, slow body of code for
marginal gain at our graph sizes (≤ a few thousand nodes). **Rejected —
feature-fingerprint:** concatenating already-computed metrics is a re-packaging,
not a structural embedding; it gives the consumer nothing they couldn't compute
from the existing fields.

### 3.4 API, cache, MCP, response envelope

- `parseMetricsParams` gains: `directed` (bool, `'1'`/`'true'`), `hierarchy`
  (bool), `embed` (`'spectral'` | absent — unknown value → 400), `dims`
  (pos-int via `parsePosInt`, clamped engine-side). All optional; defaults
  preserve today's behaviour exactly.
- `metricsCacheKey` extends with `|directed|hierarchy|embed|dims` so the cache
  never serves a reduced payload for a richer request (the bug class the existing
  key already guards against).
- MCP `gitnexus_graph_metrics` + `gitnexus_graph_lens_metrics` gain the same
  optional params (passed through to the query string); their source-text tests
  assert the new params reach `callWeb`.
- Response stays additive: existing fields unchanged; new fields appear only when
  their param is set. This is verified by a "params off → identical to baseline"
  test.

### 3.5 Verification posture (matches P2)

- **Unit (host-native vitest)** is the primary gate — every new engine function
  gets focused tests with hand-checkable fixtures:
  - directed: a known DAG (in/out-degree exact; HITS hub/authority ordering on the
    classic 2-hub/2-authority bipartite-ish example; SCC on a graph with a known
    2-cycle + a singleton; directed vs undirected betweenness differ on a directed
    path).
  - hierarchy: a graph of clear nested clusters (two pairs that merge into one
    cluster at the coarser level) → assert level count ≥ 2 and that level-1
    communityCount < level-0.
  - spectral: a barbell/two-clique graph → assert the first non-trivial dim
    separates the two cliques (sign split), and dims/clamp behaviour.
  - additivity: params-off response deep-equals the pre-change response.
- **Route tests**: `parseMetricsParams` accepts/rejects the new params (bad
  `embed`, non-int `dims` → throw → 400); cache key changes with each new param.
- **MCP source-text tests** for the passthrough.
- **Web image build** (tsc gate) only if the frontend touches anything — for this
  milestone the frontend change is *optional/minimal* (see scope), so the engine
  + routes + MCP are the deliverable; any UI is a thin read of additive fields.
- Drift-check green on every commit; patches regenerated by the controller.

## 4. Scope boundaries

**In scope:** the three engine capabilities, their query params, cache-key +
MCP passthrough, response envelope additions, and full unit/route/MCP tests.

**Out of scope (explicit, deferred):**
- **Frontend UI** for these — no community-level slider, no similarity/kNN panel,
  no spectral-layout option in P3.1's selector. The engine returns the data;
  consuming it in the canvas is a separate follow-up slice. (A minimal "directed
  toggle wired to the existing overlay" *may* be included if cheap, but is not
  required for this milestone to be complete.)
- Directed eigenvector/Katz/closeness/harmonic (HITS covers the directed-centrality
  need; the rest deferred).
- Multi-level **Leiden** (Louvain-only hierarchy for now).
- node2vec/feature embeddings (spectral only).
- Weighted-edge support beyond the implicit multiplicity already in `louvain`'s
  aggregation (edge `weight` props are still ignored; that's a separate backlog
  item).

## 5. Open questions

- **`dims` default (8) vs lower.** 8 is a reasonable structural-similarity default;
  if eigen-iteration convergence is slow on the larger lens graphs we may lower the
  default or tighten the cap. Settle empirically during build (the cap already
  skips embeddings on large graphs, so this is a tuning detail, not a blocker).
- **Directed betweenness replacing vs supplementing the undirected one.** Spec
  says *replace in directed mode* (cleaner, one `betweenness` field). If a consumer
  ever needs both at once we revisit; not anticipated.
