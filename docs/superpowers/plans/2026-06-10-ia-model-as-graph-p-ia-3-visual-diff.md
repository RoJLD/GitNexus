# P-IA.3 visual diff view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A canvas diff view for model/research graphs — pick a graph B, render the union of A and B colored by status (added/removed/changed/common), reusing the `/graph/diff` backend + the snapshot color convention. Spec: `docs/superpowers/specs/2026-06-10-ia-model-as-graph-p-ia-3-visual-diff-design.md`.

**Architecture:** Pure graphology-free helpers in `gitnexus-web/src/lib/graph-diff-view.ts` (host-testable, like `metrics-view.ts`); adapter `opts.diffStatusById` colors nodes; GraphCanvas "Compare" picker fetches diff + B render → union render. No backend change.

**Tech Stack:** React/TS, vitest (host-native for the pure lib). tsc via the web image build is the binding gate.

**Verification venue:** `cd tests && npx vitest run --config vitest.config.unit.mjs graph-diff-view`; web image build (tsc).

**Patch/git discipline (controller only):** `gitnexus-web/src` is in the patch surface → regen `patches/*.diff` + drift after the changes. Subagents NEVER touch git/patches.

---

### Task 1: pure `graph-diff-view.ts` + unit tests

**Files:**
- Create: `upstream/gitnexus-web/src/lib/graph-diff-view.ts`
- Create: `tests/unit/graph-diff-view.test.mjs`

`graph-diff-view.ts` (NO graphology import — keeps it host-testable, like `metrics-view.ts`). Read `metrics-view.ts` first for the export/style convention.
```ts
export const DIFF_VIEW_COLORS = { added: '#10b981', removed: '#ef4444', changed: '#f59e0b', common: '#4b5563' } as const;
export type DiffStatus = keyof typeof DIFF_VIEW_COLORS;

export interface GraphDiffResponse {
  nodes: { added: string[]; removed: string[]; changed: { id: string }[]; commonCount: number };
  edges: { added: string[]; removed: string[]; changed?: { key: string }[]; commonCount: number };
  summary: Record<string, number>;
}

export function buildDiffStatus(diff: GraphDiffResponse): Map<string, DiffStatus> {
  const m = new Map<string, DiffStatus>();
  for (const id of diff.nodes.changed.map((c) => c.id)) m.set(id, 'changed');
  for (const id of diff.nodes.added) m.set(id, 'added');     // added/removed take precedence over changed
  for (const id of diff.nodes.removed) m.set(id, 'removed');
  return m;
}

// ResearchGraph = { nodes: {id,type?,label?,path?}[], edges: {source,target,kind?,id?}[] }
export function unionResearchGraphs(a, b) {
  const nodes = []; const seen = new Set();
  for (const n of [...(a?.nodes ?? []), ...(b?.nodes ?? [])]) { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } }
  const edges = []; const seenE = new Set();
  const key = (e) => `${e.source}|${e.kind ?? ''}|${e.target}`;
  for (const e of [...(a?.edges ?? []), ...(b?.edges ?? [])]) { const k = key(e); if (!seenE.has(k)) { seenE.add(k); edges.push(e); } }
  return { nodes, edges };
}
```
(Type the `unionResearchGraphs` params with the project's `ResearchGraph` type — import it from wherever `research-graph-adapter.ts` gets it; if awkward, use a local minimal interface. Keep it graphology-free.)

- [ ] **Step 1: Write failing test** `tests/unit/graph-diff-view.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { buildDiffStatus, unionResearchGraphs, DIFF_VIEW_COLORS } from '../../upstream/gitnexus-web/src/lib/graph-diff-view.ts';

describe('buildDiffStatus', () => {
  it('maps added/removed/changed to status with added/removed precedence over changed', () => {
    const m = buildDiffStatus({ nodes: { added: ['s2'], removed: ['s9'], changed: [{ id: 'obs' }, { id: 's2' }], commonCount: 1 }, edges: { added: [], removed: [], commonCount: 0 }, summary: {} });
    expect(m.get('s2')).toBe('added');     // added wins over changed
    expect(m.get('s9')).toBe('removed');
    expect(m.get('obs')).toBe('changed');
    expect(m.has('s0')).toBe(false);       // unnamed → absent (caller defaults to common)
  });
});

describe('unionResearchGraphs', () => {
  it('dedups nodes by id (A wins) and edges by source|kind|target, appending B-only', () => {
    const a = { nodes: [{ id: 'x', label: 'A-x' }, { id: 'y' }], edges: [{ source: 'x', target: 'y', kind: 'k' }] };
    const b = { nodes: [{ id: 'x', label: 'B-x' }, { id: 'z' }], edges: [{ source: 'x', target: 'y', kind: 'k' }, { source: 'y', target: 'z', kind: 'k' }] };
    const u = unionResearchGraphs(a, b);
    expect(u.nodes.map((n) => n.id).sort()).toEqual(['x', 'y', 'z']);
    expect(u.nodes.find((n) => n.id === 'x').label).toBe('A-x');   // A wins
    expect(u.edges).toHaveLength(2);                                // x-y deduped, y-z added
  });
  it('handles empty / missing inputs', () => {
    expect(unionResearchGraphs({ nodes: [], edges: [] }, undefined).nodes).toEqual([]);
  });
});

describe('DIFF_VIEW_COLORS', () => {
  it('has the four statuses', () => {
    expect(DIFF_VIEW_COLORS).toMatchObject({ added: '#10b981', removed: '#ef4444', changed: '#f59e0b', common: '#4b5563' });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-diff-view`.
- [ ] **Step 3: Implement** `graph-diff-view.ts`.
- [ ] **Step 4: Run, verify PASS.** (If the unit runner can't resolve a type import, inline a minimal local interface to keep the file graphology/dep-free so the test runs.)
- [ ] **Step 5: Commit** (controller).

---

### Task 2: adapter `diffStatusById` + GraphCanvas Compare picker + client

**Files:**
- Modify: `upstream/gitnexus-web/src/lib/research-graph-adapter.ts` (add `diffStatusById` to `opts`)
- Modify: `upstream/gitnexus-web/src/services/research-client.ts` (add `getGraphDiff`)
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx` (Compare picker + union render + legend)

Adapter: import `{ DIFF_VIEW_COLORS }` from `../lib/graph-diff-view`. Add `diffStatusById?: Map<string, 'added'|'removed'|'changed'|'common'>` to the `opts` type + destructure. In the node loop, AFTER the activation block, BEFORE `graph.addNode`: if `diffStatusById` is provided (and not `dimmed`), `const st = diffStatusById.get(node.id) ?? 'common'; color = DIFF_VIEW_COLORS[st];` and set `{ highlighted: true, zIndex: 2 }` when `st !== 'common'`. Additive — absent the opt, unchanged.

client: 
```ts
import type { GraphDiffResponse } from '../lib/graph-diff-view';
export async function getGraphDiff(a: string, b: string): Promise<GraphDiffResponse> {
  return jsonOrThrow(await fetch(`/graph/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`));
}
```

GraphCanvas:
- State: `compareB: string | null` + `diffData` (the `{ diff, statusById, unionRg } | null`).
- A "Compare ▾" `<select>` (gated `researchName && view !== 'matrix'`), options = `listGraphs()` results minus `researchName` (reuse the existing `listGraphs` import or fetch once). Selecting a name sets `compareB`; an empty option clears it.
- An effect on `[compareB, researchName]`: when both set, `Promise.all([getGraphDiff(researchName, compareB), getResearchGraph(compareB)])` → `buildDiffStatus(diff)` + `unionResearchGraphs(currentResearchData, rgB)` → store `{ diff, statusById, unionRg }`; on error clear. When `compareB` null → clear.
- Render: when `diffData` is set, render `diffData.unionRg` (instead of the plain research data) with `opts.diffStatusById = diffData.statusById`; otherwise the normal path. Add `compareB`/`diffData` to the render-effect deps + cacheKey. Show a legend (added/removed/changed counts from `diffData.diff.summary`) + the four color swatches.
- When comparing, the diff color takes precedence (the existing metric/observability/activation opts can be passed undefined or left — diff `opts` wins via the adapter ordering).

- [ ] **Step 1: Implement** the adapter opt + client helper + GraphCanvas wiring (no separate failing test — the pure logic is Task 1; this is integration + tsc-gated). If feasible, add a `diffStatusById` color case to `research-graph-adapter.test.mjs`; else note graphology-skip.
- [ ] **Step 2: Self-review** — `compareB` reaches the fetch effect, the union render, the adapter opts, the deps, and the picker is gated; clearing B restores the normal view; absent compareB nothing changes.
- [ ] **Step 3: Controller runs the web image build (tsc)** — `docker compose -f docker-compose.test.yml build gitnexus-web-test` (expect exit 0). State this is the binding gate (tsc not installed locally).
- [ ] **Step 4: Commit** (controller).

---

## Self-review checklist (controller)
- Spec coverage: §3.1 pure helpers → Task 1; §3.2 adapter → Task 2; §3.3 GraphCanvas + client → Task 2. ✓
- Type consistency: `buildDiffStatus`/`unionResearchGraphs`/`DIFF_VIEW_COLORS`/`diffStatusById`/`getGraphDiff`/`GraphDiffResponse` identical across files. ✓
- Pure lib is graphology-free → host-testable (the binding correctness gate); the rest is tsc-gated. ✓
- Additive: absent `compareB`/`diffStatusById`, every layer is byte-identical. ✓

## Post-build (controller)
1. Regen patches (gitnexus-web/src is patch surface) + drift → exit 0.
2. Verify: `graph-diff-view` unit green; web image build (tsc) green.
3. Commit + push `deployment`; update ROADMAP/INVENTORY (visual diff view shipped), spec Status, memory (batch end).
