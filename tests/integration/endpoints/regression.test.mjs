import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = 'http://localhost:4173';

const fetchReg = async (params) => {
  const res = await fetch(`${BASE}/regression?${params}`);
  return { status: res.status, body: res.ok ? await res.json() : await res.json().catch(() => ({})) };
};

describe('GET /regression', () => {
  it('returns a density regression verdict', async () => {
    const { status, body } = await fetchReg(`repo=${encodeURIComponent(FIXTURE.name)}&metric=density`);
    expect(status).toBe(200);
    expect(body.metric).toBe('density');
    expect(typeof body.regressed).toBe('boolean');
    expect('worstCommit' in body).toBe(true); // object or null
    expect(Array.isArray(body.runnersUp)).toBe(true);
  });

  it('supports modularity', async () => {
    const { status, body } = await fetchReg(`repo=${encodeURIComponent(FIXTURE.name)}&metric=modularity`);
    expect(status).toBe(200);
    expect(body.metric).toBe('modularity');
    expect(typeof body.regressed).toBe('boolean');
  });

  it('rejects an unknown metric with 400', async () => {
    const { status, body } = await fetchReg(`repo=${encodeURIComponent(FIXTURE.name)}&metric=garbage`);
    expect(status).toBe(400);
    expect(typeof body.error).toBe('string');
  });

  it('rejects a missing repo with 400', async () => {
    const { status } = await fetchReg(`metric=density`);
    expect(status).toBe(400);
  });
});
