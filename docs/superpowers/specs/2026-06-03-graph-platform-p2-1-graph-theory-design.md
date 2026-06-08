# Graph Platform — P2.1: graph-theory toolkit (centrality + communities) — Design

**Date**: 2026-06-03
**Status**: current
**Builds on**: `2026-06-03-graph-platform-p0-kuzu-sidecar-design.md` (sidecar + render shape),
`2026-06-03-graph-platform-p1-sdk-proof-design.md` (schema-agnostic graphs).
**Decomposes**: ROADMAP.md "Graph Platform → P2" (the full toolkit) into **P2.1 (this spec)** + **P2.2+ backlog** (see §6).

## 1. Context / problem

The platform now hosts many graphs (ASTKG code graph, research-artifacts,
academic-literature, research-graph, lenses), all sharing one `{nodes,edges}`
render shape. But it has **no general graph-theory toolkit**: the only graph
algorithms are **ASTKG-specific and backend-computed at index time** (Leiden
communities powering dissonance/clusters; density/modularity in entropy). You
cannot ask "which node is most central?" or "what are the communities?" of a
*sidecar* graph (research/academic/research-graph) at all.

P2 (the full toolkit — centralities, communities, paths/cycles, articulation
points, embeddings, exposed via endpoints + MCP + overlays) is too large for one
spec. **P2.1 delivers a tractable, high-value first slice**: centrality +
communities over the common render shape, for the sidecar graphs, end-to-end
(engine → endpoint → MCP → visual overlay). Everything else is recorded in §6.

## 2. Goal

Point a small, well-tested graph-theory engine at any **sidecar** graph and get,
per node, its **degree**, **PageRank**, and **community** — surfaced via an HTTP
endpoint, an MCP tool, and a visual overlay (size = PageRank, color = community).
The engine is pure-JS and shape-generic, so extending it to the ASTKG/lenses and
to more algorithms (P2.2+) is additive.

## 3. Design

### 3.1 Pure-JS, zero-dep engine over the common render shape

A new **core module** `upstream/docker-server-graph-theory-core.mjs` — pure Node,
**zero dependencies** (matching every other `docker-server-*.mjs`; graphology is a
*frontend* bundle dep, unavailable to the server runtime, and the codebase already
favors pure-JS algorithms, e.g. the galaxy-view power-iteration PCA). It operates
on `{nodes:[{id,…}], edges:[{source,target,…}]}` (the universal render shape). This
is the chosen approach.

*Rejected:* adding `graphology-metrics`/`graphology-communities-louvain` as
**runtime** deps — would require an `npm install` in `Dockerfile.web`'s runtime
stage, breaking the zero-dep `.mjs` discipline and growing the patched image.
*Rejected:* client-side-only compute — the roadmap wants endpoint + MCP (server-side,
reusable by agents/CLI), and the overlay just consumes the endpoint.

Exports:
- `degreeCentrality(graph)` → `{ [id]: degree }` (total degree; undirected count).
- `pageRank(graph, { damping = 0.85, maxIter = 100, tol = 1e-6 })` → `{ [id]: score }`,
  power iteration with dangling-node redistribution; uses edge direction.
- `louvain(graph, { seed = 1 })` → `{ communities: { [id]: communityId }, modularity }`
  — compact modularity-maximizing Louvain, deterministic via a seeded RNG, graph
  treated undirected for modularity.
- `computeMetrics(graph)` → `{ nodes: [{ id, degree, pagerank, community }], summary: { nodeCount, edgeCount, communityCount, modularity } }`.

Empty/edgeless graphs degrade gracefully (degree 0, uniform PageRank, each node its
own community, modularity 0).

### 3.2 Endpoint — `upstream/docker-server-graph-theory.mjs`

`GET /graph/metrics/:name` → fetch the sidecar render
(`GET ${GRAPHS_URL}/g/:name/render` → `{nodes,edges}`, the channel the
graph-templates handler already uses) → `computeMetrics` → respond
`{ nodes:[{id,degree,pagerank,community}], summary }`. 404 if the graph is absent;
JSON 500 on error (never crash). Wired in `docker-server-routes.mjs`; **both new
`.mjs` files COPY'd into `Dockerfile.web`** (boot-crash discipline — the web
container imports them at boot).

### 3.3 MCP tool

`gitnexus_graph_metrics` in the analytics MCP sidecar (`mcp-server/` — the zero-dep
stdio server wrapping REST endpoints): given a graph name, calls `/graph/metrics/:name`
and returns the `summary` + the top-N nodes by PageRank. Thin wrapper, no new logic.

### 3.4 Frontend overlay (minimal)

A **"Metrics" toggle** on the sidecar-graph view (`?research=<name>`): on enable,
fetch `/graph/metrics/:name`, build an `{id → {pagerank, community}}` map, and
override node rendering — **color by community** (a palette) and **size by PageRank**
(normalized) — via the existing `research-graph-adapter` / `useSigma` node attributes,
plus a small legend (community count). Off = the normal type-colored render. Reuses
the existing render path; no new canvas.

### 3.5 Data flow

`toggle Metrics on (sidecar graph "foo")` → `GET /graph/metrics/foo` → web handler
fetches sidecar render of "foo" → `computeMetrics` → `{nodes:[…], summary}` → overlay
maps community→color, pagerank→size → Sigma re-renders.

## 4. Testing (pure, deterministic — synthetic graphs)

- **Core** (`tests/unit/graph-theory-core.test.mjs`): degree on a known graph;
  PageRank on a star (hub scores highest) and a symmetric pair (equal); Louvain on a
  two-clique "barbell" → exactly 2 communities, modularity > 0; determinism (same
  seed ⇒ identical output); empty/edgeless graph degrades.
- **Handler** (`tests/unit/graph-theory-handler.test.mjs`): stub `fetch` with a fake
  render → assert per-node metrics + the 404 (missing graph) and 500 (fetch error)
  paths.
- **Frontend**: a `graph-theory-client` fetch unit test; the overlay wiring verified
  on the live stack.
- Native-runnable (host Node 24) for the pure modules; full tier via `docker-test.sh`.

## 5. Scope boundaries (P2.1)

- **Algorithms:** degree + PageRank + Louvain **only**.
- **Source:** **sidecar** graphs by name only (research/academic/research-graph +
  future crypto/model). Not the ASTKG, not lenses, not merged/group graphs.
- **Surfaces:** one endpoint + one MCP tool + one minimal overlay.
- **No backend change** (the existing Leiden stays; this is a separate general
  toolkit), **no new container**, cohabitation-safe.

## 6. Deferred to P2.2+ (recorded — nothing dropped)

**More centralities:** betweenness (O(VE)), eigenvector, closeness, Katz,
harmonic. **More community methods:** a general Leiden (gold standard, matches the
backend), label propagation (cheap alt), hierarchical/multi-level Louvain,
community **comparison** vs the ASTKG's index-time Leiden. **Paths & structure:**
shortest paths, all-pairs / k-hop, cycle detection, DAG/topological checks,
**articulation points + bridges** (cut vertices/edges), connected components
(weak/strong). **Other metrics:** k-core decomposition, clustering coefficient /
transitivity, assortativity, density, diameter / eccentricity / radius. **Embeddings:**
node2vec / DeepWalk / structural embeddings (heavy — likely a sidecar concern, may
need a non-pure-JS path). **More sources:** the **ASTKG** (via `/api/graph` collapse —
"which functions/files are central"), **lens** outputs (e.g. imports-deps centrality),
**group/merged** multi-repo graphs. **Richer surfaces/UX:** per-metric selector +
legends in the overlay, betweenness/centrality **heatmaps**, community **filter/isolate**,
a **top-N central nodes** side panel, metrics **export** (CSV/JSON), full MCP coverage
for every algorithm. **Performance:** **caching** computed metrics (per graph ×
algorithm, invalidated on re-ingest), **large-graph handling** for the ASTKG
(sampling / level-of-detail / incremental — a real concern at 10⁴–10⁶ nodes).
**Directedness:** per-algorithm directed-vs-undirected options (v1 fixes sensible
defaults). **Synergy:** these metrics feed the **IA/Model-as-graph** vision's
"observability / optimization" (dead-weights = zero-centrality nodes, hot-paths =
high-centrality) and **P3** visualization paradigms.

## 7. Open questions

- **Louvain resolution / levels** — v1 ships single-level Louvain with default
  resolution; multi-level + a resolution knob are P2.2.
- **Overlay color when communities > palette size** — cycle the palette in v1;
  a generated/continuous scheme is a P2.2 polish.
- **Metric caching** — v1 recomputes per request (sidecar graphs are small);
  caching is P2.2 and becomes mandatory once the ASTKG source lands.
