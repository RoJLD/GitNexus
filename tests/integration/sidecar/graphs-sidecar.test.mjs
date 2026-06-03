import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';

const PORT = 4759;
const BASE = `http://localhost:${PORT}`;

beforeAll(() => {
  execSync('docker build -f Dockerfile.graphs -t gnx-graphs-test .', { stdio: 'inherit' });
  execSync('docker rm -f gnx-graphs-test >/dev/null 2>&1 || true', { shell: '/bin/bash' });
  execSync(`docker run -d --name gnx-graphs-test -p ${PORT}:4749 -e GRAPHS_DIR=/tmp/graphs gnx-graphs-test`, { stdio: 'inherit' });
  execSync(`for i in $(seq 1 30); do curl -fsS ${BASE}/health && break; sleep 1; done`, { stdio: 'pipe', shell: '/bin/bash' });
}, 240000);
afterAll(() => { execSync('docker rm -f gnx-graphs-test >/dev/null 2>&1 || true', { shell: '/bin/bash' }); });

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

  it('errors return JSON 500, server stays up', async () => {
    const r = await fetch(`${BASE}/g/t1/cypher`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'NOT VALID CYPHER' }) });
    expect(r.status).toBe(500);
    const h = await fetch(`${BASE}/health`);
    expect(h.status).toBe(200);
  });
});
