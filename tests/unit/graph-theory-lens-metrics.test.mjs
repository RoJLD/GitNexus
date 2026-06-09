import { describe, it, expect } from 'vitest';
import { lensMetrics } from '../../upstream/docker-server-graph-theory.mjs';
import { projectFileGraph, LENSES } from '../../upstream/docker-server-graph-lens-core.mjs';

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

// ASTKG with MIXED relationship types between files (not just IMPORTS).
const MIXED_GRAPH = {
  nodes: [
    { id: 's1', properties: { filePath: 'src/a.ts' } },
    { id: 's2', properties: { filePath: 'src/b.ts' } },
    { id: 's3', properties: { filePath: 'src/c.ts' } },
    { id: 's4', properties: { filePath: 'src/a.ts' } }, // 2nd symbol in a.ts
  ],
  relationships: [
    { sourceId: 's1', targetId: 's2', type: 'IMPORTS' },   // a→b imports
    { sourceId: 's2', targetId: 's3', type: 'CALLS' },     // b→c calls (imports-deps would DROP this)
    { sourceId: 's1', targetId: 's3', type: 'EXTENDS' },   // a→c extends
    { sourceId: 's2', targetId: 's3', type: 'IMPORTS' },   // b→c imports — dup pair with the CALLS above
    { sourceId: 's1', targetId: 's4', type: 'CALLS' },     // a.ts→a.ts — self-loop, dropped
  ],
};

describe('projectFileGraph', () => {
  it('collapses ALL relationship types to file level (one edge per pair)', () => {
    const g = projectFileGraph(MIXED_GRAPH);
    const has = (s, t) => g.edges.some((e) => e.source === s && e.target === t);
    expect(has('src/a.ts', 'src/b.ts')).toBe(true);   // IMPORTS
    expect(has('src/b.ts', 'src/c.ts')).toBe(true);   // CALLS — present here, would be DROPPED by imports-deps
    expect(has('src/a.ts', 'src/c.ts')).toBe(true);   // EXTENDS
    // dedup per directed pair: b→c appears via CALLS and IMPORTS → exactly one edge
    expect(g.edges.filter((e) => e.source === 'src/b.ts' && e.target === 'src/c.ts')).toHaveLength(1);
    // self-loop (a.ts→a.ts) dropped
    expect(g.edges.some((e) => e.source === e.target)).toBe(false);
    // edge kind is the generic 'related'
    expect(g.edges.every((e) => e.kind === 'related')).toBe(true);
    // render shape: file nodes with id=path
    expect(g.nodes.find((n) => n.id === 'src/a.ts')).toMatchObject({ type: 'file', path: 'src/a.ts' });
    expect(g.schema_type).toBe('file-graph');
  });
  it('is registered in LENSES and computes metrics via lensMetrics', () => {
    expect(LENSES['file-graph']).toBe(projectFileGraph);
    expect(LENSES['imports-deps']).toBeTypeOf('function');   // existing lens still present
    const r = lensMetrics(MIXED_GRAPH, 'file-graph', { community: 'louvain', resolution: 1 });
    expect(r.summary.nodeCount).toBe(3);                     // a, b, c
    expect(r.summary.edgeCount).toBe(3);                     // a-b, b-c, a-c
    expect(r.nodes.every((n) => Number.isFinite(n.betweenness))).toBe(true);
    expect(r.summary.capped).toBe(false);
  });
});

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
