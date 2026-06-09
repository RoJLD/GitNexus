# Graph Platform P2.3.2a — metrics over a lens (ASTKG as a source) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `computeMetrics` over a lens projection of the code graph (ASTKG), exposed via `GET /graph/metrics/lens/:lensId?repo=<repo>` + an MCP tool + the existing overlay extended to the lens view, with a node-cap guard for large projections.

**Architecture:** The `imports-deps` lens already projects the ASTKG (`${GITNEXUS_API}/api/graph?repo=`) to the universal `{nodes:[{id}],edges:[{source,target}]}` shape — exactly what the engine consumes. A new route fetches `/api/graph`, projects via the shared `LENSES` registry, and runs a node-capped `computeMetricsCapped`. Pure-JS engine addition + already-COPY'd module edits + already-built web sources — no Dockerfile.web change.

**Tech Stack:** Node ESM (zero-dep `.mjs`), vitest (host-native), React/TypeScript, node:test (MCP).

**Spec:** `docs/superpowers/specs/2026-06-09-graph-platform-p2-3-2a-metrics-over-lens-design.md`

**Current state to build on (verified):**
- `docker-server-graph-theory-core.mjs`: `computeMetrics(graph, {community='louvain', resolution=1, seed=1} = {})` (lines 467+) computes `deg/pr/bt/ev/cl/kz/hr/core/clustering/comp/articulation/bridges`, dispatches community, returns `{nodes, bridges, summary}`. `nodeIds`, `cleanEdges`, `betweenness`, `closeness`, `harmonic`, `kCore`, `clusteringCoefficient` all exist.
- `docker-server-graph-theory.mjs`: `parseMetricsParams(searchParams)` (exported) + `handleGraphMetricsRoute`.
- `docker-server-graph-lens-core.mjs`: exports `projectImports(graph)`.
- `docker-server-graph-lens.mjs`: `const GITNEXUS_API = process.env.GITNEXUS_API || 'http://gitnexus:4747'`; `const LENSES = { 'imports-deps': projectImports }`.
- `docker-server-routes.mjs`: line 78 `handleGraphMetricsRoute`, line 79 `handleGraphLensRoute`.
- `GraphCanvas.tsx`: `lensId`/`lensRepo` from URL (lines ~132-133); metrics state (~126-128); metrics-fetch effect (~140-157, gated `metricsOn && researchName`); Metrics toggle (~890, gated `{researchName && (`); size `<select>` (~904, gated `metricsOn && researchName`).

---

### Task 1: Engine — `skipSuperLinear` option + `computeMetricsCapped` wrapper

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs` (`computeMetrics` + new `computeMetricsCapped`)
- Test: `tests/unit/graph-theory-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/graph-theory-core.test.mjs` (extend the import at line 2 to add `computeMetricsCapped`):

```js
describe('computeMetricsCapped', () => {
  it('below the cap returns full metrics with capped:false', () => {
    const r = computeMetricsCapped(BARBELL, { cap: 1000 });
    expect(r.summary.capped).toBe(false);
    expect(r.summary.omittedMetrics).toEqual([]);
    expect(r.nodes.every((n) => Number.isFinite(n.betweenness) && Number.isFinite(n.closeness))).toBe(true);
    // identical core payload to computeMetrics under the cap
    expect(r.nodes.find((n) => n.id === 'x1').betweenness).toBe(computeMetrics(BARBELL).nodes.find((n) => n.id === 'x1').betweenness);
  });
  it('above the cap skips super-linear metrics, keeps near-linear, flags capped', () => {
    const r = computeMetricsCapped(BARBELL, { cap: 2 });   // 6 nodes > cap 2
    expect(r.summary.capped).toBe(true);
    expect(r.summary.omittedMetrics).toEqual(['betweenness', 'closeness', 'harmonic', 'coreness', 'clustering']);
    expect(r.summary.transitivity).toBe(0);
    for (const n of r.nodes) {
      expect(n.betweenness).toBe(0); expect(n.closeness).toBe(0); expect(n.harmonic).toBe(0);
      expect(n.coreness).toBe(0); expect(n.clustering).toBe(0);
      // near-linear kept (finite, and degree/community are real)
      expect(Number.isFinite(n.pagerank)).toBe(true);
      expect(Number.isFinite(n.eigenvector)).toBe(true);
      expect(Number.isFinite(n.katz)).toBe(true);
    }
    expect(r.nodes.find((n) => n.id === 'x1').degree).toBe(3);   // degree still real
    expect(new Set(r.nodes.map((n) => n.community)).size).toBe(2); // community still computed
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-core`
Expected: FAIL — `computeMetricsCapped is not a function`.

- [ ] **Step 3: Implement**

(3a) In `computeMetrics`, add the `skipSuperLinear` option and guard the five super-linear computations. Replace the signature + the metric-computation block (lines 467-479) with:

```js
export function computeMetrics(graph, { community = 'louvain', resolution = 1, seed = 1, skipSuperLinear = false } = {}) {
  const ids = nodeIds(graph);
  const deg = degreeCentrality(graph);
  const pr = pageRank(graph);
  const ev = eigenvector(graph);
  const kz = katz(graph);
  // Super-linear metrics (O(V·E) / O(V²) / O(Σd²)) — skipped above the node cap (see computeMetricsCapped).
  const bt = skipSuperLinear ? {} : betweenness(graph);
  const cl = skipSuperLinear ? {} : closeness(graph);
  const hr = skipSuperLinear ? {} : harmonic(graph);
  const core = skipSuperLinear ? new Map() : kCore(graph);
  const { local: clustering, transitivity } = skipSuperLinear ? { local: {}, transitivity: 0 } : clusteringCoefficient(graph);
  const comp = connectedComponents(graph);
  const { articulation, bridges } = articulationPointsAndBridges(graph);
```

(The node-field assembly at lines 493-507 is unchanged — `bt[id] ?? 0`, `cl[id] ?? 0`, `hr[id] ?? 0`, `core.get(id) ?? 0`, `clustering[id] ?? 0` all already fall back to `0` when their source is empty. `articulation`/`bridges`/`componentId` are NOT skipped — they are O(V+E) via a single DFS/BFS, cheap. Default `skipSuperLinear=false` → byte-identical to today, guarded by the existing regression test.)

(3b) Add `computeMetricsCapped` immediately after `computeMetrics` (before `modularityOf`):

```js
/**
 * computeMetrics with a node-count guard. On graphs larger than `cap` nodes, the
 * super-linear metrics (betweenness O(V·E), closeness/harmonic O(V·(V+E)), k-core
 * O(V²), clustering O(Σd²)) are skipped (set to 0) so the endpoint stays responsive;
 * the near-linear metrics (degree, PageRank, eigenvector, Katz, community, density,
 * components) are always computed. `summary.capped` + `summary.omittedMetrics` report it.
 * (Real sampling/LoD/caching for the symbol-level case is deferred to P2.3.2c.)
 */
export function computeMetricsCapped(graph, { cap = 2000, ...opts } = {}) {
  const skip = nodeIds(graph).length > cap;
  const r = computeMetrics(graph, { ...opts, skipSuperLinear: skip });
  r.summary.capped = skip;
  r.summary.omittedMetrics = skip ? ['betweenness', 'closeness', 'harmonic', 'coreness', 'clustering'] : [];
  return r;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-core`
Expected: the new tests PASS; all prior graph-theory-core tests still PASS (the byte-identical-default regression confirms `computeMetrics` default path unchanged).

- [ ] **Step 5: Commit** — controller handles git/patches (subagent does not).

---

### Task 2: Endpoint — `/graph/metrics/lens/:lensId?repo=` + shared LENSES registry

**Files:**
- Modify: `upstream/docker-server-graph-lens-core.mjs` (export a `LENSES` registry)
- Modify: `upstream/docker-server-graph-lens.mjs` (import the shared registry)
- Modify: `upstream/docker-server-graph-theory.mjs` (new route + a pure testable helper; sidecar route uses `computeMetricsCapped` + guards `lens/`)
- Modify: `upstream/docker-server-routes.mjs` (wire the new route before `handleGraphMetricsRoute`)
- Test: `tests/unit/graph-theory-lens-metrics.test.mjs` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/graph-theory-lens-metrics.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { lensMetrics } from '../../upstream/docker-server-graph-theory.mjs';

// Synthetic /api/graph (ASTKG) shape: nodes carry properties.filePath; IMPORTS rels.
const API_GRAPH = {
  nodes: [
    { id: 'n1', properties: { filePath: 'src/a.ts' } },
    { id: 'n2', properties: { filePath: 'src/b.ts' } },
    { id: 'n3', properties: { filePath: 'src/c.ts' } },
  ],
  relationships: [
    { sourceId: 'n1', targetId: 'n2', type: 'IMPORTS' },
    { sourceId: 'n2', targetId: 'n3', type: 'IMPORTS' },
    { sourceId: 'n1', targetId: 'n3', type: 'CALLS' },   // non-IMPORTS ignored by imports-deps
  ],
};

describe('lensMetrics', () => {
  it('projects via imports-deps and computes metrics over the file graph', () => {
    const r = lensMetrics(API_GRAPH, 'imports-deps', { community: 'louvain', resolution: 1 });
    expect(r.summary.nodeCount).toBe(3);            // 3 files
    expect(r.summary.edgeCount).toBe(2);            // 2 IMPORTS edges (CALLS dropped)
    expect(r.nodes.find((n) => n.id === 'src/b.ts').betweenness).toBeGreaterThan(0); // b is the path middle
    expect(r.summary.capped).toBe(false);
  });
  it('throws on an unknown lens', () => {
    expect(() => lensMetrics(API_GRAPH, 'bogus-lens', {})).toThrow(/unknown lens/);
  });
  it('honours the cap (super-linear metrics skipped)', () => {
    const r = lensMetrics(API_GRAPH, 'imports-deps', {}, 1);   // 3 nodes > cap 1
    expect(r.summary.capped).toBe(true);
    expect(r.nodes.every((n) => n.betweenness === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-lens-metrics`
Expected: FAIL — `lensMetrics is not a function`.

- [ ] **Step 3: Implement**

(3a) `upstream/docker-server-graph-lens-core.mjs` — add a shared registry at the end of the file (after `projectImports`):

```js
/** Registry of lens projections, keyed by lens id (shared by the lens route + the lens-metrics route). */
export const LENSES = { 'imports-deps': projectImports };
```

(3b) `upstream/docker-server-graph-lens.mjs` — use the shared registry. Replace:

```js
import { projectImports } from './docker-server-graph-lens-core.mjs';
```
with
```js
import { LENSES } from './docker-server-graph-lens-core.mjs';
```
and DELETE the now-redundant local line `const LENSES = { 'imports-deps': projectImports };`. (Everything else in that file is unchanged — it already uses `LENSES[id]`.)

(3c) `upstream/docker-server-graph-theory.mjs` — add the imports, the pure `lensMetrics` helper, the new route, switch the sidecar route to `computeMetricsCapped`, and guard the sidecar route against `lens/`. Replace the whole file with:

```js
/**
 * Graph-theory metrics routes (web container).
 *   GET /graph/metrics/:name[?community=&resolution=]            → sidecar graph metrics
 *   GET /graph/metrics/lens/:lensId?repo=<repo>[&community=&resolution=]  → code-graph (ASTKG) metrics via a lens
 * Both → computeMetricsCapped (pure-JS engine). Response:
 *   { nodes:[{id,degree,pagerank,betweenness,eigenvector,closeness,katz,harmonic,
 *             coreness,clustering,articulation,componentId,community}],
 *     bridges:[{source,target}],
 *     summary:{nodeCount,edgeCount,communityCount,modularity,density,componentCount,transitivity,capped,omittedMetrics} }
 */
import { sidecarRender } from './docker-server-graph-templates-core.mjs';
import { computeMetricsCapped } from './docker-server-graph-theory-core.mjs';
import { LENSES } from './docker-server-graph-lens-core.mjs';

const COMMUNITY_METHODS = new Set(['louvain', 'leiden', 'labelprop']);
const GITNEXUS_API = process.env.GITNEXUS_API || 'http://gitnexus:4747';

function sendJson(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

/** Parse + validate the metrics query params. Throws Error (→ 400) on bad input. */
export function parseMetricsParams(searchParams) {
  const community = searchParams.get('community') || 'louvain';
  if (!COMMUNITY_METHODS.has(community)) throw new Error(`unknown community method "${community}" (use louvain|leiden|labelprop)`);
  let resolution = 1;
  const raw = searchParams.get('resolution');
  if (raw != null && raw !== '') {
    resolution = Number(raw);
    if (!Number.isFinite(resolution) || resolution <= 0) throw new Error(`resolution must be a positive finite number, got "${raw}"`);
  }
  return { community, resolution };
}

/** Pure: project an /api/graph JSON via a lens, then compute capped metrics. Throws on unknown lens. */
export function lensMetrics(apiGraph, lensId, params, cap = 2000) {
  const project = LENSES[lensId];
  if (!project) throw new Error(`unknown lens: ${lensId}`);
  return computeMetricsCapped(project(apiGraph), { ...params, cap });
}

export async function handleGraphMetricsRoute(req, url, res) {
  if (!url.pathname.startsWith('/graph/metrics/') || req.method !== 'GET') return false;
  if (url.pathname.startsWith('/graph/metrics/lens/')) return false;   // owned by handleGraphLensMetricsRoute
  const name = decodeURIComponent(url.pathname.slice('/graph/metrics/'.length));
  let params;
  try { params = parseMetricsParams(url.searchParams); }
  catch (e) { sendJson(res, 400, { error: e.message }); return true; }
  let graph;
  try { graph = await sidecarRender(name); }
  catch (e) { sendJson(res, 404, { error: `graph "${name}" not available: ${e.message}` }); return true; }
  try { sendJson(res, 200, computeMetricsCapped(graph, params)); }
  catch (e) { sendJson(res, 500, { error: `metrics failed: ${e.message}` }); return true; }
  return true;
}

export async function handleGraphLensMetricsRoute(req, url, res) {
  if (!url.pathname.startsWith('/graph/metrics/lens/') || req.method !== 'GET') return false;
  const lensId = decodeURIComponent(url.pathname.slice('/graph/metrics/lens/'.length));
  if (!LENSES[lensId]) { sendJson(res, 404, { error: `unknown lens: ${lensId}` }); return true; }
  const repo = url.searchParams.get('repo');
  if (!repo) { sendJson(res, 400, { error: 'missing repo' }); return true; }
  let params;
  try { params = parseMetricsParams(url.searchParams); }
  catch (e) { sendJson(res, 400, { error: e.message }); return true; }
  let apiGraph;
  try {
    const r = await fetch(`${GITNEXUS_API}/api/graph?repo=${encodeURIComponent(repo)}`);
    if (!r.ok) { sendJson(res, 502, { error: `upstream /api/graph ${r.status}` }); return true; }
    apiGraph = await r.json();
  } catch (e) { sendJson(res, 502, { error: `upstream /api/graph failed: ${e.message}` }); return true; }
  try { sendJson(res, 200, lensMetrics(apiGraph, lensId, params)); }
  catch (e) { sendJson(res, 500, { error: `lens metrics failed: ${e.message}` }); return true; }
  return true;
}
```

(3d) `upstream/docker-server-routes.mjs` — import the new handler and wire it BEFORE `handleGraphMetricsRoute`. Change the import line (37-38 area):

```js
import { handleGraphMetricsRoute, handleGraphLensMetricsRoute } from './docker-server-graph-theory.mjs';
```

and add the call immediately before the `handleGraphMetricsRoute` call (line ~78):

```js
  if (await handleGraphLensMetricsRoute(req, reqUrl, res)) return true;
  if (await handleGraphMetricsRoute(req, reqUrl, res)) return true;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-lens-metrics`
Expected: PASS. Also re-run `graph-theory` (the endpoint-param + core tests) to confirm no regression: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory` → all pass.

- [ ] **Step 5: Commit** — controller handles git/patches.

---

### Task 3: MCP — `gitnexus_graph_lens_metrics`

**Files:**
- Modify: `mcp-server/server.mjs`
- Test: `mcp-server/server.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `mcp-server/server.test.mjs` (after the existing `gitnexus_graph_metrics` section):

```js
  it("registers 'gitnexus_graph_lens_metrics' with lensId+repo required", () => {
    assert.ok(src.includes("name: 'gitnexus_graph_lens_metrics'"), 'TOOLS must contain gitnexus_graph_lens_metrics');
    assert.ok(src.includes("required: ['lensId', 'repo']"), "lens-metrics inputSchema must require lensId + repo");
  });
  it('gitnexus_graph_lens_metrics handler hits /graph/metrics/lens/', () => {
    assert.ok(src.includes('/graph/metrics/lens/'), 'handler must call /graph/metrics/lens/');
    assert.ok(src.includes('encodeURIComponent(lensId)'), 'handler must encode lensId');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && node --test server.test.mjs`
Expected: FAIL — the lens-metrics tool isn't registered.

- [ ] **Step 3: Implement**

In `mcp-server/server.mjs`, add a new tool object to the `TOOLS` array immediately AFTER the `gitnexus_graph_metrics` tool object:

```js
  {
    name: 'gitnexus_graph_lens_metrics',
    description: 'Graph-theory metrics over a CODE-graph lens projection of a repo (today imports-deps = file-level import dependency graph). Same metric set as gitnexus_graph_metrics — surfaces central hub files, articulation points (fragile single-points-of-failure in the dependency structure), and module communities. Community method selectable (louvain/leiden/labelprop). Large projections are node-capped (summary.capped flags when super-linear metrics were skipped).',
    inputSchema: {
      type: 'object',
      properties: {
        lensId: { type: 'string', description: 'Lens id (e.g. imports-deps).' },
        repo: { type: 'string', description: 'Repo to read the ASTKG from (via /api/graph).' },
        community: { type: 'string', enum: ['louvain', 'leiden', 'labelprop'], description: 'Community-detection method (default louvain).' },
        resolution: { type: 'number', description: 'Resolution γ for Louvain/Leiden (default 1).' },
      },
      required: ['lensId', 'repo'],
      additionalProperties: false,
    },
    handler: ({ lensId, repo, community, resolution }) => {
      const params = { repo };
      if (community) params.community = community;
      if (resolution !== undefined) params.resolution = resolution;
      return callWeb(`/graph/metrics/lens/${encodeURIComponent(lensId)}`, params);
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && node --test server.test.mjs`
Expected: PASS (new + all pre-existing).

- [ ] **Step 5: Commit** — controller handles git.

---

### Task 4: Frontend — extend the overlay to the lens view

**Files:**
- Modify: `upstream/gitnexus-web/src/services/graph-theory-client.ts`
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx`
- Test: `tests/unit/graph-theory-client.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/graph-theory-client.test.mjs` (a second `it`, importing `getGraphLensMetrics`):

```js
import { getGraphMetrics, getGraphLensMetrics } from '../../upstream/gitnexus-web/src/services/graph-theory-client.ts';
// ... existing test ...
describe('getGraphLensMetrics', () => {
  it('GETs /graph/metrics/lens/:lensId?repo= (encoded) and returns the payload', async () => {
    const fake = { nodes: [{ id: 'src/a.ts', degree: 1, pagerank: 0.5, betweenness: 0, eigenvector: 0.3, closeness: 0, katz: 0.1, harmonic: 0, coreness: 1, clustering: 0, articulation: false, componentId: 0, community: 0 }],
      bridges: [], summary: { nodeCount: 1, edgeCount: 0, communityCount: 1, modularity: 0, density: 0, componentCount: 1, transitivity: 0, capped: false, omittedMetrics: [] } };
    const f = vi.fn(async () => ({ ok: true, json: async () => fake }));
    vi.stubGlobal('fetch', f);
    const r = await getGraphLensMetrics('imports-deps', 'my repo');
    expect(f).toHaveBeenCalledWith('/graph/metrics/lens/imports-deps?repo=my%20repo');
    expect(r.summary.capped).toBe(false);
  });
});
```

(Keep the existing `getGraphMetrics` test in the file; just add the import + the new describe block.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-client`
Expected: FAIL — `getGraphLensMetrics` not exported.

- [ ] **Step 3: Implement**

(3a) `upstream/gitnexus-web/src/services/graph-theory-client.ts` — add the optional summary fields + the new fetch fn. Change the `GraphMetrics` summary type to include the two optional fields, and append the function:

```ts
export interface GraphMetrics {
  nodes: GraphMetricNode[];
  bridges: { source: string; target: string }[];
  summary: { nodeCount: number; edgeCount: number; communityCount: number; modularity: number; density: number; componentCount: number; transitivity: number; capped?: boolean; omittedMetrics?: string[] };
}
```

and add at the end of the file:

```ts
export async function getGraphLensMetrics(lensId: string, repo: string): Promise<GraphMetrics> {
  const res = await fetch(`/graph/metrics/lens/${encodeURIComponent(lensId)}?repo=${encodeURIComponent(repo)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as GraphMetrics;
}
```

(`getGraphMetrics`, `GraphMetricNode`, `SizeMetric` are unchanged.)

(3b) `upstream/gitnexus-web/src/components/GraphCanvas.tsx` — read the current lines first (the line numbers below are approximate). Three edits:

1. Import `getGraphLensMetrics` alongside `getGraphMetrics` (line ~48):
```tsx
import { getGraphMetrics, getGraphLensMetrics } from '../services/graph-theory-client';
```

2. The metrics-fetch effect (currently `if (!metricsOn || !researchName) { setMetricsById(null); return; }` then `getGraphMetrics(researchName)`): generalize it to also fire in lens mode. Replace the effect body so the guard is `metricsOn && (researchName || (lensId && lensRepo))` and the fetch picks the right client fn:
```tsx
  useEffect(() => {
    const lensActive = !!(lensId && lensRepo);
    if (!metricsOn || (!researchName && !lensActive)) {
      setMetricsById(null);
      return;
    }
    let cancelled = false;
    const p = researchName ? getGraphMetrics(researchName) : getGraphLensMetrics(lensId!, lensRepo!);
    p
      .then((m) => {
        if (cancelled) return;
        setMetricsById(new Map(m.nodes.map((n) => [n.id, { degree: n.degree, pagerank: n.pagerank, betweenness: n.betweenness, eigenvector: n.eigenvector, closeness: n.closeness, katz: n.katz, harmonic: n.harmonic, coreness: n.coreness, clustering: n.clustering, community: n.community }])));
      })
      .catch((e) => { if (!cancelled) console.error('graph metrics load failed', e); });
    return () => { cancelled = true; };
  }, [metricsOn, researchName, lensId, lensRepo]);
```
(If `researchName` is set it wins; otherwise lens. The map build is identical to the existing one.)

3. The Metrics toggle render gate (currently `{researchName && (`) and the size `<select>` gate (currently `metricsOn && researchName`): widen both to include lens mode. Change the toggle gate to:
```tsx
        {(researchName || (lensId && lensRepo)) && (
```
and the select gate to:
```tsx
        {metricsOn && (researchName || (lensId && lensRepo)) && (
```

- [ ] **Step 4: Run test + type-check**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-client` → PASS.
The web image build (Final stack e2e) type-checks the frontend (the in-container `tsc`/vite build). If a local `tsc` is available (`cd upstream/gitnexus-web && npx tsc -b --noEmit`), run it; otherwise rely on the e2e build.

- [ ] **Step 5: Commit** — controller handles git/patches.

---

### Task 5: Docs — roadmap (P2.3.2a shipped + P2.3.2b/c backlog) + inventory

**Files:**
- Modify: `ROADMAP.md`
- Modify: `INVENTORY.md`

- [ ] **Step 1: ROADMAP.md** — under the P2 section, change the **P2.3.2 (B)** backlog row to record **P2.3.2a ✅ Livré 2026-06-09** (metrics over a lens — `GET /graph/metrics/lens/:lensId?repo=` over the imports-deps file-level code graph, node-capped, MCP `gitnexus_graph_lens_metrics`, overlay extended to lens view), and add backlog rows for **P2.3.2b** (full file-level ASTKG collapse, all relationship types) and **P2.3.2c** (symbol-level + sampling/LoD + result caching). Update the P2 summary-row status to mention P2.3.2a livré.

- [ ] **Step 2: INVENTORY.md** — extend the `/graph/metrics` entry: add `GET /graph/metrics/lens/:lensId?repo=<repo>` (fetches the ASTKG via `/api/graph` on `GITNEXUS_API`, projects via the shared `LENSES` registry, runs `computeMetricsCapped`; node-capped with `summary.capped`/`omittedMetrics`; `gitnexus_graph_lens_metrics` MCP tool; overlay works in lens view). Note `computeMetricsCapped` + the `skipSuperLinear` engine option.

- [ ] **Step 3: Commit** — controller handles git.

---

## Final verification (controller-run, after all tasks)

1. **Drift:** `node scripts/check-patch-drift.mjs` → exit 0 (controller regenerates patches).
2. **Affected unit tests host-native** (Docker tier may be blocked by the env npm-registry outage): `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory` (core + endpoint + lens-metrics + client) → all pass. Run each file separately if memory-constrained.
3. **MCP:** `cd mcp-server && node --test server.test.mjs` → all pass.
4. **Stack e2e** (`TEST_PORT=4847 TEST_WEB_PORT=4273`, temp extraction of `sample-repo.tar.gz`): build+up (the web image rebuild type-checks the frontend), confirm the repo is indexed (the ASTKG exists), then:
   - `GET /graph/metrics/lens/imports-deps?repo=<repo>` → 200 with per-node metrics + a `summary` carrying `capped`/`omittedMetrics`.
   - `GET /graph/metrics/lens/bogus?repo=<repo>` → 404; `GET /graph/metrics/lens/imports-deps` (no repo) → 400.
   - Sanity: the existing `GET /graph/metrics/<sidecar-name>` still 200s (now also carries `capped:false`).
   - Confirm `/graph/metrics/lens/...` is NOT mis-handled as a sidecar name (no 404 "graph lens/... not available").
5. **No Dockerfile.web change** — confirm `git diff` touches no `upstream/Dockerfile.web`.
6. Push is the **user's call** — summarize P2.3.2a shipped + P2.3.2b/c backlog, ask before pushing.
