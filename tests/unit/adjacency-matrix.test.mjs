import { describe, it, expect } from 'vitest';
import { orderNodes, matrixCells } from '../../upstream/gitnexus-web/src/lib/adjacency-matrix.ts';

const M = (o) => new Map(Object.entries(o)); // {id:{community,degree}}

describe('orderNodes', () => {
  it('community mode groups same community contiguously (ties by id)', () => {
    const m = M({ a: { community: 0, degree: 1 }, b: { community: 1, degree: 1 }, c: { community: 0, degree: 1 } });
    expect(orderNodes(['a', 'b', 'c'], m, 'community')).toEqual(['a', 'c', 'b']);
  });
  it('degree mode sorts desc (ties by id)', () => {
    const m = M({ a: { community: 0, degree: 1 }, b: { community: 0, degree: 5 }, c: { community: 0, degree: 5 } });
    expect(orderNodes(['a', 'b', 'c'], m, 'degree')).toEqual(['b', 'c', 'a']);
  });
  it('input mode / no metrics passes through', () => {
    expect(orderNodes(['x', 'y'], undefined, 'community')).toEqual(['x', 'y']);
    expect(orderNodes(['x', 'y'], M({ x: { community: 1, degree: 0 } }), 'input')).toEqual(['x', 'y']);
  });
});
describe('matrixCells', () => {
  it('fills both (i,j) and (j,i) for an edge; drops self-loops + danglers', () => {
    const c = matrixCells(['a', 'b', 'c'], [{ source: 'a', target: 'b' }, { source: 'c', target: 'c' }, { source: 'a', target: 'zzz' }]);
    expect(c.has('0,1')).toBe(true);
    expect(c.has('1,0')).toBe(true);
    expect(c.has('2,2')).toBe(false);    // self-loop dropped
    expect([...c].length).toBe(2);        // only a-b (both dirs)
  });
});
