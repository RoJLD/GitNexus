# Graph Platform P3.1 — layout selector + hierarchical (layered) layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add a layout selector (force | hierarchical | circular) to the research/lens canvas, with a hand-rolled BFS-rank hierarchical layout that skips ForceAtlas2.

**Architecture:** Pure `layeredLayout` (unit-tested) computes rank-based positions; `useSigma.setGraph` gains `skipLayout` (use final positions, no FA2); the adapter sets positions per `layoutMode`; GraphCanvas adds the selector + wiring. Dep-free, frontend-only.

**Tech Stack:** React/TypeScript, graphology/sigma, vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-graph-platform-p3-1-layout-selector-design.md`

**Current state (verified):**
- `hooks/useSigma.ts`: `setGraph(newGraph, opts: { cacheKey?: string })` (interface line 143-146; impl line 879-918). Fast-path cache-restore at 902-912 (skip FA2 if ≥80% cached); else `runLayout` (FA2) at 914. `setSelectedNode(null)` at 898.
- `components/GraphCanvas.tsx`: `setGraph: setSigmaGraph` (line 297). The research/lens render effect (lines ~385-393) builds `g = researchGraphToGraphology(researchData, metricsOn ? (metricsById ?? undefined) : undefined, sizeMetric, { colorMode, highlightStructure, isolateCommunity, articulationIds, bridgeKeys })`, a `cacheKey`, then `setSigmaGraph(g, { cacheKey })`; deps listed at 393.
- `lib/research-graph-adapter.ts`: `researchGraphToGraphology(rg, metricsById?, sizeBy='pagerank', opts={})` — seeds circle positions (`x=cos(angle)*r, y=sin(angle)*r`), opts has colorMode/highlightStructure/isolateCommunity/articulationIds/bridgeKeys (P2.3.3b).

---

### Task 1: pure `layeredLayout` + unit test

**Files:** Create `upstream/gitnexus-web/src/lib/layered-layout.ts`; Test `tests/unit/layered-layout.test.mjs` (new).

- [ ] **Step 1: Failing tests** — create `tests/unit/layered-layout.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { layeredLayout } from '../../upstream/gitnexus-web/src/lib/layered-layout.ts';

const G = (nodes, edges) => ({ nodes: nodes.map((id) => ({ id })), edges: edges.map(([source, target]) => ({ source, target })) });

describe('layeredLayout', () => {
  it('ranks a path A→B→C by strictly increasing x', () => {
    const p = layeredLayout(G(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]));
    expect(p.get('A').x).toBeLessThan(p.get('B').x);
    expect(p.get('B').x).toBeLessThan(p.get('C').x);
  });
  it('a diamond puts B/C at the same rank, D one further', () => {
    const p = layeredLayout(G(['A', 'B', 'C', 'D'], [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D']]));
    expect(p.get('B').x).toBe(p.get('C').x);
    expect(p.get('B').y).not.toBe(p.get('C').y);   // spread within the rank
    expect(p.get('D').x).toBeGreaterThan(p.get('B').x);
    expect(p.get('A').x).toBeLessThan(p.get('B').x);
  });
  it('terminates + ranks every node on a cycle A→B→C→A', () => {
    const p = layeredLayout(G(['A', 'B', 'C'], [['A', 'B'], ['B', 'C'], ['C', 'A']]));
    for (const id of ['A', 'B', 'C']) { expect(Number.isFinite(p.get(id).x)).toBe(true); expect(Number.isFinite(p.get(id).y)).toBe(true); }
  });
  it('2-component graph: both roots at rank 0 (same x), distinct y', () => {
    const p = layeredLayout(G(['a', 'b', 'c', 'd'], [['a', 'b'], ['c', 'd']]));
    expect(p.get('a').x).toBe(p.get('c').x);       // both rank 0
    expect(p.get('a').y).not.toBe(p.get('c').y);
    expect(p.get('b').x).toBe(p.get('d').x);        // both rank 1
    expect(p.get('b').x).toBeGreaterThan(p.get('a').x);
  });
  it('positions an isolated node', () => {
    const p = layeredLayout(G(['z'], []));
    expect(Number.isFinite(p.get('z').x)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail** (`cd tests && npx vitest run --config vitest.config.unit.mjs layered-layout`).

- [ ] **Step 3: Implement** — create `upstream/gitnexus-web/src/lib/layered-layout.ts`:
```ts
export interface LayoutGraph {
  nodes: { id: string }[];
  edges: { source: string; target: string }[];
}

/**
 * Hand-rolled BFS-rank layered layout (dep-free). rank = shortest hops from a source
 * (in-degree-0 node, or each unranked node as a fresh root for cycles / unreachable);
 * x = rank·DX, y = spread within the rank centered on 0. O(V+E), deterministic. No DOM.
 */
export function layeredLayout(graph: LayoutGraph, opts: { dx?: number; dy?: number } = {}): Map<string, { x: number; y: number }> {
  const DX = opts.dx ?? 160;
  const DY = opts.dy ?? 80;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const n of graph.nodes || []) { if (n && n.id != null && !seen.has(n.id)) { seen.add(n.id); ids.push(n.id); } }
  const idSet = new Set(ids);
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of graph.edges || []) {
    if (!e || !idSet.has(e.source) || !idSet.has(e.target) || e.source === e.target) continue;
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const rank = new Map<string, number>();
  const bfs = (starts: string[]) => {
    let layer = starts.filter((s) => !rank.has(s));
    for (const s of layer) rank.set(s, 0);
    while (layer.length) {
      const next: string[] = [];
      for (const u of layer) {
        for (const v of adj.get(u)!) {
          if (!rank.has(v)) { rank.set(v, (rank.get(u) ?? 0) + 1); next.push(v); }
        }
      }
      layer = next;
    }
  };
  const roots = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  if (roots.length) bfs(roots);
  for (const id of ids) { if (!rank.has(id)) bfs([id]); }   // cycles / unreachable → fresh root

  const byRank = new Map<number, string[]>();
  for (const id of ids) { const r = rank.get(id)!; if (!byRank.has(r)) byRank.set(r, []); byRank.get(r)!.push(id); }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [r, members] of byRank) {
    const k = members.length;
    members.forEach((id, i) => pos.set(id, { x: r * DX, y: (i - (k - 1) / 2) * DY }));
  }
  return pos;
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** — controller.

---

### Task 2: `useSigma.skipLayout` + adapter `layoutMode` + GraphCanvas selector

**Files:** Modify `upstream/gitnexus-web/src/hooks/useSigma.ts`, `upstream/gitnexus-web/src/lib/research-graph-adapter.ts`, `upstream/gitnexus-web/src/components/GraphCanvas.tsx`. (Build-checked; pure logic is Task 1.)

- [ ] **Step 1: `useSigma.setGraph` — `skipLayout`**

(1a) The `setGraph` type in the `UseSigmaReturn` interface (line ~143-146): add `skipLayout?: boolean` to the opts:
```ts
  setGraph: (
    graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
    opts?: { cacheKey?: string; skipLayout?: boolean },
  ) => void;
```

(1b) The `setGraph` impl opts param (line ~882): `opts: { cacheKey?: string; skipLayout?: boolean } = {},`

(1c) After `setSelectedNode(null);` (line 898) and BEFORE the cache fast-path (line 900), add:
```ts
      // P3.1: hierarchical/circular layouts carry FINAL positions from the adapter —
      // use them as-is (no FA2, no layout cache).
      if (opts.skipLayout) {
        sigma.refresh();
        sigma.getCamera().animatedReset({ duration: 200 });
        return;
      }
```

- [ ] **Step 2: Adapter — `layoutMode` positions**

In `research-graph-adapter.ts`: import `layeredLayout`, extend `opts` with `layoutMode`, and set positions when hierarchical.

(2a) Import: `import { layeredLayout } from './layered-layout';`

(2b) Extend the `opts` type + destructure (add to the existing P2.3.3b opts):
```ts
    layoutMode?: 'force' | 'hierarchical' | 'circular';
```
and in the destructure: `const { colorMode = 'community', highlightStructure = false, isolateCommunity = null, articulationIds, bridgeKeys, layoutMode = 'force' } = opts;`

(2c) Before the node loop, compute the layered positions once when hierarchical:
```ts
  const layered = layoutMode === 'hierarchical'
    ? layeredLayout({ nodes: nodes.map((n) => ({ id: n.id })), edges: (rg.edges || []).map((e) => ({ source: e.source, target: e.target })) })
    : null;
```
(`nodes` is the existing `rg.nodes || []`.)

(2d) In the node-add, override x/y when a layered position exists (keep the circle seed as fallback / for force+circular). Replace the `x:`/`y:` lines in `graph.addNode(node.id, { x: …, y: …, … })`:
```ts
      x: layered?.get(node.id)?.x ?? Math.cos(angle) * r,
      y: layered?.get(node.id)?.y ?? Math.sin(angle) * r,
```

- [ ] **Step 3: GraphCanvas — selector + wiring**

(3a) State (near the other graph-view state, after `sizeMetric` ~line 128):
```tsx
  const [layoutMode, setLayoutMode] = useState<'force' | 'hierarchical' | 'circular'>('force');
```

(3b) Render effect (the research/lens one, ~385-393): pass `layoutMode` into the adapter opts, add it to the cacheKey, set `skipLayout`, and add to deps. Replace the adapter call + cacheKey + setSigmaGraph + deps:
```tsx
    const g = researchGraphToGraphology(researchData, metricsOn ? (metricsById ?? undefined) : undefined, sizeMetric, {
      colorMode, highlightStructure, isolateCommunity, articulationIds, bridgeKeys, layoutMode,
    });
    const cacheKey = (researchName ? `research:${researchName}` : `lens:${lensId}:${lensRepo}`)
      + (metricsOn ? `:metrics:${sizeMetric}:${colorMode}:${highlightStructure}:${isolateCommunity}` : '')
      + `:layout:${layoutMode}`;
    setSigmaGraph(g, { cacheKey, skipLayout: layoutMode !== 'force' });
  }, [researchName, lensId, lensRepo, researchData, setSigmaGraph, metricsOn, metricsById, sizeMetric, colorMode, highlightStructure, isolateCommunity, articulationIds, bridgeKeys, layoutMode]);
```

(3c) Selector — in the overlay cluster, gated on the graph-view condition (`researchName || (lensId && lensRepo)`) but NOT behind `metricsOn` (layout is independent of metrics). Place it near the Metrics toggle:
```tsx
        {(researchName || (lensId && lensRepo)) && (
          <select
            value={layoutMode}
            onChange={(e) => setLayoutMode(e.target.value as 'force' | 'hierarchical' | 'circular')}
            className="flex h-10 items-center rounded-lg border border-border-subtle bg-elevated px-3 font-mono text-xs font-semibold text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            data-testid="layout-select" title="Graph layout"
          >
            <option value="force">Layout: force</option>
            <option value="hierarchical">Layout: hierarchical</option>
            <option value="circular">Layout: circular</option>
          </select>
        )}
```
(Read the current overlay JSX to place this cleanly alongside the existing `metrics-toggle` / metric-select cluster; ensure it sits in the same top-right control container.)

- [ ] **Step 4: Type-check** — `cd upstream/gitnexus-web && npx tsc -b --noEmit` if available; else rely on the web image build (Final). Confirm `layeredLayout` imported in the adapter; `layoutMode` threaded; `skipLayout` reaches `useSigma`; selector union casts; JSX balanced; existing controls intact.

- [ ] **Step 5: Commit** — controller.

---

## Final verification (controller)

1. **Drift** → exit 0.
2. **Unit:** `layered-layout` (+ existing `metrics-view`, `graph-theory*` unaffected) → pass.
3. **Web image build** (the frontend tsc): `docker compose -f docker-compose.test.yml build gitnexus-web-test` → success.
4. **Browser visual-QA** (Playwright, the path works now): up the stack + import a `research-graph`, load `?research=<name>`, switch `layout-select` force→hierarchical→circular, screenshot each — confirm hierarchical = ranked columns (no FA2 drift), circular = static ring, force = converged blob. Capture console/page errors (expect 0). Tear down after.
5. **No server/MCP/Dockerfile.web change.**
6. Push is the **user's call** — summarize P3.1 shipped + P3.2/3.3/3.4 staged.
