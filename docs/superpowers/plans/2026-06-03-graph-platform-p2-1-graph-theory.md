# Graph Platform P2.1 — graph-theory toolkit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute degree + PageRank centrality and Louvain communities for any sidecar graph, exposed via `GET /graph/metrics/:name`, an MCP tool, and a node overlay (size = PageRank, color = community).

**Architecture:** A pure-JS zero-dep core module over the universal `{nodes,edges}` render shape; a thin web-container endpoint that fetches the sidecar render and runs the module; an MCP wrapper; a frontend overlay reusing the research-graph render path.

**Tech Stack:** Pure Node `.mjs` (zero deps — matches every `docker-server-*.mjs`), the Kùzu sidecar render, the analytics MCP server (`mcp-server/`), React/TS overlay (`upstream/gitnexus-web/`), vitest (native on host Node 24 for pure modules; `bash tests/docker-test.sh unit` otherwise).

---

## ⚠️ Execution protocol — READ FIRST

- **`upstream/` is GITIGNORED** → the implementer edits `upstream/` + runs tests but does NOT touch git/patches; the **controller** regenerates the 3 diffs + drift-check + commits. Tracked zones (`mcp-server/`, `tests/`, `docs/`, `ROADMAP.md`, `INVENTORY.md`) commit normally.
- Patch regen (controller): `git -C upstream add -N .` → `git -C upstream diff HEAD --diff-filter=A|M > patches/{additive-files,inplace-edits}.diff` + `git -C upstream diff HEAD > patches/upstream-all.diff` → `git -C upstream reset -q` → `node scripts/check-patch-drift.mjs` (exit 0).
- Identity `roblastar@live.fr`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Boot-crash discipline:** every new `docker-server-*.mjs` imported at boot MUST be COPY'd into `upstream/Dockerfile.web` (the CI `boot-smoke` job guards this; verify locally in Final).

## File Structure

| File | Zone | Responsibility |
|---|---|---|
| `upstream/docker-server-graph-theory-core.mjs` *(new)* | upstream | pure-JS engine: `degreeCentrality`, `pageRank`, `louvain`, `computeMetrics` over `{nodes,edges}` |
| `tests/unit/graph-theory-core.test.mjs` *(new)* | tracked | engine unit tests (deterministic, synthetic graphs) |
| `upstream/docker-server-graph-theory.mjs` *(new)* | upstream | `GET /graph/metrics/:name` handler (fetch sidecar render → computeMetrics) |
| `tests/unit/graph-theory-handler.test.mjs` *(new)* | tracked | handler unit test (stubbed fetch; 200/404/500) |
| `upstream/docker-server-routes.mjs` *(edit)* | upstream | wire the route |
| `upstream/Dockerfile.web` *(edit)* | upstream | COPY the 2 new `.mjs` |
| `mcp-server/server.mjs` *(edit)* + `mcp-server/server.test.mjs` *(edit)* | tracked | `gitnexus_graph_metrics` tool + test |
| `upstream/gitnexus-web/src/lib/research-graph-adapter.ts` *(edit)* | upstream | optional `metricsById` param → color by community, size by PageRank |
| `upstream/gitnexus-web/src/services/graph-theory-client.ts` *(new)* | upstream | `getGraphMetrics(name)` |
| `upstream/gitnexus-web/src/services/graph-theory-client.test.ts` *(new, tracked-collected)* — placed at `tests/unit/graph-theory-client.test.mjs` | tracked | client fetch unit test |
| `upstream/gitnexus-web/src/components/GraphCanvas.tsx` *(edit)* | upstream | Metrics toggle + fetch + re-render with overlay |
| `ROADMAP.md`, `INVENTORY.md` *(edit)* | tracked | mark P2.1 shipped |

---

## Task 1: Pure-JS engine — `docker-server-graph-theory-core.mjs`

**Files:**
- Create: `upstream/docker-server-graph-theory-core.mjs`
- Test: `tests/unit/graph-theory-core.test.mjs`

⚠️ Implementer: do NOT git/commit/patch (controller serializes the upstream module).

- [ ] **Step 1: Write the failing tests** `tests/unit/graph-theory-core.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { degreeCentrality, pageRank, louvain, computeMetrics } from '../../upstream/docker-server-graph-theory-core.mjs';

// star: hub 'h' connected to a,b,c (directed h->leaf)
const STAR = { nodes: [{ id: 'h' }, { id: 'a' }, { id: 'b' }, { id: 'c' }],
               edges: [{ source: 'h', target: 'a' }, { source: 'h', target: 'b' }, { source: 'h', target: 'c' }] };
// barbell: two triangles {x1,x2,x3} and {y1,y2,y3} joined by one edge x1-y1
const BARBELL = { nodes: ['x1','x2','x3','y1','y2','y3'].map((id) => ({ id })),
  edges: [
    { source: 'x1', target: 'x2' }, { source: 'x2', target: 'x3' }, { source: 'x3', target: 'x1' },
    { source: 'y1', target: 'y2' }, { source: 'y2', target: 'y3' }, { source: 'y3', target: 'y1' },
    { source: 'x1', target: 'y1' },
  ] };

describe('degreeCentrality', () => {
  it('counts total (undirected) degree', () => {
    const d = degreeCentrality(STAR);
    expect(d.h).toBe(3);
    expect(d.a).toBe(1);
  });
});

describe('pageRank', () => {
  it('ranks the directed sink leaves above the hub in a star (mass flows to leaves)', () => {
    const pr = pageRank(STAR);
    // leaves are sinks (dangling); hub only emits → leaves accumulate more rank
    expect(pr.a).toBeGreaterThan(pr.h);
    const sum = Object.values(pr).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 5); // normalized
  });
  it('is symmetric on a 2-cycle', () => {
    const pr = pageRank({ nodes: [{ id: 'p' }, { id: 'q' }], edges: [{ source: 'p', target: 'q' }, { source: 'q', target: 'p' }] });
    expect(pr.p).toBeCloseTo(pr.q, 6);
  });
});

describe('louvain', () => {
  it('finds the two cliques of a barbell with positive modularity', () => {
    const { communities, modularity } = louvain(BARBELL, { seed: 1 });
    expect(new Set(Object.values(communities)).size).toBe(2);
    expect(communities.x1).toBe(communities.x2);
    expect(communities.x2).toBe(communities.x3);
    expect(communities.y1).toBe(communities.y2);
    expect(communities.x1).not.toBe(communities.y1);
    expect(modularity).toBeGreaterThan(0.3);
  });
  it('is deterministic for a fixed seed', () => {
    expect(louvain(BARBELL, { seed: 7 }).communities).toEqual(louvain(BARBELL, { seed: 7 }).communities);
  });
});

describe('computeMetrics', () => {
  it('returns per-node metrics + summary', () => {
    const r = computeMetrics(BARBELL);
    expect(r.nodes).toHaveLength(6);
    expect(r.nodes[0]).toHaveProperty('id');
    expect(r.nodes[0]).toHaveProperty('degree');
    expect(r.nodes[0]).toHaveProperty('pagerank');
    expect(r.nodes[0]).toHaveProperty('community');
    expect(r.summary).toMatchObject({ nodeCount: 6, edgeCount: 7, communityCount: 2 });
    expect(r.summary.modularity).toBeGreaterThan(0.3);
  });
  it('handles an edgeless graph', () => {
    const r = computeMetrics({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(r.summary).toMatchObject({ nodeCount: 2, edgeCount: 0, communityCount: 2, modularity: 0 });
    expect(r.nodes.every((n) => n.pagerank > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, watch fail** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-core` → FAIL (module missing).

- [ ] **Step 3: Implement** `upstream/docker-server-graph-theory-core.mjs`:
```js
/**
 * Graph-theory engine — pure JS, ZERO deps (matches every docker-server-*.mjs;
 * graphology is a frontend-only dep). Operates on the universal render shape
 * { nodes:[{id,...}], edges:[{source,target,...}] }. Degree + PageRank
 * (power iteration) + Louvain (single-level modularity local-moving).
 * See docs/superpowers/specs/2026-06-03-graph-platform-p2-1-graph-theory-design.md.
 */

function nodeIds(graph) {
  const ids = [];
  const seen = new Set();
  for (const n of graph.nodes || []) {
    if (n && n.id != null && !seen.has(n.id)) { seen.add(n.id); ids.push(n.id); }
  }
  return ids;
}

function cleanEdges(graph, idSet) {
  const out = [];
  for (const e of graph.edges || []) {
    if (e && idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target) out.push([e.source, e.target]);
  }
  return out;
}

/** Total (undirected) degree per node. */
export function degreeCentrality(graph) {
  const ids = nodeIds(graph);
  const idSet = new Set(ids);
  const deg = {};
  for (const id of ids) deg[id] = 0;
  for (const [s, t] of cleanEdges(graph, idSet)) { deg[s]++; deg[t]++; }
  return deg;
}

/** PageRank via power iteration (directed; dangling nodes redistribute uniformly). Normalized to sum 1. */
export function pageRank(graph, { damping = 0.85, maxIter = 200, tol = 1e-9 } = {}) {
  const ids = nodeIds(graph);
  const N = ids.length;
  const pr = {};
  if (N === 0) return pr;
  const idSet = new Set(ids);
  const outAdj = new Map(ids.map((id) => [id, []]));
  for (const [s, t] of cleanEdges(graph, idSet)) outAdj.get(s).push(t);
  let rank = new Map(ids.map((id) => [id, 1 / N]));
  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Map(ids.map((id) => [id, (1 - damping) / N]));
    let dangling = 0;
    for (const id of ids) { if (outAdj.get(id).length === 0) dangling += rank.get(id); }
    const danglingShare = (damping * dangling) / N;
    for (const id of ids) next.set(id, next.get(id) + danglingShare);
    for (const id of ids) {
      const outs = outAdj.get(id);
      if (outs.length === 0) continue;
      const share = (damping * rank.get(id)) / outs.length;
      for (const t of outs) next.set(t, next.get(t) + share);
    }
    let diff = 0;
    for (const id of ids) diff += Math.abs(next.get(id) - rank.get(id));
    rank = next;
    if (diff < tol) break;
  }
  for (const id of ids) pr[id] = rank.get(id);
  return pr;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Louvain single-level local-moving on the undirected, weighted (multi-edges
 * summed) graph. Returns { communities:{id->label}, modularity }. Deterministic
 * for a fixed seed (seeded node visit order).
 */
export function louvain(graph, { seed = 1 } = {}) {
  const ids = nodeIds(graph);
  const idSet = new Set(ids);
  const adj = new Map(ids.map((id) => [id, new Map()])); // id -> Map(nbr -> weight)
  const k = new Map(ids.map((id) => [id, 0]));            // weighted degree
  let m2 = 0;                                             // 2 * total edge weight
  for (const [s, t] of cleanEdges(graph, idSet)) {
    adj.get(s).set(t, (adj.get(s).get(t) || 0) + 1);
    adj.get(t).set(s, (adj.get(t).get(s) || 0) + 1);
    k.set(s, k.get(s) + 1); k.set(t, k.get(t) + 1);
    m2 += 2;
  }
  const communities = {};
  if (m2 === 0) { ids.forEach((id, i) => { communities[id] = i; }); return { communities, modularity: 0 }; }

  const comm = new Map(ids.map((id) => [id, id]));
  const sigmaTot = new Map(ids.map((id) => [id, k.get(id)]));
  const rng = mulberry32(seed);
  const order = ids.slice();
  let improved = true;
  let rounds = 0;
  while (improved && rounds < 100) {
    improved = false; rounds++;
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const id of order) {
      const ki = k.get(id);
      const cur = comm.get(id);
      sigmaTot.set(cur, sigmaTot.get(cur) - ki);
      const kin = new Map(); // neighbor community -> summed edge weight from id
      for (const [nbr, w] of adj.get(id)) {
        const c = comm.get(nbr);
        kin.set(c, (kin.get(c) || 0) + w);
      }
      let best = cur;
      let bestGain = (kin.get(cur) || 0) - (sigmaTot.get(cur) * ki) / m2;
      for (const [c, kic] of kin) {
        const gain = kic - (sigmaTot.get(c) * ki) / m2;
        if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
      }
      comm.set(id, best);
      sigmaTot.set(best, sigmaTot.get(best) + ki);
      if (best !== cur) improved = true;
    }
  }
  // relabel to 0..K-1 (stable by first appearance)
  const label = new Map();
  let next = 0;
  for (const id of ids) {
    const c = comm.get(id);
    if (!label.has(c)) label.set(c, next++);
    communities[id] = label.get(c);
  }
  // modularity Q = sum_c [ Sin_c/m2 - (Stot_c/m2)^2 ]
  const sin = new Map();   // internal weight *2 (each internal edge counted from both ends)
  const stot = new Map();
  for (const id of ids) {
    const c = communities[id];
    stot.set(c, (stot.get(c) || 0) + k.get(id));
    for (const [nbr, w] of adj.get(id)) { if (communities[nbr] === c) sin.set(c, (sin.get(c) || 0) + w); }
  }
  let modularity = 0;
  for (const [c, st] of stot) modularity += (sin.get(c) || 0) / m2 - (st / m2) ** 2;
  return { communities, modularity };
}

/** One-call: per-node {degree, pagerank, community} + a summary. */
export function computeMetrics(graph) {
  const ids = nodeIds(graph);
  const deg = degreeCentrality(graph);
  const pr = pageRank(graph);
  const { communities, modularity } = louvain(graph);
  const nodes = ids.map((id) => ({ id, degree: deg[id] ?? 0, pagerank: pr[id] ?? 0, community: communities[id] ?? 0 }));
  const idSet = new Set(ids);
  return {
    nodes,
    summary: {
      nodeCount: ids.length,
      edgeCount: cleanEdges(graph, idSet).length,
      communityCount: new Set(Object.values(communities)).size,
      modularity,
    },
  };
}
```

- [ ] **Step 4: Run, verify pass** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-core` → PASS (all). If Louvain doesn't split the barbell, the test is the spec — debug the gain/modularity until it passes (do NOT weaken the test).

- [ ] **Step 5 (CONTROLLER): serialize + commit.** Regen diffs (new module → additive), drift 0, then `git add patches/ tests/unit/graph-theory-core.test.mjs && git commit -m "feat(graph-theory): pure-JS engine — degree + PageRank + Louvain (P2.1)"`.

---

## Task 2: Endpoint — `GET /graph/metrics/:name`

**Files:**
- Create: `upstream/docker-server-graph-theory.mjs`
- Modify: `upstream/docker-server-routes.mjs` (import + dispatch)
- Modify: `upstream/Dockerfile.web` (COPY both new `.mjs`)
- Test: `tests/unit/graph-theory-handler.test.mjs`

⚠️ Implementer: edit + test; do NOT git/commit/patch.

- [ ] **Step 1: Failing handler test** `tests/unit/graph-theory-handler.test.mjs`:
```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleGraphMetricsRoute } from '../../upstream/docker-server-graph-theory.mjs';

function fakeRes() { return { _c: 0, _b: '', writeHead(c) { this._c = c; }, end(b) { this._b = b || ''; } }; }
afterEach(() => vi.unstubAllGlobals());

describe('handleGraphMetricsRoute', () => {
  it('computes metrics for a sidecar graph', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      nodes: [{ id: 'x1' }, { id: 'x2' }, { id: 'y1' }], edges: [{ source: 'x1', target: 'x2' }],
    }) })));
    const res = fakeRes();
    const claimed = await handleGraphMetricsRoute({ method: 'GET' }, new URL('http://x/graph/metrics/foo'), res);
    expect(claimed).toBe(true);
    expect(res._c).toBe(200);
    const body = JSON.parse(res._b);
    expect(body.summary.nodeCount).toBe(3);
    expect(body.nodes.find((n) => n.id === 'x1')).toHaveProperty('pagerank');
  });
  it('404s when the sidecar graph is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'nope' }) })));
    const res = fakeRes();
    await handleGraphMetricsRoute({ method: 'GET' }, new URL('http://x/graph/metrics/missing'), res);
    expect(res._c).toBe(404);
  });
  it('returns false for non-metrics paths', async () => {
    const res = fakeRes();
    expect(await handleGraphMetricsRoute({ method: 'GET' }, new URL('http://x/graph/templates'), res)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, watch fail** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-handler` → FAIL.

- [ ] **Step 3: Implement** `upstream/docker-server-graph-theory.mjs`:
```js
/**
 * Graph-theory metrics route (web container). GET /graph/metrics/:name →
 * fetch the sidecar render of <name> → computeMetrics (pure-JS engine).
 *   { nodes:[{id,degree,pagerank,community}], summary:{nodeCount,edgeCount,communityCount,modularity} }
 */
import { sidecarRender } from './docker-server-graph-templates-core.mjs';
import { computeMetrics } from './docker-server-graph-theory-core.mjs';

function sendJson(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

export async function handleGraphMetricsRoute(req, url, res) {
  if (!url.pathname.startsWith('/graph/metrics/') || req.method !== 'GET') return false;
  const name = decodeURIComponent(url.pathname.slice('/graph/metrics/'.length));
  let graph;
  try { graph = await sidecarRender(name); }
  catch (e) { sendJson(res, 404, { error: `graph "${name}" not available: ${e.message}` }); return true; }
  try { sendJson(res, 200, computeMetrics(graph)); }
  catch (e) { sendJson(res, 500, { error: `metrics failed: ${e.message}` }); return true; }
  return true;
}
```
NOTE: `sidecarRender` throws on a non-ok sidecar response (it calls `graphsFetch` which throws when `!res.ok`), so a missing graph → the catch → 404. Confirm by reading `sidecarRender`/`graphsFetch` in `docker-server-graph-templates-core.mjs`.

- [ ] **Step 4: Wire the route** — in `upstream/docker-server-routes.mjs`: add `import { handleGraphMetricsRoute } from './docker-server-graph-theory.mjs';` (after the graph-lens import) and `  if (await handleGraphMetricsRoute(req, reqUrl, res)) return true;` (before `handleGraphTemplatesRoute`).

- [ ] **Step 5: COPY into the web image** — in `upstream/Dockerfile.web`, after the research-graph-importer COPY (the P1+ graph-platform block), add:
```dockerfile
COPY docker-server-graph-theory-core.mjs ./docker-server-graph-theory-core.mjs
COPY docker-server-graph-theory.mjs ./docker-server-graph-theory.mjs
```

- [ ] **Step 6: Run, verify pass** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-handler` → PASS.

- [ ] **Step 7 (CONTROLLER): serialize + commit.** Regen diffs (new core+handler → additive; routes+Dockerfile → inplace), drift 0, then `git add patches/ tests/unit/graph-theory-handler.test.mjs && git commit -m "feat(graph-theory): GET /graph/metrics/:name endpoint + route + Dockerfile COPY"`.

---

## Task 3: MCP tool — `gitnexus_graph_metrics`

**Files:**
- Modify: `mcp-server/server.mjs` (tracked)
- Modify: `mcp-server/server.test.mjs` (tracked)

(Tracked — implementer commits this one normally.)

- [ ] **Step 1: Read `mcp-server/server.mjs`** to match the exact tool-definition shape (each tool: `{ name, description, inputSchema, run/handler }` fetching `WEB_URL` or `API_URL`). Find an existing WEB_URL tool (e.g. `gitnexus_entropy`) to copy the structure.

- [ ] **Step 2: Add a failing test** in `mcp-server/server.test.mjs` (match the file's existing test style — read it first). Assert the tool exists and, with a stubbed fetch returning `{summary:{nodeCount:3,communityCount:2,modularity:0.4}, nodes:[...]}`, returns a result mentioning the summary. Example shape:
```js
it('gitnexus_graph_metrics calls /graph/metrics/:name and returns the summary', async () => {
  // (adapt to the file's harness: locate the tool by name, stub global fetch to WEB_URL/graph/metrics/foo, invoke, assert)
});
```
(Adapt precisely to how `server.test.mjs` invokes tools — reuse its existing helper.)

- [ ] **Step 3: Run, watch fail** — `cd mcp-server && node --test server.test.mjs` (or the script in `mcp-server/package.json` — check it) → FAIL.

- [ ] **Step 4: Add the tool** in `mcp-server/server.mjs`, mirroring an existing WEB_URL tool:
```js
{
  name: 'gitnexus_graph_metrics',
  description: 'Graph-theory metrics (degree + PageRank centrality + Louvain communities) for a sidecar graph by name. Returns a summary + per-node metrics.',
  inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'sidecar graph name' } }, required: ['name'] },
  // handler mirrors the existing WEB_URL tools: fetch `${WEB_URL}/graph/metrics/${encodeURIComponent(args.name)}`
}
```
(Use the file's actual handler convention — same fetch/timeout/error wrapper as `gitnexus_entropy`. Return the parsed JSON, or a top-N summary if the file's tools summarize.)

- [ ] **Step 5: Run, verify pass** — the mcp test passes.

- [ ] **Step 6: Commit (tracked):** `git add mcp-server/server.mjs mcp-server/server.test.mjs && git commit -m "feat(mcp): gitnexus_graph_metrics tool (P2.1 graph-theory)"`.

---

## Task 4: Frontend overlay (size = PageRank, color = community)

**Files:**
- Create: `upstream/gitnexus-web/src/services/graph-theory-client.ts`
- Create test: `tests/unit/graph-theory-client.test.mjs`
- Modify: `upstream/gitnexus-web/src/lib/research-graph-adapter.ts`
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx`

⚠️ Implementer: edit + run the client test; do NOT git/commit/patch.

- [ ] **Step 1: Failing client test** `tests/unit/graph-theory-client.test.mjs`:
```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getGraphMetrics } from '../../upstream/gitnexus-web/src/services/graph-theory-client.ts';
afterEach(() => vi.unstubAllGlobals());
describe('getGraphMetrics', () => {
  it('GETs /graph/metrics/:name and returns the payload', async () => {
    const fake = { nodes: [{ id: 'a', degree: 1, pagerank: 0.5, community: 0 }], summary: { nodeCount: 1, edgeCount: 0, communityCount: 1, modularity: 0 } };
    const f = vi.fn(async () => ({ ok: true, json: async () => fake }));
    vi.stubGlobal('fetch', f);
    const r = await getGraphMetrics('my graph');
    expect(f).toHaveBeenCalledWith('/graph/metrics/my%20graph');
    expect(r.summary.communityCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run, watch fail** — `bash tests/docker-test.sh unit graph-theory-client` → FAIL.

- [ ] **Step 3: Implement the client** `upstream/gitnexus-web/src/services/graph-theory-client.ts`:
```ts
export interface GraphMetricNode { id: string; degree: number; pagerank: number; community: number; }
export interface GraphMetrics { nodes: GraphMetricNode[]; summary: { nodeCount: number; edgeCount: number; communityCount: number; modularity: number }; }

export async function getGraphMetrics(name: string): Promise<GraphMetrics> {
  const res = await fetch(`/graph/metrics/${encodeURIComponent(name)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as GraphMetrics;
}
```

- [ ] **Step 4: Run, verify pass** — `bash tests/docker-test.sh unit graph-theory-client` → PASS.

- [ ] **Step 5: Extend the adapter** — in `upstream/gitnexus-web/src/lib/research-graph-adapter.ts`, give `researchGraphToGraphology` an optional second arg `metricsById?: Map<string, { pagerank: number; community: number }>`. When present, override per-node `color` (a community palette, cycled) and `size` (scaled by PageRank). Read the current function first; the minimal change:
```ts
const COMMUNITY_PALETTE = ['#60a5fa','#f59e0b','#34d399','#f472b6','#a78bfa','#fb7185','#22d3ee','#facc15','#4ade80','#c084fc'];
// signature: export function researchGraphToGraphology(rg: ResearchGraph, metricsById?: Map<string,{pagerank:number;community:number}>): Graph<...> {
// inside the node loop, after computing the default color/size:
//   const m = metricsById?.get(node.id);
//   const color = m ? COMMUNITY_PALETTE[m.community % COMMUNITY_PALETTE.length] : (RESEARCH_COLORS[node.type] || RESEARCH_FALLBACK_COLOR);
//   const size = m ? 4 + 16 * Math.sqrt(m.pagerank / maxPagerank) : 5;
// (compute maxPagerank = Math.max(...[...metricsById.values()].map(v=>v.pagerank), 1e-9) once before the loop when metricsById is set.)
```
Keep the default (no metrics) path byte-identical to today.

- [ ] **Step 6: Wire the toggle in GraphCanvas** — in `upstream/gitnexus-web/src/components/GraphCanvas.tsx`, near the research/lens render effect:
  - add state `const [metricsOn, setMetricsOn] = useState(false);` and `const [metricsById, setMetricsById] = useState<Map<string,{pagerank:number;community:number}>|null>(null);`
  - an effect: when `metricsOn` and a sidecar graph is active (`researchName` set) → `getGraphMetrics(researchName).then((m) => setMetricsById(new Map(m.nodes.map((n) => [n.id, { pagerank: n.pagerank, community: n.community }]))))`; when off → `setMetricsById(null)`.
  - in the render effect, pass `metricsOn ? metricsById : undefined` to `researchGraphToGraphology(researchData, ...)` and include `metricsOn` in the `cacheKey` (e.g. `research:${researchName}${metricsOn ? ':metrics' : ''}`) and in the effect deps.
  - render a small toggle button (only when a sidecar graph is active): `{researchName && <button onClick={() => setMetricsOn((v) => !v)}>{metricsOn ? 'Metrics: on' : 'Metrics: off'}</button>}` near the existing canvas controls. Import `getGraphMetrics` from `../services/graph-theory-client`.
  (Read the render-effect region first; adapt names to what's there.)

- [ ] **Step 7: Verify TSX compiles** — the controller rebuilds the web image in Final (the unit tier doesn't type-check TSX). Ensure edits match existing patterns + balanced braces.

- [ ] **Step 8 (CONTROLLER): serialize + commit.** Regen diffs (client new → additive; adapter+GraphCanvas → inplace), drift 0, then `git add patches/ tests/unit/graph-theory-client.test.mjs && git commit -m "feat(web): graph-theory metrics overlay (size=PageRank, color=community)"`.

---

## Task 5: Docs

- [ ] **Step 1: ROADMAP** — flip the **P2.1** row état from `📋 Spec écrite` to `✅ **Livré 2026-06-03**`; flip the **P2** row from `🚧 En cours` to note P2.1 done, P2.2 backlog remains.
- [ ] **Step 2: INVENTORY** — add a row/bullet for `GET /graph/metrics/:name` (degree + PageRank + Louvain over the common render shape; sidecar graphs; pure-JS engine `docker-server-graph-theory-core.mjs`; MCP `gitnexus_graph_metrics`; overlay size=PageRank/color=community).
- [ ] **Step 3: Commit (tracked):** `git add ROADMAP.md INVENTORY.md && git commit -m "docs: P2.1 graph-theory toolkit shipped (roadmap + inventory)"`.

---

## Final: verification

- [ ] **Step 1:** `node scripts/check-patch-drift.mjs` exit 0.
- [ ] **Step 2:** full unit tier green — `bash tests/docker-test.sh unit` (graph-theory-core + handler + client + all prior; 0 failures).
- [ ] **Step 3: stack boot + e2e** — build + boot the test stack (non-colliding ports), confirm the web container BOOTS (proves the 2 Dockerfile COPYs), scaffold+import a sidecar graph (e.g. `research-graph` from `research-graph-corpus`), then `GET /graph/metrics/<name>` returns a summary (communityCount ≥ 1, per-node pagerank). Teardown `down -v`.
- [ ] **Step 4:** push is the user's call; summarize P2.1 shipped + P2.2 backlog still recorded.

---

## Self-Review

**Spec coverage:** §3.1 engine → Task 1. §3.2 endpoint → Task 2. §3.3 MCP → Task 3. §3.4 overlay → Task 4. §4 testing → per-task tests + Final. §5 scope (sidecar only, 3 algos) → respected. §6 deferred → untouched (recorded). §7 open Qs (single-level Louvain, palette cycling, no caching) → reflected in Task 1/4 code.

**Placeholder scan:** Task 1/2/4 have complete code. Task 3 is the one task with "adapt to the file's harness" guidance rather than verbatim code — justified because the MCP tool/test shape must match `server.mjs`/`server.test.mjs` exactly and I haven't pasted those files; the implementer reads them (Step 1) and mirrors `gitnexus_entropy`. Not a logic placeholder.

**Type/name consistency:** `degreeCentrality`/`pageRank`/`louvain`/`computeMetrics` (Task 1) consumed by `handleGraphMetricsRoute` (Task 2) + `getGraphMetrics`→`GraphMetrics` (Task 4). Endpoint `/graph/metrics/:name` consistent across handler, MCP tool, client, overlay. Output `{nodes:[{id,degree,pagerank,community}], summary:{nodeCount,edgeCount,communityCount,modularity}}` identical in engine, handler test, client interface.
