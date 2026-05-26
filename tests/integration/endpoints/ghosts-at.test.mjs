import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /ghosts/at', () => {
  const api = getApi();

  it('returns 404 for a snapshot SHA that does not exist', async () => {
    const res = await fetch(`${BASE}/ghosts/at?repo=${FIXTURE.name}&commit=deadbeefdeadbeef`);
    expect(res.status).toBe(404);
  });

  it('returns 200 with ghosts for a real snapshot SHA', async () => {
    const list = await api.listSnapshots(FIXTURE.name);
    const snapshots = Array.isArray(list) ? list : list.snapshots;
    expect(snapshots.length).toBeGreaterThan(0);
    // listSnapshots emits objects shaped { key, name, path, commit: { hash, shortHash, ... } }.
    // The /ghosts/at handler keys the snapshot dir by safeSnapshotKey(shortHash).
    const sha = snapshots[0].commit.shortHash;
    const res = await fetch(`${BASE}/ghosts/at?repo=${FIXTURE.name}&commit=${sha}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.ghosts)).toBe(true);
  });
});
