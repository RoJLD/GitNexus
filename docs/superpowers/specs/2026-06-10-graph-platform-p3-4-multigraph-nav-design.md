# Graph Platform — P3.4: multigraph navigation (meta→graph→node→inspector) — Design

**Date**: 2026-06-10
**Status**: current
**Builds on**: the graph-templates store (`graph-templates-core`: `readIndex` / `INDEX_PATH`),
the `GraphSidebar` Stage-1 stub, `useSigma.selectedNode`, the research/lens render path, and the
`?research`/`?lens` routing fix (`248fe373`) that makes graph URLs reachable.
**Decomposes**: P3 → P3.1 (done) + P3.2 (done) + P3.3 (done) + **P3.4 (this — completes P3)**.

## 1. Context / problem

Scaffolded sidecar graphs are recorded in an index (`/data/gitnexus/research-graphs/index.json`,
records `{name, template, schema_type, source, created}`), but **nothing lists them** — only
`/graph/templates` (templates, not instances) is exposed, and `GraphSidebar` is a Stage-1 stub
(just a "+ New" button). So a user can't see or jump between the graphs they've built, and there's
no inspector for a selected node. P3.4 adds the meta→graph→node→inspector chain: a graphs-list
endpoint, the sidebar listing+opening graphs, and a node inspector.

## 2. Goal

A `GET /graph/list` endpoint enumerates scaffolded graphs; `GraphSidebar` (Stage 2) lists them and
opens one on click (`?research=<name>`); a `NodeInspector` panel shows the selected node's fields +
metrics. Completes P3's visualization paradigms. No Dockerfile change (extends already-COPY'd
modules); frontend additive.

## 3. Design

### 3.1 Server — `GET /graph/list`

In `docker-server-graph-templates.mjs` (the existing handler; `readIndex` is already imported from
core): add
```
if (path === '/graph/list' && req.method === 'GET') { sendJson(res, 200, { graphs: (await readIndex()).graphs }); return true; }
```
Returns `{ graphs: [{ name, template, schema_type, source, created }, …] }` — the index records
verbatim (empty `graphs:[]` when none / no index yet, per `readIndex`'s catch). Pure read, no new
module, no Dockerfile.web change.

### 3.2 MCP — `gitnexus_list_graphs`

In `mcp-server/server.mjs`, a tool mirroring `gitnexus_list_graph_templates`:
`name:'gitnexus_list_graphs'`, no inputs, `handler: () => callWeb('/graph/list')`. Description: lists
the **instantiated** sidecar graphs (name/template/schema_type/source) — vs `list_graph_templates`
which lists the available *templates*.

### 3.3 Client — `listGraphs()`

In `services/research-client.ts`: `listGraphs(): Promise<{ name: string; template: string; schema_type: string; source: string | null; created: string }[]>` → `GET /graph/list` → `body.graphs ?? []`.

### 3.4 Meta UI — `GraphSidebar` Stage 2

`GraphSidebar` (mounted under `?multigraph=1` with `onNewGraph`) gains a graph list:
- On mount, `listGraphs()` → local state (loading / error / list). A small refresh on focus is
  optional (v1: fetch once on mount + after `onNewGraph`).
- Render each graph as a clickable row: the `name` + a `schema_type` badge; the active graph
  (matching `?research=<name>`) highlighted. Click → `window.location.search = '?research=' +
  encodeURIComponent(name)` (full reload to the graph — now lands on the graph thanks to the
  routing fix). Empty list → a hint ("No graphs yet — + New").
- Keep the existing "+ New" button. (Lenses aren't scaffolded instances → not in this list; opening
  a lens stays the New-flow's lens branch. v1 lists scaffolded research/import graphs only.)

### 3.5 Node inspector — `NodeInspector`

- **Pure helper** `upstream/gitnexus-web/src/lib/node-inspector.ts` (unit-tested):
  `nodeInspectorData(rg: ResearchGraph | null, metricsById: Map<…> | undefined, selectedId: string | null)`
  → `{ id, type, label, path, metrics: {…} | null } | null` (null when no selection / not found).
  Pure, no DOM.
- **Component** `NodeInspector.tsx`: given the helper's output, render a panel (id, type, label,
  path; and when `metrics` present, a compact table of degree/pagerank/betweenness/eigenvector/
  closeness/katz/harmonic/coreness/clustering/community). `null` → renders nothing.
- **Wiring** (GraphCanvas): the research/lens view passes `useSigma`'s `selectedNode` (the clicked
  node id — already destructured as `sigmaSelectedNode`) + `researchData` + `metricsById` into
  `nodeInspectorData`, and renders `<NodeInspector>` as an absolutely-positioned panel (e.g.
  top-left or right, below the controls; `data-testid="node-inspector"`) when it returns non-null.
  Shown for research/lens views (`researchName || (lensId && lensRepo)`); a click on the background
  clears the selection (existing behavior). No change to the code-graph selection/code-panel flow.

### 3.6 Out of scope (→ later)

Lens instances in the list; a graph-of-graphs "meta canvas" (the sidebar list is the meta surface
in v1); inspector edit/actions/jump-to-neighbors; cross-graph navigation; deleting graphs from the
sidebar. No new deps, no Dockerfile.web change.

## 4. Testing

- **Unit** (`tests/unit/node-inspector.test.mjs`, new): `nodeInspectorData` — returns the node's
  fields for a known id; includes the metrics row when `metricsById` has it, `metrics:null` when
  not; returns `null` for an unknown id / null selection / null graph.
- **Endpoint** (light): the route returns `{graphs}` (shape) — covered by the stack e2e (the index
  is populated by scaffold/import in the test stack, unlike the ASTKG which needs a writable mount).
- **MCP** (`server.test.mjs`): `gitnexus_list_graphs` registered + handler hits `/graph/list`.
- **Web build** type-checks GraphSidebar/NodeInspector/GraphCanvas wiring.
- **Browser-QA** (Playwright): scaffold+import a `research-graph` (`qa`), load
  `?multigraph=1&research=qa` → the sidebar lists `qa` (+ click another to navigate); click a node →
  the inspector shows its fields + metrics. 0 console/page errors. (The graphs-list + sidebar are
  fully exercisable on the test stack — the index is writable, unlike the ASTKG path.)

## 5. Scope boundaries

- **In:** `/graph/list` endpoint + `gitnexus_list_graphs` MCP + `listGraphs` client + `GraphSidebar`
  Stage 2 (list/open) + `node-inspector.ts` (pure) + `NodeInspector.tsx` + GraphCanvas wiring.
- **Out:** §3.6.
- Server change is a pure read on the already-COPY'd `graph-templates.mjs` (no Dockerfile.web);
  frontend additive (sidebar only renders the list under `?multigraph=1`; inspector only when a
  research/lens node is selected). Existing flows unchanged.

## 6. Open questions

- **Lens instances** — lenses are read-only projections (not scaffolded), so they're absent from the
  index/list; surfacing "open a lens over repo X" in the meta UI is a later enhancement.
- **Active-graph highlight** — matched by `?research=<name>`; lens-view active state is deferred.
- **Inspector placement** — a fixed panel in v1; a dockable/resizable inspector is later polish.
