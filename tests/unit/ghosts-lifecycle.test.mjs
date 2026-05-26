import { describe, it, expect } from 'vitest';
import { computeStatus, parseTargetDate } from '../../upstream/docker-server-ghosts-core.mjs';

describe('computeStatus', () => {
  it('returns the declared status when no override', () => {
    expect(computeStatus({ status: 'planned', expectedLinks: [] }, {})).toBe('planned');
    expect(computeStatus({ status: 'materialized', expectedLinks: [] }, {})).toBe('materialized');
    expect(computeStatus({ status: 'cancelled', expectedLinks: [] }, {})).toBe('cancelled');
  });

  it('upgrades planned → materialized when all expectedLinks (paths) match', () => {
    const ghost = {
      status: 'planned',
      expectedLinks: [
        { kind: 'path', value: 'a.mjs' },
        { kind: 'path', value: 'b.tsx' },
      ],
    };
    const ctx = { changedFiles: ['x/a.mjs', 'y/b.tsx'] };
    expect(computeStatus(ghost, ctx)).toBe('materialized');
  });

  it('keeps planned when some but not all expectedLinks match', () => {
    const ghost = {
      status: 'planned',
      expectedLinks: [
        { kind: 'path', value: 'a.mjs' },
        { kind: 'path', value: 'b.tsx' },
      ],
    };
    const ctx = { changedFiles: ['x/a.mjs'] };
    expect(computeStatus(ghost, ctx)).toBe('planned');
  });

  it('ignores `label` expectedLinks when computing match completion', () => {
    const ghost = {
      status: 'planned',
      expectedLinks: [
        { kind: 'path', value: 'a.mjs' },
        { kind: 'label', value: 'A toggle' },
      ],
    };
    const ctx = { changedFiles: ['a.mjs'] };
    expect(computeStatus(ghost, ctx)).toBe('materialized');
  });

  it('declared cancelled stays cancelled even if links match', () => {
    const ghost = {
      status: 'cancelled',
      expectedLinks: [{ kind: 'path', value: 'a.mjs' }],
    };
    const ctx = { changedFiles: ['a.mjs'] };
    expect(computeStatus(ghost, ctx)).toBe('cancelled');
  });

  it('handles ghost with no expectedLinks', () => {
    expect(computeStatus({ status: 'planned', expectedLinks: [] }, { changedFiles: ['x.mjs'] })).toBe('planned');
  });

  // --- Update 1c : expired status (derived from expectedBy + grace_period) ---
  it('returns expired for planned ghost whose expectedBy + grace passed', () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const ghost = {
      status: 'planned',
      expectedLinks: [{ kind: 'path', value: 'foo.mjs' }],
      expectedBy: '2026-Q1', // ends 2026-03-31 ; with default 30j grace, expired since 2026-04-30
    };
    expect(computeStatus(ghost, { changedFiles: [], now })).toBe('expired');
  });

  it('stays planned if expectedBy + grace hasnt passed yet', () => {
    const now = new Date('2026-04-15T00:00:00Z');
    const ghost = {
      status: 'planned',
      expectedLinks: [{ kind: 'path', value: 'foo.mjs' }],
      expectedBy: '2026-Q1', // ends 2026-03-31, + 30j grace = 2026-04-30
    };
    expect(computeStatus(ghost, { changedFiles: [], now })).toBe('planned');
  });

  it('materialized wins over expired (materialization is terminal)', () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const ghost = {
      status: 'materialized', // already materialized
      expectedBy: '2026-Q1',
      expectedLinks: [],
    };
    expect(computeStatus(ghost, { changedFiles: [], now })).toBe('materialized');
  });

  it('honors custom gracePeriodDays', () => {
    const now = new Date('2026-04-15T00:00:00Z');
    const ghost = { status: 'planned', expectedBy: '2026-Q1', expectedLinks: [] };
    // With 5j grace, expectedBy + 5j = 2026-04-05 < now → expired
    expect(computeStatus(ghost, { changedFiles: [], now, gracePeriodDays: 5 })).toBe('expired');
  });
});

describe('parseTargetDate', () => {
  it('parses YYYY-QX into the last day of the quarter (UTC)', () => {
    expect(parseTargetDate('2026-Q1').toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(parseTargetDate('2026-Q3').toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(parseTargetDate('2026-Q4').toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('parses YYYY-MM into the last day of the month', () => {
    expect(parseTargetDate('2026-02').toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(parseTargetDate('2024-02').toISOString().slice(0, 10)).toBe('2024-02-29');
  });

  it('parses ISO datetimes', () => {
    expect(parseTargetDate('2026-09-30T00:00:00Z')).toBeInstanceOf(Date);
  });

  it('returns null on invalid input', () => {
    expect(parseTargetDate('garbage')).toBeNull();
    expect(parseTargetDate(null)).toBeNull();
    expect(parseTargetDate(undefined)).toBeNull();
    expect(parseTargetDate('')).toBeNull();
  });
});
