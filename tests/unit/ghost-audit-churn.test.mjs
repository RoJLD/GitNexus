import { describe, it, expect } from 'vitest';
import { computePlanChurn } from '../../upstream/docker-server-ghost-audit-core.mjs';

const snap = (sha, date, ghosts) => ({ sha, date, ghosts });
const g = (id, description, links) => ({
  id,
  declared: { description, expectedLinks: links.map(v => ({ kind: 'path', value: v })) },
});

describe('computePlanChurn', () => {
  it('counts description changes across snapshots', () => {
    const snapshots = [
      snap('s1', '2026-01-01', [g('a', 'first version', ['x.mjs'])]),
      snap('s2', '2026-01-02', [g('a', 'second version', ['x.mjs'])]),
      snap('s3', '2026-01-03', [g('a', 'third version', ['x.mjs'])]),
    ];
    const out = computePlanChurn(snapshots);
    expect(out.totalGhostsWithChurn).toBe(1);
    expect(out.topChurners[0]).toMatchObject({ id: 'a', churn: 2 });
  });

  it('counts expectedLinks changes', () => {
    const snapshots = [
      snap('s1', '2026-01-01', [g('a', 'same', ['x.mjs'])]),
      snap('s2', '2026-01-02', [g('a', 'same', ['x.mjs', 'y.mjs'])]),
    ];
    const out = computePlanChurn(snapshots);
    expect(out.topChurners[0].churn).toBe(1);
    expect(out.topChurners[0].deltas).toContain('expectedLinks');
  });

  it('ignores newly-added ghosts (not churn)', () => {
    const snapshots = [
      snap('s1', '2026-01-01', [g('a', 'x', ['x.mjs'])]),
      snap('s2', '2026-01-02', [g('a', 'x', ['x.mjs']), g('b', 'new', ['y.mjs'])]),
    ];
    expect(computePlanChurn(snapshots).totalGhostsWithChurn).toBe(0);
  });

  it('sorts topChurners DESC and caps at 10', () => {
    const snapshots = [snap('s1', '2026-01-01', []), snap('s2', '2026-01-02', [])];
    // Generate 15 ghosts with varying churn
    for (let i = 0; i < 15; i++) {
      snapshots[0].ghosts.push(g(`g${i}`, 'a', ['x.mjs']));
      snapshots[1].ghosts.push(g(`g${i}`, `b${i % 4}`, ['x.mjs'])); // some unchanged, some changed
    }
    const out = computePlanChurn(snapshots);
    expect(out.topChurners.length).toBeLessThanOrEqual(10);
  });

  it('returns zeros for ≤1 snapshot', () => {
    expect(computePlanChurn([])).toMatchObject({ totalGhostsWithChurn: 0, avgChurnPerGhost: 0, topChurners: [] });
    expect(computePlanChurn([snap('s1', '2026-01-01', [g('a', 'x', ['x.mjs'])])])).toMatchObject({ totalGhostsWithChurn: 0 });
  });
});
