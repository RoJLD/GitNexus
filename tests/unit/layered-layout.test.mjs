import { describe, it, expect } from 'vitest';
import { layeredLayout } from '../../upstream/gitnexus-web/src/lib/layered-layout.ts';

const G = (nodes, edges) => ({ nodes: nodes.map((id) => ({ id })), edges: edges.map(([source, target]) => ({ source, target })) });

describe('layeredLayout', () => {
  it('ranks a path A→B→C by strictly increasing x', () => {
    const p = layeredLayout(G(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]));
    expect(p.get('A').x).toBeLessThan(p.get('B').x);
    expect(p.get('B').x).toBeLessThan(p.get('C').x);
  });
  it('a diamond puts B/C at the same rank, D one further', () => {
    const p = layeredLayout(G(['A', 'B', 'C', 'D'], [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D']]));
    expect(p.get('B').x).toBe(p.get('C').x);
    expect(p.get('B').y).not.toBe(p.get('C').y);   // spread within the rank
    expect(p.get('D').x).toBeGreaterThan(p.get('B').x);
    expect(p.get('A').x).toBeLessThan(p.get('B').x);
  });
  it('terminates + ranks every node on a cycle A→B→C→A', () => {
    const p = layeredLayout(G(['A', 'B', 'C'], [['A', 'B'], ['B', 'C'], ['C', 'A']]));
    for (const id of ['A', 'B', 'C']) { expect(Number.isFinite(p.get(id).x)).toBe(true); expect(Number.isFinite(p.get(id).y)).toBe(true); }
  });
  it('2-component graph: both roots at rank 0 (same x), distinct y', () => {
    const p = layeredLayout(G(['a', 'b', 'c', 'd'], [['a', 'b'], ['c', 'd']]));
    expect(p.get('a').x).toBe(p.get('c').x);       // both rank 0
    expect(p.get('a').y).not.toBe(p.get('c').y);
    expect(p.get('b').x).toBe(p.get('d').x);        // both rank 1
    expect(p.get('b').x).toBeGreaterThan(p.get('a').x);
  });
  it('positions an isolated node', () => {
    const p = layeredLayout(G(['z'], []));
    expect(Number.isFinite(p.get('z').x)).toBe(true);
  });
});
