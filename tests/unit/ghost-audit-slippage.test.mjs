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
