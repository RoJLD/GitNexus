import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('POST /ghosts/sync', () => {
  it('returns the synced ghosts list', async () => {
    const res = await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.synced).toBe(true);
    expect(Array.isArray(body.ghosts)).toBe(true);
    // Fixture ROADMAP has 2 table rows + 3 Tier sections = 5 ghosts.
    expect(body.ghosts.length).toBe(5);
  });

  it('a second sync is idempotent (same ids, same order)', async () => {
    const url = `${BASE}/ghosts/sync?repo=${FIXTURE.name}`;
    const a = await (await fetch(url, { method: 'POST' })).json();
    const b = await (await fetch(url, { method: 'POST' })).json();
    expect(a.ghosts.map(g => g.id)).toEqual(b.ghosts.map(g => g.id));
  });
});
