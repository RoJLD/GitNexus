# Graph Platform — P3.1: layout selector + hierarchical (layered) layout — Design

**Date**: 2026-06-10
**Status**: current
**Builds on**: the P2 metrics overlay (`GraphCanvas` + `research-graph-adapter` + `useSigma`),
the `2026-06-03-graph-platform-p1-sdk-proof-design.md` render path, and the
`?research`/`?lens` routing fix (`248fe373`) that makes these views browser-reachable.
**Decomposes**: P3 (visualization paradigms) → **P3.1 (this)** + P3.2 (adjacency matrix) +
P3.3 (3D enhancements) + P3.4 (multigraph navigation).

## 1. Context / problem

The research/lens graph canvas renders nodes circle-seeded + converged by **ForceAtlas2**
(`useSigma.setGraph`). Force layout is fine for organic clusters but poor for the
*dependency/flow* structure of code (imports-deps, symbol-graph) and curated research graphs
(hypothesis→experiment→verdict) — where a **hierarchical/layered** layout reads far better
(direction = flow, rank = depth). There is no way to choose the layout. P3.1 adds a layout
selector with a hand-rolled **layered** layout (+ a static **circular** option), reusing the
existing render path. (No dagre/elk/d3-dag dep — the npm registry is TLS-blocked here — so the
layered layout is hand-rolled on `graphology` + plain JS.)

## 2. Goal

The research/lens canvas gains a **layout selector** (`force | hierarchical | circular`).
`hierarchical` positions nodes by BFS-rank (depth → x, spread → y) via a pure, unit-tested
`layeredLayout`; `circular` uses the existing circle seed; both set **final** positions and
**skip ForceAtlas2**; `force` keeps today's behaviour (circle seed + FA2). Dep-free, no
server/MCP change.

## 3. Design

### 3.1 Pure layout — `upstream/gitnexus-web/src/lib/layered-layout.ts` (new, unit-tested)

```ts
export interface LayoutGraph { nodes: { id: string }[]; edges: { source: string; target: string }[] }

/** BFS-rank layered layout: rank = shortest hops from a source (in-degree-0, or min-in-degree
 *  fallback for fully-cyclic); x = rank·DX, y centered within rank. Cycles guarded (visited);
 *  disconnected components stacked vertically. Returns Map<id,{x,y}>. Pure + deterministic. */
export function layeredLayout(graph: LayoutGraph, opts?: { dx?: number; dy?: number }): Map<string, { x: number; y: number }>
```

- **Ranking:** compute in-degree; **roots** = in-degree-0 nodes (or, if none — fully cyclic —
  the min-in-degree node, deterministic by id). BFS from all roots simultaneously assigns each
  node its first-reached rank; unreached nodes (separate components / unreachable) are ranked by
  their own component's BFS. Cycle-safe via a visited set.
- **Positioning:** `x = rank · DX` (DX default 160); within each rank, nodes are spread on `y`
  centered around 0 (`y = (i − (k−1)/2) · DY`, DY default 80, `k` = nodes at that rank, order =
  node-iteration order for determinism). Disconnected components are offset on `y` so they don't
  overlap (track a running y-offset per component).
- Pure (no DOM, no sigma); deterministic; the testable core.

### 3.2 `useSigma.setGraph` — a `skipLayout` option

`setGraph(graph, opts?: { cacheKey?: string; skipLayout?: boolean })`. When `skipLayout` is
true, the graph's node `x`/`y` are used **as-is** and **ForceAtlas2 is not started** (and no
layout-cache write/read for that key — the positions are authoritative). Default
(`skipLayout` absent/false) → today's behaviour (FA2 run, cache). This is the only `useSigma`
change; it's additive and back-compat (every existing caller omits it).

### 3.3 Adapter — `layoutMode` positions

`researchGraphToGraphology(rg, metricsById?, sizeBy?, opts?)` — extend the existing P2.3.3b
`opts` with `layoutMode?: 'force' | 'hierarchical' | 'circular'` (default `'force'`):
- `'force'` / `'circular'` → keep the current circle seed (`x=cos(angle)·r, y=sin(angle)·r`).
- `'hierarchical'` → compute `layeredLayout({nodes: rg.nodes, edges: rg.edges})` once and set
  each node's `x`/`y` from the returned map (fallback to the circle seed for any id missing from
  the map — defensive). All other node attrs (size/color/highlight/dim) unchanged.

(The adapter only sets positions; whether FA2 then runs is decided by `setGraph`'s `skipLayout`,
passed from GraphCanvas — see §3.4.)

### 3.4 GraphCanvas — selector + wiring

- State `layoutMode: 'force' | 'hierarchical' | 'circular'` (default `'force'`).
- Selector `<select data-testid="layout-select">` (Force | Hierarchical | Circular) in the
  overlay cluster, shown for the research/lens view (gated like the other graph controls:
  `researchName || (lensId && lensRepo)` — **not** behind the Metrics toggle, since layout is
  independent of metrics).
- The render effect passes `layoutMode` into the adapter `opts`, and calls
  `setSigmaGraph(g, { cacheKey, skipLayout: layoutMode !== 'force' })` (the GraphCanvas render
  path currently calls `setSigmaGraph(g, cacheKey)` — update to the opts form; confirm the
  `setSigmaGraph` wrapper threads `skipLayout` to `useSigma.setGraph`). cacheKey gains
  `:layout:${layoutMode}` so switching re-renders; effect deps include `layoutMode`.

### 3.5 Out of scope (→ later P3 slices)

Adjacency matrix (P3.2), 3D parity/enhancements (P3.3), multigraph nav (P3.4),
auto-layout-by-graph-type, edge-routing/orthogonal edges, animated layout transitions,
applying layouts to the **code-repo** (non-research/lens) canvas (P3.1 targets the research/lens
view where the seed+FA2 path is simplest to branch). No new deps, no server/MCP/Dockerfile change.

## 4. Testing

- **Unit** (`tests/unit/layered-layout.test.mjs`, new — imports the `.ts`): on a path A→B→C,
  ranks are 0/1/2 (strictly increasing `x`); a diamond A→B,A→C,B→D,C→D → D at rank 2, B/C at
  rank 1 (same `x`, different `y`); a cycle A→B→C→A terminates + ranks all nodes finitely; a
  2-component graph stacks (distinct `y` bands, no overlap); an isolated node gets a position.
- **Web build** type-checks the adapter/useSigma/GraphCanvas wiring.
- **Browser visual-QA** (now reachable via the routing fix): load `?research=<name>`, switch the
  layout selector force→hierarchical→circular, screenshot each — confirm hierarchical lays nodes
  in ranked columns (no FA2 jitter), circular is a static ring, force converges as before.

## 5. Scope boundaries

- **In:** `layered-layout.ts` (pure) + `useSigma.setGraph` `skipLayout` + adapter `layoutMode`
  positions + the GraphCanvas layout selector & wiring, for the research/lens canvas.
- **Out:** everything in §3.5.
- Frontend-only, dep-free — **no server/MCP/Dockerfile.web change**. Adapter/`setGraph` changes
  are additive (defaults = today's behaviour), so the existing force render is byte-identical.

## 6. Open questions

- **DX/DY spacing** — defaults (160/80) are guesses; tune in visual-QA. The layered layout is
  unweighted/untyped (ranks by hop distance only); edge-type-aware ranking is future.
- **Direction** — research/lens edges are directed (source→target); `layeredLayout` ranks along
  that direction. Undirected graphs still layer (BFS from min-in-degree), just less meaningfully.
- **Large graphs** — layered layout is O(V+E) (cheap); but a symbol-graph with thousands of nodes
  in few ranks could crowd `y`. A within-rank wrapping/secondary-axis pass is a later refinement.
