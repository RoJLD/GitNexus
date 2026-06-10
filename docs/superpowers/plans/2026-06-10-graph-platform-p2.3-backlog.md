# Graph Platform P2.3 backlog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add directed metrics, multi-level community hierarchy, and spectral node embeddings to the pure-JS graph-theory engine, exposed as opt-in query params on the existing `/graph/metrics` routes + MCP tools, fully backward-compatible.

**Architecture:** Three additive engine functions in `upstream/docker-server-graph-theory-core.mjs`, gated into `computeMetrics`/`computeMetricsCapped` by new opts; new query params parsed in `parseMetricsParams` and threaded through the cache key and MCP handlers in `upstream/docker-server-graph-theory.mjs` + `mcp-server/server.mjs`. Reuses existing helpers (`nodeIds`, `cleanEdges`, `mulberry32`, the `eigenvector` power-iteration pattern, `brandesAccumulate`). Zero new deps.

**Tech Stack:** Node ESM (pure JS), vitest (host-native), node:test (MCP). Spec: `docs/superpowers/specs/2026-06-10-graph-platform-p2.3-backlog-design.md`.

**Verification venue:** host-native vitest — `cd tests && npx vitest run --config vitest.config.unit.mjs <filter>`. MCP — `node --test mcp-server/server.test.mjs`. Tests import the engine directly from `../../upstream/docker-server-graph-theory-core.mjs`.

**Patch/git discipline (controller only — implementers NEVER touch git/patches):** after all tasks, the controller regenerates `patches/*.diff` from `upstream/` and runs `node scripts/check-patch-drift.mjs` (must exit 0) before committing.

---

### Task 1: Directed metrics engine

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs` (add functions; do not alter existing ones)
- Test: `tests/unit/graph-theory-core.test.mjs` (append new describe blocks)

New exported functions:
- `directedAdj(graph)` → `{ ids, out: Map<id,id[]>, in: Map<id,id[]> }` over the direction-preserving `cleanEdges` output (which already returns ordered `[s,t]` and drops self-loops/dangling).
- `inOutDegree(graph)` → `{ inDegree: {id→n}, outDegree: {id→n} }`.
- `hits(graph, {maxIter=200, tol=1e-9})` → `{ hubs: {id→x}, authorities: {id→x} }`. HITS: init hubs=authorities=1; repeat `auth[v] = Σ_{u→v} hub[u]`, normalize auth (L2); `hub[v] = Σ_{v→w} auth[w]`, normalize hub (L2); until L1 change < tol or maxIter. Empty graph → `{}`/`{}`. Zero-norm guard → uniform `1/N` (mirror `eigenvector`).
- `stronglyConnectedComponents(graph)` → `Map<id, sccId>` via **iterative** Tarjan (explicit stack; no recursion — deep graphs must not blow the call stack, matching `articulationPointsAndBridges`). sccIds assigned 0..k-1 in completion order.
- `directedBetweenness(graph)` → `{id→score}` Brandes on **out-adjacency**, normalized by `(N-1)*(N-2)` (NO `/2` — directed). Reuse `brandesAccumulate` but pass the **out** adjacency (it already accumulates correctly for directed BFS); write a `normalizeDirectedBetweenness(cb, ids, N)` (divides by `(N-1)(N-2)` when `N>2`, NO halving).

- [ ] **Step 1: Write failing tests for in/out degree + HITS + SCC + directed betweenness**

Append to `tests/unit/graph-theory-core.test.mjs`. Add this fixture near the top fixtures:

```js
// Directed: a → b → c (path) plus a → c (shortcut); and a 2-cycle d ↔ e with isolated f.
const DIGRAPH = { nodes: ['a','b','c','d','e','f'].map((id) => ({ id })),
  edges: [
    { source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'c' },
    { source: 'd', target: 'e' }, { source: 'e', target: 'd' },
  ] };
// Classic HITS shape: two "hubs" h1,h2 both point at two "authorities" p1,p2.
const HITS_G = { nodes: ['h1','h2','p1','p2'].map((id) => ({ id })),
  edges: [
    { source: 'h1', target: 'p1' }, { source: 'h1', target: 'p2' },
    { source: 'h2', target: 'p1' }, { source: 'h2', target: 'p2' },
  ] };
```

```js
import { directedAdj, inOutDegree, hits, stronglyConnectedComponents, directedBetweenness } from '../../upstream/docker-server-graph-theory-core.mjs';

describe('inOutDegree', () => {
  it('splits degree by direction', () => {
    const { inDegree, outDegree } = inOutDegree(DIGRAPH);
    expect(outDegree.a).toBe(2);  // a→b, a→c
    expect(inDegree.a).toBe(0);
    expect(inDegree.c).toBe(2);   // b→c, a→c
    expect(outDegree.c).toBe(0);
    expect(outDegree.d).toBe(1);
    expect(inDegree.d).toBe(1);   // e→d
  });
});

describe('hits', () => {
  it('ranks pure-hubs high on hubs and pure-authorities high on authorities', () => {
    const { hubs, authorities } = hits(HITS_G);
    expect(hubs.h1).toBeGreaterThan(hubs.p1);
    expect(hubs.h1).toBeCloseTo(hubs.h2, 6);          // symmetric
    expect(authorities.p1).toBeGreaterThan(authorities.h1);
    expect(authorities.p1).toBeCloseTo(authorities.p2, 6);
  });
  it('returns empty objects for an empty graph', () => {
    const { hubs, authorities } = hits({ nodes: [], edges: [] });
    expect(hubs).toEqual({});
    expect(authorities).toEqual({});
  });
});

describe('stronglyConnectedComponents', () => {
  it('groups a directed cycle into one SCC; non-cyclic nodes are singletons', () => {
    const scc = stronglyConnectedComponents(DIGRAPH);
    expect(scc.get('d')).toBe(scc.get('e'));          // d↔e same SCC
    expect(scc.get('a')).not.toBe(scc.get('b'));      // path → distinct SCCs
    expect(scc.get('b')).not.toBe(scc.get('c'));
    const distinct = new Set([...scc.values()]);
    expect(distinct.size).toBe(5);                    // {a},{b},{c},{d,e},{f}
  });
});

describe('directedBetweenness', () => {
  it('credits the middle of a directed path but not a source/sink', () => {
    const path = { nodes: ['a','b','c'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }] };
    const bt = directedBetweenness(path);
    expect(bt.b).toBeGreaterThan(0);                  // a→c passes through b
    expect(bt.a).toBe(0);
    expect(bt.c).toBe(0);
  });
  it('differs from undirected betweenness on a directed graph', () => {
    const dbt = directedBetweenness(DIGRAPH);
    expect(Number.isFinite(dbt.b)).toBe(true);        // no NaN
  });
});
```

- [ ] **Step 2: Run tests, verify they fail** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-core` → FAIL (functions not exported).

- [ ] **Step 3: Implement the functions** in `upstream/docker-server-graph-theory-core.mjs`. Place them after `undirectedAdj`/`samplePivots` (they belong with the adjacency helpers + centralities). Use the existing `nodeIds`/`cleanEdges`/`brandesAccumulate`. Key points: HITS normalizes each vector to unit L2 each iteration; SCC is iterative Tarjan with an explicit work stack + an SCC stack + `onStack` set + `index`/`low` maps (mirror the iterative DFS frame style of `articulationPointsAndBridges`); `directedBetweenness` calls `brandesAccumulate(out, ids, s, cb)` for every source then `normalizeDirectedBetweenness`.

- [ ] **Step 4: Run tests, verify pass** — same command → PASS.

- [ ] **Step 5: Commit** (controller does git; implementer reports DONE with the function list + line ranges).

---

### Task 2: Multi-level community (full Louvain)

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs`
- Test: `tests/unit/graph-theory-core.test.mjs`

New exported function `louvainMultiLevel(graph, {seed=1, resolution=1})` → `{ levels: [{communities:{id→c}, modularity, communityCount}] }`, finest level first. Algorithm: run local-moving (factor the existing `louvain` body into an internal `localMoving(adjW, kW, m2W, {seed,resolution})` that works on a **weighted** adjacency `Map<node, Map<nbr,w>>`; the current `louvain` becomes a thin caller for byte-identical level-0 output). Then aggregate: communities → super-nodes, summed edge weights (intra-community edges become super-node self-loops, included in the weighted degree). Recurse until a level merges nothing (community count stops shrinking). Map each level's super-communities back to original ids. Compute each level's modularity via `modularityOf` on the original graph using that level's partition.

- [ ] **Step 1: Write failing test**

Fixture (two clear pairs that should merge at a coarser level):

```js
// Two tight triangles A={a1,a2,a3}, B={b1,b2,b3}, joined by ONE bridge a1–b1.
// Level 0: 2 communities (A, B). With this small graph the hierarchy has ≥1 level;
// assert structure + monotonic non-increasing community count + flat==level0.
const TWO_TRIANGLES = { nodes: ['a1','a2','a3','b1','b2','b3'].map((id) => ({ id })),
  edges: [
    { source: 'a1', target: 'a2' }, { source: 'a2', target: 'a3' }, { source: 'a3', target: 'a1' },
    { source: 'b1', target: 'b2' }, { source: 'b2', target: 'b3' }, { source: 'b3', target: 'b1' },
    { source: 'a1', target: 'b1' },
  ] };
```

```js
import { louvainMultiLevel, louvain } from '../../upstream/docker-server-graph-theory-core.mjs';

describe('louvainMultiLevel', () => {
  it('returns ≥1 level, finest first, with non-increasing community counts', () => {
    const { levels } = louvainMultiLevel(TWO_TRIANGLES, { seed: 1 });
    expect(levels.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].communityCount).toBeLessThanOrEqual(levels[i - 1].communityCount);
    }
  });
  it('level 0 matches single-level louvain partition shape', () => {
    const { levels } = louvainMultiLevel(TWO_TRIANGLES, { seed: 1 });
    const single = louvain(TWO_TRIANGLES, { seed: 1 }).communities;
    // same grouping (community ids may differ; compare co-membership)
    const same = (m, x, y) => m[x] === m[y];
    expect(same(levels[0].communities, 'a1', 'a2')).toBe(same(single, 'a1', 'a2'));
    expect(same(levels[0].communities, 'a1', 'b1')).toBe(same(single, 'a1', 'b1'));
  });
  it('separates the two triangles at the finest level', () => {
    const { levels } = louvainMultiLevel(TWO_TRIANGLES, { seed: 1 });
    const c = levels[0].communities;
    expect(c.a1).toBe(c.a2); expect(c.a2).toBe(c.a3);
    expect(c.b1).toBe(c.b2); expect(c.b2).toBe(c.b3);
    expect(c.a1).not.toBe(c.b1);
  });
  it('handles the edgeless graph (single level, each node its own community)', () => {
    const { levels } = louvainMultiLevel({ nodes: [{ id: 'x' }, { id: 'y' }], edges: [] });
    expect(levels.length).toBe(1);
    expect(levels[0].communityCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Refactor `louvain` to delegate to `localMoving` on a weighted adjacency built from `cleanEdges` (weight 1 each); keep `louvain`'s return `{communities, modularity}` byte-identical (verify the existing core tests still pass). Implement aggregation + recursion + back-mapping. Guard: edgeless graph → one level, each node its own community.
- [ ] **Step 4: Run, verify pass** — and run the FULL `graph-theory-core` file to confirm the `louvain` refactor didn't regress existing tests.
- [ ] **Step 5: Commit** (controller).

---

### Task 3: Spectral embeddings

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs`
- Test: `tests/unit/graph-theory-core.test.mjs`

New exported `spectralEmbedding(graph, {dims=8, seed=1, maxIter=300, tol=1e-9})` → `{id→number[]}` (length = effective dims). Laplacian eigenmaps: build symmetric normalized adjacency Â = D^{-1/2} A D^{-1/2} over `undirectedAdj` (isolated node → zero row/col, embedding all-zeros). Find top `k+1` eigenvectors of Â by power iteration with **Gram–Schmidt deflation** (each new vector re-orthogonalized against all already-accepted eigenvectors every iteration; seed deterministically via `mulberry32(seed)` so results are reproducible). **Discard eigenvector #1** (the trivial ≈D^{1/2}·1). Keep the next `k`. `dims` clamped to `[2, min(32, N-1)]` (engine-side; `N<3` → return all-zero vectors of length `max(0,N-1)` clamped ≥0 — degenerate but defined). Each node → `[component over eigenvectors 2..k+1]`.

- [ ] **Step 1: Write failing test**

```js
import { spectralEmbedding } from '../../upstream/docker-server-graph-theory-core.mjs';

describe('spectralEmbedding', () => {
  it('separates two cliques along the first non-trivial dimension', () => {
    const emb = spectralEmbedding(BARBELL, { dims: 2, seed: 1 });   // BARBELL = two triangles + 1 bridge (existing fixture)
    const sign = (v) => Math.sign(v[0]);
    // the x-clique and y-clique should land on opposite sides of dim-0
    expect(sign(emb.x1)).toBe(sign(emb.x2));
    expect(sign(emb.y1)).toBe(sign(emb.y2));
    expect(sign(emb.x1)).not.toBe(sign(emb.y1));
  });
  it('produces vectors of the clamped dimensionality', () => {
    const emb = spectralEmbedding(BARBELL, { dims: 3, seed: 1 });
    expect(emb.x1.length).toBe(3);
  });
  it('clamps dims to N-1 on tiny graphs and never throws', () => {
    const emb = spectralEmbedding({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }] }, { dims: 8 });
    expect(emb.a.length).toBe(1);   // clamp to N-1 = 1
    expect(Number.isFinite(emb.a[0])).toBe(true);
  });
  it('is deterministic for a fixed seed', () => {
    const a = spectralEmbedding(BARBELL, { dims: 2, seed: 7 });
    const b = spectralEmbedding(BARBELL, { dims: 2, seed: 7 });
    expect(a.x1).toEqual(b.x1);
  });
});
```

Note: eigenvector signs are arbitrary; tests assert sign **agreement within a clique** and **disagreement across cliques**, never an absolute sign. If a clamp test wants exactly `N-1`, clamp lower bound may yield `< 2` on tiny graphs — that's acceptable (the `[2, …]` lower bound applies only when `N-1 ≥ 2`).

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the power-iteration + Gram–Schmidt deflation. Reuse the `eigenvector` normalization style. Â row for node v: entry to neighbour w = 1/√(deg(v)·deg(w)). Deflation: after each matvec, subtract projections onto all accepted eigenvectors, then L2-normalize.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** (controller).

---

### Task 4: Wire into computeMetrics / routes / cache / MCP + additivity

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs` (`computeMetrics`, `computeMetricsCapped`)
- Modify: `upstream/docker-server-graph-theory.mjs` (`parseMetricsParams`, `metricsCacheKey`)
- Modify: `mcp-server/server.mjs` (both graph-metrics tool schemas + handlers)
- Test: `tests/unit/graph-theory-core.test.mjs`, `tests/unit/graph-theory-handler.test.mjs`, `tests/unit/graph-theory-cache.test.mjs`, `mcp-server/server.test.mjs`

Engine integration in `computeMetrics(graph, {community, resolution, seed, skipSuperLinear, approx, directed=false, hierarchy=false, embed=null, dims=8})`:
- When `directed`: compute `inOutDegree`, `hits`, `stronglyConnectedComponents`; replace the `betweenness` value with `directedBetweenness` (skip if `skipSuperLinear`, same as undirected betweenness). Add per-node `inDegree`,`outDegree`,`hubs`,`authorities`,`sccId`. `summary.directed=true`, `summary.stronglyConnectedComponentCount = #distinct sccId`.
- When `hierarchy`: compute `louvainMultiLevel`; add per-node `communityPath = [level0c, level1c, …]`; add top-level `hierarchy = { levelCount, levels: levels.map(l => ({modularity:l.modularity, communityCount:l.communityCount})), method:'louvain' }`. The flat `community` field stays = louvain/leiden/labelprop as today (unaffected).
- When `embed==='spectral'` AND NOT `skipSuperLinear`: compute `spectralEmbedding(graph,{dims,seed})`; add per-node `embedding`; `summary.embedding = {method:'spectral', dims: <effective>}`. When skipped due to cap, add `'embedding'` to `omittedMetrics`.
- `summary.directed` defaults `false`; absent params → response byte-identical to before (additivity test below guards this).

`computeMetricsCapped` passes `directed/hierarchy/embed/dims` through (already spreads `...opts`); ensure `embed` is gated off when `skip` is true and `'embedding'` is appended to `omittedMetrics`.

`parseMetricsParams` additions:
```js
const directed = ['1', 'true'].includes((searchParams.get('directed') || '').toLowerCase());
const hierarchy = ['1', 'true'].includes((searchParams.get('hierarchy') || '').toLowerCase());
const embedRaw = searchParams.get('embed');
if (embedRaw != null && embedRaw !== '' && embedRaw !== 'spectral') throw new Error(`unknown embed "${embedRaw}" (use spectral)`);
const embed = embedRaw === 'spectral' ? 'spectral' : null;
const dims = parsePosInt(searchParams, 'dims', { def: 8, clampMax: 64 });
return { community, resolution, cap, approx, directed, hierarchy, embed, dims };
```

`metricsCacheKey` append: `|${params.directed?1:0}|${params.hierarchy?1:0}|${params.embed ?? ''}|${params.dims}`.

MCP: add `directed` (boolean), `hierarchy` (boolean), `embed` (string enum `['spectral']`), `dims` (number) to BOTH tool input schemas + pass through in both handlers (`if (directed) params.directed = 1; if (hierarchy) params.hierarchy = 1; if (embed) params.embed = embed; if (dims !== undefined) params.dims = dims;`). Update the tool descriptions to mention the new optional capabilities.

- [ ] **Step 1: Write failing tests**

Engine additivity + integration (`graph-theory-core.test.mjs`):
```js
describe('computeMetrics — P2.3 additivity + opts', () => {
  it('is byte-identical to baseline when no new opts are set', () => {
    const base = computeMetrics(BARBELL, {});
    expect(base.nodes[0].inDegree).toBeUndefined();
    expect(base.hierarchy).toBeUndefined();
    expect(base.nodes[0].embedding).toBeUndefined();
    expect(base.summary.directed).toBe(false);
  });
  it('directed mode adds in/out degree, hits, sccId and a directed-aware summary', () => {
    const r = computeMetrics(DIGRAPH, { directed: true });
    expect(r.nodes.find((n) => n.id === 'a').outDegree).toBe(2);
    expect(typeof r.nodes[0].hubs).toBe('number');
    expect(typeof r.nodes[0].authorities).toBe('number');
    expect(typeof r.nodes[0].sccId).toBe('number');
    expect(r.summary.directed).toBe(true);
    expect(r.summary.stronglyConnectedComponentCount).toBe(5);
  });
  it('hierarchy mode adds communityPath + hierarchy summary', () => {
    const r = computeMetrics(TWO_TRIANGLES, { hierarchy: true });
    expect(Array.isArray(r.nodes[0].communityPath)).toBe(true);
    expect(r.hierarchy.levelCount).toBeGreaterThanOrEqual(1);
    expect(r.hierarchy.method).toBe('louvain');
  });
  it('embed mode adds spectral embeddings + summary', () => {
    const r = computeMetrics(BARBELL, { embed: 'spectral', dims: 2 });
    expect(r.nodes[0].embedding.length).toBe(2);
    expect(r.summary.embedding).toEqual({ method: 'spectral', dims: 2 });
  });
  it('capped graph omits embeddings', () => {
    const r = computeMetricsCapped(BARBELL, { embed: 'spectral', cap: 1 });
    expect(r.summary.capped).toBe(true);
    expect(r.summary.omittedMetrics).toContain('embedding');
    expect(r.nodes[0].embedding).toBeUndefined();
  });
});
```

Handler param tests (`graph-theory-handler.test.mjs` — co-locate with the existing `parseMetricsParams` tests; import it if not already):
```js
import { parseMetricsParams } from '../../upstream/docker-server-graph-theory.mjs';
describe('parseMetricsParams — P2.3 params', () => {
  const P = (q) => parseMetricsParams(new URL('http://x/g?' + q).searchParams);
  it('defaults the new params off', () => {
    const p = P('');
    expect(p.directed).toBe(false); expect(p.hierarchy).toBe(false);
    expect(p.embed).toBe(null); expect(p.dims).toBe(8);
  });
  it('parses directed/hierarchy/embed/dims', () => {
    const p = P('directed=1&hierarchy=true&embed=spectral&dims=4');
    expect(p.directed).toBe(true); expect(p.hierarchy).toBe(true);
    expect(p.embed).toBe('spectral'); expect(p.dims).toBe(4);
  });
  it('rejects an unknown embed method', () => {
    expect(() => P('embed=node2vec')).toThrow(/embed/);
  });
  it('rejects a non-positive dims', () => {
    expect(() => P('dims=0')).toThrow(/dims/);
  });
});
```

Cache-key test (`graph-theory-cache.test.mjs`) — if `metricsCacheKey` is exported, assert distinct keys; if not exported, add a behavioral test via the handler that a `?directed=1` request is not served a cached non-directed payload. Prefer exporting `metricsCacheKey` (it's pure) and:
```js
import { metricsCacheKey } from '../../upstream/docker-server-graph-theory.mjs';
it('cache key varies with directed/hierarchy/embed/dims', () => {
  const base = { community: 'louvain', resolution: 1, cap: 2000, approx: null, directed: false, hierarchy: false, embed: null, dims: 8 };
  const k = (o) => metricsCacheKey('sidecar', 'g', '', { ...base, ...o });
  expect(k({})).not.toBe(k({ directed: true }));
  expect(k({})).not.toBe(k({ hierarchy: true }));
  expect(k({})).not.toBe(k({ embed: 'spectral' }));
  expect(k({ dims: 8 })).not.toBe(k({ dims: 4 }));
});
```
(If `metricsCacheKey` isn't currently exported, add `export` to it.)

MCP passthrough (`mcp-server/server.test.mjs`) — match the existing source-text test style in that file (assert the tool schema lists the new props and the handler forwards them). Follow whatever assertion pattern the file already uses (it is source-text / handler-level, not a live server).

- [ ] **Step 2: Run all four test files, verify the new cases fail** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory` and `node --test mcp-server/server.test.mjs`.
- [ ] **Step 3: Implement** the engine gating, `parseMetricsParams`, `metricsCacheKey` export+extension, and MCP schema+handler changes per the spec above.
- [ ] **Step 4: Run all four test files, verify pass.** Also run the FULL unit suite for the graph-theory family to confirm no regression: `npx vitest run --config vitest.config.unit.mjs graph-theory metrics-view graph-lens`.
- [ ] **Step 5: Commit** (controller).

---

## Self-review checklist (controller, before final review)

- Spec coverage: directed (§3.1) → Task 1+4; hierarchy (§3.2) → Task 2+4; spectral (§3.3) → Task 3+4; API/cache/MCP/additivity (§3.4) → Task 4. ✓
- Type consistency: `inDegree/outDegree/hubs/authorities/sccId/communityPath/embedding` node fields and `hierarchy/summary.{directed,stronglyConnectedComponentCount,embedding}` envelope fields are named identically across Tasks 1–4. ✓
- No placeholders: all test code is concrete; algorithms specified (iterative Tarjan, HITS iteration, Louvain aggregation, power-iteration+Gram–Schmidt). ✓
- Backward compat: additivity test (Task 4 step 1) pins "params off → no new fields, `summary.directed===false`". ✓

## Post-build (controller)

1. Regenerate patches (`git -C upstream add -N .`; the three diffs; `git -C upstream reset -q`) + `node scripts/check-patch-drift.mjs` → exit 0.
2. Final whole-diff code review (subagent).
3. Verify: run the full graph-theory unit family green; the web image build is NOT needed (no required frontend change). Report any frontend deferral explicitly.
4. Commit + push `deployment`; update ROADMAP.md, INVENTORY.md, the spec `Status`, and the memory.
