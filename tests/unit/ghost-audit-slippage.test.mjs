import { describe, it, expect } from 'vitest';
import { parseTargetDate, computeSlippage } from '../../upstream/docker-server-ghost-audit-core.mjs';

describe('parseTargetDate', () => {
  it('parses ISO datetimes', () => {
    expect(parseTargetDate('2026-09-30T12:00:00Z')).toBeInstanceOf(Date);
  });
  it('parses YYYY-QX as the last day of the quarter (UTC end of day)', () => {
    const d = parseTargetDate('2026-Q3');
    expect(d.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(parseTargetDate('2026-Q1').toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(parseTargetDate('2026-Q4').toISOString().slice(0, 10)).toBe('2026-12-31');
  });
  it('parses YYYY-MM as the last day of the month', () => {
    expect(parseTargetDate('2026-02').toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(parseTargetDate('2024-02').toISOString().slice(0, 10)).toBe('2024-02-29'); // leap
  });
  it('returns null on invalid input', () => {
    expect(parseTargetDate('not a date')).toBeNull();
    expect(parseTargetDate(null)).toBeNull();
    expect(parseTargetDate('')).toBeNull();
  });
});

describe('computeSlippage', () => {
  const ghost = (id, plannedFor, matDate) => ({
    id,
    declared: { plannedFor },
    materializedAt: matDate ? { date: matDate } : null,
  });

  it('classifies ghosts into 4 buckets', () => {
    const out = computeSlippage([
      ghost('a', '2026-06-30', '2026-06-15'), // early (15d before)
      ghost('b', '2026-06-30', '2026-06-30'), // on time
      ghost('c', '2026-06-30', '2026-07-15'), // late
      ghost('d', null,         '2026-06-30'), // no target
    ]);
    expect(out).toMatchObject({ early: 1, onTime: 1, late: 1, noTarget: 1 });
  });

  it('excludes noTarget from onTimePct', () => {
    const out = computeSlippage([
      ghost('a', '2026-06-30', '2026-06-15'),
      ghost('b', '2026-06-30', '2026-06-30'),
      ghost('c', null,         '2026-06-30'),
    ]);
    // early=1, onTime=1, late=0, total non-null = 2, onTimePct = 1/2
    expect(out.onTimePct).toBeCloseTo(0.5, 6);
  });

  it('returns 0/0 when no materialized ghosts', () => {
    const out = computeSlippage([{ id: 'x', materializedAt: null, declared: {} }]);
    expect(out).toMatchObject({ early: 0, onTime: 0, late: 0, noTarget: 0 });
    expect(out.onTimePct).toBeNull();
  });

  it('treats bucket-granularity targets as on-time anywhere within the bucket', () => {
    // plannedFor = "2026-Q3" → bucket ends 2026-09-30 ; matDate 2026-08-15 is well before
    // but still "in the bucket" if we relax bucket semantics. The spec says:
    // for Q/M granularity, anywhere within the bucket = onTime.
    const out = computeSlippage([
      ghost('a', '2026-Q3', '2026-08-15'), // within Q3 → onTime
      ghost('b', '2026-Q3', '2026-10-15'), // after Q3 end → late
      ghost('c', '2026-Q3', '2026-06-30'), // before Q3 start → early
    ]);
    expect(out).toMatchObject({ early: 1, onTime: 1, late: 1 });
  });
});
