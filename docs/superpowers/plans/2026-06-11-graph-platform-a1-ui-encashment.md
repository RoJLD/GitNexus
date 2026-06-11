# A.1 — UI encashment of the engine — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-11-graph-platform-a1-ui-encashment-design.md`.

**Goal:** surface the engine's directed metrics, multi-level community, and spectral embeddings in the canvas: directed-metric selector, community-level slider, spectral layout, kNN similarity panel. All opt-in/additive.

**Verification:** `cd tests && npx vitest run --config vitest.config.unit.mjs embedding-tools`; web image build (tsc). `gitnexus-web/src` is in the patch surface → regen + drift.

### Task 1: client extension + pure `embedding-tools.ts` + tests
**Files:** modify `upstream/gitnexus-web/src/services/graph-theory-client.ts`; create `upstream/gitnexus-web/src/lib/embedding-tools.ts`; create `tests/unit/embedding-tools.test.mjs`.

**Client (`graph-theory-client.ts`):**
- `MetricsOpts` += `directed?: boolean; hierarchy?: boolean; embed?: 'spectral'; dims?: number`. In `metricsQuery`: `if (opts?.directed) q.set('directed','1'); if (opts?.hierarchy) q.set('hierarchy','1'); if (opts?.embed) q.set('embed', opts.embed); if (opts?.dims !== undefined) q.set('dims', String(opts.dims));`
- `GraphMetricNode` += `inDegree?: number; outDegree?: number; hubs?: number; authorities?: number; sccId?: number; communityPath?: number[]; embedding?: number[];`
- `GraphMetrics` += `hierarchy?: { levelCount: number; levels: { modularity: number; communityCount: number }[]; method: string };` and `summary` += `directed?: boolean; stronglyConnectedComponentCount?: number; embedding?: { method: string; dims: number };`
- `export type DirectedSizeMetric = 'inDegree' | 'outDegree' | 'hubs' | 'authorities';` `export type SizeMetricAny = SizeMetric | DirectedSizeMetric;`

**Pure lib (`embedding-tools.ts`)** — graphology-free, NO imports:
```ts
export function nearestNeighbors(embeddingById: Map<string, number[]>, id: string, k = 8): { id: string; sim: number }[] {
  const v = embeddingById.get(id);
  if (!v) return [];
  const norm = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  const nv = norm(v);
  const out: { id: string; sim: number }[] = [];
  for (const [oid, w] of embeddingById) {
    if (oid === id) continue;
    const nw = norm(w);
    let dot = 0; const n = Math.min(v.length, w.length);
    for (let i = 0; i < n; i++) dot += v[i] * w[i];
    out.push({ id: oid, sim: nv > 0 && nw > 0 ? dot / (nv * nw) : 0 });
  }
  out.sort((a, b) => (b.sim - a.sim) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.slice(0, k);
}
export function spectralLayout(embeddingById: Map<string, number[]>, ids: string[], { scale = 300 }: { scale?: number } = {}): Map<string, { x: number; y: number }> {
  const pts = ids.map((id) => { const e = embeddingById.get(id) ?? []; return { id, x: e[0] ?? 0, y: e[1] ?? 0 }; });
  const n = Math.max(1, pts.length);
  const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  let maxAbs = 1e-9;
  for (const p of pts) maxAbs = Math.max(maxAbs, Math.abs(p.x - mx), Math.abs(p.y - my));
  const out = new Map<string, { x: number; y: number }>();
  for (const p of pts) out.set(p.id, { x: ((p.x - mx) / maxAbs) * scale, y: ((p.y - my) / maxAbs) * scale });
  return out;
}
```

- [ ] **Step 1: test first** `tests/unit/embedding-tools.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { nearestNeighbors, spectralLayout } from '../../upstream/gitnexus-web/src/lib/embedding-tools.ts';

describe('nearestNeighbors', () => {
  it('ranks by cosine similarity, excludes self, respects k', () => {
    const m = new Map([['a', [1, 0]], ['b', [0.9, 0.1]], ['c', [0, 1]], ['d', [-1, 0]]]);
    const nn = nearestNeighbors(m, 'a', 2);
    expect(nn.map((x) => x.id)).toEqual(['b', 'c']);   // b most aligned, c orthogonal, d opposite
    expect(nn.find((x) => x.id === 'a')).toBeUndefined();
    expect(nn[0].sim).toBeGreaterThan(nn[1].sim);
  });
  it('returns [] for an unknown id', () => { expect(nearestNeighbors(new Map(), 'x', 5)).toEqual([]); });
});
describe('spectralLayout', () => {
  it('positions from dims 0/1, centered + scaled', () => {
    const m = new Map([['a', [1, 1]], ['b', [-1, -1]]]);
    const pos = spectralLayout(m, ['a', 'b'], { scale: 100 });
    expect(pos.get('a').x).toBeCloseTo(100, 5); expect(pos.get('a').y).toBeCloseTo(100, 5);
    expect(pos.get('b').x).toBeCloseTo(-100, 5);
  });
  it('missing embedding → origin, no throw', () => {
    const pos = spectralLayout(new Map(), ['x'], {});
    expect(pos.get('x')).toEqual({ x: 0, y: 0 });
  });
});
```
- [ ] **Step 2: run, verify FAIL.** **Step 3: implement** the client edits + `embedding-tools.ts`. **Step 4: run, verify PASS** (`embedding-tools`). **Step 5:** report.

### Task 2: adapter opts (`research-graph-adapter.ts`)
- Widen the `metricsById` value type with optional `inDegree?/outDegree?/hubs?/authorities?: number`; widen the `sizeBy` param to `SizeMetricAny` (import from the client). `maxV` + the size/heatmap formulas read `m[sizeBy] ?? 0` (already generic — just the type widens).
- `opts` += `communityOverrideById?: Map<string, number>` (color uses `communityOverrideById?.get(node.id) ?? m.community`), `precomputedPositions?: Map<string,{x:number;y:number}>` (used when `layoutMode === 'spectral'`, mirroring the `layeredLayout` branch — extend the `layoutMode` union with `'spectral'` and the position-selection logic), `knnIds?: Set<string>` (a node in it gets `{highlighted:true, zIndex:2}`, reusing the existing highlight spread). All additive.
- [ ] Implement; type-clean by construction. (No standalone failing test — pure logic is Task 1; tsc-gated.) Controller runs the web build.

### Task 3: GraphCanvas wiring (`GraphCanvas.tsx`)
- State: `directedOn`, `hierarchyOn`, `communityLevel` (number, 0), `spectralOn` (or fold into layoutMode='spectral'), `knnOn`.
- Fetch: thread `directed: directedOn`, `hierarchy: hierarchyOn`, `embed: (spectralOn || knnOn) ? 'spectral' : undefined` into the `getGraphMetrics`/`getGraphLensMetrics` opts; add the new toggles to the fetch effect deps.
- Build from `metricsData.nodes`: extend `metricsById` with the directed fields; `embeddingById = new Map(nodes.filter(n=>n.embedding).map(n=>[n.id, n.embedding]))`; `communityOverrideById = hierarchyOn ? new Map(nodes.map(n=>[n.id, n.communityPath?.[communityLevel] ?? n.community])) : undefined`; `precomputedPositions = layoutMode==='spectral' ? spectralLayout(embeddingById, nodes.map(n=>n.id)) : undefined`; `knnIds = knnOn && selectedNode ? new Set(nearestNeighbors(embeddingById, selectedNode, 8).map(x=>x.id)) : undefined`.
- UI:
  - **Directed toggle** + when on, the size-metric `<select>` gains an optgroup "Directed" with inDegree/outDegree/hubs/authorities (typed `SizeMetricAny`).
  - **Hierarchy toggle** + a range `<input type=range min=0 max={levelCount-1}>` (shown when `metricsData?.hierarchy?.levelCount > 1`) bound to `communityLevel`, label "level L/Lmax".
  - **Layout `<select>`** gains a `spectral` option.
  - **kNN panel**: a "Similar nodes" toggle; when on + a node selected, a small panel (near NodeInspector) listing the top-8 neighbours (id + `Math.round(sim*100)%`); pass `knnIds` to the adapter to highlight them.
- Pass the new opts into the `researchGraphToGraphology(..., opts)` call; add to deps + cacheKey.
- All gated to research/model (and lens where metrics apply); below toggles → unchanged.
- [ ] Implement; self-review (each toggle threads fetch+build+opts+deps; below-off unchanged). Controller runs the web build (tsc).

### Post-build (controller)
1. `embedding-tools` unit green; web image build (tsc) green.
2. Regen patches (gitnexus-web/src) + drift → exit 0.
3. Commit + push `deployment`; mark A.1 ✅ in ROADMAP/INVENTORY + spec Status + memory.
