import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /ghosts', () => {
  it('returns 400/404 for a repo that has never been synced', async () => {
    const res = await fetch(`${BASE}/ghosts?repo=__never-synced__`);
    expect([400, 404]).toContain(res.status);
  });

  it('returns 200 with ghosts after sync', async () => {
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const res = await fetch(`${BASE}/ghosts?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.ghosts)).toBe(true);
    expect(body.ghosts.length).toBe(5);
    expect(body.ghosts[0]).toMatchObject({
      id: expect.any(String),
      declared: expect.any(Object),
      plannedAt: expect.any(Object),
    });
  });
});
