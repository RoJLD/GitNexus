import { describe, it, expect } from 'vitest';
import {
  computeStrictFilter,
  computeNormalFilter,
} from '../../upstream/gitnexus-web/src/lib/temporal-filter';

const node = (id) => ({ id });

describe('computeStrictFilter (intersection A ∩ B)', () => {
  it('returns node IDs present in both graphs', () => {
    const a = { nodes: [node('n1'), node('n2'), node('n3')] };
    const b = { nodes: [node('n2'), node('n3'), node('n4')] };
    const result = computeStrictFilter(a, b);
    expect([...result].sort()).toEqual(['n2', 'n3']);
  });

  it('returns empty set when no overlap', () => {
    const a = { nodes: [node('n1')] };
    const b = { nodes: [node('n2')] };
    expect(computeStrictFilter(a, b).size).toBe(0);
  });

  it('returns all IDs when graphs are identical', () => {
    const a = { nodes: [node('n1'), node('n2')] };
    const result = computeStrictFilter(a, a);
    expect([...result].sort()).toEqual(['n1', 'n2']);
  });

  it('handles empty graphs', () => {
    expect(computeStrictFilter({ nodes: [] }, { nodes: [] }).size).toBe(0);
    expect(computeStrictFilter({ nodes: [node('n1')] }, { nodes: [] }).size).toBe(0);
  });
});

describe('computeNormalFilter (union A ∪ B)', () => {
  it('returns node IDs from either graph', () => {
    const a = { nodes: [node('n1'), node('n2')] };
    const b = { nodes: [node('n2'), node('n3')] };
    const result = computeNormalFilter(a, b);
    expect([...result].sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('dedupes nodes present in both', () => {
    const a = { nodes: [node('n1'), node('n2')] };
    const result = computeNormalFilter(a, a);
    expect(result.size).toBe(2);
  });

  it('handles empty graphs', () => {
    expect(computeNormalFilter({ nodes: [] }, { nodes: [] }).size).toBe(0);
    const a = { nodes: [node('n1')] };
    expect([...computeNormalFilter(a, { nodes: [] })]).toEqual(['n1']);
  });
});
