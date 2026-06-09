# Graph Platform — P2.3.2c: symbol-level metrics + configurable cap + approximation (LoD) + caching — Design

**Date**: 2026-06-09
**Status**: current
**Builds on**: `2026-06-09-graph-platform-p2-3-2a-metrics-over-lens-design.md` (lens-metrics route,
`computeMetricsCapped`, shared `LENSES`), `2026-06-09-graph-platform-p2-3-2b-file-graph-lens-design.md`
(2nd lens), `2026-06-09-graph-platform-p2-3-1-…-design.md` (the engine).
**Decomposes**: P2.3 part **B**, final step **c** — the heavy, large-graph case. Closes P2.3.2.

## 1. Context / problem

P2.3.2a/b run `computeMetrics` over **file-level** projections of the code graph (~hundreds of
nodes). The raw ASTKG is **symbol-level** — functions/classes/files — typically **thousands**
of nodes. At that scale the engine's super-linear metrics (betweenness O(V·E), closeness/
harmonic O(V·(V+E)), k-core O(V²)) become expensive, and `computeMetricsCapped` currently just
**skips** them above the 2000-node cap, returning `0`. So symbol-level graphs get only the
near-linear metrics, and there is no way to (a) point the engine at the raw symbol graph,
(b) raise the cap when exact computation is still feasible, (c) get *approximate* expensive
metrics instead of zeros on truly large graphs, or (d) avoid recomputing the same heavy result.

P2.3.2c adds all four — the "level-of-detail + caching" the P2.3.2a spec named — closing the
ASTKG-as-source line (B). Visualization surfaces remain P2.3.3.

## 2. Goal

A `symbol-graph` lens exposes the **raw symbol-level** ASTKG to the engine; the metrics routes
accept a **configurable cap** (`?cap=`) and an **approximation** mode (`?approx=<samples>`) that
computes sampled-but-meaningful betweenness/closeness/harmonic instead of skipping them on large
graphs; and a small **result cache** avoids repeating the heavy compute. All pure-JS, no new
container, lens-agnostic plumbing reused (zero new route).

## 3. Design

### 3.1 `symbol-graph` lens — raw projection (no collapse)

`projectSymbolGraph(apiGraph)` in `docker-server-graph-lens-core.mjs`:

```
projectSymbolGraph(graph):
  nodes := graph.nodes (each has id + properties{filePath,name,kind,...})
  out.nodes := for each node with an id:
      { id, type: properties.kind || 'symbol', label: properties.name || id,
        path: properties.filePath || '', stage: '' }
  seen := Set; out.edges := for each relationship r:
      skip if !idSet.has(r.sourceId) || !idSet.has(r.targetId) || sourceId===targetId
      key := `${sourceId}\0${targetId}\0${r.type}`     // dedup exact parallel dupes, keep distinct types
      skip if seen.has(key); seen.add(key)
      { id:`${sourceId}->${targetId}:${r.type}`, source:sourceId, target:targetId, kind:r.type }
  return { schema_type:'symbol-graph', template:'symbol-graph', name:null, source:null,
           nodes: out.nodes, edges: out.edges, report:{nodes,edges} }
```

- **No file collapse** — nodes ARE the symbols. **All** nodes kept (not just edge-touched), since
  isolated symbols are meaningful at this granularity and the caller asked for the raw graph.
  (Contrast: file lenses keep only edge-touched files.)
- Edge dedup per `(source,target,type)` (parallel edges of *different* types kept; exact dupes
  dropped); self-loops dropped. The engine still treats edges undirected/unweighted.
- Registered in `LENSES` as `'symbol-graph'` → render + `/graph/metrics/lens/symbol-graph?repo=`
  + MCP, all free.

### 3.2 Configurable cap — `?cap=<int>`

Extend `parseMetricsParams(searchParams)` (in `docker-server-graph-theory.mjs`) to also parse an
optional `cap`:
- absent → `cap = 2000` (today's default, unchanged);
- present → must be a positive integer; clamped to a hard max `CAP_MAX = 50000` (bound memory/time);
  non-integer/≤0 → 400.
- Returned in the params object and threaded into `computeMetricsCapped(graph, {cap, ...})`.

Both the lens-metrics route and the sidecar route pass it through (the sidecar route already
calls `computeMetricsCapped`). Default behaviour is byte-identical (no `cap` → 2000).

### 3.3 Approximation / LoD — `?approx=<samples>`

Today, above the cap, the super-linear metrics are zeroed. With `?approx=<S>` (S = a positive
integer sample size), the engine instead computes **approximate** betweenness + closeness +
harmonic via **source sampling** (the Brandes–Pich estimator), so large graphs get *estimates*
rather than zeros. k-core + clustering are NOT approximated (k-core is exact O(V²) — gated by the
cap; clustering is local) — `approx` covers the three shortest-path centralities.

New engine functions (pure-JS, in `docker-server-graph-theory-core.mjs`):
- `betweennessApprox(graph, {samples, seed})` — run Brandes from `S` sampled source nodes (seeded
  `mulberry32` selection, distinct sources), accumulate dependencies exactly as full Brandes, then
  **scale each node's score by `V/S`** (the standard unbiased estimator) and apply the same
  undirected `/2` + `(N-1)(N-2)/2` normalization. `S ≥ V` → falls back to exact `betweenness`.
- `closenessApprox(graph, {samples, seed})` + `harmonicApprox(...)` — BFS from `S` sampled
  **pivots**; estimate each node `v`'s distance-sum / harmonic-sum from the pivot distances scaled
  by `V/S`. `S ≥ V` → exact.
- All seeded-deterministic; on `S ≥ V` or tiny graphs they return the exact values (so small-graph
  tests pin them against the exact functions).

`computeMetrics`/`computeMetricsCapped` gain an `approx` option:
- `computeMetricsCapped(graph, {cap, approx, ...})`: when `nodeCount > cap`:
  - `approx` set (a positive S) → compute the three centralities via the `*Approx` fns (sampled),
    keep k-core/clustering **skipped** (still too costly / not sampled), set `summary.approximate =
    true`, `summary.sampleSize = S`, `summary.omittedMetrics = ['coreness','clustering']`.
  - `approx` not set → today's behaviour (skip all five super-linear, `approximate:false`).
  - `nodeCount ≤ cap` → exact (approx ignored; `approximate:false`).

The endpoint parses `approx` like `cap` (optional positive integer; invalid → 400) and threads it.

**Why source-sampling (not subgraph sampling).** Sampling sources/pivots and scaling by V/S is the
standard, theoretically-grounded betweenness/closeness approximation — it preserves the *ranking*
(what users consume) with error shrinking in S, and degrades gracefully to exact at S≥V. Rejected:
inducing a subgraph on top-degree nodes (changes the metric's meaning — paths through omitted nodes
vanish) and per-request arbitrary node sampling (non-deterministic, hard to test).

### 3.4 Result caching

A small in-memory cache in the lens-metrics + sidecar route module
(`docker-server-graph-theory.mjs`), since the web container is long-running:

- **Key**: `${routeKind}|${repoOrName}|${lensId|''}|${community}|${resolution}|${cap}|${approx||''}`.
- **Value**: the computed metrics payload + an `insertedAt` timestamp.
- **TTL**: `METRICS_CACHE_TTL_MS` (default 300_000 = 5 min). On lookup, entries older than TTL are
  treated as misses (and evicted). A simple `Map` with size cap `METRICS_CACHE_MAX` (e.g. 64,
  FIFO/oldest-evict) bounds memory.
- **Hit** → return the cached payload, skipping **both** the `/api/graph` fetch and the compute.
- **Bypass**: `?fresh=1` forces recompute (and refreshes the entry) — for use right after a
  re-index, since the TTL is the only invalidation (no re-index signal in v1).
- Implemented as a tiny pure-ish helper (`cacheGet(key)`/`cacheSet(key,val)`) testable with an
  injectable clock (pass `now` so tests don't need a real timer — `Date.now()` is read once per
  request at the route boundary and passed in).

The sidecar route caches too (keyed with `lensId=''`), so repeated sidecar metric calls also hit.

### 3.5 MCP + frontend

- **MCP**: `gitnexus_graph_lens_metrics` is lens-agnostic — `symbol-graph` works with no schema
  change; add optional `cap` + `approx` number params + refresh the description to mention
  `symbol-graph` and the cap/approx knobs. (The sidecar `gitnexus_graph_metrics` may also gain
  `cap`/`approx` for symmetry — optional; at minimum the lens tool gets them.)
- **Frontend**: no required change — the lens view + size-selector already render any lens id, and
  the overlay consumes the same payload (the new `summary.approximate`/`sampleSize`/`cap` are
  additive). A UI control to set cap/approx is **deferred to P2.3.3** (surfaces); v1 exposes them
  via the endpoint + MCP only.

## 4. Testing

- **Engine** (`graph-theory-core.test.mjs`):
  - `betweennessApprox`/`closenessApprox`/`harmonicApprox` with `samples ≥ V` (or full) **equal the
    exact** functions on PATH3/STAR/BARBELL/CYCLE4 (deterministic); with `samples < V` they rank the
    same top node (e.g. path middle / star hub highest) and are finite/non-negative — the
    approximation-correctness guard (the high-risk piece, à la the Katz review).
  - `computeMetricsCapped` with `{cap:1, approx:3}` on the barbell → `summary.approximate:true`,
    `sampleSize:3`, betweenness/closeness/harmonic **non-zero** (estimated), coreness/clustering 0,
    `omittedMetrics:['coreness','clustering']`. With `{cap:1}` (no approx) → today's all-skipped path.
    With `{cap:1000}` → exact, `approximate:false`.
- **`projectSymbolGraph`** (`graph-theory-lens-metrics.test.mjs`): raw projection keeps all nodes
  (incl. an isolated one), no file collapse, dedup per (source,target,type) (parallel *different*
  types kept), self-loops dropped; `LENSES['symbol-graph']` registered; `lensMetrics(g,'symbol-graph')`
  computes.
- **Param parsing**: `?cap=` (valid int, clamp to max, reject ≤0/non-int → 400); `?approx=` (valid
  int, reject invalid → 400); defaults unchanged.
- **Cache** (a focused unit test with an injected clock): same key within TTL → hit (compute fn
  called once); past TTL → miss (recompute); `fresh` → bypass; size cap evicts oldest.
- **MCP** (`server.test.mjs`): description mentions `symbol-graph`; `cap`/`approx` params present.
- **Stack e2e**: same `/data/projects:ro` limit (no ASTKG indexable) — verified by composition +
  unit; the route plumbing is the already-e2e-proven P2.3.2a path.

## 5. Scope boundaries

- **In:** `symbol-graph` lens; `?cap=` + `?approx=` params (validated, threaded); approximate
  betweenness/closeness/harmonic via source-sampling; TTL+LRU result cache with `?fresh=1` bypass;
  MCP param/description update.
- **Out:** directed-graph metrics; approximating k-core/clustering; a cap/approx **UI** (P2.3.3);
  cache invalidation via a re-index signal (TTL + `fresh` only in v1); persistent/cross-process cache.
- Pure-JS, zero-dep, already-COPY'd module edits only — **no Dockerfile.web change**.

## 6. Open questions

- **`CAP_MAX` (50000) + default TTL (300s)** — guesses; tune once real symbol-graph sizes/latencies
  are observed (the cap degrades gracefully; the TTL only affects staleness window).
- **Sampling estimator quality** — Brandes–Pich is unbiased in expectation; variance shrinks with S.
  v1 reports `sampleSize` so the caller knows the fidelity. Adaptive S (target a variance bound) is
  future work.
- **Cache invalidation** — TTL + `fresh` only; a proper re-index→evict hook (the CLI already has a
  reindex flow) is a clean future enhancement once a signal exists.
