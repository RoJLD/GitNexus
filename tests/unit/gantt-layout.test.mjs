import { describe, it, expect } from 'vitest';
import { computeTimeWindow } from '../../upstream/gitnexus-web/src/lib/gantt-layout.ts';

const ghost = (planned, mat, cancel, plannedFor) => ({
  plannedAt: planned ? { date: planned } : null,
  materializedAt: mat ? { date: mat } : null,
  cancelledAt: cancel ? { date: cancel } : null,
  declared: { plannedFor: plannedFor ?? null },
});

describe('computeTimeWindow', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('starts 7 days before the earliest plannedAt', () => {
    const w = computeTimeWindow([ghost('2026-04-15', null, null, null)], { now });
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-04-08');
  });

  it('end = max(latest known date, now + 90d)', () => {
    const w = computeTimeWindow([ghost('2026-04-01', '2026-04-30', null, null)], { now });
    // latest known = 2026-04-30, now+90d = 2026-08-30 -> end = 2026-08-30
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-08-30');
  });

  it('extends to plannedFor if it goes beyond now+90d', () => {
    const w = computeTimeWindow([ghost('2026-04-01', null, null, '2026-12-31')], { now });
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('falls back to now +/- 30d when no ghosts', () => {
    const w = computeTimeWindow([], { now });
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-05-02');
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-07-01');
  });
});
