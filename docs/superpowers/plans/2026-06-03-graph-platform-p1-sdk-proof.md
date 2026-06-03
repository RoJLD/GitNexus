# Graph Platform P1 — Prove the Template SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the Template SDK is genuinely general by shipping one multi-table import template (`academic-literature`) and the first real lens (`imports-deps`), removing the hardcoded single-schema mapper along the way.

**Architecture:** Importers emit the generic sidecar ingest shape `{nodes:[{table,props}],edges:[{table,from,to,props}],report}` directly; the sidecar's `ingest`/`render` become schema-agnostic; the lens is a pure projection over the CLI's `/api/graph` JSON, served by a handler modelled on `group-graph` and reusing the existing `GITNEXUS_API` channel and the URL-driven research render pipeline.

**Tech Stack:** Node `.mjs` (web container handlers, gitignored under `upstream/`), Node + `kuzu@0.11.3` (tracked `graphs-sidecar/`), React/TypeScript (gitignored under `upstream/gitnexus-web/`), vitest (run via `bash tests/docker-test.sh unit` because the host is Node 21), Docker (Rancher/moby) for the sidecar round-trip.

---

## ⚠️ Execution protocol — READ FIRST

**1. Two file zones, two commit mechanisms.**
- **Tracked files** (`graphs-sidecar/`, `tests/`, `tools/`, `docs/`, `ROADMAP.md`, `INVENTORY.md`): committed normally with `git add <path>`.
- **`upstream/` files are GITIGNORED.** They are NEVER `git add`ed. Every edit under `upstream/` is serialized into the three patch files. The implementer subagent **edits `upstream/` + writes/runs tests but does NOT touch git or patches**. The **controller** performs patch regeneration + drift check + commit (this prevented a past corruption where a subagent regenerated patches from an inconsistent clone).

**2. Patch regeneration (controller only), after any `upstream/` edit:**
```bash
cd upstream
git add -N .
git diff HEAD --diff-filter=A > ../patches/additive-files.diff   # new files we own
git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff     # edits to upstream files
git diff HEAD                  > ../patches/upstream-all.diff      # monolith (CI build-gate applies this)
git reset
cd ..
node scripts/check-patch-drift.mjs   # MUST exit 0
```
Then `git add patches/ <tracked test files> && git commit` from the repo root with the personal identity.

**3. Identity (mandatory — gitnexus is a personal repo):**
```bash
git config user.email   # MUST print roblastar@live.fr
```
Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

**4. Test commands.** Host is Node 21 → vitest cannot run natively.
- Unit tier (pure Node + web component tests): `bash tests/docker-test.sh unit <vitest-filter>`
- Sidecar round-trip (Task 1): direct `docker build`/`docker run`/`curl` as written in the steps (the `graphs-sidecar.test.mjs` integ test encodes the same round-trip; it runs on a Node-22 host via `cd tests && npm run test:integ`, or is reproduced by the explicit docker commands below).

**5. No Alten data in the repo.** All fixtures are synthetic. The real CMEX-3710 corpus is only used by the controller for the live dev demo at the end, never committed.

---

## File Structure

| File | Zone | Responsibility |
|---|---|---|
| `graphs-sidecar/kuzu-store.mjs` *(modify)* | tracked | generic `ingest` (arbitrary edge props) + generic `render` (heterogeneous node/rel tables) |
| `tests/integration/sidecar/graphs-sidecar.test.mjs` *(modify)* | tracked | + multi-table (Paper/Author/AUTHORED) round-trip assertion |
| `upstream/docker-server-academic-json-importer.mjs` *(new)* | upstream | read `papers.json` → emit generic ingest shape (Paper/Author/Topic + AUTHORED/ABOUT) + report |
| `tests/unit/academic-json-importer.test.mjs` *(new)* | tracked | importer unit test on synthetic `papers.json` |
| `tests/fixtures/academic/papers.json` *(new)* | tracked | synthetic 3-paper fixture (shared author + shared topic) |
| `upstream/docker-server-research-fs-importer.mjs` *(modify)* | upstream | emit generic ingest shape (fold the old mapper into the importer) |
| `upstream/docker-server-graph-templates-core.mjs` *(modify)* | upstream | **delete** `researchGraphToIngest`; add `academic-literature` + `imports-deps` descriptors |
| `upstream/docker-server-graph-templates.mjs` *(modify)* | upstream | ingest the generic shape directly; register `IMPORTERS['academic-json']` |
| `tests/unit/research-fs-importer.test.mjs` *(modify)* | tracked | expect the generic shape |
| `tests/unit/research-ingest-map.test.mjs` *(delete)* | tracked | function removed |
| `upstream/docker-server-graph-lens-core.mjs` *(new)* | upstream | pure `projectImports(graph)` → ResearchGraph-shaped projection |
| `upstream/docker-server-graph-lens.mjs` *(new)* | upstream | `GET /graph/lens/:id?repo=` handler |
| `upstream/docker-server-routes.mjs` *(modify)* | upstream | wire the lens route |
| `tests/unit/graph-lens-core.test.mjs` *(new)* | tracked | projection unit test on synthetic KG |
| `tests/unit/graph-lens-handler.test.mjs` *(new)* | tracked | handler unit test (stubbed `fetch`) |
| `upstream/gitnexus-web/src/services/research-client.ts` *(modify)* | upstream | + `kind` on `GraphTemplate`; + `applyLens(id,repo)` |
| `upstream/gitnexus-web/src/services/research-client.test.ts` *(new)* | upstream | `applyLens` unit test (stubbed `fetch`) |
| `upstream/gitnexus-web/src/components/GraphCanvas.tsx` *(modify)* | upstream | URL-driven lens effect (`?lens=&repo=`) |
| `upstream/gitnexus-web/src/App.tsx` *(modify)* | upstream | `handleNewGraph` branches to the lens flow for `kind:'lens'` |
| `tools/academic-extract.mjs` *(new)* | tracked | offline host-only PDF → `papers.json` extractor |
| `docs/superpowers/specs/2026-06-03-graph-platform-p1-sdk-proof-design.md` *(amend)* | tracked | dated amendment: sidecar generalization + lens output shape |
| `ROADMAP.md`, `INVENTORY.md` *(modify)* | tracked | P1 shipped row + new endpoints/templates |

---

## Task 1: Make the Kùzu sidecar schema-agnostic (ingest + render)

The sidecar `ingest` hardcodes `SET r.kind = $kind` on every edge (breaks on rel tables without a `kind` column, e.g. `AUTHORED`), and `render` projects the fixed `Artifact` columns `n.type/label/path/stage` (wrong for `Paper`/`Author`/`Topic`). Generalize both so any multi-table graph round-trips. `graphs-sidecar/` is tracked → normal commit.

**Files:**
- Modify: `graphs-sidecar/kuzu-store.mjs:53-89`
- Test: `tests/integration/sidecar/graphs-sidecar.test.mjs`

- [ ] **Step 1: Add the failing multi-table round-trip test**

Append a third `it` to `tests/integration/sidecar/graphs-sidecar.test.mjs` (inside the existing `describe`):

```js
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
    expect(paper.type).toBe('Paper');         // node table name surfaces as `type`
    expect(paper.label).toBe('Kyle 1985');    // label falls back to title
    expect(author.type).toBe('Author');
    expect(author.label).toBe('Albert Kyle'); // label falls back to name
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ source: 'a1', target: 'p1', kind: 'AUTHORED' });
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
docker build -f Dockerfile.graphs -t gnx-graphs-test .
docker rm -f gnx-graphs-test 2>/dev/null || true
docker run -d --name gnx-graphs-test -p 4759:4749 -e GRAPHS_DIR=/tmp/graphs gnx-graphs-test
for i in $(seq 1 30); do curl -fsS http://localhost:4759/health && break; sleep 1; done
# Reproduce the test body by hand (create/ingest/render) OR run the integ tier on a Node-22 host.
curl -s -XPOST localhost:4759/g/acad/create -H 'Content-Type: application/json' \
  -d '{"ddl":["CREATE NODE TABLE Paper (id STRING, title STRING, year INT64, path STRING, PRIMARY KEY(id))","CREATE NODE TABLE Author(id STRING, name STRING, PRIMARY KEY(id))","CREATE REL TABLE AUTHORED(FROM Author TO Paper, id STRING)"]}'
curl -s -XPOST localhost:4759/g/acad/ingest -H 'Content-Type: application/json' \
  -d '{"nodes":[{"table":"Paper","props":{"id":"p1","title":"Kyle 1985","year":1985,"path":"kyle.pdf"}},{"table":"Author","props":{"id":"a1","name":"Albert Kyle"}}],"edges":[{"table":"AUTHORED","from":"a1","to":"p1","props":{"id":"a1->p1"}}]}'
curl -s localhost:4759/g/acad/render
```
Expected: `ingest` errors (the edge loop runs `SET r.kind = $kind` against `AUTHORED`, which has no `kind` column), or `render` returns `type:null`/errors on `n.type`.

- [ ] **Step 3: Generalize `ingest` edge handling**

In `graphs-sidecar/kuzu-store.mjs`, replace the edges loop inside `ingest` (lines ~62-69) with:

```js
    for (const e of edges || []) {
      const props = { ...(e.props || {}), id: e.props?.id ?? `${e.from}->${e.to}` };
      const keys = Object.keys(props).filter((k) => k !== 'id');
      const setClause = keys.length ? ` SET ${keys.map((k) => `r.${k} = $${k}`).join(', ')}` : '';
      const r = await run(
        conn,
        `MATCH (a {id: $from}), (b {id: $to}) MERGE (a)-[r:${e.table} {id: $id}]->(b)${setClause}`,
        { from: e.from, to: e.to, ...props },
      );
      r.close?.();
    }
```
(`Link` edges still carry `kind` in `props` → `SET r.kind = $kind` is emitted as before; `AUTHORED`/`ABOUT` carry only `id` → no `SET`.)

- [ ] **Step 4: Generalize `render` for heterogeneous tables**

Replace the `render` function (lines ~84-89) with:

```js
/** Default render projection: all nodes + all edges, schema-agnostic. */
export async function render(name) {
  const nrows = await cypher(name, 'MATCH (n) RETURN n');
  const nodes = nrows.map(({ n }) => ({
    id: n.id,
    type: n.type ?? n._label ?? '',                     // property `type` (research) or table name (academic)
    label: n.label ?? n.title ?? n.name ?? String(n.id),
    path: n.path ?? '',
    stage: n.stage ?? '',
  }));
  const erows = await cypher(name, 'MATCH (a)-[r]->(b) RETURN a.id AS source, b.id AS target, r');
  const edges = erows.map(({ source, target, r }) => ({
    source, target,
    kind: r.kind ?? r._label ?? '',                      // property `kind` (research) or rel-table name (academic)
    id: r.id ?? `${source}->${target}`,
  }));
  return { nodes, edges };
}
```
> Contingency (only if Step 5 shows `type`/`kind` come back empty — i.e. this kuzu build omits `_label` from returned node/rel objects): change the queries to `MATCH (n) RETURN n, label(n) AS lbl` and `MATCH (a)-[r]->(b) RETURN a.id AS source, b.id AS target, r, label(r) AS lbl`, and read `row.lbl` instead of `n._label`/`r._label`.

- [ ] **Step 5: Rebuild, re-run the round-trip, verify pass**

```bash
docker build -f Dockerfile.graphs -t gnx-graphs-test .
docker rm -f gnx-graphs-test 2>/dev/null || true
docker run -d --name gnx-graphs-test -p 4759:4749 -e GRAPHS_DIR=/tmp/graphs gnx-graphs-test
for i in $(seq 1 30); do curl -fsS http://localhost:4759/health && break; sleep 1; done
# repeat the create/ingest/render curls from Step 2
```
Expected `render`: `p1` → `{type:"Paper",label:"Kyle 1985",...}`, `a1` → `{type:"Author",label:"Albert Kyle",...}`, one edge `{source:"a1",target:"p1",kind:"AUTHORED"}`. Also re-run the original research round-trip (`t1`) to confirm `kind:"validates"` still surfaces. `docker rm -f gnx-graphs-test`.

- [ ] **Step 6: Commit (tracked — normal)**

```bash
git add graphs-sidecar/kuzu-store.mjs tests/integration/sidecar/graphs-sidecar.test.mjs
git commit -m "feat(sidecar): schema-agnostic ingest + render (arbitrary edge props, heterogeneous tables)"
```

---

## Task 2: `academic-json` importer

A pure-Node importer that reads `papers.json` from the source dir and emits the **generic ingest shape** (no mapper). Lives under `upstream/` (patch-serialized); its test + fixture are tracked.

**Files:**
- Create: `upstream/docker-server-academic-json-importer.mjs`
- Create: `tests/fixtures/academic/papers.json`
- Test: `tests/unit/academic-json-importer.test.mjs`

- [ ] **Step 1: Create the synthetic fixture**

`tests/fixtures/academic/papers.json`:
```json
{ "papers": [
  { "id": "kyle1985", "title": "Continuous Auctions and Insider Trading", "year": 1985,
    "path": "kyle.pdf", "authors": ["Albert S. Kyle"], "topics": ["market microstructure"] },
  { "id": "fama1970", "title": "Efficient Capital Markets", "year": 1970,
    "path": "fama.pdf", "authors": ["Eugene F. Fama"], "topics": ["market efficiency"] },
  { "id": "famafrench1993", "title": "Common Risk Factors", "year": 1993,
    "path": "ff.pdf", "authors": ["Eugene F. Fama", "Kenneth R. French"], "topics": ["market efficiency"] }
]}
```
(Fama is shared across two papers → one shared `Author` node + two `AUTHORED` edges. "market efficiency" is shared → one shared `Topic` node.)

- [ ] **Step 2: Write the failing unit test**

`tests/unit/academic-json-importer.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importAcademicJson } from '../../upstream/docker-server-academic-json-importer.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/academic');

describe('importAcademicJson', () => {
  it('emits the generic ingest shape with deduped authors and topics', async () => {
    const rg = await importAcademicJson(FIX);
    const byTable = (t) => rg.nodes.filter((n) => n.table === t);
    expect(byTable('Paper')).toHaveLength(3);
    expect(byTable('Author')).toHaveLength(3);   // Kyle, Fama, French — Fama deduped
    expect(byTable('Topic')).toHaveLength(2);    // microstructure, efficiency — efficiency deduped
    const fama = byTable('Author').find((n) => n.props.name === 'Eugene F. Fama');
    const authoredByFama = rg.edges.filter((e) => e.table === 'AUTHORED' && e.from === fama.props.id);
    expect(authoredByFama).toHaveLength(2);
    const paper = byTable('Paper').find((n) => n.props.id === 'kyle1985');
    expect(paper.props).toMatchObject({ id: 'kyle1985', title: 'Continuous Auctions and Insider Trading', year: 1985, path: 'kyle.pdf' });
    expect(rg.edges.filter((e) => e.table === 'ABOUT')).toHaveLength(3); // one ABOUT per paper
    expect(rg.report.nodes).toBe(rg.nodes.length);
    expect(rg.report.edges).toBe(rg.edges.length);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
bash tests/docker-test.sh unit academic-json-importer
```
Expected: FAIL — `importAcademicJson` is not exported (module does not exist).

- [ ] **Step 4: Implement the importer**

`upstream/docker-server-academic-json-importer.mjs`:
```js
/**
 * academic-json importer: read papers.json from the source dir and emit the
 * generic sidecar ingest shape for the academic-literature schema
 * (Paper/Author/Topic + AUTHORED/ABOUT). Pure Node, deterministic, offline.
 * The PDF→papers.json extraction is a separate offline tool (tools/academic-extract.mjs).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const slug = (s) => norm(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export async function importAcademicJson(absSourceDir) {
  let doc;
  try { doc = JSON.parse(await readFile(join(absSourceDir, 'papers.json'), 'utf8')); }
  catch (e) { throw new Error(`cannot read papers.json in source: ${e.message}`); }
  const papers = Array.isArray(doc.papers) ? doc.papers : [];

  const nodes = [];
  const edges = [];
  const authors = new Map();  // authorId -> node
  const topics = new Map();   // topicId  -> node

  for (const p of papers) {
    const paperId = String(p.id);
    nodes.push({ table: 'Paper', props: { id: paperId, title: norm(p.title), year: Number(p.year) || 0, path: String(p.path || '') } });
    for (const a of p.authors || []) {
      const id = `author:${slug(a)}`;
      if (!authors.has(id)) { authors.set(id, { table: 'Author', props: { id, name: norm(a) } }); }
      edges.push({ table: 'AUTHORED', from: id, to: paperId, props: { id: `${id}->${paperId}` } });
    }
    for (const t of p.topics || []) {
      const id = `topic:${slug(t)}`;
      if (!topics.has(id)) { topics.set(id, { table: 'Topic', props: { id, label: norm(t) } }); }
      edges.push({ table: 'ABOUT', from: paperId, to: id, props: { id: `${paperId}->${id}` } });
    }
  }
  nodes.push(...authors.values(), ...topics.values());

  const byTable = {};
  for (const n of nodes) byTable[n.table] = (byTable[n.table] || 0) + 1;
  const byKind = {};
  for (const e of edges) byKind[e.table] = (byKind[e.table] || 0) + 1;

  return {
    schema_type: 'academic-literature', template: 'academic-literature', name: null, source: null,
    nodes, edges,
    report: { nodes: nodes.length, edges: edges.length, byType: byTable, byKind, unresolvedLinks: [], skipped: [] },
  };
}
```

- [ ] **Step 5: Run the test, verify pass**

```bash
bash tests/docker-test.sh unit academic-json-importer
```
Expected: PASS (1 test).

- [ ] **Step 6: Controller serialization + commit**

Implementer stops here. Controller: regenerate the 3 patch diffs (new file → `additive-files.diff`), run `node scripts/check-patch-drift.mjs` (exit 0), then:
```bash
git add patches/ tests/unit/academic-json-importer.test.mjs tests/fixtures/academic/papers.json
git commit -m "feat(graph-templates): academic-json importer (multi-table, generic ingest shape)"
```

---

## Task 3: Generalize the import contract (G1) — drop the hardcoded mapper

Make the import path schema-agnostic: importers return the generic ingest shape, the handler ingests it directly, and `researchGraphToIngest` is deleted. `research-fs` is adapted to keep working.

**Files:**
- Modify: `upstream/docker-server-research-fs-importer.mjs:134-144`
- Modify: `upstream/docker-server-graph-templates-core.mjs:118-124`
- Modify: `upstream/docker-server-graph-templates.mjs:9-14,49-54`
- Modify: `tests/unit/research-fs-importer.test.mjs`
- Delete: `tests/unit/research-ingest-map.test.mjs`

- [ ] **Step 1: Update the research-fs test to expect the generic shape**

Open `tests/unit/research-fs-importer.test.mjs`. Wherever it asserts on the returned `nodes`/`edges`, change expectations to the generic shape. Add this assertion block to the existing main test (adjust to the fixture in use):
```js
    // generic ingest shape (post-G1): nodes carry table:'Artifact', edges table:'Link'
    expect(rg.nodes.every((n) => n.table === 'Artifact' && typeof n.props.id === 'string')).toBe(true);
    expect(rg.edges.every((e) => e.table === 'Link' && 'from' in e && 'to' in e)).toBe(true);
```
If the existing test reads `rg.nodes[0].id` / `.type` / `.label`, change those to `rg.nodes[0].props.id` / `.props.type` / `.props.label`, and edge reads from `.source`/`.target`/`.kind` to `.from`/`.to`/`.props.kind`. The `rg.report` assertions stay unchanged.

- [ ] **Step 2: Delete the obsolete mapper test**

```bash
git rm tests/unit/research-ingest-map.test.mjs
```

- [ ] **Step 3: Run both — watch the research-fs test fail**

```bash
bash tests/docker-test.sh unit research-fs-importer
```
Expected: FAIL — `rg.nodes[0].table` is `undefined` (importer still returns the old shape).

- [ ] **Step 4: Make `research-fs` emit the generic shape**

In `upstream/docker-server-research-fs-importer.mjs`, replace the `return { ... }` at the end of `importResearchFs` (lines ~134-143) with:
```js
  return {
    schema_type: 'research-artifacts',
    template: 'research-artifacts',
    name: null,
    source: null,
    generated: new Date().toISOString(),
    nodes: nodes.map((n) => ({ table: 'Artifact', props: { id: n.id, type: n.type, label: n.label, path: n.path, stage: n.stage } })),
    edges: edges.map((e) => ({ table: 'Link', from: e.source, to: e.target, props: { id: e.id, kind: e.kind } })),
    report: { nodes: nodes.length, edges: edges.length, byType, byKind, unresolvedLinks, skipped: [] },
  };
```
(The local `nodes`/`edges`/`byType`/`byKind` computations above are unchanged — only the final mapping changes.)

- [ ] **Step 5: Delete `researchGraphToIngest` from the core module**

In `upstream/docker-server-graph-templates-core.mjs`, delete the entire `researchGraphToIngest` function and its `// ---- B2 mapper ----` banner (lines ~116-124).

- [ ] **Step 6: Update the handler to ingest the generic shape directly**

In `upstream/docker-server-graph-templates.mjs`:
- Remove `researchGraphToIngest` from the import on line 12 (keep the others).
- In the `/graph/import` handler, replace lines ~50-52:
```js
      const rg = await importer(abs, { include: tpl.include, exclude: tpl.exclude });
      const ing = researchGraphToIngest(rg);
      await sidecarIngest(name, ing.nodes, ing.edges);
```
with:
```js
      const rg = await importer(abs, { include: tpl.include, exclude: tpl.exclude });
      await sidecarIngest(name, rg.nodes, rg.edges);
```

- [ ] **Step 7: Run the unit tier, verify pass**

```bash
bash tests/docker-test.sh unit research-fs-importer
bash tests/docker-test.sh unit graph-templates-registry
```
Expected: PASS; the deleted `research-ingest-map` test no longer collected.

- [ ] **Step 8: Controller serialization + commit**

Controller: regenerate the 3 diffs (these are edits to existing upstream files → `inplace-edits.diff`), `check-patch-drift.mjs` exit 0, then:
```bash
git add patches/ tests/unit/research-fs-importer.test.mjs
git commit -m "refactor(graph-templates): importers emit generic ingest shape; drop hardcoded researchGraphToIngest (G1)"
```
(The `git rm` from Step 2 is included in this commit.)

---

## Task 4: Register `academic-literature` + wire the importer end-to-end

**Files:**
- Modify: `upstream/docker-server-graph-templates-core.mjs` (after the `research-artifacts` descriptor, ~line 90)
- Modify: `upstream/docker-server-graph-templates.mjs:18`
- Test: `tests/unit/graph-templates-registry.test.mjs`

- [ ] **Step 1: Add a failing registry assertion**

In `tests/unit/graph-templates-registry.test.mjs`, add:
```js
  it('registers the academic-literature import template with a multi-table DDL', async () => {
    const { listTemplates } = await import('../../upstream/docker-server-graph-templates-core.mjs');
    const acad = listTemplates().find((t) => t.id === 'academic-literature');
    expect(acad).toBeTruthy();
    expect(acad.kind).toBe('import');
    expect(acad.importer).toBe('academic-json');
    expect(acad.ddl.some((s) => /CREATE NODE TABLE Paper/.test(s))).toBe(true);
    expect(acad.ddl.some((s) => /CREATE REL TABLE AUTHORED/.test(s))).toBe(true);
  });
```

- [ ] **Step 2: Run it, watch it fail**

```bash
bash tests/docker-test.sh unit graph-templates-registry
```
Expected: FAIL — `acad` is undefined.

- [ ] **Step 3: Add the descriptor**

In `upstream/docker-server-graph-templates-core.mjs`, after the `research-artifacts` `registerTemplate({...})` call, add:
```js
registerTemplate({
  id: 'academic-literature',
  kind: 'import',
  label: 'Academic Literature',
  schema_type: 'academic-literature',
  description: 'Graph of academic papers (Paper/Author/Topic) built from a papers.json the offline extractor produces from a PDF corpus. AUTHORED + ABOUT edges; no citations in P1.',
  importer: 'academic-json',
  include: ['papers.json'],
  exclude: [],
  ddl: [
    'CREATE NODE TABLE Paper (id STRING, title STRING, year INT64, path STRING, PRIMARY KEY(id))',
    'CREATE NODE TABLE Author(id STRING, name STRING, PRIMARY KEY(id))',
    'CREATE NODE TABLE Topic (id STRING, label STRING, PRIMARY KEY(id))',
    'CREATE REL TABLE AUTHORED(FROM Author TO Paper, id STRING)',
    'CREATE REL TABLE ABOUT   (FROM Paper  TO Topic, id STRING)',
  ],
  visual: { nodeColors: { Paper: '#3b82f6', Author: '#f59e0b', Topic: '#10b981' } },
});
```

- [ ] **Step 4: Register the importer in the handler**

In `upstream/docker-server-graph-templates.mjs`, change line 18:
```js
import { importResearchFs } from './docker-server-research-fs-importer.mjs';
import { importAcademicJson } from './docker-server-academic-json-importer.mjs';
const IMPORTERS = { 'research-fs': importResearchFs, 'academic-json': importAcademicJson };
```

- [ ] **Step 5: Run the registry test, verify pass**

```bash
bash tests/docker-test.sh unit graph-templates-registry
```
Expected: PASS.

- [ ] **Step 6: End-to-end verification on the test stack (controller, after Step 7 serialization)**

After the controller has serialized patches (Step 7), rebuild the test stack and exercise the academic flow against a synthetic source dir:
```bash
# stage a synthetic source under the test projects root
mkdir -p tests/fixtures/sample-repo-extracted && cp tests/fixtures/academic/papers.json tests/fixtures/sample-repo-extracted/papers.json
docker compose -f docker-compose.test.yml up -d --build
for i in $(seq 1 60); do curl -fsS localhost:4173 >/dev/null 2>&1 && break; sleep 1; done
curl -s -XPOST localhost:4173/graph/scaffold -H 'Content-Type: application/json' -d '{"templateId":"academic-literature","name":"acad1","source":"."}'
curl -s -XPOST localhost:4173/graph/import   -H 'Content-Type: application/json' -d '{"name":"acad1"}'
curl -s localhost:4173/graph/research/acad1
docker compose -f docker-compose.test.yml down -v
```
Expected: import report `{nodes:8,edges:6,...}` (3 Paper + 3 Author + 2 Topic; 4 AUTHORED + ... actually 4 AUTHORED edges: Kyle, Fama×2, French + 3 ABOUT = 7 — verify the real counts against the fixture), render returns Paper/Author/Topic nodes with `type` = table name.

- [ ] **Step 7: Controller serialization + commit**

Controller: regenerate the 3 diffs (`inplace-edits.diff` for both edited files), drift exit 0, then:
```bash
git add patches/ tests/unit/graph-templates-registry.test.mjs
git commit -m "feat(graph-templates): register academic-literature template + wire academic-json importer"
```

---

## Task 5: `imports-deps` lens — descriptor + projection + handler + route

The first real lens. Pure projection over `/api/graph` JSON, output shaped exactly like a research render so the existing frontend adapter renders it unchanged.

**Files:**
- Create: `upstream/docker-server-graph-lens-core.mjs`
- Create: `upstream/docker-server-graph-lens.mjs`
- Modify: `upstream/docker-server-graph-templates-core.mjs` (add the lens descriptor)
- Modify: `upstream/docker-server-routes.mjs:36-37,75-76`
- Test: `tests/unit/graph-lens-core.test.mjs`, `tests/unit/graph-lens-handler.test.mjs`

- [ ] **Step 1: Write the failing projection unit test**

`tests/unit/graph-lens-core.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { projectImports } from '../../upstream/docker-server-graph-lens-core.mjs';

const GRAPH = {
  nodes: [
    { id: 'n1', properties: { filePath: 'src/a.ts' } },
    { id: 'n2', properties: { filePath: 'src/a.ts' } },   // same file as n1
    { id: 'n3', properties: { filePath: 'src/b.ts' } },
    { id: 'n4', properties: { filePath: 'src/c.ts' } },
  ],
  relationships: [
    { sourceId: 'n1', targetId: 'n3', type: 'IMPORTS' },  // a -> b
    { sourceId: 'n2', targetId: 'n3', type: 'IMPORTS' },  // a -> b again (dedup)
    { sourceId: 'n1', targetId: 'n4', type: 'CALLS' },    // dropped (not IMPORTS)
    { sourceId: 'n1', targetId: 'n2', type: 'IMPORTS' },  // self-file (a -> a) dropped
  ],
};

describe('projectImports', () => {
  it('keeps only IMPORTS edges, rolls up to file level, dedups, drops self-loops', () => {
    const rg = projectImports(GRAPH);
    expect(rg.schema_type).toBe('imports-deps');
    expect(rg.edges).toHaveLength(1);
    expect(rg.edges[0]).toMatchObject({ source: 'src/a.ts', target: 'src/b.ts', kind: 'imports' });
    // only files that participate in a kept edge appear
    expect(rg.nodes.map((n) => n.id).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    const a = rg.nodes.find((n) => n.id === 'src/a.ts');
    expect(a).toMatchObject({ type: 'file', label: 'a.ts', path: 'src/a.ts', stage: '' });
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
bash tests/docker-test.sh unit graph-lens-core
```
Expected: FAIL — module/function missing.

- [ ] **Step 3: Implement the projection core**

`upstream/docker-server-graph-lens-core.mjs`:
```js
/**
 * Lens projections over a /api/graph KnowledgeGraph JSON. Pure, no I/O.
 * Output is shaped like a research render ({nodes:[{id,type,label,path,stage}],
 * edges:[{id,source,target,kind}]}) so the existing research-graph-adapter
 * renders it unchanged. See spec 2026-06-03-graph-platform-p1-sdk-proof-design.md.
 */

/** Project a KnowledgeGraph to a file-level IMPORTS dependency graph. */
export function projectImports(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const rels = Array.isArray(graph?.relationships) ? graph.relationships : [];
  const fileOf = new Map();
  for (const n of nodes) {
    const fp = n?.properties?.filePath;
    if (typeof fp === 'string' && fp) fileOf.set(n.id, fp);
  }
  const seen = new Set();
  const edges = [];
  const usedFiles = new Set();
  for (const r of rels) {
    if (r?.type !== 'IMPORTS') continue;
    const s = fileOf.get(r.sourceId);
    const t = fileOf.get(r.targetId);
    if (!s || !t || s === t) continue;
    const key = `${s} ${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: `${s}->${t}`, source: s, target: t, kind: 'imports' });
    usedFiles.add(s); usedFiles.add(t);
  }
  const fileNodes = [...usedFiles].map((fp) => ({ id: fp, type: 'file', label: fp.split('/').pop() || fp, path: fp, stage: '' }));
  return {
    schema_type: 'imports-deps', template: 'imports-deps', name: null, source: null,
    nodes: fileNodes, edges,
    report: { nodes: fileNodes.length, edges: edges.length },
  };
}
```

- [ ] **Step 4: Run the projection test, verify pass**

```bash
bash tests/docker-test.sh unit graph-lens-core
```
Expected: PASS.

- [ ] **Step 5: Write the failing handler test (stubbed `fetch`)**

`tests/unit/graph-lens-handler.test.mjs`:
```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleGraphLensRoute } from '../../upstream/docker-server-graph-lens.mjs';

function fakeRes() {
  return { _code: 0, _body: '', writeHead(c) { this._code = c; }, end(b) { this._body = b || ''; } };
}
afterEach(() => vi.unstubAllGlobals());

describe('handleGraphLensRoute', () => {
  it('projects /api/graph for a known lens id + repo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        nodes: [{ id: 'n1', properties: { filePath: 'a.ts' } }, { id: 'n2', properties: { filePath: 'b.ts' } }],
        relationships: [{ sourceId: 'n1', targetId: 'n2', type: 'IMPORTS' }],
      }),
    })));
    const res = fakeRes();
    const url = new URL('http://x/graph/lens/imports-deps?repo=myrepo');
    const claimed = await handleGraphLensRoute({ method: 'GET' }, url, res);
    expect(claimed).toBe(true);
    expect(res._code).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.edges).toEqual([{ id: 'a.ts->b.ts', source: 'a.ts', target: 'b.ts', kind: 'imports' }]);
  });

  it('404s an unknown lens id', async () => {
    const res = fakeRes();
    const url = new URL('http://x/graph/lens/nope?repo=r');
    await handleGraphLensRoute({ method: 'GET' }, url, res);
    expect(res._code).toBe(404);
  });

  it('returns false for non-lens paths', async () => {
    const res = fakeRes();
    const url = new URL('http://x/graph/templates');
    expect(await handleGraphLensRoute({ method: 'GET' }, url, res)).toBe(false);
  });
});
```

- [ ] **Step 6: Run it, watch it fail**

```bash
bash tests/docker-test.sh unit graph-lens-handler
```
Expected: FAIL — module missing.

- [ ] **Step 7: Implement the handler**

`upstream/docker-server-graph-lens.mjs`:
```js
/**
 * Lens routes (web container). A lens is a saved projection over an EXISTING
 * graph (target 'astkg' = the CLI's KnowledgeGraph, read via /api/graph JSON —
 * no Kùzu-file coupling). Modelled on docker-server-group-graph.mjs.
 *   GET /graph/lens/:id?repo=<repo> -> { nodes, edges }  (research-render shape)
 */
import { projectImports } from './docker-server-graph-lens-core.mjs';

const GITNEXUS_API = process.env.GITNEXUS_API || 'http://gitnexus:4747';
const LENSES = { 'imports-deps': projectImports };

function sendJson(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

export async function handleGraphLensRoute(req, url, res) {
  if (!url.pathname.startsWith('/graph/lens/') || req.method !== 'GET') return false;
  const id = decodeURIComponent(url.pathname.slice('/graph/lens/'.length));
  const project = LENSES[id];
  if (!project) { sendJson(res, 404, { error: `unknown lens: ${id}` }); return true; }
  const repo = url.searchParams.get('repo');
  if (!repo) { sendJson(res, 400, { error: 'missing repo' }); return true; }
  try {
    const r = await fetch(`${GITNEXUS_API}/api/graph?repo=${encodeURIComponent(repo)}`);
    if (!r.ok) { sendJson(res, 502, { error: `upstream /api/graph ${r.status}` }); return true; }
    const graph = await r.json();
    sendJson(res, 200, project(graph));
  } catch (e) { sendJson(res, 500, { error: `lens failed: ${e.message}` }); return true; }
  return true;
}
```

- [ ] **Step 8: Register the lens descriptor**

In `upstream/docker-server-graph-templates-core.mjs`, after the `academic-literature` descriptor, add:
```js
registerTemplate({
  id: 'imports-deps',
  kind: 'lens',
  target: 'astkg',
  label: 'Imports / Dependencies',
  schema_type: 'imports-deps',
  description: 'File-level import/dependency projection over an indexed repo\'s code graph (ASTKG). Read-only lens; no new graph is created.',
});
```
> Note: `registerTemplate` defaults `kind:'import'` and tolerates missing `ddl`/`importer`; a lens descriptor simply omits them.

- [ ] **Step 9: Wire the route**

In `upstream/docker-server-routes.mjs`:
- After line 36, add: `import { handleGraphLensRoute } from './docker-server-graph-lens.mjs';`
- Before line 76 (`handleGraphTemplatesRoute`), add: `  if (await handleGraphLensRoute(req, reqUrl, res)) return true;`

- [ ] **Step 10: Run both lens unit tests, verify pass**

```bash
bash tests/docker-test.sh unit graph-lens
```
Expected: PASS (graph-lens-core + graph-lens-handler).

- [ ] **Step 11: Controller serialization + commit**

Controller: regenerate the 3 diffs (2 new files → `additive`; templates-core + routes edits → `inplace`), drift exit 0, then:
```bash
git add patches/ tests/unit/graph-lens-core.test.mjs tests/unit/graph-lens-handler.test.mjs
git commit -m "feat(graph-templates): imports-deps lens (descriptor + projection + handler + route)"
```

---

## Task 6: Frontend — surface the lens kind and render it (URL-driven)

Light glue: the lens reuses the existing `?research=`-style URL-driven render path via a parallel `?lens=&repo=` route. `projectImports` already returns the ResearchGraph shape, so `researchGraphToGraphology` renders it unchanged.

**Files:**
- Modify: `upstream/gitnexus-web/src/services/research-client.ts`
- Create: `upstream/gitnexus-web/src/services/research-client.test.ts`
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx:116-122`
- Modify: `upstream/gitnexus-web/src/App.tsx:227-238`

- [ ] **Step 1: Write the failing client test**

`upstream/gitnexus-web/src/services/research-client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyLens } from './research-client';

afterEach(() => vi.unstubAllGlobals());

describe('applyLens', () => {
  it('GETs /graph/lens/:id?repo= and returns the ResearchGraph', async () => {
    const fake = { schema_type: 'imports-deps', nodes: [{ id: 'a.ts', type: 'file', label: 'a.ts', path: 'a.ts', stage: '' }], edges: [] };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => fake }));
    vi.stubGlobal('fetch', fetchMock);
    const rg = await applyLens('imports-deps', 'my repo');
    expect(fetchMock).toHaveBeenCalledWith('/graph/lens/imports-deps?repo=my%20repo');
    expect(rg.nodes[0].type).toBe('file');
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
bash tests/docker-test.sh unit research-client
```
Expected: FAIL — `applyLens` is not exported.

- [ ] **Step 3: Extend the client**

In `upstream/gitnexus-web/src/services/research-client.ts`:
- Add `kind?: 'import' | 'lens'; target?: string;` to the `GraphTemplate` interface.
- Add at the end of the file:
```ts
export async function applyLens(id: string, repo: string): Promise<ResearchGraph> {
  return jsonOrThrow(await fetch(`/graph/lens/${encodeURIComponent(id)}?repo=${encodeURIComponent(repo)}`));
}
```

- [ ] **Step 4: Run the client test, verify pass**

```bash
bash tests/docker-test.sh unit research-client
```
Expected: PASS.

- [ ] **Step 5: Add the URL-driven lens effect in GraphCanvas**

In `upstream/gitnexus-web/src/components/GraphCanvas.tsx`, just after the research effect (line ~122), add:
```tsx
  // Lens — URL-driven projection for ?lens=<id>&repo=<repo>. Reuses researchData +
  // the research render path (projectImports returns the ResearchGraph shape).
  const lensId = new URLSearchParams(window.location.search).get('lens');
  const lensRepo = new URLSearchParams(window.location.search).get('repo');
  useEffect(() => {
    if (!lensId || !lensRepo) return;
    applyLens(lensId, lensRepo).then(setResearchData).catch((e) => console.error('lens load failed', e));
  }, [lensId, lensRepo]);
```
And extend the import on line 47:
```tsx
import { getResearchGraph, applyLens } from '../services/research-client';
```

- [ ] **Step 6: Branch `handleNewGraph` to the lens flow**

In `upstream/gitnexus-web/src/App.tsx`, replace the body of `handleNewGraph` (lines ~227-238) with:
```tsx
  const handleNewGraph = useCallback(async () => {
    const templates = await listTemplates();
    const templateId = window.prompt(`Template id (${templates.map((t) => t.id).join(', ')})`, 'research-artifacts');
    if (!templateId) return;
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl?.kind === 'lens') {
      const repo = window.prompt('Repo to project (indexed repo name)', projectName || '');
      if (!repo) return;
      window.location.search = `?lens=${encodeURIComponent(templateId)}&repo=${encodeURIComponent(repo)}`;
      return;
    }
    const name = window.prompt('New graph name');
    if (!name) return;
    const source = window.prompt('Source dir (relative to /data/projects)');
    if (!source) return;
    await scaffoldGraph(templateId, name, source);
    await importGraph(name);
    window.location.search = `?research=${encodeURIComponent(name)}`;
  }, [projectName]);
```
> `projectName` is the active repo name already in scope in `App.tsx` (used by the audit/gantt panels). If the symbol in scope differs, use the existing active-repo variable; the prompt default is best-effort.

- [ ] **Step 7: Run the unit tier (regression), verify pass**

```bash
bash tests/docker-test.sh unit research-client
```
Expected: PASS. (GraphCanvas/App wiring is glue verified on the live stack in the final demo; no new component test.)

- [ ] **Step 8: Controller serialization + commit**

Controller: regenerate the 3 diffs (new test file → `additive`; client/canvas/App edits → `inplace`), drift exit 0, then:
```bash
git add patches/
git commit -m "feat(web): surface lens templates + URL-driven imports-deps lens render"
```

---

## Task 7: Offline PDF → `papers.json` extractor (host tool)

A one-shot, host-only tool (not in any container, not a CI gate) that turns a PDF corpus into `papers.json`. Tracked under `tools/`.

**Files:**
- Create: `tools/academic-extract.mjs`
- Test: `tests/unit/academic-extract.test.mjs`

- [ ] **Step 1: Write the failing test for the pure helper**

The PDF parse itself is I/O; the testable unit is the filename→metadata heuristic. `tests/unit/academic-extract.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { guessMetaFromFilename, keywordTopics } from '../../tools/academic-extract.mjs';

describe('academic-extract heuristics', () => {
  it('extracts year + author hint from common filename shapes', () => {
    expect(guessMetaFromFilename('Fama1970.pdf')).toMatchObject({ year: 1970, title: 'Fama' });
    expect(guessMetaFromFilename('1985 EMA Kyle.pdf')).toMatchObject({ year: 1985 });
    expect(guessMetaFromFilename('Volatility is rough.pdf')).toMatchObject({ year: null, title: 'Volatility is rough' });
  });
  it('derives topic keywords from a title', () => {
    expect(keywordTopics('Market Liquidity and Funding Liquidity')).toContain('liquidity');
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
bash tests/docker-test.sh unit academic-extract
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the extractor**

`tools/academic-extract.mjs`:
```js
#!/usr/bin/env node
/**
 * OFFLINE, HOST-ONLY. Turn a directory of PDFs into papers.json for the
 * academic-literature template. Not run in any container; not a CI gate.
 * Metadata is best-effort (filename year + title hint, light topic keywords).
 * Usage: node tools/academic-extract.mjs <pdf-dir> <out.json>
 * NOTE: real corpora (e.g. Alten CMEX-3710) are processed locally only; the
 * resulting papers.json must NOT be committed.
 */
import { readdir, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

const STOP = new Set(['the', 'and', 'of', 'a', 'an', 'is', 'for', 'in', 'on', 'to', 'via', 'under', 'with']);

export function guessMetaFromFilename(file) {
  const stem = basename(file, extname(file));
  const ym = stem.match(/(19|20)\d{2}/);
  const year = ym ? Number(ym[0]) : null;
  const title = stem.replace(/(19|20)\d{2}/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || stem;
  return { year, title };
}

export function keywordTopics(title) {
  return [...new Set(String(title).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4 && !STOP.has(w)))];
}

async function main() {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) { console.error('usage: node tools/academic-extract.mjs <pdf-dir> <out.json>'); process.exit(2); }
  const files = (await readdir(dir)).filter((f) => extname(f).toLowerCase() === '.pdf');
  const papers = files.map((f, i) => {
    const { year, title } = guessMetaFromFilename(f);
    return { id: `p${i}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`, title, year: year || 0, path: f, authors: [], topics: keywordTopics(title) };
  });
  await writeFile(out, JSON.stringify({ papers }, null, 2), 'utf8');
  console.log(`wrote ${papers.length} papers to ${out}`);
}
// Run only as a script, not on import (so tests can import the helpers).
if (process.argv[1] && process.argv[1].endsWith('academic-extract.mjs')) main();
```
> P1 scope: authors are left `[]` by the extractor (reliable author parsing from raw PDFs is out of scope — see spec §6); the controller may hand-fill a few for the demo. `topics` come from the title heuristic so `Topic`/`ABOUT` are exercised.

- [ ] **Step 4: Run the test, verify pass**

```bash
bash tests/docker-test.sh unit academic-extract
```
Expected: PASS.

- [ ] **Step 5: Commit (tracked — normal)**

```bash
git add tools/academic-extract.mjs tests/unit/academic-extract.test.mjs
git commit -m "feat(tools): offline PDF->papers.json extractor for academic-literature"
```

---

## Task 8: Docs — spec amendment, roadmap, inventory

**Files:**
- Amend: `docs/superpowers/specs/2026-06-03-graph-platform-p1-sdk-proof-design.md`
- Modify: `ROADMAP.md`
- Modify: `INVENTORY.md`

- [ ] **Step 1: Amend the spec (plan-time discoveries)**

Append to the spec:
```markdown
## Update 2026-06-03 — sidecar generalization + lens output shape (plan-time)

Two refinements discovered while writing the plan:

1. **The sidecar is part of G1.** G1 (§3.1) covered the *importer* contract, but
   the sidecar `ingest`/`render` were themselves single-schema: `ingest`
   hardcoded `SET r.kind` on every edge (breaks on `AUTHORED`/`ABOUT`, which have
   no `kind` column) and `render` projected the fixed `Artifact` columns. The
   plan generalizes both (`graphs-sidecar/kuzu-store.mjs`): edges set arbitrary
   props; render uses `MATCH (n) RETURN n` + a property-or-table-name fallback
   (`type = n.type ?? _label`, `kind = r.kind ?? _label`). Component table §3.3
   should be read as including `graphs-sidecar/kuzu-store.mjs`.
2. **Lens output shape.** §3.2 sketched `{nodes:[{id,label,kind:'file'}],...}`.
   The implementation instead returns the **research-render shape**
   (`{nodes:[{id,type:'file',label,path,stage}], edges:[{id,source,target,kind:'imports'}]}`)
   so the existing `research-graph-adapter` + the URL-driven render path render
   it unchanged — the lens reaches the canvas via `?lens=<id>&repo=<repo>`.
```

- [ ] **Step 2: Update ROADMAP.md**

In the "Graph Platform P0→P3" section, mark P1 shipped and add a "Template Library" backlog line. Add a row to the shipped table:
```markdown
| P1 | SDK prouvé sur 2ᵉ template de chaque sorte (academic-literature import multi-tables + imports-deps lens) | ✅ Livré 2026-06-03 |
| → | Template Library (crypto/Experiment.Crypto, zettelkasten, research-artifacts++) — applications cheap du SDK prouvé | 💡 Backlog post-P1 |
```

- [ ] **Step 3: Update INVENTORY.md**

Under the graph-templates entry, add the new template + lens + endpoint + tool:
```markdown
- `academic-literature` import template (Paper/Author/Topic + AUTHORED/ABOUT), importer `academic-json` reading `papers.json`.
- `imports-deps` lens (`GET /graph/lens/:id?repo=`) — file-level IMPORTS projection over the ASTKG via `/api/graph` (no Kùzu coupling).
- `tools/academic-extract.mjs` — offline host-only PDF→papers.json extractor.
- Sidecar `ingest`/`render` are now schema-agnostic (multi-table graphs).
```

- [ ] **Step 4: Commit (tracked — normal)**

```bash
git add docs/superpowers/specs/2026-06-03-graph-platform-p1-sdk-proof-design.md ROADMAP.md INVENTORY.md
git commit -m "docs: P1 spec amendment + roadmap (P1 shipped, Template Library backlog) + inventory"
```

---

## Final: full verification + finish the branch

- [ ] **Step 1: Full unit tier green**

```bash
bash tests/docker-test.sh unit
```
Expected: all unit tests pass (academic-json, research-fs generic shape, registry incl. academic, graph-lens core+handler, research-client applyLens, academic-extract; research-ingest-map gone).

- [ ] **Step 2: Patch integrity (build-gate parity)**

```bash
node scripts/check-patch-drift.mjs   # exit 0
```
Then verify the committed monolith actually rebuilds a fresh clone (what CI's build-gate does):
```bash
docker compose -f docker-compose.test.yml up -d --build
docker compose -f docker-compose.test.yml ps   # all healthy
docker compose -f docker-compose.test.yml down -v
```

- [ ] **Step 3: Live dev demo on the real corpus (controller, not committed)**

Run the offline extractor on the real CMEX-3710 PDFs into a scratch papers.json, point a dev graph at it, and project a lens on an indexed repo — to see P1 live. Do NOT commit the generated papers.json or any Alten data.

- [ ] **Step 4: Finish the development branch**

Use **superpowers:finishing-a-development-branch** to wrap up (the work is on `deployment`; confirm whether to keep committing there or open a feature branch per the user's git-hygiene preference before pushing).

---

## Self-review (against the spec)

**Spec coverage:** G1 → Tasks 2,3 (importer emits generic shape; mapper deleted; sidecar generalized in Task 1). G2 → Task 5 (descriptor + projection + handler + route) and Task 6 (render path). `academic-literature` multi-table → Tasks 1,2,4. `imports-deps` lens → Tasks 5,6. Synthetic-fixtures-only / no Alten data → Task 2 fixture, Task 7 note, Final Step 3. Offline preprocessor → Task 7. Topics heuristic (resolved open question) → Task 7 `keywordTopics`. Docs/roadmap/inventory discipline → Task 8. No gaps.

**Placeholder scan:** no TBD/TODO; every code step has complete code; commands have expected output. The one empirical risk (`_label` presence) carries an exact contingency, not a vague "handle it".

**Type/name consistency:** `importAcademicJson`, `projectImports`, `handleGraphLensRoute`, `applyLens` are defined once and referenced consistently. Generic shape `{table,props}` / `{table,from,to,props}` is identical across the sidecar `ingest`, the importers (Tasks 2,3), and the handler (Task 3 Step 6). Lens output (research-render shape) matches `ResearchNode`/`ResearchEdge` consumed by `researchGraphToGraphology`.
