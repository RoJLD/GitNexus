import { describe, it, expect } from 'vitest';
import { parseMetricsParams } from '../../upstream/docker-server-graph-theory.mjs';

describe('parseMetricsParams', () => {
  it('defaults to louvain @ resolution 1', () => {
    expect(parseMetricsParams(new URLSearchParams(''))).toMatchObject({ community: 'louvain', resolution: 1 });
  });
  it('accepts valid community + resolution', () => {
    expect(parseMetricsParams(new URLSearchParams('community=leiden&resolution=2.5'))).toMatchObject({ community: 'leiden', resolution: 2.5 });
    expect(parseMetricsParams(new URLSearchParams('community=labelprop'))).toMatchObject({ community: 'labelprop', resolution: 1 });
  });
  it('throws on an unknown community', () => {
    expect(() => parseMetricsParams(new URLSearchParams('community=bogus'))).toThrow();
  });
  it('throws on a non-positive / non-finite resolution', () => {
    expect(() => parseMetricsParams(new URLSearchParams('resolution=0'))).toThrow();
    expect(() => parseMetricsParams(new URLSearchParams('resolution=-1'))).toThrow();
    expect(() => parseMetricsParams(new URLSearchParams('resolution=abc'))).toThrow();
  });
  it('parses cap + approx (positive ints; clamps cap; rejects bad)', () => {
    expect(parseMetricsParams(new URLSearchParams('cap=5000&approx=200'))).toMatchObject({ cap: 5000, approx: 200 });
    expect(parseMetricsParams(new URLSearchParams('')).cap).toBe(2000);              // default
    expect(parseMetricsParams(new URLSearchParams('')).approx).toBe(null);
    expect(parseMetricsParams(new URLSearchParams('cap=999999')).cap).toBe(50000);   // clamp to CAP_MAX
    expect(() => parseMetricsParams(new URLSearchParams('cap=0'))).toThrow();
    expect(() => parseMetricsParams(new URLSearchParams('approx=-1'))).toThrow();
    expect(() => parseMetricsParams(new URLSearchParams('approx=abc'))).toThrow();
  });
});
