# IA / Model-as-graph — P-IA.2 (static): structural observability — dead-weights + hot-paths

**Date**: 2026-06-10
**Status**: current
**Parent vision**: `2026-06-03-ia-model-as-graph-vision-design.md` (P-IA.2, *static* tier).
**Builds on**: P-IA.1 model-graph import (`2026-06-10-ia-model-as-graph-p-ia-1-import-design.md`)
+ the P2.3-backlog directed metrics (`?directed=1`: SCC, directed betweenness)
+ the P2 overlay highlight mechanism (articulation/bridge/isolate via the adapter `opts` arg).
**Engine**: `upstream/docker-server-graph-theory-core.mjs`; routes:
`upstream/docker-server-graph-theory.mjs`.

## 1. Context / problem

P-IA.1 lands a model on the canvas as a graph. The vision's next tier is
**observability** — "which zones of the model matter." Its *static* half is pure
graph-theory on structure, no runtime: **dead-weights** (nodes that can't reach an
output — prunable), **hot-paths** (high-centrality nodes — the load-bearing
structure), reachability/critical-path. The vision flags this as cheap and
"lands with P2" — and indeed, now that directed metrics + SCC shipped, the only
genuinely new primitive needed is **directed reachability to/from terminal nodes**;
hot-paths are already computable from the directed centralities.

"A node that can't reach an output" is not model-specific — it's generic
unreachable/dead-code analysis, equally meaningful on the code graph (a function no
entrypoint reaches; a module that reaches no public surface). So this ships as a
**generic engine capability**, applied to model graphs but available to every graph
the platform analyzes — the same "a model is just a graph" reuse that P-IA.1 rode.

## 2. Goal

`?observability=1` on the metrics routes adds, per node, whether it **reaches an
output** and is **reachable from an input**, and flags **dead-weights**; the canvas
can highlight dead nodes (dimmed) the same way it already highlights
articulation/bridges; hot-paths are read off the existing directed-betweenness
heatmap. Success on the P-IA.1 synthetic HMM: every state is live (reaches an
observation); an artificially-pruned fixture surfaces the orphaned node as a
dead-weight; the code graph (via a lens) flags genuinely unreachable nodes.

## 3. Design

### 3.1 Terminal-node designation — structural (no schema/render change)

**Outputs** = structural **sinks**: nodes with out-degree 0 **and** in-degree > 0
(a genuine terminal that receives something — excludes fully-isolated nodes).
**Inputs** = structural **sources**: in-degree 0 **and** out-degree > 0. Computed
from the directed topology alone (via the `directedAdj` from P2.3-backlog) — **no
node `role` prop, no DDL change, no sidecar render change** (the same render-prop
limitation that keeps edge `weight` engine-side keeps an explicit `role` deferred).

This is correct for the v0 targets: HMM observations are sinks (states emit into
them); a neural net's final op is the sink; a code-graph entrypoint is a source.
An **explicit `role` override** (model-graph.json `role:'input'|'output'`) is
**deferred** to a later slice tied to a render-prop passthrough (vision §6).

**Degenerate cases** (defined, non-throwing): no sinks exist (e.g. a single pure
cycle) → `outputCount=0`, and every node has `reachesOutput=false` →
`summary.observabilityDegenerate=true` is set so a consumer doesn't misread "all
dead." Same for no sources. Edgeless graph → all nodes isolated → all dead +
degenerate flag.

### 3.2 The reachability primitive (the one genuinely-new engine function)

`reachability(graph, { outputs, inputs })` → per-node `{ reachesOutput:bool,
reachableFromInput:bool }`:

- **reachesOutput[v]** = a directed path v ⇝ some output exists. Computed by a
  **reverse-BFS from the output set** over the *reversed* directed adjacency: seed
  the queue with all outputs, walk in-edges; every visited node can reach an output
  in the forward graph. (Outputs themselves: `reachesOutput=true`.)
- **reachableFromInput[v]** = a directed path some input ⇝ v exists. Forward-BFS
  from the input set over the forward adjacency.
- Multi-source BFS (seed the queue with the whole terminal set at once) — O(V+E),
  cheap, and it composes with the existing `directedAdj`.

Plus a thin `staticObservability(graph)` that derives the default terminal sets
(sinks/sources per §3.1) and returns `{ reachesOutput, reachableFromInput,
deadWeight, outputs:Set, inputs:Set, degenerateOutputs:bool, degenerateInputs:bool }`
where **`deadWeight[v] = !reachesOutput[v]`** (the vision's definition: a weight
that contributes to no output is prunable; reachability-from-input is exposed too as
a complementary signal but doesn't define dead-weight).

### 3.3 Hot-paths — reuse, don't rebuild

Hot-paths = high-centrality nodes on the directed graph. We already emit directed
`betweenness` + `pagerank` under `?directed=1`. **No new field**: hot-paths are the
existing directed-betweenness values, surfaced via the existing heatmap color-mode +
size-metric selector. The spec records this explicitly so "show hot-paths" maps to
"color by directed betweenness," not a new threshold-tuned boolean (which would force
a percentile fork we don't want).

### 3.4 API / response (additive, opt-in)

- `parseMetricsParams` gains `observability` (bool, `'1'`/`'true'`). **`observability`
  implies `directed`** (reachability is inherently directional) — when
  `observability` is set, the engine computes the directed metrics too (so the
  response is the directed-mode response plus the observability fields).
- `computeMetrics(graph, { …, observability=false })`: when set, run
  `staticObservability` and add per node `reachesOutput`, `reachableFromInput`,
  `deadWeight`; add `summary.deadWeightCount`, `summary.outputCount`,
  `summary.inputCount`, and `summary.observabilityDegenerate` (true if either
  terminal set is empty). Absent the param → **none of these fields appear** and the
  response is byte-identical to today (additivity test guards it).
- **Cap interaction**: reachability is O(V+E) (near-linear) → it runs even on capped
  graphs (like degree/pagerank), NOT gated by `skipSuperLinear`. Documented in
  `summary`.
- `metricsCacheKey` extends with `|observability` (and since it implies directed, the
  existing `|directed` slot also flips — both appended so no reduced-payload cache hit).
- **MCP**: both graph-metrics tools gain an `observability` boolean, forwarded like
  `directed`.

### 3.5 Frontend — dead-node highlight (reuse the overlay opts mechanism)

The canvas overlay already dims/ highlights via the adapter's 4th `opts` arg
(`articulationIds`, `bridgeKeys`, `isolateCommunity`). Add a parallel
**`deadNodeIds`** (or `deadWeight` set): when observability is on and the toggle is
enabled, dead-weight nodes render **dimmed/grey** (reuse the exact dimming the
community-isolate path already uses) and live nodes stay full-color — making
prunable structure pop. A small, additive control next to the existing metric
controls ("Observability" toggle, gated to research/lens + directed-capable views).
No new component; extends `researchGraphToGraphology`'s existing `opts`.

Hot-paths need **no new UI** — the user picks `betweenness` in the size/heatmap
selector (already there); the spec/inventory note this.

### 3.6 Verification posture (matches P2.3-backlog)

- **Unit (host-native vitest)** — primary gate:
  - `reachability`: a directed chain a→b→c (output=c sink): all reach c; with an
    added orphan d→d self-loop (no path to c), `reachesOutput[d]=false`. A node
    with no outgoing path to any sink flagged dead. `reachableFromInput` symmetric
    from a source.
  - `staticObservability` on the P-IA.1 HMM shape (states→observations): observations
    are outputs, all states `reachesOutput=true`, `deadWeightCount=0`.
  - A pruned fixture (a state with no emission edge + no path to any observation) →
    that state `deadWeight=true`, `deadWeightCount=1`.
  - Degenerate: edgeless → all dead + `observabilityDegenerate=true`; single pure
    cycle (no sinks) → `outputCount=0` + degenerate flag, no throw.
  - `computeMetrics` additivity: `?observability` off → no new fields,
    response unchanged; on → fields present + `summary.directed=true` (implied).
- **Route/params**: `parseMetricsParams` parses `observability`; cache key varies.
- **MCP source-text**: both tools expose + forward `observability`.
- **Frontend**: pure adapter logic (dead-node dimming) unit-tested if a pure lib
  function carries it; the web image build (tsc) gates the `.tsx`/`.ts` touch.
- Drift green; patches regenerated by the controller. Live browser-QA of the dead-node
  highlight is **best-effort** (the dev-stack port hold may block the test stack, as
  in P-IA.1) — engine/adapter unit tests + tsc are the binding gate; any unrun live QA
  is reported, not silently claimed.

## 4. Scope boundaries

**In scope**: the generic `reachability` + `staticObservability` engine functions,
`?observability=1` wiring (params/cache/MCP), additive response fields, and a minimal
frontend dead-node highlight reusing the existing overlay opts. Generic — usable on
sidecar model graphs AND code-graph lenses.

**Out of scope (deferred)**:
- **Dynamic observability** (the activation-overlay lens reading a runtime capture
  file) — that's the *dynamic* tier of P-IA.2, needs a capture format (vision §6),
  separate slice.
- **Explicit input/output `role`** in model-graph.json (needs a render-prop
  passthrough; structural sinks/sources suffice for v0).
- **A `hotPath` boolean / percentile threshold** — hot-paths = existing directed
  centrality + heatmap; no new field.
- **Critical-path / longest-path weighting** (needs edge weights surfaced — tied to
  the deferred weighted-edge work).
- **Prune actions** — this only *detects* dead-weights; it never modifies a model
  (the vision's "NOT training / NOT modifying weights" guardrail).

## 5. Open questions

- **Sink-as-output heuristic vs richer signals.** Structural sinks work for HMM /
  feed-forward NN / code entrypoints. A model with no structural sink (a pure
  recurrent loop with no terminal emission) degenerates to `outputCount=0`; the
  explicit-`role` override (deferred) is the escape hatch when it lands. Acceptable
  for v0; documented via the degenerate flag.
- **Dead-weight on the code graph semantics.** "Reaches no sink" on a code-graph lens
  flags leaf utilities as well as genuinely-dead code; useful but needs framing in the
  UI copy so it's not read as "delete this." Tune when the code-graph use surfaces.
