import { describe, it, expect } from 'vitest';
import { computeVelocity } from '../../upstream/docker-server-ghost-audit-core.mjs';

const matGhost = (date) => ({ materializedAt: { date } });

describe('computeVelocity', () => {
  it('counts ghosts materialized within the window', () => {
    const now = new Date('2026-05-26T00:00:00Z');
    const out = computeVelocity([
      matGhost('2026-05-20'),  // 6 days ago → in 28d window
      matGhost('2026-05-01'),  // 25 days ago → in 28d window
      matGhost('2026-04-20'),  // 36 days ago → NOT in 28d window
      matGhost('2026-05-25'),  // 1 day ago → in 28d window
    ], { windowDays: 28, now });
    expect(out.currentCount).toBe(3);
    expect(out.windowDays).toBe(28);
  });

  it('builds weekly history (last 26 weeks)', () => {
    const now = new Date('2026-05-26T00:00:00Z');
    const out = computeVelocity([
      matGhost('2026-05-20'),
      matGhost('2026-05-21'),
      matGhost('2026-05-10'),
    ], { windowDays: 28, now });
    expect(out.history.length).toBeLessThanOrEqual(26);
    expect(out.history.every(h => 'weekStarting' in h && 'count' in h)).toBe(true);
    // Sorted ASC by date
    const dates = out.history.map(h => h.weekStarting);
    expect([...dates].sort()).toEqual(dates);
  });

  it('returns zeros when no materialized ghosts', () => {
    const out = computeVelocity([{ materializedAt: null }], { now: new Date('2026-05-26') });
    expect(out.currentCount).toBe(0);
    expect(out.history.length).toBeGreaterThanOrEqual(0);
  });
});
