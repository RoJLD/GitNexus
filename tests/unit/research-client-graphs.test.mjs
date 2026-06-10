import { describe, it, expect, vi, afterEach } from 'vitest';
import { listGraphs } from '../../upstream/gitnexus-web/src/services/research-client.ts';
afterEach(() => vi.unstubAllGlobals());
describe('listGraphs', () => {
  it('GETs /graph/list and returns body.graphs', async () => {
    const fake = { graphs: [{ name: 'qa', template: 'research-graph', schema_type: 'research-graph', source: 'x', created: 't' }] };
    const f = vi.fn(async () => ({ ok: true, json: async () => fake }));
    vi.stubGlobal('fetch', f);
    const r = await listGraphs();
    expect(f).toHaveBeenCalledWith('/graph/list');
    expect(r[0].name).toBe('qa');
  });
});
