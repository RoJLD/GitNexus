import { describe, it, expect } from 'vitest';
import { degreeCentrality, pageRank, louvain, computeMetrics, betweenness, eigenvector } from '../../upstream/docker-server-graph-theory-core.mjs';

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

const PATH3 = { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [{ source: 'A', target: 'B' }, { source: 'B', target: 'C' }] };
const CYCLE4 = { nodes: ['p','q','r','s'].map((id) => ({ id })), edges: [
  { source: 'p', target: 'q' }, { source: 'q', target: 'r' }, { source: 'r', target: 's' }, { source: 's', target: 'p' } ] };

describe('betweenness', () => {
  it('the middle of a path has the highest betweenness', () => {
    const b = betweenness(PATH3);
    expect(b.B).toBeGreaterThan(b.A);
    expect(b.A).toBeCloseTo(b.C, 9);
    expect(b.A).toBeCloseTo(0, 9);
  });
  it('the hub of a star has the highest betweenness', () => {
    const b = betweenness(STAR);
    expect(b.h).toBeGreaterThan(b.a);
  });
  it('the two bridge nodes of the barbell rank highest', () => {
    const b = betweenness(BARBELL);
    expect(b.x1).toBeGreaterThan(b.x2);
    expect(b.y1).toBeGreaterThan(b.y2);
  });
  it('is 0 everywhere on an edgeless graph', () => {
    const b = betweenness({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(b.a).toBe(0); expect(b.b).toBe(0);
  });
});

describe('eigenvector', () => {
  it('is symmetric on a 4-cycle', () => {
    const e = eigenvector(CYCLE4);
    expect(e.p).toBeCloseTo(e.q, 6);
    expect(e.q).toBeCloseTo(e.r, 6);
  });
  it('ranks the hub of a star above a leaf', () => {
    const e = eigenvector(STAR);
    expect(e.h).toBeGreaterThan(e.a * 1.3);   // hub strictly dominant, not float noise
  });
  it('ranks the hub above leaves on a 4-leaf star (the bipartite case)', () => {
    const k14 = { nodes: ['h', 'a', 'b', 'c', 'd'].map((id) => ({ id })),
      edges: [{ source: 'h', target: 'a' }, { source: 'h', target: 'b' }, { source: 'h', target: 'c' }, { source: 'h', target: 'd' }] };
    const e = eigenvector(k14);
    expect(e.h).toBeGreaterThan(e.a * 1.3);
    expect(e.a).toBeCloseTo(e.b, 6);   // leaves symmetric
  });
  it('degrades safely on an edgeless graph (finite, non-negative)', () => {
    const e = eigenvector({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(Number.isFinite(e.a)).toBe(true);
    expect(e.a).toBeGreaterThanOrEqual(0);
  });
});

describe('computeMetrics adds betweenness + eigenvector', () => {
  it('exposes the new per-node fields', () => {
    const r = computeMetrics(BARBELL);
    expect(r.nodes[0]).toHaveProperty('betweenness');
    expect(r.nodes[0]).toHaveProperty('eigenvector');
    expect(r.nodes.every((n) => Number.isFinite(n.betweenness) && Number.isFinite(n.eigenvector))).toBe(true);
  });
});
