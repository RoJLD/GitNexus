import { describe, it, expect } from 'vitest';
import { pruneForRender, LOD_MAX_NODES } from '../../upstream/gitnexus-web/src/lib/graph-lod.ts';

describe('pruneForRender', () => {
  it('is a no-op below the threshold', () => {
    const g = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }] };
    const r = pruneForRender(g, { maxNodes: 10 });
    expect(r.pruned).toBe(false); expect(r.shown).toBe(2); expect(r.total).toBe(2);
    expect(r.nodes).toBe(g.nodes);
  });
  it('keeps the top-N by degree above the threshold, edges only among kept', () => {
    const g = { nodes: ['h','l1','l2','l3','l4'].map((id) => ({ id })),
      edges: [{ source:'h',target:'l1' },{ source:'h',target:'l2' },{ source:'h',target:'l3' },{ source:'h',target:'l4' }] };
    const r = pruneForRender(g, { maxNodes: 3 });
    expect(r.pruned).toBe(true); expect(r.shown).toBe(3); expect(r.total).toBe(5);
    const ids = r.nodes.map((n) => n.id);
    expect(ids).toContain('h');
    expect(ids).toEqual(expect.arrayContaining(['h', 'l1', 'l2']));
    expect(r.edges.every((e) => ids.includes(e.source) && ids.includes(e.target))).toBe(true);
  });
  it('deterministic tie-break by id asc on equal degree', () => {
    const g = { nodes: ['c','a','b'].map((id) => ({ id })), edges: [] };
    const r = pruneForRender(g, { maxNodes: 2 });
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
  it('handles empty/undefined, no throw', () => {
    expect(pruneForRender(undefined).pruned).toBe(false);
    expect(pruneForRender({ nodes: [], edges: [] }).total).toBe(0);
  });
  it('exports a sane default threshold', () => { expect(LOD_MAX_NODES).toBeGreaterThan(0); });
});
