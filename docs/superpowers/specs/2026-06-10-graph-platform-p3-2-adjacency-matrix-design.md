# Graph Platform — P3.2: adjacency-matrix view — Design

**Date**: 2026-06-10
**Status**: current
**Builds on**: P3.1 (layout selector, the overlay-control cluster, `?research`/`?lens` reachable)
+ the P2 metrics (`metricsById` carries `community`).
**Decomposes**: P3 → P3.1 (done) + **P3.2 (this)** + P3.3 (3D) + P3.4 (multigraph nav).

## 1. Context / problem

The research/lens graph renders as a node-link diagram (sigma). For **dense** graphs, node-link
hides structure (hairball); an **adjacency matrix** — N×N grid, cell = edge — makes density and,
when rows/cols are **reordered by community**, the block/module structure immediately legible.
P3.2 adds a matrix view as an alternative renderer for the research/lens graph, toggled from the
overlay, reusing the community partition the metrics already compute.

## 2. Goal

A `graph ↔ matrix` view toggle on the research/lens canvas. In matrix mode, a canvas-rendered
N×N adjacency matrix replaces the node-link view, rows/cols **ordered by community** (block
structure), cells colored by the row node's community. Pure ordering/occupancy logic is
unit-tested; the canvas render is build-checked + browser-QA'd. No new deps, no server/MCP change.

## 3. Design

### 3.1 Pure logic — `upstream/gitnexus-web/src/lib/adjacency-matrix.ts` (new, unit-tested)

```ts
export type MatrixOrder = 'community' | 'degree' | 'input';
export interface MatrixNodeMetric { community: number; degree: number }

/** Order node ids for the matrix. 'community' → grouped by community asc then id asc (blocks);
 *  'degree' → degree desc then id asc; 'input' → as given. Deterministic; metricsById optional
 *  (falls back to 'input' when absent). */
export function orderNodes(ids: string[], metricsById: Map<string, MatrixNodeMetric> | undefined, mode: MatrixOrder): string[]

/** Occupancy set of "row,col" index strings for the ordered ids (UNDIRECTED — fills both (i,j)
 *  and (j,i); self-loops dropped; dangling edges ignored). */
export function matrixCells(orderedIds: string[], edges: { source: string; target: string }[]): Set<string>
```

- `orderNodes`: stable + deterministic (ties by id). `community` groups same-community ids
  contiguously (so the matrix shows diagonal blocks). Without `metricsById`, `community`/`degree`
  fall back to `input` order.
- `matrixCells`: build an id→index map from `orderedIds`; for each edge with both endpoints present
  and `source !== target`, add `"i,j"` and `"j,i"` (undirected display, consistent with the engine).
  O(E). The testable core (no canvas).

### 3.2 Renderer — `upstream/gitnexus-web/src/components/AdjacencyMatrix.tsx` (new, canvas)

Props: `{ nodes: {id:string}[]; edges: {source,target}[]; metricsById?: Map<string,{community,degree}>; order: MatrixOrder }`.

- Compute `ordered = orderNodes(nodes.map(n=>n.id), metricsById, order)`; **cap** at
  `MATRIX_MAX = 400` — if `ordered.length > 400`, take the top 400 by degree (or first 400 if no
  metrics) and render a "showing 400 of N" caption. `cells = matrixCells(ordered, edges)`.
- A `<canvas>` sized to its container (a `ResizeObserver` sets width/height to the parent box;
  square cells `cell = floor(min(w,h)/N)`). Draw: clear to the void bg; for each filled `"i,j"`,
  fill the cell rect at `(j*cell, i*cell)` with the **row node's community color**
  (`COMMUNITY_PALETTE[community % len]` when metrics present, else a single accent like `#60a5fa`);
  draw faint grid lines for small N (≤60). The diagonal is left empty (self-loops dropped).
- Reuse `COMMUNITY_PALETTE` (export it from `research-graph-adapter.ts`, or duplicate the small
  const — prefer exporting to keep one source). Pure-canvas, no sigma, no new dep.
- Labels/hover/tooltips are **deferred** (v1 = the block picture); a small caption shows N (+ cap note).

### 3.3 GraphCanvas wiring

- State `view: 'graph' | 'matrix'` (default `'graph'`).
- A view toggle `<select data-testid="view-select">` (Graph | Matrix) in the overlay cluster, gated
  on the research/lens view (`researchName || (lensId && lensRepo)`), independent of metrics.
- Render: after the sigma `containerRef` div, add
  `{view === 'matrix' && researchData && (<div className="absolute inset-0 z-10 bg-void"><AdjacencyMatrix nodes={researchData.nodes} edges={researchData.edges} metricsById={metricsOn ? matrixMetrics : undefined} order={metricsOn ? 'community' : 'input'} /></div>)}`
  — an inset-0 overlay above the sigma container (z-10) but below the controls (z-20). The sigma
  container stays mounted (instant toggle back; FA2 unaffected). `matrixMetrics` is a `useMemo`
  from `metricsData` (id → {community, degree}); when metrics are off, order falls back to `input`.
- In matrix mode the node-link-only controls (size-metric/colormode/highlight/isolate/topn/export,
  layout-select) may stay rendered but are inert on the matrix; **only** keep the community-method
  picker meaningful (it changes the community partition → the matrix block ordering re-fetches +
  reorders). (v1: leave the other controls visible; hiding them is a P3.2 polish.)

### 3.4 Out of scope (→ later P3 / polish)

Matrix hover/tooltips/row+col labels, click-to-reorder, edge-weight/heat cells, applying the
matrix to the code-repo canvas, 3D (P3.3), multigraph nav (P3.4), hiding node-link controls in
matrix mode. No new deps, no server/MCP/Dockerfile change.

## 4. Testing

- **Unit** (`tests/unit/adjacency-matrix.test.mjs`, new): `orderNodes` — `community` groups same
  community contiguously (e.g. ids with communities {a:0,b:1,c:0} → [a,c,b]); `degree` sorts desc
  (ties by id); `input`/no-metrics passthrough; `matrixCells` — an edge a→b (ordered [a,b]) fills
  both `"0,1"` and `"1,0"`; self-loop a→a fills nothing; dangling edge ignored; index mapping
  follows the order.
- **Web build** type-checks the component + GraphCanvas wiring.
- **Browser-QA** (Playwright): load `?research=<name>`, toggle `view-select` to Matrix → screenshot
  the matrix canvas (expect a small grid with community-colored cells + diagonal blocks); toggle
  back to Graph → sigma returns. 0 console/page errors.

## 5. Scope boundaries

- **In:** `adjacency-matrix.ts` (pure) + `AdjacencyMatrix.tsx` (canvas) + the GraphCanvas
  `view` toggle & overlay, for the research/lens canvas; community/degree/input ordering; N≤400 cap.
- **Out:** §3.4.
- Frontend-only, dep-free (canvas 2D), **no server/MCP/Dockerfile.web change**. The `view` defaults
  to `'graph'` → today's render is unchanged.

## 6. Open questions

- **Cap (400) + small-N grid lines (≤60)** — guesses; tune in visual-QA. Above the cap, top-by-degree
  is a reasonable focus but loses periphery — the caption discloses it (no silent truncation).
- **Directed vs undirected cells** — v1 fills symmetric (undirected, matches the engine). A directed
  matrix (asymmetry visible) is a later option.
- **Ordering control** — v1 auto-picks `community` (metrics on) / `input` (off); a user-facing order
  selector (community/degree/input) is a cheap later add.
