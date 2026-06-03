# IA / Model as graph & as code — Vision Design

**Date**: 2026-06-03
**Status**: vision — parked (records direction; not scheduled for build)
**Related**: `2026-06-03-graph-platform-p0-kuzu-sidecar-design.md` (Template SDK),
`2026-06-03-graph-platform-p1-sdk-proof-design.md` (SDK proven). ROADMAP.md → "Graph Platform" → the 🔭 row.

## 1. Context / problem

gitnexus turns **code** into an analyzable graph (the ASTKG) and, since P0/P1,
turns **arbitrary domains** into graphs via the Template SDK (import templates +
lenses, stored in the Kùzu sidecar, rendered through one canvas). A trained
**model is also a graph** — layers/operators/states as nodes, tensors/transitions
as edges — yet today it lives outside the platform, inspected with bespoke tools
(Netron, TensorBoard, ad-hoc scripts) that don't connect to the structural
analytics gitnexus already has.

The opportunity: once "everything is a graph in gitnexus," a model is just the
next domain. Importing it costs one importer (not a new product), and in return
the model inherits **the entire platform** — visualization (P3), graph-theory
(P2), lenses, and the existing code-analytics — applied **identically to how we
treat a codebase**. That is the "as code" half of the slogan.

This spec records the **direction** for the long-term 🔭 roadmap item. It is a
vision, not a build order: it is parked until P2 (graph-theory toolkit) and P3
(visualization paradigms) exist, since the payoff (optimization insight, legible
large graphs) depends on them.

## 2. Goal

**A trained model is a first-class graph in gitnexus, interrogated with the same
tools as a code graph.** Success = you can import a model (structured *or*
neural), see it on the canvas, run graph-theory over it (hot paths, dead weights,
module structure), overlay what actually activates at inference, and diff two
model versions — all through the existing SDK + P2/P3, with no model-specific
architecture.

## 3. Design

### 3.1 Architecture — model graphs are **import templates**, nothing new

The whole vision rides the SDK proven in P1. A model graph is **one (generic)
«model graph» schema fed by per-format importers**, each emitting the SDK's
generic ingest shape (`{nodes:[{table,props}], edges:[{table,from,to,props}]}`)
into the Kùzu sidecar — exactly like `academic-literature`. It then renders on
the existing canvas and is queryable by lenses and (later) the P2 toolkit for
free.

**Rejected alternative:** a bespoke "model subsystem" with its own schema, store,
and viz. The SDK + sidecar already provide storage, render, lenses, and (soon)
graph-theory; a model graph should cost *one importer*, not a parallel
architecture. Reusing the SDK is the entire reason P0/P1 were built.

### 3.2 The unified «model graph» + per-format importers

One schema spanning all model classes (illustrative, not final):
`Node(id, kind, label, ...)` where `kind ∈ {op, layer, state, param-group, ...}`;
`Edge(from, to, kind)` where `kind ∈ {tensor, transition, emission, ...}`.
Importers, each a cheap SDK template:

| Class | Importer | Nodes / edges | Notes |
|---|---|---|---|
| **Structured** (HMM/SSM/Bayesian) | `hmm-export` | states / transitions + emissions | hmm_studio can export this directly — literally a graph, **zero tracing**; cheapest concrete v0, both ends owned |
| **Neural — portable** | `onnx` | ops/layers / tensors | ONNX is a standard, language-agnostic compute graph — the flagship target |
| **Neural — PyTorch** | `pytorch-fx` | traced ops / tensors | requires an FX trace (offline preprocessor, like the academic PDF→json tool) |

All three are the same "stack a template once the SDK is proven" move as the
Template Library.

### 3.3 The three phases

- **P-IA.1 — Import** (foundational). Model file → «model graph» via the
  importers above. Everything else overlays on this static graph, so it ships
  first. Cheapest v0 = `hmm-export`; flagship = `onnx`.
- **P-IA.2 — Observability ("which zones activate")**, two tiers:
  - *Static* — pure graph-theory on structure, no runtime: **dead-weights** =
    nodes with no path to an output; **hot-paths** = high-centrality nodes;
    reachability/critical-path. Cheap, lands with P2.
  - *Dynamic* — a **lens** overlaying real behavior captured from an inference
    run (activation magnitudes per op, transition frequencies per HMM edge),
    rendered as a heat overlay on the graph. This is the one piece that reaches
    **outside** gitnexus — it needs a capture step (instrument the runtime, emit
    a per-node activation file the lens reads). Hardest tier; lands last.
- **P-IA.3 — Optimization / analysis ("as code").** Point gitnexus's existing
  analytics + the P2 toolkit at the model graph: **communities** = module
  structure, **centrality** = hot paths, **dead-node detection** = prunable
  weights, **entropy/coupling** = structural health, and **diff two model
  versions** the same way gitnexus diffs two repo snapshots (architecture drift,
  added/removed ops). This is where "as graph" becomes "as code."

### 3.4 "As code" — the unifying payoff

Because a model graph is *just a graph* in the sidecar, the platform's whole
toolbox applies unchanged: the same diff coloring, the same community/centrality
analytics, the same lens mechanism, the same multigraph navigation. No model
feature needs to reinvent visualization or analysis — it reuses what code graphs
already get. A model and a codebase become comparable objects in one tool.

## 4. Out of scope — deferred guardrails

These are **explicitly out of scope** and must stay deferred; the vision is
*structural visualization + analysis of a model as a graph*, not an ML platform:

- **NOT training** — gitnexus never trains, fine-tunes, or modifies model weights.
- **NOT serving / inference hosting** — it does not run models as a service or
  host inference endpoints. (The dynamic-activations tier *reads* a capture file
  produced elsewhere; it does not host the model.)
- **NOT a profiler / TensorBoard replacement** — it is not a perf profiler, a
  training-metrics dashboard, or a tensor debugger. It is the *graph* view +
  *graph-theory* analysis of a model's structure and (optionally) its activation
  footprint.

If a future request drifts toward any of these, treat it as a new scope decision,
not an extension of this vision.

## 5. Dependencies & sequencing

- Requires: SDK (✅ P0/P1). For the payoff: **P2** (graph-theory toolkit — the
  optimization insights) and **P3** (visualization paradigms — large model graphs
  are illegible in a plain force layout; needs hierarchical/DAG/matrix views).
- When prioritized, build order: `hmm-export` import (cheap, owned) → `onnx`
  import → static observability (with P2) → dynamic-activations lens (with the
  capture step).

## 6. Open questions

- **Capture format for dynamic activations** — what file/shape does the
  instrumented runtime emit for the lens to read (per-node magnitude JSON,
  keyed on the same node ids the importer assigns)? Settle when P-IA.2 dynamic is
  scoped.
- **Unified schema vs per-class schemas** — one generic `Node(kind)` table for
  all model classes, or a schema per class? The generic-shape SDK supports
  either; decide when the second importer (onnx) lands, using the academic
  multi-table experience.
- **Model-graph scale** — large NNs have 10⁴–10⁶ nodes; the render/P3 story for
  graphs that size is a real open question (sampling, level-of-detail, op-group
  collapsing). Likely gates the `onnx` importer's usefulness.
