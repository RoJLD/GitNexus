import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /ghost-audit caching', () => {
  it('first call after sync is fresh (cached:false), second is cached (cached:true)', async () => {
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const a = await (await fetch(`${BASE}/ghost-audit?repo=${FIXTURE.name}`)).json();
    const b = await (await fetch(`${BASE}/ghost-audit?repo=${FIXTURE.name}`)).json();
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
  });

  it('a new sync invalidates the cache', async () => {
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    await fetch(`${BASE}/ghost-audit?repo=${FIXTURE.name}`); // warm cache
    // Sleep enough for mtime tick (file system may have ~1s resolution).
    await new Promise((r) => setTimeout(r, 1100));
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const out = await (await fetch(`${BASE}/ghost-audit?repo=${FIXTURE.name}`)).json();
    expect(out.cached).toBe(false);
  });
});
