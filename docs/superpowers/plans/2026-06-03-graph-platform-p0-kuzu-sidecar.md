# Graph Platform P0 — Kùzu sidecar + Template SDK — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a cohabitation-safe Kùzu sidecar that owns template graphs as real Kùzu DBs, formalize the Template SDK (import + lens kinds), and migrate `research-artifacts` from JSON onto Kùzu end-to-end — proving the platform foundation.

**Architecture:** A new Compose service `gitnexus-graphs` (our own `Dockerfile.graphs`, Node + the public `kuzu` binding) owns `/data/gitnexus/graphs/<name>.kuzu` and exposes a tiny HTTP API (create/ingest/cypher/render/list), modeled on the existing `wiki-worker.mjs` sidecar. The web container's `docker-server-graph-templates.mjs` routes stop storing JSON and instead **proxy to the sidecar**. The importer still runs in the web container (walks `/data/projects`, emits `{nodes,edges}`) and feeds the sidecar. The frontend renders via the existing single-graph Sigma canvas. **Zero upstream-backend patches** → cohabitation-safe.

**Tech Stack:** Node 22 ESM, public `kuzu` npm binding (Cypher property-graph), `node:http` (sidecar, zero web-framework), Docker Compose, the fork's patch model (`patches/*.diff` + `cohabit drift` + CI `build-gate`), vitest integration tests.

**Commit identity:** `roblastar@live.fr` / `Robin DENIS`. End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Spec:** `docs/superpowers/specs/2026-06-03-graph-platform-p0-kuzu-sidecar-design.md`.

---

## Kùzu API reference (public `kuzu` npm — used throughout)

Modeled on the upstream LadybugDB usage (`upstream/gitnexus/src/core/lbug/lbug-adapter.ts`), public-binding form:

```javascript
import kuzu from 'kuzu';
const db = new kuzu.Database('/data/gitnexus/graphs/foo.kuzu'); // creates dir if absent
const conn = new kuzu.Connection(db);
await conn.query('CREATE NODE TABLE Artifact(id STRING, label STRING, PRIMARY KEY(id))');
const res = await conn.query('MATCH (n:Artifact) RETURN n.id AS id, n.label AS label');
const rows = await res.getAll(); // [{ id, label }, ...]
res.close();
```

> **Task 1 includes a smoke** that pins the exact `kuzu` version and confirms this API shape before any other sidecar code is written — if the installed version diverges (e.g. `db.connect()` vs `new kuzu.Connection(db)`), fix the helper in Task 1 and the rest follows.

---

## File structure

**Create (sidecar — new top-level `graphs-sidecar/` dir, our code, NOT in `upstream/`):**
- `graphs-sidecar/package.json` — `{ type: module, dependencies: { kuzu: "<pinned>" } }`.
- `graphs-sidecar/server.mjs` — the HTTP sidecar (create/ingest/cypher/render/list/health).
- `graphs-sidecar/kuzu-store.mjs` — thin Kùzu wrapper (open/DDL/ingest/query/render).
- `Dockerfile.graphs` — Node 22 + `npm ci` + run `graphs-sidecar/server.mjs`.

**Modify (web container handlers — `upstream/`, already ours/additive):**
- `upstream/docker-server-graph-templates-core.mjs` — add `kind` + `ddl` to descriptors; replace JSON store with a thin index (name→template/source) + sidecar-client helper.
- `upstream/docker-server-graph-templates.mjs` — routes proxy to the sidecar.
- `upstream/docker-server-research-fs-importer.mjs` — unchanged shape (already returns `{nodes,edges,report}`); confirmed compatible.

**Modify (infra):**
- `docker-compose.yml` — add `gitnexus-graphs` service + `GRAPHS_URL` env on `gitnexus-web`.
- `docker-compose.test.yml` — same, for integration tests.
- `.github/workflows/test.yml` — `build-gate` already runs `docker compose build` (builds all services incl. the new sidecar) — no change needed; verify.

**Create (tests):**
- `tests/integration/sidecar/graphs-sidecar.test.mjs` — build/run sidecar, curl create→ingest→cypher→render.
- `tests/integration/endpoints/graph-templates-kuzu.test.mjs` — scaffold→import→get against the full stack (sidecar-backed).

**Modify (docs):** `ROADMAP.md` (P0 → ✅ once shipped), `INVENTORY.md` (sidecar + revised routes).

---

## Milestone A — The Kùzu sidecar service

### Task A1: Kùzu store wrapper + version smoke

**Files:**
- Create: `graphs-sidecar/package.json`, `graphs-sidecar/kuzu-store.mjs`

- [ ] **Step 1: Create `graphs-sidecar/package.json`**

```json
{
  "name": "gitnexus-graphs-sidecar",
  "private": true,
  "type": "module",
  "dependencies": {
    "kuzu": "0.6.1"
  }
}
```

> Pin to a concrete published version. `0.6.1` is a placeholder for "the latest stable kuzu Node release at implementation time" — Step 2 confirms install + API.

- [ ] **Step 2: Install + smoke the Kùzu API**

Run (in a Node-22 context, e.g. the sidecar dir):
`cd graphs-sidecar && npm install && node -e "import('kuzu').then(async k=>{const kuzu=k.default||k;const db=new kuzu.Database('/tmp/_smoke.kuzu');const c=new kuzu.Connection(db);await c.query('CREATE NODE TABLE T(id STRING, PRIMARY KEY(id))');await c.query(\"CREATE (:T {id:'a'})\");const r=await c.query('MATCH (n:T) RETURN n.id AS id');console.log(JSON.stringify(await r.getAll()));})"`
Expected: prints `[{"id":"a"}]`. If the import/connection shape differs, note the exact working form — `kuzu-store.mjs` (Step 3) must use whatever Step 2 proved.

- [ ] **Step 3: Write `graphs-sidecar/kuzu-store.mjs`**

```javascript
/**
 * Thin Kùzu wrapper for the graphs sidecar. One Kùzu DB per template graph,
 * under GRAPHS_DIR/<name>.kuzu. Connections are opened per-call (P0 simplicity;
 * a pool is a later optimization).
 */
import kuzuPkg from 'kuzu';
import { join } from 'node:path';

const kuzu = kuzuPkg.default || kuzuPkg;
export const GRAPHS_DIR = process.env.GRAPHS_DIR || '/data/gitnexus/graphs';

function dbPath(name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`invalid graph name: ${name}`);
  return join(GRAPHS_DIR, `${name}.kuzu`);
}

function withConn(name, fn) {
  const db = new kuzu.Database(dbPath(name));
  const conn = new kuzu.Connection(db);
  return Promise.resolve(fn(conn)).finally(() => {
    try { conn.close?.(); } catch { /* */ }
    try { db.close?.(); } catch { /* */ }
  });
}

/** Apply DDL statements (CREATE NODE/REL TABLE). Idempotent: "already exists" is swallowed. */
export async function createGraph(name, ddl) {
  await withConn(name, async (conn) => {
    for (const stmt of ddl) {
      try {
        const r = await conn.query(stmt);
        r.close?.();
      } catch (e) {
        if (!/already exists/i.test(String(e && e.message))) throw e;
      }
    }
  });
  return { name, created: true };
}

/** Ingest nodes + edges. Nodes: [{table, props}]; edges: [{table, from, to, props}]. */
export async function ingest(name, nodes, edges) {
  await withConn(name, async (conn) => {
    for (const n of nodes || []) {
      const keys = Object.keys(n.props);
      const params = keys.map((k) => `$${k}`).join(', ');
      const cols = keys.join(', ');
      const r = await conn.query(
        `MERGE (x:${n.table} {id: $id}) SET x += {${keys.filter((k) => k !== 'id').map((k) => `${k}: $${k}`).join(', ')}}`,
        n.props,
      );
      r.close?.();
      void params; void cols;
    }
    for (const e of edges || []) {
      const r = await conn.query(
        `MATCH (a {id: $from}), (b {id: $to}) MERGE (a)-[r:${e.table} {id: $id}]->(b) SET r += $props`,
        { from: e.from, to: e.to, id: e.props?.id ?? `${e.from}->${e.to}`, props: e.props || {} },
      );
      r.close?.();
    }
  });
  return { nodes: (nodes || []).length, edges: (edges || []).length };
}

/** Run a read Cypher query, return rows. */
export async function cypher(name, query, params = {}) {
  return withConn(name, async (conn) => {
    const r = await conn.query(query, params);
    const rows = await r.getAll();
    r.close?.();
    return rows;
  });
}

/** Default render projection: all nodes + all edges as {nodes,edges}. */
export async function render(name) {
  const nodes = await cypher(name, 'MATCH (n) RETURN n.id AS id, n.type AS type, n.label AS label, n.path AS path, n.stage AS stage');
  const edges = await cypher(name, 'MATCH (a)-[r]->(b) RETURN a.id AS source, b.id AS target, r.kind AS kind, r.id AS id');
  return { nodes, edges };
}
```

- [ ] **Step 4: Commit**

```bash
git add graphs-sidecar/package.json graphs-sidecar/kuzu-store.mjs
git commit -m "feat(graphs-sidecar): Kùzu store wrapper (create/ingest/cypher/render)"
```

> ⚠️ `graphs-sidecar/` is a NEW top-level dir, NOT under `upstream/` — so it is **tracked normally** (no patch/diff serialization needed). This is intentional: the sidecar is our code, not an upstream modification.

### Task A2: Sidecar HTTP server

**Files:**
- Create: `graphs-sidecar/server.mjs`

- [ ] **Step 1: Write the server** (modeled on `wiki-worker.mjs` — `node:http`, JSON helper, body reader):

```javascript
/**
 * Graphs sidecar HTTP API. Owns template graphs as Kùzu DBs under GRAPHS_DIR.
 * Internal-only (compose network); the gitnexus-web container proxies to it.
 *   POST /g/:name/create   {ddl:[...]}            -> {name, created}
 *   POST /g/:name/ingest   {nodes:[...], edges:[...]} -> {nodes, edges}
 *   POST /g/:name/cypher   {query, params?}       -> {rows}
 *   GET  /g/:name/render                          -> {nodes, edges}
 *   GET  /g                                        -> {graphs:[name,...]}
 *   GET  /health                                   -> {ok:true}
 */
import { createServer } from 'node:http';
import { mkdir, readdir } from 'node:fs/promises';
import { createGraph, ingest, cypher, render, GRAPHS_DIR } from './kuzu-store.mjs';

const PORT = Number(process.env.GRAPHS_PORT) || 4749;

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  let b = '';
  for await (const chunk of req) b += chunk;
  return b ? JSON.parse(b) : {};
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === '/health' && req.method === 'GET') return send(res, 200, { ok: true });

    if (path === '/g' && req.method === 'GET') {
      let files = [];
      try { files = await readdir(GRAPHS_DIR); } catch { /* none yet */ }
      return send(res, 200, { graphs: files.filter((f) => f.endsWith('.kuzu')).map((f) => f.replace(/\.kuzu$/, '')) });
    }

    const m = path.match(/^\/g\/([^/]+)\/(create|ingest|cypher|render)$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      const action = m[2];
      if (action === 'render' && req.method === 'GET') return send(res, 200, await render(name));
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (action === 'create') return send(res, 201, await createGraph(name, body.ddl || []));
        if (action === 'ingest') return send(res, 200, await ingest(name, body.nodes, body.edges));
        if (action === 'cypher') return send(res, 200, { rows: await cypher(name, body.query, body.params || {}) });
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: String((e && e.message) || e) });
  }
});

await mkdir(GRAPHS_DIR, { recursive: true }).catch(() => {});
server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`[graphs-sidecar] listening on :${PORT} · dir=${GRAPHS_DIR}\n`);
});
```

- [ ] **Step 2: Sanity check** — `node --check graphs-sidecar/server.mjs` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add graphs-sidecar/server.mjs
git commit -m "feat(graphs-sidecar): HTTP API (create/ingest/cypher/render/list)"
```

### Task A3: Dockerfile + integration test (sidecar standalone)

**Files:**
- Create: `Dockerfile.graphs`, `tests/integration/sidecar/graphs-sidecar.test.mjs`

- [ ] **Step 1: Write `Dockerfile.graphs`**

```dockerfile
# Graphs sidecar — Node 22 + Kùzu. Our own image (no upstream coupling).
FROM node:22-bookworm-slim
WORKDIR /app
COPY graphs-sidecar/package.json graphs-sidecar/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY graphs-sidecar/ ./
ENV GRAPHS_DIR=/data/gitnexus/graphs
EXPOSE 4749
CMD ["node", "server.mjs"]
```

- [ ] **Step 2: Write the failing integration test** `tests/integration/sidecar/graphs-sidecar.test.mjs`

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';

const PORT = 4759; // host port to avoid clashes
const BASE = `http://localhost:${PORT}`;

beforeAll(() => {
  execSync('docker build -f Dockerfile.graphs -t gnx-graphs-test .', { stdio: 'inherit' });
  execSync('docker rm -f gnx-graphs-test >/dev/null 2>&1 || true');
  execSync(`docker run -d --name gnx-graphs-test -p ${PORT}:4749 -e GRAPHS_DIR=/tmp/graphs gnx-graphs-test`, { stdio: 'inherit' });
  // wait for health
  execSync(`for i in $(seq 1 30); do curl -fsS ${BASE}/health && break; sleep 1; done`, { stdio: 'pipe', shell: '/bin/bash' });
}, 240000);
afterAll(() => { execSync('docker rm -f gnx-graphs-test >/dev/null 2>&1 || true'); });

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
```

- [ ] **Step 3: Run it**

Run: `cd tests && npx vitest run --config vitest.config.integ.mjs integration/sidecar/graphs-sidecar.test.mjs` (needs Docker + a Node-22 host, or `bash tests/docker-test.sh` is unit-only — run integ on a Node-22 host).
Expected: 2 tests PASS. If the Kùzu `MERGE ... SET x += {...}` syntax errors, adjust `kuzu-store.ingest` to the form Step A1.2 proved (e.g. explicit `CREATE` + property list).

- [ ] **Step 4: Add inventory row** in `tests/README.md` (sidecar section) and **commit**

```bash
git add Dockerfile.graphs tests/integration/sidecar/graphs-sidecar.test.mjs tests/README.md
git commit -m "feat(graphs-sidecar): Dockerfile + integration test (create/ingest/render round-trip)"
```

---

## Milestone B — Template SDK (kinds) + research-artifacts as a Kùzu import template

### Task B1: Add `kind` + `ddl` to the template descriptor + sidecar client

**Files:**
- Modify: `upstream/docker-server-graph-templates-core.mjs`
- Test: `tests/unit/graph-templates-registry.test.mjs` (extend)

- [ ] **Step 1: Extend the failing unit test** — append to `tests/unit/graph-templates-registry.test.mjs`:

```javascript
import { getTemplate as gt2 } from '../../upstream/docker-server-graph-templates-core.mjs';

describe('template kinds + ddl', () => {
  it('research-artifacts is an import template with Kùzu DDL', () => {
    const t = gt2('research-artifacts');
    expect(t.kind).toBe('import');
    expect(Array.isArray(t.ddl)).toBe(true);
    expect(t.ddl.join(' ')).toMatch(/CREATE NODE TABLE Artifact/);
    expect(t.ddl.join(' ')).toMatch(/CREATE REL TABLE Link/);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`kind`/`ddl` undefined):
`cd tests && npx vitest run --config vitest.config.unit.mjs unit/graph-templates-registry.test.mjs`

- [ ] **Step 3: Update the research-artifacts descriptor** in `upstream/docker-server-graph-templates-core.mjs` — change the `registerTemplate({ id: 'research-artifacts', ... })` call to add `kind` + `ddl`:

```javascript
registerTemplate({
  id: 'research-artifacts',
  kind: 'import',
  label: 'Research Artifacts',
  schema_type: 'research-artifacts',
  description:
    'Graph of local research artifacts (notebooks / notes) with derives-from / validates / contradicts links inferred from files + frontmatter.',
  importer: 'research-fs',
  include: ['**/*.ipynb', '**/*.md'],
  exclude: ['.git', 'node_modules', '.gitnexus', '.ipynb_checkpoints'],
  ddl: [
    'CREATE NODE TABLE Artifact(id STRING, type STRING, label STRING, path STRING, stage STRING, PRIMARY KEY(id))',
    'CREATE REL TABLE Link(FROM Artifact TO Artifact, id STRING, kind STRING)',
  ],
  visual: {
    nodeColors: {
      notebook: '#3b82f6', experiment: '#f59e0b', hypothesis: '#a855f7',
      result: '#10b981', dataset: '#14b8a6', note: '#64748b',
    },
  },
});
```

Also update `registerTemplate` to default `kind: 'import'` if absent (back-compat): change the line `registry.set(tpl.id, { exclude: [], include: [], visual: {}, ...tpl });` to `registry.set(tpl.id, { kind: 'import', exclude: [], include: [], visual: {}, ...tpl });`.

- [ ] **Step 4: Run → PASS.** Then add the sidecar client helper to the SAME core module (used by the route in B2/C):

```javascript
const GRAPHS_URL = process.env.GRAPHS_URL || 'http://gitnexus-graphs:4749';

async function graphsFetch(path, init) {
  const res = await fetch(`${GRAPHS_URL}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `graphs sidecar ${res.status}`);
  return body;
}
export async function sidecarCreate(name, ddl) {
  return graphsFetch(`/g/${encodeURIComponent(name)}/create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ddl }),
  });
}
export async function sidecarIngest(name, nodes, edges) {
  return graphsFetch(`/g/${encodeURIComponent(name)}/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes, edges }),
  });
}
export async function sidecarRender(name) {
  return graphsFetch(`/g/${encodeURIComponent(name)}/render`, { method: 'GET' });
}
```

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-graph-templates-core.mjs tests/unit/graph-templates-registry.test.mjs
git commit -m "feat(graph-templates): template kinds (import|lens) + DDL + sidecar client"
```

### Task B2: Map the research importer output to sidecar ingest shape

**Files:**
- Modify: `upstream/docker-server-graph-templates-core.mjs` (add a mapper)
- Test: `tests/unit/research-ingest-map.test.mjs` (new)

The importer returns `{ nodes:[{id,type,label,path,stage}], edges:[{id,source,target,kind}] }`. The sidecar ingest wants `{ nodes:[{table,props}], edges:[{table,from,to,props}] }`. Add a pure mapper.

- [ ] **Step 1: Failing test** `tests/unit/research-ingest-map.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { researchGraphToIngest } from '../../upstream/docker-server-graph-templates-core.mjs';

describe('researchGraphToIngest', () => {
  it('maps ResearchGraph nodes/edges to sidecar ingest shape', () => {
    const rg = {
      nodes: [{ id: 'h1', type: 'hypothesis', label: 'H1', path: 'a/h1.md', stage: 'a' }],
      edges: [{ id: 'h1->r1', source: 'h1', target: 'r1', kind: 'validates' }],
    };
    const out = researchGraphToIngest(rg);
    expect(out.nodes[0]).toEqual({ table: 'Artifact', props: { id: 'h1', type: 'hypothesis', label: 'H1', path: 'a/h1.md', stage: 'a' } });
    expect(out.edges[0]).toEqual({ table: 'Link', from: 'h1', to: 'r1', props: { id: 'h1->r1', kind: 'validates' } });
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — append to `upstream/docker-server-graph-templates-core.mjs`:

```javascript
/** Map a ResearchGraph ({nodes,edges}) to the sidecar ingest shape for the Artifact/Link schema. */
export function researchGraphToIngest(rg) {
  return {
    nodes: (rg.nodes || []).map((n) => ({ table: 'Artifact', props: { id: n.id, type: n.type, label: n.label, path: n.path, stage: n.stage } })),
    edges: (rg.edges || []).map((e) => ({ table: 'Link', from: e.source, to: e.target, props: { id: e.id, kind: e.kind } })),
  };
}
```

- [ ] **Step 4: Run → PASS. Commit**

```bash
git add upstream/docker-server-graph-templates-core.mjs tests/unit/research-ingest-map.test.mjs
git commit -m "feat(graph-templates): map ResearchGraph -> sidecar ingest shape"
```

---

## Milestone C — Web routes proxy to the sidecar

### Task C1: Convert scaffold / import / render routes to sidecar-backed

**Files:**
- Modify: `upstream/docker-server-graph-templates.mjs`

The route keeps a thin index record (name→template/source) on `gitnexus-data` (reuse the existing `writeIndexRecord`/`readIndex`), but graph DATA now lives in the sidecar.

- [ ] **Step 1: Rewrite the handler** `upstream/docker-server-graph-templates.mjs` (replace the JSON `writeGraph`/`readGraph` paths with sidecar calls; keep the index for metadata):

```javascript
/**
 * Graph templates routes (web container) — sidecar-backed (Kùzu).
 *   GET  /graph/templates              -> { templates }
 *   POST /graph/scaffold {templateId,name,source} -> { record }   (creates Kùzu graph via sidecar)
 *   POST /graph/import   {name}        -> { report }              (importer -> sidecar ingest)
 *   GET  /graph/research               -> { graphs }              (index records)
 *   GET  /graph/research/:name         -> { nodes, edges }        (sidecar render)
 */
import {
  listTemplates, getTemplate, sanitizeSource,
  readIndex, writeIndexRecord,
  sidecarCreate, sidecarIngest, sidecarRender, researchGraphToIngest,
} from './docker-server-graph-templates-core.mjs';
import { importResearchFs } from './docker-server-research-fs-importer.mjs';

function sendJson(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
async function readBody(req) { let b = ''; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; }
const IMPORTERS = { 'research-fs': importResearchFs };

export async function handleGraphTemplatesRoute(req, url, res, _opts) {
  const path = url.pathname;

  if (path === '/graph/templates' && req.method === 'GET') { sendJson(res, 200, { templates: listTemplates() }); return true; }

  if (path === '/graph/scaffold' && req.method === 'POST') {
    let body; try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }); return true; }
    const { templateId, name, source } = body;
    const tpl = getTemplate(templateId);
    if (!tpl) { sendJson(res, 400, { error: `unknown template: ${templateId}` }); return true; }
    if (!name || !source) { sendJson(res, 400, { error: 'name and source are required' }); return true; }
    try { sanitizeSource(source); } catch (e) { sendJson(res, 400, { error: e.message }); return true; }
    const record = { name, template: tpl.id, schema_type: tpl.schema_type, source, created: new Date().toISOString() };
    try { await sidecarCreate(name, tpl.ddl || []); await writeIndexRecord(record); }
    catch (e) { sendJson(res, 500, { error: `scaffold failed: ${e.message}` }); return true; }
    sendJson(res, 201, { record });
    return true;
  }

  if (path === '/graph/import' && req.method === 'POST') {
    let body; try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }); return true; }
    const { name } = body;
    const index = await readIndex();
    const record = index.graphs.find((g) => g.name === name);
    if (!record) { sendJson(res, 404, { error: `no scaffolded graph named "${name}"` }); return true; }
    const tpl = getTemplate(record.template);
    const importer = tpl && IMPORTERS[tpl.importer];
    if (!importer) { sendJson(res, 400, { error: `no importer for template ${record.template}` }); return true; }
    let abs; try { abs = sanitizeSource(record.source); } catch (e) { sendJson(res, 400, { error: e.message }); return true; }
    try {
      const rg = await importer(abs, { include: tpl.include, exclude: tpl.exclude });
      const ing = researchGraphToIngest(rg);
      await sidecarIngest(name, ing.nodes, ing.edges);
      sendJson(res, 200, { report: rg.report });
    } catch (e) { sendJson(res, 500, { error: `import failed: ${e.message}` }); return true; }
    return true;
  }

  if (path === '/graph/research' && req.method === 'GET') { sendJson(res, 200, { graphs: (await readIndex()).graphs }); return true; }

  if (path.startsWith('/graph/research/') && req.method === 'GET') {
    const name = decodeURIComponent(path.slice('/graph/research/'.length));
    try { sendJson(res, 200, await sidecarRender(name)); }
    catch (e) { sendJson(res, 404, { error: `graph "${name}" not available: ${e.message}` }); return true; }
    return true;
  }
  return false;
}
```

- [ ] **Step 2: Sanity** — `node --check upstream/docker-server-graph-templates.mjs` → exit 0. (`writeGraph`/`readGraph`/`graphPath` in `-core.mjs` are now unused by the route — leave them; harmless, or remove in a cleanup task.)

- [ ] **Step 3: Commit**

```bash
git add upstream/docker-server-graph-templates.mjs
git commit -m "feat(graph-templates): routes proxy to Kùzu sidecar (scaffold/import/render)"
```

---

## Milestone D — Frontend render via the sidecar

### Task D1: `/graph/research/:name` returns `{nodes,edges}` → existing adapter renders it

The sidecar `render` returns `{nodes:[{id,type,label,path,stage}], edges:[{source,target,kind,id}]}` — **exactly the `ResearchGraph` shape** the existing `researchGraphToGraphology` (Stage 1) consumes (minus `schema_type`, which the adapter tolerates). So **no frontend code change is required** beyond confirming the existing `getResearchGraph` + `researchGraphToGraphology` path works against the new payload.

**Files:**
- Test: `tests/unit/research-graph-adapter.test.mjs` (extend with the sidecar-shaped payload)

- [ ] **Step 1: Add a test** asserting the adapter handles the sidecar render shape — append:

```javascript
describe('adapter on sidecar render payload', () => {
  it('renders {nodes,edges} from the sidecar (no schema_type field)', () => {
    const payload = {
      nodes: [{ id: 'h1', type: 'hypothesis', label: 'H1', path: 'a/h1.md', stage: 'a' }],
      edges: [{ source: 'h1', target: 'h1b', kind: 'validates', id: 'e1' }],
    };
    // adapter is defensive: missing edge endpoint is skipped, node colored by type
    const g = researchGraphToGraphology(payload);
    expect(g.order).toBe(1);
    expect(g.getNodeAttribute('h1', 'color')).toBe('#a855f7');
  });
});
```

- [ ] **Step 2: Run (Node-22 container)** — `bash tests/docker-test.sh unit unit/research-graph-adapter.test.mjs` → PASS. If `edges[].source/target` naming differs from what the adapter expects, add a 1-line normalizer in `research-client.ts::getResearchGraph` (map sidecar fields → ResearchEdge) — show that edit here only if Step 2 fails.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/research-graph-adapter.test.mjs
git commit -m "test(graph-templates): adapter handles sidecar render payload"
```

---

## Milestone E — Compose wiring, CI, patches, full verification

### Task E1: Add the `gitnexus-graphs` service to both compose files

**Files:**
- Modify: `docker-compose.yml`, `docker-compose.test.yml`

- [ ] **Step 1: Add the service to `docker-compose.yml`** (after the `gitnexus-web` service, before `volumes:`):

```yaml
  # Graph-templates Kùzu sidecar (our image, no upstream coupling). Owns
  # /data/gitnexus/graphs/<name>.kuzu. Internal-only; the web container proxies.
  gitnexus-graphs:
    build:
      context: .
      dockerfile: Dockerfile.graphs
    image: gitnexus-graphs:local
    container_name: gitnexus-graphs
    environment:
      GRAPHS_DIR: /data/gitnexus/graphs
    volumes:
      - gitnexus-data:/data/gitnexus
    restart: unless-stopped
```

And add `GRAPHS_URL` to the `gitnexus-web` service `environment:` (add an `environment:` block — the web service currently has none):

```yaml
    environment:
      GRAPHS_URL: http://gitnexus-graphs:4749
```

- [ ] **Step 2: Mirror in `docker-compose.test.yml`** — add the same `gitnexus-graphs` service (image `gitnexus-graphs-test:local`) and `GRAPHS_URL: http://gitnexus-graphs:4749` to `gitnexus-web-test`'s environment.

- [ ] **Step 3: Build the full stack** (verifies the sidecar image + wiring):

Run: `docker compose -f docker-compose.test.yml build`
Expected: all 3 images build (gitnexus-server-test, gitnexus-web-test, gitnexus-graphs-test).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker-compose.test.yml
git commit -m "feat(graph-platform): wire gitnexus-graphs sidecar into compose (+ GRAPHS_URL)"
```

### Task E2: Full-stack integration test (sidecar-backed scaffold→import→get)

**Files:**
- Create: `tests/integration/endpoints/graph-templates-kuzu.test.mjs`

- [ ] **Step 1: Write the test** (mirrors the Stage-1 endpoint test; now graph data is in Kùzu via the sidecar):

```javascript
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:4173';

describe('graph-templates (Kùzu sidecar-backed)', () => {
  it('scaffolds, imports, and renders from Kùzu end to end', async () => {
    const name = 'it-kuzu';
    const sc = await fetch(`${BASE}/graph/scaffold`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'research-artifacts', name, source: 'sample-repo' }) });
    expect(sc.status).toBe(201);
    const imp = await fetch(`${BASE}/graph/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    expect(imp.status).toBe(200);
    expect(typeof (await imp.json()).report.nodes).toBe('number');
    const get = await fetch(`${BASE}/graph/research/${name}`);
    expect(get.status).toBe(200);
    const g = await get.json();
    expect(Array.isArray(g.nodes)).toBe(true);
    expect(g.nodes.length).toBeGreaterThan(0); // sample-repo has .md files
  });
});
```

- [ ] **Step 2: Run** (full test stack, Node-22 host): `cd tests && npx vitest run --config vitest.config.integ.mjs integration/endpoints/graph-templates-kuzu.test.mjs` → PASS.

- [ ] **Step 3: Inventory row + commit**

```bash
git add tests/integration/endpoints/graph-templates-kuzu.test.mjs tests/README.md
git commit -m "test(graph-platform): full-stack scaffold->import->render via Kùzu sidecar"
```

### Task E3: Patch regen + drift + CI build-gate + docs

**Files:**
- Modify: `patches/additive-files.diff`, `patches/inplace-edits.diff`, `patches/upstream-all.diff`, `ROADMAP.md`, `INVENTORY.md`

- [ ] **Step 1: Regenerate patches** (the `upstream/` edits to the 2 graph-templates files):

```bash
cd upstream && git add -N . && git diff HEAD --diff-filter=A > ../patches/additive-files.diff && git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
```

- [ ] **Step 2: Drift gates GREEN**

Run: `node scripts/check-patch-drift.mjs` → exit 0; `node ../fork-cohabitation/bin/cohabit.mjs drift gitnexus` → exit 0.

- [ ] **Step 3: Confirm CI build-gate covers the sidecar** — the `build-gate` job runs `docker compose -f docker-compose.test.yml build`, which now builds `gitnexus-graphs-test` too. No workflow edit needed; confirm by reading `.github/workflows/test.yml`.

- [ ] **Step 4: Docs** — flip P0 to ✅ in `ROADMAP.md` (Graph Platform section) and add the sidecar + revised routes to `INVENTORY.md`.

- [ ] **Step 5: Commit**

```bash
git add patches/additive-files.diff patches/inplace-edits.diff patches/upstream-all.diff ROADMAP.md INVENTORY.md
git commit -m "chore(graph-platform): regenerate patches + drift green + P0 docs"
```

---

## Self-Review

**1. Spec coverage:** §3.1 sidecar → A1-A3 + E1. §3.2 SDK (import/lens kinds) → B1 (kind+ddl; lens descriptor allowed by the optional-field shape, first lens in P1 per spec). §3.3 wiring (routes proxy) → C1; viewer (reuse canvas) → D1. §3.4 cohabitation (new image, zero upstream patch) → A1 note + E1; build-gate → E3; drift → E3. §5 scope (research-artifacts migrated, single-graph viewer) → B/C/D. §6 open Qs: binding (kuzu public) → A1; lens-on-ASTKG deferred → not in plan (P1, correct); packaging (separate container) → A3/E1; render default projection → A2/kuzu-store.render. No gaps.

**2. Placeholder scan:** every code step has complete code; the one genuine unknown (exact `kuzu` API/version) is gated by the A1.2 smoke that proves the form before downstream code depends on it — explicitly flagged, not a silent TODO. The B2/D2 "adjust if Step fails" notes are contingency guidance after a concrete provided implementation, not placeholders.

**3. Type consistency:** sidecar ingest shape `{table, props}` / `{table, from, to, props}` (A1 `ingest`, A2 server, B2 `researchGraphToIngest`) consistent. Render shape `{nodes:[{id,type,label,path,stage}], edges:[{source,target,kind,id}]}` (A1 `render`, D1 test, C1 route) consistent with the Stage-1 `ResearchGraph`/adapter. `sidecarCreate/Ingest/Render` (B1) used verbatim in C1. `GRAPHS_URL`/`GRAPHS_DIR`/`GRAPHS_PORT` consistent across server/client/compose. Consistent.

---

## Notes for the executor
- **`graphs-sidecar/` is tracked normally** (new top-level dir, our code) — NO patch serialization. Only the 2 `upstream/docker-server-graph-templates*.mjs` edits go through patch regen (E3).
- **Integration tests need a Node-22 host** (the harness integ mode is fragile docker-in-docker on Windows) + Docker up. Unit tests run via `bash tests/docker-test.sh unit`.
- **Rebuild the live stack** (`docker compose build && docker compose up -d`) after merge so the running deployment gains the sidecar.
- **Cohabitation:** the sidecar adds zero upstream-backend surface; `cohabit drift` must stay green (E2/E3).
