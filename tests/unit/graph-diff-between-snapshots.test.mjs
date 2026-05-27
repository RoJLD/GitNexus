import { describe, it, expect } from 'vitest';
import { diffBetweenSnapshots } from '../../upstream/gitnexus-web/src/lib/graph-diff';

const node = (id, label = id) => ({ id, label });
const edge = (sourceId, type, targetId) => ({ sourceId, type, targetId });

describe('diffBetweenSnapshots (Task 9 of timeline-zoom-cursors)', () => {
  it('returns nodeStatus + counts for added / removed / unchanged', () => {
    const snapshotA = {
      nodes: [node('n1'), node('n2'), node('n3')],
      relationships: [],
    };
    const snapshotB = {
      nodes: [node('n1'), node('n3'), node('n4')], // n1, n3 unchanged ; n4 added ; n2 removed
      relationships: [],
    };

    const result = diffBetweenSnapshots(snapshotA, snapshotB);

    expect(result.nodeStatus.get('n1')).toBe('inBoth');
    expect(result.nodeStatus.get('n2')).toBe('onlyInA'); // removed
    expect(result.nodeStatus.get('n3')).toBe('inBoth');
    expect(result.nodeStatus.get('n4')).toBe('onlyInB'); // added

    expect(result.counts.nodes).toEqual({ onlyInA: 1, onlyInB: 1, inBoth: 2 });
  });

  it('returns identical counts when both snapshots are equal (all inBoth)', () => {
    const snap = {
      nodes: [node('n1'), node('n2')],
      relationships: [edge('n1', 'CALLS', 'n2')],
    };
    const result = diffBetweenSnapshots(snap, snap);
    expect(result.counts.nodes).toEqual({ onlyInA: 0, onlyInB: 0, inBoth: 2 });
    expect(result.counts.edges).toEqual({ onlyInA: 0, onlyInB: 0, inBoth: 1 });
  });

  it('handles empty snapshots without crashing', () => {
    const result = diffBetweenSnapshots(
      { nodes: [], relationships: [] },
      { nodes: [], relationships: [] },
    );
    expect(result.counts.nodes).toEqual({ onlyInA: 0, onlyInB: 0, inBoth: 0 });
    expect(result.counts.edges).toEqual({ onlyInA: 0, onlyInB: 0, inBoth: 0 });
    expect(result.unionNodes).toEqual([]);
    expect(result.unionEdges).toEqual([]);
  });

  it('diffs edges by (source, type, target) triple — same nodes but different edges count as edge diff', () => {
    const snapshotA = {
      nodes: [node('n1'), node('n2')],
      relationships: [edge('n1', 'CALLS', 'n2')],
    };
    const snapshotB = {
      nodes: [node('n1'), node('n2')],
      relationships: [edge('n1', 'IMPORTS', 'n2')], // same nodes, different edge type
    };

    const result = diffBetweenSnapshots(snapshotA, snapshotB);
    expect(result.counts.nodes).toEqual({ onlyInA: 0, onlyInB: 0, inBoth: 2 });
    expect(result.counts.edges).toEqual({ onlyInA: 1, onlyInB: 1, inBoth: 0 });
  });

  it('is referentially identical to computeGraphDiff (alias relationship)', async () => {
    const { computeGraphDiff, diffBetweenSnapshots: alias } = await import(
      '../../upstream/gitnexus-web/src/lib/graph-diff'
    );
    expect(alias).toBe(computeGraphDiff);
  });
});
