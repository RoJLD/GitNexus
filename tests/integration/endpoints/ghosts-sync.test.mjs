import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
import { fixtureDeclaredGhostIds } from '../helpers/fixture-ghosts.mjs';

const BASE = `http://localhost:${process.env.TEST_WEB_PORT || 4173}`;

describe('POST /ghosts/sync', () => {
  it('returns the synced ghosts list', async () => {
    const res = await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.synced).toBe(true);
    expect(Array.isArray(body.ghosts)).toBe(true);
    // The expected set is DERIVED from the fixture tarball via the server's own
    // roadmap parser (helpers/fixture-ghosts.mjs), so adding a Tier section to
    // tests/fixtures/make-fixture.mjs updates this assertion by construction.
    // The previous hardcoded `6` shipped with a comment claiming "2 table rows
    // + 3 Tier sections = 5 ghosts" — three numbers, none of them true.
    expect(body.ghosts.map(g => g.id)).toEqual(fixtureDeclaredGhostIds());
  });

  it('a second sync is idempotent (same ids, same order)', async () => {
    const url = `${BASE}/ghosts/sync?repo=${FIXTURE.name}`;
    const a = await (await fetch(url, { method: 'POST' })).json();
    const b = await (await fetch(url, { method: 'POST' })).json();
    expect(a.ghosts.map(g => g.id)).toEqual(b.ghosts.map(g => g.id));
  });
});
