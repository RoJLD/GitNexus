import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyLens } from '../../upstream/gitnexus-web/src/services/research-client.ts';

afterEach(() => vi.unstubAllGlobals());

describe('applyLens', () => {
  it('GETs /graph/lens/:id?repo= and returns the ResearchGraph', async () => {
    const fake = { schema_type: 'imports-deps', nodes: [{ id: 'a.ts', type: 'file', label: 'a.ts', path: 'a.ts', stage: '' }], edges: [] };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => fake }));
    vi.stubGlobal('fetch', fetchMock);
    const rg = await applyLens('imports-deps', 'my repo');
    expect(fetchMock).toHaveBeenCalledWith('/graph/lens/imports-deps?repo=my%20repo');
    expect(rg.nodes[0].type).toBe('file');
  });
});
