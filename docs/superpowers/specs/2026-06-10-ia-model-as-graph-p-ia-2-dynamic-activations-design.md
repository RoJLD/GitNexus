# IA / Model-as-graph — P-IA.2 (dynamic): activation overlay

**Date**: 2026-06-10
**Status**: current
**Parent vision**: `2026-06-03-ia-model-as-graph-vision-design.md` (P-IA.2, *dynamic* tier).
**Builds on**: P-IA.1 model-graph import (the node/edge id contract) +
P-IA.2 *static* observability (the structural counterpart) + the existing overlay
machinery (`heatColor`, the metrics-overlay fetch/toggle in `GraphCanvas`, the
adapter `opts` arg). **Resolves** the vision §6 open question "capture format for
dynamic activations."

## 1. Context / problem

P-IA.2 *static* answers "which structure matters" from topology alone. The *dynamic*
tier answers "which zones actually **activate** at inference" — the one piece of the
vision that reaches **outside** gitnexus: a real inference run is instrumented to
emit per-node activation magnitudes (and per-edge transition frequencies), which the
platform overlays as a heat map on the model graph.

The vision flags this as the hardest tier ("lands last") because of the external
capture step. We keep this slice **gitnexus-internal** by splitting the concern the
same way P-IA.1 did with the emitter: this slice owns the **capture-file contract +
the read route + the heat overlay + a synthetic fixture**; the *producer* (an
instrumented runtime emitting the file) is a deferred follow-up (it may live in
hmm_studio / a tracing tool, exactly as the model-graph.json emitter does).

## 2. Goal

A model graph already on the canvas (`?research=<name>`) can be overlaid with a
captured activation run: nodes heat-colored by activation magnitude, optionally edges
weighted by transition frequency, via an "Activations" toggle. Success on the P-IA.1
toy HMM: a synthetic `model-activations.json` (per-state occupancy + per-edge
transition frequency) is read by `GET /graph/activations/:name` and rendered as a
heat overlay — the hot states/paths pop, distinct from the static structural view.

## 3. Design

### 3.1 The capture-file contract — `model-activations.json` (resolves vision §6)

A curated JSON living **alongside `model-graph.json` in the model graph's source
dir** (so it's read on demand from the source the graph already points at — no Kùzu
ingest, since activations are run-specific + ephemeral and shouldn't pollute the
persistent graph store). Keyed on **the exact node ids + edge ids the P-IA.1 importer
assigns** (edge id = `${from}->${kind}->${to}`):

```json
{
  "model": "toy-hmm",
  "run": "run-001",
  "nodes": { "s0": 0.82, "s1": 0.18, "obs_up": 0.6, "obs_down": 0.4 },
  "edges": { "s0->transition->s1": 0.3, "s0->emission->obs_up": 0.8 }
}
```

- `model`/`run`: optional metadata (echoed in the response report).
- `nodes`: id → activation magnitude (e.g. state occupancy, mean op activation).
  **Required.**
- `edges`: importer-edge-id → frequency/probability. **Optional** (a v1 capture may
  carry only node magnitudes).

This is the contract the future producer must satisfy. Resolves the vision's open
question: **per-node (and optional per-edge) magnitude JSON, keyed on the importer's
ids.**

### 3.2 Pure shaping — `shapeActivations` (in the already-COPY'd `-core`)

`shapeActivations(doc)` in `docker-server-graph-templates-core.mjs` (pure, no IO,
already COPY'd + imported → **no new module, no Dockerfile.web change**):
- Validate `doc.nodes` is an object; coerce each value to a finite number, **drop
  non-finite** entries (recorded in `report.droppedNodes`). Same for `doc.edges`
  (optional → `{}` when absent).
- Return `{ nodes:{id→mag}, edges:{id→freq}, report:{ nodeCount, edgeCount, min, max,
  droppedNodes, droppedEdges, model, run } }` where `min`/`max` are over the node
  magnitudes (for the frontend to normalize the heat scale; 0/0 when empty).
- Malformed input (no `nodes` object) → throws a clear error (→ 400/404 at the route).

### 3.3 The read route — `GET /graph/activations/:name` (in the existing handler)

Added to `handleGraphTemplatesRoute` in `docker-server-graph-templates.mjs` (the
**already-wired, already-COPY'd** handler — exactly how P3.4's `/graph/list` was
added; pure read, no Dockerfile change, no boot-crash risk):
- Look up `name` in the index (`readIndex`); 404 if unknown.
- Resolve the graph's `source` via `sanitizeSource` → abs dir; read
  `model-activations.json` there. Missing file → **404** `{error:'no activations
  capture for "<name>"'}` (a graph legitimately may have none).
- `JSON.parse` + `shapeActivations` → 200 `{ nodes, edges, report }`. Parse/shape
  error → 400.
- `?run=<id>` (optional): read `model-activations.<run>.json` instead, falling back
  to `model-activations.json`. (Multi-run support; v1 mainly uses the default file.)

### 3.4 MCP — `gitnexus_graph_activations`

A zero-dep tool wrapping `callWeb('/graph/activations/'+name, run?{run}:{})`, mirroring
`gitnexus_graph_lens_metrics`'s shape. Surfaces the activation magnitudes (hot
nodes/paths) to an agent. Source-text test like the others.

### 3.5 Frontend — activation heat overlay

The model graph renders through `?research=<name>` (the `research-graph-adapter` →
`GraphCanvas` path). Add:
- **Adapter** (`research-graph-adapter.ts`): a new `opts.activationById?:
  Map<string, number>` + `opts.activationMax?: number`. When provided AND the
  activation overlay is active, a node's `color = heatColor(mag / activationMax)` and
  `size` scales with the magnitude — reusing the **existing `heatColor`** (the same
  function the metrics heatmap uses). Additive: absent `activationById`, behavior is
  byte-identical. Activation coloring takes precedence over community/metric color
  when on (but respects `dimmed`, like the dead-node highlight).
- **GraphCanvas** (`GraphCanvas.tsx`): an "Activations" toggle (gated like the other
  research/lens overlay controls). When on, fetch `/graph/activations/<name>`, build
  `activationById` + `activationMax` from the response, pass them via the adapter
  `opts`; show a small heat legend. The activation overlay is **mutually informative
  with** (not mutually exclusive of) the static observability toggle — but for v1 the
  activation color simply takes precedence when its toggle is on.
- **client** (`graph-theory-client.ts` or the research client): a `getActivations(name)`
  fetch helper + the response type.

### 3.6 Verification posture

- **Unit (host-native vitest)** — primary gate:
  - `shapeActivations`: a valid capture → correct `{nodes,edges}` + `report`
    counts/min/max; non-finite values dropped (recorded); missing `edges` → `{}`;
    malformed (`nodes` not an object) → throws.
  - Fixture `tests/fixtures/model-graph/model-activations.json` for the toy HMM.
  - Frontend adapter activation-color path: unit-test IF the runner resolves
    graphology (known limitation — skip + rely on the web build if not, like the
    dead-node test).
- **Route/integration**: a sidecar-gated round-trip (scaffold model-graph → write a
  capture in the source → `GET /graph/activations/:name` → assert magnitudes) added to
  the graph-templates integration test; the unit-level route assertion (404 on unknown
  graph / missing file) where feasible without the sidecar.
- **MCP**: source-text test for the new tool.
- **Web image build (tsc)** gates the `.ts`/`.tsx` overlay.
- Drift green; patches regenerated by the controller. Live browser-QA best-effort
  (dev-stack port hold may block the test stack — reported, not silently claimed).

## 4. Scope boundaries

**In scope**: the `model-activations.json` contract, `shapeActivations`, the
`/graph/activations/:name` read route (+ `?run=`), the MCP tool, and the frontend
activation heat overlay; a synthetic capture fixture + tests.

**Out of scope (deferred)**:
- **The producer** — instrumenting a real inference run to emit
  `model-activations.json` (lives in hmm_studio / a tracing tool; cross-repo
  follow-up, exactly as the model-graph.json emitter is).
- **Edge-frequency width rendering** beyond carrying the data — v1 heat-colors nodes;
  applying edge widths from `edges` frequency is a thin follow-up if the node overlay
  proves useful.
- **Time-series / multi-step playback** of activations across inference steps — the
  contract is a single aggregate snapshot per run; temporal playback is a later idea.
- **Ingesting activations into Kùzu** — they're run-specific + ephemeral; read on
  demand from the source dir.
- **onnx-scale activation capture** (10⁴–10⁶ nodes) — gated on the same LoD story as
  the onnx importer.

## 5. Open questions

- **Aggregate vs per-step.** v1 is a single aggregate snapshot (`nodes:{id→mag}`).
  Per-inference-step playback (an array of snapshots) is a natural extension; settle
  when a real producer exists and we know what it can cheaply emit.
- **Normalization.** The frontend normalizes by `max` magnitude for `heatColor`. If
  captures arrive pre-normalized (0–1) vs raw counts, the `min/max` in the report lets
  the UI choose; revisit if a producer emits an explicit scale.
