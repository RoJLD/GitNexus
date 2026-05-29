# Multi-Repo Unified Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un graphe multi-repo unifié : groupe nommé (synchronisé via la CLI `gitnexus group` dans le conteneur serveur), endpoint `/graph/merged?group=` qui fusionne les graphes per-repo au niveau fichier + ajoute les arêtes cross-repo des contrats, et un mode "Group graph" dans le canvas web (nodes colorés par repo + arêtes cross-repo + drill-in).

**Architecture:** 4 sous-systèmes : (1) endpoints group dans le worker existant du conteneur gitnexus ; (2) `docker-server-group.mjs` (sync proxy + status + /groups) ; (3) core pur `collapseToFileLevel`/`mergeRepoGraphs` + `docker-server-group-graph.mjs` (`GET /graph/merged`) ; (4) frontend group-graph mode. Les contrats (`contracts.json`) sont lus depuis le volume partagé `gitnexus-data` ; `/api/graph` est fetché depuis le serveur API (`gitnexus:4747`).

**Tech Stack:** Node zéro-dep (worker + docker-server), React + TS + Sigma, Vitest 4 (unit + integration), Playwright (e2e), Docker.

**Spec source:** [`docs/superpowers/specs/2026-05-29-multi-repo-unified-graph-design.md`](../specs/2026-05-29-multi-repo-unified-graph-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

---

## Environment notes

**Node 21** : vitest crashe (rolldown). Tests committés "blind", CI Node 22 valide. `npm run test:unit` peut crasher → ATTENDU.

**Patches/upstream-all.diff** : UTF-16 LE + CRLF via PowerShell `Out-File -Encoding Unicode`. Regen à chaque tâche touchant `upstream/`. `wiki-worker.mjs` + `Dockerfile.cli` sont à la RACINE (top-level tracked, commit direct — pas dans le patch). Commande regen :

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
```

**Parallel session** : fichiers chauds (docker-server.mjs, useAppState.tsx, GraphCanvas.tsx, Dockerfile.web). Committer vite. Avant chaque commit : `git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null`. Ne JAMAIS committer : `.claude/`, `AGENTS.md`, `roadmap.yml`, `tests/package-lock.json`.

**Git identity** : déjà `roblastar@live.fr`.

**Verified data shapes (controller):**
- `GET /api/graph` → `{ nodes: [{ id, label, properties:{ name, filePath, ... } }], relationships: [{ id, sourceId, targetId, type, ... }] }`. FILE node = `label === 'File'`. EVERY node has `properties.filePath`. Edges use **`sourceId`/`targetId`** (not source/target). Served by the **API server** (`http://gitnexus:4747/api/graph?repo=X`), not the web server.
- `contracts.json` = `{ version, generatedAt, repoSnapshots, missingRepos, contracts, crossLinks }`. `CrossLink` = `{ from:{ repo, symbolUid, symbolRef:{ filePath, name } }, to:{ repo, symbolUid, symbolRef:{ filePath, name } }, type, contractId, matchType, confidence }`. **`symbolRef.filePath` is present** → build cross-repo file edges directly; NO symbolToFile map needed.
- `group.yaml` = `GroupConfig` with `repos: Record<groupPath, registryName>` (a MAP). Member repo names = the VALUES.
- `gitnexus group` CLI: `group create <name>` ; `group add <name> <groupPath> <registryName>` (THREE args) ; `group sync <name>` ; `group list` ; `group status <name>`. To make `crossLink.repo` match the graph repo name, the worker uses the registry name as BOTH groupPath and registryName (`group add <name> <repo> <repo>`).
- `wiki-worker.mjs` (repo root): `state` Map keyed by name; routes `/generate`(POST)/`/status`(GET)/`/health`; spawn `spawn(GITNEXUS_BIN, ['wiki', repoPath], { stdio:['ignore','pipe','pipe'], env: process.env })`; repo→path via `GET ${API}/api/repos` (`API=http://localhost:4747`).
- `gitnexus-data` volume (`/data/gitnexus`, = `GITNEXUS_HOME`) is mounted in BOTH containers → web reads `/data/gitnexus/groups/<name>/{group.yaml,contracts.json}` directly.

---

## File Structure

| Path | Rôle | Tâche |
|---|---|---|
| `wiki-worker.mjs` (root) | MOD — + `POST /group/sync`, `GET /group/status` (spawn group CLI) | T2 |
| `upstream/docker-server-group.mjs` | NEW — `POST /group/sync` (proxy), `GET /group/status` (proxy), `GET /groups` (read volume) | T3 |
| `upstream/docker-server-group-graph-core.mjs` | NEW — pure `collapseToFileLevel` + `mergeRepoGraphs` | T4 |
| `upstream/docker-server-group-graph.mjs` | NEW — `GET /graph/merged?group=` | T5 |
| `upstream/docker-server.mjs` | MOD — mount group + group-graph routes | T3, T5 |
| `upstream/Dockerfile.web` | MOD — COPY the 3 new modules | T3, T5 |
| `upstream/gitnexus-web/src/hooks/useAppState.tsx` | MOD — group-graph mode state | T6 |
| `upstream/gitnexus-web/src/components/GroupGraphPanel.tsx` | NEW — list/create/sync/view | T6 |
| `upstream/gitnexus-web/src/components/GraphCanvas.tsx` (+ useSigma) | MOD — repo-color reducer + cross-repo edge style + legend | T7 |
| `tests/unit/group-graph-core.test.mjs` | NEW | T4 |
| `tests/integration/endpoints/group-graph.test.mjs` | NEW | T8 |
| `tests/e2e/specs/group-graph.spec.ts` | NEW | T8 |
| `ROADMAP.md` / `INVENTORY.md` / `tests/README.md` / `CLAUDE.md` | docs | T9 |

---

## Task 1: Verify `gitnexus group` in the container (gate, no code)

- [ ] **Step 1: Confirm the CLI subcommands exist**

The worker will spawn `gitnexus group ...`. Confirm the binary supports it. If the stack is up: `docker compose exec gitnexus gitnexus group --help` (or `docker compose exec gitnexus gitnexus group list`). Expected: help listing `create`/`add`/`sync`/`list`/`status`. If the stack isn't up, confirm via source: `grep -n "group" upstream/gitnexus/src/cli/index.ts` shows the `group` command registered (it does — same binary as `gitnexus wiki`).

- [ ] **Step 2: Record**

No code. Report: "Confirmed — `gitnexus group create/add/sync/status` available." If `group` is NOT a subcommand, STOP and report BLOCKED.

---

## Task 2: Group-sync endpoints in `wiki-worker.mjs` (server container)

**Files:**
- Modify: `wiki-worker.mjs` (repo root, top-level tracked, committed directly)

- [ ] **Step 1: Add group state + endpoints**

In `wiki-worker.mjs`, add a separate in-progress map for groups + a `runGroupSync` + two routes, mirroring the wiki patterns. Add near the existing `state` map:

```javascript
// Group sync in-progress state, keyed by group name.
const groupState = new Map();

function resolveRepoPathSync(reposList, name) {
  const repo = Array.isArray(reposList) ? reposList.find((r) => r.name === name) : null;
  return repo ? repo.repoPath || repo.path || null : null;
}

async function runGroupSync(name, repoNames) {
  groupState.set(name, { syncing: true, error: null, finishedAt: null });
  // create (ignore "exists"), add each repo (groupPath == registryName so the
  // contracts' crossLink.repo matches the graph repo name), then sync.
  const run = (args) => new Promise((resolve) => {
    const c = spawn(GITNEXUS_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let err = '';
    c.stderr.on('data', (d) => { err += d.toString(); if (err.length > 4000) err = err.slice(-4000); });
    c.on('error', (e) => resolve({ code: -1, err: String(e && e.message || e) }));
    c.on('close', (code) => resolve({ code, err }));
  });
  try {
    await run(['group', 'create', name]); // ignore failure if it already exists
    for (const repo of repoNames) {
      await run(['group', 'add', name, repo, repo]); // <group> <groupPath> <registryName>
    }
    const sync = await run(['group', 'sync', name]);
    groupState.set(name, {
      syncing: false,
      error: sync.code === 0 ? null : `group sync exited ${sync.code}: ${sync.err.trim().slice(-500)}`,
      finishedAt: Date.now(),
    });
  } catch (e) {
    groupState.set(name, { syncing: false, error: String(e && e.message || e), finishedAt: Date.now() });
  }
}
```

In the request handler (mirror the existing `if (url.pathname === '/generate' ...)` blocks), add:

```javascript
  if (url.pathname === '/group/sync' && req.method === 'POST') {
    const name = url.searchParams.get('name');
    const reposCsv = url.searchParams.get('repos') || '';
    const repoNames = reposCsv.split(',').map((s) => s.trim()).filter(Boolean);
    if (!name || repoNames.length === 0) return json(400, { error: 'missing name or repos' });
    const cur = groupState.get(name);
    if (cur && cur.syncing) return json(409, { syncing: true });
    // Validate repos exist in the registry.
    let reposList = [];
    try { const rr = await fetch(`${API}/api/repos`); const data = await rr.json(); reposList = Array.isArray(data) ? data : data.repos; } catch { /* */ }
    const unknown = repoNames.filter((n) => !resolveRepoPathSync(reposList, n));
    if (unknown.length) return json(404, { error: `unknown repos: ${unknown.join(', ')}` });
    runGroupSync(name, repoNames); // async, fire-and-forget
    return json(202, { started: true });
  }

  if (url.pathname === '/group/status' && req.method === 'GET') {
    const name = url.searchParams.get('name');
    if (!name) return json(400, { error: 'missing name' });
    const cur = groupState.get(name) || { syncing: false, error: null };
    let lastSyncedAt = null;
    try {
      const home = process.env.GITNEXUS_HOME || '/data/gitnexus';
      lastSyncedAt = new Date(statSync(join(home, 'groups', name, 'contracts.json')).mtimeMs).toISOString();
    } catch { /* not synced yet */ }
    return json(200, { syncing: !!cur.syncing, lastSyncedAt, error: cur.error || null });
  }
```

(`json`, `spawn`, `statSync`, `join`, `GITNEXUS_BIN`, `API` are already imported/defined in wiki-worker.mjs from the wiki feature. Confirm `statSync`+`join` imports exist — they do, used by the wiki `lastGeneratedAt`. If not, add `import { statSync } from 'node:fs'` / `import { join } from 'node:path'`.)

- [ ] **Step 2: Syntax-check + commit (top-level file, NO patch regen)**

```
node --check wiki-worker.mjs
git add wiki-worker.mjs
git commit -m "feat(group): wiki-worker group/sync + group/status endpoints (spawn gitnexus group CLI) (Task 2)"
```

---

## Task 3: `docker-server-group.mjs` (web: sync proxy + status + /groups) + mount

**Files:**
- Create: `upstream/docker-server-group.mjs`
- Modify: `upstream/docker-server.mjs`, `upstream/Dockerfile.web`

- [ ] **Step 1: Write the module**

Create `upstream/docker-server-group.mjs`:

```javascript
/**
 * Group management routes (web container). Proxies sync/status to the
 * wiki-worker (group endpoints) in the gitnexus container, and lists synced
 * groups by reading the shared gitnexus-data volume. See spec § 4.3.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const WORKER = process.env.WIKI_WORKER_URL || 'http://gitnexus:4748';
const GROUPS_DIR = join(process.env.GITNEXUS_HOME || '/data/gitnexus', 'groups');

function sendJson(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

// Parse the member repo names (values) out of group.yaml's `repos:` map.
// Minimal YAML read — we only need the repos map values. Tolerant: returns [].
async function readGroupRepos(name) {
  try {
    const raw = await readFile(join(GROUPS_DIR, name, 'group.yaml'), 'utf8');
    const repos = [];
    let inRepos = false;
    for (const line of raw.split('\n')) {
      if (/^repos:\s*$/.test(line)) { inRepos = true; continue; }
      if (inRepos) {
        if (/^\S/.test(line)) break; // dedent → end of repos block
        const m = /^\s+[^:]+:\s*(.+?)\s*$/.exec(line);
        if (m) repos.push(m[1].replace(/^["']|["']$/g, ''));
      }
    }
    return repos;
  } catch { return []; }
}

export async function handleGroupRoute(req, url, res) {
  const path = url.pathname;

  if (path === '/group/sync' && req.method === 'POST') {
    const name = url.searchParams.get('name');
    const repos = url.searchParams.get('repos');
    if (!name || !repos) { sendJson(res, 400, { error: 'missing name or repos' }); return true; }
    try {
      const w = await fetch(`${WORKER}/group/sync?name=${encodeURIComponent(name)}&repos=${encodeURIComponent(repos)}`, { method: 'POST' });
      sendJson(res, w.status, await w.json().catch(() => ({})));
    } catch (e) { sendJson(res, 502, { error: `worker unreachable: ${e && e.message || e}` }); }
    return true;
  }

  if (path === '/group/status' && req.method === 'GET') {
    const name = url.searchParams.get('name');
    if (!name) { sendJson(res, 400, { error: 'missing name' }); return true; }
    try {
      const w = await fetch(`${WORKER}/group/status?name=${encodeURIComponent(name)}`);
      sendJson(res, w.status, await w.json().catch(() => ({})));
    } catch (e) { sendJson(res, 502, { error: `worker unreachable: ${e && e.message || e}` }); }
    return true;
  }

  if (path === '/groups' && req.method === 'GET') {
    const out = [];
    let entries = [];
    try { entries = await readdir(GROUPS_DIR, { withFileTypes: true }); } catch { /* none */ }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const repos = await readGroupRepos(e.name);
      let lastSyncedAt = null;
      try { lastSyncedAt = new Date((await stat(join(GROUPS_DIR, e.name, 'contracts.json'))).mtimeMs).toISOString(); } catch { /* */ }
      out.push({ name: e.name, repos, lastSyncedAt, synced: lastSyncedAt !== null });
    }
    sendJson(res, 200, { groups: out });
    return true;
  }

  return false;
}
```

- [ ] **Step 2: Mount + COPY**

In `docker-server.mjs`: add `import { handleGroupRoute } from './docker-server-group.mjs';` (with the other handler imports) and a dispatch line before the static block (grep `handleAutoReindexRoute` for the anchor): `if (await handleGroupRoute(req, reqUrl, res)) return;`.

In `Dockerfile.web`: grep `COPY docker-server-auto-reindex.mjs` and add a sibling `COPY docker-server-group.mjs ./docker-server-group.mjs`.

- [ ] **Step 3: Syntax-check + regen + commit**

```
node --check upstream/docker-server-group.mjs
node --check upstream/docker-server.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(group): docker-server-group.mjs (sync proxy + status + GET /groups) mounted (Task 3)"
```

---

## Task 4: Pure core `collapseToFileLevel` + `mergeRepoGraphs` + unit tests

**Files:**
- Create: `upstream/docker-server-group-graph-core.mjs`
- Create: `tests/unit/group-graph-core.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/group-graph-core.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { collapseToFileLevel, mergeRepoGraphs } from '../../upstream/docker-server-group-graph-core.mjs';

const repoAGraph = {
  nodes: [
    { id: 'file:a.ts', label: 'File', properties: { name: 'a.ts', filePath: 'a.ts' } },
    { id: 'fn:a.ts:foo', label: 'Function', properties: { name: 'foo', filePath: 'a.ts' } },
    { id: 'fn:b.ts:bar', label: 'Function', properties: { name: 'bar', filePath: 'b.ts' } },
  ],
  relationships: [
    { id: 'r1', sourceId: 'fn:a.ts:foo', targetId: 'fn:b.ts:bar', type: 'CALLS' },
    { id: 'r2', sourceId: 'file:a.ts', targetId: 'fn:a.ts:foo', type: 'CONTAINS' }, // intra-file → self-loop, dropped
  ],
};

describe('collapseToFileLevel', () => {
  it('folds symbols into files, namespaces ids by repo, rolls up + dedups edges, drops self-loops', () => {
    const c = collapseToFileLevel(repoAGraph, 'repoA');
    const ids = c.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['repoA::a.ts', 'repoA::b.ts']);
    expect(c.nodes.every((n) => n.repo === 'repoA' && n.kind === 'file')).toBe(true);
    // a.ts → b.ts (rolled up from foo→bar); the CONTAINS self-loop within a.ts dropped
    expect(c.edges).toEqual([{ source: 'repoA::a.ts', target: 'repoA::b.ts' }]);
  });
  it('handles empty graph', () => {
    expect(collapseToFileLevel({ nodes: [], relationships: [] }, 'r')).toEqual({ nodes: [], edges: [] });
  });
});

describe('mergeRepoGraphs', () => {
  it('unions collapsed graphs + adds cross-repo edges from crossLinks (by symbolRef.filePath)', () => {
    const a = collapseToFileLevel(repoAGraph, 'repoA');
    const b = collapseToFileLevel({ nodes: [{ id: 'file:x.ts', label: 'File', properties: { name: 'x.ts', filePath: 'x.ts' } }], relationships: [] }, 'repoB');
    const crossLinks = [
      { from: { repo: 'repoA', symbolRef: { filePath: 'a.ts' } }, to: { repo: 'repoB', symbolRef: { filePath: 'x.ts' } }, type: 'http', matchType: 'exact' },
      { from: { repo: 'repoA', symbolRef: { filePath: 'ghost.ts' } }, to: { repo: 'repoB', symbolRef: { filePath: 'x.ts' } }, type: 'http', matchType: 'bm25' }, // ghost.ts not a node → dropped
    ];
    const merged = mergeRepoGraphs([a, b], crossLinks);
    expect(merged.nodes.map((n) => n.id).sort()).toEqual(['repoA::a.ts', 'repoA::b.ts', 'repoB::x.ts']);
    const cross = merged.edges.filter((e) => e.crossRepo);
    expect(cross).toEqual([{ source: 'repoA::a.ts', target: 'repoB::x.ts', crossRepo: true, matchType: 'exact', contractType: 'http' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests; npm run test:unit -- group-graph-core`
Expected: FAIL (imports undefined) or Node 21 crash — proceed.

- [ ] **Step 3: Implement the core**

Create `upstream/docker-server-group-graph-core.mjs`:

```javascript
/**
 * Multi-repo merged graph — pure core. No I/O. See spec:
 * docs/superpowers/specs/2026-05-29-multi-repo-unified-graph-design.md
 */

// Collapse a single-repo /api/graph result to file-level. Node ids are
// namespaced `<repo>::<filePath>`. Symbol→symbol edges roll up to file→file
// (dedup, self-loops dropped). Returns { nodes:[{id,label,repo,kind,filePath}], edges:[{source,target}] }.
export function collapseToFileLevel(graph, repo) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const rels = Array.isArray(graph?.relationships) ? graph.relationships : [];
  // nodeId → fileId map (every node has properties.filePath).
  const fileOf = new Map();
  const fileNodes = new Map(); // fileId → node
  for (const n of nodes) {
    const fp = n?.properties?.filePath;
    if (typeof fp !== 'string' || !fp) continue;
    const fileId = `${repo}::${fp}`;
    fileOf.set(n.id, fileId);
    if (!fileNodes.has(fileId)) {
      fileNodes.set(fileId, { id: fileId, label: fp.split('/').pop() || fp, repo, kind: 'file', filePath: fp });
    }
  }
  const edgeSet = new Set();
  const edges = [];
  for (const r of rels) {
    const s = fileOf.get(r.sourceId);
    const t = fileOf.get(r.targetId);
    if (!s || !t || s === t) continue; // unknown endpoint or self-loop
    const key = `${s} ${t}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push({ source: s, target: t });
  }
  return { nodes: [...fileNodes.values()], edges };
}

// Merge collapsed repo graphs + add cross-repo edges from group crossLinks.
// crossLinks: [{ from:{repo, symbolRef:{filePath}}, to:{repo, symbolRef:{filePath}}, type, matchType }].
// A cross edge is added only if both file nodes exist in the merged set.
export function mergeRepoGraphs(collapsed, crossLinks = []) {
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  for (const g of collapsed) {
    for (const n of g.nodes) { if (!nodeIds.has(n.id)) { nodeIds.add(n.id); nodes.push(n); } }
    for (const e of g.edges) edges.push(e);
  }
  for (const cl of crossLinks) {
    const s = `${cl?.from?.repo}::${cl?.from?.symbolRef?.filePath}`;
    const t = `${cl?.to?.repo}::${cl?.to?.symbolRef?.filePath}`;
    if (!nodeIds.has(s) || !nodeIds.has(t) || s === t) continue;
    edges.push({ source: s, target: t, crossRepo: true, matchType: cl.matchType || null, contractType: cl.type || null });
  }
  return { nodes, edges };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests; npm run test:unit -- group-graph-core`
Expected: PASS or Node 21 crash — proceed.

- [ ] **Step 5: Regen + commit**

```
node --check upstream/docker-server-group-graph-core.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff tests/unit/group-graph-core.test.mjs
git commit -m "feat(group-graph): collapseToFileLevel + mergeRepoGraphs pure core + unit (Task 4)"
```

---

## Task 5: `docker-server-group-graph.mjs` (`GET /graph/merged`) + mount

**Files:**
- Create: `upstream/docker-server-group-graph.mjs`
- Modify: `upstream/docker-server.mjs`, `upstream/Dockerfile.web`

- [ ] **Step 1: Write the module**

Create `upstream/docker-server-group-graph.mjs`:

```javascript
/**
 * Merged multi-repo graph (web container). Reads the group's member repos +
 * contracts from the shared gitnexus-data volume, fetches each repo's graph
 * from the API server, collapses to file-level, and stitches cross-repo edges.
 * See spec § 4.4.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collapseToFileLevel, mergeRepoGraphs } from './docker-server-group-graph-core.mjs';

const GITNEXUS_API = process.env.GITNEXUS_API || 'http://gitnexus:4747';
const GROUPS_DIR = join(process.env.GITNEXUS_HOME || '/data/gitnexus', 'groups');
const NODE_CAP = Number(process.env.GROUP_GRAPH_NODE_CAP) || 8000;
const PALETTE = ['#60a5fa', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#fb7185', '#22d3ee', '#facc15'];

function sendJson(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

async function readGroupRepos(name) {
  const raw = await readFile(join(GROUPS_DIR, name, 'group.yaml'), 'utf8'); // throws if absent
  const repos = [];
  let inRepos = false;
  for (const line of raw.split('\n')) {
    if (/^repos:\s*$/.test(line)) { inRepos = true; continue; }
    if (inRepos) {
      if (/^\S/.test(line)) break;
      const m = /^\s+[^:]+:\s*(.+?)\s*$/.exec(line);
      if (m) repos.push(m[1].replace(/^["']|["']$/g, ''));
    }
  }
  return repos;
}

async function readCrossLinks(name) {
  try {
    const raw = await readFile(join(GROUPS_DIR, name, 'contracts.json'), 'utf8');
    const reg = JSON.parse(raw);
    return Array.isArray(reg?.crossLinks) ? reg.crossLinks : [];
  } catch { return []; }
}

export async function handleGroupGraphRoute(req, url, res) {
  if (url.pathname !== '/graph/merged' || req.method !== 'GET') return false;
  const group = url.searchParams.get('group');
  if (!group) { sendJson(res, 400, { error: 'missing group' }); return true; }

  let repoNames;
  try { repoNames = await readGroupRepos(group); }
  catch { sendJson(res, 404, { error: 'group not synced (no group.yaml)' }); return true; }
  if (!repoNames.length) { sendJson(res, 404, { error: 'group has no repos' }); return true; }

  const collapsed = [];
  const repos = [];
  let i = 0;
  for (const repo of repoNames) {
    const color = PALETTE[i % PALETTE.length];
    repos.push({ name: repo, color });
    i++;
    try {
      const r = await fetch(`${GITNEXUS_API}/api/graph?repo=${encodeURIComponent(repo)}`);
      if (!r.ok) { collapsed.push({ nodes: [], edges: [] }); continue; }
      const graph = await r.json();
      collapsed.push(collapseToFileLevel(graph, repo));
    } catch { collapsed.push({ nodes: [], edges: [] }); }
  }

  const crossLinks = await readCrossLinks(group);
  const merged = mergeRepoGraphs(collapsed, crossLinks);

  // Attach repo color to each node + node cap (prioritize cross-repo-linked nodes).
  const colorByRepo = Object.fromEntries(repos.map((r) => [r.name, r.color]));
  for (const n of merged.nodes) n.color = colorByRepo[n.repo] || '#94a3b8';
  let capped = false;
  let nodes = merged.nodes;
  let edges = merged.edges;
  if (nodes.length > NODE_CAP) {
    capped = true;
    const crossIds = new Set();
    for (const e of edges) if (e.crossRepo) { crossIds.add(e.source); crossIds.add(e.target); }
    // keep cross-linked nodes first, then fill to the cap
    const prioritized = [...nodes].sort((a, b) => (crossIds.has(b.id) ? 1 : 0) - (crossIds.has(a.id) ? 1 : 0));
    nodes = prioritized.slice(0, NODE_CAP);
    const keep = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }

  sendJson(res, 200, {
    group, repos, nodes, edges,
    crossRepoEdgeCount: edges.filter((e) => e.crossRepo).length,
    capped,
  });
  return true;
}
```

- [ ] **Step 2: Mount + COPY**

In `docker-server.mjs`: add `import { handleGroupGraphRoute } from './docker-server-group-graph.mjs';` and a dispatch line after `handleGroupRoute` (before the static block): `if (await handleGroupGraphRoute(req, reqUrl, res)) return;`.

In `Dockerfile.web`: add `COPY docker-server-group-graph-core.mjs ./docker-server-group-graph-core.mjs` and `COPY docker-server-group-graph.mjs ./docker-server-group-graph.mjs` (after the `docker-server-group.mjs` COPY from Task 3).

- [ ] **Step 3: Syntax-check + regen + commit**

```
node --check upstream/docker-server-group-graph.mjs
node --check upstream/docker-server.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(group-graph): GET /graph/merged (union + crossLinks + repo colors + cap) mounted (Task 5)"
```

---

## Task 6: Frontend — group-graph mode state + `GroupGraphPanel`

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx`
- Create: `upstream/gitnexus-web/src/components/GroupGraphPanel.tsx`
- Modify: the panel registration site (App.tsx) + a toolbar button

- [ ] **Step 1: Add group-graph state to useAppState**

Mirror an existing panel-open + data-load pattern (grep `isWikiPanelOpen` or `isSettingsPanelOpen`). Add to the context type + state + value:
- `isGroupPanelOpen: boolean` + `setGroupPanelOpen(open)`.
- `groupGraph: { group: string; repos: {name,color}[]; nodes: any[]; edges: any[] } | null` + `setGroupGraph`.
- `enterGroupGraph(group: string)` : `fetch('/graph/merged?group='+encodeURIComponent(group))` → `setGroupGraph(json)` (+ set a flag the canvas reads). `exitGroupGraph()` : `setGroupGraph(null)`.

Read the existing `isWikiPanelOpen` wiring and mirror it exactly (interface line, `useState(false)`, context-value entry). For `groupGraph`, mirror how another fetched-data blob is held (e.g. the diff/graph state).

- [ ] **Step 2: Write `GroupGraphPanel.tsx`**

Create `upstream/gitnexus-web/src/components/GroupGraphPanel.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState } from '../hooks/useAppState';

type GroupInfo = { name: string; repos: string[]; lastSyncedAt: string | null; synced: boolean };

export function GroupGraphPanel() {
  const { availableRepos, enterGroupGraph, setGroupPanelOpen } = useAppState() as unknown as {
    availableRepos: { name: string }[];
    enterGroupGraph: (g: string) => void;
    setGroupPanelOpen: (o: boolean) => void;
  };
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try { const r = await fetch('/groups'); const j = await r.json(); setGroups(Array.isArray(j.groups) ? j.groups : []); } catch { /* */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const sync = useCallback(async () => {
    if (!name || picked.length < 2) { setError('Pick a name and at least 2 repos.'); return; }
    setError(null); setSyncing(true);
    try {
      await fetch(`/group/sync?name=${encodeURIComponent(name)}&repos=${encodeURIComponent(picked.join(','))}`, { method: 'POST' });
      pollRef.current = setInterval(async () => {
        const r = await fetch(`/group/status?name=${encodeURIComponent(name)}`);
        const s = await r.json();
        if (!s.syncing) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setSyncing(false);
          if (s.error) setError(s.error); else refresh();
        }
      }, 3000);
    } catch (e) { setSyncing(false); setError(e instanceof Error ? e.message : 'sync failed'); }
  }, [name, picked, refresh]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const togglePick = (r: string) => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));

  return (
    <div className="flex h-full flex-col gap-2 p-3 text-xs" data-testid="group-graph-panel">
      <div className="flex items-center justify-between">
        <span className="font-medium">Group graph (multi-repo)</span>
        <button type="button" onClick={() => setGroupPanelOpen(false)} className="rounded p-0.5 text-text-muted hover:text-text-primary">✕</button>
      </div>

      <div className="rounded border border-border-default p-2">
        <div className="mb-1 font-medium">Synced groups</div>
        {groups.length === 0 && <div className="text-text-muted">None yet — create one below.</div>}
        {groups.map((g) => (
          <div key={g.name} className="flex items-center justify-between py-0.5">
            <span>{g.name} <span className="text-text-muted">({g.repos.length} repos{g.synced ? '' : ', not synced'})</span></span>
            {g.synced && (
              <button type="button" onClick={() => { enterGroupGraph(g.name); setGroupPanelOpen(false); }} className="rounded bg-accent/20 px-1.5 py-0.5 text-accent" data-testid="group-view">View</button>
            )}
          </div>
        ))}
      </div>

      <div className="rounded border border-border-default p-2">
        <div className="mb-1 font-medium">Create + sync a group</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="group name" className="mb-1 w-full rounded border border-border-default bg-void px-1 py-0.5" data-testid="group-name" />
        <div className="max-h-32 overflow-auto">
          {(availableRepos || []).filter((r) => !r.name.includes('@')).map((r) => (
            <label key={r.name} className="flex items-center gap-1 py-0.5">
              <input type="checkbox" checked={picked.includes(r.name)} onChange={() => togglePick(r.name)} />
              {r.name}
            </label>
          ))}
        </div>
        <button type="button" onClick={sync} disabled={syncing} className="mt-1 rounded border border-border-default px-2 py-0.5 disabled:opacity-50" data-testid="group-sync">
          {syncing ? 'Syncing…' : 'Create + sync'}
        </button>
        {error && <div className="mt-1 text-red-400">{error}</div>}
      </div>
    </div>
  );
}

export default GroupGraphPanel;
```

- [ ] **Step 3: Register the panel + a toolbar button**

Mirror how `WikiPanel`/`SettingsPanel` are rendered + toggled (grep `isWikiPanelOpen` in `App.tsx`). Render `{isGroupPanelOpen && <GroupGraphPanel />}` in the same region; add a "Group graph" toolbar button (Header) calling `setGroupPanelOpen(true)` (icon: reuse `Network` from `lib/lucide-icons` if present, else any existing graph icon). Import `GroupGraphPanel`.

- [ ] **Step 4: Regen + commit**

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(group-graph): GroupGraphPanel + group-graph mode state + toolbar entry (Task 6)"
```

---

## Task 7: Canvas — render the merged graph (repo colors + cross-repo edges + legend)

**Files:**
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx` (+ `hooks/useSigma.ts`)

- [ ] **Step 1: Render `groupGraph` when active**

Read `GraphCanvas.tsx` + `useSigma.ts` to see how the single-repo graph is loaded into Sigma. When `groupGraph !== null` (from useAppState), build the Sigma graph from `groupGraph.nodes`/`groupGraph.edges` instead of the single-repo `graph`: each node uses `node.color` (repo color, already set by the endpoint) and `node.label`; each edge default-styled, except `edge.crossRepo` edges get a distinct color (`#fbbf24`) + larger size. Mirror the existing graph-load path (the adapter that feeds Sigma) — add a branch that, when `groupGraph` is set, feeds the merged nodes/edges with `node.color` honored by the node reducer.

(The existing `useSigma` node reducer likely already supports a per-node color; if so, just feed `groupGraph` nodes with their `color`. The cross-repo edge style goes in the edge reducer: `if (edgeData.crossRepo) return { ...e, color: '#fbbf24', size: 2 }`.)

- [ ] **Step 2: Legend + back-to-single control**

Add a small overlay (when `groupGraph` active): the repo→color legend (`groupGraph.repos.map(r => <span style={{color:r.color}}>{r.name}</span>)`) + a "← Back to single repo" button calling `exitGroupGraph()`. Place it like other canvas overlays (mini-map / mode banners). `data-testid="group-graph-legend"`.

- [ ] **Step 3: Regen + commit**

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(group-graph): canvas renders merged graph — repo colors + cross-repo edges + legend + back (Task 7)"
```

---

## Task 8: Integration + E2E tests

**Files:**
- Create: `tests/integration/endpoints/group-graph.test.mjs`
- Create: `tests/e2e/specs/group-graph.spec.ts`

- [ ] **Step 1: Integration test (mirror lifespan-windowed harness)**

Create `tests/integration/endpoints/group-graph.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:4173';

describe('Group graph endpoints', () => {
  it('GET /groups returns a groups array', async () => {
    const res = await fetch(`${BASE}/groups`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.groups)).toBe(true);
    for (const g of body.groups) { expect(typeof g.name).toBe('string'); expect(Array.isArray(g.repos)).toBe(true); }
  });
  it('GET /group/status requires name', async () => {
    const res = await fetch(`${BASE}/group/status`);
    expect(res.status).toBe(400);
  });
  it('GET /graph/merged 404s an unsynced group', async () => {
    const res = await fetch(`${BASE}/graph/merged?group=__definitely_not_a_group__`);
    expect(res.status).toBe(404);
  });
  it('GET /graph/merged requires group', async () => {
    const res = await fetch(`${BASE}/graph/merged`);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: E2E**

Create `tests/e2e/specs/group-graph.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Group graph (multi-repo)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
  });

  test('opens the Group graph panel with a create/sync form', async ({ page }) => {
    await page.getByRole('button', { name: /group graph/i }).first().click();
    await expect(page.getByTestId('group-graph-panel')).toBeVisible();
    await expect(page.getByTestId('group-name')).toBeVisible();
    await expect(page.getByTestId('group-sync')).toBeVisible();
  });
});
```

(If a synced group exists, a later manual check covers View → merged render. The e2e asserts the panel + form, which don't require a real synced group.)

- [ ] **Step 3: Commit**

```
git add tests/integration/endpoints/group-graph.test.mjs tests/e2e/specs/group-graph.spec.ts
git commit -m "test(group-graph): integration (/groups, /group/status, /graph/merged) + e2e (panel) (Task 8)"
```

---

## Task 9: Docs + build validation + final commit

**Files:**
- Modify: `ROADMAP.md`, `INVENTORY.md`, `tests/README.md`, `CLAUDE.md`

- [ ] **Step 1: Build BOTH images + smoke**

```
docker compose build gitnexus gitnexus-web
docker compose up -d gitnexus gitnexus-web
```

Wait for the web server, then:

```
curl -s -o /dev/null -w "groups: HTTP %{http_code}\n" "http://localhost:4173/groups"
curl -s -o /dev/null -w "merged (unsynced): HTTP %{http_code}\n" "http://localhost:4173/graph/merged?group=__none__"
docker logs gitnexus 2>&1 | grep -i "wiki-worker\|listening" | head
```

Expected: `/groups` → 200, `/graph/merged?group=__none__` → 404, the worker still listening (it now also serves /group/*). **Live multi-repo verification (manual):** create a group of 2 analyzed repos that share a contract (HTTP/gRPC/topic), sync via the panel, View → confirm repo-colored merged nodes + any cross-repo edges. Document in the end-of-task summary (a real cross-repo contract pair may not exist among the indexed repos).

- [ ] **Step 2: CLAUDE.md smoke loop**

Add `/groups` + `/graph/merged` to the smoke block; note the worker now also runs group sync.

- [ ] **Step 3: ROADMAP.md**

`grep "^| 6" ROADMAP.md | tail -3` to find the current last tier number (the parallel session keeps adding — use the next free integer). Add a row:

```markdown
| <N> | **Multi-repo unified graph** (enterprise parity) : groupe nommé (synchronisé via `gitnexus group create/add/sync` dans le conteneur serveur, endpoints `/group/sync`+`/group/status` du worker), `GET /graph/merged?group=` fusionne les graphes per-repo **au niveau fichier** (nodes `<repo>::<file>` colorés par repo) + arêtes cross-repo des contrats (`crossLinks` par `symbolRef.filePath`). Mode "Group graph" dans le canvas (repo colors + cross-repo edges + légende + back). `contracts.json` lu depuis le volume partagé ; `/api/graph` fetché par repo. File-level + node cap pour la scalabilité. | `wiki-worker.mjs` (group endpoints), `docker-server-group.mjs` (`/groups`,`/group/*`), `docker-server-group-graph-core.mjs`+`.mjs` (`/graph/merged`), `GroupGraphPanel.tsx`, `GraphCanvas` merged mode |
```

In the enterprise table, "Multi-repo support" 🟡 → ✅. Bump date header.

- [ ] **Step 4: INVENTORY.md**

Endpoints `/groups`, `/group/sync`, `/group/status`, `/graph/merged` ; modules group + group-graph-core ; worker étendu (group) ; `GroupGraphPanel` + canvas merged mode ; file-level + crossLinks + node cap.

- [ ] **Step 5: tests/README.md**

unit `group-graph-core` ; integration `group-graph` ; e2e `group-graph`.

- [ ] **Step 6: Final commit**

```
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add ROADMAP.md INVENTORY.md tests/README.md CLAUDE.md
git commit -m "Multi-repo unified graph livré: ROADMAP/INVENTORY/CLAUDE smoke/tests (Task 9)"
```

(No patch regen — Task 9 touches only top-level docs.)

---

## Self-Review

**Spec coverage:**
- ✅ §4.2 group-sync endpoints in worker → Task 2.
- ✅ §4.3 group mgmt (sync proxy + status + /groups) → Task 3.
- ✅ §4.4 pure core + merged endpoint (file-level, crossLinks, cap, repo colors) → Tasks 4-5.
- ✅ §4.5 frontend (panel + mode + canvas colors/edges/legend) → Tasks 6-7.
- ✅ §5 edge cases (unsynced→404, sync fail→status error, no-contracts→0 cross edges [merge adds none], cap, orphan crossLink dropped) → Tasks 3/4/5 code + Task 4 tests.
- ✅ §6 testing (unit core + integration + e2e + smoke) → Tasks 4/8/9.
- ✅ §3 group add uses registry name as both groupPath+registryName so crossLink.repo matches → Task 2.
- ✅ §10 docs → Task 9.

**Placeholder scan:**
- ✅ Full code for the worker endpoints, the 2 web modules, the pure core, the panel, the tests.
- ⚠️ Tasks 6 Step 1/3 + Task 7 use grep-anchored frontend instructions (useAppState wiring, panel registration, the Sigma load path + reducers) — these large hot files can't be quoted verbatim; the exact additions + the pattern to mirror are given. Intentional.
- ⚠️ Task 9 Step 3 uses a grep for the next free tier number (parallel session keeps adding). Intentional.

**Type/contract consistency:**
- ✅ `collapseToFileLevel(graph, repo)` → `{ nodes:[{id,label,repo,kind,filePath}], edges:[{source,target}] }` — Task 4 def + tests, consumed by `mergeRepoGraphs` (Task 4) + the endpoint (Task 5).
- ✅ `mergeRepoGraphs(collapsed, crossLinks)` → `{ nodes, edges }` with `crossRepo`/`matchType`/`contractType` on cross edges — Task 4 def + tests, consumed by Task 5 (color + cap) + Task 7 (edge style).
- ✅ `/api/graph` node `properties.filePath` + edge `sourceId`/`targetId` + `label==='File'` — used in `collapseToFileLevel` (verified shape).
- ✅ `CrossLink.from/to.symbolRef.filePath` + `.repo` → node id `<repo>::<filePath>` — used in `mergeRepoGraphs` (verified shape). No symbolToFile map needed (simplification vs spec §4.4 — the crossLink carries the file path directly; noted).
- ✅ `/graph/merged` response `{ group, repos:[{name,color}], nodes, edges, crossRepoEdgeCount, capped }` — Task 5 emits, Task 7 renders (`node.color`, `edge.crossRepo`), Task 8 asserts.
- ✅ worker `group add <name> <repo> <repo>` (3 args) — verified CLI syntax.

**Scope:** large (4 subsystems) but well-bounded, 9 tasks (several multi-step), ~12-15 days. User chose the full feature in one spec. One plan.

Plan ready for execution.

---

## Effort summary

| Task | Estimate |
|---|---|
| 1. Verify `gitnexus group` (gate) | ~¼j |
| 2. Worker group endpoints | ~1j |
| 3. docker-server-group.mjs + mount | ~1j |
| 4. Pure core + unit | ~2j |
| 5. /graph/merged endpoint + mount | ~1.5j |
| 6. GroupGraphPanel + state | ~2j |
| 7. Canvas merged render + legend | ~2-3j |
| 8. Integration + e2e | ~1j |
| 9. Docs + build (both) + smoke | ~1j |
| **Total** | **~12-15 jours** |
