import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
import { getApi } from '../helpers/api-client.mjs';

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /nodes/alive-between', () => {
  const fetchAB = async (repo, from, to) => {
    const params = new URLSearchParams({ repo, from, to });
    const res = await fetch(`${BASE}/nodes/alive-between?${params}`);
    return { status: res.status, body: res.ok ? await res.json() : await res.text() };
  };

  it('returns 200 with nodeIds + snapshotCount + window metadata for a valid range', async () => {
    const api = getApi();
    const snapshotsResp = await api.listSnapshots(FIXTURE.name);
    const snapshots = snapshotsResp.snapshots || [];
    expect(snapshots.length).toBeGreaterThan(1);

    // Sort ascending by commit date (same order as the handler)
    const sorted = snapshots
      .slice()
      .sort((a, b) => (a.commit?.date || '').localeCompare(b.commit?.date || ''));
    const from = sorted[0].commit.shortHash;
    const to = sorted[sorted.length - 1].commit.shortHash;

    const { status, body } = await fetchAB(FIXTURE.name, from, to);
    expect(status).toBe(200);
    expect(Array.isArray(body.nodeIds)).toBe(true);
    expect(body.nodeIds.length).toBeGreaterThan(0);
    expect(body.snapshotCount).toBe(sorted.length);
    expect(body.fromSnapshot).toBe(from);
    expect(body.toSnapshot).toBe(to);
    expect(typeof body.computedAt).toBe('string');
  });

  it('returns 400 on missing params', async () => {
    const res = await fetch(`${BASE}/nodes/alive-between?repo=foo`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing required params/i);
  });

  it('returns 404 on unknown repo', async () => {
    const { status } = await fetchAB('nonexistent-repo-xyz', 'aaa', 'bbb');
    expect(status).toBe(404);
  });

  it('caches the result (second call sets cached: true)', async () => {
    const api = getApi();
    const snapshotsResp = await api.listSnapshots(FIXTURE.name);
    const snapshots = snapshotsResp.snapshots || [];
    const sorted = snapshots
      .slice()
      .sort((a, b) => (a.commit?.date || '').localeCompare(b.commit?.date || ''));
    const from = sorted[0].commit.shortHash;
    const to = sorted[sorted.length - 1].commit.shortHash;

    // Prime cache
    await fetchAB(FIXTURE.name, from, to);
    // Second call should be cached
    const { body } = await fetchAB(FIXTURE.name, from, to);
    expect(body.cached).toBe(true);
  });
});
