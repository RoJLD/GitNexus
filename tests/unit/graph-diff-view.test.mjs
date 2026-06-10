import { describe, it, expect } from 'vitest';
import { buildDiffStatus, unionResearchGraphs, DIFF_VIEW_COLORS } from '../../upstream/gitnexus-web/src/lib/graph-diff-view.ts';

describe('buildDiffStatus', () => {
  it('maps added/removed/changed to status with added/removed precedence over changed', () => {
    const m = buildDiffStatus({ nodes: { added: ['s2'], removed: ['s9'], changed: [{ id: 'obs' }, { id: 's2' }], commonCount: 1 }, edges: { added: [], removed: [], commonCount: 0 }, summary: {} });
    expect(m.get('s2')).toBe('added');
    expect(m.get('s9')).toBe('removed');
    expect(m.get('obs')).toBe('changed');
    expect(m.has('s0')).toBe(false);
  });
});

describe('unionResearchGraphs', () => {
  it('dedups nodes by id (A wins) and edges by source|kind|target, appending B-only', () => {
    const a = { nodes: [{ id: 'x', label: 'A-x' }, { id: 'y' }], edges: [{ source: 'x', target: 'y', kind: 'k' }] };
    const b = { nodes: [{ id: 'x', label: 'B-x' }, { id: 'z' }], edges: [{ source: 'x', target: 'y', kind: 'k' }, { source: 'y', target: 'z', kind: 'k' }] };
    const u = unionResearchGraphs(a, b);
    expect(u.nodes.map((n) => n.id).sort()).toEqual(['x', 'y', 'z']);
    expect(u.nodes.find((n) => n.id === 'x').label).toBe('A-x');
    expect(u.edges).toHaveLength(2);
  });
  it('handles empty / missing inputs', () => {
    expect(unionResearchGraphs({ nodes: [], edges: [] }, undefined).nodes).toEqual([]);
  });
});

describe('DIFF_VIEW_COLORS', () => {
  it('has the four statuses', () => {
    expect(DIFF_VIEW_COLORS).toMatchObject({ added: '#10b981', removed: '#ef4444', changed: '#f59e0b', common: '#4b5563' });
  });
});
