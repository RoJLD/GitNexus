import { describe, it, expect } from 'vitest';
import {
  filterSnapshotsInWindow,
  unionSnapshotNodeIds,
} from '../../upstream/docker-server-nodes-alive-between.mjs';

const snap = (shortHash, dateISO) => ({
  shortHash,
  commit: { date: dateISO, shortHash },
  name: `repo@${shortHash}`,
});

describe('filterSnapshotsInWindow', () => {
  const snapshots = [
    snap('a1', '2026-01-01T00:00:00Z'),
    snap('a2', '2026-01-10T00:00:00Z'),
    snap('a3', '2026-01-20T00:00:00Z'),
    snap('a4', '2026-01-30T00:00:00Z'),
  ];

  it('returns snapshots within [from, to] inclusive', () => {
    const result = filterSnapshotsInWindow(snapshots, 'a2', 'a3');
    expect(result.map((s) => s.shortHash)).toEqual(['a2', 'a3']);
  });

  it('returns all when from=oldest to=newest', () => {
    const result = filterSnapshotsInWindow(snapshots, 'a1', 'a4');
    expect(result.length).toBe(4);
  });

  it('returns empty when from > to', () => {
    expect(filterSnapshotsInWindow(snapshots, 'a3', 'a2')).toEqual([]);
  });

  it('returns single snapshot when from === to', () => {
    const result = filterSnapshotsInWindow(snapshots, 'a2', 'a2');
    expect(result.map((s) => s.shortHash)).toEqual(['a2']);
  });

  it('returns empty when unknown shortHash', () => {
    expect(filterSnapshotsInWindow(snapshots, 'unknown', 'a3')).toEqual([]);
  });
});

describe('unionSnapshotNodeIds', () => {
  it('unions node IDs from all snapshot graphs', () => {
    const graphs = [
      { nodes: [{ id: 'n1' }, { id: 'n2' }] },
      { nodes: [{ id: 'n2' }, { id: 'n3' }] },
      { nodes: [{ id: 'n3' }, { id: 'n4' }] },
    ];
    const result = unionSnapshotNodeIds(graphs);
    expect([...result].sort()).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('returns empty when no graphs', () => {
    expect(unionSnapshotNodeIds([]).size).toBe(0);
  });

  it('dedupes correctly', () => {
    const g = { nodes: [{ id: 'n1' }, { id: 'n1' }] };
    expect(unionSnapshotNodeIds([g, g]).size).toBe(1);
  });
});
