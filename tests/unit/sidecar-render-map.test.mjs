import { describe, it, expect } from 'vitest';
import { mapRenderRows } from '../../graphs-sidecar/render-map.mjs';

describe('mapRenderRows', () => {
  it('passes through extra node props + edge weight, computing id/type/label/source/target/kind', () => {
    const nrows = [{ n: { id: 's0', type: 'state', label: 'Bull', layer: 'L1' }, lbl: 'ModelNode' }];
    const erows = [{ source: 's0', target: 's1', r: { id: 's0->transition->s1', kind: 'transition', weight: 0.7 }, lbl: 'ModelEdge' }];
    const { nodes, edges } = mapRenderRows(nrows, erows);
    expect(nodes[0]).toMatchObject({ id: 's0', type: 'state', label: 'Bull', layer: 'L1', path: '', stage: '' });
    expect(edges[0]).toMatchObject({ source: 's0', target: 's1', kind: 'transition', id: 's0->transition->s1', weight: 0.7 });
  });
  it('computes type/label fallbacks and edge kind/id fallbacks', () => {
    const nrows = [{ n: { id: 'x', title: 'Titled' }, lbl: 'Entity' }, { n: { id: 'y' }, lbl: 'Entity' }];
    const erows = [{ source: 'x', target: 'y', r: {}, lbl: 'Relates' }];
    const { nodes, edges } = mapRenderRows(nrows, erows);
    expect(nodes[0]).toMatchObject({ id: 'x', type: 'Entity', label: 'Titled' });
    expect(nodes[1].label).toBe('y');
    expect(edges[0]).toMatchObject({ source: 'x', target: 'y', kind: 'Relates', id: 'x->y' });
  });
  it('a row with no extra props yields exactly the legacy fields', () => {
    const { nodes } = mapRenderRows([{ n: { id: 'a', type: 't', label: 'L', path: 'p', stage: 's' }, lbl: 'X' }], []);
    expect(nodes[0]).toEqual({ id: 'a', type: 't', label: 'L', path: 'p', stage: 's' });
  });
});
