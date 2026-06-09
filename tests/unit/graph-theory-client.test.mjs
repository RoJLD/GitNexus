import { describe, it, expect, vi, afterEach } from 'vitest';
import { getGraphMetrics } from '../../upstream/gitnexus-web/src/services/graph-theory-client.ts';
afterEach(() => vi.unstubAllGlobals());
describe('getGraphMetrics', () => {
  it('GETs /graph/metrics/:name and returns the payload', async () => {
    const fake = { nodes: [{ id: 'a', degree: 1, pagerank: 0.5, betweenness: 0.2, eigenvector: 0.4, community: 0 }], summary: { nodeCount: 1, edgeCount: 0, communityCount: 1, modularity: 0 } };
    const f = vi.fn(async () => ({ ok: true, json: async () => fake }));
    vi.stubGlobal('fetch', f);
    const r = await getGraphMetrics('my graph');
    expect(f).toHaveBeenCalledWith('/graph/metrics/my%20graph');
    expect(r.summary.communityCount).toBe(1);
    expect(r.nodes[0]).toHaveProperty('betweenness');
    expect(r.nodes[0]).toHaveProperty('eigenvector');
  });
});
