# Graph Platform — P2.3.3b: heatmap coloring + bridge/articulation rendering + community isolate — Design

**Date**: 2026-06-09
**Status**: current
**Builds on**: P2.3.3a (`metrics-view.ts`, the overlay controls, `metricsData`) + the metrics
stack (P2.3.1/2a/2b/2c).
**Decomposes**: closes P2.3 part **C** (P2.3.3a + **P2.3.3b (this)**) — and with it, **all of P2**.

## 1. Context / problem

P2.3.3a surfaced the metrics as a picker + ranked list + export, but the **canvas** still only
encodes them as node *size* (color = community). The structurally-important findings the engine
computes — which nodes are **central** (a continuous heatmap reads better than size alone), which
are **articulation points** / which edges are **bridges** (fragile single-points-of-failure), and
the **community** structure — are not visually legible. P2.3.3b adds three render treatments,
using data already in the payload (`metricsData`: per-node `community`/`articulation`, top-level
`bridges[]`). This is the last P2 surface.

## 2. Goal

The canvas can (a) color nodes by a continuous **heatmap** of the selected metric, (b) **highlight**
articulation-point nodes + bridge edges, and (c) **isolate** a community (dim the rest, keep
context) — all toggled from the overlay, threaded into the existing render adapter. One pure color
fn is unit-tested; the styling is build-checked. No server/MCP/Dockerfile change.

## 3. Design

### 3.1 Pure logic — `heatColor` (extend `metrics-view.ts`, unit-tested)

```ts
/** Sequential heat ramp blue→yellow→red for t∈[0,1] (clamped). Returns '#rrggbb'. */
export function heatColor(t: number): string
```
A 3-stop RGB lerp — `#313695` (blue, cold) → `#ffffbf` (pale yellow, mid) → `#a50026` (red, hot),
the RdYlBu-reversed endpoints. `t` clamped to `[0,1]`. Pure, deterministic; the testable core.

### 3.2 Adapter — `researchGraphToGraphology` gains a 4th `opts` arg (back-compat)

Current signature: `(rg, metricsById?, sizeBy='pagerank')`. Add a **4th optional** arg
`opts` (so the first three are unchanged — minimal churn, only the GraphCanvas call site updates):

```ts
opts?: {
  colorMode?: 'community' | 'heatmap';        // default 'community' (today's behaviour)
  highlightStructure?: boolean;               // default false
  isolateCommunity?: number | null;           // default null (no isolation)
  articulationIds?: Set<string>;              // node ids that are articulation points
  bridgeKeys?: Set<string>;                   // "src\0tgt" keys (both orientations) of bridge edges
}
```

Behaviour (all gated on `m = metricsById?.get(id)` existing — i.e. metrics on; no-metrics path
unchanged; default `opts` → byte-identical to today):
- **Color**: `colorMode==='heatmap'` → `heatColor((m[sizeBy] ?? 0) / maxV)`; else the community
  palette (current). (`maxV` already computed.)
- **Articulation highlight**: `highlightStructure && articulationIds.has(id)` → set node
  `highlighted: true` + `zIndex: 2` (sigma renders highlighted nodes with a halo — the existing
  `SigmaNodeAttributes.highlighted` hook).
- **Isolate (dim, keeps context)**: `isolateCommunity != null && m.community !== isolateCommunity`
  → override node `color: '#374151'` (muted slate) + `size: 2` (a real visual dim using the
  available attrs — there is no opacity attr; members keep their heatmap/community color + size).
- **Bridge highlight (edges)**: `highlightStructure && bridgeKeys.has(\`${e.source}\0${e.target}\`)`
  → edge `color: '#ef4444'` (red) + `size: 3` + `zIndex: 2`; else current (`EDGE_COLOR`, size 1).
  Also dim an edge whose both endpoints are outside the isolated community (gray, size 1) so the
  isolation reads cleanly.

The `metricsById` value type does **not** carry `articulation` (the GraphCanvas map omits it), so
articulation membership flows via the `articulationIds` set in `opts` — computed by GraphCanvas
from `metricsData.nodes`. Bridges flow via `bridgeKeys` from `metricsData.bridges` (both
orientations, since the rendered edge may be stored either way).

### 3.3 GraphCanvas — three overlay controls + render-effect threading

State (alongside the P2.3.3a additions):
- `colorMode: 'community' | 'heatmap'` (default `'community'`).
- `highlightStructure: boolean` (default `false`).
- `isolateCommunity: number | null` (default `null`).

Controls (in the same overlay cluster, gated `metricsOn && (researchName || (lensId && lensRepo))`):
- **Color-mode `<select data-testid="colormode-select">`** (Community | Heatmap).
- **"Highlight" toggle** `data-testid="highlight-toggle"` → `highlightStructure`.
- **Isolate `<select data-testid="isolate-select">`** — options `All` (→ null) + each community id
  present in `metricsData` (`[...new Set(nodes.map(n=>n.community))].sort()`), driving
  `isolateCommunity`.

The render effect (the one calling `researchGraphToGraphology(researchData, metricsOn ? metricsById : undefined, sizeMetric)`)
passes the 4th `opts`:
```ts
researchGraphToGraphology(researchData, metricsOn ? (metricsById ?? undefined) : undefined, sizeMetric, {
  colorMode, highlightStructure, isolateCommunity,
  articulationIds: artIds,    // useMemo from metricsData.nodes.filter(n=>n.articulation).map(n=>n.id)
  bridgeKeys: bridgeKeys,     // useMemo from metricsData.bridges → both "s\0t" and "t\0s"
})
```
`artIds`/`bridgeKeys` are `useMemo`'d from `metricsData`. The render cacheKey gains
`:${colorMode}:${highlightStructure}:${isolateCommunity}` and the effect deps include the three
states (+ `metricsData` for the memos) so the canvas re-renders on change.

## 4. Testing

- **Unit** (`tests/unit/metrics-view.test.mjs`, extend): `heatColor` — `heatColor(0)`/`(1)`/`(0.5)`
  hit the three stops (≈ `#313695`/`#a50026`/`#ffffbf`); clamp (`heatColor(-1)===heatColor(0)`,
  `heatColor(2)===heatColor(1)`); returns a valid `#rrggbb`; the green channel is monotonic up to
  the mid then the red channel rises (basic ramp sanity).
- **Web build** type-checks the adapter signature change + the GraphCanvas wiring (the only reliable
  tsc here).
- ⚠️ **Visual QA NOT performed** — heatmap legibility, halo/dim contrast, and isolate readability
  are visually unverified (no browser path in this environment). Logged as deferred QA debt; this is
  the slice where that debt is most material.

## 5. Scope boundaries

- **In:** `heatColor` + the adapter `opts` (colorMode/highlight/isolate + articulation/bridge sets)
  + the three GraphCanvas controls + render-effect threading.
- **Out:** a community **legend** (the isolate select substitutes for v1); per-node click-to-isolate;
  a separate heatmap color-metric (reuses `sizeMetric`); opacity-based dimming (no attr — uses
  gray+size); animated transitions. Continuous-color legend/scale bar deferred.
- Frontend-only — **no server/MCP/Dockerfile.web change**. The adapter's 4th arg is additive
  (default `opts` → byte-identical render to today, so the existing no-metrics + community-color
  paths are unchanged).

## 6. Open questions

- **Heatmap metric** — reuses `sizeMetric` (size + color both encode it). A dedicated color-metric
  selector is a later refinement; v1 keeps one metric driving both for simplicity.
- **Dim vs hide on isolate** — v1 dims (gray + small) to keep structural context, since
  `SigmaNodeAttributes` has no opacity (only `hidden`). If hiding reads better in practice (a visual-QA
  finding), flipping to `hidden:true` is a one-line change.
- **Color ramp** — RdYlBu-reversed endpoints chosen for cold→hot legibility on a dark canvas; tune
  after visual QA.
