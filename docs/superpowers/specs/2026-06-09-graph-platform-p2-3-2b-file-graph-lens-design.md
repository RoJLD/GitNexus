# Graph Platform — P2.3.2b: `file-graph` lens (full file-level ASTKG collapse) — Design

**Date**: 2026-06-09
**Status**: current
**Builds on**: `2026-06-09-graph-platform-p2-3-2a-metrics-over-lens-design.md` (the lens-metrics
route + the shared `LENSES` registry) and `2026-06-03-graph-platform-p1-sdk-proof-design.md`
(the `imports-deps` lens + `projectImports`).
**Decomposes**: P2.3 part **B**, step **b** (full file-level collapse) — the middle of
P2.3.2a / **P2.3.2b (this)** / P2.3.2c.

## 1. Context / problem

P2.3.2a runs `computeMetrics` over a **lens projection** of the code graph and made the
machinery **lens-agnostic**: any projection registered in the shared `LENSES` registry
(`docker-server-graph-lens-core.mjs`) automatically gets both `GET /graph/lens/:id?repo=`
(render) and `GET /graph/metrics/lens/:id?repo=` (metrics), and the MCP tool
`gitnexus_graph_lens_metrics` accepts any `lensId`.

Today the only registered lens is `imports-deps`, which projects **only `IMPORTS`** edges to
the file level. That captures the *dependency* structure but misses the rest of the code's
file-level coupling — `CALLS`, `EXTENDS`, `IMPLEMENTS`, `REFERENCES`, etc. A file can be
central in the call graph while peripheral in the import graph. P2.3.2b adds a **richer
file-level projection that collapses *all* relationship types**, so metrics (central files,
articulation points, communities) reflect the full file-level coupling, not just imports.

## 2. Goal

A new `file-graph` lens that collapses the ASTKG to a **file-level graph over all
relationship types** (one edge per connected file-pair), registered in the shared `LENSES`
registry — so it is immediately renderable (`/graph/lens/file-graph?repo=`) and
metric-able (`/graph/metrics/lens/file-graph?repo=`, MCP `gitnexus_graph_lens_metrics`) with
**zero new route or frontend code**. Pure-JS, no new container.

## 3. Design

### 3.1 `projectFileGraph(apiGraph)` — a new projection

In `upstream/docker-server-graph-lens-core.mjs`, modelled on `projectImports` but **without
the `r.type === 'IMPORTS'` filter** (so every relationship counts) and deduped per file-pair:

```
projectFileGraph(graph):
  fileOf  := { nodeId → properties.filePath }   (for nodes that have a filePath)
  for each relationship r (ANY type):
    s := fileOf[r.sourceId]; t := fileOf[r.targetId]
    skip if !s || !t || s === t                 (drop danglers + self-loops)
    skip if (s,t) already seen                   (one edge per unordered? see below)
    edge { id:`${s}->${t}`, source:s, target:t, kind:'related' }
  nodes := the file nodes actually used by ≥1 edge
  return { schema_type:'file-graph', template:'file-graph', name:null, source:null,
           nodes:[{id, type:'file', label:basename, path, stage:''}], edges, report:{nodes,edges} }
```

- **Edge policy (decided):** **one edge per `(source,target)` file pair**, `kind:'related'`,
  regardless of how many/which relationship types connect them — the same dedup policy as the
  existing `collapseToFileLevel`. *Rejected:* per-type parallel edges (would create multiple
  edges between two files, which the undirected/unweighted engine largely ignores while
  inflating degree). Directedness is preserved in the edge tuple ordering but the engine
  treats it undirected (consistent with `imports-deps` + the whole engine).
- **Node ids** are bare `filePath` (like `imports-deps`), **not** the `<repo>::<path>`
  namespacing that `collapseToFileLevel` uses — this is a single-repo projection and matches
  the imports-deps shape so the render adapter + metrics behave identically.
- **Node set:** only files touched by ≥1 retained edge (matches `imports-deps`; isolated files
  add nothing to coupling metrics and keep the graph readable). *Rejected:* including every
  file node (would add many degree-0 nodes that distort density/components).

### 3.2 Why a new function (not reuse `collapseToFileLevel`)

`collapseToFileLevel(graph, repo)` (group-graph-core) already collapses all rel types deduped
per pair — but it emits the **merged-graph** shape (`<repo>::path` ids, `kind:'file'` node
field, edges `{source,target}` with no `id`/`kind`), tailored for the group adapter, and
requires a `repo` arg for namespacing. `projectFileGraph` emits the **research-render** shape
(`{id,type,label,path,stage}` + `{id,source,target,kind}`) the lens registry contract expects,
with bare ids. The logic overlaps but the output contracts differ; a focused projection in
`graph-lens-core` (next to `projectImports`) is the faithful, DRY-per-contract choice.

### 3.3 Registration — one line, everything else free

Add `'file-graph': projectFileGraph` to the exported `LENSES` registry in
`docker-server-graph-lens-core.mjs`. That instantly enables:
- `GET /graph/lens/file-graph?repo=<repo>` (render — existing `handleGraphLensRoute`),
- `GET /graph/metrics/lens/file-graph?repo=<repo>` (metrics — P2.3.2a's `handleGraphLensMetricsRoute`),
- `gitnexus_graph_lens_metrics({lensId:'file-graph', repo})` (existing, lens-agnostic).

No new route, no new MCP tool, no frontend change (the lens view + size-selector already work
for any `lensId`). The MCP tool description is refreshed to mention `file-graph` alongside
`imports-deps` (a one-line doc edit; the schema is unchanged).

## 4. Testing

- **Unit** (`tests/unit/graph-theory-lens-metrics.test.mjs` or a lens-core test, extend): a
  synthetic ASTKG with **mixed** relationship types (e.g. `IMPORTS`, `CALLS`, `EXTENDS`)
  between files →
  - `projectFileGraph` includes edges contributed by **all** types (assert an edge that exists
    only via `CALLS`/`EXTENDS` is present — whereas `projectImports` on the same input would
    drop it);
  - dedup per pair (two relationships of different types between the same file-pair → one edge);
  - self-loops (same-file relationships) dropped; danglers (missing filePath) dropped;
  - `lensMetrics(apiGraph, 'file-graph', params)` computes finite metrics over it.
- **Registry** (a lens-core test, extend or new): `LENSES['file-graph']` is `projectFileGraph`;
  `LENSES['imports-deps']` still present.
- **MCP** (`mcp-server/server.test.mjs`): the `gitnexus_graph_lens_metrics` description
  mentions `file-graph` (source-text assertion) — only if the description is changed.
- **Stack e2e** (best-effort): same harness limit as P2.3.2a — the test stack mounts
  `/data/projects:ro` so an ASTKG can't be indexed there; the route correctly 502s without a
  graph. Verified by composition: `projectFileGraph` is unit-tested + the lens-metrics route
  is already proven in P2.3.2a.

## 5. Scope boundaries

- **In:** `projectFileGraph` (all-rel-types file-level collapse, one edge per pair) + its
  registration in `LENSES` + tests + the one-line MCP description refresh.
- **Out (staged / deferred):** P2.3.2c (symbol-level + sampling/LoD + caching); per-type edge
  preservation / edge weights; directed metrics; the P2.3.3 viz surfaces. No new endpoint, no
  frontend change.
- Pure-JS, zero-dep, already-COPY'd module edits only — **no Dockerfile.web change**.

## 6. Open questions

- **Relationship-type all-list vs deny-list** — v1 counts *every* relationship type. If some
  ASTKG rel types are noise at the file level (e.g. a `CONTAINS` file→symbol structural edge),
  a small deny-list could be added later; v1 keeps it simple (all types) and lets the dedup +
  self-loop drop handle the bulk of the noise (intra-file structural edges become self-loops
  and are dropped).
- **Edge weight = #relationships** — deferred; the engine is unweighted today. A weighted
  file-graph (edge weight = number of underlying relationships) is a natural P2.3.2c/P2.3.3
  enhancement once a weighted engine path exists.
