# Render LoD v1 — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-10-graph-platform-render-lod-design.md`.

**Goal:** pure `pruneForRender(graph,{maxNodes,by})` (node-cap + top-N-by-degree) in `gitnexus-web/src/lib/graph-lod.ts` (graphology-free, host-tested) + GraphCanvas auto-applies it above `LOD_MAX_NODES` with a "showing N of M" banner.

**Verification:** `cd tests && npx vitest run --config vitest.config.unit.mjs graph-lod`; web image build (tsc). `gitnexus-web/src` is in the patch surface → regen + drift.

### Task 1: pure `graph-lod.ts` + unit test
**Files:** create `upstream/gitnexus-web/src/lib/graph-lod.ts`; create `tests/unit/graph-lod.test.mjs`. (Graphology-free — like `graph-diff-view.ts`.)

```ts
export const LOD_MAX_NODES = 1500;
export interface LodResult<N, E> { nodes: N[]; edges: E[]; pruned: boolean; shown: number; total: number; by: string }
export function pruneForRender<N extends { id: string }, E extends { source: string; target: string }>(
  graph: { nodes: N[]; edges: E[] } | undefined,
  { maxNodes = LOD_MAX_NODES, by = 'degree' }: { maxNodes?: number; by?: string } = {},
): LodResult<N, E> {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? []; const total = nodes.length;
  if (total <= maxNodes) return { nodes, edges, pruned: false, shown: total, total, by };
  const deg = new Map<string, number>();
  for (const n of nodes) deg.set(n.id, 0);
  for (const e of edges) { if (deg.has(e.source)) deg.set(e.source, deg.get(e.source)! + 1); if (deg.has(e.target)) deg.set(e.target, deg.get(e.target)! + 1); }
  const keepIds = new Set([...nodes].map((n) => n.id).sort((a, b) => (deg.get(b)! - deg.get(a)!) || (a < b ? -1 : a > b ? 1 : 0)).slice(0, maxNodes));
  const keptNodes = nodes.filter((n) => keepIds.has(n.id));
  const keptEdges = edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target));
  return { nodes: keptNodes, edges: keptEdges, pruned: true, shown: keptNodes.length, total, by };
}
```

- [ ] **Step 1: test first** `tests/unit/graph-lod.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { pruneForRender, LOD_MAX_NODES } from '../../upstream/gitnexus-web/src/lib/graph-lod.ts';

describe('pruneForRender', () => {
  it('is a no-op below the threshold', () => {
    const g = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }] };
    const r = pruneForRender(g, { maxNodes: 10 });
    expect(r.pruned).toBe(false); expect(r.shown).toBe(2); expect(r.total).toBe(2);
    expect(r.nodes).toBe(g.nodes);   // same array (no-op)
  });
  it('keeps the top-N by degree above the threshold, edges only among kept', () => {
    // star: hub h connected to l1..l4 → degrees: h=4, l*=1. maxNodes=3 → keep h + two leaves (id tie-break).
    const g = { nodes: ['h','l1','l2','l3','l4'].map((id) => ({ id })),
      edges: [{ source:'h',target:'l1' },{ source:'h',target:'l2' },{ source:'h',target:'l3' },{ source:'h',target:'l4' }] };
    const r = pruneForRender(g, { maxNodes: 3 });
    expect(r.pruned).toBe(true); expect(r.shown).toBe(3); expect(r.total).toBe(5);
    const ids = r.nodes.map((n) => n.id);
    expect(ids).toContain('h');
    expect(ids).toEqual(expect.arrayContaining(['h', 'l1', 'l2']));   // hub + two lowest-id leaves
    expect(r.edges.every((e) => ids.includes(e.source) && ids.includes(e.target))).toBe(true);
  });
  it('deterministic tie-break by id asc on equal degree', () => {
    const g = { nodes: ['c','a','b'].map((id) => ({ id })), edges: [] };
    const r = pruneForRender(g, { maxNodes: 2 });
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);   // a,b kept (id asc), c dropped
  });
  it('handles empty/undefined, no throw', () => {
    expect(pruneForRender(undefined).pruned).toBe(false);
    expect(pruneForRender({ nodes: [], edges: [] }).total).toBe(0);
  });
  it('exports a sane default threshold', () => { expect(LOD_MAX_NODES).toBeGreaterThan(0); });
});
```
- [ ] **Step 2: run, verify FAIL** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-lod`.
- [ ] **Step 3: implement** `graph-lod.ts` (graphology-free). 
- [ ] **Step 4: run, verify PASS.**
- [ ] **Step 5:** report (controller commits).

### Task 2: GraphCanvas wiring + banner
**Files:** modify `upstream/gitnexus-web/src/components/GraphCanvas.tsx`.
- Import `{ pruneForRender, LOD_MAX_NODES }` from `../lib/graph-lod`.
- In the render effect, after computing `renderRg` (the researchData or diff union), do `const lod = pruneForRender(renderRg, { maxNodes: LOD_MAX_NODES });` and feed `{ nodes: lod.nodes, edges: lod.edges }` (as ResearchGraph — generic prune preserves the type) to `researchGraphToGraphology`. Store `lod.pruned`/`lod.shown`/`lod.total` in state (or a ref read in render) for the banner. Add nothing to deps that isn't already there (renderRg's inputs already trigger the effect).
- Add a small banner element (near the existing diff/activation legends), shown only when `lod.pruned`: "LoD · showing {shown} of {total} nodes (top by degree)". Match neighboring control styling; `data-testid="lod-banner"`.
- Below threshold: `lod.pruned===false`, render the full `renderRg`, no banner — byte-identical to today.

- [ ] **Step 1: implement** the wiring + banner (type-clean by construction; pure lib is Task 1).
- [ ] **Step 2: self-review** — prune applied to the final render set; banner gated on `lod.pruned`; below threshold unchanged; works for both plain research render + diff union.
- [ ] **Step 3: controller runs the web image build (tsc)** — expect exit 0.
- [ ] **Step 4:** report.

## Post-build (controller)
1. `graph-lod` unit green; web image build (tsc) green.
2. Regen patches (gitnexus-web/src) + drift → exit 0.
3. Commit + push `deployment`; update ROADMAP/INVENTORY + spec Status + memory.
