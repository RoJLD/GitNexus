import { describe, it, expect } from 'vitest';
import { diffGraphs } from '../../upstream/docker-server-graph-templates-core.mjs';

const V1 = {
  nodes: [{ id: 's0', type: 'state', label: 'Bull' }, { id: 's1', type: 'state', label: 'Bear' }, { id: 'obs', type: 'observation', label: 'Up' }],
  edges: [{ id: 's0->transition->s1', source: 's0', target: 's1', kind: 'transition' }, { id: 's0->emission->obs', source: 's0', target: 'obs', kind: 'emission' }],
};
const V2 = {
  nodes: [{ id: 's0', type: 'state', label: 'Bull' }, { id: 's1', type: 'state', label: 'Bear' }, { id: 's2', type: 'state', label: 'Flat' }, { id: 'obs', type: 'observation', label: 'Down' }],
  edges: [{ id: 's0->transition->s1', source: 's0', target: 's1', kind: 'transition' }, { id: 's1->transition->s2', source: 's1', target: 's2', kind: 'transition' }],
};

describe('diffGraphs', () => {
  it('reports added/removed/changed nodes', () => {
    const d = diffGraphs(V1, V2);
    expect(d.nodes.added).toEqual(['s2']);
    expect(d.nodes.removed).toEqual([]);
    expect(d.nodes.changed).toHaveLength(1);
    expect(d.nodes.changed[0]).toMatchObject({ id: 'obs', from: { label: 'Up' }, to: { label: 'Down' } });
    expect(d.nodes.commonCount).toBe(3);
  });
  it('reports added/removed edges by id', () => {
    const d = diffGraphs(V1, V2);
    expect(d.edges.added).toEqual(['s1->transition->s2']);
    expect(d.edges.removed).toEqual(['s0->emission->obs']);
    expect(d.edges.commonCount).toBe(1);
  });
  it('summary counts + drift', () => {
    const s = diffGraphs(V1, V2).summary;
    expect(s).toMatchObject({ addedNodes: 1, removedNodes: 0, changedNodes: 1, addedEdges: 1, removedEdges: 1, aNodeCount: 3, bNodeCount: 4 });
    expect(s.drift).toBe(4);
  });
  it('identical graphs → zero drift', () => {
    const d = diffGraphs(V1, V1);
    expect(d.summary.drift).toBe(0);
    expect(d.nodes.changed).toEqual([]);
    expect(d.edges.commonCount).toBe(2);
  });
  it('falls back to source/kind/target when edge id absent', () => {
    const a = { nodes: [{ id: 'x' }, { id: 'y' }], edges: [{ source: 'x', target: 'y', kind: 'k' }] };
    const b = { nodes: [{ id: 'x' }, { id: 'y' }], edges: [] };
    const d = diffGraphs(a, b);
    expect(d.edges.removed).toEqual(['x k y']);
  });
  it('handles empty graphs', () => {
    const d = diffGraphs({ nodes: [], edges: [] }, { nodes: [], edges: [] });
    expect(d.summary.drift).toBe(0);
  });
});
