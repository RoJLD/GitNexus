import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('Snapshot auto-sync produces ghosts.json per snapshot', () => {
  const api = getApi();

  it('after bulk-snapshot, every snapshot exposes ghosts.json via /ghosts/at', async () => {
    const list = await api.listSnapshots(FIXTURE.name);
    const snapshots = Array.isArray(list) ? list : list.snapshots;
    expect(snapshots.length).toBeGreaterThan(0);
    for (const snap of snapshots) {
      const sha = snap.commit.shortHash;
      const res = await fetch(`${BASE}/ghosts/at?repo=${FIXTURE.name}&commit=${sha}`);
      expect(res.status, `snapshot ${sha}`).not.toBe(404);
    }
  });

  it('the endpoint does not crash on a commit predating ROADMAP.md', async () => {
    const list = await api.listSnapshots(FIXTURE.name);
    const snapshots = Array.isArray(list) ? list : list.snapshots;
    // Oldest snapshot — sorted-by-date-desc per handleListSnapshots, so the
    // last element is the oldest commit. Pre-ROADMAP.md commits should yield
    // an empty ghosts list rather than a 500.
    const oldest = snapshots[snapshots.length - 1];
    const sha = oldest.commit.shortHash;
    const res = await fetch(`${BASE}/ghosts/at?repo=${FIXTURE.name}&commit=${sha}`);
    if (res.ok) {
      const body = await res.json();
      expect(Array.isArray(body.ghosts)).toBe(true);
    } else {
      expect([404]).toContain(res.status);
    }
  });
});
