# `research-graph` import template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `research-graph` import template that ingests a curated research knowledge graph from a `research-graph.json` emit into the Kùzu sidecar and renders it on the existing canvas.

**Architecture:** A direct application of the proven P1 SDK — a descriptor (generic `Entity`/`Relates` DDL, type-as-property) + a pure-Node importer that reads `research-graph.json` and emits the generic ingest shape. No engine changes. Cohabitation-safe (additive/in-place `upstream/` files serialized via patches).

**Tech Stack:** Node `.mjs` (gitignored `upstream/` handlers), `kuzu@0.11.3` sidecar (tracked `graphs-sidecar/`), vitest (run via `bash tests/docker-test.sh unit` or native `cd tests && npx vitest run --config vitest.config.unit.mjs`), Docker for the stack e2e.

---

## ⚠️ Execution protocol — READ FIRST

- **`upstream/` is GITIGNORED**, serialized into `patches/`. The implementer subagent **edits `upstream/` + writes/runs tracked tests but does NOT touch git or patches**. The **controller** regenerates the 3 diffs + drift-check + commits (see below). Tracked files (`tests/`, `docs/`, `ROADMAP.md`, `INVENTORY.md`) commit normally.
- **Patch regeneration (controller only), after any `upstream/` edit:**
  ```bash
  git -C upstream add -N .
  git -C upstream diff HEAD --diff-filter=A > patches/additive-files.diff
  git -C upstream diff HEAD --diff-filter=M > patches/inplace-edits.diff
  git -C upstream diff HEAD                  > patches/upstream-all.diff
  git -C upstream reset -q
  node scripts/check-patch-drift.mjs   # MUST exit 0
  ```
- **Identity (personal repo):** `git config user.email` MUST be `roblastar@live.fr`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Boot-crash discipline:** every NEW `docker-server-*.mjs` imported at boot MUST be added to `upstream/Dockerfile.web`'s explicit per-file `COPY` list, or the web container crash-loops with `ERR_MODULE_NOT_FOUND` (the CI `boot-smoke` job now guards this; verify locally in the Final step too).
- **No Experiment.Crypto data** — all fixtures synthetic.

## File Structure

| File | Zone | Responsibility |
|---|---|---|
| `upstream/docker-server-research-graph-importer.mjs` *(new)* | upstream | read `research-graph.json` → emit generic ingest shape (`Entity` nodes, `Relates` edges with `kind`=edge type) + report |
| `tests/fixtures/research-graph/research-graph.json` *(new)* | tracked | synthetic curated graph (hypotheses/experiments/verdicts + edges) |
| `tests/unit/research-graph-importer.test.mjs` *(new)* | tracked | importer unit test |
| `upstream/docker-server-graph-templates-core.mjs` *(edit)* | upstream | register `research-graph` descriptor; add to `BUILTINS` |
| `upstream/docker-server-graph-templates.mjs` *(edit)* | upstream | wire `IMPORTERS['research-graph-json']` |
| `upstream/Dockerfile.web` *(edit)* | upstream | COPY the new importer module |
| `tests/unit/graph-templates-registry.test.mjs` *(edit)* | tracked | assert the descriptor |
| `tests/fixtures/make-fixture.mjs` *(edit)* + `tests/fixtures/sample-repo.tar.gz` *(regen)* | tracked | add a `research-graph-corpus/research-graph.json` to the integ projects root |
| `tests/integration/endpoints/graph-templates.test.mjs` *(edit)* | tracked | HTTP scaffold→import→render integ test |
| `docs/superpowers/specs/2026-06-03-research-graph-import-template-design.md` *(edit)* | tracked | sync DDL table names to `Entity`/`Relates` |
| `ROADMAP.md`, `INVENTORY.md` *(edit)* | tracked | record the shipped template |

---

## Task 1: `research-graph-json` importer + synthetic fixture + unit test

**Files:**
- Create: `upstream/docker-server-research-graph-importer.mjs`
- Create: `tests/fixtures/research-graph/research-graph.json`
- Test: `tests/unit/research-graph-importer.test.mjs`

⚠️ Implementer: do NOT git/commit/touch patches (controller serializes the upstream importer).

- [ ] **Step 1: Create the synthetic fixture** `tests/fixtures/research-graph/research-graph.json`:
```json
{ "schema": { "node_types": ["Hypothesis","Experiment","Verdict","SDR"], "edge_types": ["tests","validates","produces","gated_by","decided_by"], "statuses": ["open","active","validated","planned"] },
  "nodes": [
    { "id": "H1", "type": "Hypothesis", "title": "BTC-ETH sync", "status": "validated" },
    { "id": "H2", "type": "Hypothesis", "title": "Basket aggregation", "status": "open" },
    { "id": "exp001", "type": "Experiment", "title": "TradFi link", "status": "active", "anchor": "notes/decisions.md#2026-05-15-exp001" },
    { "id": "exp002", "type": "Experiment", "title": "Multivariate", "status": "planned" },
    { "id": "v1", "type": "Verdict", "title": "H1 validated", "status": "validated" },
    { "id": "sdr-a", "type": "SDR", "title": "exp001 scope", "status": "active" }
  ],
  "edges": [
    { "from": "exp001", "to": "H1", "type": "tests" },
    { "from": "exp002", "to": "H2", "type": "tests" },
    { "from": "v1", "to": "H1", "type": "validates" },
    { "from": "exp001", "to": "v1", "type": "produces" },
    { "from": "exp002", "to": "v1", "type": "gated_by" },
    { "from": "exp001", "to": "sdr-a", "type": "decided_by" }
  ] }
```

- [ ] **Step 2: Write the failing unit test** `tests/unit/research-graph-importer.test.mjs`:
```js
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

  it('drops dangling edges and dedups by id', async () => {
    // build an inline-ish dir via the malformed fixture (created below)
    const bad = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/research-graph-bad');
    const rg = await importResearchGraph(bad);
    expect(rg.nodes).toHaveLength(1);            // only the one valid node
    expect(rg.edges).toHaveLength(0);            // edge references a missing target → dropped
    expect(rg.report.skipped.length).toBeGreaterThan(0);
  });

  it('rejects with a clear error when research-graph.json is absent', async () => {
    await expect(importResearchGraph('/no/such/dir')).rejects.toThrow(/cannot read research-graph.json/);
  });
});
```
Also create the bad fixture `tests/fixtures/research-graph-bad/research-graph.json`:
```json
{ "nodes": [ { "id": "a", "type": "Hypothesis", "title": "A", "status": "open" }, { "type": "Experiment", "title": "no id", "status": "open" } ],
  "edges": [ { "from": "a", "to": "ghost", "type": "tests" } ] }
```

- [ ] **Step 3: Run it, watch it fail** — `bash tests/docker-test.sh unit research-graph-importer` → FAIL (module missing).

- [ ] **Step 4: Implement the importer** `upstream/docker-server-research-graph-importer.mjs`:
```js
/**
 * research-graph importer: read research-graph.json (a curated research knowledge
 * graph — Hypothesis/Experiment/Verdict/SDR + reasoning edges) and emit the
 * generic sidecar ingest shape. Generic Entity/Relates tables, type-as-property.
 * Pure Node, deterministic. See spec 2026-06-03-research-graph-import-template-design.md.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function importResearchGraph(absSourceDir) {
  let doc;
  try { doc = JSON.parse(await readFile(join(absSourceDir, 'research-graph.json'), 'utf8')); }
  catch (e) { throw new Error(`cannot read research-graph.json in source: ${e.message}`); }
  const inNodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const inEdges = Array.isArray(doc.edges) ? doc.edges : [];

  const seen = new Set();
  const nodes = [];
  const skipped = [];
  for (const n of inNodes) {
    if (n.id == null || n.id === '') { skipped.push({ reason: 'missing id', title: n.title ?? null }); continue; }
    const id = String(n.id);
    if (seen.has(id)) { skipped.push({ reason: 'duplicate id', id }); continue; }
    seen.add(id);
    nodes.push({ table: 'Entity', props: { id, type: String(n.type || ''), title: String(n.title || ''), status: String(n.status || ''), anchor: String(n.anchor || '') } });
  }

  const seenEdges = new Set();
  const edges = [];
  for (const e of inEdges) {
    const from = String(e.from ?? '');
    const to = String(e.to ?? '');
    if (!from || !to || !seen.has(from) || !seen.has(to)) { skipped.push({ reason: 'dangling edge', from, to }); continue; }
    const eid = `${from}->${e.type}->${to}`;
    if (seenEdges.has(eid)) continue;
    seenEdges.add(eid);
    edges.push({ table: 'Relates', from, to, props: { id: eid, kind: String(e.type || '') } });
  }

  const byType = {}; for (const n of nodes) byType[n.props.type] = (byType[n.props.type] || 0) + 1;
  const byKind = {}; for (const e of edges) byKind[e.props.kind] = (byKind[e.props.kind] || 0) + 1;

  return {
    schema_type: 'research-graph', template: 'research-graph', name: null, source: null,
    nodes, edges,
    report: { nodes: nodes.length, edges: edges.length, byType, byKind, unresolvedLinks: [], skipped },
  };
}
```

- [ ] **Step 5: Run the tests, verify pass** — `bash tests/docker-test.sh unit research-graph-importer` → PASS (3 tests).

- [ ] **Step 6 (CONTROLLER): serialize + commit.** Regenerate the 3 diffs (new importer → `additive-files.diff`), drift exit 0, then:
```bash
git add patches/ tests/unit/research-graph-importer.test.mjs tests/fixtures/research-graph/ tests/fixtures/research-graph-bad/
git commit -m "feat(graph-templates): research-graph-json importer (generic Entity/Relates ingest shape)"
```

---

## Task 2: Register the `research-graph` template + wire importer + Dockerfile COPY + sync spec DDL

**Files:**
- Modify: `upstream/docker-server-graph-templates-core.mjs` (descriptor + BUILTINS)
- Modify: `upstream/docker-server-graph-templates.mjs` (IMPORTERS)
- Modify: `upstream/Dockerfile.web` (COPY)
- Modify: `tests/unit/graph-templates-registry.test.mjs`
- Modify: `docs/superpowers/specs/2026-06-03-research-graph-import-template-design.md` (DDL table names)

⚠️ Implementer: edit files + run the registry test; do NOT git/commit/patch.

- [ ] **Step 1: Add a failing registry assertion** in `tests/unit/graph-templates-registry.test.mjs` (inside the existing top-level describe; reuse the file's `listTemplates` import style):
```js
  it('registers the research-graph import template (generic Entity/Relates DDL)', async () => {
    const { listTemplates } = await import('../../upstream/docker-server-graph-templates-core.mjs');
    const rg = listTemplates().find((t) => t.id === 'research-graph');
    expect(rg).toBeTruthy();
    expect(rg.kind).toBe('import');
    expect(rg.importer).toBe('research-graph-json');
    expect(rg.ddl.some((s) => /CREATE NODE TABLE Entity/.test(s))).toBe(true);
    expect(rg.ddl.some((s) => /CREATE REL TABLE Relates/.test(s))).toBe(true);
  });
```

- [ ] **Step 2: Run it, watch it fail** — `bash tests/docker-test.sh unit graph-templates-registry` → FAIL (`rg` undefined).

- [ ] **Step 3: Add the descriptor** in `upstream/docker-server-graph-templates-core.mjs`, AFTER the `imports-deps` lens descriptor:
```js
registerTemplate({
  id: 'research-graph',
  kind: 'import',
  label: 'Research Graph',
  schema_type: 'research-graph',
  description: 'Curated research knowledge graph (Hypothesis/Experiment/Verdict/SDR + reasoning edges) imported from a research-graph.json emit. Distinct from research-artifacts, which walks .md/.ipynb files.',
  importer: 'research-graph-json',
  include: ['research-graph.json'],
  exclude: [],
  ddl: [
    'CREATE NODE TABLE Entity(id STRING, type STRING, title STRING, status STRING, anchor STRING, PRIMARY KEY(id))',
    'CREATE REL TABLE Relates(FROM Entity TO Entity, id STRING, kind STRING)',
  ],
  visual: { nodeColors: {
    Hypothesis: '#a855f7', Experiment: '#f59e0b', Verdict: '#10b981', SDR: '#3b82f6',
    ADR: '#6366f1', Paper: '#64748b', Idea: '#ec4899', Detector: '#14b8a6', Run: '#eab308',
    Tool: '#94a3b8', Indicator: '#06b6d4', Dataset: '#0ea5e9', Regime: '#f43f5e',
    Phase: '#8b5cf6', Submeasure: '#84cc16',
  } },
});
```
ALSO add `'research-graph'` to the `BUILTINS` set (currently `new Set(['research-artifacts', 'academic-literature', 'imports-deps'])` → add `'research-graph'`).

- [ ] **Step 4: Wire the importer** in `upstream/docker-server-graph-templates.mjs`:
```js
import { importResearchGraph } from './docker-server-research-graph-importer.mjs';
// extend IMPORTERS:
const IMPORTERS = { 'research-fs': importResearchFs, 'academic-json': importAcademicJson, 'research-graph-json': importResearchGraph };
```
(Read the file first; add the import next to the others, extend the existing `IMPORTERS` literal — keep `research-fs` + `academic-json`.)

- [ ] **Step 5: COPY the importer into the web image** — in `upstream/Dockerfile.web`, in the P1 graph-platform COPY block (next to `docker-server-academic-json-importer.mjs` / `docker-server-graph-lens*.mjs`), add:
```dockerfile
COPY docker-server-research-graph-importer.mjs ./docker-server-research-graph-importer.mjs
```
(Read that block first; place the line with the other graph-platform COPYs, before `RUN chown -R node:node /app`.)

- [ ] **Step 6: Run the registry test, verify pass** — `bash tests/docker-test.sh unit graph-templates-registry` → PASS. Also re-run `research-graph-importer` + `academic-json-importer` + `research-fs-importer` to confirm no regression.

- [ ] **Step 7: Sync the spec DDL** — in `docs/superpowers/specs/2026-06-03-research-graph-import-template-design.md` §3.3, change the DDL table names from `Node`/`Edge` to `Entity`/`Relates` (reserved-word safety — `NODE` is a Kùzu keyword), and add a one-line note: `(Table names Entity/Relates avoid Cypher reserved words; node type / edge kind come from properties, so table names never surface in render.)`

- [ ] **Step 8 (CONTROLLER): serialize + commit.** Regen 3 diffs (templates-core + templates + Dockerfile.web edits → `additive`/`inplace`), drift exit 0, then:
```bash
git add patches/ tests/unit/graph-templates-registry.test.mjs docs/superpowers/specs/2026-06-03-research-graph-import-template-design.md
git commit -m "feat(graph-templates): register research-graph template + wire importer + Dockerfile COPY"
```

---

## Task 3: HTTP integration test (scaffold→import→render) + fixture corpus

**Files:**
- Modify: `tests/fixtures/make-fixture.mjs` + regen `tests/fixtures/sample-repo.tar.gz`
- Modify: `tests/integration/endpoints/graph-templates.test.mjs`

(All tracked — implementer commits this one normally, like the academic integ test.)

- [ ] **Step 1: Add a `research-graph-corpus` to the fixture** — in `tests/fixtures/make-fixture.mjs`, before the tar-pack step, create `_build/research-graph-corpus/research-graph.json` with the SAME content as `tests/fixtures/research-graph/research-graph.json` (the 6-node/6-edge synthetic graph). Extend the tar pack command to include the new dir (currently `... sample-repo academic-corpus` → `... sample-repo academic-corpus research-graph-corpus`). Read make-fixture.mjs first; mirror exactly how `academic-corpus` was added.

- [ ] **Step 2: Regenerate the tarball** — `node tests/fixtures/make-fixture.mjs`, then verify: `tar -tzf tests/fixtures/sample-repo.tar.gz | grep -E "research-graph-corpus/research-graph.json"` is present AND `sample-repo/` + `academic-corpus/` still present.

- [ ] **Step 3: Add the integ test** in `tests/integration/endpoints/graph-templates.test.mjs` (mirror the academic test's style + `BASE`):
```js
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
    expect(graph.edges.some((e) => e.kind === 'validates')).toBe(true);  // edge type surfaced via render `kind`
  });
```

- [ ] **Step 4: Verify** — run the integ tier (`cd tests && npm run test:integ`) if the dev stack is down; else verify via the manual test stack on non-colliding ports (TEST_PORT=4847 TEST_WEB_PORT=4273, TEST_PROJECTS_ROOT=a temp extraction of the regenerated tarball) as in the academic follow-up. Confirm: research-graph import = 6 nodes/6 edges with Hypothesis/Experiment types + a `validates` edge kind; AND research-artifacts + academic still import (no fixture regression).

- [ ] **Step 5: Commit (tracked):**
```bash
git config user.email   # roblastar@live.fr
git add tests/fixtures/make-fixture.mjs tests/fixtures/sample-repo.tar.gz tests/integration/endpoints/graph-templates.test.mjs
git commit -m "test(integ): research-graph scaffold->import->render HTTP test + fixture corpus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Docs — ROADMAP + INVENTORY

**Files:**
- Modify: `ROADMAP.md` (Template Library row)
- Modify: `INVENTORY.md` (graph-templates entry)

- [ ] **Step 1: ROADMAP** — update the "Template Library" row in the Graph Platform section to mark `research-graph` shipped, e.g. append: `research-graph (import du graphe de connaissances de recherche curé — Experiment.Crypto M5, débloqué par P0/P1) ✅ Livré 2026-06-03`. Keep crypto/zettelkasten as remaining backlog.

- [ ] **Step 2: INVENTORY** — add to the graph-templates entry: `research-graph import template (Entity/Relates generic schema; ingests research-graph.json — curated Hypothesis/Experiment/Verdict/SDR + reasoning edges; gitnexus-side, emitter is Experiment.Crypto's later work).`

- [ ] **Step 3: Commit (tracked):**
```bash
git add ROADMAP.md INVENTORY.md
git commit -m "docs: research-graph template shipped (roadmap Template Library + inventory)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final: full verification

- [ ] **Step 1: Full unit tier green** — `bash tests/docker-test.sh unit` → all pass (incl. the new research-graph-importer + registry; baseline 524 + new tests, 0 failures).
- [ ] **Step 2: Drift** — `node scripts/check-patch-drift.mjs` exit 0.
- [ ] **Step 3: Stack boot + e2e** — build + boot the test stack (non-colliding ports), confirm the web container BOOTS (no `ERR_MODULE_NOT_FOUND` — proves the Dockerfile COPY), `/graph/templates` lists `research-graph`, and the scaffold→import→render of `research-graph` round-trips (6 nodes/6 edges, Entity/Relates DDL accepted by Kùzu, types + `validates` kind in the render). If Kùzu rejects the `Entity`/`Relates` DDL (unexpected — they're not reserved), report immediately. Teardown `down -v`.
- [ ] **Step 4: Finish** — push is the user's call; summarize the shipped template + that the Experiment.Crypto emitter (the `research-graph.json` producer) remains the user's later Alten-identity work.

---

## Self-Review

**Spec coverage:** §3.1 (separate from research-artifacts) → descriptor description (Task 2) + docs (Task 4). §3.2 (contract) → the fixture + importer consume exactly that shape (Tasks 1,3). §3.3 (generic Entity/Relates, edge type→kind) → Task 1 importer + Task 2 DDL + Task 2 Step 7 spec sync. §3.4 (components A-E) → Tasks 1-3. §4 (testing: unit/registry/integ, synthetic) → Tasks 1,2,3. §5 (gitnexus-only, no emitter, no Experiment.Crypto touch) → respected; the contract is defined, not the emitter. No gaps.

**Placeholder scan:** none — every code step has complete code; commands have expected output; the one contingency (Kùzu rejecting Entity/Relates) is an explicit report-if, not a vague catch-all.

**Type/name consistency:** `importResearchGraph` defined in Task 1, referenced in Task 2's IMPORTERS + Dockerfile COPY (`docker-server-research-graph-importer.mjs`). Generic shape `{table:'Entity', props}` / `{table:'Relates', from, to, props:{id, kind}}` identical across importer (Task 1), DDL (Task 2), and the integ assertion on render `kind` (Task 3). Template id `research-graph`, importer id `research-graph-json`, source dir `research-graph-corpus` consistent across Tasks 2-3.
