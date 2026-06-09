import { describe, it, expect } from 'vitest';
import { lensMetrics } from '../../upstream/docker-server-graph-theory.mjs';

// Synthetic /api/graph (ASTKG) shape: nodes carry properties.filePath; IMPORTS rels.
const API_GRAPH = {
  nodes: [
    { id: 'n1', properties: { filePath: 'src/a.ts' } },
    { id: 'n2', properties: { filePath: 'src/b.ts' } },
    { id: 'n3', properties: { filePath: 'src/c.ts' } },
  ],
  relationships: [
    { sourceId: 'n1', targetId: 'n2', type: 'IMPORTS' },
    { sourceId: 'n2', targetId: 'n3', type: 'IMPORTS' },
    { sourceId: 'n1', targetId: 'n3', type: 'CALLS' },   // non-IMPORTS ignored by imports-deps
  ],
};

describe('lensMetrics', () => {
  it('projects via imports-deps and computes metrics over the file graph', () => {
    const r = lensMetrics(API_GRAPH, 'imports-deps', { community: 'louvain', resolution: 1 });
    expect(r.summary.nodeCount).toBe(3);            // 3 files
    expect(r.summary.edgeCount).toBe(2);            // 2 IMPORTS edges (CALLS dropped)
    expect(r.nodes.find((n) => n.id === 'src/b.ts').betweenness).toBeGreaterThan(0); // b is the path middle
    expect(r.summary.capped).toBe(false);
  });
  it('throws on an unknown lens', () => {
    expect(() => lensMetrics(API_GRAPH, 'bogus-lens', {})).toThrow(/unknown lens/);
  });
  it('honours the cap (super-linear metrics skipped)', () => {
    const r = lensMetrics(API_GRAPH, 'imports-deps', {}, 1);   // 3 nodes > cap 1
    expect(r.summary.capped).toBe(true);
    expect(r.nodes.every((n) => n.betweenness === 0)).toBe(true);
  });
});
