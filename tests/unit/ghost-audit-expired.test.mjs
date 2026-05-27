import { describe, it, expect } from 'vitest';
import { computeExpired } from '../../upstream/docker-server-ghost-audit-core.mjs';

const DAY = 86_400_000;

// Fixed "now" so the tests are deterministic.
const NOW = new Date('2026-05-26T00:00:00Z');

// Helper : produce an ISO date string for `daysAgo` days before NOW.
const daysAgoIso = (daysAgo) =>
  new Date(NOW.getTime() - daysAgo * DAY).toISOString().slice(0, 10);

describe('computeExpired', () => {
  it('ignores ghosts with no expectedBy', () => {
    const out = computeExpired(
      [{ id: 'g-noexp', declared: {} }],
      { now: NOW },
    );
    expect(out.total).toBe(0);
    expect(out.list).toEqual([]);
  });

  it('ignores materialized ghosts', () => {
    const out = computeExpired(
      [
        {
          id: 'g-done',
          declared: { expectedBy: daysAgoIso(60) },
          materializedAt: { date: daysAgoIso(10) },
        },
      ],
      { now: NOW },
    );
    expect(out.total).toBe(0);
  });

  it('ignores cancelled ghosts', () => {
    const out = computeExpired(
      [
        {
          id: 'g-cancelled',
          declared: { expectedBy: daysAgoIso(60) },
          cancelledAt: { date: daysAgoIso(10) },
        },
      ],
      { now: NOW },
    );
    expect(out.total).toBe(0);
  });

  it('does NOT flag a ghost expired by 5 days when grace is 30d', () => {
    const out = computeExpired(
      [{ id: 'g-grace', declared: { expectedBy: daysAgoIso(5) } }],
      { now: NOW },
    );
    expect(out.total).toBe(0);
    expect(out.list).toEqual([]);
  });

  it('flags a ghost expired by 45 days as expiredButRecent (no plannedAt)', () => {
    // expected 45d ago, grace 30d → 15 days past grace expiry.
    const out = computeExpired(
      [{ id: 'g-late', declared: { expectedBy: daysAgoIso(45) } }],
      { now: NOW },
    );
    expect(out.total).toBe(1);
    expect(out.expiredButRecent).toBe(1);
    expect(out.critical).toBe(0);
    expect(out.list[0]).toMatchObject({
      id: 'g-late',
      alertLevel: 'expiredButRecent',
      daysPastExpiry: 15,
    });
  });

  it('flags a ghost as critical when past expiry > 50% of original span', () => {
    // plannedAt 320d ago, expectedBy 200d ago → original span 120d.
    // now - expectedBy = 200d. 200 > 0.5 * 120 (=60) → critical.
    const out = computeExpired(
      [
        {
          id: 'g-critical',
          declared: { expectedBy: daysAgoIso(200) },
          plannedAt: { date: daysAgoIso(320) },
        },
      ],
      { now: NOW },
    );
    expect(out.total).toBe(1);
    expect(out.critical).toBe(1);
    expect(out.expiredButRecent).toBe(0);
    expect(out.list[0]).toMatchObject({
      id: 'g-critical',
      alertLevel: 'critical',
    });
  });

  it('sorts list by daysPastExpiry DESC', () => {
    const out = computeExpired(
      [
        { id: 'g-45',  declared: { expectedBy: daysAgoIso(45) } },
        { id: 'g-200', declared: { expectedBy: daysAgoIso(200) }, plannedAt: { date: daysAgoIso(320) } },
        { id: 'g-90',  declared: { expectedBy: daysAgoIso(90) } },
      ],
      { now: NOW },
    );
    expect(out.list.map(x => x.id)).toEqual(['g-200', 'g-90', 'g-45']);
    // strict DESC
    for (let i = 1; i < out.list.length; i++) {
      expect(out.list[i - 1].daysPastExpiry).toBeGreaterThanOrEqual(out.list[i].daysPastExpiry);
    }
  });
});
