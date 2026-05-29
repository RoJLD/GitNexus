import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:4173';

// Routing + validation contract for the multi-repo group-graph endpoints.
// These do not require a real synced group (a live merged-graph render is
// covered manually + by e2e on the panel), so they stay fixture-light.
describe('Group graph endpoints', () => {
  it('GET /groups returns a groups array', async () => {
    const res = await fetch(`${BASE}/groups`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.groups)).toBe(true);
    for (const g of body.groups) {
      expect(typeof g.name).toBe('string');
      expect(Array.isArray(g.repos)).toBe(true);
      expect(typeof g.synced).toBe('boolean');
    }
  });

  it('GET /group/status requires name', async () => {
    const res = await fetch(`${BASE}/group/status`);
    expect(res.status).toBe(400);
  });

  it('POST /group/sync requires name and repos', async () => {
    const res = await fetch(`${BASE}/group/sync`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('GET /graph/merged requires group', async () => {
    const res = await fetch(`${BASE}/graph/merged`);
    expect(res.status).toBe(400);
  });

  it('GET /graph/merged 404s an unsynced group', async () => {
    const res = await fetch(`${BASE}/graph/merged?group=__definitely_not_a_group__`);
    expect(res.status).toBe(404);
  });
});
