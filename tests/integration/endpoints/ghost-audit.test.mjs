import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /ghost-audit', () => {
  it('returns 400/404 for a repo that has never been synced', async () => {
    const res = await fetch(`${BASE}/ghost-audit?repo=__never-synced__`);
    expect([400, 404]).toContain(res.status);
  });

  it('returns the full audit shape after sync', async () => {
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const res = await fetch(`${BASE}/ghost-audit?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const audit = await res.json();
    expect(audit).toMatchObject({
      computedAt: expect.any(String),
      cached: expect.any(Boolean),
      summary: expect.any(Object),
      leadTime: expect.any(Object),
      slippage: expect.any(Object),
      planChurn: expect.any(Object),
      velocity: expect.any(Object),
      // Update 1 — computeExpired metric (6th block).
      expired: expect.any(Object),
    });
    // The expired block exposes at minimum a `total` counter.
    expect(audit.expired).toMatchObject({
      total: expect.any(Number),
    });
  });
});
