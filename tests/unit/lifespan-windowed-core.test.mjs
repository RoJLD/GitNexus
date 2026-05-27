import { describe, it, expect } from 'vitest';
import { computeWindowedBuckets } from '../../upstream/docker-server-lifespan-windowed-core.mjs';

describe('computeWindowedBuckets', () => {
  it('distributes IDs across 4 buckets correctly (typical window)', () => {
    const idsA = new Set(['n1', 'n2', 'n3']);
    const idsB = new Set(['n2', 'n3', 'n4']);
    const ephemeralIds = new Set(['n5']);
    const result = computeWindowedBuckets(idsA, idsB, ephemeralIds);

    expect([...result.foundational].sort()).toEqual(['n2', 'n3']);
    expect([...result.recent].sort()).toEqual(['n4']);
    expect([...result.discontinued].sort()).toEqual(['n1']);
    expect([...result.ephemeral].sort()).toEqual(['n5']);
  });

  it('empty intermediates → empty ephemeral', () => {
    const idsA = new Set(['n1']);
    const idsB = new Set(['n2']);
    const result = computeWindowedBuckets(idsA, idsB, new Set());
    expect(result.ephemeral.size).toBe(0);
    expect([...result.recent]).toEqual(['n2']);
    expect([...result.discontinued]).toEqual(['n1']);
  });

  it('identical A and B → all foundational, others empty', () => {
    const ids = new Set(['n1', 'n2']);
    const result = computeWindowedBuckets(ids, ids, new Set());
    expect([...result.foundational].sort()).toEqual(['n1', 'n2']);
    expect(result.recent.size).toBe(0);
    expect(result.discontinued.size).toBe(0);
    expect(result.ephemeral.size).toBe(0);
  });

  it('all empty → all buckets empty', () => {
    const result = computeWindowedBuckets(new Set(), new Set(), new Set());
    expect(result.foundational.size).toBe(0);
    expect(result.recent.size).toBe(0);
    expect(result.discontinued.size).toBe(0);
    expect(result.ephemeral.size).toBe(0);
  });

  it('ephemeral IDs that ALSO happen to be in A or B are NOT counted as ephemeral (no double-counting)', () => {
    const idsA = new Set(['n1']);
    const idsB = new Set(['n2']);
    const ephemeralIds = new Set(['n1', 'n3']);
    const result = computeWindowedBuckets(idsA, idsB, ephemeralIds);

    expect([...result.foundational]).toEqual([]);
    expect([...result.recent]).toEqual(['n2']);
    expect([...result.discontinued]).toEqual(['n1']);
    expect([...result.ephemeral]).toEqual(['n3']);
  });
});
