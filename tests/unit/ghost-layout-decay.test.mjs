import { describe, it, expect } from 'vitest';
import {
  computeGhostVisualState,
  parseTargetDate,
} from '../../upstream/gitnexus-web/src/lib/ghost-layout.ts';

const baseGhost = (overrides = {}) => ({
  tier: '2.3',
  status: 'planned',
  plannedAt: { commit: 'abc', date: '2026-01-01T00:00:00Z' },
  declared: { expectedBy: '2026-07-01' }, // ~6 months window
  ...overrides,
});

describe('parseTargetDate', () => {
  it('parses ISO YYYY-MM-DD', () => {
    expect(parseTargetDate('2026-07-01')?.getUTCFullYear()).toBe(2026);
  });
  it('parses YYYY-Qx (returns end of quarter)', () => {
    const d = parseTargetDate('2026-Q2');
    expect(d).not.toBeNull();
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(5); // June (0-indexed)
  });
  it('parses YYYY-MM (returns end of month)', () => {
    const d = parseTargetDate('2026-07');
    expect(d).not.toBeNull();
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(6); // July (0-indexed)
  });
  it('returns null on garbage', () => {
    expect(parseTargetDate(null)).toBeNull();
    expect(parseTargetDate(undefined)).toBeNull();
    expect(parseTargetDate('')).toBeNull();
    expect(parseTargetDate('not-a-date')).toBeNull();
  });
});

describe('computeGhostVisualState', () => {
  it('fresh: < 50% of window elapsed', () => {
    // 1 month elapsed of a 6-month window => ratio ~0.17
    const out = computeGhostVisualState(baseGhost(), new Date('2026-02-01T00:00:00Z'));
    expect(out.alertLevel).toBe('fresh');
    expect(out.opacity).toBe(0.5);
    expect(out.outlineColor).toBe('#e1aa55'); // tier 2 amber
  });

  it('mature: between 50% and 100% of window', () => {
    // 4 months elapsed of 6-month window => ratio ~0.67
    const out = computeGhostVisualState(baseGhost(), new Date('2026-05-01T00:00:00Z'));
    expect(out.alertLevel).toBe('mature');
    expect(out.opacity).toBe(0.4);
    expect(out.outlineColor).toBe('#e1aa55');
  });

  it('late: between 100% and 150% (orange)', () => {
    // 7.5 months elapsed of 6-month window => ratio ~1.25
    const out = computeGhostVisualState(baseGhost(), new Date('2026-08-15T00:00:00Z'));
    expect(out.alertLevel).toBe('late');
    expect(out.opacity).toBe(0.3);
    expect(out.outlineColor).toBe('#e67e22');
  });

  it('critical: > 150% past expected (red)', () => {
    // 12 months elapsed of 6-month window => ratio ~2.0
    const out = computeGhostVisualState(baseGhost(), new Date('2027-01-01T00:00:00Z'));
    expect(out.alertLevel).toBe('critical');
    expect(out.opacity).toBe(0.2);
    expect(out.outlineColor).toBe('#c0392b');
  });

  it('cancelled: short-circuits to gray regardless of dates', () => {
    const out = computeGhostVisualState(
      baseGhost({ status: 'cancelled' }),
      new Date('2026-05-01T00:00:00Z'),
    );
    expect(out.alertLevel).toBe('cancelled');
    expect(out.opacity).toBe(0.3);
    expect(out.outlineColor).toBe('#6d6d6d');
  });

  it('fallback when expectedBy missing: fresh + tier color', () => {
    const out = computeGhostVisualState(
      baseGhost({ declared: { expectedBy: null } }),
      new Date('2026-05-01T00:00:00Z'),
    );
    expect(out.alertLevel).toBe('fresh');
    expect(out.opacity).toBe(0.4);
    expect(out.outlineColor).toBe('#e1aa55');
  });

  it('fallback when plannedAt missing: fresh + tier color', () => {
    const out = computeGhostVisualState(
      baseGhost({ plannedAt: null }),
      new Date('2026-05-01T00:00:00Z'),
    );
    expect(out.alertLevel).toBe('fresh');
    expect(out.opacity).toBe(0.4);
  });

  it('fallback gray when tier missing AND no dates', () => {
    const out = computeGhostVisualState(
      { status: 'planned', tier: null, plannedAt: null, declared: { expectedBy: null } },
      new Date('2026-05-01T00:00:00Z'),
    );
    expect(out.alertLevel).toBe('fresh');
    expect(out.outlineColor).toBe('#6d6d6d');
  });
});
