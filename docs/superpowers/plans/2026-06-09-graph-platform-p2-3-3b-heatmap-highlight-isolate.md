# Graph Platform P2.3.3b — heatmap + bridge/articulation render + community isolate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add canvas treatments for the metrics — heatmap node coloring, articulation/bridge highlighting, and community isolate — driven by overlay controls.

**Architecture:** A pure `heatColor` ramp (unit-tested) in `metrics-view.ts`; the render adapter gains a 4th `opts` arg (colorMode/highlight/isolate + articulation/bridge sets); GraphCanvas adds three controls + threads them. Frontend-only — no server/MCP/Dockerfile change. The adapter's default `opts` keeps today's render byte-identical.

**Tech Stack:** React/TypeScript, graphology/sigma, vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-graph-platform-p2-3-3b-heatmap-highlight-isolate-design.md`

**Current state (verified):**
- `lib/metrics-view.ts`: exports `topNByMetric`, `metricsToCsv`, `metricsToJson`, `downloadText`.
- `lib/research-graph-adapter.ts`: `researchGraphToGraphology(rg, metricsById?, sizeBy='pagerank')` — colors via `COMMUNITY_PALETTE[m.community]` when `m` exists else `RESEARCH_COLORS[type]`; size `4 + 16*sqrt(m[sizeBy]/maxV)`; edges `{size:1, color:EDGE_COLOR, relationType, type:'curved', zIndex:1}`. `maxV` precomputed.
- `lib/graph-adapter.ts`: `SigmaNodeAttributes` has `highlighted?`, `hidden?`, `zIndex?`; `SigmaEdgeAttributes` has `size,color,relationType,type?,curvature?,zIndex?`.
- `components/GraphCanvas.tsx`: render effect (~line 365) calls `researchGraphToGraphology(researchData, metricsOn ? (metricsById ?? undefined) : undefined, sizeMetric)`, builds `cacheKey = (researchName?…:lens…) + (metricsOn ? \`:metrics:${sizeMetric}\` : '')`, deps include `metricsOn, metricsById, sizeMetric`. `metricsData` (full `GraphMetrics`) added in P2.3.3a.

---

### Task 1: `heatColor` ramp + unit test

**Files:** Modify `upstream/gitnexus-web/src/lib/metrics-view.ts`; Test `tests/unit/metrics-view.test.mjs`.

- [ ] **Step 1: Failing tests** — add to `metrics-view.test.mjs` (extend the import to add `heatColor`):
```js
describe('heatColor', () => {
  it('hits the three stops and clamps', () => {
    expect(heatColor(0)).toBe('#313695');
    expect(heatColor(0.5)).toBe('#ffffbf');
    expect(heatColor(1)).toBe('#a50026');
    expect(heatColor(-1)).toBe(heatColor(0));   // clamp low
    expect(heatColor(2)).toBe(heatColor(1));     // clamp high
  });
  it('returns a valid #rrggbb for arbitrary t', () => {
    for (const t of [0.1, 0.25, 0.37, 0.6, 0.83]) expect(heatColor(t)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

- [ ] **Step 2: Run → fail** (`cd tests && npx vitest run --config vitest.config.unit.mjs metrics-view`) — `heatColor is not a function`.

- [ ] **Step 3: Implement** — add to `upstream/gitnexus-web/src/lib/metrics-view.ts`:
```ts
const HEAT_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [49, 54, 149]],     // #313695 cold (blue)
  [0.5, [255, 255, 191]], // #ffffbf mid (pale yellow)
  [1, [165, 25, 38]],     // #a50026 hot (red)
];

/** Sequential heat ramp blue→yellow→red for t∈[0,1] (clamped). Returns '#rrggbb'. */
export function heatColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  let lo = HEAT_STOPS[0];
  let hi = HEAT_STOPS[HEAT_STOPS.length - 1];
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    if (x >= HEAT_STOPS[i][0] && x <= HEAT_STOPS[i + 1][0]) { lo = HEAT_STOPS[i]; hi = HEAT_STOPS[i + 1]; break; }
  }
  const span = (hi[0] - lo[0]) || 1;
  const f = (x - lo[0]) / span;
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * f);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(lerp(lo[1][0], hi[1][0]))}${hex(lerp(lo[1][1], hi[1][1]))}${hex(lerp(lo[1][2], hi[1][2]))}`;
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** — controller.

---

### Task 2: adapter `opts` + GraphCanvas controls + render threading

**Files:** Modify `upstream/gitnexus-web/src/lib/research-graph-adapter.ts` + `upstream/gitnexus-web/src/components/GraphCanvas.tsx`. (Build-checked; pure logic is Task 1.)

- [ ] **Step 1: Adapter — 4th `opts` arg**

In `research-graph-adapter.ts`: import `heatColor`, add the `opts` param, and apply the four treatments. Replace the signature + the node/edge construction:

(1a) Import (top of file): `import { heatColor } from './metrics-view';`

(1b) Signature — add the 4th arg:
```ts
export function researchGraphToGraphology(
  rg: ResearchGraph,
  metricsById?: Map<string, { degree: number; pagerank: number; betweenness: number; eigenvector: number; closeness: number; katz: number; harmonic: number; coreness: number; clustering: number; community: number }>,
  sizeBy: 'degree' | 'pagerank' | 'betweenness' | 'eigenvector' | 'closeness' | 'katz' | 'harmonic' | 'coreness' | 'clustering' = 'pagerank',
  opts: {
    colorMode?: 'community' | 'heatmap';
    highlightStructure?: boolean;
    isolateCommunity?: number | null;
    articulationIds?: Set<string>;
    bridgeKeys?: Set<string>;
  } = {},
): Graph<SigmaNodeAttributes, SigmaEdgeAttributes> {
  const { colorMode = 'community', highlightStructure = false, isolateCommunity = null, articulationIds, bridgeKeys } = opts;
```

(1c) Node color + highlight + isolate — replace the `const color = …; const size = …; graph.addNode(…)` block (lines ~58-72) with:
```ts
    const dimmed = isolateCommunity != null && m != null && m.community !== isolateCommunity;
    let color = m
      ? (colorMode === 'heatmap' ? heatColor((m[sizeBy] ?? 0) / maxV) : COMMUNITY_PALETTE[m.community % COMMUNITY_PALETTE.length])
      : (RESEARCH_COLORS[node.type] || RESEARCH_FALLBACK_COLOR);
    let size = m ? 4 + 16 * Math.sqrt((m[sizeBy] ?? 0) / maxV) : 5;
    const isArticulation = !!(highlightStructure && articulationIds?.has(node.id));
    if (dimmed) { color = '#374151'; size = 2; }   // dim non-isolated (no opacity attr → gray+small)
    graph.addNode(node.id, {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      size,
      color,
      label: node.label,
      nodeType: 'CodeElement',
      filePath: node.path,
      mass: 3,
      ...(isArticulation && !dimmed ? { highlighted: true, zIndex: 2 } : {}),
    });
```

(1d) Edge bridge-highlight + isolate-dim — replace the `graph.addEdge(…)` block (lines ~79-85) with:
```ts
    const isBridge = !!(highlightStructure && bridgeKeys?.has(`${e.source}\0${e.target}`));
    const sm = metricsById?.get(e.source);
    const tm = metricsById?.get(e.target);
    const edgeDimmed = isolateCommunity != null && sm != null && tm != null && sm.community !== isolateCommunity && tm.community !== isolateCommunity;
    graph.addEdge(e.source, e.target, {
      size: isBridge ? 3 : 1,
      color: edgeDimmed ? '#1f2937' : (isBridge ? '#ef4444' : EDGE_COLOR),
      relationType: e.kind,
      type: 'curved',
      zIndex: isBridge ? 2 : 1,
    });
```

- [ ] **Step 2: GraphCanvas — state + memos + controls + render threading** (read the current lines first)

(2a) Imports — add `heatColor` is NOT needed in GraphCanvas (only the adapter uses it). No new import beyond what P2.3.3a added. (`useMemo` — confirm it's imported from 'react'; if not, add it.)

(2b) State (after the P2.3.3a additions ~line 133):
```tsx
  const [colorMode, setColorMode] = useState<'community' | 'heatmap'>('community');
  const [highlightStructure, setHighlightStructure] = useState(false);
  const [isolateCommunity, setIsolateCommunity] = useState<number | null>(null);
```

(2c) Memos (near the state, after `metricsData` is defined):
```tsx
  const articulationIds = useMemo(
    () => new Set((metricsData?.nodes ?? []).filter((n) => n.articulation).map((n) => n.id)),
    [metricsData],
  );
  const bridgeKeys = useMemo(() => {
    const s = new Set<string>();
    for (const b of metricsData?.bridges ?? []) { s.add(`${b.source}\0${b.target}`); s.add(`${b.target}\0${b.source}`); }
    return s;
  }, [metricsData]);
  const communityIds = useMemo(
    () => [...new Set((metricsData?.nodes ?? []).map((n) => n.community))].sort((a, b) => a - b),
    [metricsData],
  );
```

(2d) Render effect — thread the 4th arg + extend cacheKey + deps. Replace the `researchGraphToGraphology(...)` call + cacheKey + deps (the render effect ~line 364-368):
```tsx
    const g = researchGraphToGraphology(researchData, metricsOn ? (metricsById ?? undefined) : undefined, sizeMetric, {
      colorMode, highlightStructure, isolateCommunity, articulationIds, bridgeKeys,
    });
    const cacheKey = (researchName ? `research:${researchName}` : `lens:${lensId}:${lensRepo}`)
      + (metricsOn ? `:metrics:${sizeMetric}:${colorMode}:${highlightStructure}:${isolateCommunity}` : '');
```
and add `colorMode, highlightStructure, isolateCommunity, articulationIds, bridgeKeys` to that effect's deps array.

(2e) Controls — in the overlay cluster (gated `metricsOn && (researchName || (lensId && lensRepo))`), after the P2.3.3a controls, add:
```tsx
          <select
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value as 'community' | 'heatmap')}
            className="flex h-10 items-center rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-3 font-mono text-xs font-semibold text-indigo-200 transition-colors hover:border-indigo-300/60 hover:bg-indigo-500/20"
            data-testid="colormode-select" title="Node color mode"
          >
            <option value="community">Color: community</option>
            <option value="heatmap">Color: heatmap</option>
          </select>
          <button
            onClick={() => setHighlightStructure((v) => !v)}
            className={highlightStructure
              ? 'flex h-10 items-center rounded-lg border border-rose-400/50 bg-rose-500/15 px-3 font-mono text-xs font-semibold text-rose-200'
              : 'flex h-10 items-center rounded-lg border border-border-subtle bg-elevated px-3 font-mono text-xs font-semibold text-text-secondary transition-colors hover:bg-hover hover:text-text-primary'}
            data-testid="highlight-toggle" title="Highlight articulation points + bridges"
          >Highlight</button>
          {communityIds.length > 1 && (
            <select
              value={isolateCommunity == null ? '' : String(isolateCommunity)}
              onChange={(e) => setIsolateCommunity(e.target.value === '' ? null : Number(e.target.value))}
              className="flex h-10 items-center rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-3 font-mono text-xs font-semibold text-indigo-200 transition-colors hover:border-indigo-300/60 hover:bg-indigo-500/20"
              data-testid="isolate-select" title="Isolate a community (dim the rest)"
            >
              <option value="">All communities</option>
              {communityIds.map((c) => (<option key={c} value={String(c)}>Community {c}</option>))}
            </select>
          )}
```

- [ ] **Step 3: Type-check** — `cd upstream/gitnexus-web && npx tsc -b --noEmit` if available; else rely on the web image build (Final). Confirm: `heatColor` imported in the adapter; `useMemo` imported in GraphCanvas; the `opts` object shape matches; no unguarded `metricsData` access (memos use `?? []`); JSX balanced.

- [ ] **Step 4: Commit** — controller.

---

## Final verification (controller)

1. **Drift** → exit 0.
2. **Unit:** `metrics-view` (heatColor + existing) → pass.
3. **Web image build** (the real tsc): `docker compose -f docker-compose.test.yml build gitnexus-web-test` → success ⇒ adapter + GraphCanvas type-check.
4. **No server/MCP/Dockerfile.web change** — `git diff` touches only `gitnexus-web/` + tracked tests + docs + patches.
5. **Visual QA** — NOT performed (no browser path); heatmap/halo/dim legibility unverified. Flag in summary.
6. Push is the **user's call** — summarize P2.3.3b shipped → **P2 complete** + the visual-QA debt across P2.3.3.
