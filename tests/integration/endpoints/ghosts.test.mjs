import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
import { fixtureDeclaredGhostIds } from '../helpers/fixture-ghosts.mjs';

const BASE = `http://localhost:${process.env.TEST_WEB_PORT || 4173}`;

describe('GET /ghosts', () => {
  it('returns 400/404 for a repo that has never been synced', async () => {
    const res = await fetch(`${BASE}/ghosts?repo=__never-synced__`);
    expect([400, 404]).toContain(res.status);
  });

  it('serves back exactly the ghosts the fixture ROADMAP declares', async () => {
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const res = await fetch(`${BASE}/ghosts?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.ghosts)).toBe(true);
    // DERIVED from tests/fixtures/sample-repo.tar.gz through the server's own
    // parser — never a copied count. See helpers/fixture-ghosts.mjs for why
    // (a hardcoded `6` here is what PR #9's fixture change turned red).
    expect(body.ghosts.map(g => g.id)).toEqual(fixtureDeclaredGhostIds());
    expect(body.ghosts[0]).toMatchObject({
      id: expect.any(String),
      declared: expect.any(Object),
      plannedAt: expect.any(Object),
    });
  });
});
