import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchGhosts,
  invalidateGhostsCache,
  _seedCacheForTests,
} from '../../upstream/gitnexus-web/src/services/ghosts-client.ts';

const RESP = (overrides = {}) => ({
  syncedAt: '2026-05-27T00:00:00Z',
  syncedCommit: 'deadbeef',
  ghosts: [],
  ...overrides,
});

describe('ghosts-client', () => {
  beforeEach(() => {
    invalidateGhostsCache();
    vi.restoreAllMocks();
  });

  it('returns null on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    const r = await fetchGhosts('hmm_studio');
    expect(r).toBeNull();
  });

  it('throws on non-2xx, non-404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    await expect(fetchGhosts('hmm_studio')).rejects.toThrow(/500/);
  });

  it('caches a successful response for 30s (same repo key)', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => RESP({ syncedCommit: 'commitA' }),
    });
    globalThis.fetch = spy;

    const first = await fetchGhosts('hmm_studio');
    const second = await fetchGhosts('hmm_studio');
    expect(first?.syncedCommit).toBe('commitA');
    expect(second?.syncedCommit).toBe('commitA');
    // Cache hit on the second call — fetch is invoked only once.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refresh:true bypasses the cache', async () => {
    let count = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => RESP({ syncedCommit: `commit-${++count}` }),
    }));
    const first = await fetchGhosts('hmm_studio');
    const second = await fetchGhosts('hmm_studio', { refresh: true });
    expect(first?.syncedCommit).toBe('commit-1');
    expect(second?.syncedCommit).toBe('commit-2');
  });

  it('treats different repos as separate cache keys', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      const repo = new URL(url, 'http://x').searchParams.get('repo');
      return {
        ok: true,
        status: 200,
        json: async () => RESP({ syncedCommit: `c-${repo}` }),
      };
    });
    const a = await fetchGhosts('foo');
    const b = await fetchGhosts('bar');
    expect(a?.syncedCommit).toBe('c-foo');
    expect(b?.syncedCommit).toBe('c-bar');
  });

  it('serves a stale-seeded entry within TTL and re-fetches after TTL', async () => {
    const seeded = RESP({ syncedCommit: 'seeded' });
    _seedCacheForTests('hmm_studio', seeded, Date.now());
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => RESP({ syncedCommit: 'fresh' }),
    });

    const first = await fetchGhosts('hmm_studio');
    expect(first?.syncedCommit).toBe('seeded');
    expect(globalThis.fetch).not.toHaveBeenCalled();

    // Re-seed with an old timestamp to force expiry.
    _seedCacheForTests('hmm_studio', seeded, Date.now() - 60_000);
    const second = await fetchGhosts('hmm_studio');
    expect(second?.syncedCommit).toBe('fresh');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('invalidateGhostsCache(repo) clears only that repo', async () => {
    _seedCacheForTests('foo', RESP({ syncedCommit: 'foo' }));
    _seedCacheForTests('bar', RESP({ syncedCommit: 'bar' }));
    invalidateGhostsCache('foo');

    let fetched = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetched += 1;
      return { ok: true, status: 200, json: async () => RESP({ syncedCommit: 'refetched' }) };
    });
    const foo = await fetchGhosts('foo');
    const bar = await fetchGhosts('bar');
    expect(foo?.syncedCommit).toBe('refetched');
    expect(bar?.syncedCommit).toBe('bar');
    expect(fetched).toBe(1);
  });

  it('invalidateGhostsCache() with no args clears all', async () => {
    _seedCacheForTests('foo', RESP({ syncedCommit: 'foo' }));
    _seedCacheForTests('bar', RESP({ syncedCommit: 'bar' }));
    invalidateGhostsCache();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => RESP({ syncedCommit: 'all-refetched' }),
    });
    const foo = await fetchGhosts('foo');
    const bar = await fetchGhosts('bar');
    expect(foo?.syncedCommit).toBe('all-refetched');
    expect(bar?.syncedCommit).toBe('all-refetched');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
