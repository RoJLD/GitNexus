import { describe, it, expect } from 'vitest';
import { parseMetricsParams } from '../../upstream/docker-server-graph-theory.mjs';

describe('parseMetricsParams', () => {
  it('defaults to louvain @ resolution 1', () => {
    expect(parseMetricsParams(new URLSearchParams(''))).toEqual({ community: 'louvain', resolution: 1 });
  });
  it('accepts valid community + resolution', () => {
    expect(parseMetricsParams(new URLSearchParams('community=leiden&resolution=2.5'))).toEqual({ community: 'leiden', resolution: 2.5 });
    expect(parseMetricsParams(new URLSearchParams('community=labelprop'))).toEqual({ community: 'labelprop', resolution: 1 });
  });
  it('throws on an unknown community', () => {
    expect(() => parseMetricsParams(new URLSearchParams('community=bogus'))).toThrow();
  });
  it('throws on a non-positive / non-finite resolution', () => {
    expect(() => parseMetricsParams(new URLSearchParams('resolution=0'))).toThrow();
    expect(() => parseMetricsParams(new URLSearchParams('resolution=-1'))).toThrow();
    expect(() => parseMetricsParams(new URLSearchParams('resolution=abc'))).toThrow();
  });
});
