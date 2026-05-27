import { describe, it, expect } from 'vitest';
import {
  computeTimeWindow,
  computeGanttRows,
} from '../../upstream/gitnexus-web/src/lib/gantt-layout.ts';

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

const fullGhost = (id, status, plannedFor) => ({
  id,
  declared: { id, tier: '2.3', title: id, plannedFor: plannedFor ?? null, status, expectedLinks: [], dependsOn: [] },
  plannedAt: { date: '2026-04-01', commit: 'a' },
  materializedAt: status === 'materialized' ? { date: '2026-04-15', commit: 'b', confirmedBy: 'manual' } : null,
  cancelledAt: status === 'cancelled' ? { date: '2026-04-30', commit: 'c' } : null,
  links: [],
});

describe('computeGanttRows', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('emits a solid bar for materialized ghosts', () => {
    const rows = computeGanttRows([fullGhost('g1', 'materialized')], { now });
    expect(rows).toHaveLength(1);
    expect(rows[0].bars[0]).toMatchObject({ kind: 'solid', startDate: '2026-04-01', endDate: '2026-04-15' });
  });

  it('emits a dashed bar for planned ghosts with parseable plannedFor', () => {
    const rows = computeGanttRows([fullGhost('g2', 'planned', '2026-09-30')], { now });
    expect(rows[0].bars[0].kind).toBe('dashed');
    expect(rows[0].bars[0].endDate?.slice(0, 10)).toBe('2026-09-30');
  });

  it('emits a dot for planned ghosts without plannedFor', () => {
    const rows = computeGanttRows([fullGhost('g3', 'planned', null)], { now });
    expect(rows[0].bars[0].kind).toBe('dot');
    expect(rows[0].bars[0].endDate).toBeNull();
  });

  it('emits a grey bar for cancelled ghosts', () => {
    const rows = computeGanttRows([fullGhost('g4', 'cancelled')], { now });
    expect(rows[0].bars[0]).toMatchObject({ kind: 'grey', startDate: '2026-04-01', endDate: '2026-04-30' });
  });

  it('sorts rows by plannedAt ASC by default', () => {
    const a = fullGhost('a', 'materialized');
    const b = fullGhost('b', 'materialized');
    a.plannedAt.date = '2026-04-10';
    b.plannedAt.date = '2026-04-01';
    const rows = computeGanttRows([a, b], { now });
    expect(rows.map(r => r.ghostId)).toEqual(['b', 'a']);
  });
});
