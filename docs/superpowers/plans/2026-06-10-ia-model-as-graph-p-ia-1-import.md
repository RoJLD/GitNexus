# IA/Model-as-graph P-IA.1 — model-graph import template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `model-graph` SDK import template + `model-graph-json` importer so a curated `model-graph.json` (states/observations/ops as nodes, transitions/emissions/tensors as edges) imports into a dedicated Kùzu schema and renders on the existing canvas, queryable by the P2/P3 toolkit.

**Architecture:** One new importer file + a registry entry + an IMPORTERS-map wire + synthetic fixtures + tests, following the `research-graph` import template EXACTLY. Sidecar (`graphs-sidecar/`), routes, and MCP are template-driven/schema-agnostic and need NO change. Spec: `docs/superpowers/specs/2026-06-10-ia-model-as-graph-p-ia-1-import-design.md`.

**Tech Stack:** Node ESM (pure), vitest (host-native unit), the existing sidecar-gated integration harness.

**Verification venue:** host-native vitest — `cd tests && npx vitest run --config vitest.config.unit.mjs <filter>`. Integration is sidecar-gated (same as the academic-literature integration test).

**Patch/git discipline (controller only):** after all tasks, regenerate `patches/*.diff` from `upstream/` + `node scripts/check-patch-drift.mjs` (exit 0) before commit. Subagents NEVER touch git/patches.

---

### Task 1: `model-graph-json` importer + fixtures + unit tests

**Files:**
- Create: `upstream/docker-server-model-graph-importer.mjs`
- Create: `tests/fixtures/model-graph/model-graph.json`
- Create: `tests/fixtures/model-graph-bad/model-graph.json`
- Create: `tests/unit/model-graph-importer.test.mjs`

The importer is structurally a copy of `upstream/docker-server-research-graph-importer.mjs` (read it first as the template). Differences: reads `model-graph.json`; node props are `{id, type, label, layer}` (require `id` + `type`); edge props are `{id, kind, weight}` (read `e.kind ?? e.type`; `weight` coerced to finite number, default 1.0); tables `ModelNode`/`ModelEdge`; edge id `${from}->${kind}->${to}`; `byType` over node `type`, `byKind` over edge `kind`; carry `doc.model` into `report.model`.

- [ ] **Step 1: Create the valid fixture** `tests/fixtures/model-graph/model-graph.json`:

```json
{
  "model": { "name": "toy-hmm", "framework": "hmm", "version": "1.0" },
  "nodes": [
    { "id": "s0", "type": "state", "label": "Bull", "layer": "" },
    { "id": "s1", "type": "state", "label": "Bear", "layer": "" },
    { "id": "obs_up", "type": "observation", "label": "Up" },
    { "id": "obs_down", "type": "observation", "label": "Down" }
  ],
  "edges": [
    { "from": "s0", "to": "s0", "kind": "transition", "weight": 0.7 },
    { "from": "s0", "to": "s1", "kind": "transition", "weight": 0.3 },
    { "from": "s1", "to": "s1", "kind": "transition", "weight": 0.6 },
    { "from": "s1", "to": "s0", "kind": "transition", "weight": 0.4 },
    { "from": "s0", "to": "obs_up", "kind": "emission", "weight": 0.8 },
    { "from": "s0", "to": "obs_down", "kind": "emission", "weight": 0.2 },
    { "from": "s1", "to": "obs_up", "kind": "emission", "weight": 0.3 },
    { "from": "s1", "to": "obs_down", "kind": "emission", "weight": 0.7 }
  ]
}
```
(4 nodes, 8 edges. Self-loop transitions s0→s0, s1→s1 are intentional and VALID — the importer keeps them; only the metrics engine drops self-loops downstream.)

- [ ] **Step 2: Create the bad fixture** `tests/fixtures/model-graph-bad/model-graph.json`:

```json
{
  "nodes": [
    { "id": "s0", "type": "state", "label": "ok" },
    { "type": "state", "label": "no-id" }
  ],
  "edges": [
    { "from": "s0", "to": "ghost", "kind": "transition", "weight": 1.0 }
  ]
}
```
(1 valid node; 1 node missing id → skipped; 1 dangling edge to `ghost` → skipped.)

- [ ] **Step 3: Write the failing unit test** `tests/unit/model-graph-importer.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importModelGraph } from '../../upstream/docker-server-model-graph-importer.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/model-graph');

describe('importModelGraph', () => {
  it('maps a curated model graph to the generic ingest shape', async () => {
    const mg = await importModelGraph(FIX);
    expect(mg.schema_type).toBe('model-graph');
    expect(mg.template).toBe('model-graph');
    expect(mg.nodes).toHaveLength(4);
    expect(mg.edges).toHaveLength(8);
    expect(mg.nodes.every((n) => n.table === 'ModelNode')).toBe(true);
    expect(mg.edges.every((e) => e.table === 'ModelEdge')).toBe(true);
    const s0 = mg.nodes.find((n) => n.props.id === 's0');
    expect(s0.props).toMatchObject({ type: 'state', label: 'Bull', layer: '' });
    const emit = mg.edges.find((e) => e.props.kind === 'emission' && e.from === 's0' && e.to === 'obs_up');
    expect(emit.props.weight).toBeCloseTo(0.8, 9);
    expect(emit.props.id).toBe('s0->emission->obs_up');
    expect(mg.report.byType).toMatchObject({ state: 2, observation: 2 });
    expect(mg.report.byKind).toMatchObject({ transition: 4, emission: 4 });
    expect(mg.report.nodes).toBe(4);
    expect(mg.report.edges).toBe(8);
    expect(mg.report.model).toMatchObject({ name: 'toy-hmm', framework: 'hmm' });
  });

  it('defaults label→id, layer→"", weight→1.0 when omitted', async () => {
    const mg = await importModelGraph(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/model-graph-bad'));
    const s0 = mg.nodes.find((n) => n.props.id === 's0');
    expect(s0.props.label).toBe('ok');     // label present
    expect(s0.props.layer).toBe('');       // layer omitted → ''
  });

  it('skips nodes missing id or type, and drops dangling edges', async () => {
    const mg = await importModelGraph(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/model-graph-bad'));
    expect(mg.nodes).toHaveLength(1);
    expect(mg.edges).toHaveLength(0);
    expect(mg.report.skipped.some((s) => s.reason === 'missing id')).toBe(true);
    expect(mg.report.skipped.some((s) => s.reason === 'dangling edge')).toBe(true);
  });

  it('rejects with a clear error when model-graph.json is absent', async () => {
    await expect(importModelGraph('/no/such/dir')).rejects.toThrow(/cannot read model-graph.json/);
  });
});
```

- [ ] **Step 4: Run, verify FAIL** — `cd tests && npx vitest run --config vitest.config.unit.mjs model-graph-importer` (importer not found).

- [ ] **Step 5: Implement** `upstream/docker-server-model-graph-importer.mjs` modeled on the research-graph importer. Node: require `id` + non-empty `type` (skip otherwise: `{reason:'missing id'}` when no id, `{reason:'missing type'}` when no type), dedupe by id, props `{id, type:String(n.type), label:String(n.label||n.id), layer:String(n.layer||'')}`. Edge: `from`/`to` must resolve to a node (else `{reason:'dangling edge'}`), `kind=String(e.kind||e.type||'')`, `weight=Number.isFinite(+e.weight)?+e.weight:1.0`, id `${from}->${kind}->${to}`, dedupe by id. `byType` over node type, `byKind` over edge kind. Return `{schema_type:'model-graph', template:'model-graph', name:null, source:null, nodes, edges, report:{nodes, edges, byType, byKind, unresolvedLinks:[], skipped, model: doc.model ?? null}}`.

- [ ] **Step 6: Run, verify PASS** — same command, all 4 tests green.

- [ ] **Step 7: Commit** (controller).

---

### Task 2: register the template + wire the importer + registry/integration tests + node colors

**Files:**
- Modify: `upstream/docker-server-graph-templates-core.mjs` (register the template after the `research-graph` block, ~line 139)
- Modify: `upstream/docker-server-graph-templates.mjs` (import the importer + add to IMPORTERS map, ~lines 14-20)
- Modify: `tests/unit/graph-templates-registry.test.mjs` (assert model-graph registered)
- Modify: `tests/integration/endpoints/graph-templates.test.mjs` (scaffold→import→render round-trip)
- Modify (if needed): `upstream/gitnexus-web/src/lib/research-colors.ts` (node-type colors for model kinds)

- [ ] **Step 1: Register the template** in `docker-server-graph-templates-core.mjs` after the research-graph `registerTemplate(...)` block:

```js
registerTemplate({
  id: 'model-graph',
  kind: 'import',
  label: 'Model Graph',
  schema_type: 'model-graph',
  description: 'A trained model as a graph (HMM states/transitions/emissions; later ONNX/PyTorch ops/tensors), imported from a curated model-graph.json emit. The first slice of the IA/Model-as-graph vision — renders on the canvas, queryable by the P2 graph-theory toolkit + P3 views.',
  importer: 'model-graph-json',
  include: ['model-graph.json'],
  exclude: [],
  ddl: [
    'CREATE NODE TABLE ModelNode(id STRING, type STRING, label STRING, layer STRING, PRIMARY KEY(id))',
    'CREATE REL TABLE ModelEdge(FROM ModelNode TO ModelNode, id STRING, kind STRING, weight DOUBLE)',
  ],
  visual: { nodeColors: {
    state: '#60a5fa', observation: '#f59e0b', op: '#34d399', layer: '#a78bfa', 'param-group': '#f472b6',
  } },
});
```

- [ ] **Step 2: Wire the importer** in `docker-server-graph-templates.mjs`: add `import { importModelGraph } from './docker-server-model-graph-importer.mjs';` near the other importer imports, and add `'model-graph-json': importModelGraph` to the `IMPORTERS` map.

- [ ] **Step 3: Write failing registry test** — append to `tests/unit/graph-templates-registry.test.mjs` (read the file first to match its import + helper style):

```js
it('registers the model-graph import template with a valid two-table DDL', () => {
  const t = getTemplate('model-graph');   // use whatever accessor the file already uses
  expect(t).toBeTruthy();
  expect(t.kind).toBe('import');
  expect(t.schema_type).toBe('model-graph');
  expect(t.importer).toBe('model-graph-json');
  expect(t.ddl.some((d) => /CREATE NODE TABLE ModelNode\(.*type STRING/.test(d))).toBe(true);
  expect(t.ddl.some((d) => /CREATE REL TABLE ModelEdge\(.*kind STRING.*weight DOUBLE/.test(d))).toBe(true);
});
```
(Adapt the accessor — the file may list templates via `GET /graph/templates` shape or a `registry` export. Match the existing tests in that file.)

- [ ] **Step 4: Run unit tests, verify the registry test passes** (it should pass once Step 1 is done): `cd tests && npx vitest run --config vitest.config.unit.mjs graph-templates-registry model-graph-importer`.

- [ ] **Step 5: Add the integration round-trip** in `tests/integration/endpoints/graph-templates.test.mjs` (read it first; mirror the academic-literature scaffold→import→render block). Use a temp source dir containing the synthetic `model-graph.json`, scaffold `{templateId:'model-graph', name:'<tmp>', source:'<tmp>'}`, import, assert `report.nodes===4 && report.edges===8`, render and assert nodes include a `state` type and edges include `transition`/`emission` kinds. This test is sidecar-gated like the others (skips when the sidecar isn't up).

- [ ] **Step 6: Node colors (only if the frontend doesn't already color arbitrary types).** Read `upstream/gitnexus-web/src/lib/research-colors.ts` and how `research-graph-adapter.ts` colors research nodes by `type`. If there's a static per-type color map that wouldn't cover `state`/`observation`/`op`/`layer`, add those entries (reuse the same hexes as the template `visual.nodeColors`). If the adapter already falls back to a palette keyed on arbitrary `type` strings (so model kinds get distinct colors automatically), make NO change and note it. If you touch any `.ts`, the web image build (tsc) must stay green — run it or note it's needed.

- [ ] **Step 7: Run the unit suites green** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-templates model-graph`. Integration is sidecar-gated (run if the sidecar is available; otherwise note it).

- [ ] **Step 8: Commit** (controller).

---

## Self-review checklist (controller, before final review)

- Spec coverage: §3.1 schema → Task 2 DDL; §3.2 contract → fixtures; §3.3 importer → Task 1; §3.4 registry/IMPORTERS → Task 2; §3.5 colors → Task 2 step 6; §3.6 verification → unit + registry + integration. ✓
- Type consistency: `ModelNode`/`ModelEdge`, node props `{id,type,label,layer}`, edge props `{id,kind,weight}`, edge id `${from}->${kind}->${to}` — identical across importer, fixtures, tests, DDL. ✓
- No placeholders: fixtures + test code + DDL + registry block are all concrete. ✓
- Zero new architecture: no sidecar/route/MCP change (template-driven). ✓

## Post-build (controller)

1. Regenerate patches + drift check → exit 0.
2. Final whole-diff review (subagent).
3. Verify: importer round-trips (unit green); if the sidecar is up, run the integration round-trip and report it; web build (tsc) if §3.5 touched the frontend. Report any deferral explicitly.
4. Commit + push `deployment`; update ROADMAP.md (mark P-IA.1 shipped under the IA/Model-as-graph row), INVENTORY.md (the model-graph template), the spec `Status`, and memory.
