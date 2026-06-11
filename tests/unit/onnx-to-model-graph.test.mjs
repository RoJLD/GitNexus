import { describe, it, expect } from 'vitest';
import { onnxGraphToModelGraph } from '../../tools/onnx-to-model-graph.mjs';

const CHAIN = { name: 'tiny', node: [
  { opType: 'Conv', name: 'conv1', input: ['x', 'w'], output: ['t1'] },
  { opType: 'Relu', name: 'relu1', input: ['t1'], output: ['t2'] },
  { opType: 'Gemm', name: 'gemm1', input: ['t2', 'w2'], output: ['t3'] },
] };

describe('onnxGraphToModelGraph', () => {
  it('maps ops to nodes and tensor-flow to edges', () => {
    const g = onnxGraphToModelGraph(CHAIN, { name: 'tiny' });
    expect(g.model).toMatchObject({ name: 'tiny', framework: 'onnx' });
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes.every((n) => n.type === 'op')).toBe(true);
    expect(g.nodes.map((n) => n.label).sort()).toEqual(['Conv', 'Gemm', 'Relu']);
    expect(g.edges).toHaveLength(2);
    expect(g.edges).toContainEqual({ from: 'conv1', to: 'relu1', kind: 'tensor', label: 't1' });
    expect(g.edges).toContainEqual({ from: 'relu1', to: 'gemm1', kind: 'tensor', label: 't2' });
  });
  it('falls back to opType#i for nameless nodes + default model name', () => {
    const g = onnxGraphToModelGraph({ node: [{ opType: 'Add', input: [], output: ['o'] }] });
    expect(g.nodes[0].id).toBe('Add#0');
    expect(g.model.name).toBe('onnx-model');
  });
  it('graph-input tensors (no producer) yield no edge', () => {
    const g = onnxGraphToModelGraph({ node: [{ opType: 'Relu', name: 'r', input: ['x'], output: ['y'] }] });
    expect(g.edges).toEqual([]);
  });
  it('empty graph → empty, no throw', () => {
    const g = onnxGraphToModelGraph({});
    expect(g.nodes).toEqual([]); expect(g.edges).toEqual([]);
  });
  it('throws above maxNodes (no silent truncation)', () => {
    const big = { node: Array.from({ length: 5 }, (_, i) => ({ opType: 'X', name: `n${i}`, input: [], output: [] })) };
    expect(() => onnxGraphToModelGraph(big, { maxNodes: 3 })).toThrow(/max/i);
  });
  it('is JSON-serializable', () => { expect(() => JSON.stringify(onnxGraphToModelGraph(CHAIN))).not.toThrow(); });
});
