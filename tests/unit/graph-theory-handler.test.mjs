import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleGraphMetricsRoute, parseMetricsParams } from '../../upstream/docker-server-graph-theory.mjs';

function fakeRes() { return { _c: 0, _b: '', writeHead(c) { this._c = c; }, end(b) { this._b = b || ''; } }; }
afterEach(() => vi.unstubAllGlobals());

describe('handleGraphMetricsRoute', () => {
  it('computes metrics for a sidecar graph', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      nodes: [{ id: 'x1' }, { id: 'x2' }, { id: 'y1' }], edges: [{ source: 'x1', target: 'x2' }],
    }) })));
    const res = fakeRes();
    const claimed = await handleGraphMetricsRoute({ method: 'GET' }, new URL('http://x/graph/metrics/foo'), res);
    expect(claimed).toBe(true);
    expect(res._c).toBe(200);
    const body = JSON.parse(res._b);
    expect(body.summary.nodeCount).toBe(3);
    expect(body.nodes.find((n) => n.id === 'x1')).toHaveProperty('pagerank');
  });
  it('404s when the sidecar graph is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'nope' }) })));
    const res = fakeRes();
    await handleGraphMetricsRoute({ method: 'GET' }, new URL('http://x/graph/metrics/missing'), res);
    expect(res._c).toBe(404);
  });
  it('returns false for non-metrics paths', async () => {
    const res = fakeRes();
    expect(await handleGraphMetricsRoute({ method: 'GET' }, new URL('http://x/graph/templates'), res)).toBe(false);
  });
});

describe('parseMetricsParams — P2.3 params', () => {
  const P = (q) => parseMetricsParams(new URL('http://x/g?' + q).searchParams);
  it('defaults the new params off', () => {
    const p = P('');
    expect(p.directed).toBe(false); expect(p.hierarchy).toBe(false);
    expect(p.embed).toBe(null); expect(p.dims).toBe(8);
  });
  it('parses directed/hierarchy/embed/dims', () => {
    const p = P('directed=1&hierarchy=true&embed=spectral&dims=4');
    expect(p.directed).toBe(true); expect(p.hierarchy).toBe(true);
    expect(p.embed).toBe('spectral'); expect(p.dims).toBe(4);
  });
  it('rejects an unknown embed method', () => { expect(() => P('embed=node2vec')).toThrow(/embed/); });
  it('rejects a non-positive dims', () => { expect(() => P('dims=0')).toThrow(/dims/); });
});
