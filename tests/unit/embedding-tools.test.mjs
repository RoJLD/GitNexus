import { describe, it, expect } from 'vitest';
import { nearestNeighbors, spectralLayout } from '../../upstream/gitnexus-web/src/lib/embedding-tools.ts';

describe('nearestNeighbors', () => {
  it('ranks by cosine similarity, excludes self, respects k', () => {
    const m = new Map([['a', [1, 0]], ['b', [0.9, 0.1]], ['c', [0, 1]], ['d', [-1, 0]]]);
    const nn = nearestNeighbors(m, 'a', 2);
    expect(nn.map((x) => x.id)).toEqual(['b', 'c']);
    expect(nn.find((x) => x.id === 'a')).toBeUndefined();
    expect(nn[0].sim).toBeGreaterThan(nn[1].sim);
  });
  it('returns [] for an unknown id', () => { expect(nearestNeighbors(new Map(), 'x', 5)).toEqual([]); });
});
describe('spectralLayout', () => {
  it('positions from dims 0/1, centered + scaled', () => {
    const m = new Map([['a', [1, 1]], ['b', [-1, -1]]]);
    const pos = spectralLayout(m, ['a', 'b'], { scale: 100 });
    expect(pos.get('a').x).toBeCloseTo(100, 5); expect(pos.get('a').y).toBeCloseTo(100, 5);
    expect(pos.get('b').x).toBeCloseTo(-100, 5);
  });
  it('missing embedding → origin, no throw', () => {
    const pos = spectralLayout(new Map(), ['x'], {});
    expect(pos.get('x')).toEqual({ x: 0, y: 0 });
  });
});
