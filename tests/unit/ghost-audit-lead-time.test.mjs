import { describe, it, expect } from 'vitest';
import { computeLeadTime } from '../../upstream/docker-server-ghost-audit-core.mjs';

const ghost = (planned, mat) => ({
  plannedAt: { date: planned },
  materializedAt: mat ? { date: mat } : null,
});

describe('computeLeadTime', () => {
  it('computes median + percentiles from materialized ghosts', () => {
    // lead times: 1, 2, 3, 5, 10 days → median=3, p25=2, p75=5, max=10
    const ghosts = [
      ghost('2026-01-01', '2026-01-02'),
      ghost('2026-01-01', '2026-01-03'),
      ghost('2026-01-01', '2026-01-04'),
      ghost('2026-01-01', '2026-01-06'),
      ghost('2026-01-01', '2026-01-11'),
    ];
    const out = computeLeadTime(ghosts);
    expect(out.medianDays).toBeCloseTo(3, 1);
    expect(out.p25Days).toBeCloseTo(2, 1);
    expect(out.p75Days).toBeCloseTo(5, 1);
    expect(out.maxDays).toBeCloseTo(10, 1);
  });

  it('buckets into 4 ranges', () => {
    const ghosts = [
      ghost('2026-01-01', '2026-01-03'),   // 2 d  → 0-7d
      ghost('2026-01-01', '2026-01-10'),   // 9 d  → 7-14d
      ghost('2026-01-01', '2026-01-25'),   // 24 d → 14-30d
      ghost('2026-01-01', '2026-02-15'),   // 45 d → 30d+
    ];
    const dist = computeLeadTime(ghosts).distribution;
    expect(dist.find(b => b.bucket === '0-7d').count).toBe(1);
    expect(dist.find(b => b.bucket === '7-14d').count).toBe(1);
    expect(dist.find(b => b.bucket === '14-30d').count).toBe(1);
    expect(dist.find(b => b.bucket === '30d+').count).toBe(1);
  });

  it('returns empty distribution when no materialized ghosts', () => {
    const out = computeLeadTime([ghost('2026-01-01', null)]);
    expect(out.medianDays).toBeNull();
    expect(out.distribution).toEqual([]);
  });
});
