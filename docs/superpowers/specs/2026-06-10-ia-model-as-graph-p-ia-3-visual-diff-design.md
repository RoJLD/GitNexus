# IA / Model-as-graph — P-IA.3 visual diff view

**Date**: 2026-06-10
**Status**: current
**Builds on**: P-IA.3 backend diff (`GET /graph/diff?a=&b=` + `diffGraphs`, incl. the
edge weight-delta from the render-prop enabler), the research/model canvas
(`research-graph-adapter` + `GraphCanvas`), `listGraphs()`, and the existing
snapshot-diff color convention (`DIFF_COLORS`).

## 1. Context / problem

P-IA.3 shipped a backend structural diff of two graphs (`/graph/diff?a=&b=`) — but it's
only reachable via API/MCP. The vision's "diff two models the way gitnexus diffs two repo
snapshots" wants it **on the canvas**: pick a second graph B, see the **union** of A and B
with nodes colored by status (added / removed / changed / common). The code-graph snapshot
diff already does this (`DIFF_COLORS` + `DiffBanner` driven by `?diff=A,B`), but that
machinery is wired to the main code-graph canvas (`useAppState`/`useSigma`), **not** the
research/model `GraphCanvas` path. This slice brings diff coloring to the model/research
canvas, reusing the diff response + the color convention.

## 2. Goal

On a model/research graph (`?research=<name>`), a "Compare" picker selects another graph
B; the canvas then renders the **union** of A and B, nodes colored green (added in B), red
(removed from A), amber (changed: type/label/weight delta), grey (common), with a small
legend showing the drift counts. Success: comparing `toy-hmm-v1` vs `toy-hmm-v2` shows the
added state green, the removed edge's endpoints/edge red, the retyped node amber.

## 3. Design

### 3.1 Pure helpers — `gitnexus-web/src/lib/graph-diff-view.ts` (graphology-free → host-testable)

Mirrors the testable pure-lib pattern of `metrics-view.ts` (no graphology import → runs in
the unit tier):

- `buildDiffStatus(diff): Map<string, 'added'|'removed'|'changed'|'common'>` — from the
  `/graph/diff` response (`{nodes:{added:[id],removed:[id],changed:[{id}]}}`), build a
  node→status map. Precedence: removed > added > changed > common (an id appears in at most
  one of added/removed; changed ids are a subset of common). Nodes not named → caller
  defaults to 'common'.
- `unionResearchGraphs(rgA, rgB): ResearchGraph` — merge two render graphs into one for the
  canvas: nodes deduped by `id` (A's wins on collision; B-only nodes appended), edges
  deduped by `source|kind|target`. Pure over the plain `{nodes,edges}` shape (no graphology).
- `DIFF_VIEW_COLORS = { added:'#10b981', removed:'#ef4444', changed:'#f59e0b', common:'#4b5563' }`
  exported here (graphology-free, single source — mirrors how `COMMUNITY_PALETTE` lives in
  `research-colors.ts`). Aligns with the existing snapshot `DIFF_COLORS` (onlyInA=red,
  onlyInB=green, inBoth=grey) + amber for the new "changed".

### 3.2 Adapter — `research-graph-adapter.ts` `opts.diffStatusById`

Add `diffStatusById?: Map<string, 'added'|'removed'|'changed'|'common'>` to `opts`. In the
node loop, AFTER the activation block (diff takes top precedence when active, but respects
`dimmed`): if `diffStatusById` is provided, `color = DIFF_VIEW_COLORS[diffStatusById.get(node.id) ?? 'common']`
and `{ highlighted: true, zIndex: 2 }` for non-common nodes. Additive — absent the opt,
behavior byte-identical. (Edge diff coloring is a stretch; v1 colors nodes, which carries
the added/removed/changed signal; edge-status coloring noted deferred.)

### 3.3 GraphCanvas — Compare picker + union render

- A "Compare ▾" control (gated to research/model graphs: `researchName && view !== 'matrix'`)
  listing the other graphs from `listGraphs()` (exclude the current one). Selecting B sets
  `compareB` state; clearing it returns to the normal view.
- When `compareB` set: fetch `getGraphDiff(researchName, compareB)` + `getResearchGraph(compareB)`,
  build `diffStatusById = buildDiffStatus(diff)` and the union `unionResearchGraphs(currentRg, rgB)`;
  render the union (not the plain current graph) with `diffStatusById` via the adapter opts.
  Show a legend: "● added N · ● removed N · ● changed N" (+ edges drift) from `diff.summary`.
- Diff view is mutually exclusive with the metric overlays for clarity (when comparing, the
  metric/observability/activation toggles are hidden or the diff color wins) — v1: diff
  color takes precedence when `compareB` is set.
- `client` (`research-client.ts`): `getGraphDiff(a, b)` = `jsonOrThrow(fetch('/graph/diff?a=&b='))`,
  with the response type.

### 3.4 Verification

- **Unit (host-native vitest)** — `buildDiffStatus` (added/removed/changed→status, precedence,
  unnamed→absent) + `unionResearchGraphs` (dedup nodes by id A-wins, dedup edges by
  source|kind|target, B-only appended) in `graph-diff-view.test.mjs`. These are
  graphology-free → they run (unlike the adapter test).
- **Adapter** `diffStatusById` coloring: a case in `research-graph-adapter.test.mjs` if it
  runs; else skip (graphology limitation) + rely on the web build.
- **Web image build (tsc)** is the binding gate for the `.ts`/`.tsx`.
- No backend change → no patch regen this slice (the diff route already exists). Drift stays
  green by virtue of no `upstream/` edit. (If the client/adapter live in `gitnexus-web/src`
  which is in the patch surface, regen + drift as usual.)

## 4. Scope boundaries

**In scope**: `buildDiffStatus` + `unionResearchGraphs` + `DIFF_VIEW_COLORS` (pure, tested),
the adapter `diffStatusById` node coloring, the GraphCanvas Compare picker + union render +
legend, the `getGraphDiff` client helper.

**Out of scope (deferred)**:
- **Edge diff coloring** (color added/removed edges) — v1 colors nodes; edges carry the
  signal via their endpoints. Edge-status coloring is a follow-up.
- **Diff on lens (code-graph) views** — the picker lists sidecar graphs; lens-vs-lens diff
  is a separate extension.
- **3D diff** (Graph3DCanvas) — v1 is the 2D canvas.
- **Unifying with the code-graph snapshot diff** (`useAppState` enterDiffMode) — that path
  stays separate; this is the research/model-canvas counterpart.

## 5. Open questions

- **Union node attrs when a node changed.** The union takes A's node object for common ids;
  a "changed" node (type/label differs) shows A's label but is colored amber — acceptable
  (the status conveys the change; the inspector/diff response carries from/to). Revisit if a
  side-by-side attr view is wanted.
