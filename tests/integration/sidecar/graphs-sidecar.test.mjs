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

  it('errors return JSON 500, server stays up', async () => {
    const r = await fetch(`${BASE}/g/t1/cypher`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'NOT VALID CYPHER' }) });
    expect(r.status).toBe(500);
    const h = await fetch(`${BASE}/health`);
    expect(h.status).toBe(200);
  });
});
