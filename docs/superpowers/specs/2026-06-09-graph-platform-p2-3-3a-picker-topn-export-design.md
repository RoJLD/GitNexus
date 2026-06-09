# Graph Platform — P2.3.3a: community picker + top-N panel + metrics export — Design

**Date**: 2026-06-09
**Status**: current
**Builds on**: the P2.3.1/2a/2b/2c metrics stack (engine + `/graph/metrics[/lens]` with
`?community=&resolution=&cap=&approx=` + the overlay size-selector).
**Decomposes**: P2.3 part **C (visualization surfaces)** → **P2.3.3a (this — the cleanly
verifiable surfaces)** + **P2.3.3b** (heatmap coloring + bridge/articulation rendering +
community filter/isolate — the heavily-visual graph styling).

## 1. Context / problem

P2.3.1/2a/2b/2c compute a rich per-node metric set + communities + bridges/articulation
points + a summary, exposed via `/graph/metrics[/lens]` and rendered as a node-size overlay
(size = a chosen centrality, color = community). But the only way to *consume* the metrics is
the size overlay — there is no way to (a) pick the **community-detection method** from the UI
(the endpoint accepts `?community=` but nothing drives it), (b) see a **ranked list** of the
top nodes by a metric, or (c) **export** the metrics for offline analysis. P2.3.3a adds those
three — the surfaces that have extractable, unit-testable pure logic and low visual risk.
(The heavily-visual surfaces — heatmap, highlight, filter — are P2.3.3b.)

## 2. Goal

The overlay gains a **community-method picker** (re-fetches metrics with `?community=`), a
**top-N panel** (ranked list by the selected size-metric), and a **metrics export** (JSON +
CSV download). Pure ranking/serialization logic lives in a unit-tested module; the client
fns accept the community option; no server/MCP/Dockerfile change.

## 3. Design

### 3.1 Pure logic — `upstream/gitnexus-web/src/lib/metrics-view.ts` (new, unit-tested)

```ts
import type { GraphMetricNode, GraphMetrics, SizeMetric } from '../services/graph-theory-client';

/** Top-N nodes by a numeric metric, descending; ties broken by id asc; n clamped ≥0. */
export function topNByMetric(nodes: GraphMetricNode[], metric: SizeMetric, n: number): GraphMetricNode[]

/** Metrics nodes → CSV string (header row = id + all numeric/bool fields; deterministic column order). */
export function metricsToCsv(nodes: GraphMetricNode[]): string

/** Pretty-printed JSON of the full payload (nodes + bridges + summary). */
export function metricsToJson(metrics: GraphMetrics): string
```

- `topNByMetric` operates on the metrics nodes array (not the Map) for a stable sort; pure,
  deterministic. CSV: a fixed column order (`id,degree,pagerank,betweenness,eigenvector,
  closeness,katz,harmonic,coreness,clustering,articulation,componentId,community`), values
  comma-joined, ids quoted if they contain a comma/quote (basic CSV escaping). These are the
  testable core (no DOM).
- A thin **download helper** (`downloadText(filename, mime, text)`) wraps `Blob` + an anchor
  click — DOM-touching, not unit-tested (trivial), kept separate from the pure fns.

### 3.2 Client — community option

`getGraphMetrics(name, opts?)` + `getGraphLensMetrics(lensId, repo, opts?)` gain an optional
`opts: { community?: CommunityMethod; resolution?: number }` (export
`type CommunityMethod = 'louvain' | 'leiden' | 'labelprop'`), appended to the query string
(`?community=…` for sidecar; `&community=…` for lens, which already has `?repo=`). Absent opts
→ byte-identical URLs to today (the existing tests stay green). Builds the query with
`URLSearchParams` so encoding is correct.

### 3.3 GraphCanvas — picker, panel, export (shown only when `metricsOn` + a graph is active)

State additions:
- `communityMethod: CommunityMethod` (default `'louvain'`).
- `metricsData: GraphMetrics | null` — the **full** payload (the effect currently only derives
  `metricsById`; store the raw payload too so the panel/export/summary can use all fields incl.
  `articulation`/`componentId`/`bridges`/`summary`).
- `topNOpen: boolean` (panel toggle).

The metrics-fetch effect (the existing one) threads `communityMethod` into the client call
(`getGraphMetrics(researchName, { community: communityMethod })` / the lens equivalent), sets
both `metricsById` and `metricsData`, and adds `communityMethod` to its deps (so changing the
method re-fetches).

UI (next to the existing Metrics toggle + size `<select>`, gated on `metricsOn && (researchName || (lensId && lensRepo))`):
- **Community picker** — a `<select data-testid="community-select">` with louvain/leiden/labelprop;
  `onChange` sets `communityMethod`.
- **Top-N toggle + panel** — a button toggling `topNOpen`; when open, an absolutely-positioned
  panel listing `topNByMetric(metricsData.nodes, sizeMetric, 10)` as `id — value(4dp)`, titled
  by the current metric. (Clicking a row to focus the node is deferred — v1 lists only.)
- **Export** — a small control with **JSON** + **CSV** actions calling
  `downloadText('graph-metrics.json', 'application/json', metricsToJson(metricsData))` /
  `downloadText('graph-metrics.csv', 'text/csv', metricsToCsv(metricsData.nodes))`.

The size overlay (color = community, size = metric) is unchanged. Heatmap recolor, bridge/
articulation highlight, and community filter are **P2.3.3b**.

## 4. Testing

- **Unit** (`tests/unit/metrics-view.test.mjs`, new — imports the `.ts` like the client test):
  `topNByMetric` (descending, tie-break by id, n clamp, n>len, empty); `metricsToCsv` (header +
  row count + a comma-in-id escaped); `metricsToJson` (round-trips via `JSON.parse`, has nodes/
  bridges/summary).
- **Client** (`tests/unit/graph-theory-client.test.mjs`, extend): `getGraphMetrics('g', {community:'leiden'})`
  → URL `/graph/metrics/g?community=leiden`; `getGraphLensMetrics('imports-deps','r',{community:'labelprop'})`
  → `/graph/metrics/lens/imports-deps?repo=r&community=labelprop`; no-opts calls unchanged.
- **Web build** type-checks the GraphCanvas wiring. **Visual** correctness (panel layout,
  control placement) deferred to a browser QA pass (documented caveat — no local visual QA here).

## 5. Scope boundaries

- **In:** `metrics-view.ts` (top-N + CSV/JSON) + the download helper; client community option;
  GraphCanvas community picker + top-N panel + export controls.
- **Out (→ P2.3.3b):** heatmap coloring by centrality, bridge/articulation rendering, community
  filter/isolate. **Out (deferred polish):** resolution numeric input (picker is method-only in
  v1), node-focus-on-row-click, cap/approx UI controls.
- Frontend-only — **no server/MCP/Dockerfile.web change**. Cohabitation-safe (edits already-built
  web sources + adds one web lib + tracked tests).

## 6. Open questions

- **CSV escaping depth** — v1 does basic escaping (quote fields containing `,`/`"`/newline,
  double internal quotes); ids are file paths / symbol ids, rarely need it. Full RFC-4180 is
  overkill here.
- **Top-N count** — fixed at 10 in v1; a configurable N is a trivial later add.
- **`summary.approximate`/`sampleSize`** — the client `GraphMetrics.summary` type predates
  P2.3.2c's additions; add them as optional fields here (additive) so export/JSON carries them.
