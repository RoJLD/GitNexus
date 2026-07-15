import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getSnapshotNodeIds,
  fetchNodeIds,
  __clearCache,
} from '../../upstream/docker-server-snapshot-nodeids.mjs';

// A fetch stub that records which repos were queried and returns canned ids.
function makeFetch(idsByRepo) {
  const calls = [];
  const impl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.repo);
    const ids = idsByRepo[body.repo] || [];
    return { ok: true, json: async () => ({ result: ids.map((id) => ({ id })) }) };
  };
  return { impl, calls };
}

const cachePath = (dir) => join(dir, '.gitnexus', 'snapshot-nodeids-cache.json');

describe('getSnapshotNodeIds — shared per-snapshot cache', () => {
  beforeEach(() => __clearCache());

  it('fetches on miss, serves from memory on repeat (no 2nd fetch)', async () => {
    const { impl, calls } = makeFetch({ 'Repo@abc': ['A', 'B'] });
    const a = await getSnapshotNodeIds('Repo@abc', { api: 'http://x', isLive: false, fetchImpl: impl });
    const b = await getSnapshotNodeIds('Repo@abc', { api: 'http://x', isLive: false, fetchImpl: impl });
    expect(a).toEqual(['A', 'B']);
    expect(b).toEqual(['A', 'B']);
    expect(calls).toEqual(['Repo@abc']); // fetched exactly once
  });

  it('persists a snapshot point to disk and survives a cache clear (restart) without refetch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'snapcache-'));
    const { impl, calls } = makeFetch({ 'Repo@abc': ['A', 'B'] });
    await getSnapshotNodeIds('Repo@abc', { api: 'http://x', isLive: false, cacheDir: dir, fetchImpl: impl });
    expect(existsSync(cachePath(dir))).toBe(true);
    __clearCache(); // simulate a container rebuild/restart (memory gone)
    const again = await getSnapshotNodeIds('Repo@abc', { api: 'http://x', isLive: false, cacheDir: dir, fetchImpl: impl });
    expect(again).toEqual(['A', 'B']);
    expect(calls).toEqual(['Repo@abc']); // still one fetch — served from disk
  });

  it('does NOT persist the live point and refetches it after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'snapcache-'));
    const { impl, calls } = makeFetch({ Repo: ['L1'] });
    await getSnapshotNodeIds('Repo', { api: 'http://x', isLive: true, liveKey: 't1', cacheDir: dir, fetchImpl: impl });
    const disk = existsSync(cachePath(dir)) ? JSON.parse(readFileSync(cachePath(dir), 'utf8')) : {};
    expect(disk.Repo).toBeUndefined(); // live never written to disk
    __clearCache();
    await getSnapshotNodeIds('Repo', { api: 'http://x', isLive: true, liveKey: 't1', cacheDir: dir, fetchImpl: impl });
    expect(calls).toEqual(['Repo', 'Repo']); // refetched after clear
  });

  it('invalidates the live point when liveKey changes (reindex)', async () => {
    const { impl, calls } = makeFetch({ Repo: ['L1'] });
    await getSnapshotNodeIds('Repo', { api: 'http://x', isLive: true, liveKey: 't1', fetchImpl: impl });
    await getSnapshotNodeIds('Repo', { api: 'http://x', isLive: true, liveKey: 't1', fetchImpl: impl }); // memory hit
    await getSnapshotNodeIds('Repo', { api: 'http://x', isLive: true, liveKey: 't2', fetchImpl: impl }); // reindex → miss
    expect(calls).toEqual(['Repo', 'Repo']); // t1 fetched once, t2 fetched once
  });

  it('fetchNodeIds tolerates row-shape variants (result/rows, id/n.id)', async () => {
    const impl = async () => ({ ok: true, json: async () => ({ rows: [{ 'n.id': 'X' }, { id: 'Y' }, { nope: 1 }] }) });
    const ids = await fetchNodeIds('R', 'http://x', { fetchImpl: impl });
    expect(ids).toEqual(['X', 'Y']);
  });

  it('throws on a non-ok Cypher response (surfaced, not swallowed)', async () => {
    const impl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchNodeIds('R', 'http://x', { fetchImpl: impl })).rejects.toThrow(/cypher failed.*500/);
  });
});
