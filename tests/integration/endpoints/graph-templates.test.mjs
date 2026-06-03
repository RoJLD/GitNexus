import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:4173';

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
    expect(graph.schema_type).toBe('research-artifacts');
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(graph.nodes.length).toBe(report.nodes);

    const list = await fetch(`${BASE}/graph/research`);
    expect((await list.json()).graphs.some((g) => g.name === name)).toBe(true);
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
});
