# Graph Platform — P2.3.2a: metrics over a lens (ASTKG as a source) — Design

**Date**: 2026-06-09
**Status**: current
**Builds on**: `2026-06-09-graph-platform-p2-3-1-structural-centrality-community-design.md`
(the pure-JS engine + `/graph/metrics/:name` + MCP + overlay) and
`2026-06-03-graph-platform-p1-sdk-proof-design.md` (the `imports-deps` lens + the
`GITNEXUS_API` `/api/graph` channel).
**Decomposes**: P2.3 part **B (ASTKG as a metrics source)** → **P2.3.2a (this slice)** +
**P2.3.2b** (full file-level ASTKG collapse) + **P2.3.2c** (symbol-level + sampling/LoD +
caching).

## 1. Context / problem

P2.1/P2.2/P2.3.1 built a pure-JS graph-theory engine (`computeMetrics`) and exposed it via
`GET /graph/metrics/:name` over **sidecar** graphs (research/academic/research-graph). It
does **not** yet run over the **code graph** (the CLI's AST Knowledge Graph, ASTKG) — so the
analytics that matter most for code (which files are central hubs, which are **articulation
points** = fragile single-points-of-failure in the dependency structure, which files cluster
into **communities** = modules) aren't available on real repositories.

P1 already built the bridge: the **`imports-deps` lens** reads the ASTKG via the internal
`${GITNEXUS_API}/api/graph?repo=<repo>` JSON channel (no Kùzu-file coupling) and projects it
to a **file-level IMPORTS graph** in the universal render shape
`{nodes:[{id,...}], edges:[{id,source,target,kind}]}`. That shape is **already what
`computeMetrics` consumes** (`nodes[].id` + `edges[].source/target`). So "metrics over the
code graph" needs no new graph machinery — it needs to **point the engine at a lens
projection**.

P2.3 part B is large (symbol-level scale, caching, LoD), so it is staged:
- **P2.3.2a (this slice)** — metrics over **any registered lens** (today `imports-deps`), the
  cheap, high-value, fully-reusing first step. File-level graphs are small, so the expensive
  metrics are tractable; a node cap is the only large-graph guard needed here.
- **P2.3.2b** — a dedicated **full file-level ASTKG collapse** (all relationship types, not
  just `IMPORTS`) for a richer code-structure picture. *Deferred — recorded in the roadmap.*
- **P2.3.2c** — **symbol-level** raw ASTKG + sampling/level-of-detail + real result caching,
  for the heavy case. *Deferred — recorded in the roadmap.*

## 2. Goal

`computeMetrics` runs over a **lens projection of the ASTKG** for a given repo, exposed via a
new `GET /graph/metrics/lens/:lensId?repo=<repo>` endpoint (same metrics payload as the
sidecar route, same `community`/`resolution` params), an MCP tool, and the existing overlay
extended to work in the lens view — so code-graph centrality/communities/articulation-points
are first-class. A node cap keeps it safe on larger projections; real caching/LoD is P2.3.2c.

## 3. Design

### 3.1 Endpoint — `GET /graph/metrics/lens/:lensId?repo=<repo>[&community=&resolution=]`

Added to `upstream/docker-server-graph-theory.mjs` (a sibling of the existing
`handleGraphMetricsRoute`), modelled on the lens route:

```
GET /graph/metrics/lens/:lensId?repo=<repo>[&community=&resolution=]
  → parseMetricsParams(searchParams)                       // reuse P2.3.1 validator (400 on bad)
  → require repo (400 if missing) + known lensId (404 if unknown)
  → fetch(`${GITNEXUS_API}/api/graph?repo=<repo>`)         // 502 on upstream failure
  → project = LENSES[lensId](graph)                        // existing lens projection
  → computeMetricsCapped(project, params)                  // node-capped computeMetrics
  → 200 { nodes, bridges, summary }                        // same payload as the sidecar route
```

- `LENSES` is imported from `docker-server-graph-lens-core.mjs` (today `{'imports-deps':
  projectImports}`). The route is **lens-agnostic** — any future lens that returns the
  universal shape gets metrics for free.
- `GITNEXUS_API` (default `http://gitnexus:4747`) is the same internal web→CLI channel the
  lens, group-graph, regression, and wiki already use. **No new wire, no Kùzu coupling.**
- The route lives **before** the existing `/graph/metrics/` prefix check, OR the existing
  check is tightened so `/graph/metrics/lens/...` doesn't get swallowed as a sidecar name
  `lens/...`. (Implementation: match `/graph/metrics/lens/` first and return; the sidecar
  handler then only sees non-`lens/` names.)

### 3.2 Large-graph guard — `computeMetricsCapped`

File-level import graphs are typically small (tens–hundreds of files), but a monorepo could
be larger, and `computeMetrics` has O(V²) (closeness/harmonic/k-core peeling) and O(V·E)
(betweenness) terms. A node cap protects the endpoint without the full caching/LoD machinery
(that is P2.3.2c):

- `LENS_METRICS_NODE_CAP` (default **2000**).
- If the projection has **> cap** nodes: compute the **near-linear** metrics (degree, PageRank,
  eigenvector, Katz — all O(E·iters); community — O(E·passes); density + connected components
  — O(V+E)) and **skip the super-linear** ones — betweenness (O(V·E)), closeness + harmonic
  (O(V·(V+E))), k-core (O(V²) in this impl), clustering (O(Σ d²)). The skipped per-node fields
  are set to `0` (and summary `transitivity` to `0`), with `summary.capped = true` +
  `summary.omittedMetrics = ['betweenness','closeness','harmonic','coreness','clustering']`.
- If **≤ cap**: full `computeMetrics`, `summary.capped = false`, `summary.omittedMetrics = []`.
- (eigenvector/Katz are O(E·iters), so they stay even above the cap — only the genuinely
  super-linear metrics are dropped.)

This is implemented as a thin wrapper in the engine core (`computeMetricsCapped(graph, opts)`)
so the cap policy is unit-testable in pure JS. `summary` always carries `capped` +
`omittedMetrics` (on the sidecar route too — see §3.5 for back-compat handling).

*Rejected for v1:* sampling/LoD (P2.3.2c) and result caching (P2.3.2c). A hard cap that
degrades gracefully is the right amount of safety for the file-level first step.

### 3.3 MCP — `gitnexus_graph_lens_metrics`

A new tool in `mcp-server/server.mjs` (the existing `gitnexus_graph_metrics` stays for
sidecar graphs):

- `name: 'gitnexus_graph_lens_metrics'`, inputs `lensId` (string, required), `repo` (string,
  required), optional `community` (enum louvain/leiden/labelprop), optional `resolution`
  (number).
- `handler: ({lensId, repo, community, resolution}) => callWeb('/graph/metrics/lens/' +
  encodeURIComponent(lensId), {repo, community, resolution})` (only including defined
  community/resolution).
- Description: graph-theory metrics over a code-graph lens projection (today `imports-deps` =
  file-level import dependency graph); lists the metric set + that it surfaces central files,
  articulation points (fragile deps), and module communities.

### 3.4 Frontend — extend the overlay to the lens view

The lens view already exists (`GraphCanvas.tsx`: `?lens=<id>&repo=<repo>` →
`applyLens(lensId, lensRepo)` → renders through the research adapter). Today the Metrics
toggle + size-selector are gated on `researchName` (sidecar graphs only). Extend:

- `services/graph-theory-client.ts`: add `getGraphLensMetrics(lensId, repo)` →
  `fetch('/graph/metrics/lens/' + encodeURIComponent(lensId) + '?repo=' +
  encodeURIComponent(repo))`, returning the same `GraphMetrics` type (which gains optional
  `capped?: boolean` + `omittedMetrics?: string[]` on `summary`).
- `GraphCanvas.tsx`: the metrics-fetch effect, the Metrics toggle, and the size-selector are
  shown when `researchName` **or** (`lensId && lensRepo`). In lens mode the effect calls
  `getGraphLensMetrics(lensId, lensRepo)`; otherwise `getGraphMetrics(researchName)`. The map
  build, render path, cacheKey, and deps are otherwise unchanged (the lens result already
  renders through the same adapter). When `summary.capped`, the omitted size-metrics still
  appear in the selector but resolve to size 0 — acceptable for v1 (a disabled-state polish
  is P2.3.3).

### 3.5 Back-compat for the `summary` shape

`summary` gains `capped` + `omittedMetrics`. The **sidecar** route (`/graph/metrics/:name`)
also flows through `computeMetricsCapped` now, so its `summary` gains the same two fields
(`capped:false`, `omittedMetrics:[]` for the small sidecar graphs). Existing per-node fields
and the other summary fields stay byte-identical; the two added summary fields are additive
(no consumer breaks). The P2.3.1 client/MCP already treat `summary` as an open object.

## 4. Testing

- **Engine** (`tests/unit/graph-theory-core.test.mjs`, extend): `computeMetricsCapped` — below
  the cap returns the full metrics + `summary.capped:false`; above a (test-lowered) cap skips
  the super-linear metrics (betweenness/closeness/harmonic/coreness/clustering = 0, transitivity
  = 0), keeps the near-linear ones (degree/pagerank/eigenvector/katz/community/density/components),
  and sets `summary.capped:true` + `summary.omittedMetrics`.
- **Endpoint** (`tests/unit/graph-theory-lens-metrics.test.mjs`, new): export a pure helper
  that, given an already-fetched `/api/graph` JSON + lensId + params, projects and computes —
  assert it produces metrics for the `imports-deps` projection of a synthetic ASTKG-shaped
  fixture (nodes with `properties.filePath`, `IMPORTS` relationships). Assert unknown lensId
  and missing repo are rejected (test the validation helper). (The live fetch is covered by
  the stack e2e.)
- **MCP** (`mcp-server/server.test.mjs`, extend): source-text assertions — the
  `gitnexus_graph_lens_metrics` tool is registered, requires `lensId`+`repo`, and the handler
  hits `/graph/metrics/lens/`.
- **Client** (`tests/unit/graph-theory-client.test.mjs`, extend): `getGraphLensMetrics` GETs
  `/graph/metrics/lens/imports-deps?repo=<repo>` (URL-encoded) and returns the payload.
- **Stack e2e** (final, controller): index the sample repo, then
  `GET /graph/metrics/lens/imports-deps?repo=<repo>` → 200 with per-node metrics + a `summary`
  carrying `capped`; unknown lens → 404; missing repo → 400.

## 5. Scope boundaries

- **In:** the `/graph/metrics/lens/:lensId` endpoint (lens-agnostic, today `imports-deps`),
  the `computeMetricsCapped` node-cap guard, the `gitnexus_graph_lens_metrics` MCP tool, and
  the overlay extended to lens mode.
- **Out (staged, recorded in roadmap):** P2.3.2b (full file-level ASTKG collapse, all rel
  types); P2.3.2c (symbol-level + sampling/LoD + real result caching); directed-graph metrics
  (code deps are directed — v1 stays undirected for engine consistency); the P2.3.3 viz
  surfaces (heatmap, picker, bridge rendering, top-N, export).
- Pure-JS engine addition + already-COPY'd module edit + already-built web sources — **no
  Dockerfile.web change** (cohabitation-safe, mirrors P2.3.1).

## 6. Open questions

- **Cap default (2000)** — a guess for "file-level graphs are small"; tune in P2.3.2c when
  symbol-level scale is the target. The cap degrades gracefully (cheap metrics still compute).
- **Directedness** — code dependencies are directed; v1 runs the existing undirected engine
  (so "central file" = undirected betweenness, "community" = undirected Louvain). A directed
  variant (in/out PageRank, directed betweenness) is deferred with the rest of the directed
  work noted in P2.3.1 §6.
- **Per-node `path`** — the lens nodes carry a file `path`; computeMetrics keys only on `id`
  (= the file path here). Surfacing `path` distinctly in the metrics payload (for a clickable
  source link) is a P2.3.3 polish.
