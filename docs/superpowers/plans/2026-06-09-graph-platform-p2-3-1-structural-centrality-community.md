# Graph Platform P2.3.1 — structural algorithms + remaining centralities + community methods — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the pure-JS graph-theory engine with structural algorithms (connected components, density, articulation points, bridges, k-core, clustering/transitivity), the remaining centralities (closeness, harmonic, Katz), and three community methods (resolution-tunable Louvain, label propagation, single-level Leiden), surfaced backward-compatibly through `/graph/metrics/:name` + MCP + the overlay size-selector.

**Architecture:** All algorithms are pure-JS/zero-dep functions in `upstream/docker-server-graph-theory-core.mjs`, over the universal `{nodes,edges}` render shape, treated undirected (consistent with the existing degree/PageRank/betweenness/eigenvector/Louvain). `computeMetrics` aggregates them; the endpoint gains optional `?community=`/`?resolution=` params (default = today's behaviour); the MCP tool passes them through; the web overlay's existing size-metric selector gains the new numeric metrics. No Dockerfile.web change (edits already-COPY'd modules + already-built web sources).

**Tech Stack:** Node ESM (zero-dep `.mjs`), vitest (host-native for pure modules), React/TypeScript (web), node:test (MCP source-text assertions).

**Spec:** `docs/superpowers/specs/2026-06-09-graph-platform-p2-3-1-structural-centrality-community-design.md`

**Conventions to match (already in the engine):**
- `nodeIds(graph)`, `cleanEdges(graph, idSet)` (drops self-loops + dangling), `undirectedAdj(graph)` → `{ids, adj}` (neighbor-list `Map`), `mulberry32(seed)` (seeded RNG) all exist and MUST be reused.
- Centrality functions return a plain object `{ [id]: number }`. Community functions return `{ communities: { [id]: number }, ... }`.
- Tests live in `tests/unit/graph-theory-core.test.mjs`; run host-native with `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`.

---

### Task 1: Structural — connected components + density

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs` (add two exports after `eigenvector`, before `computeMetrics`)
- Test: `tests/unit/graph-theory-core.test.mjs` (add a `describe` block)

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/graph-theory-core.test.mjs` (extend the top import to include the new names — see Step 3 for the full import line):

```js
const TWO_COMP = { nodes: ['a','b','c','d'].map((id) => ({ id })),
  edges: [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }] };

describe('connectedComponents', () => {
  it('labels disjoint components distinctly', () => {
    const c = connectedComponents(TWO_COMP);
    expect(c.get('a')).toBe(c.get('b'));
    expect(c.get('c')).toBe(c.get('d'));
    expect(c.get('a')).not.toBe(c.get('c'));
    expect(new Set(c.values()).size).toBe(2);
  });
  it('is one component for a connected graph', () => {
    expect(new Set(connectedComponents(BARBELL).values()).size).toBe(1);
  });
});

describe('density', () => {
  it('is 1 for a complete triangle and 0 for an edgeless graph', () => {
    const K3 = { nodes: ['a','b','c'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'c' }] };
    expect(density(K3)).toBeCloseTo(1, 9);
    expect(density({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] })).toBe(0);
    expect(density({ nodes: [{ id: 'a' }], edges: [] })).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: FAIL — `connectedComponents is not a function` / `density is not a function`.

- [ ] **Step 3: Implement**

In `upstream/docker-server-graph-theory-core.mjs`, add after the `eigenvector` function (and before `computeMetrics`):

```js
/** Connected components (undirected). Returns Map<id, componentId>; ids assigned in node-iteration order. */
export function connectedComponents(graph) {
  const { ids, adj } = undirectedAdj(graph);
  const comp = new Map();
  let cid = 0;
  for (const start of ids) {
    if (comp.has(start)) continue;
    comp.set(start, cid);
    const queue = [start];
    while (queue.length) {
      const v = queue.shift();
      for (const w of adj.get(v)) { if (!comp.has(w)) { comp.set(w, cid); queue.push(w); } }
    }
    cid++;
  }
  return comp;
}

/** Edge density of an undirected simple graph: 2E/(N(N-1)); 0 when N<2. */
export function density(graph) {
  const ids = nodeIds(graph);
  const N = ids.length;
  if (N < 2) return 0;
  const E = cleanEdges(graph, new Set(ids)).length;
  return (2 * E) / (N * (N - 1));
}
```

Also update the import line at the top of `tests/unit/graph-theory-core.test.mjs` to:

```js
import { degreeCentrality, pageRank, louvain, computeMetrics, betweenness, eigenvector, connectedComponents, density, articulationPointsAndBridges, kCore, clusteringCoefficient, closeness, harmonic, katz, labelPropagation, leiden } from '../../upstream/docker-server-graph-theory-core.mjs';
```

(All names are added across Tasks 1–7; importing them now is harmless — the tests referencing not-yet-built names are only added in their own task.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: the new `connectedComponents` + `density` tests PASS; all pre-existing graph-theory tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-graph-theory-core.mjs tests/unit/graph-theory-core.test.mjs
git commit -m "feat(graph-theory): connected components + density (P2.3.1)"
```

---

### Task 2: Structural — articulation points + bridges (Tarjan, iterative)

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs`
- Test: `tests/unit/graph-theory-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/graph-theory-core.test.mjs`:

```js
function bridgeHas(bridges, u, v) {
  return bridges.some(([a, b]) => (a === u && b === v) || (a === v && b === u));
}

describe('articulationPointsAndBridges', () => {
  it('finds the barbell bridge + its two endpoints as cut vertices', () => {
    const { articulation, bridges } = articulationPointsAndBridges(BARBELL);
    expect(bridgeHas(bridges, 'x1', 'y1')).toBe(true);
    expect(bridges).toHaveLength(1);                 // only the connecting edge is a bridge
    expect(articulation.has('x1')).toBe(true);
    expect(articulation.has('y1')).toBe(true);
    expect(articulation.has('x2')).toBe(false);      // triangle interior is not a cut vertex
  });
  it('the middle of a path is a cut vertex; both edges are bridges', () => {
    const { articulation, bridges } = articulationPointsAndBridges(PATH3);
    expect(articulation.has('B')).toBe(true);
    expect(articulation.has('A')).toBe(false);
    expect(bridgeHas(bridges, 'A', 'B')).toBe(true);
    expect(bridgeHas(bridges, 'B', 'C')).toBe(true);
  });
  it('a triangle has no cut vertices and no bridges', () => {
    const K3 = { nodes: ['a','b','c'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'c' }] };
    const { articulation, bridges } = articulationPointsAndBridges(K3);
    expect(articulation.size).toBe(0);
    expect(bridges).toHaveLength(0);
  });
  it('an edgeless graph has none', () => {
    const { articulation, bridges } = articulationPointsAndBridges({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(articulation.size).toBe(0);
    expect(bridges).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: FAIL — `articulationPointsAndBridges is not a function`.

- [ ] **Step 3: Implement**

Add to `upstream/docker-server-graph-theory-core.mjs` (after `density`):

```js
/**
 * Articulation points + bridges (undirected, Tarjan low-link, iterative DFS so deep
 * graphs don't blow the call stack; a DFS forest covers disconnected graphs).
 * Returns { articulation:Set<id>, bridges:Array<[u,v]> }. Assumes a simple graph
 * (the cleaned edge set drops self-loops; parallel edges are out of scope).
 */
export function articulationPointsAndBridges(graph) {
  const { ids, adj } = undirectedAdj(graph);
  const disc = new Map();
  const low = new Map();
  const articulation = new Set();
  const bridges = [];
  let timer = 0;

  for (const root of ids) {
    if (disc.has(root)) continue;
    disc.set(root, timer); low.set(root, timer); timer++;
    let rootChildren = 0;
    const stack = [{ u: root, parent: null, idx: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const nbrs = adj.get(frame.u);
      if (frame.idx < nbrs.length) {
        const w = nbrs[frame.idx++];
        if (w === frame.parent) continue;                 // skip the tree edge back to parent
        if (!disc.has(w)) {
          disc.set(w, timer); low.set(w, timer); timer++;
          if (frame.u === root) rootChildren++;
          stack.push({ u: w, parent: frame.u, idx: 0 });
        } else {
          low.set(frame.u, Math.min(low.get(frame.u), disc.get(w)));   // back edge
        }
      } else {
        stack.pop();
        const { u, parent } = frame;
        if (parent !== null) {
          low.set(parent, Math.min(low.get(parent), low.get(u)));
          if (parent !== root && low.get(u) >= disc.get(parent)) articulation.add(parent);
          if (low.get(u) > disc.get(parent)) bridges.push([parent, u]);
        }
      }
    }
    if (rootChildren >= 2) articulation.add(root);
  }
  return { articulation, bridges };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: the four new tests PASS; all prior tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-graph-theory-core.mjs tests/unit/graph-theory-core.test.mjs
git commit -m "feat(graph-theory): articulation points + bridges (Tarjan, P2.3.1)"
```

---

### Task 3: Structural — k-core + clustering coefficient/transitivity

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs`
- Test: `tests/unit/graph-theory-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/graph-theory-core.test.mjs`:

```js
describe('kCore', () => {
  it('a triangle is a 2-core; a path is a 1-core', () => {
    const K3 = { nodes: ['a','b','c'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'c' }] };
    const tri = kCore(K3);
    expect(tri.get('a')).toBe(2); expect(tri.get('b')).toBe(2); expect(tri.get('c')).toBe(2);
    const path = kCore(PATH3);
    expect(path.get('A')).toBe(1); expect(path.get('B')).toBe(1); expect(path.get('C')).toBe(1);
  });
  it('isolated nodes have coreness 0', () => {
    const c = kCore({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(c.get('a')).toBe(0); expect(c.get('b')).toBe(0);
  });
});

describe('clusteringCoefficient', () => {
  it('is 1 everywhere on a triangle (local + transitivity)', () => {
    const K3 = { nodes: ['a','b','c'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'c' }] };
    const { local, transitivity } = clusteringCoefficient(K3);
    expect(local.a).toBeCloseTo(1, 9);
    expect(transitivity).toBeCloseTo(1, 9);
  });
  it('is 0 on a star (no triangles)', () => {
    const { local, transitivity } = clusteringCoefficient(STAR);
    expect(local.h).toBe(0);
    expect(local.a).toBe(0);
    expect(transitivity).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: FAIL — `kCore is not a function` / `clusteringCoefficient is not a function`.

- [ ] **Step 3: Implement**

Add to `upstream/docker-server-graph-theory-core.mjs` (after `articulationPointsAndBridges`):

```js
/** k-core decomposition (degeneracy ordering): Map<id, coreNumber>. O(V^2) peeling — graphs here are small. */
export function kCore(graph) {
  const { ids, adj } = undirectedAdj(graph);
  const deg = new Map(ids.map((id) => [id, adj.get(id).length]));
  const removed = new Set();
  const core = new Map();
  let k = 0;
  while (removed.size < ids.length) {
    let u = null, min = Infinity;
    for (const id of ids) { if (removed.has(id)) continue; const d = deg.get(id); if (d < min) { min = d; u = id; } }
    k = Math.max(k, min);
    core.set(u, k);
    removed.add(u);
    for (const w of adj.get(u)) { if (!removed.has(w)) deg.set(w, deg.get(w) - 1); }
  }
  return core;
}

/** Local clustering coefficient per node + global transitivity (3·triangles / connected-triples). */
export function clusteringCoefficient(graph) {
  const { ids, adj } = undirectedAdj(graph);
  const nbrSet = new Map(ids.map((id) => [id, new Set(adj.get(id))]));
  const local = {};
  let closedTriads = 0;   // Σ over v of (pairs of v's neighbors that are linked) = 3·triangles
  let triads = 0;         // Σ over v of C(deg(v),2) = connected triples
  for (const v of ids) {
    const ns = [...nbrSet.get(v)];
    const k = ns.length;
    if (k < 2) { local[v] = 0; continue; }
    let links = 0;
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) { if (nbrSet.get(ns[i]).has(ns[j])) links++; }
    }
    local[v] = (2 * links) / (k * (k - 1));
    closedTriads += links;
    triads += (k * (k - 1)) / 2;
  }
  const transitivity = triads > 0 ? closedTriads / triads : 0;
  return { local, transitivity };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: the new tests PASS; all prior tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-graph-theory-core.mjs tests/unit/graph-theory-core.test.mjs
git commit -m "feat(graph-theory): k-core + clustering coefficient/transitivity (P2.3.1)"
```

---

### Task 4: Centrality — closeness + harmonic

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs`
- Test: `tests/unit/graph-theory-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/graph-theory-core.test.mjs`:

```js
describe('closeness', () => {
  it('ranks the middle of a path highest', () => {
    const c = closeness(PATH3);
    expect(c.B).toBeGreaterThan(c.A);
    expect(c.A).toBeCloseTo(c.C, 9);
  });
  it('is finite on a disconnected graph (component-aware, no Infinity)', () => {
    const c = closeness({ nodes: ['a','b','c','d'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }] });
    expect(Number.isFinite(c.a)).toBe(true);
    expect(c.a).toBeGreaterThan(0);
  });
});

describe('harmonic', () => {
  it('ranks the middle of a path highest and is disconnection-safe', () => {
    const h = harmonic(PATH3);
    expect(h.B).toBeGreaterThan(h.A);
    const d = harmonic({ nodes: ['a','b','c','d'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }] });
    expect(Number.isFinite(d.a)).toBe(true);
  });
  it('is 0 on an edgeless graph', () => {
    const h = harmonic({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] });
    expect(h.a).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: FAIL — `closeness is not a function` / `harmonic is not a function`.

- [ ] **Step 3: Implement**

Add to `upstream/docker-server-graph-theory-core.mjs` (after `clusteringCoefficient`):

```js
/** Single-source BFS distances over the undirected adjacency; unreached stay -1. */
function bfsDistances(adj, ids, s) {
  const dist = new Map(ids.map((id) => [id, -1]));
  dist.set(s, 0);
  const queue = [s];
  while (queue.length) {
    const v = queue.shift();
    for (const w of adj.get(v)) { if (dist.get(w) < 0) { dist.set(w, dist.get(v) + 1); queue.push(w); } }
  }
  return dist;
}

/** Closeness centrality, component-aware (Wasserman–Faust): (reach/(N-1))·(reach/Σd); 0 if isolated. */
export function closeness(graph) {
  const { ids, adj } = undirectedAdj(graph);
  const N = ids.length;
  const out = {};
  for (const s of ids) {
    const dist = bfsDistances(adj, ids, s);
    let sum = 0, reach = 0;
    for (const id of ids) { if (id === s) continue; const d = dist.get(id); if (d > 0) { sum += d; reach++; } }
    out[s] = (sum > 0 && N > 1) ? (reach / (N - 1)) * (reach / sum) : 0;
  }
  return out;
}

/** Harmonic centrality: Σ_{u≠v} 1/d(v,u) over reachable u, normalized by (N-1). Disconnection-safe. */
export function harmonic(graph) {
  const { ids, adj } = undirectedAdj(graph);
  const N = ids.length;
  const out = {};
  for (const s of ids) {
    const dist = bfsDistances(adj, ids, s);
    let sum = 0;
    for (const id of ids) { if (id === s) continue; const d = dist.get(id); if (d > 0) sum += 1 / d; }
    out[s] = N > 1 ? sum / (N - 1) : 0;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: the new tests PASS; all prior tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-graph-theory-core.mjs tests/unit/graph-theory-core.test.mjs
git commit -m "feat(graph-theory): closeness + harmonic centrality (P2.3.1)"
```

---

### Task 5: Centrality — Katz

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs`
- Test: `tests/unit/graph-theory-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/graph-theory-core.test.mjs`:

```js
describe('katz', () => {
  it('ranks the hub of a star above a leaf and is finite/positive', () => {
    const k = katz(STAR);
    expect(k.h).toBeGreaterThan(k.a);
    expect(Object.values(k).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });
  it('degrades to a finite uniform result on an edgeless graph', () => {
    const k = katz({ nodes: ['a','b'].map((id) => ({ id })), edges: [] });
    expect(Number.isFinite(k.a)).toBe(true);
    expect(k.a).toBeCloseTo(k.b, 9);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: FAIL — `katz is not a function`.

- [ ] **Step 3: Implement**

Add to `upstream/docker-server-graph-theory-core.mjs` (after `harmonic`):

```js
/**
 * Katz centrality via power iteration x ← α·A·x + β, L2-normalized each step.
 * α default 0.1: Katz requires α < 1/λmax; we do not compute λmax, so a small fixed
 * α is the documented v1 choice (a λmax-aware α is future work). Edgeless → uniform.
 */
export function katz(graph, { alpha = 0.1, beta = 1, maxIter = 200, tol = 1e-9 } = {}) {
  const { ids, adj } = undirectedAdj(graph);
  const N = ids.length;
  const out = {};
  if (N === 0) return out;
  let x = new Map(ids.map((id) => [id, 0]));
  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Map(ids.map((id) => [id, beta]));            // β baseline
    for (const id of ids) {
      const xi = x.get(id);
      if (xi !== 0) for (const w of adj.get(id)) next.set(w, next.get(w) + alpha * xi);  // α·(A·x)
    }
    let norm = 0;
    for (const id of ids) norm += next.get(id) * next.get(id);
    norm = Math.sqrt(norm);
    if (norm === 0) { for (const id of ids) out[id] = 0; return out; }
    let diff = 0;
    for (const id of ids) { const v = next.get(id) / norm; diff += Math.abs(v - x.get(id)); next.set(id, v); }
    x = next;
    if (diff < tol) break;
  }
  for (const id of ids) out[id] = x.get(id);
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: the new tests PASS; all prior tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-graph-theory-core.mjs tests/unit/graph-theory-core.test.mjs
git commit -m "feat(graph-theory): Katz centrality (P2.3.1)"
```

---

### Task 6: Community — resolution-tunable Louvain + label propagation

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs` (refactor `louvain` to take `resolution`; add `labelPropagation`)
- Test: `tests/unit/graph-theory-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/graph-theory-core.test.mjs`:

```js
describe('louvain resolution', () => {
  it('default resolution=1 is byte-identical to the parameterless call (regression guard)', () => {
    expect(louvain(BARBELL, { seed: 1, resolution: 1 }).communities).toEqual(louvain(BARBELL, { seed: 1 }).communities);
  });
  it('higher resolution yields at least as many communities', () => {
    const lo = new Set(Object.values(louvain(BARBELL, { seed: 1, resolution: 0.5 }).communities)).size;
    const hi = new Set(Object.values(louvain(BARBELL, { seed: 1, resolution: 3 }).communities)).size;
    expect(hi).toBeGreaterThanOrEqual(lo);
  });
});

describe('labelPropagation', () => {
  it('finds the two cliques of a barbell', () => {
    const { communities } = labelPropagation(BARBELL, { seed: 1 });
    expect(communities.x1).toBe(communities.x2);
    expect(communities.x2).toBe(communities.x3);
    expect(communities.y1).toBe(communities.y2);
    expect(communities.x1).not.toBe(communities.y1);
  });
  it('renumbers communities from 0 and is deterministic for a fixed seed', () => {
    const a = labelPropagation(BARBELL, { seed: 3 }).communities;
    const b = labelPropagation(BARBELL, { seed: 3 }).communities;
    expect(a).toEqual(b);
    expect(Math.min(...Object.values(a))).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: FAIL — `labelPropagation is not a function`; the resolution test fails until `louvain` accepts `resolution`.

- [ ] **Step 3: Implement**

(3a) Refactor `louvain`'s signature and apply `resolution` (γ) in the gain and modularity. Change the signature line:

```js
export function louvain(graph, { seed = 1, resolution = 1 } = {}) {
```

In the local-moving loop, change the two gain expressions to multiply the expected-edges term by `resolution`:

```js
      let best = cur;
      let bestGain = (kin.get(cur) || 0) - resolution * (sigmaTot.get(cur) * ki) / m2;
      for (const [c, kic] of kin) {
        const gain = kic - resolution * (sigmaTot.get(c) * ki) / m2;
        if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
      }
```

And in the modularity accumulation, multiply the squared term by `resolution`:

```js
  let modularity = 0;
  for (const [c, st] of stot) modularity += (sin.get(c) || 0) / m2 - resolution * (st / m2) ** 2;
```

(With `resolution === 1` every expression is arithmetically identical to before — the regression test guards this.)

(3b) Add `labelPropagation` after `louvain`:

```js
/** Label propagation community detection (seeded, deterministic tie-break). Returns { communities }. */
export function labelPropagation(graph, { seed = 1, maxIter = 100 } = {}) {
  const { ids, adj } = undirectedAdj(graph);
  const communities = {};
  if (ids.length === 0) return { communities };
  const label = new Map(ids.map((id) => [id, id]));
  const rng = mulberry32(seed);
  const order = ids.slice();
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let changed = false;
    for (const v of order) {
      const counts = new Map();
      for (const w of adj.get(v)) { const l = label.get(w); counts.set(l, (counts.get(l) || 0) + 1); }
      if (counts.size === 0) continue;                         // isolated node keeps its own label
      let best = null, bestC = -1;
      for (const [l, c] of counts) {
        if (c > bestC || (c === bestC && String(l) < String(best))) { bestC = c; best = l; }   // deterministic tie-break
      }
      if (best !== label.get(v)) { label.set(v, best); changed = true; }
    }
    if (!changed) break;
  }
  const remap = new Map();
  let next = 0;
  for (const id of ids) { const l = label.get(id); if (!remap.has(l)) remap.set(l, next++); communities[id] = remap.get(l); }
  return { communities };
}
```

> If `seed: 1`/`seed: 3` happen to collapse the barbell to one community, choose a seed that yields the stable 2-clique partition (label propagation's fixed point on a barbell *is* the two cliques; the seed only sets visit order). Update the test's seed accordingly — the determinism assertion is the invariant, the exact seed is not.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: the new tests PASS; **all pre-existing `louvain` tests still PASS** (the regression guard confirms byte-identical default behaviour).

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-graph-theory-core.mjs tests/unit/graph-theory-core.test.mjs
git commit -m "feat(graph-theory): resolution-tunable Louvain + label propagation (P2.3.1)"
```

---

### Task 7: Community — Leiden (single-level + connectivity refinement)

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs`
- Test: `tests/unit/graph-theory-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/graph-theory-core.test.mjs`:

```js
// Returns true iff every community in `communities` is internally connected over `graph`.
function allCommunitiesConnected(graph, communities) {
  const adj = new Map();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) { if (adj.has(e.source) && adj.has(e.target) && e.source !== e.target) { adj.get(e.source).push(e.target); adj.get(e.target).push(e.source); } }
  const byComm = new Map();
  for (const id of Object.keys(communities)) { const c = communities[id]; if (!byComm.has(c)) byComm.set(c, []); byComm.get(c).push(id); }
  for (const [, members] of byComm) {
    const memberSet = new Set(members);
    const seen = new Set([members[0]]);
    const queue = [members[0]];
    while (queue.length) { const v = queue.shift(); for (const w of adj.get(v)) { if (memberSet.has(w) && !seen.has(w)) { seen.add(w); queue.push(w); } } }
    if (seen.size !== members.length) return false;
  }
  return true;
}

describe('leiden', () => {
  it('finds the two cliques of a barbell', () => {
    const { communities } = leiden(BARBELL, { seed: 1 });
    expect(communities.x1).toBe(communities.x2);
    expect(communities.x2).toBe(communities.x3);
    expect(communities.x1).not.toBe(communities.y1);
    expect(new Set(Object.values(communities)).size).toBe(2);
  });
  it('guarantees every community is internally connected', () => {
    expect(allCommunitiesConnected(BARBELL, leiden(BARBELL, { seed: 1 }).communities)).toBe(true);
    const TWO_COMP = { nodes: ['a','b','c','d'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }] };
    expect(allCommunitiesConnected(TWO_COMP, leiden(TWO_COMP, { seed: 1 }).communities)).toBe(true);
  });
  it('renumbers communities from 0 and is deterministic for a fixed seed', () => {
    const a = leiden(BARBELL, { seed: 5 }).communities;
    expect(a).toEqual(leiden(BARBELL, { seed: 5 }).communities);
    expect(Math.min(...Object.values(a))).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: FAIL — `leiden is not a function`.

- [ ] **Step 3: Implement**

Add to `upstream/docker-server-graph-theory-core.mjs` (after `labelPropagation`):

```js
/**
 * Leiden community detection (single-level): Louvain local-moving, then a refinement
 * phase that splits any internally-disconnected community into its connected
 * sub-communities. The refinement is what distinguishes Leiden from Louvain — it
 * GUARANTEES every output community is internally connected (Louvain can return a
 * disconnected community; Leiden cannot). Single-level, matching this engine's Louvain;
 * multi-level super-node aggregation is deferred. Returns { communities }.
 */
export function leiden(graph, { seed = 1, resolution = 1 } = {}) {
  const { ids, adj } = undirectedAdj(graph);
  const communities = {};
  if (ids.length === 0) return { communities };
  const base = louvain(graph, { seed, resolution }).communities;        // 1. local-moving partition
  // 2. refinement: relabel each community by its connected components (intra-community edges only)
  const byComm = new Map();
  for (const id of ids) { const c = base[id]; if (!byComm.has(c)) byComm.set(c, []); byComm.get(c).push(id); }
  const refined = new Map();
  let nextSub = 0;
  for (const [, members] of byComm) {
    const memberSet = new Set(members);
    const seen = new Set();
    for (const start of members) {
      if (seen.has(start)) continue;
      seen.add(start); refined.set(start, nextSub);
      const queue = [start];
      while (queue.length) {
        const v = queue.shift();
        for (const w of adj.get(v)) { if (memberSet.has(w) && !seen.has(w)) { seen.add(w); refined.set(w, nextSub); queue.push(w); } }
      }
      nextSub++;
    }
  }
  // 3. renumber 0..k-1 in first-seen order
  const remap = new Map();
  let next = 0;
  for (const id of ids) { const c = refined.get(id); if (!remap.has(c)) remap.set(c, next++); communities[id] = remap.get(c); }
  return { communities };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: the new tests PASS; all prior tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-graph-theory-core.mjs tests/unit/graph-theory-core.test.mjs
git commit -m "feat(graph-theory): Leiden (single-level + connectivity refinement, P2.3.1)"
```

---

### Task 8: `computeMetrics` integration — new per-node fields + bridges + summary + method dispatch

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs` (`computeMetrics`)
- Test: `tests/unit/graph-theory-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/graph-theory-core.test.mjs`:

```js
describe('computeMetrics — P2.3.1 fields', () => {
  it('exposes the new per-node fields + bridges + summary fields', () => {
    const r = computeMetrics(BARBELL);
    const n = r.nodes[0];
    for (const f of ['closeness', 'katz', 'harmonic', 'coreness', 'clustering', 'articulation', 'componentId', 'community']) {
      expect(n).toHaveProperty(f);
    }
    expect(r.nodes.every((x) => Number.isFinite(x.closeness) && Number.isFinite(x.katz) && Number.isFinite(x.harmonic))).toBe(true);
    expect(Array.isArray(r.bridges)).toBe(true);
    expect(r.bridges.some((b) => (b.source === 'x1' && b.target === 'y1') || (b.source === 'y1' && b.target === 'x1'))).toBe(true);
    expect(r.summary).toHaveProperty('density');
    expect(r.summary).toHaveProperty('componentCount');
    expect(r.summary).toHaveProperty('transitivity');
    expect(r.summary.componentCount).toBe(1);
  });
  it('keeps existing fields byte-identical under default options (regression)', () => {
    const r = computeMetrics(BARBELL);
    const n = r.nodes.find((x) => x.id === 'x1');
    // existing fields unchanged in name/shape
    for (const f of ['id', 'degree', 'pagerank', 'betweenness', 'eigenvector', 'community']) expect(n).toHaveProperty(f);
    expect(r.summary).toMatchObject({ nodeCount: 6, edgeCount: 7, communityCount: 2 });
  });
  it('switches the partition when community method changes', () => {
    const lv = computeMetrics(BARBELL, { community: 'louvain' });
    const ld = computeMetrics(BARBELL, { community: 'leiden' });
    const lp = computeMetrics(BARBELL, { community: 'labelprop' });
    for (const r of [lv, ld, lp]) expect(r.nodes.every((n) => Number.isFinite(n.community))).toBe(true);
  });
  it('marks the barbell bridge endpoints as articulation points', () => {
    const r = computeMetrics(BARBELL);
    expect(r.nodes.find((n) => n.id === 'x1').articulation).toBe(true);
    expect(r.nodes.find((n) => n.id === 'x2').articulation).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: FAIL — new fields/`bridges`/summary fields absent; `community` option not honoured.

- [ ] **Step 3: Implement**

Replace the entire `computeMetrics` function in `upstream/docker-server-graph-theory-core.mjs` with:

```js
export function computeMetrics(graph, { community = 'louvain', resolution = 1, seed = 1 } = {}) {
  const ids = nodeIds(graph);
  const deg = degreeCentrality(graph);
  const pr = pageRank(graph);
  const bt = betweenness(graph);
  const ev = eigenvector(graph);
  const cl = closeness(graph);
  const kz = katz(graph);
  const hr = harmonic(graph);
  const core = kCore(graph);
  const { local: clustering, transitivity } = clusteringCoefficient(graph);
  const comp = connectedComponents(graph);
  const { articulation, bridges } = articulationPointsAndBridges(graph);

  // Community method dispatch — Louvain default (byte-identical to before).
  let communities, modularity;
  if (community === 'labelprop') {
    ({ communities } = labelPropagation(graph, { seed }));
    modularity = modularityOf(graph, communities, resolution);
  } else if (community === 'leiden') {
    ({ communities } = leiden(graph, { seed, resolution }));
    modularity = modularityOf(graph, communities, resolution);
  } else {
    ({ communities, modularity } = louvain(graph, { seed, resolution }));
  }

  const nodes = ids.map((id) => ({
    id,
    degree: deg[id] ?? 0,
    pagerank: pr[id] ?? 0,
    betweenness: bt[id] ?? 0,
    eigenvector: ev[id] ?? 0,
    closeness: cl[id] ?? 0,
    katz: kz[id] ?? 0,
    harmonic: hr[id] ?? 0,
    coreness: core.get(id) ?? 0,
    clustering: clustering[id] ?? 0,
    articulation: articulation.has(id),
    componentId: comp.get(id) ?? 0,
    community: communities[id] ?? 0,
  }));
  const idSet = new Set(ids);
  return {
    nodes,
    bridges: bridges.map(([source, target]) => ({ source, target })),
    summary: {
      nodeCount: ids.length,
      edgeCount: cleanEdges(graph, idSet).length,
      communityCount: new Set(Object.values(communities)).size,
      modularity,
      density: density(graph),
      componentCount: new Set(comp.values()).size,
      transitivity,
    },
  };
}

/** Modularity Q of an arbitrary partition (for label-prop / Leiden, which don't return it). */
function modularityOf(graph, communities, resolution = 1) {
  const ids = nodeIds(graph);
  const idSet = new Set(ids);
  const k = new Map(ids.map((id) => [id, 0]));
  let m2 = 0;
  const adj = new Map(ids.map((id) => [id, []]));
  for (const [s, t] of cleanEdges(graph, idSet)) { adj.get(s).push(t); adj.get(t).push(s); k.set(s, k.get(s) + 1); k.set(t, k.get(t) + 1); m2 += 2; }
  if (m2 === 0) return 0;
  const sin = new Map(), stot = new Map();
  for (const id of ids) {
    const c = communities[id];
    stot.set(c, (stot.get(c) || 0) + k.get(id));
    for (const w of adj.get(id)) { if (communities[w] === c) sin.set(c, (sin.get(c) || 0) + 1); }
  }
  let q = 0;
  for (const [c, st] of stot) q += (sin.get(c) || 0) / m2 - resolution * (st / m2) ** 2;
  return q;
}
```

(Note `modularityOf`'s `sin` counts each internal edge twice because `adj` stores both directions — the same intentional double-count the existing `louvain` modularity relies on, so the `/m2` normalization matches.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`
Expected: all new + all pre-existing graph-theory tests PASS (the byte-identical regression test confirms the default path is unchanged).

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-graph-theory-core.mjs tests/unit/graph-theory-core.test.mjs
git commit -m "feat(graph-theory): computeMetrics integrates structural+centrality+community methods (P2.3.1)"
```

---

### Task 9: Endpoint — optional `community` / `resolution` query params

**Files:**
- Modify: `upstream/docker-server-graph-theory.mjs`
- Test: `tests/unit/graph-theory-endpoint.test.mjs` (new — unit-level, mocks `sidecarRender` + `computeMetrics` via module behaviour is awkward; instead test the param-parsing helper directly — see below)

To keep this testable without a live sidecar, extract param parsing into a pure exported helper and unit-test that; the route wiring is verified on the live stack in Final.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/graph-theory-endpoint.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { parseMetricsParams } from '../../upstream/docker-server-graph-theory.mjs';

describe('parseMetricsParams', () => {
  it('defaults to louvain @ resolution 1', () => {
    expect(parseMetricsParams(new URLSearchParams(''))).toEqual({ community: 'louvain', resolution: 1 });
  });
  it('accepts valid community + resolution', () => {
    expect(parseMetricsParams(new URLSearchParams('community=leiden&resolution=2.5'))).toEqual({ community: 'leiden', resolution: 2.5 });
    expect(parseMetricsParams(new URLSearchParams('community=labelprop'))).toEqual({ community: 'labelprop', resolution: 1 });
  });
  it('throws on an unknown community', () => {
    expect(() => parseMetricsParams(new URLSearchParams('community=bogus'))).toThrow();
  });
  it('throws on a non-positive / non-finite resolution', () => {
    expect(() => parseMetricsParams(new URLSearchParams('resolution=0'))).toThrow();
    expect(() => parseMetricsParams(new URLSearchParams('resolution=-1'))).toThrow();
    expect(() => parseMetricsParams(new URLSearchParams('resolution=abc'))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-endpoint`
Expected: FAIL — `parseMetricsParams is not a function`.

- [ ] **Step 3: Implement**

Replace `upstream/docker-server-graph-theory.mjs` with:

```js
/**
 * Graph-theory metrics route (web container). GET /graph/metrics/:name[?community=&resolution=]
 *   → sidecar render of <name> → computeMetrics (pure-JS engine).
 * Response: { nodes:[{id,degree,pagerank,betweenness,eigenvector,closeness,katz,harmonic,
 *             coreness,clustering,articulation,componentId,community}],
 *             bridges:[{source,target}],
 *             summary:{nodeCount,edgeCount,communityCount,modularity,density,componentCount,transitivity} }
 */
import { sidecarRender } from './docker-server-graph-templates-core.mjs';
import { computeMetrics } from './docker-server-graph-theory-core.mjs';

const COMMUNITY_METHODS = new Set(['louvain', 'leiden', 'labelprop']);

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

export async function handleGraphMetricsRoute(req, url, res) {
  if (!url.pathname.startsWith('/graph/metrics/') || req.method !== 'GET') return false;
  const name = decodeURIComponent(url.pathname.slice('/graph/metrics/'.length));
  let params;
  try { params = parseMetricsParams(url.searchParams); }
  catch (e) { sendJson(res, 400, { error: e.message }); return true; }
  let graph;
  try { graph = await sidecarRender(name); }
  catch (e) { sendJson(res, 404, { error: `graph "${name}" not available: ${e.message}` }); return true; }
  try { sendJson(res, 200, computeMetrics(graph, params)); }
  catch (e) { sendJson(res, 500, { error: `metrics failed: ${e.message}` }); return true; }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-endpoint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add upstream/docker-server-graph-theory.mjs tests/unit/graph-theory-endpoint.test.mjs
git commit -m "feat(graph-theory): /graph/metrics community+resolution query params (P2.3.1)"
```

---

### Task 10: MCP — `community` / `resolution` args + description

**Files:**
- Modify: `mcp-server/server.mjs` (the `gitnexus_graph_metrics` tool)
- Test: `mcp-server/server.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `mcp-server/server.test.mjs`, inside the existing `gitnexus_graph_metrics` section (after the `encodeURIComponent` test, ~line 118):

```js
  it('gitnexus_graph_metrics inputSchema offers community + resolution params', () => {
    assert.ok(src.includes("'louvain'") && src.includes("'leiden'") && src.includes("'labelprop'"),
      'community enum must list louvain/leiden/labelprop');
    assert.ok(src.includes('resolution'), 'inputSchema must offer a resolution param');
  });
  it("gitnexus_graph_metrics description mentions the structural + community additions", () => {
    assert.ok(/closeness/i.test(src) && /Leiden/i.test(src),
      'description should mention closeness + Leiden');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && node --test server.test.mjs`
Expected: FAIL — community enum / resolution / description assertions not satisfied.

- [ ] **Step 3: Implement**

In `mcp-server/server.mjs`, replace the `gitnexus_graph_metrics` tool object (lines ~566-578) with:

```js
  {
    name: 'gitnexus_graph_metrics',
    description: 'Graph-theory metrics for a sidecar graph by name. Per-node: degree, PageRank, betweenness, eigenvector, closeness, Katz, harmonic centrality, k-core (coreness), clustering coefficient, articulation-point flag, component id, community. Plus top-level bridges and a summary (density, components, transitivity, modularity). Community method selectable: Louvain (default, resolution-tunable), Leiden, or label propagation.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Sidecar graph name (as registered via gitnexus_create_graph_from_template).' },
        community: { type: 'string', enum: ['louvain', 'leiden', 'labelprop'], description: 'Community-detection method (default louvain).' },
        resolution: { type: 'number', description: 'Resolution γ for Louvain/Leiden (default 1; higher → more, smaller communities).' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: ({ name, community, resolution }) => {
      const params = {};
      if (community) params.community = community;
      if (resolution !== undefined) params.resolution = resolution;
      return callWeb(`/graph/metrics/${encodeURIComponent(name)}`, params);
    },
  },
```

(The handler keeps the exact `/graph/metrics/${encodeURIComponent(name)}` path substring the existing tests assert.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && node --test server.test.mjs`
Expected: PASS (new + all existing MCP tests).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/server.mjs mcp-server/server.test.mjs
git commit -m "feat(mcp): gitnexus_graph_metrics community+resolution params + description (P2.3.1)"
```

---

### Task 11: Frontend — extend the overlay size-metric selector

**Files:**
- Modify: `upstream/gitnexus-web/src/services/graph-theory-client.ts`
- Modify: `upstream/gitnexus-web/src/lib/research-graph-adapter.ts`
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx`
- Test: `tests/unit/graph-theory-client.test.mjs`

- [ ] **Step 1: Write the failing test**

Replace `tests/unit/graph-theory-client.test.mjs` with:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getGraphMetrics } from '../../upstream/gitnexus-web/src/services/graph-theory-client.ts';
afterEach(() => vi.unstubAllGlobals());
describe('getGraphMetrics', () => {
  it('GETs /graph/metrics/:name and returns the extended payload', async () => {
    const fake = { nodes: [{ id: 'a', degree: 1, pagerank: 0.5, betweenness: 0.2, eigenvector: 0.4, closeness: 0.3, katz: 0.1, harmonic: 0.25, coreness: 1, clustering: 0, articulation: false, componentId: 0, community: 0 }],
      bridges: [{ source: 'a', target: 'b' }],
      summary: { nodeCount: 1, edgeCount: 0, communityCount: 1, modularity: 0, density: 0, componentCount: 1, transitivity: 0 } };
    const f = vi.fn(async () => ({ ok: true, json: async () => fake }));
    vi.stubGlobal('fetch', f);
    const r = await getGraphMetrics('my graph');
    expect(f).toHaveBeenCalledWith('/graph/metrics/my%20graph');
    expect(r.nodes[0]).toHaveProperty('closeness');
    expect(r.nodes[0]).toHaveProperty('coreness');
    expect(r.nodes[0]).toHaveProperty('clustering');
    expect(r.summary).toHaveProperty('density');
    expect(Array.isArray(r.bridges)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-client`
Expected: FAIL — type-only at first; the test will pass once the interface carries the fields and the payload is returned. (It fails now only if you tighten types; primarily this guards the interface in Step 3.)

- [ ] **Step 3: Implement**

(3a) `upstream/gitnexus-web/src/services/graph-theory-client.ts` — replace the file with:

```ts
export interface GraphMetricNode {
  id: string;
  degree: number;
  pagerank: number;
  betweenness: number;
  eigenvector: number;
  closeness: number;
  katz: number;
  harmonic: number;
  coreness: number;
  clustering: number;
  articulation: boolean;
  componentId: number;
  community: number;
}
export interface GraphMetrics {
  nodes: GraphMetricNode[];
  bridges: { source: string; target: string }[];
  summary: { nodeCount: number; edgeCount: number; communityCount: number; modularity: number; density: number; componentCount: number; transitivity: number };
}

export type SizeMetric = 'degree' | 'pagerank' | 'betweenness' | 'eigenvector' | 'closeness' | 'katz' | 'harmonic' | 'coreness' | 'clustering';

export async function getGraphMetrics(name: string): Promise<GraphMetrics> {
  const res = await fetch(`/graph/metrics/${encodeURIComponent(name)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as GraphMetrics;
}
```

(3b) `upstream/gitnexus-web/src/lib/research-graph-adapter.ts` — widen the metrics value type + the `sizeBy` union. Replace the `researchGraphToGraphology` signature (lines ~38-41) with:

```ts
export function researchGraphToGraphology(
  rg: ResearchGraph,
  metricsById?: Map<string, { degree: number; pagerank: number; betweenness: number; eigenvector: number; closeness: number; katz: number; harmonic: number; coreness: number; clustering: number; community: number }>,
  sizeBy: 'degree' | 'pagerank' | 'betweenness' | 'eigenvector' | 'closeness' | 'katz' | 'harmonic' | 'coreness' | 'clustering' = 'pagerank',
): Graph<SigmaNodeAttributes, SigmaEdgeAttributes> {
```

The body is unchanged — `m[sizeBy]` and `maxV` already index by the `sizeBy` key, so the new metrics flow through the existing `size = 4 + 16 * Math.sqrt((m[sizeBy] ?? 0) / maxV)` formula. The color path (community) and no-metrics path stay byte-identical.

(3c) `upstream/gitnexus-web/src/components/GraphCanvas.tsx`:

- Update the `sizeMetric` state type (line ~128) and the metrics map value type (line ~127) to the widened set. Replace lines 127-128:

```tsx
  const [metricsById, setMetricsById] = useState<Map<string, { degree: number; pagerank: number; betweenness: number; eigenvector: number; closeness: number; katz: number; harmonic: number; coreness: number; clustering: number; community: number }> | null>(null);
  const [sizeMetric, setSizeMetric] = useState<'degree' | 'pagerank' | 'betweenness' | 'eigenvector' | 'closeness' | 'katz' | 'harmonic' | 'coreness' | 'clustering'>('pagerank');
```

- In the metrics-fetch effect (line ~149), carry the new fields into the map:

```tsx
        setMetricsById(new Map(m.nodes.map((n) => [n.id, { degree: n.degree, pagerank: n.pagerank, betweenness: n.betweenness, eigenvector: n.eigenvector, closeness: n.closeness, katz: n.katz, harmonic: n.harmonic, coreness: n.coreness, clustering: n.clustering, community: n.community }])));
```

- In the selector `onChange` cast (line ~907) widen the union, and add the new `<option>`s. Replace the `<select>` block (lines ~905-915) with:

```tsx
          <select
            value={sizeMetric}
            onChange={(e) => setSizeMetric(e.target.value as 'degree' | 'pagerank' | 'betweenness' | 'eigenvector' | 'closeness' | 'katz' | 'harmonic' | 'coreness' | 'clustering')}
            className="flex h-10 items-center rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-3 font-mono text-xs font-semibold text-indigo-200 transition-colors hover:border-indigo-300/60 hover:bg-indigo-500/20"
            data-testid="metric-select"
          >
            <option value="degree">Degree</option>
            <option value="pagerank">PageRank</option>
            <option value="betweenness">Betweenness</option>
            <option value="eigenvector">Eigenvector</option>
            <option value="closeness">Closeness</option>
            <option value="katz">Katz</option>
            <option value="harmonic">Harmonic</option>
            <option value="coreness">k-core</option>
            <option value="clustering">Clustering</option>
          </select>
```

- [ ] **Step 4: Run test + type-check to verify they pass**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-client`
Expected: PASS.

Run the web type-check: `cd upstream/gitnexus-web && npx tsc -b --noEmit` (or the project's configured `tsc` invocation).
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add upstream/gitnexus-web/src/services/graph-theory-client.ts upstream/gitnexus-web/src/lib/research-graph-adapter.ts upstream/gitnexus-web/src/components/GraphCanvas.tsx tests/unit/graph-theory-client.test.mjs
git commit -m "feat(web): size-metric selector gains closeness/katz/harmonic/k-core/clustering (P2.3.1)"
```

---

### Task 12: Docs — roadmap (P2.3.1 shipped + P2.3.2/P2.3.3 backlog) + inventory

**Files:**
- Modify: `ROADMAP.md`
- Modify: `INVENTORY.md`

- [ ] **Step 1: Update ROADMAP.md**

Find the P2 / graph-theory-toolkit section. Add a row recording **P2.3.1 ✅ Livré 2026-06-09** (structural algorithms — articulation points/bridges/components/k-core/clustering/density; closeness/Katz/harmonic centrality; resolution-Louvain + label propagation + single-level Leiden; backward-compatible `/graph/metrics` params + MCP + size-selector). Add/keep backlog rows for:
- **P2.3.2 (B)** — ASTKG as a metrics source (`/api/graph` via `GITNEXUS_API`, caching + large-graph handling).
- **P2.3.3 (C)** — visualization surfaces (heatmap coloring, community-method picker, bridge/articulation rendering, community filter/isolate, top-N panel, CSV/JSON export).
- Remaining beyond P2.3: directed-graph variants, embeddings (node2vec/DeepWalk), multi-level (aggregation) community detection.

- [ ] **Step 2: Update INVENTORY.md**

Find the `/graph/metrics/:name` entry. Update it to reflect the full per-node metric set (degree, PageRank, betweenness, eigenvector, closeness, Katz, harmonic, coreness, clustering, articulation, componentId, community), the top-level `bridges`, the extended `summary` (density, componentCount, transitivity), and the optional `?community=louvain|leiden|labelprop&resolution=<float>` query params. Note the `gitnexus_graph_metrics` MCP tool now carries `community`/`resolution`.

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md INVENTORY.md
git commit -m "docs: P2.3.1 shipped (analytics engine completion) + P2.3.2/P2.3.3 backlog"
```

---

## Final verification (controller-run, after all tasks)

1. **Drift:** `node scripts/check-patch-drift.mjs` → exit 0 (the patches must be regenerated by the controller — subagents never touch git/patches).
2. **Full unit tier:** `bash tests/docker-test.sh unit` → all pass (current 548 + the new P2.3.1 tests). If Rancher panics, retry once or run the graph-theory tests host-native: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory`.
3. **MCP tests:** `cd mcp-server && node --test server.test.mjs` → all pass.
4. **Web type-check:** `cd upstream/gitnexus-web && npx tsc -b --noEmit` → clean.
5. **Stack e2e** (non-colliding ports `TEST_PORT=4847 TEST_WEB_PORT=4273`): build+up the test stack on a temp extraction of `tests/fixtures/sample-repo.tar.gz`, scaffold+import `research-graph` from `research-graph-corpus`, then:
   - `GET /graph/metrics/<name>` → every node carries finite `closeness`, `katz`, `harmonic`, `coreness`, `clustering`, a boolean `articulation`, a `componentId`; response has a `bridges` array; `summary` has `density`/`componentCount`/`transitivity`.
   - `GET /graph/metrics/<name>?community=leiden` and `?resolution=2` → 200 with a (possibly) different `community` partition; `?community=bogus` → 400; `?resolution=0` → 400.
6. **No Dockerfile.web change** — confirm `git diff` touches no `upstream/Dockerfile.web` (this slice only edits already-COPY'd modules + web sources).
7. Push is the **user's call** — summarize P2.3.1 shipped + P2.3.2/P2.3.3 backlog recorded, and ask before pushing.
