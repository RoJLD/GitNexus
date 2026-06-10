import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shapeActivations } from '../../upstream/docker-server-graph-templates-core.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/model-graph/model-activations.json');

describe('shapeActivations', () => {
  it('shapes a valid capture into {nodes,edges,report}', () => {
    const doc = JSON.parse(readFileSync(FIX, 'utf8'));
    const a = shapeActivations(doc);
    expect(a.nodes.s0).toBeCloseTo(0.82, 9);
    expect(a.edges['s0->emission->obs_up']).toBeCloseTo(0.8, 9);
    expect(a.report.nodeCount).toBe(4);
    expect(a.report.edgeCount).toBe(8);
    expect(a.report.max).toBeCloseTo(0.82, 9);
    expect(a.report.min).toBeCloseTo(0.18, 9);
    expect(a.report.model).toBe('toy-hmm');
    expect(a.report.run).toBe('run-001');
  });
  it('drops non-finite node values and records them', () => {
    const a = shapeActivations({ nodes: { a: 1, b: 'nope', c: null } });
    expect(a.nodes).toEqual({ a: 1 });
    expect(a.report.droppedNodes).toEqual(expect.arrayContaining(['b', 'c']));
  });
  it('defaults edges to {} when absent', () => {
    const a = shapeActivations({ nodes: { a: 0.5 } });
    expect(a.edges).toEqual({});
    expect(a.report.edgeCount).toBe(0);
  });
  it('empty nodes → min/max 0', () => {
    const a = shapeActivations({ nodes: {} });
    expect(a.report.min).toBe(0); expect(a.report.max).toBe(0);
  });
  it('throws on a malformed capture (no nodes object)', () => {
    expect(() => shapeActivations({})).toThrow(/nodes/);
    expect(() => shapeActivations(null)).toThrow();
  });
});
