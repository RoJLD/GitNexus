import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = 'http://localhost:4173';
const reg = async (metric) => {
  const res = await fetch(`${BASE}/regression?repo=${encodeURIComponent(FIXTURE.name)}&metric=${encodeURIComponent(metric)}`);
  return { status: res.status, body: res.ok ? await res.json() : await res.json().catch(() => ({})) };
};

describe('GET /regression — Phase 2 metrics', () => {
  for (const metric of ['ownership.busFactor', 'ownership.topAuthorShare', 'dissonance.purity', 'coupling']) {
    it(`${metric} returns a suspects-mode verdict`, async () => {
      const { status, body } = await reg(metric);
      expect(status).toBe(200);
      expect(body.metric).toBe(metric);
      expect(typeof body.regressed).toBe('boolean');
      expect(body.attribution).toBe('suspects');
      expect('worstCommit' in body).toBe(true);
      expect(Array.isArray(body.runnersUp)).toBe(true);
    });
  }

  it('entropy still uses attributed mode (Phase 1 regression check)', async () => {
    const { status, body } = await reg('density');
    expect(status).toBe(200);
    expect(body.attribution).toBe('attributed');
  });
});

describe('endpoint params', () => {
  it('/ownership?until= returns a busFactor', async () => {
    const res = await fetch(`${BASE}/ownership?repo=${encodeURIComponent(FIXTURE.name)}&until=${encodeURIComponent(new Date().toISOString())}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.repoBusFactor).toBe('number');
  });
  it('/coupling?asOf= returns pairsAboveThreshold', async () => {
    const res = await fetch(`${BASE}/coupling?repo=${encodeURIComponent(FIXTURE.name)}&asOf=${encodeURIComponent(new Date().toISOString())}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.pairsAboveThreshold).toBe('number');
  });
});
