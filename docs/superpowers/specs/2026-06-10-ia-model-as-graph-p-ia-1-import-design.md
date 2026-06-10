# IA / Model-as-graph — P-IA.1: model-graph import template

**Date**: 2026-06-10
**Status**: current
**Parent vision**: `2026-06-03-ia-model-as-graph-vision-design.md` (this is the first
buildable slice of that vision — P-IA.1 "Import"). **SDK it rides**:
`2026-06-03-graph-platform-p0-kuzu-sidecar-design.md` + `-p1-sdk-proof-design.md`.
**Closest precedent**: the `research-graph` import template
(`2026-06-03-research-graph-import-template-design.md`) — same shape, same machinery.

## 1. Context / problem

The IA/Model-as-graph vision (now unblocked: P2 graph-theory ✓ + P3 visualization ✓)
says **a trained model is just another graph** — import it once via the SDK and it
inherits the whole platform (P2 metrics, P3 views, lenses). The vision sequences
**Import first** ("everything else overlays on this static graph, so it ships
first"), cheapest target = `hmm-export` (an HMM is *literally* a state-transition
graph — zero tracing, both ends owned).

Today there is no way to get a model onto the canvas. This slice adds the
foundational import path: a curated `model-graph.json` → a Kùzu graph → the
existing canvas, queryable by the P2 toolkit (incl. the directed metrics + SCC just
shipped) and the P3 views. It is **zero new architecture** — one more import
template + importer on the proven SDK, exactly like `research-graph`.

## 2. Goal

`POST /graph/scaffold {templateId:'model-graph'}` + `POST /graph/import` ingests a
curated `model-graph.json` into a dedicated «model graph» Kùzu schema; the graph
renders on the existing single-graph canvas (`?research=<name>`), colored by node
kind, and is immediately analyzable by `/graph/metrics/:name` (directed mode,
hierarchy, embeddings, centralities — all already shipped). Success = a synthetic
HMM fixture round-trips: scaffold → import (report counts) → render
(states + observations as nodes, transitions + emissions as edges) → metrics.

## 3. Design

### 3.1 The «model graph» schema (dedicated, generic across model classes)

A new schema, not a reuse of `Entity`/`Relates` — so model nodes get model-specific
coloring + an edge `weight` (transition/emission probability), and models stay
distinct from research artifacts. Two tables (Kùzu DDL on the template):

```sql
CREATE NODE TABLE ModelNode(id STRING, type STRING, label STRING, layer STRING, PRIMARY KEY(id))
CREATE REL  TABLE ModelEdge(FROM ModelNode TO ModelNode, id STRING, kind STRING, weight DOUBLE)
```

- **`type`** (NOT `kind`) on nodes — deliberate: the schema-agnostic sidecar
  `render` maps `type = n.type ?? label(n)`, so naming the node-kind column `type`
  gives per-kind coloring on the canvas with **zero sidecar changes** (mirrors
  `Entity.type`). Values: `state | observation | op | layer | param-group`
  (extensible; HMM uses `state` + `observation`, neural classes use `op`/`layer`).
- **`label`** — display name (render falls back `n.label ?? n.title ?? n.name ?? n.id`).
- **`layer`** — optional grouping string (HMM: unused/empty; neural: layer index or
  param-group). Nullable.
- **`ModelEdge.kind`** — `transition | emission | tensor | …` (render maps
  `kind = r.kind ?? label(r)`, mirrors `Relates.kind`).
- **`ModelEdge.weight`** — DOUBLE, the transition/emission probability (or tensor
  weight). **Stored in Kùzu; not surfaced in the render output in v0** (the sidecar
  render emits a fixed `{source,target,kind,id}` shape and stays untouched). Weight
  becomes consumable when weighted-edge metrics land (P2.3 backlog) + a render-prop
  passthrough — both deferred, noted in §4.

This single schema spans model classes per the vision's "one generic «model graph»
schema" (the unified-vs-per-class question is settled-for-now as unified; revisited
when the `onnx` importer lands, per vision §6).

### 3.2 The `model-graph.json` contract

A curated JSON the importer reads (gitnexus-side), mirroring `research-graph.json`.
The hmm_studio emitter that *produces* it from a trained model is a **follow-up**
(exactly as the Experiment.Crypto emitter for `research-graph.json` is Alten-side
follow-up — the contract + importer + a synthetic fixture ship here):

```json
{
  "model": { "name": "toy-hmm", "framework": "hmm", "version": "1.0" },
  "nodes": [
    { "id": "s0", "type": "state", "label": "Bull", "layer": "" },
    { "id": "s1", "type": "state", "label": "Bear", "layer": "" },
    { "id": "obs_up",   "type": "observation", "label": "Up" },
    { "id": "obs_down", "type": "observation", "label": "Down" }
  ],
  "edges": [
    { "from": "s0", "to": "s1", "kind": "transition", "weight": 0.3 },
    { "from": "s0", "to": "obs_up", "kind": "emission", "weight": 0.8 }
  ]
}
```

- `model` block: optional metadata (carried into the importer `report`, not a node).
- `nodes[]`: `id` (required), `type` (required), `label` (optional → defaults to
  `id`), `layer` (optional → `''`).
- `edges[]`: `from`/`to` (required, must resolve to a node id), `kind` (required),
  `weight` (optional → defaults to `1.0`).

### 3.3 The `model-graph-json` importer

`importModelGraph(absSourceDir)` in `upstream/docker-server-model-graph-importer.mjs`,
copied from the `research-graph-json` importer's structure. Reads
`<absSourceDir>/model-graph.json`, validates, emits the generic ingest shape:

```js
{
  schema_type: 'model-graph', template: 'model-graph', name: null, source: null,
  nodes: [{ table: 'ModelNode', props: { id, type, label, layer } }, …],
  edges: [{ table: 'ModelEdge', from, to, props: { id, kind, weight } }, …],
  report: { nodes, edges, byType: {state:n, observation:m, …},
            byKind: {transition:n, emission:m, …}, skipped: [...], model: {…} }
}
```

Validation (same rules as research-graph-json):
- Node missing `id` or `type` → skip, push to `report.skipped` with a reason.
- Duplicate `id` → first wins, dup recorded in `skipped`.
- Edge whose `from`/`to` is not a known node id → skip (dangling), recorded.
- Edge `id` synthesized deterministically (`${from}->${to}#${kind}` or index — match
  the research-graph-json convention exactly).
- `weight` coerced to a finite number, default `1.0`; non-finite → `1.0` + a note.

### 3.4 Registry + routes + MCP (all existing machinery, additive)

- **Register** the `model-graph` template in
  `upstream/docker-server-graph-templates-core.mjs` (after `research-graph`):
  `{ id:'model-graph', kind:'import', label:'Model Graph', schema_type:'model-graph',
     importer:'model-graph-json', include:['model-graph.json'], ddl:[…the two DDL…],
     visual:{ nodeColors:{ state:'#60a5fa', observation:'#f59e0b', op:'#34d399',
              layer:'#a78bfa', 'param-group':'#f472b6' } }, description:'…' }`.
- **Wire the importer** into the `IMPORTERS` map in
  `upstream/docker-server-graph-templates.mjs` (`'model-graph-json': importModelGraph`)
  + the import statement.
- **Routes** (`/graph/scaffold`, `/graph/import`, `/graph/research/:name`,
  `/graph/templates`) need **no change** — they're template-driven.
- **MCP** (`gitnexus_create_graph_from_template`, `_import_into_graph`,
  `_list_graph_templates`) need **no change** — template-driven; `model-graph` will
  appear in the list automatically.
- **Sidecar** (`graphs-sidecar/kuzu-store.mjs`) needs **no change** — `ingest`/`render`
  are schema-agnostic (the §3.1 `type`/`kind` naming is precisely to keep it so).

### 3.5 Frontend rendering

The graph renders through the existing single-graph canvas (`?research=<name>` →
`research-graph-adapter.ts`), which already colors by node `type`. The template's
`visual.nodeColors` supplies model-kind colors. **If** the adapter doesn't already
consume a template-supplied palette for arbitrary types, add the model node-type
colors to the existing color source (`research-colors.ts`) so `state`/`observation`/
`op`/`layer` render distinctly — a small, additive frontend touch, the only one in
this slice. No new component, no new route.

### 3.6 Verification posture

- **Unit (host-native vitest)** — primary gate, copy the `research-graph-importer`
  test pattern: valid fixture → correct nodes/edges/report counts + `byType`/`byKind`;
  missing `id`/`type` → skipped; dangling edge → skipped; missing file → error;
  duplicate id → dedup; default `weight`/`label`/`layer`.
- **Registry unit test** — `model-graph` registered, DDL well-formed (two tables,
  `type` on node / `kind`+`weight` on edge), `kind:'import'`, importer id present.
- **Integration test** (`tests/integration/endpoints/graph-templates.test.mjs`) —
  scaffold → import → render round-trip for `model-graph` using the synthetic HMM
  fixture (mirrors the academic-literature integration test). Gated on the sidecar,
  like the existing ones.
- **Fixtures**: `tests/fixtures/model-graph/model-graph.json` (a valid toy HMM:
  states + observations + transitions + emissions) + `tests/fixtures/model-graph-bad/`
  (missing id/type + a dangling edge).
- **Web image build** (tsc) only if §3.5 touches the frontend.
- Drift-check green; patches regenerated by the controller.

## 4. Scope boundaries

**In scope:** the `model-graph` schema + `model-graph.json` contract +
`model-graph-json` importer + registry/IMPORTERS wiring + synthetic HMM fixtures +
unit/registry/integration tests + minimal node-color wiring. The model graph renders
and is queryable by the already-shipped P2/P3.

**Out of scope (deferred):**
- **The hmm_studio emitter** that produces `model-graph.json` from a trained HMM
  (cross-repo follow-up; this slice owns only the gitnexus-side contract + importer +
  synthetic fixture).
- **`onnx` / `pytorch-fx` importers** (later P-IA.1 targets; settle the
  unified-vs-per-class schema question then, per vision §6).
- **Static observability** (dead-weights, hot-paths) — that's **P-IA.2**, a separate
  slice; nearly free now that directed metrics + SCC shipped, but not built here.
- **Dynamic-activations lens** (P-IA.2 dynamic — needs a capture format, vision §6).
- **Surfacing edge `weight` in the render output** + **weighted-edge metrics** —
  weight is stored in Kùzu now; consuming it is tied to the P2.3 weighted-edge
  backlog item + a sidecar render-prop passthrough.
- **Model-graph scale** (10⁴–10⁶ node NNs) — an HMM is tiny; LoD/sampling for large
  neural graphs gates the `onnx` importer (vision §6), not this slice.

## 5. Open questions

- **Edge `id` synthesis collision** — `${from}->${to}#${kind}` is unique unless two
  edges share (from,to,kind) with different weights (a multigraph). HMMs don't do
  this; if a future class does, switch to an index suffix. Match research-graph-json's
  convention to start.
- **`layer` for neural classes** — string grouping is enough for `onnx` layer
  indices; revisit if a richer hierarchy is needed (could feed `?hierarchy=1`).
  Not a blocker for the HMM v0.
