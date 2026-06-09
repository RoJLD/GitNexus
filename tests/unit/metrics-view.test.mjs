import { describe, it, expect } from 'vitest';
import { topNByMetric, metricsToCsv, metricsToJson, heatColor } from '../../upstream/gitnexus-web/src/lib/metrics-view.ts';

const N = (id, over = {}) => ({ id, degree: 0, pagerank: 0, betweenness: 0, eigenvector: 0, closeness: 0, katz: 0, harmonic: 0, coreness: 0, clustering: 0, articulation: false, componentId: 0, community: 0, ...over });
const NODES = [N('a', { pagerank: 0.1 }), N('b', { pagerank: 0.9 }), N('c', { pagerank: 0.5 }), N('d', { pagerank: 0.5 })];

describe('topNByMetric', () => {
  it('sorts descending by the metric, ties broken by id asc, clamps n', () => {
    expect(topNByMetric(NODES, 'pagerank', 2).map((n) => n.id)).toEqual(['b', 'c']);     // 0.9, then 0.5 (c before d by id)
    expect(topNByMetric(NODES, 'pagerank', 99).map((n) => n.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(topNByMetric(NODES, 'pagerank', 0)).toEqual([]);
    expect(topNByMetric([], 'pagerank', 5)).toEqual([]);
  });
});
describe('metricsToCsv', () => {
  it('emits a header + one row per node, with basic escaping', () => {
    const csv = metricsToCsv([N('x'), N('a,b')]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('id,degree,pagerank,betweenness,eigenvector,closeness,katz,harmonic,coreness,clustering,articulation,componentId,community');
    expect(lines).toHaveLength(3);
    expect(lines[2].startsWith('"a,b",')).toBe(true);   // comma-containing id quoted
  });
});
describe('metricsToJson', () => {
  it('round-trips the payload', () => {
    const payload = { nodes: [N('x')], bridges: [{ source: 'x', target: 'y' }], summary: { nodeCount: 1, edgeCount: 0, communityCount: 1, modularity: 0, density: 0, componentCount: 1, transitivity: 0 } };
    const back = JSON.parse(metricsToJson(payload));
    expect(back.nodes[0].id).toBe('x'); expect(back.bridges).toHaveLength(1); expect(back.summary.nodeCount).toBe(1);
  });
});
describe('heatColor', () => {
  it('hits the three stops and clamps', () => {
    expect(heatColor(0)).toBe('#313695');
    expect(heatColor(0.5)).toBe('#ffffbf');
    expect(heatColor(1)).toBe('#a50026');
    expect(heatColor(-1)).toBe(heatColor(0));   // clamp low
    expect(heatColor(2)).toBe(heatColor(1));     // clamp high
  });
  it('returns a valid #rrggbb for arbitrary t', () => {
    for (const t of [0.1, 0.25, 0.37, 0.6, 0.83]) expect(heatColor(t)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
