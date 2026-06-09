import { describe, it, expect } from 'vitest';
import { makeMetricsCache } from '../../upstream/docker-server-graph-theory.mjs';

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
