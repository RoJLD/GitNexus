# IA/Model-as-graph P-IA.3 — model-version diff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Structurally diff two sidecar graphs (model versions) — added/removed/retyped nodes + added/removed edges — via a pure `diffGraphs`, a `GET /graph/diff?a=&b=` route, and an MCP tool. Backend + MCP only; visual diff view deferred.

**Architecture:** Pure `diffGraphs(a,b)` over the universal `{nodes,edges}` render shape in the already-COPY'd `docker-server-graph-templates-core.mjs`; route in the already-wired `handleGraphTemplatesRoute` (no new module, no Dockerfile.web change); MCP tool. Distinct from the frontend `computeGraphDiff` (TS, KnowledgeGraph shape, presence-only). Spec: `docs/superpowers/specs/2026-06-10-ia-model-as-graph-p-ia-3-model-diff-design.md`.

**Tech Stack:** Node ESM (pure), vitest (host-native), node:test (MCP).

**Verification venue:** `cd tests && npx vitest run --config vitest.config.unit.mjs <filter>`; MCP `node --test mcp-server/server.test.mjs`; integration sidecar-gated.

**Patch/git discipline (controller only):** regen `patches/*.diff` + `node scripts/check-patch-drift.mjs` (exit 0) before commit. Subagents NEVER touch git/patches.

---

### Task 1: pure `diffGraphs` + unit tests

**Files:**
- Modify: `upstream/docker-server-graph-templates-core.mjs` (add ONE exported pure function; place near `shapeActivations`; do not alter existing)
- Create: `tests/unit/graph-diff-models.test.mjs`

`export function diffGraphs(graphA, graphB)` over `{ nodes:[{id,type?,label?}], edges:[{source,target,kind?,id?}] }`:
- Guard: treat missing `nodes`/`edges` as `[]`.
- Build node maps `aById`/`bById` (Map id→node; first occurrence wins on dup ids).
- `added` = ids in B not in A; `removed` = ids in A not in B; `commonIds` = in both.
- `changed` = for each common id, if `aNode.type !== bNode.type || aNode.label !== bNode.label` → `{ id, from:{ type: aNode.type ?? null, label: aNode.label ?? null }, to:{ type: bNode.type ?? null, label: bNode.label ?? null } }`.
- Edge key: `const edgeKey = (e) => e.id != null ? String(e.id) : `${e.source} ${e.kind ?? ''} ${e.target}``. Build key sets for A and B. `added`/`removed`/`commonCount` by set membership.
- Return:
```js
{
  nodes: { added: [...], removed: [...], changed: [...], commonCount: N },
  edges: { added: [...], removed: [...], commonCount: N },
  summary: {
    addedNodes: added.length, removedNodes: removed.length, changedNodes: changed.length,
    addedEdges: edgeAdded.length, removedEdges: edgeRemoved.length,
    drift: added.length + removed.length + changed.length + edgeAdded.length + edgeRemoved.length,
    aNodeCount, bNodeCount, aEdgeCount, bEdgeCount,
  },
}
```
- Pure, deterministic. Sort the `added`/`removed` id/key arrays (e.g. `.sort()`) for deterministic output.

- [ ] **Step 1: Write failing test** `tests/unit/graph-diff-models.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { diffGraphs } from '../../upstream/docker-server-graph-templates-core.mjs';

// v1: s0,s1 + obs ; edges s0->s1 (transition), s0->obs (emission)
const V1 = {
  nodes: [{ id: 's0', type: 'state', label: 'Bull' }, { id: 's1', type: 'state', label: 'Bear' }, { id: 'obs', type: 'observation', label: 'Up' }],
  edges: [{ id: 's0->transition->s1', source: 's0', target: 's1', kind: 'transition' }, { id: 's0->emission->obs', source: 's0', target: 'obs', kind: 'emission' }],
};
// v2: adds s2 (added node), drops the s0->obs edge (removed edge), retypes obs's label (changed node), keeps s0->s1
const V2 = {
  nodes: [{ id: 's0', type: 'state', label: 'Bull' }, { id: 's1', type: 'state', label: 'Bear' }, { id: 's2', type: 'state', label: 'Flat' }, { id: 'obs', type: 'observation', label: 'Down' }],
  edges: [{ id: 's0->transition->s1', source: 's0', target: 's1', kind: 'transition' }, { id: 's1->transition->s2', source: 's1', target: 's2', kind: 'transition' }],
};

describe('diffGraphs', () => {
  it('reports added/removed/changed nodes', () => {
    const d = diffGraphs(V1, V2);
    expect(d.nodes.added).toEqual(['s2']);
    expect(d.nodes.removed).toEqual([]);
    expect(d.nodes.changed).toHaveLength(1);
    expect(d.nodes.changed[0]).toMatchObject({ id: 'obs', from: { label: 'Up' }, to: { label: 'Down' } });
    expect(d.nodes.commonCount).toBe(3);   // s0,s1,obs
  });
  it('reports added/removed edges by id', () => {
    const d = diffGraphs(V1, V2);
    expect(d.edges.added).toEqual(['s1->transition->s2']);
    expect(d.edges.removed).toEqual(['s0->emission->obs']);
    expect(d.edges.commonCount).toBe(1);   // s0->transition->s1
  });
  it('summary counts + drift', () => {
    const s = diffGraphs(V1, V2).summary;
    expect(s).toMatchObject({ addedNodes: 1, removedNodes: 0, changedNodes: 1, addedEdges: 1, removedEdges: 1, aNodeCount: 3, bNodeCount: 4 });
    expect(s.drift).toBe(4);   // 1 added + 0 removed + 1 changed + 1 edge added + 1 edge removed
  });
  it('identical graphs → zero drift', () => {
    const d = diffGraphs(V1, V1);
    expect(d.summary.drift).toBe(0);
    expect(d.nodes.changed).toEqual([]);
    expect(d.edges.commonCount).toBe(2);
  });
  it('falls back to source/kind/target when edge id absent', () => {
    const a = { nodes: [{ id: 'x' }, { id: 'y' }], edges: [{ source: 'x', target: 'y', kind: 'k' }] };
    const b = { nodes: [{ id: 'x' }, { id: 'y' }], edges: [] };
    const d = diffGraphs(a, b);
    expect(d.edges.removed).toEqual(['x k y']);
  });
  it('handles empty graphs', () => {
    const d = diffGraphs({ nodes: [], edges: [] }, { nodes: [], edges: [] });
    expect(d.summary.drift).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-diff-models`.
- [ ] **Step 3: Implement** `diffGraphs` in `docker-server-graph-templates-core.mjs`.
- [ ] **Step 4: Run, verify PASS** + the registry/activations tests still green (`graph-templates-registry model-activations`).
- [ ] **Step 5: Commit** (controller).

---

### Task 2: `GET /graph/diff?a=&b=` route + MCP tool

**Files:**
- Modify: `upstream/docker-server-graph-templates.mjs` (add route to `handleGraphTemplatesRoute`; import `diffGraphs` from `-core`)
- Modify: `mcp-server/server.mjs` (add `gitnexus_graph_diff`)
- Modify: `mcp-server/server.test.mjs` (source-text assertion)
- Modify: `tests/integration/endpoints/graph-templates.test.mjs` (sidecar-gated round-trip)

Route — add to `handleGraphTemplatesRoute` (before the final `return false`; `sidecarRender` is already imported; add `diffGraphs` to the existing `-core` import):
```js
if (path === '/graph/diff' && req.method === 'GET') {
  const a = url.searchParams.get('a');
  const b = url.searchParams.get('b');
  if (!a || !b) { sendJson(res, 400, { error: 'a and b query params are required' }); return true; }
  let ga, gb;
  try { ga = await sidecarRender(a); } catch (e) { sendJson(res, 404, { error: `graph "${a}" not available: ${e.message}` }); return true; }
  try { gb = await sidecarRender(b); } catch (e) { sendJson(res, 404, { error: `graph "${b}" not available: ${e.message}` }); return true; }
  try { sendJson(res, 200, diffGraphs(ga, gb)); }
  catch (e) { sendJson(res, 500, { error: `diff failed: ${e.message}` }); return true; }
  return true;
}
```
Add the header doc line `*   GET  /graph/diff?a=&b=          -> { nodes, edges, summary } (structural diff)`.

MCP tool (after `gitnexus_graph_activations`):
```js
{
  name: 'gitnexus_graph_diff',
  description: 'Structurally diff two sidecar graphs (e.g. two model versions): added/removed nodes, retyped nodes (type/label changed), added/removed edges, and a drift count. The "as code" model-version comparison — like diffing two repo snapshots. Returns {nodes:{added,removed,changed,commonCount}, edges:{added,removed,commonCount}, summary:{drift,...}}.',
  inputSchema: { type: 'object', properties: {
    a: { type: 'string', description: 'First graph name (the "before" version).' },
    b: { type: 'string', description: 'Second graph name (the "after" version).' },
  }, required: ['a', 'b'], additionalProperties: false },
  handler: ({ a, b }) => callWeb('/graph/diff', { a, b }),
},
```

- [ ] **Step 1: Write failing tests.** MCP source-text (`mcp-server/server.test.mjs`, match style): assert `gitnexus_graph_diff` exists, requires `a`+`b`, handler calls `/graph/diff`. Integration (`tests/integration/endpoints/graph-templates.test.mjs`, sidecar-gated, mirror the model-graph block): scaffold+import the model-graph twice under two names (e.g. reuse `it-model-graph` as `a`, scaffold a second `it-model-graph-b` from the same corpus as `b`), `GET /graph/diff?a=...&b=...`, assert 200 + `body.summary.drift === 0` (same corpus → identical) + `body.nodes.commonCount === 4`. (Two imports of the same corpus = identical graphs → zero drift; that's a valid, deterministic assertion. Sidecar-gated like the others.)
- [ ] **Step 2: Run MCP test, verify the new assertion FAILS** — `node --test mcp-server/server.test.mjs`.
- [ ] **Step 3: Implement** the route + MCP tool.
- [ ] **Step 4: Run** MCP green; unit (`graph-templates graph-diff-models`) green. Integration sidecar-gated (run if reachable, else note).
- [ ] **Step 5: Commit** (controller).

---

## Self-review checklist (controller)
- Spec coverage: §3.1 diffGraphs → Task 1; §3.2 route → Task 2; §3.3 MCP → Task 2; §3.4 frontend explicitly deferred. ✓
- Type consistency: `diffGraphs` return `{nodes:{added,removed,changed,commonCount}, edges:{added,removed,commonCount}, summary}`; route path `/graph/diff?a=&b=`; MCP `gitnexus_graph_diff(a,b)` — identical across tasks. ✓
- No new route module / no Dockerfile.web change (route in existing handler; pure fn in already-COPY'd `-core`). No frontend change → no web build. ✓
- Additive: a brand-new route + tool; touches no existing behavior. ✓

## Post-build (controller)
1. Regen patches + drift → exit 0.
2. Final review (controller direct or subagent).
3. Verify: `diffGraphs` unit + MCP green; sidecar-gated integration run if reachable (else report). No web build needed (no frontend change).
4. Commit + push `deployment`; update ROADMAP (P-IA.3 diff shipped), INVENTORY, spec Status, memory. Note in ROADMAP that the rest of P-IA.3 (communities/centrality/dead-weights/entropy on the model graph) is already available via the existing P2 + P-IA.2 endpoints — diff was the one new piece.
