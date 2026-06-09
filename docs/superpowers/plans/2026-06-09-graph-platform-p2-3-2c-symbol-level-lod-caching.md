# Graph Platform P2.3.2c — symbol-level metrics + cap + approximation (LoD) + caching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Run metrics over the raw symbol-level ASTKG; add a configurable node cap, approximate (sampled) betweenness/closeness/harmonic for large graphs instead of zeros, and a TTL result cache.

**Architecture:** A `symbol-graph` lens (identity projection) reuses the lens-agnostic metrics route. New pure-JS `*Approx` engine fns (source/pivot sampling, exact at S≥V). `computeMetricsCapped` gains `cap`+`approx` options. A small TTL+LRU cache in the routes module (injected clock for testability). Already-COPY'd modules only — no Dockerfile.web change.

**Tech Stack:** Node ESM (zero-dep `.mjs`), vitest, node:test.

**Spec:** `docs/superpowers/specs/2026-06-09-graph-platform-p2-3-2c-symbol-level-lod-caching-design.md`

**Current state (verified):** engine `betweenness(graph)` (lines ~150-183), `bfsDistances(adj,ids,s)` (~326), `closeness`/`harmonic` (~338-363), `mulberry32(seed)`, `computeMetrics(graph,{community,resolution,seed,skipSuperLinear})` (~467), `computeMetricsCapped(graph,{cap=2000,...opts})` (~533). Routes: `parseMetricsParams(searchParams)`, `handleGraphMetricsRoute`, `handleGraphLensMetricsRoute`, `lensMetrics(apiGraph,lensId,params,cap)` in `docker-server-graph-theory.mjs`. Lenses: `projectImports`, `projectFileGraph`, `LENSES` in `docker-server-graph-lens-core.mjs`.

---

### Task 1: Approximate centralities (Brandes–Pich + pivot sampling)

**Files:** Modify `upstream/docker-server-graph-theory-core.mjs`; Test `tests/unit/graph-theory-core.test.mjs`.

- [ ] **Step 1: Failing tests** — add to `graph-theory-core.test.mjs` (import `betweennessApprox, closenessApprox, harmonicApprox`):

```js
describe('approximate centralities (exact at full samples, ranking at partial)', () => {
  it('betweennessApprox equals exact when samples >= V', () => {
    for (const G of [PATH3, STAR, BARBELL, CYCLE4]) {
      const ex = betweenness(G); const ap = betweennessApprox(G, { samples: 999, seed: 1 });
      for (const id of Object.keys(ex)) expect(ap[id]).toBeCloseTo(ex[id], 9);
    }
  });
  it('closeness/harmonicApprox equal exact when samples >= V', () => {
    for (const G of [PATH3, STAR, BARBELL]) {
      const ec = closeness(G), ac = closenessApprox(G, { samples: 999, seed: 1 });
      const eh = harmonic(G), ah = harmonicApprox(G, { samples: 999, seed: 1 });
      for (const id of Object.keys(ec)) { expect(ac[id]).toBeCloseTo(ec[id], 9); expect(ah[id]).toBeCloseTo(eh[id], 9); }
    }
  });
  it('partial-sample approximations are finite, non-negative, and rank the path middle highest', () => {
    const b = betweennessApprox(PATH3, { samples: 2, seed: 1 });
    const c = closenessApprox(PATH3, { samples: 2, seed: 1 });
    const h = harmonicApprox(PATH3, { samples: 2, seed: 1 });
    for (const m of [b, c, h]) for (const v of Object.values(m)) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); }
    expect(b.B).toBeGreaterThanOrEqual(b.A);   // middle ≥ ends (estimate)
  });
  it('is deterministic for a fixed seed', () => {
    expect(betweennessApprox(BARBELL, { samples: 3, seed: 7 })).toEqual(betweennessApprox(BARBELL, { samples: 3, seed: 7 }));
  });
});
```

- [ ] **Step 2: Run → fail** (`cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-core`) — `betweennessApprox is not a function`.

- [ ] **Step 3: Implement** — in `docker-server-graph-theory-core.mjs`:

(3a) Add a sampling helper + refactor `betweenness` to share a per-source accumulator. Replace the `betweenness` function with:

```js
/** Sample k distinct ids deterministically (partial Fisher–Yates with a seeded RNG). */
function samplePivots(ids, k, seed) {
  const rng = mulberry32(seed);
  const arr = ids.slice();
  const n = arr.length;
  const m = Math.min(k, n);
  for (let i = 0; i < m; i++) {
    const j = i + Math.floor(rng() * (n - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, m);
}

/** One Brandes source pass: BFS from s + dependency back-accumulation into cb (mutates cb). */
function brandesAccumulate(adj, ids, s, cb) {
  const stack = [];
  const pred = new Map(ids.map((id) => [id, []]));
  const sigma = new Map(ids.map((id) => [id, 0]));
  const dist = new Map(ids.map((id) => [id, -1]));
  sigma.set(s, 1); dist.set(s, 0);
  const queue = [s];
  while (queue.length) {
    const v = queue.shift();
    stack.push(v);
    for (const w of adj.get(v)) {
      if (dist.get(w) < 0) { dist.set(w, dist.get(v) + 1); queue.push(w); }
      if (dist.get(w) === dist.get(v) + 1) { sigma.set(w, sigma.get(w) + sigma.get(v)); pred.get(w).push(v); }
    }
  }
  const delta = new Map(ids.map((id) => [id, 0]));
  while (stack.length) {
    const w = stack.pop();
    for (const v of pred.get(w)) delta.set(v, delta.get(v) + (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w)));
    if (w !== s) cb[w] += delta.get(w);
  }
}

/** Normalize raw Brandes scores in place: undirected /2 + /((N-1)(N-2)/2). */
function normalizeBetweenness(cb, ids, N) {
  for (const id of ids) cb[id] /= 2;
  const norm = N > 2 ? ((N - 1) * (N - 2)) / 2 : 0;
  if (norm > 0) for (const id of ids) cb[id] /= norm;
  return cb;
}

/** Betweenness centrality (Brandes, undirected, unweighted), normalized to [0,1]. */
export function betweenness(graph) {
  const { ids, adj } = undirectedAdj(graph);
  const cb = {};
  for (const id of ids) cb[id] = 0;
  for (const s of ids) brandesAccumulate(adj, ids, s, cb);
  return normalizeBetweenness(cb, ids, ids.length);
}

/** Approximate betweenness via Brandes–Pich source sampling (scale by V/S); exact when samples≥V. */
export function betweennessApprox(graph, { samples = 100, seed = 1 } = {}) {
  const { ids, adj } = undirectedAdj(graph);
  const N = ids.length;
  if (N === 0) return {};
  if (samples >= N) return betweenness(graph);
  const cb = {};
  for (const id of ids) cb[id] = 0;
  const sources = samplePivots(ids, samples, seed);
  const S = sources.length;
  for (const s of sources) brandesAccumulate(adj, ids, s, cb);
  for (const id of ids) cb[id] *= N / S;          // unbiased scaling
  return normalizeBetweenness(cb, ids, N);
}
```

(3b) Add `closenessApprox` + `harmonicApprox` after `harmonic` (they reuse `bfsDistances` + `samplePivots`):

```js
/** Approximate closeness (Wasserman–Faust) via pivot sampling; exact when samples≥V. */
export function closenessApprox(graph, { samples = 100, seed = 1 } = {}) {
  const { ids, adj } = undirectedAdj(graph);
  const N = ids.length;
  if (N === 0) return {};
  if (samples >= N) return closeness(graph);
  const pivots = samplePivots(ids, samples, seed);
  const sumDist = new Map(ids.map((id) => [id, 0]));   // Σ d(v,pivot) over reachable pivots≠v
  const reachP = new Map(ids.map((id) => [id, 0]));     // # reachable pivots ≠ v
  const cntP = new Map(ids.map((id) => [id, 0]));       // # pivots ≠ v (sampled "others")
  for (const p of pivots) {
    const dist = bfsDistances(adj, ids, p);             // undirected: d(p,v)=d(v,p)
    for (const v of ids) {
      if (v === p) continue;
      cntP.set(v, cntP.get(v) + 1);
      const d = dist.get(v);
      if (d > 0) { sumDist.set(v, sumDist.get(v) + d); reachP.set(v, reachP.get(v) + 1); }
    }
  }
  const out = {};
  for (const v of ids) {
    const c = cntP.get(v), r = reachP.get(v), sd = sumDist.get(v);
    if (r === 0 || sd === 0 || N <= 1) { out[v] = 0; continue; }
    const reachEst = (r / c) * (N - 1);    // estimated reachable others
    const sumDistEst = (sd / r) * reachEst; // mean dist × estimated reach
    out[v] = (reachEst / (N - 1)) * (reachEst / sumDistEst);
  }
  return out;
}

/** Approximate harmonic centrality via pivot sampling (sample mean of 1/d); exact when samples≥V. */
export function harmonicApprox(graph, { samples = 100, seed = 1 } = {}) {
  const { ids, adj } = undirectedAdj(graph);
  const N = ids.length;
  if (N === 0) return {};
  if (samples >= N) return harmonic(graph);
  const pivots = samplePivots(ids, samples, seed);
  const sumRecip = new Map(ids.map((id) => [id, 0]));
  const cnt = new Map(ids.map((id) => [id, 0]));
  for (const p of pivots) {
    const dist = bfsDistances(adj, ids, p);
    for (const v of ids) {
      if (v === p) continue;
      cnt.set(v, cnt.get(v) + 1);
      const d = dist.get(v);
      if (d > 0) sumRecip.set(v, sumRecip.get(v) + 1 / d);
    }
  }
  const out = {};
  for (const v of ids) { const c = cnt.get(v); out[v] = c > 0 ? sumRecip.get(v) / c : 0; }
  return out;
}
```

- [ ] **Step 4: Run → pass.** (betweenness's existing path/star/barbell/edgeless tests still pass — the refactor is behaviour-preserving; the new approx tests pass.)

- [ ] **Step 5: Commit** — controller.

---

### Task 2: `symbol-graph` lens (raw projection)

**Files:** Modify `upstream/docker-server-graph-lens-core.mjs`; Test `tests/unit/graph-theory-lens-metrics.test.mjs`.

- [ ] **Step 1: Failing tests** — add (import `projectSymbolGraph`):

```js
const SYMBOL_GRAPH = {
  nodes: [
    { id: 'f1', properties: { filePath: 'src/a.ts', name: 'foo', kind: 'function' } },
    { id: 'f2', properties: { filePath: 'src/a.ts', name: 'bar', kind: 'function' } },
    { id: 'c1', properties: { filePath: 'src/b.ts', name: 'Baz', kind: 'class' } },
    { id: 'iso', properties: { filePath: 'src/c.ts', name: 'lonely', kind: 'function' } }, // isolated
  ],
  relationships: [
    { sourceId: 'f1', targetId: 'f2', type: 'CALLS' },
    { sourceId: 'f1', targetId: 'c1', type: 'REFERENCES' },
    { sourceId: 'f1', targetId: 'c1', type: 'CALLS' },   // parallel, different type → kept
    { sourceId: 'f1', targetId: 'c1', type: 'CALLS' },   // exact dup → dropped
    { sourceId: 'f2', targetId: 'f2', type: 'CALLS' },   // self-loop → dropped
  ],
};

describe('projectSymbolGraph', () => {
  it('keeps ALL nodes (incl. isolated), no file collapse', () => {
    const g = projectSymbolGraph(SYMBOL_GRAPH);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['c1', 'f1', 'f2', 'iso']);
    expect(g.nodes.find((n) => n.id === 'f1')).toMatchObject({ type: 'function', label: 'foo', path: 'src/a.ts' });
    expect(g.schema_type).toBe('symbol-graph');
  });
  it('dedups per (source,target,type), keeps parallel distinct types, drops self-loops', () => {
    const g = projectSymbolGraph(SYMBOL_GRAPH);
    expect(g.edges.filter((e) => e.source === 'f1' && e.target === 'c1' && e.kind === 'CALLS')).toHaveLength(1);
    expect(g.edges.some((e) => e.source === 'f1' && e.target === 'c1' && e.kind === 'REFERENCES')).toBe(true);
    expect(g.edges.some((e) => e.source === e.target)).toBe(false);
  });
  it('is registered and computes via lensMetrics', () => {
    expect(LENSES['symbol-graph']).toBe(projectSymbolGraph);
    const r = lensMetrics(SYMBOL_GRAPH, 'symbol-graph', { community: 'louvain', resolution: 1 });
    expect(r.summary.nodeCount).toBe(4);
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — add to `docker-server-graph-lens-core.mjs` (after `projectFileGraph`) and extend `LENSES`:

```js
/**
 * Identity projection of the raw symbol-level KnowledgeGraph (no file collapse):
 * every node → a symbol node, every relationship → an edge (deduped per
 * (source,target,type), self-loops dropped). ALL nodes kept, including isolated ones.
 */
export function projectSymbolGraph(graph) {
  const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const rels = Array.isArray(graph?.relationships) ? graph.relationships : [];
  const idSet = new Set();
  const nodes = [];
  for (const n of rawNodes) {
    if (n?.id == null || idSet.has(n.id)) continue;
    idSet.add(n.id);
    const p = n.properties || {};
    nodes.push({ id: n.id, type: p.kind || 'symbol', label: p.name || String(n.id), path: p.filePath || '', stage: '' });
  }
  const seen = new Set();
  const edges = [];
  for (const r of rels) {
    const s = r?.sourceId, t = r?.targetId;
    if (!idSet.has(s) || !idSet.has(t) || s === t) continue;
    const key = `${s}\0${t}\0${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: `${s}->${t}:${r.type}`, source: s, target: t, kind: r.type });
  }
  return {
    schema_type: 'symbol-graph', template: 'symbol-graph', name: null, source: null,
    nodes, edges, report: { nodes: nodes.length, edges: edges.length },
  };
}
```

Change the `LENSES` export to:
```js
export const LENSES = { 'imports-deps': projectImports, 'file-graph': projectFileGraph, 'symbol-graph': projectSymbolGraph };
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** — controller.

---

### Task 3: `cap` + `approx` params + `computeMetricsCapped` approximation wiring

**Files:** Modify `upstream/docker-server-graph-theory-core.mjs` (`computeMetrics`/`computeMetricsCapped`) + `upstream/docker-server-graph-theory.mjs` (`parseMetricsParams`); Test both `graph-theory-core.test.mjs` + `graph-theory-endpoint.test.mjs`.

- [ ] **Step 1: Failing tests**

Add to `graph-theory-core.test.mjs`:
```js
describe('computeMetricsCapped — approx (LoD)', () => {
  it('above cap with approx computes sampled centralities (non-zero), skips coreness/clustering', () => {
    const r = computeMetricsCapped(BARBELL, { cap: 2, approx: 3 });
    expect(r.summary.capped).toBe(true);
    expect(r.summary.approximate).toBe(true);
    expect(r.summary.sampleSize).toBe(3);
    expect(r.summary.omittedMetrics).toEqual(['coreness', 'clustering']);
    expect(r.nodes.some((n) => n.betweenness > 0)).toBe(true);   // estimated, not zeroed
    expect(r.nodes.every((n) => n.coreness === 0 && n.clustering === 0)).toBe(true);
  });
  it('above cap without approx skips all super-linear (today behaviour)', () => {
    const r = computeMetricsCapped(BARBELL, { cap: 2 });
    expect(r.summary.approximate).toBe(false);
    expect(r.nodes.every((n) => n.betweenness === 0 && n.closeness === 0)).toBe(true);
    expect(r.summary.omittedMetrics).toEqual(['betweenness', 'closeness', 'harmonic', 'coreness', 'clustering']);
  });
  it('below cap ignores approx and is exact', () => {
    const r = computeMetricsCapped(BARBELL, { cap: 1000, approx: 3 });
    expect(r.summary.capped).toBe(false);
    expect(r.summary.approximate).toBe(false);
  });
});
```

Add to `graph-theory-endpoint.test.mjs`:
```js
it('parses cap + approx (positive ints; clamps cap; rejects bad)', () => {
  expect(parseMetricsParams(new URLSearchParams('cap=5000&approx=200'))).toMatchObject({ cap: 5000, approx: 200 });
  expect(parseMetricsParams(new URLSearchParams('')).cap).toBe(2000);              // default
  expect(parseMetricsParams(new URLSearchParams('')).approx).toBe(null);
  expect(parseMetricsParams(new URLSearchParams('cap=999999')).cap).toBe(50000);   // clamp to CAP_MAX
  expect(() => parseMetricsParams(new URLSearchParams('cap=0'))).toThrow();
  expect(() => parseMetricsParams(new URLSearchParams('approx=-1'))).toThrow();
  expect(() => parseMetricsParams(new URLSearchParams('approx=abc'))).toThrow();
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

(3a) `computeMetrics` — add an `approx` option that swaps the three shortest-path centralities for their `*Approx` variants when `approx` is a positive integer AND `skipSuperLinear` is true (i.e. we're in the large-graph path). Change the signature + the super-linear block:

```js
export function computeMetrics(graph, { community = 'louvain', resolution = 1, seed = 1, skipSuperLinear = false, approx = null } = {}) {
  const ids = nodeIds(graph);
  const deg = degreeCentrality(graph);
  const pr = pageRank(graph);
  const ev = eigenvector(graph);
  const kz = katz(graph);
  const useApprox = skipSuperLinear && Number.isInteger(approx) && approx > 0;
  // Super-linear shortest-path centralities: full when not skipping; sampled when approx; else {}.
  const bt = skipSuperLinear ? (useApprox ? betweennessApprox(graph, { samples: approx, seed }) : {}) : betweenness(graph);
  const cl = skipSuperLinear ? (useApprox ? closenessApprox(graph, { samples: approx, seed }) : {}) : closeness(graph);
  const hr = skipSuperLinear ? (useApprox ? harmonicApprox(graph, { samples: approx, seed }) : {}) : harmonic(graph);
  // k-core + clustering are NOT approximated — skipped whenever skipSuperLinear.
  const core = skipSuperLinear ? new Map() : kCore(graph);
  const { local: clustering, transitivity } = skipSuperLinear ? { local: {}, transitivity: 0 } : clusteringCoefficient(graph);
  const comp = connectedComponents(graph);
  const { articulation, bridges } = articulationPointsAndBridges(graph);
```

(The rest of `computeMetrics` — node assembly + summary — is unchanged. Default `approx=null`/`skipSuperLinear=false` keeps it byte-identical.)

(3b) `computeMetricsCapped` — thread `approx` + set the summary flags:

```js
export function computeMetricsCapped(graph, { cap = 2000, approx = null, ...opts } = {}) {
  const skip = nodeIds(graph).length > cap;
  const useApprox = skip && Number.isInteger(approx) && approx > 0;
  const r = computeMetrics(graph, { ...opts, skipSuperLinear: skip, approx: useApprox ? approx : null });
  r.summary.capped = skip;
  r.summary.approximate = useApprox;
  r.summary.sampleSize = useApprox ? approx : null;
  r.summary.omittedMetrics = !skip ? []
    : useApprox ? ['coreness', 'clustering']
    : ['betweenness', 'closeness', 'harmonic', 'coreness', 'clustering'];
  return r;
}
```

(3c) `parseMetricsParams` in `docker-server-graph-theory.mjs` — add `cap` + `approx` (and a `CAP_MAX`):

```js
const CAP_MAX = 50000;
function parsePosInt(searchParams, key, { def = null, clampMax = null } = {}) {
  const raw = searchParams.get(key);
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be a positive integer, got "${raw}"`);
  return clampMax != null ? Math.min(n, clampMax) : n;
}
```
and in `parseMetricsParams`, after computing `community`/`resolution`, add:
```js
  const cap = parsePosInt(searchParams, 'cap', { def: 2000, clampMax: CAP_MAX });
  const approx = parsePosInt(searchParams, 'approx', { def: null });
  return { community, resolution, cap, approx };
```
**`lensMetrics` reconciliation (keep the existing test green):** the current `lensMetrics(apiGraph, lensId, params, cap = 2000)` is called by an existing test as `lensMetrics(g, 'imports-deps', {}, 1)` (4th-arg cap). Keep the 4th arg as a **fallback** so that test still works, with `params.cap` (from the query) taking precedence:

```js
export function lensMetrics(apiGraph, lensId, params, cap = 2000) {
  const project = LENSES[lensId];
  if (!project) throw new Error(`unknown lens: ${lensId}`);
  return computeMetricsCapped(project(apiGraph), { ...params, cap: params.cap ?? cap });
}
```

So `lensMetrics(g, id, {}, 1)` → `params.cap` undefined → cap 1 (existing test passes); the route calls `lensMetrics(apiGraph, lensId, params)` where `params.cap` (from `parseMetricsParams`, default 2000 or the `?cap=`) wins. Update the **sidecar** route to pass the full `params` (carrying `cap`/`approx`) to `computeMetricsCapped` (it already passes `params`; no signature change needed there — `computeMetricsCapped` now reads `cap`/`approx` from it).

- [ ] **Step 4: Run → pass** (`graph-theory-core` + `graph-theory-endpoint` + `graph-theory-lens-metrics` — the lensMetrics signature change must keep its existing tests green; if `lensMetrics`'s 4th-arg `cap` was used by a test, reconcile so `params.cap` wins).

- [ ] **Step 5: Commit** — controller.

---

### Task 4: TTL + LRU result cache

**Files:** Modify `upstream/docker-server-graph-theory.mjs`; Test `tests/unit/graph-theory-cache.test.mjs` (new).

- [ ] **Step 1: Failing test** — create `graph-theory-cache.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { makeMetricsCache } from '../../upstream/docker-server-graph-theory.mjs';

describe('metrics cache (TTL + LRU, injected clock)', () => {
  it('hits within TTL, misses after, bypasses on fresh, evicts oldest at capacity', () => {
    let now = 1000;
    const c = makeMetricsCache({ ttlMs: 100, max: 2, clock: () => now });
    c.set('a', { v: 1 }); expect(c.get('a')).toEqual({ v: 1 });   // hit
    now = 1101; expect(c.get('a')).toBe(undefined);                // expired
    now = 2000; c.set('b', {}); c.set('d', {}); c.set('e', {});    // max 2 → 'b' evicted
    expect(c.get('b')).toBe(undefined); expect(c.get('e')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — add to `docker-server-graph-theory.mjs`:

```js
const METRICS_CACHE_TTL_MS = 300_000;
const METRICS_CACHE_MAX = 64;

/** Tiny TTL + insertion-order(LRU-ish) cache. Clock injected for testability. */
export function makeMetricsCache({ ttlMs = METRICS_CACHE_TTL_MS, max = METRICS_CACHE_MAX, clock = Date.now } = {}) {
  const m = new Map();   // key → { val, at }
  return {
    get(key) {
      const e = m.get(key);
      if (!e) return undefined;
      if (clock() - e.at > ttlMs) { m.delete(key); return undefined; }
      return e.val;
    },
    set(key, val) {
      m.delete(key);
      m.set(key, { val, at: clock() });
      while (m.size > max) m.delete(m.keys().next().value);   // evict oldest
    },
  };
}

const metricsCache = makeMetricsCache();
function metricsCacheKey(kind, idOrName, lensId, params) {
  return `${kind}|${idOrName}|${lensId || ''}|${params.community}|${params.resolution}|${params.cap}|${params.approx ?? ''}`;
}
```

Wire it into both route handlers: build the key, check `?fresh=1` (skip lookup), `metricsCache.get(key)` → return cached on hit (before the sidecarRender / `/api/graph` fetch), `metricsCache.set(key, payload)` after a successful compute. For the lens route: `const fresh = url.searchParams.get('fresh') === '1';` then on the key build use `metricsCacheKey('lens', repo, lensId, params)`; sidecar uses `metricsCacheKey('sidecar', name, '', params)`.

- [ ] **Step 4: Run → pass** (`graph-theory-cache` + the route tests unaffected).

- [ ] **Step 5: Commit** — controller.

---

### Task 5: MCP params/description + docs (controller)

**Files:** `mcp-server/server.mjs` + `mcp-server/server.test.mjs`; `ROADMAP.md`, `INVENTORY.md`.

- [ ] **Step 1:** `gitnexus_graph_lens_metrics` — add optional `cap` (number) + `approx` (number) to its inputSchema; refresh the description to mention the `symbol-graph` lens + the cap/approx/LoD knobs. Add a `server.test.mjs` assertion: description mentions `symbol-graph`; schema offers `cap`+`approx`. Run `node --test server.test.mjs` → pass.
- [ ] **Step 2: ROADMAP.md** — flip **P2.3.2c** to ✅ Livré 2026-06-09 (symbol-graph lens + `?cap=`/`?approx=` + Brandes–Pich approximation + TTL cache); update the P2 summary row (P2.3.2 fully livré). 
- [ ] **Step 3: INVENTORY.md** — extend the `/graph/metrics/lens` note: 3rd lens `symbol-graph` (raw symbol-level), `?cap=`/`?approx=`/`?fresh=` params, `computeMetricsCapped` approximation (`summary.approximate`/`sampleSize`), result cache.
- [ ] **Step 4: Commit** — controller.

---

## Final verification (controller)

1. **Drift** → exit 0.
2. **Unit (host-native, per file):** `graph-theory-core` (incl. approx + cap-approx tests), `graph-theory-endpoint` (cap/approx parsing), `graph-theory-lens-metrics` (symbol-graph), `graph-theory-cache` → all pass.
3. **MCP** → all pass.
4. **No Dockerfile.web change.**
5. **Stack e2e** — same `/data/projects:ro` limit (no ASTKG indexable). Confirm `/graph/metrics/lens/symbol-graph?repo=x` 502s cleanly over an unindexed repo (not a crash) if a stack is up; the route+cache plumbing is the already-verified P2.3.2a path. Verified by composition + unit.
6. Push is the **user's call** — summarize P2.3.2c shipped + P2.3.2/B fully closed; P2.3.3 (viz surfaces) remains.
