import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

const BASE = `http://localhost:${process.env.TEST_WEB_PORT || 4173}`;

// The sidecar publishes no host port on the test stack: reach it from the web container.
const sidecarPost = (name, action, body) => execFileSync('docker', [
  'exec', 'gitnexus-web-test', 'curl', '-fsS', '-X', 'POST', '-H', 'Content-Type: application/json',
  '-d', JSON.stringify(body), `http://gitnexus-graphs-test:4749/g/${name}/${action}`,
], { encoding: 'utf8' });

describe('graph-templates routes', () => {
  it('lists the built-in research-artifacts template', async () => {
    const res = await fetch(`${BASE}/graph/templates`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates.map((t) => t.id)).toContain('research-artifacts');
  });

  it('lists the P1 academic-literature import + imports-deps lens templates', async () => {
    const body = await (await fetch(`${BASE}/graph/templates`)).json();
    const byId = Object.fromEntries(body.templates.map((t) => [t.id, t]));
    expect(byId['academic-literature']?.kind).toBe('import');
    expect(byId['imports-deps']?.kind).toBe('lens');
  });

  it('scaffolds, imports, and serves a research graph end to end', async () => {
    const name = 'it-research';
    const scaffold = await fetch(`${BASE}/graph/scaffold`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'research-artifacts', name, source: 'sample-repo' }),
    });
    expect(scaffold.status).toBe(201);

    const imp = await fetch(`${BASE}/graph/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    expect(imp.status).toBe(200);
    const report = (await imp.json()).report;
    expect(typeof report.nodes).toBe('number');

    const get = await fetch(`${BASE}/graph/research/${name}`);
    expect(get.status).toBe(200);
    const graph = await get.json();
    // The render endpoint's contract is { nodes, edges } (see the route doc in
    // docker-server-graph-templates.mjs). schema_type is metadata that lives on
    // the index record, so it is asserted on the /graph/research list below —
    // not on the render payload, which never carried it.
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(graph.nodes.length).toBe(report.nodes);

    const list = await (await fetch(`${BASE}/graph/research`)).json();
    const record = list.graphs.find((g) => g.name === name);
    expect(record).toBeDefined();
    expect(record.schema_type).toBe('research-artifacts');
  });

  it('rejects an unknown template', async () => {
    const res = await fetch(`${BASE}/graph/scaffold`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'nope', name: 'x', source: 'sample-repo' }),
    });
    expect(res.status).toBe(400);
  });

  it('scaffolds, imports, and serves a multi-table academic-literature graph', async () => {
    const name = 'it-academic';
    const scaffold = await fetch(`${BASE}/graph/scaffold`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'academic-literature', name, source: 'academic-corpus' }),
    });
    expect(scaffold.status).toBe(201);

    const imp = await fetch(`${BASE}/graph/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    expect(imp.status).toBe(200);
    const report = (await imp.json()).report;
    expect(report.nodes).toBe(8);   // 3 Paper + 3 Author + 2 Topic
    expect(report.edges).toBe(7);   // 4 AUTHORED + 3 ABOUT

    const graph = await (await fetch(`${BASE}/graph/research/${name}`)).json();
    const types = new Set(graph.nodes.map((n) => n.type));
    expect(types.has('Paper')).toBe(true);
    expect(types.has('Author')).toBe(true);
    expect(types.has('Topic')).toBe(true);
  });

  it('scaffolds, imports, and serves a research-graph (generic Entity/Relates)', async () => {
    const name = 'it-research-graph';
    const scaffold = await fetch(`${BASE}/graph/scaffold`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'research-graph', name, source: 'research-graph-corpus' }),
    });
    expect(scaffold.status).toBe(201);
    const imp = await fetch(`${BASE}/graph/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    expect(imp.status).toBe(200);
    const report = (await imp.json()).report;
    expect(report.nodes).toBe(6);
    expect(report.edges).toBe(6);
    const graph = await (await fetch(`${BASE}/graph/research/${name}`)).json();
    const types = new Set(graph.nodes.map((n) => n.type));
    expect(types.has('Hypothesis')).toBe(true);
    expect(types.has('Experiment')).toBe(true);
    expect(graph.edges.some((e) => e.kind === 'validates')).toBe(true);
  });

  it('scaffolds, imports, and serves a model-graph (ModelNode/ModelEdge)', async () => {
    const name = 'it-model-graph';
    const scaffold = await fetch(`${BASE}/graph/scaffold`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'model-graph', name, source: 'model-graph-corpus' }),
    });
    expect(scaffold.status).toBe(201);
    const imp = await fetch(`${BASE}/graph/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    expect(imp.status).toBe(200);
    const report = (await imp.json()).report;
    expect(report.nodes).toBe(4);   // 2 state + 2 observation
    expect(report.edges).toBe(8);   // 4 transition + 4 emission
    expect(report.byType.state).toBe(2);
    const graph = await (await fetch(`${BASE}/graph/research/${name}`)).json();
    expect(graph.nodes.some((n) => n.type === 'state')).toBe(true);
    expect(graph.edges.some((e) => ['transition', 'emission'].includes(e.kind))).toBe(true);
  });

  it('structurally diffs two model-graphs from the same corpus (zero drift)', async () => {
    // `it-model-graph` (the `a` side) is scaffolded + imported by the test
    // above from `model-graph-corpus`. Scaffold + import a second graph
    // (`b`) from the SAME corpus → identical structure → zero drift.
    const name = 'it-model-graph-b';
    const scaffold = await fetch(`${BASE}/graph/scaffold`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'model-graph', name, source: 'model-graph-corpus' }),
    });
    expect(scaffold.status).toBe(201);
    const imp = await fetch(`${BASE}/graph/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    expect(imp.status).toBe(200);

    const res = await fetch(`${BASE}/graph/diff?a=it-model-graph&b=it-model-graph-b`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.drift).toBe(0);   // same corpus → identical graphs
    expect(body.nodes.commonCount).toBe(4); // 2 state + 2 observation
  });

  it('serves a captured activation overlay for a model graph', async () => {
    const name = 'it-model-activations';
    const scaffold = await fetch(`${BASE}/graph/scaffold`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'model-graph', name, source: 'model-graph-corpus' }),
    });
    expect(scaffold.status).toBe(201);
    const imp = await fetch(`${BASE}/graph/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    expect(imp.status).toBe(200);

    const act = await fetch(`${BASE}/graph/activations/${name}`);
    expect(act.status).toBe(200);
    const body = await act.json();
    expect(typeof body.nodes.s0).toBe('number');
    expect(Number.isFinite(body.report.max)).toBe(true);
  });

  // Quant-lab's `export-gitnexus --push` writes straight to the sidecar (create + ingest),
  // never through /graph/scaffold, so the graph had no index record and /graph/list (the
  // UI's graph sidebar) did not show it.
  it('lists a graph pushed straight to the sidecar', async () => {
    sidecarPost('it-pushed', 'create', { ddl: ['CREATE NODE TABLE Item(id STRING, title STRING, PRIMARY KEY(id))'] });
    sidecarPost('it-pushed', 'ingest', { nodes: [{ table: 'Item', props: { id: 'i1', title: 'one' } }], edges: [] });
    const list = await (await fetch(`${BASE}/graph/list`)).json();
    expect(list.graphs.find((g) => g.name === 'it-pushed'))
      .toEqual({ name: 'it-pushed', template: null, schema_type: 'external', source: null, created: null });
    // Scaffolded graphs keep their index record.
    expect(list.graphs.find((g) => g.name === 'it-research')?.schema_type).toBe('research-artifacts');
    const graph = await (await fetch(`${BASE}/graph/research/it-pushed`)).json();
    expect(graph.nodes.map((n) => n.id)).toEqual(['i1']);
  });

  // The sidecar used to create an empty <name>.lbug on the render of an unknown name; with
  // the list now built from the sidecar's graphs, that ghost would show in the sidebar.
  it('answers 404 for an unknown graph without creating it', async () => {
    const res = await fetch(`${BASE}/graph/research/it-never-made`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/graph it-never-made not found/);
    const list = await (await fetch(`${BASE}/graph/list`)).json();
    expect(list.graphs.map((g) => g.name)).not.toContain('it-never-made');
  });
});
