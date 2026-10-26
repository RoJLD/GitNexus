import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4759;
const BASE = `http://localhost:${PORT}`;

// Dockerfile.graphs lives at the fork root and `COPY graphs-sidecar/ ./`, so the
// build context MUST be the fork root — not vitest's cwd (tests/), where the
// Dockerfile is absent. Without this the build fails and beforeAll throws,
// killing the whole suite (why it never had a green baseline).
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

// Portable (no `/bin/bash` — which does not exist on Windows, where spawnSync
// threw ENOENT and killed the suite): rm/afterAll swallow errors via try/catch,
// and the health wait is a native fetch poll instead of a bash `for` loop.
beforeAll(async () => {
  execSync('docker build -f Dockerfile.graphs -t gnx-graphs-test .', { stdio: 'inherit', cwd: REPO_ROOT });
  try { execSync('docker rm -f gnx-graphs-test', { stdio: 'ignore' }); } catch { /* not running */ }
  execSync(`docker run -d --name gnx-graphs-test -p ${PORT}:4749 -e GRAPHS_DIR=/tmp/graphs gnx-graphs-test`, { stdio: 'inherit' });
  let up = false;
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) { up = true; break; } } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!up) throw new Error('gnx-graphs-test did not become healthy in 30s');
}, 240000);
afterAll(() => { try { execSync('docker rm -f gnx-graphs-test', { stdio: 'ignore' }); } catch { /* already gone */ } });

// Plant an (empty) pre-migration <name>.kuzu file in the container's GRAPHS_DIR.
const touchLegacyGraph = (name) => execSync(`docker exec gnx-graphs-test touch /tmp/graphs/${name}.kuzu`);
const graphFiles = () => execSync('docker exec gnx-graphs-test ls -a /tmp/graphs', { encoding: 'utf8' }).split(/\s+/);

describe('graphs sidecar', () => {
  it('create -> ingest -> render round-trips a graph', async () => {
    await fetch(`${BASE}/g/t1/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ddl: [
        'CREATE NODE TABLE Artifact(id STRING, type STRING, label STRING, path STRING, stage STRING, PRIMARY KEY(id))',
        'CREATE REL TABLE Link(FROM Artifact TO Artifact, id STRING, kind STRING)',
      ] }) });
    await fetch(`${BASE}/g/t1/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: [
          { table: 'Artifact', props: { id: 'h1', type: 'hypothesis', label: 'H1', path: 'a/h1.md', stage: 'a' } },
          { table: 'Artifact', props: { id: 'r1', type: 'result', label: 'R1', path: 'a/r1.md', stage: 'a' } },
        ],
        edges: [{ table: 'Link', from: 'h1', to: 'r1', props: { id: 'h1->r1', kind: 'validates' } }],
      }) });
    const r = await fetch(`${BASE}/g/t1/render`);
    expect(r.status).toBe(200);
    const g = await r.json();
    expect(g.nodes.length).toBe(2);
    expect(g.edges.length).toBe(1);
    expect(g.edges[0].kind).toBe('validates');
  });

  it('round-trips a multi-table graph (no kind column on edges)', async () => {
    await fetch(`${BASE}/g/acad/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ddl: [
        'CREATE NODE TABLE Paper (id STRING, title STRING, year INT64, path STRING, PRIMARY KEY(id))',
        'CREATE NODE TABLE Author(id STRING, name STRING, PRIMARY KEY(id))',
        'CREATE REL TABLE AUTHORED(FROM Author TO Paper, id STRING)',
      ] }) });
    await fetch(`${BASE}/g/acad/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: [
          { table: 'Paper',  props: { id: 'p1', title: 'Kyle 1985', year: 1985, path: 'kyle.pdf' } },
          { table: 'Author', props: { id: 'a1', name: 'Albert Kyle' } },
        ],
        edges: [{ table: 'AUTHORED', from: 'a1', to: 'p1', props: { id: 'a1->p1' } }],
      }) });
    const g = await (await fetch(`${BASE}/g/acad/render`)).json();
    const paper = g.nodes.find((n) => n.id === 'p1');
    const author = g.nodes.find((n) => n.id === 'a1');
    expect(paper.type).toBe('Paper');
    expect(paper.label).toBe('Kyle 1985');
    expect(author.type).toBe('Author');
    expect(author.label).toBe('Albert Kyle');
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ source: 'a1', target: 'p1', kind: 'AUTHORED' });
  });

  // Quant-lab's `export-gitnexus --mode typed` shape: a node table per type, edges
  // carrying from_table/to_table. The unlabeled endpoint match is a binder error (Kùzu
  // and LadybugDB alike) once a REL table spans several FROM/TO pairs (relies_on below);
  // the labeled one also tells apart two nodes that share an id across tables.
  it('ingests a typed graph whose edges carry from_table/to_table', async () => {
    await fetch(`${BASE}/g/typed/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ddl: [
        'CREATE NODE TABLE WorkItem(id STRING, title STRING, PRIMARY KEY(id))',
        'CREATE NODE TABLE Spec(id STRING, title STRING, PRIMARY KEY(id))',
        'CREATE REL TABLE relies_on(FROM WorkItem TO Spec, FROM WorkItem TO WorkItem, id STRING)',
      ] }) });
    const r = await fetch(`${BASE}/g/typed/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: [
          { table: 'WorkItem', props: { id: 'x', title: 'work x' } },
          { table: 'WorkItem', props: { id: 'w2', title: 'work 2' } },
          { table: 'Spec', props: { id: 'x', title: 'spec x' } },
        ],
        edges: [
          { table: 'relies_on', from: 'x', to: 'x', from_table: 'WorkItem', to_table: 'Spec', props: { id: 'x->relies_on->x' } },
          { table: 'relies_on', from: 'w2', to: 'x', from_table: 'WorkItem', to_table: 'WorkItem', props: { id: 'w2->relies_on->x' } },
        ],
      }) });
    expect(r.status).toBe(200);
    const rows = (await (await fetch(`${BASE}/g/typed/cypher`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'MATCH (a)-[r:relies_on]->(b) RETURN r.id AS id, label(a) AS fromT, a.title AS fromTitle, label(b) AS toT, b.title AS toTitle ORDER BY id' }) })).json()).rows;
    expect(rows).toEqual([
      { id: 'w2->relies_on->x', fromT: 'WorkItem', fromTitle: 'work 2', toT: 'WorkItem', toTitle: 'work x' },
      { id: 'x->relies_on->x', fromT: 'WorkItem', fromTitle: 'work x', toT: 'Spec', toTitle: 'spec x' },
    ]);
    const g = await (await fetch(`${BASE}/g/typed/render`)).json();
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(2);
  });

  it('rejects an unsafe table name with 400 before writing anything', async () => {
    const count = async () => (await (await fetch(`${BASE}/g/typed/cypher`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'MATCH (n) RETURN count(n) AS c' }) })).json()).rows[0].c;
    const before = await count();
    const r = await fetch(`${BASE}/g/typed/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: [{ table: 'WorkItem', props: { id: 'w3', title: 'never written' } }],
        edges: [{ table: 'relies_on', from: 'w3', to: 'x', from_table: 'WorkItem', to_table: 'Spec) DETACH DELETE (b', props: { id: 'bad' } }],
      }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/invalid to_table/);
    expect(await count()).toBe(before);
  });

  // A graph built before the LadybugDB migration is a <name>.kuzu file the new engine
  // cannot open. Reads refuse it with 409 (rather than silently opening an empty
  // <name>.lbug); create rebuilds it, and GET /g lists only LadybugDB graphs.
  it('refuses a graph left in the Kùzu format with 409 until it is re-created', async () => {
    touchLegacyGraph('legacy');
    const r = await fetch(`${BASE}/g/legacy/render`);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/re-create and re-import/);
    expect((await (await fetch(`${BASE}/g`)).json()).graphs).not.toContain('legacy');
    const c = await fetch(`${BASE}/g/legacy/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ddl: ['CREATE NODE TABLE Artifact(id STRING, PRIMARY KEY(id))'] }) });
    expect(c.status).toBe(201);
    const g = await fetch(`${BASE}/g/legacy/render`);
    expect(g.status).toBe(200);
    expect(await g.json()).toEqual({ nodes: [], edges: [] });
    expect((await (await fetch(`${BASE}/g`)).json()).graphs).toContain('legacy');
  });

  // Opening a DB creates its file: a render of an unknown name used to leave an empty
  // <name>.lbug behind, listed by GET /g from then on, and answer 500 "Binder exception".
  it('answers 404 for a graph that was never created, and creates nothing', async () => {
    const json = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const render = await fetch(`${BASE}/g/never/render`);
    expect(render.status).toBe(404);
    expect((await render.json()).error).toBe('graph never not found');
    const cypher = await fetch(`${BASE}/g/never/cypher`, { ...json, body: JSON.stringify({ query: 'MATCH (n) RETURN n' }) });
    expect(cypher.status).toBe(404);
    const ingest = await fetch(`${BASE}/g/never/ingest`, { ...json,
      body: JSON.stringify({ nodes: [{ table: 'Artifact', props: { id: 'n1' } }], edges: [] }) });
    expect(ingest.status).toBe(404);
    expect(graphFiles().filter((f) => f.startsWith('never'))).toEqual([]);
    expect((await (await fetch(`${BASE}/g`)).json()).graphs).not.toContain('never');
  });

  // Each request opens the graph's DB file; two at once used to collide on its lock.
  it('serves concurrent requests on one graph', async () => {
    const rs = await Promise.all([
      ...Array.from({ length: 5 }, () => fetch(`${BASE}/g/t1/render`)),
      fetch(`${BASE}/g/t1/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: [{ table: 'Artifact', props: { id: 'c1', type: 't', label: 'C1', path: '', stage: '' } }], edges: [] }) }),
    ]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it('errors return JSON 500, server stays up', async () => {
    const r = await fetch(`${BASE}/g/t1/cypher`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'NOT VALID CYPHER' }) });
    expect(r.status).toBe(500);
    const h = await fetch(`${BASE}/health`);
    expect(h.status).toBe(200);
  });
});
