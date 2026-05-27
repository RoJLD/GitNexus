import { describe, it, expect, beforeAll } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /clusters', () => {
  beforeAll(async () => {
    // Sync ghosts first so .gitnexus/clusters.json exists. The fixture itself
    // is already analyzed by the integration suite's global-setup.mjs.
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
  }, 60_000);

  it('returns 400 when repo missing', async () => {
    const res = await fetch(`${BASE}/clusters`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing repo/i);
  });

  it('returns 200 with a clusters array after sync', async () => {
    const res = await fetch(`${BASE}/clusters?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.clusters)).toBe(true);
    expect(body).toHaveProperty('syncedAt');
    expect(body).toHaveProperty('syncedCommit');
  });

  it('filters by source=declared', async () => {
    const res = await fetch(`${BASE}/clusters?repo=${FIXTURE.name}&source=declared`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.clusters)).toBe(true);
    expect(body.clusters.every(c => c.source === 'declared')).toBe(true);
  });

  it('returns 400 on invalid source', async () => {
    const res = await fetch(`${BASE}/clusters?repo=${FIXTURE.name}&source=xmi`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid source/i);
  });
});
