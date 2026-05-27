/**
 * Tier 3.x Augmented Timeline — `snapshot-ghosts-cache` service.
 *
 * Covers : empty `/snapshots`, multi-snapshot fan-out, TTL cache hit,
 * CAP slicing, abort propagation.
 *
 * See docs/superpowers/specs/2026-05-27-roadmap-predictive-augmented-timeline-design.md
 *   §3.2.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  prefetchSnapshotGhosts,
  clearSnapshotGhostsCache,
} from '../../upstream/gitnexus-web/src/services/snapshot-ghosts-cache';

function makeFetchMock(snapshots, perCommit = {}) {
  return vi.fn(async (url, init) => {
    if (init?.signal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    const u = String(url);
    if (u.startsWith('/snapshots?')) {
      return { ok: true, json: async () => ({ snapshots }) };
    }
    if (u.startsWith('/ghosts/at?')) {
      const m = /commit=([^&]+)/.exec(u);
      const sha = m ? decodeURIComponent(m[1]) : null;
      const ghosts = (sha && perCommit[sha]) || [];
      return { ok: true, json: async () => ({ ghosts }) };
    }
    return { ok: false, json: async () => ({}) };
  });
}

describe('snapshot-ghosts-cache', () => {
  beforeEach(() => {
    clearSnapshotGhostsCache();
    vi.restoreAllMocks();
  });

  it('returns an empty Map when `/snapshots` is empty', async () => {
    globalThis.fetch = makeFetchMock([]);
    const out = await prefetchSnapshotGhosts('repo1');
    expect(out.size).toBe(0);
  });

  it('builds a Map with one entry per snapshot when populated', async () => {
    const snapshots = [
      { key: 'repo1@aaaaaa', commit: { shortHash: 'aaaaaa', date: '2026-05-15T00:00:00Z' } },
      { key: 'repo1@bbbbbb', commit: { shortHash: 'bbbbbb', date: '2026-05-20T00:00:00Z' } },
      { key: 'repo1@cccccc', commit: { shortHash: 'cccccc', date: '2026-05-25T00:00:00Z' } },
    ];
    const perCommit = {
      aaaaaa: [{ id: 'g1', title: 'Ghost 1', tier: '1', status: 'planned', expectedLinks: [] }],
      bbbbbb: [{ id: 'g2', title: 'Ghost 2', tier: '1', status: 'planned', expectedLinks: [] }],
      cccccc: [{ id: 'g3', title: 'Ghost 3', tier: '1', status: 'planned', expectedLinks: [] }],
    };
    globalThis.fetch = makeFetchMock(snapshots, perCommit);
    const out = await prefetchSnapshotGhosts('repo1');
    expect(out.size).toBe(3);
    expect(out.get('aaaaaa')?.date).toBe('2026-05-15T00:00:00Z');
    expect(out.get('bbbbbb')?.ghosts[0].id).toBe('g2');
  });

  it('second call within TTL re-uses the same promise (no new /snapshots fetch)', async () => {
    const snapshots = [
      { key: 'repo1@aaaaaa', commit: { shortHash: 'aaaaaa', date: '2026-05-15T00:00:00Z' } },
    ];
    const fetchMock = makeFetchMock(snapshots, {});
    globalThis.fetch = fetchMock;
    await prefetchSnapshotGhosts('repo1');
    const callsAfterFirst = fetchMock.mock.calls.length;
    await prefetchSnapshotGhosts('repo1');
    // Same number of calls — the second prefetch hit the in-memory cache.
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('caps the per-snapshot fetch fan-out at 50 entries', async () => {
    const snapshots = Array.from({ length: 80 }, (_, i) => ({
      key: `repo1@${String(i).padStart(6, '0')}`,
      commit: {
        shortHash: String(i).padStart(6, '0'),
        date: new Date(2025, 0, i + 1).toISOString(),
      },
    }));
    const fetchMock = makeFetchMock(snapshots, {});
    globalThis.fetch = fetchMock;
    const out = await prefetchSnapshotGhosts('repo1');
    // 1 list call + at most 50 ghost-at calls.
    const ghostAtCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/ghosts/at?')).length;
    expect(ghostAtCalls).toBeLessThanOrEqual(50);
    expect(out.size).toBeLessThanOrEqual(50);
  });

  it('propagates aborts via the supplied AbortSignal', async () => {
    const snapshots = [
      { key: 'repo1@aaaaaa', commit: { shortHash: 'aaaaaa', date: '2026-05-15T00:00:00Z' } },
    ];
    globalThis.fetch = makeFetchMock(snapshots, {});
    const ctrl = new AbortController();
    ctrl.abort();
    // With an already-aborted signal, the implementation must swallow
    // the abort error and return an empty Map (not throw).
    const out = await prefetchSnapshotGhosts('repo1', ctrl.signal);
    expect(out.size).toBe(0);
  });
});
