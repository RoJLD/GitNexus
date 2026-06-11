# IA / Model-as-graph — ONNX → model-graph converter

**Date**: 2026-06-10
**Status**: current
**Parent vision**: `2026-06-03-ia-model-as-graph-vision-design.md` (P-IA.1 "Neural —
portable: onnx — the flagship target"). **Builds on**: P-IA.1 model-graph import (the
`model-graph` template already imports a `model-graph.json`; ONNX support = a *converter*
that produces one — no new gitnexus importer). **Sibling**: the hmm_studio emitter
(`model-graph export`, the structured-model producer) — this is the neural producer.

## 1. Context / problem

The vision's flagship neural target is **ONNX** (a standard, language-agnostic compute
graph: ops/layers as nodes, tensors as edges). Importing it should cost "one importer"
on the SDK. But ONNX is **protobuf** — parsing it in gitnexus's zero-dep Node importers is
impractical, and a real ONNX model is **10⁴–10⁶ nodes** (the scale/LoD story the vision
flags as the gating open question).

Two realizations make a clean, verifiable v1 possible **without** a new gitnexus importer
or a heavy dep in the served code:
1. **P-IA.1 already imports `model-graph.json`** — so ONNX support is just a *converter*
   `onnx → model-graph.json`, then the existing `model-graph` template imports it.
2. The protobuf dependency can be **isolated to a one-line offline pre-step** (Python
   `onnx` is the standard, mature loader): dump the ONNX graph to JSON once
   (`MessageToDict`), then a pure **Node** transform maps that JSON → `model-graph.json`.
   The Node transform is host-native testable (vitest) with a synthetic ONNX-graph JSON —
   the onnx package is needed only for the trivial dump, never for the tested core.

This mirrors how the **academic** template handles PDFs (an offline `tools/academic-extract`
host-only/hors-CI extractor produces the JSON the importer reads).

## 2. Goal

A model-defined-in-ONNX becomes a model graph in gitnexus: `tools/onnx-to-model-graph.mjs`
converts an ONNX-graph JSON (the `onnx.load(...).graph` dumped via `MessageToDict`) into a
`model-graph.json` (ops as nodes, tensor-flow as edges); the existing `model-graph`
template imports it; it renders + is queryable by P2/P3/diff. Success: a synthetic
3-op ONNX-graph JSON (Conv→Relu→Gemm) converts to a model-graph with 3 op nodes + 2
tensor-flow edges; a real (small) ONNX model round-trips via the documented pre-step.

## 3. Design

### 3.1 The offline pre-step (onnx → onnx-graph JSON) — documented, not built

ONNX's protobuf is decoded once with the standard Python `onnx` package (offline,
hors-CI — like `tools/academic-extract`). Documented one-liner (in the tool's `--help` +
a README note):
```bash
python -c "import onnx,json,sys; from google.protobuf.json_format import MessageToDict; \
  json.dump(MessageToDict(onnx.load(sys.argv[1]).graph), open(sys.argv[2],'w'))" model.onnx onnx-graph.json
```
This yields `{ node:[{opType,name,input:[t],output:[t]}], input:[{name}], output:[{name}],
initializer:[{name}] }` (protobuf→camelCase). gitnexus owns only the consumer of this JSON.

### 3.2 The pure transform — `onnxGraphToModelGraph(onnxGraph, {name})` (Node, tested)

In `tools/onnx-to-model-graph.mjs` (a tracked top-level tool, like `tools/academic-extract.mjs`
— NOT in `upstream/`, NOT in the docker image; zero runtime dep). Exported pure function +
a CLI guarded by `import.meta.url`:

- **Nodes** = ops: for each `onnxGraph.node[i]`, `{ id: opId, type: 'op', label: node.opType }`
  where `opId = node.name || `${node.opType}#${i}`` (ONNX node names are often empty →
  index fallback; ids are deduped, a `#i` suffix added on collision).
- **Edges** = tensor flow: build `producer = Map(tensorName → opId)` from every op's
  `output[]`. Then for each op B and each input tensor `T` of B, if `producer.has(T)` and
  `producer.get(T) !== B`, emit `{ from: producer.get(T), to: opId(B), kind: 'tensor',
  label: T }` (dedup by `from␟to␟T`). Tensors that are graph inputs / initializers
  (weights) are produced by no op → no edge in v1 (they're model inputs/params, not
  op→op flow). 
- **Return** `{ model: { name: name || onnxGraph.name || 'onnx-model', framework: 'onnx',
  version: null }, nodes, edges }` — the exact `model-graph.json` shape P-IA.1 imports
  (type `'op'` is already in the template's `visual.nodeColors`; `kind: 'tensor'` is a
  free-text edge kind the importer accepts).
- Handles an empty/`node`-less graph (→ empty nodes/edges, no throw).

The CLI (`node tools/onnx-to-model-graph.mjs <onnx-graph.json> <out/model-graph.json> [name]`):
read the JSON, call the transform, write the model-graph.json. Then the user
`gitnexus_create_graph_from_template model-graph` + import (P-IA.1) over that source dir.

### 3.3 Scale / LoD (the gating caveat — honestly bounded)

A real ONNX model can be 10⁴–10⁶ ops. gitnexus's metrics already node-cap at 2000
(`computeMetricsCapped`, `?approx=`); render LoD (op-group collapsing, sampling) for huge
graphs is **deferred** (the vision's open question, not solved here). v1 converts the full
graph; on large models the metrics cap + the P3 views apply, and the converter `log`s the
node/edge count so a too-large conversion is visible (no silent truncation). A
`--max-nodes` guard that errors (rather than silently truncating) above a threshold is
included so a 10⁶-node accident fails loudly. Genuine large-model legibility is the
deferred LoD follow-up.

## 4. Verification

- **Unit (host-native vitest)** — `tools/onnx-to-model-graph.test.mjs` (importing the pure
  `onnxGraphToModelGraph` from the tool): a synthetic 3-op chain (Conv `out:t1` → Relu
  `in:t1,out:t2` → Gemm `in:t2,out:t3`) → 3 op nodes (type='op', labels Conv/Relu/Gemm),
  2 tensor edges (Conv→Relu via t1, Relu→Gemm via t2), `framework='onnx'`; nameless nodes
  get `${opType}#i` ids; a tensor with no producer (graph input) yields no edge; empty
  graph → empty; `--max-nodes` exceeded → throws.
- **JSON-serializable** + shape matches the P-IA.1 `model-graph.json` contract (so the
  existing `model-graph` template imports it — the import path itself is already tested by
  P-IA.1's importer + integration tests; no new importer to test).
- The Python pre-step is **documented, not run** (offline, needs `pip install onnx`; like
  academic-extract, hors-CI).
- No `upstream/` change → no patch regen, no Dockerfile, no web build. `tools/` is tracked
  → direct commit.

## 5. Scope boundaries

**In scope**: the pure `onnxGraphToModelGraph` transform + the `tools/onnx-to-model-graph.mjs`
CLI + a unit test + the documented onnx→json pre-step. Reuses the P-IA.1 `model-graph`
template for import (zero new importer).

**Out of scope (deferred)**:
- **A bundled ONNX protobuf parser** in gitnexus (the one-line Python pre-step owns it; a
  Node `onnx-proto` dep is avoided).
- **Render LoD / op-group collapsing / sampling** for 10⁴–10⁶-node models — the vision's
  gating open question; the metrics cap + a loud `--max-nodes` guard bound it for now.
- **Initializer (weight) + graph-IO nodes** — v1 is the op compute-DAG; weights as
  `param-group` nodes + input/output nodes are a thin follow-up.
- **pytorch-fx** importer (the other neural producer) — separate, same converter pattern.
- **Tensor shape/dtype on edges** — needs the render-prop passthrough to surface; the edge
  `label` carries the tensor name for v1.

## 6. Open questions

- **Op grouping for legibility.** Real models repeat op blocks (a transformer layer ×N).
  Collapsing repeated subgraphs into `layer`/`param-group` super-nodes is the LoD story;
  it likely keys off ONNX node-name prefixes or graph structure — settle when a real model
  is run and the flat op graph proves too large.
- **Multiple ONNX graphs / subgraphs** (control-flow ops with nested graphs: If/Loop/Scan
  carry sub-`GraphProto`s). v1 converts the top-level graph; nested subgraphs are flattened
  away (their ops omitted). Revisit if control-flow-heavy models matter.
