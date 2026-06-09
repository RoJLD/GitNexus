# Graph Platform P2.2 — betweenness + eigenvector + metric selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add betweenness + eigenvector centrality to the graph-theory engine and a size-metric selector to the overlay, completing the centrality trio.

**Architecture:** Extend the pure-JS `computeMetrics` (P2.1) with two new functions; the endpoint + MCP surface the new fields unchanged; the overlay gains a selector choosing which centrality drives node size (color stays community).

**Tech Stack:** Pure Node `.mjs` (zero-dep), React/TS overlay (`upstream/gitnexus-web/`), vitest (native on host Node 24 for pure modules / `bash tests/docker-test.sh unit`).

---

## ⚠️ Execution protocol — READ FIRST

- **`upstream/` is GITIGNORED** → implementer edits + tests, does NOT touch git/patches; the **controller** regenerates the 3 diffs + drift-check + commits. Tracked zones (`tests/`, `mcp-server/`, `docs/`, `ROADMAP.md`, `INVENTORY.md`) commit normally.
- Patch regen (controller): `git -C upstream add -N .` → `git -C upstream diff HEAD --diff-filter=A|M > patches/{additive-files,inplace-edits}.diff` + `git -C upstream diff HEAD > patches/upstream-all.diff` → `git -C upstream reset -q` → `node scripts/check-patch-drift.mjs` (exit 0).
- Identity `roblastar@live.fr`; trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- No new files imported at boot here (we only EDIT `docker-server-graph-theory-core.mjs`, already COPY'd), so no Dockerfile change needed.

## File Structure

| File | Zone | Responsibility |
|---|---|---|
| `upstream/docker-server-graph-theory-core.mjs` *(edit)* | upstream | + `betweenness` (Brandes) + `eigenvector` (power iter); `computeMetrics` gains 2 fields |
| `tests/unit/graph-theory-core.test.mjs` *(edit)* | tracked | betweenness (path/star/barbell) + eigenvector + computeMetrics fields |
| `upstream/gitnexus-web/src/services/graph-theory-client.ts` *(edit)* | upstream | `GraphMetricNode` + `betweenness`, `eigenvector` |
| `tests/unit/graph-theory-client.test.mjs` *(edit)* | tracked | returned nodes carry the new fields |
| `upstream/gitnexus-web/src/lib/research-graph-adapter.ts` *(edit)* | upstream | `sizeBy` arg selects which metric drives size |
| `upstream/gitnexus-web/src/components/GraphCanvas.tsx` *(edit)* | upstream | `sizeMetric` state + selector UI + pass `sizeBy` + cacheKey/deps |
| `mcp-server/server.mjs` *(edit)* | tracked | one-line description update |
| `ROADMAP.md`, `INVENTORY.md` *(edit)* | tracked | mark P2.2 shipped |

---

## Task 1: Engine — betweenness (Brandes) + eigenvector (power iteration)

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs`
- Test: `tests/unit/graph-theory-core.test.mjs`

⚠️ Implementer: edit + run tests natively (`cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-core`); do NOT git/commit/patch.

- [ ] **Step 1: Add failing tests** — append to `tests/unit/graph-theory-core.test.mjs` (the file already imports from the core module; add `betweenness, eigenvector` to that import):
```js
// add to the existing import line:
// import { degreeCentrality, pageRank, louvain, computeMetrics, betweenness, eigenvector } from '../../upstream/docker-server-graph-theory-core.mjs';

const PATH3 = { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [{ source: 'A', target: 'B' }, { source: 'B', target: 'C' }] };
const CYCLE4 = { nodes: ['p','q','r','s'].map((id) => ({ id })), edges: [
  { source: 'p', target: 'q' }, { source: 'q', target: 'r' }, { source: 'r', target: 's' }, { source: 's', target: 'p' } ] };

describe('betweenness', () => {
  it('the middle of a path has the highest betweenness', () => {
    const b = betweenness(PATH3);
    expect(b.B).toBeGreaterThan(b.A);
    expect(b.A).toBeCloseTo(b.C, 9);   // symmetric ends
    expect(b.A).toBeCloseTo(0, 9);     // ends are never intermediaries
  });
  it('the hub of a star has the highest betweenness', () => {
    const b = betweenness(STAR);       // STAR defined earlier in the file (h→a,b,c)
    expect(b.h).toBeGreaterThan(b.a);
  });
  it('the two bridge nodes of the barbell rank highest', () => {
    const b = betweenness(BARBELL);    // BARBELL defined earlier (cliques x*/y* joined x1-y1)
    expect(b.x1).toBeGreaterThan(b.x2);
    expect(b.y1).toBeGreaterThan(b.y2);
  });
  it('is 0 everywhere on an edgeless graph', () => {
    const b = betweenness({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(b.a).toBe(0); expect(b.b).toBe(0);
  });
});

describe('eigenvector', () => {
  it('is symmetric on a 4-cycle', () => {
    const e = eigenvector(CYCLE4);
    expect(e.p).toBeCloseTo(e.q, 6);
    expect(e.q).toBeCloseTo(e.r, 6);
  });
  it('ranks the hub of a star above a leaf', () => {
    const e = eigenvector(STAR);
    expect(e.h).toBeGreaterThan(e.a);
  });
  it('degrades safely on an edgeless graph (finite, non-negative)', () => {
    const e = eigenvector({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(Number.isFinite(e.a)).toBe(true);
    expect(e.a).toBeGreaterThanOrEqual(0);
  });
});

describe('computeMetrics adds betweenness + eigenvector', () => {
  it('exposes the new per-node fields', () => {
    const r = computeMetrics(BARBELL);
    expect(r.nodes[0]).toHaveProperty('betweenness');
    expect(r.nodes[0]).toHaveProperty('eigenvector');
    expect(r.nodes.every((n) => Number.isFinite(n.betweenness) && Number.isFinite(n.eigenvector))).toBe(true);
  });
});
```
(STAR + BARBELL already exist in the file from P2.1 — reuse them; don't redefine.)

- [ ] **Step 2: Run, watch the new tests fail** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-core` → FAIL (`betweenness`/`eigenvector` not exported).

- [ ] **Step 3: Implement** — in `upstream/docker-server-graph-theory-core.mjs`, add an undirected-adjacency helper (or reuse the Louvain one's shape) and the two functions. Insert before `computeMetrics`:
```js
/** Undirected neighbor lists over the cleaned edge set. */
function undirectedAdj(graph) {
  const ids = nodeIds(graph);
  const idSet = new Set(ids);
  const adj = new Map(ids.map((id) => [id, []]));
  for (const [s, t] of cleanEdges(graph, idSet)) { adj.get(s).push(t); adj.get(t).push(s); }
  return { ids, adj };
}

/** Betweenness centrality (Brandes, undirected, unweighted), normalized to [0,1]. */
export function betweenness(graph) {
  const { ids, adj } = undirectedAdj(graph);
  const N = ids.length;
  const cb = {};
  for (const id of ids) cb[id] = 0;
  for (const s of ids) {
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
      for (const v of pred.get(w)) {
        delta.set(v, delta.get(v) + (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w)));
      }
      if (w !== s) cb[w] += delta.get(w);
    }
  }
  // undirected: each shortest path counted from both endpoints
  for (const id of ids) cb[id] /= 2;
  // normalize by the number of possible pairs of OTHER nodes: (N-1)(N-2)/2
  const norm = N > 2 ? ((N - 1) * (N - 2)) / 2 : 0;
  if (norm > 0) for (const id of ids) cb[id] /= norm;
  return cb;
}

/** Eigenvector centrality via power iteration on the undirected adjacency matrix; L2-normalized. */
export function eigenvector(graph, { maxIter = 200, tol = 1e-9 } = {}) {
  const { ids, adj } = undirectedAdj(graph);
  const N = ids.length;
  const ev = {};
  if (N === 0) return ev;
  let x = new Map(ids.map((id) => [id, 1 / Math.sqrt(N)]));
  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Map(ids.map((id) => [id, 0]));
    for (const id of ids) { for (const w of adj.get(id)) next.set(w, next.get(w) + x.get(id)); }
    let norm = 0;
    for (const id of ids) norm += next.get(id) * next.get(id);
    norm = Math.sqrt(norm);
    if (norm === 0) { for (const id of ids) ev[id] = 1 / N; return ev; } // edgeless → uniform, safe
    let diff = 0;
    for (const id of ids) { const v = next.get(id) / norm; diff += Math.abs(v - x.get(id)); next.set(id, v); }
    x = next;
    if (diff < tol) break;
  }
  for (const id of ids) ev[id] = x.get(id);
  return ev;
}
```
Then extend `computeMetrics` — compute `const bt = betweenness(graph); const ev = eigenvector(graph);` and add to each node object: `betweenness: bt[id] ?? 0, eigenvector: ev[id] ?? 0`. The final node shape becomes `{ id, degree, pagerank, betweenness, eigenvector, community }`. `summary` unchanged.

- [ ] **Step 4: Run, verify pass** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-core` → ALL pass. The tests are the spec; if betweenness/eigenvector ranks are off, debug to pass (do NOT weaken the tests).

- [ ] **Step 5 (CONTROLLER): serialize + commit.** Regen diffs (core edit → additive), drift 0, then `git add patches/ tests/unit/graph-theory-core.test.mjs && git commit -m "feat(graph-theory): betweenness (Brandes) + eigenvector centrality (P2.2)"`.

---

## Task 2: Overlay metric selector (size by chosen centrality)

**Files:**
- Modify: `upstream/gitnexus-web/src/services/graph-theory-client.ts`
- Modify: `tests/unit/graph-theory-client.test.mjs`
- Modify: `upstream/gitnexus-web/src/lib/research-graph-adapter.ts`
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx`

⚠️ Implementer: edit + run the client test; do NOT git/commit/patch.

- [ ] **Step 1: Extend the client interface + a failing test.** In `tests/unit/graph-theory-client.test.mjs`, update the fake payload's node to include `betweenness: 0.2, eigenvector: 0.4` and add an assertion `expect(r.nodes[0]).toHaveProperty('betweenness'); expect(r.nodes[0]).toHaveProperty('eigenvector');`. Run → FAIL only if the interface is wrong (it's a structural test; mainly ensures the fields are typed/returned). Then in `upstream/gitnexus-web/src/services/graph-theory-client.ts`, add `betweenness: number; eigenvector: number;` to the `GraphMetricNode` interface. Run → PASS (`bash tests/docker-test.sh unit graph-theory-client`).

- [ ] **Step 2: Adapter — `sizeBy` selects the size metric.** In `upstream/gitnexus-web/src/lib/research-graph-adapter.ts`, the metrics param currently carries `{pagerank, community}` and sizes by pagerank. Generalize: the metrics map now carries `{ degree, pagerank, betweenness, eigenvector, community }` and the function takes a `sizeBy: 'degree'|'pagerank'|'betweenness'|'eigenvector'` (default `'pagerank'`). Read the file; change the metrics branch so:
```ts
// signature (adjust to the existing one):
// export function researchGraphToGraphology(rg, metricsById?: Map<string, { degree:number; pagerank:number; betweenness:number; eigenvector:number; community:number }>, sizeBy: 'degree'|'pagerank'|'betweenness'|'eigenvector' = 'pagerank')
// before the node loop, when metricsById is set:
//   const maxV = Math.max(...[...metricsById.values()].map((v) => v[sizeBy]), 1e-9);
// per node with metrics m:
//   color = COMMUNITY_PALETTE[m.community % COMMUNITY_PALETTE.length]
//   size  = 4 + 16 * Math.sqrt((m[sizeBy] ?? 0) / maxV)
```
The no-metrics path stays byte-identical. (COMMUNITY_PALETTE already exists from P2.1.)

- [ ] **Step 3: GraphCanvas — selector + wiring.** In `upstream/gitnexus-web/src/components/GraphCanvas.tsx`:
  - state: `const [sizeMetric, setSizeMetric] = useState<'degree'|'pagerank'|'betweenness'|'eigenvector'>('pagerank');`
  - the metrics fetch effect already builds `metricsById`; change it to carry ALL metrics per node: `new Map(m.nodes.map((n) => [n.id, { degree: n.degree, pagerank: n.pagerank, betweenness: n.betweenness, eigenvector: n.eigenvector, community: n.community }]))`.
  - the render effect: pass `sizeMetric` as the 3rd arg to `researchGraphToGraphology(researchData, metricsOn ? (metricsById ?? undefined) : undefined, sizeMetric)`; append `:${sizeMetric}` to the cacheKey when `metricsOn`; add `sizeMetric` to the effect deps.
  - UI: when `metricsOn && researchName`, render a small `<select value={sizeMetric} onChange={(e) => setSizeMetric(e.target.value as ...)}>` with the 4 options (Degree/PageRank/Betweenness/Eigenvector), placed next to the Metrics toggle (match the existing control styling).
  (Read the current effects + toggle first; match names exactly.)

- [ ] **Step 4: Verify** — `bash tests/docker-test.sh unit graph-theory-client` → PASS. The TSX is type-checked by the controller's web build in Final; ensure edits are syntactically valid + match existing patterns.

- [ ] **Step 5 (CONTROLLER): serialize + commit.** Regen diffs (client/adapter/GraphCanvas → mix additive/inplace), drift 0, then `git add patches/ tests/unit/graph-theory-client.test.mjs && git commit -m "feat(web): metric selector overlay — size by degree/pagerank/betweenness/eigenvector"`.

---

## Task 3: MCP description + docs

**Files:**
- Modify: `mcp-server/server.mjs` (tracked)
- Modify: `ROADMAP.md`, `INVENTORY.md` (tracked)

(All tracked — implementer commits; or controller. Single small commit.)

- [ ] **Step 1: MCP description** — in `mcp-server/server.mjs`, update the `gitnexus_graph_metrics` tool's `description` to mention the full set: "degree + PageRank + betweenness + eigenvector centrality + Louvain communities". No handler change (it already returns the full payload). If `mcp-server/server.test.mjs` asserts the description text, update that assertion too; run the mcp test suite (`cd mcp-server && node --test server.test.mjs`).

- [ ] **Step 2: ROADMAP** — flip the **P2.2** row état `📋 Spec écrite` → `✅ **Livré 2026-06-03**`.

- [ ] **Step 3: INVENTORY** — in the graph-templates/`/graph/metrics` entry, update the metric list to "degree + PageRank + **betweenness + eigenvector** + Louvain" and note the overlay metric selector.

- [ ] **Step 4: Commit (tracked):** `git add mcp-server/server.mjs ROADMAP.md INVENTORY.md && git commit -m "docs+mcp: P2.2 betweenness/eigenvector shipped (roadmap + inventory + tool desc)"`.

---

## Final: verification

- [ ] **Step 1:** `node scripts/check-patch-drift.mjs` exit 0.
- [ ] **Step 2:** full unit tier — `bash tests/docker-test.sh unit` → all pass (graph-theory-core extended + client + all prior). (If Docker/Rancher panics — a known transient — retry once; the pure modules also run natively: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`.)
- [ ] **Step 3: stack e2e** — build + boot the test stack (non-colliding ports 4847/4273, projects = a temp extraction of `tests/fixtures/sample-repo.tar.gz`), scaffold+import `research-graph` from `research-graph-corpus`, then `GET /graph/metrics/<name>` and confirm each node now carries `betweenness` + `eigenvector` (finite). Teardown `down -v`.
- [ ] **Step 4:** push is the user's call; summarize P2.2 shipped + P2.3 backlog recorded.

---

## Self-Review

**Spec coverage:** §3.1 engine (betweenness/eigenvector/computeMetrics) → Task 1. §3.2 endpoint/MCP unchanged (fields flow through; MCP desc) → Task 3 Step 1 (+ the endpoint genuinely needs no edit). §3.3 overlay selector → Task 2. §4 testing → Task 1/2 tests + Final. §5 scope (only these 2 algos + selector, sidecar, size-only) → respected. §6 P2.3 deferred → untouched. §7 open Qs (undirected, eigenvector-not-Katz, default pagerank) → reflected in Task 1/2 code.

**Placeholder scan:** Task 1 has complete Brandes + eigenvector code. Task 2/3 give the exact edits with code fragments (adapter signature, the GraphCanvas state/effect/selector) + read-first guidance for matching existing names — no logic placeholders.

**Type consistency:** `betweenness`/`eigenvector` (Task 1) → `GraphMetricNode.betweenness/eigenvector` (Task 2) → the adapter `sizeBy` union + `metricsById` value shape (Task 2) → `sizeMetric` state union (Task 2) — all four metric keys (`degree|pagerank|betweenness|eigenvector`) spelled identically across engine, client interface, adapter param, and selector. `computeMetrics` node shape `{id,degree,pagerank,betweenness,eigenvector,community}` consistent across Task 1, the client interface, and the Final e2e assertion.
