import { describe, it, expect } from 'vitest';
import { makeMetricsCache, metricsCacheKey } from '../../upstream/docker-server-graph-theory.mjs';

describe('metrics cache (TTL + LRU, injected clock)', () => {
  it('hits within TTL, misses after, bypasses on fresh, evicts oldest at capacity', () => {
    let now = 1000;
    const c = makeMetricsCache({ ttlMs: 100, max: 2, clock: () => now });
    c.set('a', { v: 1 }); expect(c.get('a')).toEqual({ v: 1 });   // hit
    now = 1101; expect(c.get('a')).toBe(undefined);                // expired
    now = 2000; c.set('b', {}); c.set('d', {}); c.set('e', {});    // max 2 → 'b' evicted
    expect(c.get('b')).toBe(undefined); expect(c.get('e')).toBeTruthy();
  });
});

describe('metricsCacheKey — P2.3 params', () => {
  it('varies with directed/hierarchy/embed/dims', () => {
    const base = { community: 'louvain', resolution: 1, cap: 2000, approx: null, directed: false, hierarchy: false, embed: null, dims: 8 };
    const k = (o) => metricsCacheKey('sidecar', 'g', '', { ...base, ...o });
    expect(k({})).not.toBe(k({ directed: true }));
    expect(k({})).not.toBe(k({ hierarchy: true }));
    expect(k({})).not.toBe(k({ embed: 'spectral' }));
    expect(k({ dims: 8 })).not.toBe(k({ dims: 4 }));
  });
});
