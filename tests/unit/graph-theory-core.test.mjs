import { describe, it, expect } from 'vitest';
import { degreeCentrality, pageRank, louvain, computeMetrics, betweenness, eigenvector, connectedComponents, density, articulationPointsAndBridges, kCore, clusteringCoefficient, closeness, harmonic, katz, labelPropagation, leiden } from '../../upstream/docker-server-graph-theory-core.mjs';

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

// ---- Task 1: connected components + density ----
const TWO_COMP = { nodes: ['a','b','c','d'].map((id) => ({ id })),
  edges: [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }] };

describe('connectedComponents', () => {
  it('labels disjoint components distinctly', () => {
    const c = connectedComponents(TWO_COMP);
    expect(c.get('a')).toBe(c.get('b'));
    expect(c.get('c')).toBe(c.get('d'));
    expect(c.get('a')).not.toBe(c.get('c'));
    expect(new Set(c.values()).size).toBe(2);
  });
  it('is one component for a connected graph', () => {
    expect(new Set(connectedComponents(BARBELL).values()).size).toBe(1);
  });
});

describe('density', () => {
  it('is 1 for a complete triangle and 0 for an edgeless graph', () => {
    const K3 = { nodes: ['a','b','c'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'c' }] };
    expect(density(K3)).toBeCloseTo(1, 9);
    expect(density({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] })).toBe(0);
    expect(density({ nodes: [{ id: 'a' }], edges: [] })).toBe(0);
  });
});

// ---- Task 2: articulation points + bridges ----
function bridgeHas(bridges, u, v) {
  return bridges.some(([a, b]) => (a === u && b === v) || (a === v && b === u));
}

describe('articulationPointsAndBridges', () => {
  it('finds the barbell bridge + its two endpoints as cut vertices', () => {
    const { articulation, bridges } = articulationPointsAndBridges(BARBELL);
    expect(bridgeHas(bridges, 'x1', 'y1')).toBe(true);
    expect(bridges).toHaveLength(1);                 // only the connecting edge is a bridge
    expect(articulation.has('x1')).toBe(true);
    expect(articulation.has('y1')).toBe(true);
    expect(articulation.has('x2')).toBe(false);      // triangle interior is not a cut vertex
  });
  it('the middle of a path is a cut vertex; both edges are bridges', () => {
    const { articulation, bridges } = articulationPointsAndBridges(PATH3);
    expect(articulation.has('B')).toBe(true);
    expect(articulation.has('A')).toBe(false);
    expect(bridgeHas(bridges, 'A', 'B')).toBe(true);
    expect(bridgeHas(bridges, 'B', 'C')).toBe(true);
  });
  it('a triangle has no cut vertices and no bridges', () => {
    const K3 = { nodes: ['a','b','c'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'c' }] };
    const { articulation, bridges } = articulationPointsAndBridges(K3);
    expect(articulation.size).toBe(0);
    expect(bridges).toHaveLength(0);
  });
  it('an edgeless graph has none', () => {
    const { articulation, bridges } = articulationPointsAndBridges({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(articulation.size).toBe(0);
    expect(bridges).toHaveLength(0);
  });
  it('a 4-cycle has no cut vertices and no bridges', () => {
    const C4 = { nodes: ['p','q','r','s'].map((id) => ({ id })),
      edges: [{ source: 'p', target: 'q' }, { source: 'q', target: 'r' }, { source: 'r', target: 's' }, { source: 's', target: 'p' }] };
    const { articulation, bridges } = articulationPointsAndBridges(C4);
    expect(articulation.size).toBe(0);
    expect(bridges).toHaveLength(0);
  });
});

// ---- Task 3: k-core + clustering coefficient/transitivity ----
describe('kCore', () => {
  it('a triangle is a 2-core; a path is a 1-core', () => {
    const K3 = { nodes: ['a','b','c'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'c' }] };
    const tri = kCore(K3);
    expect(tri.get('a')).toBe(2); expect(tri.get('b')).toBe(2); expect(tri.get('c')).toBe(2);
    const path = kCore(PATH3);
    expect(path.get('A')).toBe(1); expect(path.get('B')).toBe(1); expect(path.get('C')).toBe(1);
  });
  it('isolated nodes have coreness 0', () => {
    const c = kCore({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(c.get('a')).toBe(0); expect(c.get('b')).toBe(0);
  });
  it('K4-minus-an-edge has coreness 2; a pendant attached to a triangle stays 1', () => {
    const K4me = { nodes: ['a','b','c','d'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }, { source: 'a', target: 'd' },
              { source: 'b', target: 'c' }, { source: 'b', target: 'd' }] };  // missing c-d
    const c1 = kCore(K4me);
    expect(Math.max(...c1.values())).toBe(2);
    const triPlusPendant = { nodes: ['a','b','c','p'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'c' }, { source: 'c', target: 'p' }] };
    const c2 = kCore(triPlusPendant);
    expect(c2.get('p')).toBe(1);
    expect(c2.get('a')).toBe(2);
  });
});

describe('clusteringCoefficient', () => {
  it('is 1 everywhere on a triangle (local + transitivity)', () => {
    const K3 = { nodes: ['a','b','c'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'c' }] };
    const { local, transitivity } = clusteringCoefficient(K3);
    expect(local.a).toBeCloseTo(1, 9);
    expect(transitivity).toBeCloseTo(1, 9);
  });
  it('is 0 on a star (no triangles)', () => {
    const { local, transitivity } = clusteringCoefficient(STAR);
    expect(local.h).toBe(0);
    expect(local.a).toBe(0);
    expect(transitivity).toBe(0);
  });
  it('bowtie (two triangles sharing a vertex) has transitivity 0.6', () => {
    const BOWTIE = { nodes: ['c','a','b','d','e'].map((id) => ({ id })),
      edges: [{ source: 'c', target: 'a' }, { source: 'a', target: 'b' }, { source: 'b', target: 'c' },
              { source: 'c', target: 'd' }, { source: 'd', target: 'e' }, { source: 'e', target: 'c' }] };
    const { transitivity } = clusteringCoefficient(BOWTIE);
    expect(transitivity).toBeCloseTo(0.6, 9);
  });
});

// ---- Task 4: closeness + harmonic ----
describe('closeness', () => {
  it('ranks the middle of a path highest', () => {
    const c = closeness(PATH3);
    expect(c.B).toBeGreaterThan(c.A);
    expect(c.A).toBeCloseTo(c.C, 9);
  });
  it('is finite on a disconnected graph (component-aware, no Infinity)', () => {
    const c = closeness({ nodes: ['a','b','c','d'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }] });
    expect(Number.isFinite(c.a)).toBe(true);
    expect(c.a).toBeGreaterThan(0);
  });
});

describe('harmonic', () => {
  it('ranks the middle of a path highest and is disconnection-safe', () => {
    const h = harmonic(PATH3);
    expect(h.B).toBeGreaterThan(h.A);
    const d = harmonic({ nodes: ['a','b','c','d'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }] });
    expect(Number.isFinite(d.a)).toBe(true);
  });
  it('is 0 on an edgeless graph', () => {
    const h = harmonic({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(h.a).toBe(0);
  });
});

// ---- Task 5: katz ----
describe('katz', () => {
  it('ranks the hub of a star above a leaf and is finite/positive', () => {
    const k = katz(STAR);
    expect(k.h).toBeGreaterThan(k.a);
    expect(Object.values(k).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });
  it('degrades to a finite uniform result on an edgeless graph', () => {
    const k = katz({ nodes: ['a','b'].map((id) => ({ id })), edges: [] });
    expect(Number.isFinite(k.a)).toBe(true);
    expect(k.a).toBeCloseTo(k.b, 9);
  });
  it('matches true-Katz ranking on a dense graph (no per-step-normalization inversion)', () => {
    const E = [[0,1],[0,3],[0,4],[0,5],[0,6],[0,8],[0,10],[0,11],[1,3],[1,7],[1,8],[1,9],[1,10],[1,11],
      [2,4],[2,7],[2,9],[3,6],[3,7],[3,8],[3,10],[3,11],[4,9],[4,11],[5,9],[5,10],[6,8],[6,10],[6,11],
      [7,9],[7,10],[7,11],[8,9],[8,10],[10,11]];
    const g = { nodes: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}` })),
      edges: E.map(([a, b]) => ({ source: `n${a}`, target: `n${b}` })) };
    const k = katz(g);
    expect(k.n6).toBeGreaterThan(k.n9);   // true Katz: n6 > n9 (per-step normalization flipped this)
  });
});

// ---- Task 6: resolution-tunable louvain + label propagation ----
describe('louvain resolution', () => {
  it('default resolution=1 is byte-identical to the parameterless call (regression guard)', () => {
    expect(louvain(BARBELL, { seed: 1, resolution: 1 }).communities).toEqual(louvain(BARBELL, { seed: 1 }).communities);
  });
  it('higher resolution yields at least as many communities', () => {
    const lo = new Set(Object.values(louvain(BARBELL, { seed: 1, resolution: 0.5 }).communities)).size;
    const hi = new Set(Object.values(louvain(BARBELL, { seed: 1, resolution: 3 }).communities)).size;
    expect(hi).toBeGreaterThanOrEqual(lo);
  });
});

describe('labelPropagation', () => {
  it('finds the two cliques of a barbell', () => {
    const { communities } = labelPropagation(BARBELL, { seed: 1 });
    expect(communities.x1).toBe(communities.x2);
    expect(communities.x2).toBe(communities.x3);
    expect(communities.y1).toBe(communities.y2);
    expect(communities.x1).not.toBe(communities.y1);
  });
  it('renumbers communities from 0 and is deterministic for a fixed seed', () => {
    const a = labelPropagation(BARBELL, { seed: 3 }).communities;
    const b = labelPropagation(BARBELL, { seed: 3 }).communities;
    expect(a).toEqual(b);
    expect(Math.min(...Object.values(a))).toBe(0);
  });
});

// ---- Task 7: leiden ----
// Returns true iff every community in `communities` is internally connected over `graph`.
function allCommunitiesConnected(graph, communities) {
  const adj = new Map();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) { if (adj.has(e.source) && adj.has(e.target) && e.source !== e.target) { adj.get(e.source).push(e.target); adj.get(e.target).push(e.source); } }
  const byComm = new Map();
  for (const id of Object.keys(communities)) { const c = communities[id]; if (!byComm.has(c)) byComm.set(c, []); byComm.get(c).push(id); }
  for (const [, members] of byComm) {
    const memberSet = new Set(members);
    const seen = new Set([members[0]]);
    const queue = [members[0]];
    while (queue.length) { const v = queue.shift(); for (const w of adj.get(v)) { if (memberSet.has(w) && !seen.has(w)) { seen.add(w); queue.push(w); } } }
    if (seen.size !== members.length) return false;
  }
  return true;
}

describe('leiden', () => {
  it('finds the two cliques of a barbell', () => {
    const { communities } = leiden(BARBELL, { seed: 1 });
    expect(communities.x1).toBe(communities.x2);
    expect(communities.x2).toBe(communities.x3);
    expect(communities.x1).not.toBe(communities.y1);
    expect(new Set(Object.values(communities)).size).toBe(2);
  });
  it('guarantees every community is internally connected', () => {
    expect(allCommunitiesConnected(BARBELL, leiden(BARBELL, { seed: 1 }).communities)).toBe(true);
    const TWO_COMP = { nodes: ['a','b','c','d'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }] };
    expect(allCommunitiesConnected(TWO_COMP, leiden(TWO_COMP, { seed: 1 }).communities)).toBe(true);
  });
  it('renumbers communities from 0 and is deterministic for a fixed seed', () => {
    const a = leiden(BARBELL, { seed: 5 }).communities;
    expect(a).toEqual(leiden(BARBELL, { seed: 5 }).communities);
    expect(Math.min(...Object.values(a))).toBe(0);
  });
});
