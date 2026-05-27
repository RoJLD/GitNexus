import { describe, it, expect } from 'vitest';
import { computeSummary } from '../../upstream/docker-server-ghost-audit-core.mjs';

const fixture = (overrides = []) => [
  { id: 'a', materializedAt: { date: '2026-01-01' }, cancelledAt: null },
  { id: 'b', materializedAt: { date: '2026-01-02' }, cancelledAt: null },
  { id: 'c', materializedAt: null, cancelledAt: null },
  { id: 'd', materializedAt: null, cancelledAt: { date: '2026-01-03' } },
  ...overrides,
];

describe('computeSummary', () => {
  it('counts ghosts by derived status', () => {
    const out = computeSummary(fixture());
    expect(out).toMatchObject({
      total: 4, materialized: 2, planned: 1, cancelled: 1, cancellationRate: 0.25,
    });
  });

  it('returns zeros for an empty array', () => {
    expect(computeSummary([])).toMatchObject({
      total: 0, materialized: 0, planned: 0, cancelled: 0, cancellationRate: 0,
    });
  });
});
