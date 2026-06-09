import { describe, it, expect, vi, afterEach } from 'vitest';
import { getGraphMetrics } from '../../upstream/gitnexus-web/src/services/graph-theory-client.ts';
afterEach(() => vi.unstubAllGlobals());
describe('getGraphMetrics', () => {
  it('GETs /graph/metrics/:name and returns the extended payload', async () => {
    const fake = { nodes: [{ id: 'a', degree: 1, pagerank: 0.5, betweenness: 0.2, eigenvector: 0.4, closeness: 0.3, katz: 0.1, harmonic: 0.25, coreness: 1, clustering: 0, articulation: false, componentId: 0, community: 0 }],
      bridges: [{ source: 'a', target: 'b' }],
      summary: { nodeCount: 1, edgeCount: 0, communityCount: 1, modularity: 0, density: 0, componentCount: 1, transitivity: 0 } };
    const f = vi.fn(async () => ({ ok: true, json: async () => fake }));
    vi.stubGlobal('fetch', f);
    const r = await getGraphMetrics('my graph');
    expect(f).toHaveBeenCalledWith('/graph/metrics/my%20graph');
    expect(r.nodes[0]).toHaveProperty('closeness');
    expect(r.nodes[0]).toHaveProperty('coreness');
    expect(r.nodes[0]).toHaveProperty('clustering');
    expect(r.summary).toHaveProperty('density');
    expect(Array.isArray(r.bridges)).toBe(true);
  });
});
