# Graph Templates — Stage 1 (web-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user scaffold a typed graph from a reusable template and populate it from local files — shipping `research-artifacts` end to end (CLI-free), entirely inside the `gitnexus-web` container, rendered by reusing the working single-graph Sigma canvas.

**Architecture:** Approach B from `docs/superpowers/specs/2026-06-02-graph-templates-design.md`. A pure-Node template **registry** + **research-fs importer** live in new `docker-server-*.mjs` modules in the `gitnexus-web` container (which has *no* Kùzu/lbug). The importer walks a source tree under `/data/projects`, parses frontmatter, and writes a **ResearchGraph JSON** to the writable `gitnexus-data` volume (`/data/gitnexus/research-graphs/`). Five HTTP routes expose templates/scaffold/import/list/get; three MCP tools wrap them; the frontend renders the JSON via a new `researchGraphToGraphology` adapter (mirroring the proven `groupGraphToGraphology`) mounted through the existing `useSigma().setGraph`. No Kùzu, no write to `gitnexus.config.json`, no CLI subcommand (all Stage 2, §7 of the spec).

**Tech Stack:** Node 22 ESM (`node:fs/promises`, `node:path`, `node:crypto`, `node:http`) for backend handlers (no external deps — manual frontmatter parsing, JSON only); React 19 + graphology + sigma for the frontend; vitest (jsdom unit / node integration) + Docker compose for tests; the fork's patch model (`patches/additive-files.diff` + `patches/inplace-edits.diff` + `Dockerfile.web` COPY + `check-patch-drift.mjs`).

**Commit identity:** all commits use `roblastar@live.fr` / `Robin DENIS` (already the repo's local git config — verify with `git -C . config user.email`).

---

## Data contract (threads through every task)

The single shared shape produced by the importer, stored on disk, served by the route, and rendered by the frontend:

```jsonc
// ResearchGraph
{
  "schema_type": "research-artifacts",
  "template": "research-artifacts",
  "name": "my-research",
  "source": "Experiment.Crypto.2026S1.RobinDenis",  // relative to /data/projects
  "generated": "2026-06-02T10:00:00.000Z",
  "nodes": [
    { "id": "a1b2c3d4e5f6", "type": "notebook", "label": "08 lifecycle windowed correlation",
      "path": "notebooks/01_exploration/08_RD_lifecycle_windowed_correlation.ipynb", "stage": "notebooks" }
  ],
  "edges": [
    { "id": "a1b2c3d4e5f6->validates->9f8e7d6c", "source": "a1b2c3d4e5f6", "target": "9f8e7d6c", "kind": "validates" }
  ],
  "report": {
    "nodes": 12, "edges": 4,
    "byType": { "notebook": 9, "note": 3 },
    "byKind": { "validates": 2, "derives_from": 2 },
    "unresolvedLinks": [{ "source": "a1b2c3d4e5f6", "to": "missing-id", "kind": "validates" }],
    "skipped": []
  }
}
```

- **Node `type`** (free string): `notebook | experiment | hypothesis | result | dataset | note`.
- **Edge `kind`** (free string): `derives_from | validates | contradicts | produces | contains`.
- **`id`** = `sha1(relPath)[:12]` unless frontmatter declares an explicit `id`.
- **Frontmatter source**: `.md` uses a leading `---` YAML block; `.ipynb` uses `metadata.gitnexus` (a JSON object). Recognized keys: `type`, `id`, `title`, `links: [{ to, kind }]`. `to` resolves against an explicit `id` or `sha1(relPath)[:12]`; unresolved → `report.unresolvedLinks` (never fatal).

---

## File structure

**Create (backend, web container — `upstream/`):**
- `upstream/docker-server-graph-templates-core.mjs` — registry (`registerTemplate`/`listTemplates`/`getTemplate`), built-in `research-artifacts` descriptor, store helpers (paths under `GITNEXUS_HOME`, read/write `index.json` + `<name>.json`), source-path sanitizer.
- `upstream/docker-server-research-fs-importer.mjs` — `importResearchFs(absSourceDir, opts) → ResearchGraph`.
- `upstream/docker-server-graph-templates.mjs` — `handleGraphTemplatesRoute(req, url, res, opts)` (5 routes).

**Create (frontend — `upstream/gitnexus-web/src/`):**
- `lib/research-colors.ts` — `RESEARCH_COLORS` palette.
- `lib/research-graph-adapter.ts` — `ResearchGraph` type + `researchGraphToGraphology()`.
- `services/research-client.ts` — fetch helpers for the 5 routes.

**Create (tests):**
- `tests/unit/graph-templates-registry.test.mjs`
- `tests/unit/research-fs-importer.test.mjs`
- `tests/unit/research-graph-adapter.test.mjs`
- `tests/integration/endpoints/graph-templates.test.mjs`
- `tests/integration/mcp/graph_templates.test.mjs`
- `tests/fixtures/make-research-fixture.mjs` (+ generated `tests/fixtures/research-sample.tar.gz`)

**Modify:**
- `upstream/docker-server-routes.mjs` — import + register the new route.
- `upstream/Dockerfile.web` — 3 `COPY` lines.
- `mcp-server/server.mjs` — +3 tools.
- `mcp-server/smoke.mjs` — reconcile + bump tool count.
- `upstream/gitnexus-web/src/components/GraphCanvas.tsx` — research-graph mount path.
- `upstream/gitnexus-web/src/App.tsx` + `components/GraphSidebar.tsx` — opt-in entry + "New research graph" action.
- `tests/README.md` — inventory rows.
- `patches/additive-files.diff`, `patches/inplace-edits.diff` — regenerated.

---

## Milestone A — Backend engine (web container, pure Node)

### Task A1: Template registry + store core module

**Files:**
- Create: `upstream/docker-server-graph-templates-core.mjs`
- Test: `tests/unit/graph-templates-registry.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/graph-templates-registry.test.mjs
import { describe, it, expect } from 'vitest';
import {
  listTemplates,
  getTemplate,
  registerTemplate,
  sanitizeSource,
} from '../../upstream/docker-server-graph-templates-core.mjs';

describe('graph-templates registry', () => {
  it('ships the built-in research-artifacts template', () => {
    const ids = listTemplates().map((t) => t.id);
    expect(ids).toContain('research-artifacts');
    const t = getTemplate('research-artifacts');
    expect(t.schema_type).toBe('research-artifacts');
    expect(t.importer).toBe('research-fs');
    expect(t.include).toEqual(['**/*.ipynb', '**/*.md']);
  });

  it('getTemplate returns null for unknown id', () => {
    expect(getTemplate('nope')).toBeNull();
  });

  it('registerTemplate adds and is builtin-protected', () => {
    registerTemplate({ id: 'demo', label: 'Demo', schema_type: 'demo', importer: 'research-fs' });
    expect(getTemplate('demo').label).toBe('Demo');
    expect(() => registerTemplate({ id: 'research-artifacts', label: 'x', schema_type: 'x', importer: 'research-fs' }))
      .toThrow(/builtin/);
  });

  it('sanitizeSource keeps paths inside the projects root and rejects traversal', () => {
    expect(sanitizeSource('foo/bar', '/data/projects')).toBe('/data/projects/foo/bar');
    expect(() => sanitizeSource('../../etc', '/data/projects')).toThrow(/outside/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs unit/graph-templates-registry.test.mjs`
Expected: FAIL — `Cannot find module '../../upstream/docker-server-graph-templates-core.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// upstream/docker-server-graph-templates-core.mjs
/**
 * Graph-templates engine (web container, pure Node — no Kùzu).
 * Registry + built-in template descriptors + JSON store on the gitnexus-data
 * volume. See docs/superpowers/specs/2026-06-02-graph-templates-design.md.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const HOME = process.env.GITNEXUS_HOME || '/data/gitnexus';
export const RESEARCH_DIR = join(HOME, 'research-graphs');
export const INDEX_PATH = join(RESEARCH_DIR, 'index.json');
export const PROJECTS_ROOT = process.env.GITNEXUS_PROJECTS || '/data/projects';

const BUILTINS = new Set(['research-artifacts']);

const registry = new Map();

/** A template descriptor is pure data: { id, label, schema_type, description, visual, importer, include, exclude }. */
export function registerTemplate(tpl) {
  if (!tpl || typeof tpl.id !== 'string' || !tpl.id) throw new Error('template needs a string id');
  if (registry.has(tpl.id) && BUILTINS.has(tpl.id)) {
    throw new Error(`cannot override builtin template "${tpl.id}"`);
  }
  registry.set(tpl.id, { exclude: [], include: [], visual: {}, ...tpl });
  return registry.get(tpl.id);
}

export function listTemplates() {
  return [...registry.values()];
}

export function getTemplate(id) {
  return registry.get(id) || null;
}

/** Resolve a user source path safely under the projects root (no traversal). */
export function sanitizeSource(source, root = PROJECTS_ROOT) {
  const abs = resolve(root, source || '.');
  const rootResolved = resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) {
    throw new Error(`source resolves outside projects root: ${source}`);
  }
  return abs;
}

// ---- store -------------------------------------------------------------

export async function readIndex() {
  try {
    return JSON.parse(await readFile(INDEX_PATH, 'utf8'));
  } catch {
    return { graphs: [] };
  }
}

export async function writeIndexRecord(record) {
  const index = await readIndex();
  const without = index.graphs.filter((g) => g.name !== record.name);
  without.push(record);
  index.graphs = without;
  await mkdir(dirname(INDEX_PATH), { recursive: true });
  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  return record;
}

export function graphPath(name) {
  return join(RESEARCH_DIR, `${name}.json`);
}

export async function writeGraph(name, graph) {
  await mkdir(RESEARCH_DIR, { recursive: true });
  await writeFile(graphPath(name), JSON.stringify(graph, null, 2), 'utf8');
}

export async function readGraph(name) {
  try {
    return JSON.parse(await readFile(graphPath(name), 'utf8'));
  } catch {
    return null;
  }
}

export async function graphExists(name) {
  return !!(await stat(graphPath(name)).catch(() => null));
}

// ---- built-in templates ------------------------------------------------

registerTemplate({
  id: 'research-artifacts',
  label: 'Research Artifacts',
  schema_type: 'research-artifacts',
  description:
    'Graph of local research artifacts (notebooks / notes) with derives-from / validates / contradicts links inferred from files + frontmatter.',
  importer: 'research-fs',
  include: ['**/*.ipynb', '**/*.md'],
  exclude: ['.git', 'node_modules', '.gitnexus', '.ipynb_checkpoints'],
  visual: {
    nodeColors: {
      notebook: '#3b82f6', experiment: '#f59e0b', hypothesis: '#a855f7',
      result: '#10b981', dataset: '#14b8a6', note: '#64748b',
    },
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs unit/graph-templates-registry.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-graph-templates-core.mjs tests/unit/graph-templates-registry.test.mjs
git commit -m "feat(graph-templates): registry + JSON store core (web container)"
```

---

### Task A2: research-fs importer

**Files:**
- Create: `upstream/docker-server-research-fs-importer.mjs`
- Test: `tests/unit/research-fs-importer.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/research-fs-importer.test.mjs
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importResearchFs } from '../../upstream/docker-server-research-fs-importer.mjs';

let dir;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'research-fs-'));
  await mkdir(join(dir, '01_exploration'), { recursive: true });
  // a .md with frontmatter declaring type + a link
  await writeFile(join(dir, '01_exploration', 'hypo.md'),
    '---\ntype: hypothesis\nid: h1\ntitle: Mean reversion\nlinks:\n  - to: r1\n    kind: validates\n---\n# Mean reversion\nbody');
  // a .md result the link points to
  await writeFile(join(dir, '01_exploration', 'result.md'),
    '---\ntype: result\nid: r1\n---\n# Result\n');
  // a notebook with metadata.gitnexus
  await writeFile(join(dir, '01_exploration', 'nb.ipynb'),
    JSON.stringify({ metadata: { gitnexus: { type: 'experiment', id: 'e1', title: 'Exp 1' } }, cells: [] }));
  // an excluded dir
  await mkdir(join(dir, '.ipynb_checkpoints'), { recursive: true });
  await writeFile(join(dir, '.ipynb_checkpoints', 'junk.md'), 'x');
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('importResearchFs', () => {
  it('builds nodes from files, honors frontmatter types, and resolves links', async () => {
    const g = await importResearchFs(dir, { include: ['**/*.ipynb', '**/*.md'], exclude: ['.ipynb_checkpoints'] });
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(byId.h1.type).toBe('hypothesis');
    expect(byId.h1.label).toBe('Mean reversion');
    expect(byId.r1.type).toBe('result');
    expect(byId.e1.type).toBe('experiment');
    expect(byId.h1.stage).toBe('01_exploration');
    // the validates link h1 -> r1 resolved into an edge
    const edge = g.edges.find((e) => e.source === 'h1' && e.target === 'r1');
    expect(edge.kind).toBe('validates');
    // excluded dir not walked
    expect(g.nodes.some((n) => n.path.includes('.ipynb_checkpoints'))).toBe(false);
    expect(g.report.byType.hypothesis).toBe(1);
  });

  it('records unresolved links instead of throwing', async () => {
    const d2 = await mkdtemp(join(tmpdir(), 'research-fs2-'));
    await writeFile(join(d2, 'a.md'), '---\nid: a\nlinks:\n  - to: ghost\n    kind: derives_from\n---\n# A');
    const g = await importResearchFs(d2, { include: ['**/*.md'], exclude: [] });
    expect(g.edges).toHaveLength(0);
    expect(g.report.unresolvedLinks[0]).toMatchObject({ source: 'a', to: 'ghost', kind: 'derives_from' });
    await rm(d2, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs unit/research-fs-importer.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// upstream/docker-server-research-fs-importer.mjs
/**
 * research-fs importer: walk a source tree, build a ResearchGraph (nodes from
 * files, edges from frontmatter links). Pure Node, no YAML lib — minimal
 * frontmatter parser (scalars + a `links:` list of `- to:`/`kind:` pairs).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep, extname } from 'node:path';
import { createHash } from 'node:crypto';

const MAX_FILES = 5000;

function hashId(relPath) {
  return createHash('sha1').update(relPath.split(sep).join('/')).digest('hex').slice(0, 12);
}

function firstHeading(text, fallback) {
  for (const line of text.split('\n')) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) return m[1];
  }
  return fallback;
}

/** Parse a leading `---` YAML block — scalars + a `links:` list. Returns {} if none. */
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = text.slice(text.indexOf('\n') + 1, end);
  const fm = {};
  const links = [];
  let inLinks = false;
  let cur = null;
  for (const raw of block.split('\n')) {
    if (/^links:\s*$/.test(raw)) { inLinks = true; continue; }
    if (inLinks) {
      const start = /^\s*-\s*to:\s*(.+?)\s*$/.exec(raw);
      const kind = /^\s*kind:\s*(.+?)\s*$/.exec(raw);
      if (start) { cur = { to: unquote(start[1]) }; links.push(cur); continue; }
      if (kind && cur) { cur.kind = unquote(kind[1]); continue; }
      if (/^\S/.test(raw)) inLinks = false; // dedent ends the block
    }
    const scalar = /^([A-Za-z_][\w-]*):\s*(.+?)\s*$/.exec(raw);
    if (!inLinks && scalar) fm[scalar[1]] = unquote(scalar[2]);
  }
  if (links.length) fm.links = links;
  return fm;
}

function unquote(s) {
  return s.replace(/^["']|["']$/g, '');
}

async function walk(root, exclude) {
  const out = [];
  const skip = new Set(exclude || []);
  async function recurse(dir) {
    if (out.length >= MAX_FILES) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.name.startsWith('.') && e.name !== '.') { if (skip.has(e.name) || e.name.startsWith('.')) continue; }
      if (skip.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await recurse(full);
      else if (e.isFile()) out.push(full);
    }
  }
  await recurse(root);
  return out;
}

function matchExt(file, include) {
  const ext = extname(file).toLowerCase();
  if (include.some((g) => g.endsWith('.ipynb')) && ext === '.ipynb') return true;
  if (include.some((g) => g.endsWith('.md')) && ext === '.md') return true;
  return false;
}

async function buildNode(absFile, root) {
  const rel = relative(root, absFile).split(sep).join('/');
  const stage = rel.includes('/') ? rel.split('/')[0] : '';
  const ext = extname(absFile).toLowerCase();
  let fm = {};
  let baseLabel = rel.split('/').pop();
  let defaultType = 'note';
  try {
    const raw = await readFile(absFile, 'utf8');
    if (ext === '.md') {
      fm = parseFrontmatter(raw);
      baseLabel = fm.title || firstHeading(raw, baseLabel);
      defaultType = 'note';
    } else if (ext === '.ipynb') {
      defaultType = 'notebook';
      const nb = JSON.parse(raw);
      fm = (nb.metadata && nb.metadata.gitnexus) || {};
      baseLabel = fm.title || baseLabel.replace(/\.ipynb$/, '').replace(/_/g, ' ');
    }
  } catch { /* unreadable → minimal node */ }
  const id = fm.id || hashId(rel);
  return {
    node: { id, type: fm.type || defaultType, label: baseLabel, path: rel, stage },
    links: Array.isArray(fm.links) ? fm.links : [],
    rel,
  };
}

export async function importResearchFs(absSourceDir, { include = ['**/*.ipynb', '**/*.md'], exclude = [] } = {}) {
  const files = (await walk(absSourceDir, exclude)).filter((f) => matchExt(f, include));
  const built = [];
  for (const f of files) built.push(await buildNode(f, absSourceDir));

  const nodes = built.map((b) => b.node);
  const idSet = new Set(nodes.map((n) => n.id));
  const relHash = new Map(built.map((b) => [hashId(b.rel), b.node.id]));

  const edges = [];
  const unresolvedLinks = [];
  for (const b of built) {
    for (const link of b.links) {
      const target = idSet.has(link.to) ? link.to : relHash.get(hashId(link.to));
      const kind = link.kind || 'derives_from';
      if (target) edges.push({ id: `${b.node.id}->${kind}->${target}`, source: b.node.id, target, kind });
      else unresolvedLinks.push({ source: b.node.id, to: link.to, kind });
    }
  }

  const byType = {};
  for (const n of nodes) byType[n.type] = (byType[n.type] || 0) + 1;
  const byKind = {};
  for (const e of edges) byKind[e.kind] = (byKind[e.kind] || 0) + 1;

  return {
    schema_type: 'research-artifacts',
    template: 'research-artifacts',
    name: null,
    source: null,
    generated: new Date().toISOString(),
    nodes,
    edges,
    report: { nodes: nodes.length, edges: edges.length, byType, byKind, unresolvedLinks, skipped: [] },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs unit/research-fs-importer.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-research-fs-importer.mjs tests/unit/research-fs-importer.test.mjs
git commit -m "feat(graph-templates): research-fs importer (walk + frontmatter -> ResearchGraph)"
```

---

### Task A3: HTTP route handler (5 routes)

**Files:**
- Create: `upstream/docker-server-graph-templates.mjs`

(No unit test here — covered by the integration test in Task D2, which exercises the live routes. This task is wiring over the unit-tested core.)

- [ ] **Step 1: Write the handler**

```javascript
// upstream/docker-server-graph-templates.mjs
/**
 * Graph templates routes (web container):
 *   GET  /graph/templates              -> { templates: [...] }
 *   POST /graph/scaffold               -> { record }            body: { templateId, name, source }
 *   POST /graph/import                 -> { report }            body: { name }
 *   GET  /graph/research               -> { graphs: [...] }
 *   GET  /graph/research/:name         -> ResearchGraph JSON
 */
import {
  listTemplates, getTemplate, sanitizeSource,
  readIndex, writeIndexRecord, writeGraph, readGraph,
} from './docker-server-graph-templates-core.mjs';
import { importResearchFs } from './docker-server-research-fs-importer.mjs';

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

const IMPORTERS = { 'research-fs': importResearchFs };

export async function handleGraphTemplatesRoute(req, url, res, _opts) {
  const path = url.pathname;

  if (path === '/graph/templates' && req.method === 'GET') {
    sendJson(res, 200, { templates: listTemplates() });
    return true;
  }

  if (path === '/graph/scaffold' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }); return true; }
    const { templateId, name, source } = body;
    const tpl = getTemplate(templateId);
    if (!tpl) { sendJson(res, 400, { error: `unknown template: ${templateId}` }); return true; }
    if (!name || !source) { sendJson(res, 400, { error: 'name and source are required' }); return true; }
    try { sanitizeSource(source); } catch (e) { sendJson(res, 400, { error: e.message }); return true; }
    const record = { name, template: tpl.id, schema_type: tpl.schema_type, source, created: new Date().toISOString() };
    await writeIndexRecord(record);
    sendJson(res, 201, { record });
    return true;
  }

  if (path === '/graph/import' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }); return true; }
    const { name } = body;
    const index = await readIndex();
    const record = index.graphs.find((g) => g.name === name);
    if (!record) { sendJson(res, 404, { error: `no scaffolded graph named "${name}"` }); return true; }
    const tpl = getTemplate(record.template);
    const importer = tpl && IMPORTERS[tpl.importer];
    if (!importer) { sendJson(res, 400, { error: `no importer for template ${record.template}` }); return true; }
    let abs;
    try { abs = sanitizeSource(record.source); } catch (e) { sendJson(res, 400, { error: e.message }); return true; }
    const graph = await importer(abs, { include: tpl.include, exclude: tpl.exclude });
    graph.name = name;
    graph.source = record.source;
    await writeGraph(name, graph); // replace = idempotent overwrite
    sendJson(res, 200, { report: graph.report });
    return true;
  }

  if (path === '/graph/research' && req.method === 'GET') {
    const index = await readIndex();
    sendJson(res, 200, { graphs: index.graphs });
    return true;
  }

  if (path.startsWith('/graph/research/') && req.method === 'GET') {
    const name = decodeURIComponent(path.slice('/graph/research/'.length));
    const graph = await readGraph(name);
    if (!graph) { sendJson(res, 404, { error: `graph "${name}" not found (scaffold + import first)` }); return true; }
    sendJson(res, 200, graph);
    return true;
  }

  return false;
}
```

- [ ] **Step 2: Sanity-check it imports cleanly**

Run: `node --check upstream/docker-server-graph-templates.mjs`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add upstream/docker-server-graph-templates.mjs
git commit -m "feat(graph-templates): 5 HTTP routes (templates/scaffold/import/list/get)"
```

---

### Task A4: Register the route + Dockerfile COPY

**Files:**
- Modify: `upstream/docker-server-routes.mjs` (import block 1-35; if-chain 38-75)
- Modify: `upstream/Dockerfile.web` (after line 125, `COPY docker-server-routes.mjs ...`)

- [ ] **Step 1: Add the import** — add this line at the end of the import block (after the `handleGroupGraphRoute` import, line 35):

```javascript
import { handleGraphTemplatesRoute } from './docker-server-graph-templates.mjs';
```

- [ ] **Step 2: Register in the if-chain** — insert immediately before `return false;` (current line 74→75), matching the `(req, reqUrl, res, ctx)` calling convention:

```javascript
  if (await handleGraphTemplatesRoute(req, reqUrl, res, ctx)) return true;
  return false;
```

- [ ] **Step 3: Add Dockerfile COPY lines** — in `upstream/Dockerfile.web`, immediately after the last handler copy (`COPY docker-server-routes.mjs ./docker-server-routes.mjs`, line 125), add the three new modules (individual COPYs, source=dest, matching the existing pattern):

```dockerfile
COPY docker-server-graph-templates-core.mjs ./docker-server-graph-templates-core.mjs
COPY docker-server-research-fs-importer.mjs ./docker-server-research-fs-importer.mjs
COPY docker-server-graph-templates.mjs ./docker-server-graph-templates.mjs
```

> ⚠️ A missing COPY crash-loops the container at boot — this is the #1 bug class in this repo. All three new modules MUST be copied.

- [ ] **Step 4: Verify routes module still parses**

Run: `node --check upstream/docker-server-routes.mjs`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-routes.mjs upstream/Dockerfile.web
git commit -m "feat(graph-templates): wire route into registry + Dockerfile.web COPY"
```

---

## Milestone B — MCP tools

### Task B1: Reconcile the smoke-test tool-count baseline

The smoke test (`mcp-server/smoke.mjs:89`) hard-asserts `tools.length === 21` and does not list `query_meta_graph`. The live `TOOLS` array already contains `query_meta_graph` (unprefixed). Establish a green baseline **before** adding tools.

**Files:**
- Modify: `mcp-server/smoke.mjs`

- [ ] **Step 1: Observe the real current count**

Run: `node -e "import('./mcp-server/server.mjs')" 2>$null; node -e "const m=require('node:fs').readFileSync('mcp-server/server.mjs','utf8'); console.log((m.match(/\n    name: '/g)||[]).length)"`
(Or simpler: count `name:` entries in the TOOLS array.) Note the actual number `N` (expected 22).

- [ ] **Step 2: Update the assertion + expected list to match reality**

In `mcp-server/smoke.mjs` (lines 89-101): set the count to the observed `N` and add `'query_meta_graph'` to the expected-names array so the baseline is honest:

```javascript
  if (tools.length !== 22) fail(`tools/list: expected 22 tools, got ${tools.length}`);
  for (const expected of [
    'gitnexus_list_repos', 'gitnexus_entropy', 'gitnexus_churn', 'gitnexus_coupling',
    'gitnexus_growth', 'gitnexus_lifespan', 'gitnexus_ownership', 'gitnexus_dissonance',
    'gitnexus_semantic_labels', 'gitnexus_coupling_cross', 'gitnexus_growth_cross',
    'gitnexus_similarity', 'gitnexus_entropy_commits', 'gitnexus_watches',
    'gitnexus_repo_by_id', 'gitnexus_commit_footprint', 'gitnexus_snapshot_auto',
    'gitnexus_snapshot_from_pr', 'gitnexus_ghost_audit', 'gitnexus_clusters',
    'gitnexus_regression', 'query_meta_graph',
  ]) {
```

> If Step 1 shows a number other than 22, use that number and reconcile the list to the actual tool names — the point is a green baseline, not a hard-coded 22.

- [ ] **Step 3: Commit**

```bash
git add mcp-server/smoke.mjs
git commit -m "test(mcp): reconcile smoke tool-count baseline (include query_meta_graph)"
```

---

### Task B2: Add the 3 graph-template MCP tools

**Files:**
- Modify: `mcp-server/server.mjs` (append to the `TOOLS` array)
- Modify: `mcp-server/smoke.mjs` (bump count by 3 + add names)

- [ ] **Step 1: Add the three tool entries** to the `TOOLS` array (mirror the `gitnexus_entropy` GET pattern and the `gitnexus_snapshot_from_pr` POST pattern verbatim — `callWeb` for GET, inline `fetch` POST with `AbortController`):

```javascript
  {
    name: 'gitnexus_list_graph_templates',
    description: 'List available graph templates (id, label, schema_type, description). Use before create_graph_from_template to discover what kinds of graphs can be scaffolded (e.g. research-artifacts).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => callWeb('/graph/templates'),
  },
  {
    name: 'gitnexus_create_graph_from_template',
    description: 'Scaffold a new graph from a template. Records the graph (name + template + source dir relative to /data/projects) so it can then be imported. Does NOT populate it — call gitnexus_import_into_graph next. Returns the index record.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: 'Template id from gitnexus_list_graph_templates (e.g. research-artifacts).' },
        name: { type: 'string', description: 'Unique name for the new graph.' },
        source: { type: 'string', description: 'Source directory relative to /data/projects (e.g. Experiment.Crypto.2026S1.RobinDenis).' },
      },
      required: ['templateId', 'name', 'source'],
      additionalProperties: false,
    },
    handler: async ({ templateId, name, source }) => {
      const url = `${WEB_URL}/graph/scaffold`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId, name, source }),
          signal: controller.signal,
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
        return json;
      } finally {
        clearTimeout(timer);
      }
    },
  },
  {
    name: 'gitnexus_import_into_graph',
    description: 'Populate a scaffolded graph by running its template importer over the source tree (research-fs walks notebooks/markdown + frontmatter). Re-import replaces the contents. Returns the import report (node/edge counts, unresolved links).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name of a graph created via gitnexus_create_graph_from_template.' } },
      required: ['name'],
      additionalProperties: false,
    },
    handler: async ({ name }) => {
      const url = `${WEB_URL}/graph/import`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
          signal: controller.signal,
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
        return json;
      } finally {
        clearTimeout(timer);
      }
    },
  },
```

- [ ] **Step 2: Bump the smoke assertion + names** — in `mcp-server/smoke.mjs`, change `22` → `25` and add the three names to the expected list:

```javascript
  if (tools.length !== 25) fail(`tools/list: expected 25 tools, got ${tools.length}`);
```
and append to the expected array:
```javascript
    'gitnexus_list_graph_templates', 'gitnexus_create_graph_from_template', 'gitnexus_import_into_graph',
```

- [ ] **Step 3: Run the smoke test against a running stack**

Run: `cd mcp-server && node smoke.mjs`
Expected: PASS — `tools/list` reports 25; the three new names are found. (Requires the gitnexus stack up; if it is not, run after Task D1 brings the test stack up.)

- [ ] **Step 4: Commit**

```bash
git add mcp-server/server.mjs mcp-server/smoke.mjs
git commit -m "feat(mcp): add list_graph_templates / create_graph_from_template / import_into_graph"
```

---

## Milestone C — Frontend (reuse the working canvas)

### Task C1: Research color palette

**Files:**
- Create: `upstream/gitnexus-web/src/lib/research-colors.ts`

- [ ] **Step 1: Write the module** (no test — trivial constant, exercised by C2's test):

```typescript
// upstream/gitnexus-web/src/lib/research-colors.ts
// Per-type colors for research-artifacts graphs (node.type -> hex).
// Mirrors the template's visual.nodeColors in docker-server-graph-templates-core.mjs.
export const RESEARCH_COLORS: Record<string, string> = {
  notebook: '#3b82f6',
  experiment: '#f59e0b',
  hypothesis: '#a855f7',
  result: '#10b981',
  dataset: '#14b8a6',
  note: '#64748b',
};

export const RESEARCH_FALLBACK_COLOR = '#9ca3af';
```

- [ ] **Step 2: Commit**

```bash
git add upstream/gitnexus-web/src/lib/research-colors.ts
git commit -m "feat(graph-templates): research node color palette"
```

---

### Task C2: research-graph-adapter (ResearchGraph JSON → graphology)

Mirrors the proven `groupGraphToGraphology` (`upstream/gitnexus-web/src/lib/group-graph-adapter.ts`) and produces the identical `Graph<SigmaNodeAttributes, SigmaEdgeAttributes>` that `useSigma().setGraph` consumes.

**Files:**
- Create: `upstream/gitnexus-web/src/lib/research-graph-adapter.ts`
- Test: `tests/unit/research-graph-adapter.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/research-graph-adapter.test.mjs
import { describe, it, expect } from 'vitest';
import { researchGraphToGraphology } from '../../upstream/gitnexus-web/src/lib/research-graph-adapter';

const rg = {
  schema_type: 'research-artifacts',
  nodes: [
    { id: 'h1', type: 'hypothesis', label: 'H1', path: 'a/h1.md', stage: 'a' },
    { id: 'r1', type: 'result', label: 'R1', path: 'a/r1.md', stage: 'a' },
    { id: 'x', type: 'mystery', label: 'X', path: 'a/x.md', stage: 'a' },
  ],
  edges: [{ id: 'h1->validates->r1', source: 'h1', target: 'r1', kind: 'validates' }],
};

describe('researchGraphToGraphology', () => {
  it('creates one node per ResearchGraph node with palette colors', () => {
    const g = researchGraphToGraphology(rg);
    expect(g.order).toBe(3);
    expect(g.size).toBe(1);
    expect(g.getNodeAttribute('h1', 'color')).toBe('#a855f7');
    expect(g.getNodeAttribute('r1', 'color')).toBe('#10b981');
    expect(g.getNodeAttribute('h1', 'label')).toBe('H1');
  });

  it('falls back to gray for unknown types', () => {
    const g = researchGraphToGraphology(rg);
    expect(g.getNodeAttribute('x', 'color')).toBe('#9ca3af');
  });

  it('skips edges with missing endpoints without throwing', () => {
    const g = researchGraphToGraphology({ nodes: [{ id: 'h1', type: 'note', label: 'H', path: 'h.md', stage: '' }], edges: [{ id: 'e', source: 'h1', target: 'ghost', kind: 'validates' }] });
    expect(g.order).toBe(1);
    expect(g.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs unit/research-graph-adapter.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// upstream/gitnexus-web/src/lib/research-graph-adapter.ts
import Graph from 'graphology';
import type { SigmaNodeAttributes, SigmaEdgeAttributes } from './graph-adapter';
import { RESEARCH_COLORS, RESEARCH_FALLBACK_COLOR } from './research-colors';

export interface ResearchNode {
  id: string;
  type: string;
  label: string;
  path: string;
  stage: string;
}
export interface ResearchEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
}
export interface ResearchGraph {
  schema_type?: string;
  template?: string;
  name?: string | null;
  source?: string | null;
  generated?: string;
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  report?: unknown;
}

const EDGE_COLOR = '#475569';

/**
 * Convert a ResearchGraph JSON into a graphology graph ready for useSigma().setGraph.
 * Positions are seeded on a circle (deterministic); ForceAtlas2 in setGraph converges them.
 * Mirrors group-graph-adapter.ts.
 */
export function researchGraphToGraphology(
  rg: ResearchGraph,
): Graph<SigmaNodeAttributes, SigmaEdgeAttributes> {
  const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const nodes = rg.nodes || [];
  const total = Math.max(1, nodes.length);
  const radius = Math.sqrt(total) * 30;

  let i = 0;
  for (const node of nodes) {
    if (graph.hasNode(node.id)) continue;
    const angle = (i / total) * 2 * Math.PI;
    const r = radius * (0.5 + ((i % 50) / 50) * 0.5);
    graph.addNode(node.id, {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      size: 5,
      color: RESEARCH_COLORS[node.type] || RESEARCH_FALLBACK_COLOR,
      label: node.label,
      nodeType: 'CodeElement',
      filePath: node.path,
      mass: 3,
    });
    i++;
  }

  for (const e of rg.edges || []) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    if (e.source === e.target) continue;
    if (graph.hasEdge(e.source, e.target)) continue;
    graph.addEdge(e.source, e.target, {
      size: 1,
      color: EDGE_COLOR,
      relationType: e.kind,
      type: 'curved',
      zIndex: 1,
    });
  }
  return graph;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs unit/research-graph-adapter.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add upstream/gitnexus-web/src/lib/research-graph-adapter.ts tests/unit/research-graph-adapter.test.mjs
git commit -m "feat(graph-templates): researchGraphToGraphology adapter (mirrors group adapter)"
```

---

### Task C3: research-client service

**Files:**
- Create: `upstream/gitnexus-web/src/services/research-client.ts`

- [ ] **Step 1: Write the module** (thin fetch wrappers; verified by the integration test which hits the same routes):

```typescript
// upstream/gitnexus-web/src/services/research-client.ts
import type { ResearchGraph } from '../lib/research-graph-adapter';

export interface GraphTemplate {
  id: string;
  label: string;
  schema_type: string;
  description?: string;
  visual?: { nodeColors?: Record<string, string> };
}
export interface ResearchRecord {
  name: string;
  template: string;
  schema_type: string;
  source: string;
  created: string;
}

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body;
}

export async function listTemplates(): Promise<GraphTemplate[]> {
  return (await jsonOrThrow(await fetch('/graph/templates'))).templates;
}
export async function listResearchGraphs(): Promise<ResearchRecord[]> {
  return (await jsonOrThrow(await fetch('/graph/research'))).graphs;
}
export async function getResearchGraph(name: string): Promise<ResearchGraph> {
  return jsonOrThrow(await fetch(`/graph/research/${encodeURIComponent(name)}`));
}
export async function scaffoldGraph(templateId: string, name: string, source: string): Promise<ResearchRecord> {
  const res = await fetch('/graph/scaffold', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, name, source }),
  });
  return (await jsonOrThrow(res)).record;
}
export async function importGraph(name: string): Promise<{ nodes: number; edges: number }> {
  const res = await fetch('/graph/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return (await jsonOrThrow(res)).report;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd upstream/gitnexus-web && npx tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add upstream/gitnexus-web/src/services/research-client.ts
git commit -m "feat(graph-templates): research-client service (fetch wrappers)"
```

---

### Task C4: Mount the research graph in GraphCanvas

Add a research-graph render path mirroring the existing group-graph path in `GraphCanvas.tsx` (lines 307-312, `setSigmaGraph(groupGraphToGraphology(...), { cacheKey })`). Opt-in via `?research=<name>` so the default single-graph path is untouched.

**Files:**
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx`

- [ ] **Step 1: Import the adapter + client** — add near the existing adapter imports:

```typescript
import { researchGraphToGraphology, type ResearchGraph } from '../lib/research-graph-adapter';
import { getResearchGraph } from '../services/research-client';
```

- [ ] **Step 2: Read the opt-in + fetch state** — inside the component, near the other `useState` hooks, add:

```typescript
const researchName = new URLSearchParams(window.location.search).get('research');
const [researchData, setResearchData] = useState<ResearchGraph | null>(null);

useEffect(() => {
  if (!researchName) return;
  getResearchGraph(researchName).then(setResearchData).catch((e) => console.error('research graph load failed', e));
}, [researchName]);
```

- [ ] **Step 3: Mount it** — add an effect mirroring the group-graph effect (the block at lines 307-312), guarded so it does not collide with the single-graph / group-graph effects:

```typescript
// Research graph — mount JSON-derived graph when ?research=<name> is set
useEffect(() => {
  if (!researchName || !researchData) return;
  const g = researchGraphToGraphology(researchData);
  setSigmaGraph(g, { cacheKey: `research:${researchName}` });
}, [researchName, researchData, setSigmaGraph]);
```

> Note: `setSigmaGraph` is the existing `setGraph` returned by `useSigma()` (already destructured in this component as `setSigmaGraph`). If the local alias differs, use the existing destructured name.

- [ ] **Step 4: Guard the default-graph effect** — in the existing "Update Sigma graph when KnowledgeGraph changes" effect (line 281), add an early return so the research view does not get overwritten by the empty single-graph state:

```typescript
  useEffect(() => {
    if (groupGraphActive) return;
    if (researchName) return; // research view owns the canvas
    if (!graph) return;
    // ...unchanged...
```

- [ ] **Step 5: Typecheck + manual verification**

Run: `cd upstream/gitnexus-web && npx tsc --noEmit`
Expected: 0 new errors.

Manual (after the test stack is up — Task D1): scaffold + import a graph, then open `http://localhost:4173/?research=<name>` and confirm colored nodes render and lay out. (This is the §4.5 risk-closure check from the spec.)

- [ ] **Step 6: Commit**

```bash
git add upstream/gitnexus-web/src/components/GraphCanvas.tsx
git commit -m "feat(graph-templates): render research graph via ?research=<name> (reuses Sigma canvas)"
```

---

### Task C5: Sidebar "New research graph" action

**Files:**
- Modify: `upstream/gitnexus-web/src/components/GraphSidebar.tsx`
- Modify: `upstream/gitnexus-web/src/App.tsx`

- [ ] **Step 1: Add an `onNewGraph` prop + button to GraphSidebar** — extend the props interface and render a header button:

```typescript
// in GraphSidebarProps
  onNewGraph?: () => void;
```
```tsx
// in the component header, next to the "Graphs" title
{onNewGraph && (
  <button onClick={onNewGraph} className="text-xs px-2 py-1 rounded hover:bg-slate-800">+ New</button>
)}
```

- [ ] **Step 2: Wire a minimal create flow in App.tsx** — where `GraphSidebar` is rendered under the `?multigraph=1` early return, pass a handler that prompts for template/name/source, scaffolds, imports, and navigates to the research view:

```tsx
import { listTemplates, scaffoldGraph, importGraph } from './services/research-client';

const handleNewGraph = useCallback(async () => {
  const templates = await listTemplates();
  const templateId = window.prompt(`Template id (${templates.map((t) => t.id).join(', ')})`, 'research-artifacts');
  if (!templateId) return;
  const name = window.prompt('New graph name');
  if (!name) return;
  const source = window.prompt('Source dir (relative to /data/projects)');
  if (!source) return;
  await scaffoldGraph(templateId, name, source);
  await importGraph(name);
  window.location.search = `?research=${encodeURIComponent(name)}`;
}, []);
```
and pass `onNewGraph={handleNewGraph}` to `<GraphSidebar .../>`.

> `window.prompt` is a deliberate v1 minimal UI (a polished wizard is out of scope per the spec). It is enough to drive the end-to-end flow.

- [ ] **Step 3: Typecheck**

Run: `cd upstream/gitnexus-web && npx tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add upstream/gitnexus-web/src/components/GraphSidebar.tsx upstream/gitnexus-web/src/App.tsx
git commit -m "feat(graph-templates): sidebar New-research-graph action (minimal prompt flow)"
```

---

## Milestone D — Fixtures, integration tests, patches, CI

### Task D1: research-sample test fixture

**Files:**
- Create: `tests/fixtures/make-research-fixture.mjs`
- Generated: `tests/fixtures/research-sample.tar.gz`

- [ ] **Step 1: Write the fixture builder** (mirrors `tests/fixtures/make-fixture.mjs` — deterministic git history + byte-identical tarball):

```javascript
// tests/fixtures/make-research-fixture.mjs
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '_build', 'research-sample');
const TARBALL = join(HERE, 'research-sample.tar.gz');
const ALICE = 'Alice <alice@research>';

rmSync(REPO, { recursive: true, force: true });
mkdirSync(join(REPO, '01_exploration'), { recursive: true });
const sh = (cmd) => execSync(cmd, { cwd: REPO, stdio: 'pipe' });
sh('git init -q -b main');

function write(path, content) {
  const full = join(REPO, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

write('01_exploration/hypo.md', '---\ntype: hypothesis\nid: h1\ntitle: Mean reversion\nlinks:\n  - to: r1\n    kind: validates\n---\n# Mean reversion\n');
write('01_exploration/result.md', '---\ntype: result\nid: r1\n---\n# Result\n');
write('01_exploration/nb.ipynb', JSON.stringify({ metadata: { gitnexus: { type: 'experiment', id: 'e1', title: 'Exp 1' } }, cells: [] }));

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Alice', GIT_AUTHOR_EMAIL: 'alice@research', GIT_AUTHOR_DATE: '2025-03-01T10:00:00 +0100',
  GIT_COMMITTER_NAME: 'Alice', GIT_COMMITTER_EMAIL: 'alice@research', GIT_COMMITTER_DATE: '2025-03-01T10:00:00 +0100',
};
execSync('git add -A', { cwd: REPO, env, stdio: 'pipe' });
execSync('git commit -m "research sample"', { cwd: REPO, env, stdio: 'pipe' });

sh('git gc --quiet --prune=all');
sh('git read-tree HEAD');

const buildParent = join(REPO, '..');
execSync(
  `tar -czf "../research-sample.tar.gz" --sort=name --mtime='2025-03-01T00:00:00Z' --owner=0 --group=0 --numeric-owner research-sample`,
  { cwd: buildParent, stdio: 'inherit' },
);
console.log(`Wrote ${TARBALL}`);
```

- [ ] **Step 2: Generate the tarball**

Run: `node tests/fixtures/make-research-fixture.mjs`
Expected: `Wrote .../tests/fixtures/research-sample.tar.gz`.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/make-research-fixture.mjs tests/fixtures/research-sample.tar.gz
git commit -m "test(graph-templates): research-sample fixture + builder"
```

---

### Task D2: Endpoint integration test

**Files:**
- Create: `tests/integration/endpoints/graph-templates.test.mjs`
- Modify: `tests/integration/helpers/stack.mjs` (add `extractResearchFixture()`)

The default integration stack mounts the `sample-repo` fixture at `/data/projects/sample-repo` (the importer can run over any directory under the projects root). For a focused research fixture, mount it explicitly; the simplest path for Stage 1 is to run the research importer against the already-mounted `sample-repo` source plus a dedicated assertion that the templates/scaffold/import/get chain works.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/integration/endpoints/graph-templates.test.mjs
import { describe, it, expect } from 'vitest';

const BASE = `http://localhost:${process.env.TEST_WEB_PORT || 4173}`;

describe('graph-templates routes', () => {
  it('lists the built-in research-artifacts template', async () => {
    const res = await fetch(`${BASE}/graph/templates`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates.map((t) => t.id)).toContain('research-artifacts');
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
});
```

- [ ] **Step 2: Run it (brings up the stack via global-setup)**

Run: `cd tests && npx vitest run --config vitest.config.integ.mjs integration/endpoints/graph-templates.test.mjs`
Expected: PASS (3 tests). If routes 404, confirm Task A4 wiring + that the test image was rebuilt (`docker compose -f docker-compose.test.yml build`).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/graph-templates.test.mjs
git commit -m "test(graph-templates): endpoint integration (scaffold -> import -> get)"
```

---

### Task D3: MCP integration test

**Files:**
- Create: `tests/integration/mcp/graph_templates.test.mjs`

- [ ] **Step 1: Write the failing test** (mirror `tests/integration/mcp/ghost_audit.test.mjs` JSON-RPC stdio pattern):

```javascript
// tests/integration/mcp/graph_templates.test.mjs
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(here, '..', '..', '..', 'mcp-server', 'server.mjs');

let server, rl, nextId = 1;
function send(method, params) {
  return new Promise((resolve) => {
    const id = nextId++;
    const onLine = (line) => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.id === id) { rl.off('line', onLine); resolve(msg); }
    };
    rl.on('line', onLine);
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

beforeAll(async () => {
  server = spawn(process.execPath, [SERVER_PATH], { stdio: ['pipe', 'pipe', 'inherit'] });
  rl = createInterface({ input: server.stdout });
  await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'vitest', version: '0' } });
});
afterAll(() => server?.kill());

describe('MCP graph-template tools', () => {
  it('exposes the three new tools', async () => {
    const list = await send('tools/list');
    const names = list.result.tools.map((t) => t.name);
    expect(names).toContain('gitnexus_list_graph_templates');
    expect(names).toContain('gitnexus_create_graph_from_template');
    expect(names).toContain('gitnexus_import_into_graph');
  });

  it('list_graph_templates returns research-artifacts', async () => {
    const r = await send('tools/call', { name: 'gitnexus_list_graph_templates', arguments: {} });
    expect(r.result.isError).toBe(false);
    expect(r.result.content[0].text).toContain('research-artifacts');
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd tests && npx vitest run --config vitest.config.integ.mjs integration/mcp/graph_templates.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/mcp/graph_templates.test.mjs
git commit -m "test(graph-templates): MCP tool integration (list + 3 tools present)"
```

---

### Task D4: Inventory rows + full suite

**Files:**
- Modify: `tests/README.md`

- [ ] **Step 1: Add inventory rows** so `scripts/check-test-inventory.mjs` passes. In the unit section add:

```markdown
| Graph templates registry | `unit/graph-templates-registry.test.mjs` | registry list/get + builtin-protect + sanitizeSource |
| Research-fs importer | `unit/research-fs-importer.test.mjs` | walk + frontmatter types + link resolution + unresolved report |
| Research graph adapter | `unit/research-graph-adapter.test.mjs` | ResearchGraph -> graphology nodes/colors/edges |
```

In the endpoints integration section add:

```markdown
| Graph templates | `integration/endpoints/graph-templates.test.mjs` | `/graph/templates` + scaffold -> import -> `/graph/research/:name` + 400 unknown template |
```

In the MCP integration section add:

```markdown
| Graph template tools | `integration/mcp/graph_templates.test.mjs` | 3 new tools present + list_graph_templates returns research-artifacts |
```

- [ ] **Step 2: Run the inventory check + full unit suite**

Run: `node scripts/check-test-inventory.mjs`
Expected: `OK — N test files all listed in tests/README.md`.

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs`
Expected: all unit tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/README.md
git commit -m "test(graph-templates): register tests in inventory"
```

---

### Task D5: Regenerate patches + drift check

**Files:**
- Modify: `patches/additive-files.diff`, `patches/inplace-edits.diff`

- [ ] **Step 1: Regenerate the patch diffs** from the upstream working clone (the canonical command in this repo — confirm exact form against `patches/README.md`):

```bash
cd upstream && git add -A && git diff --cached --diff-filter=A > ../patches/additive-files.diff && git diff --cached --diff-filter=M > ../patches/inplace-edits.diff && git reset
```

> The new files (`docker-server-graph-templates*.mjs`, `research-graph-adapter.ts`, `research-colors.ts`, `research-client.ts`) land in `additive-files.diff`; the edits to `docker-server-routes.mjs`, `GraphCanvas.tsx`, `App.tsx`, `GraphSidebar.tsx` land in `inplace-edits.diff`.

- [ ] **Step 2: Run the drift guard**

Run: `node scripts/check-patch-drift.mjs`
Expected: exit 0 (committed diffs match the upstream clone).

- [ ] **Step 3: Rebuild + smoke the stack to confirm no crash-loop**

Run: `docker compose -f docker-compose.test.yml build && cd tests && npx vitest run --config vitest.config.integ.mjs integration/stack-health.test.mjs`
Expected: stack healthy (confirms the new COPY lines + route registration boot cleanly).

- [ ] **Step 4: Commit**

```bash
git add patches/additive-files.diff patches/inplace-edits.diff
git commit -m "chore(graph-templates): regenerate patches (additive + inplace)"
```

---

### Task D6: Roadmap + inventory + run full pyramid

**Files:**
- Modify: `ROADMAP.md`, `INVENTORY.md`

- [ ] **Step 1: Record the shipped feature** — add a row to the "Already shipped" table in `ROADMAP.md` (graph-templates Stage 1: research-artifacts) and document the 5 new endpoints + 3 MCP tools + research view in `INVENTORY.md` (per the workspace changelog discipline).

- [ ] **Step 2: Run the full suite**

Run: `cd tests && npm test` (unit + integ)
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md INVENTORY.md
git commit -m "docs(graph-templates): roadmap + inventory for Stage 1"
```

---

## Self-Review

**1. Spec coverage (§ of `2026-06-02-graph-templates-design.md` → task):**
- §4.1 registry → A1. §4.2 importer → A2. §4.3 storage (gitnexus-data, index.json) → A1 (store) + A3 (writes). §4.4 five routes → A3 + A4. §4.5 frontend render reuse + palette → C1/C2/C4. §4.6 MCP +3 + smoke reconcile → B1/B2. §4.8 build (COPY, patch regen, tests, inventory) → A4/D1-D6. §8 scope (no Kùzu/no config.json/no CLI) → respected (storage is JSON on gitnexus-data; no `gitnexus.config.json` write; no CLI task). §9 open Qs → resolved in A1 (paths, glob in descriptor, no privacy_class/ttl). No gaps found.

**2. Placeholder scan:** every code step contains complete code; commands have expected output. The one exec-time judgement (C4 Step 3 `setSigmaGraph` local alias) is anchored to the verbatim GraphCanvas code (line 304 uses `setSigmaGraph`) — concrete, not a placeholder. D5 Step 1 says "confirm exact form against patches/README.md" — the command is given; this is a safety cross-check, not a missing value.

**3. Type consistency:** `ResearchGraph`/`ResearchNode`/`ResearchEdge` defined in C2 and reused by C3/C4. Importer (A2) emits exactly the C2 shape (`nodes[].{id,type,label,path,stage}`, `edges[].{id,source,target,kind}`, `report`). Route handler (A3) imports the exact core exports defined in A1 (`listTemplates`, `getTemplate`, `sanitizeSource`, `readIndex`, `writeIndexRecord`, `writeGraph`, `readGraph`). MCP tools (B2) call the exact routes A3 serves. Handler signature `(req, url, res, opts)` matches the registry call `(req, reqUrl, res, ctx)`. Consistent.

---

## Notes for the executor

- **Run unit tests on the host** (`cd tests && npx vitest run --config vitest.config.unit.mjs ...`); integration tests need the Docker stack (global-setup brings it up) and a Node 22 host.
- **Rebuild the web image** after any `upstream/docker-server-*.mjs` or `Dockerfile.web` change, or routes will 404 / the container will crash-loop. Verify via `integration/stack-health.test.mjs`.
- **Stage 2 (real Kùzu in the multigraph viewer)** is explicitly out of scope — see §7 of the spec. Do not relocate logic into the backend npm image.
