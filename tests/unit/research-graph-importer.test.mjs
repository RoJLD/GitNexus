import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importResearchGraph } from '../../upstream/docker-server-research-graph-importer.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/research-graph');

describe('importResearchGraph', () => {
  it('maps a curated research graph to the generic ingest shape', async () => {
    const rg = await importResearchGraph(FIX);
    expect(rg.nodes).toHaveLength(6);
    expect(rg.edges).toHaveLength(6);
    expect(rg.nodes.every((n) => n.table === 'Entity')).toBe(true);
    expect(rg.edges.every((e) => e.table === 'Relates')).toBe(true);
    const exp001 = rg.nodes.find((n) => n.props.id === 'exp001');
    expect(exp001.props).toMatchObject({ type: 'Experiment', title: 'TradFi link', status: 'active', anchor: 'notes/decisions.md#2026-05-15-exp001' });
    const validates = rg.edges.find((e) => e.props.kind === 'validates');
    expect(validates).toMatchObject({ from: 'v1', to: 'H1' });
    expect(rg.report.byType).toMatchObject({ Hypothesis: 2, Experiment: 2, Verdict: 1, SDR: 1 });
    expect(rg.report.byKind.tests).toBe(2);
    expect(rg.report.nodes).toBe(6);
    expect(rg.report.edges).toBe(6);
  });

  it('drops dangling edges and skips nodes missing an id', async () => {
    const bad = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/research-graph-bad');
    const rg = await importResearchGraph(bad);
    expect(rg.nodes).toHaveLength(1);
    expect(rg.edges).toHaveLength(0);
    expect(rg.report.skipped).toHaveLength(2);
    expect(rg.report.skipped.some((s) => s.reason === 'missing id')).toBe(true);
    expect(rg.report.skipped.some((s) => s.reason === 'dangling edge')).toBe(true);
  });

  it('rejects with a clear error when research-graph.json is absent', async () => {
    await expect(importResearchGraph('/no/such/dir')).rejects.toThrow(/cannot read research-graph.json/);
  });
});
