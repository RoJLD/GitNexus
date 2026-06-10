import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importModelGraph } from '../../upstream/docker-server-model-graph-importer.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/model-graph');

describe('importModelGraph', () => {
  it('maps a curated model graph to the generic ingest shape', async () => {
    const mg = await importModelGraph(FIX);
    expect(mg.schema_type).toBe('model-graph');
    expect(mg.template).toBe('model-graph');
    expect(mg.nodes).toHaveLength(4);
    expect(mg.edges).toHaveLength(8);
    expect(mg.nodes.every((n) => n.table === 'ModelNode')).toBe(true);
    expect(mg.edges.every((e) => e.table === 'ModelEdge')).toBe(true);
    const s0 = mg.nodes.find((n) => n.props.id === 's0');
    expect(s0.props).toMatchObject({ type: 'state', label: 'Bull', layer: '' });
    const emit = mg.edges.find((e) => e.props.kind === 'emission' && e.from === 's0' && e.to === 'obs_up');
    expect(emit.props.weight).toBeCloseTo(0.8, 9);
    expect(emit.props.id).toBe('s0->emission->obs_up');
    expect(mg.report.byType).toMatchObject({ state: 2, observation: 2 });
    expect(mg.report.byKind).toMatchObject({ transition: 4, emission: 4 });
    expect(mg.report.nodes).toBe(4);
    expect(mg.report.edges).toBe(8);
    expect(mg.report.model).toMatchObject({ name: 'toy-hmm', framework: 'hmm' });
  });

  it('defaults label and layer when omitted', async () => {
    const mg = await importModelGraph(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/model-graph-bad'));
    const s0 = mg.nodes.find((n) => n.props.id === 's0');
    expect(s0.props.label).toBe('ok');
    expect(s0.props.layer).toBe('');
  });

  it('skips nodes missing id or type, and drops dangling edges', async () => {
    const mg = await importModelGraph(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/model-graph-bad'));
    expect(mg.nodes).toHaveLength(1);
    expect(mg.edges).toHaveLength(0);
    expect(mg.report.skipped.some((s) => s.reason === 'missing id')).toBe(true);
    expect(mg.report.skipped.some((s) => s.reason === 'dangling edge')).toBe(true);
  });

  it('rejects with a clear error when model-graph.json is absent', async () => {
    await expect(importModelGraph('/no/such/dir')).rejects.toThrow(/cannot read model-graph.json/);
  });
});
