import { describe, it, expect } from 'vitest';
import { nodeInspectorData } from '../../upstream/gitnexus-web/src/lib/node-inspector.ts';
const RG = { nodes: [{ id: 'a', type: 'Hypothesis', label: 'H-A', path: 'p/a', stage: '' }], edges: [] };
describe('nodeInspectorData', () => {
  it('returns node fields for a known id; metrics when present, null otherwise', () => {
    expect(nodeInspectorData(RG, undefined, 'a')).toMatchObject({ id: 'a', type: 'Hypothesis', label: 'H-A', path: 'p/a', metrics: null });
    const m = new Map([['a', { degree: 2, community: 0 }]]);
    expect(nodeInspectorData(RG, m, 'a').metrics).toEqual({ degree: 2, community: 0 });
  });
  it('returns null for unknown id / null selection / null graph', () => {
    expect(nodeInspectorData(RG, undefined, 'zzz')).toBeNull();
    expect(nodeInspectorData(RG, undefined, null)).toBeNull();
    expect(nodeInspectorData(null, undefined, 'a')).toBeNull();
  });
});
