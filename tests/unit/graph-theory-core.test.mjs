import { describe, it, expect } from 'vitest';
import { degreeCentrality, pageRank, louvain, computeMetrics } from '../../upstream/docker-server-graph-theory-core.mjs';

const STAR = { nodes: [{ id: 'h' }, { id: 'a' }, { id: 'b' }, { id: 'c' }],
               edges: [{ source: 'h', target: 'a' }, { source: 'h', target: 'b' }, { source: 'h', target: 'c' }] };
const BARBELL = { nodes: ['x1','x2','x3','y1','y2','y3'].map((id) => ({ id })),
  edges: [
    { source: 'x1', target: 'x2' }, { source: 'x2', target: 'x3' }, { source: 'x3', target: 'x1' },
    { source: 'y1', target: 'y2' }, { source: 'y2', target: 'y3' }, { source: 'y3', target: 'y1' },
    { source: 'x1', target: 'y1' },
  ] };

describe('degreeCentrality', () => {
  it('counts total (undirected) degree', () => {
    const d = degreeCentrality(STAR);
    expect(d.h).toBe(3);
    expect(d.a).toBe(1);
  });
});

describe('pageRank', () => {
  it('ranks the directed sink leaves above the hub in a star', () => {
    const pr = pageRank(STAR);
    expect(pr.a).toBeGreaterThan(pr.h);
    const sum = Object.values(pr).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
  it('is symmetric on a 2-cycle', () => {
    const pr = pageRank({ nodes: [{ id: 'p' }, { id: 'q' }], edges: [{ source: 'p', target: 'q' }, { source: 'q', target: 'p' }] });
    expect(pr.p).toBeCloseTo(pr.q, 6);
  });
});

describe('louvain', () => {
  it('finds the two cliques of a barbell with positive modularity', () => {
    const { communities, modularity } = louvain(BARBELL, { seed: 1 });
    expect(new Set(Object.values(communities)).size).toBe(2);
    expect(communities.x1).toBe(communities.x2);
    expect(communities.x2).toBe(communities.x3);
    expect(communities.y1).toBe(communities.y2);
    expect(communities.x1).not.toBe(communities.y1);
    expect(modularity).toBeGreaterThan(0.3);
  });
  it('is deterministic for a fixed seed', () => {
    expect(louvain(BARBELL, { seed: 7 }).communities).toEqual(louvain(BARBELL, { seed: 7 }).communities);
  });
});

describe('computeMetrics', () => {
  it('returns per-node metrics + summary', () => {
    const r = computeMetrics(BARBELL);
    expect(r.nodes).toHaveLength(6);
    expect(r.nodes[0]).toHaveProperty('id');
    expect(r.nodes[0]).toHaveProperty('degree');
    expect(r.nodes[0]).toHaveProperty('pagerank');
    expect(r.nodes[0]).toHaveProperty('community');
    expect(r.summary).toMatchObject({ nodeCount: 6, edgeCount: 7, communityCount: 2 });
    expect(r.summary.modularity).toBeGreaterThan(0.3);
  });
  it('handles an edgeless graph', () => {
    const r = computeMetrics({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(r.summary).toMatchObject({ nodeCount: 2, edgeCount: 0, communityCount: 2, modularity: 0 });
    expect(r.nodes.every((n) => n.pagerank > 0)).toBe(true);
  });
});
