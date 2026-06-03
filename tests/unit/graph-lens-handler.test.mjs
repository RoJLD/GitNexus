import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleGraphLensRoute } from '../../upstream/docker-server-graph-lens.mjs';

function fakeRes() {
  return { _code: 0, _body: '', writeHead(c) { this._code = c; }, end(b) { this._body = b || ''; } };
}
afterEach(() => vi.unstubAllGlobals());

describe('handleGraphLensRoute', () => {
  it('projects /api/graph for a known lens id + repo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        nodes: [{ id: 'n1', properties: { filePath: 'a.ts' } }, { id: 'n2', properties: { filePath: 'b.ts' } }],
        relationships: [{ sourceId: 'n1', targetId: 'n2', type: 'IMPORTS' }],
      }),
    })));
    const res = fakeRes();
    const url = new URL('http://x/graph/lens/imports-deps?repo=myrepo');
    const claimed = await handleGraphLensRoute({ method: 'GET' }, url, res);
    expect(claimed).toBe(true);
    expect(res._code).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.edges).toEqual([{ id: 'a.ts->b.ts', source: 'a.ts', target: 'b.ts', kind: 'imports' }]);
  });

  it('404s an unknown lens id', async () => {
    const res = fakeRes();
    const url = new URL('http://x/graph/lens/nope?repo=r');
    await handleGraphLensRoute({ method: 'GET' }, url, res);
    expect(res._code).toBe(404);
  });

  it('returns false for non-lens paths', async () => {
    const res = fakeRes();
    const url = new URL('http://x/graph/templates');
    expect(await handleGraphLensRoute({ method: 'GET' }, url, res)).toBe(false);
  });

  it('400s when repo is missing', async () => {
    const res = fakeRes();
    const url = new URL('http://x/graph/lens/imports-deps');
    await handleGraphLensRoute({ method: 'GET' }, url, res);
    expect(res._code).toBe(400);
  });

  it('502s when upstream /api/graph is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    const res = fakeRes();
    const url = new URL('http://x/graph/lens/imports-deps?repo=r');
    await handleGraphLensRoute({ method: 'GET' }, url, res);
    expect(res._code).toBe(502);
  });

  it('500s when upstream returns non-JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } })));
    const res = fakeRes();
    const url = new URL('http://x/graph/lens/imports-deps?repo=r');
    await handleGraphLensRoute({ method: 'GET' }, url, res);
    expect(res._code).toBe(500);
  });
});
