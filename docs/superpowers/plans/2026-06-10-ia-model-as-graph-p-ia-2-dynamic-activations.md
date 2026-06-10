# IA/Model-as-graph P-IA.2 (dynamic) — activation overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Overlay a captured inference run's per-node activation magnitudes (+ optional per-edge frequencies) onto a model graph as a heat map — a `model-activations.json` contract, a pure shaper, a `GET /graph/activations/:name` read route, an MCP tool, and a frontend "Activations" overlay. Producer (instrumented runtime) deferred.

**Architecture:** Pure `shapeActivations` in the already-COPY'd `docker-server-graph-templates-core.mjs`; route added to the already-wired `handleGraphTemplatesRoute` (no new module, no Dockerfile.web change — like P3.4's `/graph/list`); MCP tool; adapter `opts.activationById` reusing `heatColor`; a GraphCanvas toggle. Spec: `docs/superpowers/specs/2026-06-10-ia-model-as-graph-p-ia-2-dynamic-activations-design.md`.

**Tech Stack:** Node ESM (pure), vitest (host-native), node:test (MCP), React/TS.

**Verification venue:** `cd tests && npx vitest run --config vitest.config.unit.mjs <filter>`; MCP `node --test mcp-server/server.test.mjs`; web image build (tsc) for the frontend; sidecar-gated integration.

**Patch/git discipline (controller only):** regen `patches/*.diff` + `node scripts/check-patch-drift.mjs` (exit 0) before commit. Subagents NEVER touch git/patches.

---

### Task 1: pure `shapeActivations` + capture fixture + unit tests

**Files:**
- Modify: `upstream/docker-server-graph-templates-core.mjs` (add ONE exported pure function; do not alter existing)
- Create: `tests/fixtures/model-graph/model-activations.json`
- Create: `tests/unit/model-activations.test.mjs`

Add `export function shapeActivations(doc)`:
- If `doc` is null or `doc.nodes` is not a plain object → `throw new Error('model-activations: missing nodes object')`.
- `nodes`: for each `[id, v]`, `const n = Number(v); if (Number.isFinite(n)) out.nodes[id]=n; else droppedNodes.push(id)`.
- `edges`: if `doc.edges` is an object, same coercion → `out.edges`; else `out.edges={}`.
- `min`/`max`: over `Object.values(out.nodes)` (0/0 if empty).
- Return `{ nodes, edges, report: { nodeCount: Object.keys(nodes).length, edgeCount: Object.keys(edges).length, min, max, droppedNodes, droppedEdges, model: doc.model ?? null, run: doc.run ?? null } }`.

- [ ] **Step 1: Create the fixture** `tests/fixtures/model-graph/model-activations.json` (matches the toy HMM in `tests/fixtures/model-graph/model-graph.json`; edge ids use the importer convention `${from}->${kind}->${to}`):
```json
{
  "model": "toy-hmm",
  "run": "run-001",
  "nodes": { "s0": 0.82, "s1": 0.18, "obs_up": 0.55, "obs_down": 0.45 },
  "edges": {
    "s0->transition->s0": 0.7, "s0->transition->s1": 0.3,
    "s1->transition->s1": 0.6, "s1->transition->s0": 0.4,
    "s0->emission->obs_up": 0.8, "s0->emission->obs_down": 0.2,
    "s1->emission->obs_up": 0.3, "s1->emission->obs_down": 0.7
  }
}
```

- [ ] **Step 2: Write failing test** `tests/unit/model-activations.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shapeActivations } from '../../upstream/docker-server-graph-templates-core.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/model-graph/model-activations.json');

describe('shapeActivations', () => {
  it('shapes a valid capture into {nodes,edges,report}', () => {
    const doc = JSON.parse(readFileSync(FIX, 'utf8'));
    const a = shapeActivations(doc);
    expect(a.nodes.s0).toBeCloseTo(0.82, 9);
    expect(a.edges['s0->emission->obs_up']).toBeCloseTo(0.8, 9);
    expect(a.report.nodeCount).toBe(4);
    expect(a.report.edgeCount).toBe(8);
    expect(a.report.max).toBeCloseTo(0.82, 9);
    expect(a.report.min).toBeCloseTo(0.18, 9);
    expect(a.report.model).toBe('toy-hmm');
    expect(a.report.run).toBe('run-001');
  });
  it('drops non-finite node values and records them', () => {
    const a = shapeActivations({ nodes: { a: 1, b: 'nope', c: null } });
    expect(a.nodes).toEqual({ a: 1 });
    expect(a.report.droppedNodes).toEqual(expect.arrayContaining(['b', 'c']));
  });
  it('defaults edges to {} when absent', () => {
    const a = shapeActivations({ nodes: { a: 0.5 } });
    expect(a.edges).toEqual({});
    expect(a.report.edgeCount).toBe(0);
  });
  it('empty nodes → min/max 0', () => {
    const a = shapeActivations({ nodes: {} });
    expect(a.report.min).toBe(0); expect(a.report.max).toBe(0);
  });
  it('throws on a malformed capture (no nodes object)', () => {
    expect(() => shapeActivations({})).toThrow(/nodes/);
    expect(() => shapeActivations(null)).toThrow();
  });
});
```

- [ ] **Step 3: Run, verify FAIL** — `cd tests && npx vitest run --config vitest.config.unit.mjs model-activations`.
- [ ] **Step 4: Implement** `shapeActivations` in `docker-server-graph-templates-core.mjs`.
- [ ] **Step 5: Run, verify PASS.**
- [ ] **Step 6: Commit** (controller).

---

### Task 2: `GET /graph/activations/:name` route + MCP tool

**Files:**
- Modify: `upstream/docker-server-graph-templates.mjs` (add the route to `handleGraphTemplatesRoute`; import `shapeActivations` from `-core`)
- Modify: `mcp-server/server.mjs` (add `gitnexus_graph_activations`)
- Modify: `mcp-server/server.test.mjs` (source-text assertion)
- Modify: `tests/integration/endpoints/graph-templates.test.mjs` (sidecar-gated round-trip)

Route (add to `handleGraphTemplatesRoute`, before the final `return false`, after the `/graph/research/` block): read FIRST, then implement.
```js
if (path.startsWith('/graph/activations/') && req.method === 'GET') {
  const name = decodeURIComponent(path.slice('/graph/activations/'.length));
  const index = await readIndex();
  const record = index.graphs.find((g) => g.name === name);
  if (!record) { sendJson(res, 404, { error: `no scaffolded graph named "${name}"` }); return true; }
  let abs; try { abs = sanitizeSource(record.source); } catch (e) { sendJson(res, 400, { error: e.message }); return true; }
  const run = url.searchParams.get('run');
  const file = run ? `model-activations.${run}.json` : 'model-activations.json';
  let raw;
  try { raw = await readFile(join(abs, file), 'utf8'); }
  catch { sendJson(res, 404, { error: `no activations capture for "${name}"` }); return true; }
  try { sendJson(res, 200, shapeActivations(JSON.parse(raw))); }
  catch (e) { sendJson(res, 400, { error: `bad activations capture: ${e.message}` }); return true; }
  return true;
}
```
Add the imports at the top of the file: `import { readFile } from 'node:fs/promises'; import { join } from 'node:path';` (check if already imported — the file may already import `readBody` only; add what's missing), and add `shapeActivations` to the existing import from `./docker-server-graph-templates-core.mjs`.

MCP tool (after `gitnexus_list_graphs`):
```js
{
  name: 'gitnexus_graph_activations',
  description: 'Read a captured inference-run activation overlay for a model graph (per-node activation magnitude + optional per-edge frequency, from model-activations.json in the graph source dir). Surfaces hot nodes/paths of a model. Returns {nodes:{id→magnitude}, edges:{id→freq}, report:{min,max,...}}.',
  inputSchema: { type: 'object', properties: {
    name: { type: 'string', description: 'Model graph name (as scaffolded).' },
    run: { type: 'string', description: 'Optional run id → reads model-activations.<run>.json.' },
  }, required: ['name'], additionalProperties: false },
  handler: ({ name, run }) => callWeb(`/graph/activations/${encodeURIComponent(name)}`, run ? { run } : {}),
},
```

- [ ] **Step 1: Write failing tests.** MCP source-text (`mcp-server/server.test.mjs`, match file style): assert a tool named `gitnexus_graph_activations` exists, requires `name`, and the handler calls `/graph/activations/`. Integration (`tests/integration/endpoints/graph-templates.test.mjs`, sidecar-gated, mirror the model-graph block): the `model-graph-corpus` source already ships a `model-graph.json` (from P-IA.1) — add a `model-activations.json` to that corpus in `tests/fixtures/make-fixture.mjs` (mirror the model-graph-corpus step) and re-pack; then scaffold model-graph (or reuse the existing `it-model-graph`), `GET /graph/activations/<name>`, assert `200` + `nodes.s0` present + `report.max` finite. (If reusing the existing scaffold, sequence after it.)
- [ ] **Step 2: Run MCP test, verify the new assertion FAILS** — `node --test mcp-server/server.test.mjs`.
- [ ] **Step 3: Implement** the route + MCP tool + the fixture/make-fixture activation file.
- [ ] **Step 4: Run** MCP test green; unit suites (`graph-templates model-activations`) green. Integration is sidecar-gated (run if reachable, else note).
- [ ] **Step 5: Commit** (controller).

---

### Task 3: frontend activation heat overlay

**Files:**
- Modify: `upstream/gitnexus-web/src/lib/research-graph-adapter.ts` (add `activationById`/`activationMax` to `opts`)
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx` ("Activations" toggle + fetch + wire)
- Modify: `upstream/gitnexus-web/src/services/research-client.ts` (add `getActivations`)

Adapter: extend the `opts` type with `activationById?: Map<string, number>` and `activationMax?: number`. In the node loop, AFTER the dead-node block, add: if `activationById?.has(node.id)` (and not `dimmed`), `const mag = activationById.get(node.id)!; color = heatColor(activationMax ? mag / activationMax : 0); size = 4 + 16 * Math.sqrt(activationMax ? mag / activationMax : 0);` (reuse the SAME `heatColor` already imported + the same size formula as the metric heatmap). Additive: absent `activationById`, unchanged. Activation color takes precedence over community/metric/dead color when present (but respects `dimmed`).

client (`research-client.ts`), mirror `getResearchGraph`:
```ts
export interface GraphActivations { nodes: Record<string, number>; edges: Record<string, number>; report: { min: number; max: number; nodeCount: number; edgeCount: number; model: string | null; run: string | null } }
export async function getActivations(name: string): Promise<GraphActivations> {
  return jsonOrThrow(await fetch(`/graph/activations/${encodeURIComponent(name)}`));
}
```

GraphCanvas: add `activationsOn` state; an "Activations" toggle gated like the existing research/lens overlay controls (`metricsOn && (researchName || (lensId && lensRepo)) && view !== 'matrix'`). When toggled on, `getActivations(researchName)` (guard: only for research graphs, not lenses, in v1 — or attempt + ignore 404), build `activationById = new Map(Object.entries(res.nodes))` + `activationMax = res.report.max`, pass via the adapter `opts`; add `activationsOn` to the render-effect deps + the cacheKey. A small heat legend + the run/model label when present. Handle the 404 (no capture) gracefully — disable/grey the toggle or show "no capture".

- [ ] **Step 1: Adapter test (best-effort)** — add to `research-graph-adapter.test.mjs` a case: `activationById: new Map([['x', 5]])`, `activationMax: 10` → node x color === `heatColor(0.5)`. IF the file is already red in the unit runner (graphology resolution — known), SKIP + note (rely on web build), as with the dead-node test.
- [ ] **Step 2: Run (if feasible), verify.**
- [ ] **Step 3: Implement** adapter opts + client helper + GraphCanvas toggle/fetch/wire.
- [ ] **Step 4: Verify** — adapter test (if feasible); the web image build (tsc) is the binding gate — controller runs `docker compose -f docker-compose.test.yml build gitnexus-web-test` (expect exit 0).
- [ ] **Step 5: Commit** (controller).

---

## Self-review checklist (controller)
- Spec coverage: §3.1 contract → fixture; §3.2 shapeActivations → Task 1; §3.3 route → Task 2; §3.4 MCP → Task 2; §3.5 frontend → Task 3. ✓
- Type consistency: `shapeActivations` return `{nodes,edges,report}`; route path `/graph/activations/:name`; adapter `activationById`/`activationMax`; `getActivations` — identical across tasks. ✓
- No new route module / no Dockerfile.web change (route in the already-wired handler; pure fn in already-COPY'd `-core`). ✓
- Additive: absent the toggle/param, every layer is byte-identical. ✓

## Post-build (controller)
1. Regen patches + drift → exit 0.
2. Final review (controller direct or subagent).
3. Verify: unit (shapeActivations + MCP) green; web image build (tsc) green; sidecar-gated integration run if reachable (else report); best-effort browser-QA (don't disrupt the dev stack).
4. Commit + push `deployment`; update ROADMAP (P-IA.2 dynamic shipped → observability tier complete), INVENTORY, spec Status, memory.
