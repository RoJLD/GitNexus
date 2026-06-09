# Graph Platform P2.3.2b — `file-graph` lens (full file-level collapse) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a `file-graph` lens that collapses the ASTKG to a file-level graph over ALL relationship types (one edge per file-pair), registered in the shared `LENSES` registry so it gets render + metrics + MCP for free.

**Architecture:** A new pure projection `projectFileGraph(apiGraph)` in `docker-server-graph-lens-core.mjs` (like `projectImports` without the `IMPORTS` filter, `kind:'related'`), added to the exported `LENSES` registry. No new route/endpoint/frontend — P2.3.2a's lens-metrics route + the P1 lens render route + the lens-agnostic MCP tool all already accept any registered lens id.

**Tech Stack:** Node ESM (zero-dep `.mjs`), vitest (host-native), node:test (MCP).

**Spec:** `docs/superpowers/specs/2026-06-09-graph-platform-p2-3-2b-file-graph-lens-design.md`

**Current state:** `docker-server-graph-lens-core.mjs` exports `projectImports(graph)` (file-level, `IMPORTS`-only, deduped per directed pair, self-loops dropped, render shape) and `export const LENSES = { 'imports-deps': projectImports }`. `tests/unit/graph-theory-lens-metrics.test.mjs` has a synthetic `API_GRAPH` fixture + tests `lensMetrics(apiGraph, lensId, params, cap)`.

---

### Task 1: `projectFileGraph` + register in `LENSES` + tests

**Files:**
- Modify: `upstream/docker-server-graph-lens-core.mjs`
- Test: `tests/unit/graph-theory-lens-metrics.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/graph-theory-lens-metrics.test.mjs` (extend the import at the top to also import `projectFileGraph` and `LENSES` from the lens-core module):

```js
import { lensMetrics } from '../../upstream/docker-server-graph-theory.mjs';
import { projectFileGraph, LENSES } from '../../upstream/docker-server-graph-lens-core.mjs';

// ASTKG with MIXED relationship types between files (not just IMPORTS).
const MIXED_GRAPH = {
  nodes: [
    { id: 's1', properties: { filePath: 'src/a.ts' } },
    { id: 's2', properties: { filePath: 'src/b.ts' } },
    { id: 's3', properties: { filePath: 'src/c.ts' } },
    { id: 's4', properties: { filePath: 'src/a.ts' } }, // 2nd symbol in a.ts
  ],
  relationships: [
    { sourceId: 's1', targetId: 's2', type: 'IMPORTS' },   // a→b imports
    { sourceId: 's2', targetId: 's3', type: 'CALLS' },     // b→c calls (imports-deps would DROP this)
    { sourceId: 's1', targetId: 's3', type: 'EXTENDS' },   // a→c extends
    { sourceId: 's2', targetId: 's3', type: 'IMPORTS' },   // b→c imports — dup pair with the CALLS above
    { sourceId: 's1', targetId: 's4', type: 'CALLS' },     // a.ts→a.ts — self-loop, dropped
  ],
};

describe('projectFileGraph', () => {
  it('collapses ALL relationship types to file level (one edge per pair)', () => {
    const g = projectFileGraph(MIXED_GRAPH);
    const has = (s, t) => g.edges.some((e) => e.source === s && e.target === t);
    expect(has('src/a.ts', 'src/b.ts')).toBe(true);   // IMPORTS
    expect(has('src/b.ts', 'src/c.ts')).toBe(true);   // CALLS — present here, would be DROPPED by imports-deps
    expect(has('src/a.ts', 'src/c.ts')).toBe(true);   // EXTENDS
    // dedup per directed pair: b→c appears via CALLS and IMPORTS → exactly one edge
    expect(g.edges.filter((e) => e.source === 'src/b.ts' && e.target === 'src/c.ts')).toHaveLength(1);
    // self-loop (a.ts→a.ts) dropped
    expect(g.edges.some((e) => e.source === e.target)).toBe(false);
    // edge kind is the generic 'related'
    expect(g.edges.every((e) => e.kind === 'related')).toBe(true);
    // render shape: file nodes with id=path
    expect(g.nodes.find((n) => n.id === 'src/a.ts')).toMatchObject({ type: 'file', path: 'src/a.ts' });
    expect(g.schema_type).toBe('file-graph');
  });
  it('is registered in LENSES and computes metrics via lensMetrics', () => {
    expect(LENSES['file-graph']).toBe(projectFileGraph);
    expect(LENSES['imports-deps']).toBeTypeOf('function');   // existing lens still present
    const r = lensMetrics(MIXED_GRAPH, 'file-graph', { community: 'louvain', resolution: 1 });
    expect(r.summary.nodeCount).toBe(3);                     // a, b, c
    expect(r.summary.edgeCount).toBe(3);                     // a-b, b-c, a-c
    expect(r.nodes.every((n) => Number.isFinite(n.betweenness))).toBe(true);
    expect(r.summary.capped).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-lens-metrics`
Expected: FAIL — `projectFileGraph` not exported / `LENSES['file-graph']` undefined.

- [ ] **Step 3: Implement**

In `upstream/docker-server-graph-lens-core.mjs`, add `projectFileGraph` after `projectImports` and extend `LENSES`. Replace the `LENSES` export line with the function + the extended registry:

```js
/**
 * Project a KnowledgeGraph to a file-level graph over ALL relationship types
 * (one edge per directed file-pair, self-loops dropped). Like projectImports but
 * without the IMPORTS-only filter — captures the full file-level coupling
 * (imports + calls + extends + …). Edge kind is the generic 'related'.
 */
export function projectFileGraph(graph) {
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
    const s = fileOf.get(r.sourceId);
    const t = fileOf.get(r.targetId);
    if (!s || !t || s === t) continue;
    const key = `${s}\0${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: `${s}->${t}`, source: s, target: t, kind: 'related' });
    usedFiles.add(s); usedFiles.add(t);
  }
  const fileNodes = [...usedFiles].map((fp) => ({ id: fp, type: 'file', label: fp.split('/').pop() || fp, path: fp, stage: '' }));
  return {
    schema_type: 'file-graph', template: 'file-graph', name: null, source: null,
    nodes: fileNodes, edges,
    report: { nodes: fileNodes.length, edges: edges.length },
  };
}

/** Registry of lens projections, keyed by lens id (shared by the lens route + the lens-metrics route). */
export const LENSES = { 'imports-deps': projectImports, 'file-graph': projectFileGraph };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-lens-metrics`
Expected: PASS (the new projectFileGraph tests + the existing imports-deps lens-metrics tests).

Also confirm the lens-core test (if it asserts the LENSES shape) still passes: `cd tests && npx vitest run --config vitest.config.unit.mjs graph-lens-core`
Expected: PASS (the `imports-deps` lens is unchanged; `LENSES` gained a key).

- [ ] **Step 5: Commit** — controller handles git/patches.

---

### Task 2: MCP description refresh + docs (controller)

**Files:**
- Modify: `mcp-server/server.mjs` (the `gitnexus_graph_lens_metrics` description only)
- Modify: `mcp-server/server.test.mjs` (assert the description mentions file-graph)
- Modify: `ROADMAP.md`, `INVENTORY.md`

- [ ] **Step 1: MCP description**

In `mcp-server/server.mjs`, edit the `gitnexus_graph_lens_metrics` tool `description` to mention the available lenses, e.g. append: "Available lenses: `imports-deps` (file-level import graph) and `file-graph` (file-level over all relationship types)." The schema + handler are unchanged.

Add to `mcp-server/server.test.mjs` (in the lens-metrics section): `assert.ok(/file-graph/.test(src), 'lens-metrics description should mention file-graph');`

Run: `cd mcp-server && node --test server.test.mjs` → all pass.

- [ ] **Step 2: ROADMAP.md** — flip the **P2.3.2b** backlog row to ✅ **Livré 2026-06-09** (file-graph lens — full file-level collapse over all relationship types, registered in `LENSES` → render + metrics + MCP for free), with spec/plan links. Update the P2 summary-row status to add P2.3.2b to the livrés.

- [ ] **Step 3: INVENTORY.md** — extend the `/graph/metrics/lens` note: a second lens `file-graph` (`projectFileGraph`, all relationship types collapsed to file level, one edge per pair) is now registered alongside `imports-deps`; both are renderable (`/graph/lens/:id`) and metric-able (`/graph/metrics/lens/:id`).

- [ ] **Step 4: Commit** — controller handles git.

---

## Final verification (controller-run)

1. **Drift:** `node scripts/check-patch-drift.mjs` → exit 0.
2. **Unit (host-native):** `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-lens-metrics` + `graph-lens-core` → all pass.
3. **MCP:** `cd mcp-server && node --test server.test.mjs` → all pass.
4. **No Dockerfile.web change.**
5. **Stack e2e:** the test stack mounts `/data/projects:ro` (can't index an ASTKG), so a live 200 over a real `file-graph` isn't exercisable here — same documented limit as P2.3.2a; the route + projection are unit-proven and the route plumbing is the same already-verified P2.3.2a path. Confirm `/graph/metrics/lens/file-graph?repo=x` returns a sane error (404 only if unregistered — it IS registered now, so 502 over an unindexed repo) rather than a crash, if a stack is up.
6. Push is the **user's call** — summarize P2.3.2b shipped + P2.3.2c remaining.
