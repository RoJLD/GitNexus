import { describe, it, expect } from 'vitest';
import {
  pickBarColor,
  computeGanttRows,
} from '../../upstream/gitnexus-web/src/lib/gantt-layout.ts';

/**
 * Update 1 — time-decaying bar color.
 *
 * `pickBarColor` reuses `computeGhostVisualState` from `./ghost-layout`,
 * but feeds it `plannedFor` as the "expectedBy" (the Gantt's notion of
 * "expected end"). The three branches we care about :
 *   - fresh / mature    -> tier color
 *   - late (1.0..1.5)   -> '#e67e22' orange
 *   - critical (> 1.5)  -> '#c0392b' red
 */

const plannedGhost = (overrides = {}) => ({
  id: 'g-decay',
  plannedAt: { date: '2026-01-01T00:00:00Z', commit: 'a' },
  materializedAt: null,
  cancelledAt: null,
  declared: {
    id: 'g-decay',
    tier: '2.3',
    title: 'g-decay',
    plannedFor: '2026-07-01', // ~6 months window
    status: 'planned',
    expectedLinks: [],
    dependsOn: [],
  },
  ...overrides,
});

describe('pickBarColor (Update 1 — time-decaying bar color)', () => {
  it('fresh : ratio < 0.5 -> tier color (tier 2 = amber)', () => {
    // 1 month elapsed of a 6-month window -> ratio ~0.17
    const color = pickBarColor(plannedGhost(), new Date('2026-02-01T00:00:00Z'));
    expect(color).toBe('#e1aa55');
  });

  it('mature : 0.5..1.0 -> tier color (still amber)', () => {
    // 4 months elapsed of 6-month window -> ratio ~0.67
    const color = pickBarColor(plannedGhost(), new Date('2026-05-01T00:00:00Z'));
    expect(color).toBe('#e1aa55');
  });

  it('late : 1.0..1.5 -> orange #e67e22', () => {
    // 7.5 months elapsed of 6-month window -> ratio ~1.25
    const color = pickBarColor(plannedGhost(), new Date('2026-08-15T00:00:00Z'));
    expect(color).toBe('#e67e22');
  });

  it('critical : > 1.5 -> red #c0392b', () => {
    // 12 months elapsed of 6-month window -> ratio ~2.0
    const color = pickBarColor(plannedGhost(), new Date('2027-01-01T00:00:00Z'));
    expect(color).toBe('#c0392b');
  });

  it('tier 1 fresh -> tier 1 blue #5b9bd5', () => {
    const g = plannedGhost({ declared: { ...plannedGhost().declared, tier: '1.2' } });
    const color = pickBarColor(g, new Date('2026-02-01T00:00:00Z'));
    expect(color).toBe('#5b9bd5');
  });

  it('no plannedFor / expectedBy -> fresh + tier color (fallback)', () => {
    const g = plannedGhost({ declared: { ...plannedGhost().declared, plannedFor: null } });
    const color = pickBarColor(g, new Date('2027-01-01T00:00:00Z'));
    expect(color).toBe('#e1aa55');
  });
});

describe('computeGanttRows wires pickBarColor into dashed bars', () => {
  const baseDashedGhost = (overrides = {}) => ({
    id: 'g-dash',
    plannedAt: { date: '2026-01-01T00:00:00Z', commit: 'a' },
    materializedAt: null,
    cancelledAt: null,
    declared: {
      id: 'g-dash',
      tier: '2.3',
      title: 'g-dash',
      plannedFor: '2026-07-01',
      status: 'planned',
      expectedLinks: [],
      dependsOn: [],
    },
    ...overrides,
  });

  it('fresh dashed bar -> tier color', () => {
    const rows = computeGanttRows([baseDashedGhost()], { now: new Date('2026-02-01T00:00:00Z') });
    expect(rows[0].bars[0].kind).toBe('dashed');
    expect(rows[0].bars[0].color).toBe('#e1aa55');
  });

  it('late dashed bar -> orange #e67e22', () => {
    const rows = computeGanttRows([baseDashedGhost()], { now: new Date('2026-08-15T00:00:00Z') });
    expect(rows[0].bars[0].kind).toBe('dashed');
    expect(rows[0].bars[0].color).toBe('#e67e22');
  });

  it('critical dashed bar -> red #c0392b', () => {
    const rows = computeGanttRows([baseDashedGhost()], { now: new Date('2027-01-01T00:00:00Z') });
    expect(rows[0].bars[0].kind).toBe('dashed');
    expect(rows[0].bars[0].color).toBe('#c0392b');
  });
});
