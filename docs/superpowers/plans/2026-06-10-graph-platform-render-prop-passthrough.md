# Render-prop passthrough + edge weight-delta diff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `sidecarRender` carry through arbitrary node/edge props (esp. edge `weight`) additively, and add an edge weight-delta (`changed`) bucket to `diffGraphs`. Spec: `docs/superpowers/specs/2026-06-10-graph-platform-render-prop-passthrough-design.md`.

**Architecture:** Pure `mapRenderRows` extracted to a kuzu-free `graphs-sidecar/render-map.mjs` (host-testable), used by `kuzu-store.mjs`'s `render`; `diffGraphs` extended with edge weight comparison. `graphs-sidecar/` is a TRACKED top-level dir (NOT `upstream/`) → its edits need no patch regen; only `diffGraphs` (in `upstream/`) does.

**Tech Stack:** Node ESM (pure), vitest (host-native).

**Verification venue:** `cd tests && npx vitest run --config vitest.config.unit.mjs <filter>`.

**Patch/git discipline (controller only):** regen `patches/*.diff` + `node scripts/check-patch-drift.mjs` (exit 0) for the `upstream/` change; the `graphs-sidecar/` files commit directly. Subagents NEVER touch git/patches.

---

### Task 1: extract `mapRenderRows` (pure) + sidecar passthrough + unit test

**Files:**
- Create: `graphs-sidecar/render-map.mjs`
- Modify: `graphs-sidecar/kuzu-store.mjs` (`render` delegates to `mapRenderRows`)
- Create: `tests/unit/sidecar-render-map.test.mjs`

- [ ] **Step 1: Write failing test** `tests/unit/sidecar-render-map.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { mapRenderRows } from '../../graphs-sidecar/render-map.mjs';

describe('mapRenderRows', () => {
  it('passes through extra node props + edge weight, computing id/type/label/source/target/kind', () => {
    const nrows = [{ n: { id: 's0', type: 'state', label: 'Bull', layer: 'L1' }, lbl: 'ModelNode' }];
    const erows = [{ source: 's0', target: 's1', r: { id: 's0->transition->s1', kind: 'transition', weight: 0.7 }, lbl: 'ModelEdge' }];
    const { nodes, edges } = mapRenderRows(nrows, erows);
    expect(nodes[0]).toMatchObject({ id: 's0', type: 'state', label: 'Bull', layer: 'L1', path: '', stage: '' });
    expect(edges[0]).toMatchObject({ source: 's0', target: 's1', kind: 'transition', id: 's0->transition->s1', weight: 0.7 });
  });
  it('computes type/label fallbacks (label(n), title/name/id) and edge kind/id fallbacks', () => {
    const nrows = [{ n: { id: 'x', title: 'Titled' }, lbl: 'Entity' }, { n: { id: 'y' }, lbl: 'Entity' }];
    const erows = [{ source: 'x', target: 'y', r: {}, lbl: 'Relates' }];
    const { nodes, edges } = mapRenderRows(nrows, erows);
    expect(nodes[0]).toMatchObject({ id: 'x', type: 'Entity', label: 'Titled' });   // type←label(n), label←title
    expect(nodes[1].label).toBe('y');                                                // label←id
    expect(edges[0]).toMatchObject({ source: 'x', target: 'y', kind: 'Relates', id: 'x->y' });  // kind←label(r), id←fallback
  });
  it('a row with no extra props yields exactly the legacy fields (superset, no loss)', () => {
    const { nodes } = mapRenderRows([{ n: { id: 'a', type: 't', label: 'L', path: 'p', stage: 's' }, lbl: 'X' }], []);
    expect(nodes[0]).toEqual({ id: 'a', type: 't', label: 'L', path: 'p', stage: 's' });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `cd tests && npx vitest run --config vitest.config.unit.mjs sidecar-render-map`.
- [ ] **Step 3: Implement** `graphs-sidecar/render-map.mjs` (the `mapRenderRows` from spec §3.1 — `...n`/`...r` spread then computed fields). Then in `graphs-sidecar/kuzu-store.mjs`: add `import { mapRenderRows } from './render-map.mjs';` and change `render` so after the two `cypher` calls it does `return mapRenderRows(nrows, erows);` (remove the inline `.map(...)` — preserve the two cypher query strings exactly).
- [ ] **Step 4: Run, verify PASS.** (Don't break kuzu-store: the change is purely moving the mapping into the helper.)
- [ ] **Step 5: Commit** (controller).

---

### Task 2: `diffGraphs` edge weight-delta (`changed`) bucket

**Files:**
- Modify: `upstream/docker-server-graph-templates-core.mjs` (extend `diffGraphs`)
- Modify: `tests/unit/graph-diff-models.test.mjs` (add a weight-delta case)

Change `diffGraphs`'s edge handling: build `aEdgeByKey`/`bEdgeByKey` = `Map(key → edge)` (first-wins) using the existing `edgeKey`. Keep `edges.added`/`removed`/`commonCount` exactly as today (by key membership). Add `edges.changed` = for each common key, if `aEdge.weight !== bEdge.weight` → `{ key, from: { weight: aEdge.weight ?? null }, to: { weight: bEdge.weight ?? null } }` (ordered by key). Add `summary.changedEdges = edges.changed.length` and add it to `drift`. Everything else unchanged.

- [ ] **Step 1: Add a failing test** to `tests/unit/graph-diff-models.test.mjs`:
```js
it('detects edge weight deltas as changed edges', () => {
  const a = { nodes: [{ id: 'x' }, { id: 'y' }], edges: [{ id: 'x->k->y', source: 'x', target: 'y', kind: 'k', weight: 0.3 }] };
  const b = { nodes: [{ id: 'x' }, { id: 'y' }], edges: [{ id: 'x->k->y', source: 'x', target: 'y', kind: 'k', weight: 0.5 }] };
  const d = diffGraphs(a, b);
  expect(d.edges.added).toEqual([]);
  expect(d.edges.removed).toEqual([]);
  expect(d.edges.commonCount).toBe(1);
  expect(d.edges.changed).toEqual([{ key: 'x->k->y', from: { weight: 0.3 }, to: { weight: 0.5 } }]);
  expect(d.summary.changedEdges).toBe(1);
  expect(d.summary.drift).toBe(1);
});
it('no weight change → no changed edges (and existing shape intact)', () => {
  const g = { nodes: [{ id: 'x' }, { id: 'y' }], edges: [{ id: 'e', source: 'x', target: 'y', weight: 1 }] };
  const d = diffGraphs(g, g);
  expect(d.edges.changed).toEqual([]);
  expect(d.summary.changedEdges).toBe(0);
  expect(d.summary.drift).toBe(0);
});
```

- [ ] **Step 2: Run, verify FAIL** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-diff-models` (the new cases fail; the existing 6 still pass since `edges.changed` is additive).
- [ ] **Step 3: Implement** the edge-map + weight comparison in `diffGraphs`.
- [ ] **Step 4: Run, verify PASS** (all cases, incl. the original 6). Also re-run `graph-templates-registry model-activations` (same module) for no regression.
- [ ] **Step 5: Commit** (controller).

---

## Self-review checklist (controller)
- Spec coverage: §3.1 render passthrough → Task 1; §3.2 weight-delta diff → Task 2. ✓
- Additive: render output is a superset (legacy fields explicitly set over the spread); `diffGraphs` gains `edges.changed` + `summary.changedEdges` only (existing buckets/counts unchanged). ✓
- `graphs-sidecar/` is tracked (not upstream) → no patch regen for Task 1; Task 2 (upstream) → patch regen. ✓
- No frontend change → no web build. ✓

## Post-build (controller)
1. Regen patches (for the `diffGraphs`/upstream change) + drift → exit 0.
2. Verify: `mapRenderRows` + `diffGraphs` unit green; sidecar integration gated (note). No web build.
3. Commit + push `deployment` (graphs-sidecar files commit directly alongside the upstream patch). Update ROADMAP/INVENTORY (note the passthrough enabler + the weight-delta diff; the sidecar needs a rebuild to deploy), spec Status, memory. Note the deferred consumers (activation edge-width, weighted metrics) are now unblocked.
