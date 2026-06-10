# Graph Platform — render-prop passthrough + edge weight-delta diff

**Date**: 2026-06-10
**Status**: current
**Context**: the recurring "weight isn't surfaced by `sidecarRender`" limitation noted
across P-IA.1 (edge `weight` stored but not rendered), P-IA.2-dynamic (activation
edge-width deferred), P-IA.3 (edge weight-delta diff deferred), and the P2.3 weighted-edge
backlog. This is the small enabler that unblocks them, plus its first consumer.

## 1. Context / problem

The sidecar `render` (`graphs-sidecar/kuzu-store.mjs`) maps each Kùzu node/edge to a
**fixed** shape — nodes `{id,type,label,path,stage}`, edges `{source,target,kind,id}` —
**dropping every other stored property**. So a model edge's `weight` (transition/emission
probability), a node's `layer`, and any future prop are written to Kùzu by importers but
never reach the render consumers (metrics engine, diff, the canvas adapter, MCP). This
forced three deferrals: weight-delta model diff, activation edge-width, weighted metrics.

The fix is a one-line-ish **additive passthrough**: render spreads all stored props, then
sets the computed `id/type/label/...` on top. Existing consumers read the same named
fields (unchanged); new consumers can now read `weight` et al. This slice also lands the
**first consumer** — edge **weight-delta** in `diffGraphs` (P-IA.3) — so the enabler ships
with visible value rather than as dead plumbing.

## 2. Goal

`sidecarRender(name)` carries through arbitrary node/edge properties (notably edge
`weight`), additively (response is a superset of today's shape; existing consumers
unaffected). `diffGraphs` gains an **edge `changed`** bucket detecting weight deltas
between two model versions. Success: render of a model graph includes `edges[].weight`;
diffing two model versions whose only difference is a transition weight reports that edge
as `changed` with `from.weight`/`to.weight`.

## 3. Design

### 3.1 Pure `mapRenderRows` (host-testable) + sidecar render passthrough

`graphs-sidecar/kuzu-store.mjs` imports `kuzu` at the top, so it can't be unit-tested
host-native. **Extract** the pure row→shape mapping into a new kuzu-free module
`graphs-sidecar/render-map.mjs`:

```js
export function mapRenderRows(nrows, erows) {
  const nodes = nrows.map(({ n, lbl }) => ({
    ...n,                                  // passthrough: layer, weight-less node props, …
    id: n.id,
    type: n.type ?? lbl ?? '',
    label: n.label ?? n.title ?? n.name ?? String(n.id),
    path: n.path ?? '',
    stage: n.stage ?? '',
  }));
  const edges = erows.map(({ source, target, r, lbl }) => ({
    ...r,                                  // passthrough: weight, and any other edge prop
    source, target,
    kind: r.kind ?? lbl ?? '',
    id: r.id ?? `${source}->${target}`,
  }));
  return { nodes, edges };
}
```

`render(name)` in `kuzu-store.mjs` becomes: run the two cypher queries (unchanged), then
`return mapRenderRows(nrows, erows)`. The `...n`/`...r` spread is **additive** — every
field the current render emits is still set explicitly (overriding the spread), so the
output is a strict superset. Kùzu-internal fields (if any) riding along are harmless
(consumers read named fields). `graphs-sidecar/` is a **tracked top-level dir, not
`upstream/`** → this is a direct tracked edit, no patch regen, but it DOES require a
sidecar image rebuild to deploy (noted in §5).

### 3.2 `diffGraphs` edge weight-delta (first consumer)

Extend `diffGraphs` in `upstream/docker-server-graph-templates-core.mjs` (the P-IA.3
function): build key→edge **maps** (not just sets) for A and B edges. For each **common**
edge key, if `aEdge.weight !== bEdge.weight`, push to a new `edges.changed` bucket:
`{ key, from: { weight: aEdge.weight ?? null }, to: { weight: bEdge.weight ?? null } }`.
Add `summary.changedEdges` and include it in `drift`. **Additive** — existing
`edges.added/removed/commonCount` and node buckets are unchanged; `edges.changed` is a new
field, so existing diff tests still pass. (Edge identity stays `id` = `${from}->${kind}->${to}`
or the `source kind target` fallback; weight is compared *within* common edges, not part of
identity.)

### 3.3 Downstream consumers (unblocked, not all built here)

With weight in the render output, three deferred items become straightforward follow-ups
(noted, not all built this slice):
- **Activation edge-width** (P-IA.2-dynamic) — the frontend can scale edge width by the
  activation `edges` frequency (and now also by structural `weight`).
- **Weighted-edge metrics** (P2.3 backlog) — the engine's Louvain/centrality could honor
  `edge.weight`; a larger change, stays backlog.
- This slice builds **only** the weight-delta diff consumer (§3.2); the others are
  explicitly deferred so the slice stays tight.

## 4. Verification posture

- **Unit (host-native vitest)** — primary gate:
  - `mapRenderRows`: synthetic `nrows`/`erows` (Kùzu-like row objects, an edge row with a
    `weight` prop + extra node props) → assert `weight` passes through on edges, an extra
    node prop passes through, and `id/type/label/path/stage` + edge `source/target/kind/id`
    are computed with the documented fallbacks. A node/edge with NO extra props → exactly
    today's shape (superset check).
  - `diffGraphs` weight-delta: two graphs, an edge present in both with the same id but
    different `weight` → `edges.changed` has one entry with `from.weight`/`to.weight`;
    `summary.changedEdges === 1`; `drift` includes it. Existing diff tests stay green.
- **Sidecar integration** (`tests/integration/sidecar/graphs-sidecar.test.mjs`) — if it
  asserts the render shape, confirm the superset doesn't break it; sidecar-gated.
- No web build needed (no frontend change this slice).
- Drift green (only `diffGraphs`/upstream changed → patch regen; `graphs-sidecar/` is a
  direct tracked edit).

## 5. Scope boundaries

**In scope**: the pure `mapRenderRows` extraction + `...n`/`...r` passthrough in the
sidecar render; `diffGraphs` edge weight-delta + its tests; the `mapRenderRows` unit test.

**Out of scope (deferred)**:
- **Activation edge-width** + **weighted-edge metrics** — unblocked by this passthrough,
  built later when prioritized.
- **A render-shape contract/version** — the passthrough is additive; no formal versioning.
- **Deploying the rebuilt sidecar** — the change requires a `graphs-sidecar` image rebuild
  to take effect live; that's a deploy step (the dev stack runs the old image). Verified
  here by the pure `mapRenderRows` unit test + the gated sidecar integration test.

## 6. Open questions

- **Leaking Kùzu-internal fields.** `...n`/`...r` spreads whatever the Kùzu driver returns
  on a row object; if it includes internal keys (`_id`, etc.) they'd appear in the render
  output. Harmless (consumers read named fields), but if it proves noisy, restrict the
  spread to known prop names. Decide if/when it surfaces.
