# IA/Model-as-graph P-IA.2 (static observability) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add generic structural observability — directed reachability to/from terminal nodes + dead-weight detection — to the pure-JS engine, exposed via `?observability=1` (additive/opt-in), with a frontend dead-node highlight. Hot-paths reuse the existing directed centrality.

**Architecture:** One new engine primitive (`reachability`) + a thin `staticObservability` deriving structural sink/source terminals, gated into `computeMetrics` by a new opt; `parseMetricsParams`/`metricsCacheKey`/MCP extended; the adapter's existing `opts` arg gains `deadNodeIds`. Builds on P2.3-backlog's `directedAdj`. Zero new route/service. Spec: `docs/superpowers/specs/2026-06-10-ia-model-as-graph-p-ia-2-static-observability-design.md`.

**Tech Stack:** Node ESM (pure), vitest (host-native), node:test (MCP), React/TS adapter.

**Verification venue:** `cd tests && npx vitest run --config vitest.config.unit.mjs <filter>`; MCP `node --test mcp-server/server.test.mjs`; web image build (tsc) for the `.ts` touch.

**Patch/git discipline (controller only):** regen `patches/*.diff` + `node scripts/check-patch-drift.mjs` (exit 0) before commit. Subagents NEVER touch git/patches.

---

### Task 1: engine — `reachability` + `staticObservability`

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs` (add two exported functions; reuse `directedAdj` from P2.3-backlog; do NOT alter existing functions)
- Test: `tests/unit/graph-theory-core.test.mjs` (append)

New exports:
- `reachability(graph, { outputs, inputs })` → `{ reachesOutput: {id→bool}, reachableFromInput: {id→bool} }`. `outputs`/`inputs` are `Set<id>` (or arrays). `reachesOutput`: multi-source BFS seeded with all `outputs` over the **reversed** directed adjacency (walk `in`-edges) → visited nodes can reach an output. `reachableFromInput`: multi-source BFS seeded with all `inputs` over the **forward** adjacency (`out`-edges). Use `directedAdj(graph)` for `{ids,out,in}`. Empty terminal set → all false (except: an output is trivially `reachesOutput=true` since it's seeded). Every id present in both maps.
- `staticObservability(graph)` → `{ reachesOutput, reachableFromInput, deadWeight:{id→bool}, outputs:Set, inputs:Set, outputCount, inputCount, degenerateOutputs:bool, degenerateInputs:bool }`. Derive terminals structurally from `directedAdj`: `outputs` = ids with `out.get(id).length===0 && in.get(id).length>0`; `inputs` = ids with `in.get(id).length===0 && out.get(id).length>0`. Call `reachability` with them. `deadWeight[v] = !reachesOutput[v]`. `degenerateOutputs = outputs.size===0` (likewise inputs). `outputCount`/`inputCount` = set sizes.

- [ ] **Step 1: Write failing tests** — append to `tests/unit/graph-theory-core.test.mjs`:

```js
import { reachability, staticObservability } from '../../upstream/docker-server-graph-theory-core.mjs';

describe('reachability', () => {
  it('marks nodes that can reach an output and that are reachable from an input', () => {
    // a -> b -> c (c is the sink/output, a is the source/input)
    const g = { nodes: ['a','b','c'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }] };
    const { reachesOutput, reachableFromInput } = reachability(g, { outputs: new Set(['c']), inputs: new Set(['a']) });
    expect(reachesOutput.a).toBe(true); expect(reachesOutput.b).toBe(true); expect(reachesOutput.c).toBe(true);
    expect(reachableFromInput.c).toBe(true); expect(reachableFromInput.a).toBe(true);
  });
  it('a node with no path to any output is not reachesOutput', () => {
    // a -> c (output c); orphan d -> d self-loop, no path to c
    const g = { nodes: ['a','c','d'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'c' }, { source: 'd', target: 'd' }] };
    const { reachesOutput } = reachability(g, { outputs: new Set(['c']), inputs: new Set(['a']) });
    expect(reachesOutput.a).toBe(true);
    expect(reachesOutput.d).toBe(false);   // self-loop dropped by cleanEdges → d isolated → can't reach c
  });
});

describe('staticObservability', () => {
  it('on an HMM-shaped graph (states emit to observation sinks), all states reach an output', () => {
    // s0,s1 transition between each other + both emit to obs (a sink); obs has in>0,out==0 → output
    const g = { nodes: ['s0','s1','obs'].map((id) => ({ id })),
      edges: [
        { source: 's0', target: 's1' }, { source: 's1', target: 's0' },
        { source: 's0', target: 'obs' }, { source: 's1', target: 'obs' },
      ] };
    const o = staticObservability(g);
    expect(o.outputs.has('obs')).toBe(true);
    expect(o.outputCount).toBe(1);
    expect(o.reachesOutput.s0).toBe(true);
    expect(o.reachesOutput.s1).toBe(true);
    expect(o.deadWeight.s0).toBe(false);
    expect(Object.values(o.deadWeight).filter(Boolean).length).toBe(0);  // deadWeightCount = 0
  });
  it('flags a pruned node (no path to any output) as a dead-weight', () => {
    // s0 -> obs (output); orphan node 'p' with an edge p->p only → dead
    const g = { nodes: ['s0','obs','p','q'].map((id) => ({ id })),
      edges: [{ source: 's0', target: 'obs' }, { source: 'q', target: 'p' }, { source: 'p', target: 'q' }] };
    const o = staticObservability(g);
    // p and q form a 2-cycle with no edge out to obs → neither reaches the output
    expect(o.deadWeight.p).toBe(true);
    expect(o.deadWeight.q).toBe(true);
    expect(o.deadWeight.s0).toBe(false);
  });
  it('edgeless graph → all dead + degenerate flags', () => {
    const o = staticObservability({ nodes: [{ id: 'x' }, { id: 'y' }], edges: [] });
    expect(o.outputCount).toBe(0);
    expect(o.degenerateOutputs).toBe(true);
    expect(o.deadWeight.x).toBe(true);
  });
  it('single pure cycle (no sinks) → outputCount 0 + degenerate, no throw', () => {
    const o = staticObservability({ nodes: ['a','b'].map((id) => ({ id })),
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }] });
    expect(o.outputCount).toBe(0);
    expect(o.degenerateOutputs).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `cd tests && npx vitest run --config vitest.config.unit.mjs graph-theory-core`.
- [ ] **Step 3: Implement** both functions near the directed-metrics block (they belong with `directedAdj`/SCC). Reuse `directedAdj`. Multi-source BFS (seed queue with the whole terminal set). Guard empty graph (`{}`/sets empty, no throw).
- [ ] **Step 4: Run, verify PASS** + the full `graph-theory-core` file stays green.
- [ ] **Step 5: Commit** (controller).

---

### Task 2: wire into computeMetrics / params / cache / MCP + additivity

**Files:**
- Modify: `upstream/docker-server-graph-theory-core.mjs` (`computeMetrics`, `computeMetricsCapped`)
- Modify: `upstream/docker-server-graph-theory.mjs` (`parseMetricsParams`, `metricsCacheKey`)
- Modify: `mcp-server/server.mjs` (both graph-metrics tools)
- Test: `graph-theory-core.test.mjs`, `graph-theory-handler.test.mjs`, `graph-theory-cache.test.mjs`, `mcp-server/server.test.mjs`

Spec:
- `computeMetrics(graph, { …, observability=false })`: **`observability` implies `directed`** — when `observability` is truthy, treat `directed` as true (compute the directed fields) AND run `staticObservability`; add per node `reachesOutput`, `reachableFromInput`, `deadWeight`; add `summary.deadWeightCount` (count of deadWeight), `summary.outputCount`, `summary.inputCount`, `summary.observabilityDegenerate` (= degenerateOutputs || degenerateInputs). When `observability` is off → none of these fields appear (additivity).
- `computeMetricsCapped`: pass `observability` through (`...opts` already does). Reachability is near-linear → runs even when capped (do NOT gate on `skip`). Do NOT add observability to `omittedMetrics`.
- `parseMetricsParams`: `const observability = ['1','true'].includes((searchParams.get('observability')||'').toLowerCase());` add to the returned object.
- `metricsCacheKey`: append `|${params.observability?1:0}`.
- MCP: both tools gain `observability` boolean in inputSchema + `if (observability) params.observability = 1;` in the handler; extend descriptions ("…optional structural observability: dead-weight detection + reachability").

- [ ] **Step 1: Write failing tests.**

`graph-theory-core.test.mjs` (append):
```js
describe('computeMetrics — observability', () => {
  const HMM = { nodes: ['s0','s1','obs'].map((id) => ({ id })),
    edges: [{ source: 's0', target: 's1' }, { source: 's1', target: 's0' }, { source: 's0', target: 'obs' }, { source: 's1', target: 'obs' }] };
  it('off by default: no observability fields, byte-additive', () => {
    const r = computeMetrics(HMM, {});
    expect(r.nodes[0].deadWeight).toBeUndefined();
    expect(r.summary.deadWeightCount).toBeUndefined();
  });
  it('on: adds reachesOutput/deadWeight + summary counts and implies directed', () => {
    const r = computeMetrics(HMM, { observability: true });
    const obs = r.nodes.find((n) => n.id === 'obs');
    expect(typeof obs.reachesOutput).toBe('boolean');
    expect(r.nodes.find((n) => n.id === 's0').deadWeight).toBe(false);
    expect(r.summary.deadWeightCount).toBe(0);
    expect(r.summary.outputCount).toBe(1);
    expect(r.summary.directed).toBe(true);              // implied
    expect(typeof r.nodes[0].sccId).toBe('number');     // directed fields present
  });
  it('capped graph still computes observability (near-linear)', () => {
    const r = computeMetricsCapped(HMM, { observability: true, cap: 1 });
    expect(r.summary.capped).toBe(true);
    expect(r.summary.deadWeightCount).toBe(0);          // not omitted
    expect(r.nodes[0].deadWeight).toBeDefined();
  });
});
```

`graph-theory-handler.test.mjs` (append to the P2.3 params describe or a new one):
```js
it('parses observability', () => {
  const p = parseMetricsParams(new URL('http://x/g?observability=1').searchParams);
  expect(p.observability).toBe(true);
});
it('defaults observability off', () => {
  expect(parseMetricsParams(new URL('http://x/g').searchParams).observability).toBe(false);
});
```

`graph-theory-cache.test.mjs` (extend the P2.3 cache-key test or add one):
```js
it('cache key varies with observability', () => {
  const base = { community:'louvain', resolution:1, cap:2000, approx:null, directed:false, hierarchy:false, embed:null, dims:8, observability:false };
  const k = (o) => metricsCacheKey('sidecar','g','',{ ...base, ...o });
  expect(k({})).not.toBe(k({ observability: true }));
});
```

`mcp-server/server.test.mjs` — add source-text assertions (match the file's style) that both tools expose `observability` and forward it.

- [ ] **Step 2: Run all four, verify the new cases FAIL.**
- [ ] **Step 3: Implement** A–E per the spec above.
- [ ] **Step 4: Run all four green** + the broader family: `npx vitest run --config vitest.config.unit.mjs graph-theory metrics-view graph-lens` + MCP.
- [ ] **Step 5: Commit** (controller).

---

### Task 3: frontend dead-node highlight

**Files:**
- Modify: `upstream/gitnexus-web/src/lib/research-graph-adapter.ts` (add `deadNodeIds` to `opts`)
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx` (Observability toggle → fetch `&observability=1` → derive dead set → pass to adapter)
- Test: extend `tests/unit/research-graph-adapter.test.mjs` (pure adapter assertion) IF the unit runner resolves graphology there; otherwise note the adapter logic is covered by the web build + manual reasoning.

Adapter: extend the `opts` type with `deadNodeIds?: Set<string>`. In the node loop (the same place `dimmed`/articulation are computed), a node in `deadNodeIds` → recolor to a distinct **dead** color `#ef4444` (red) and set `{ highlighted: true, zIndex: 2 }` so dead-weights POP (reusing the articulation highlight attrs). Apply this AFTER the normal color assignment, only when `deadNodeIds?.has(node.id)` (and not dimmed). This is additive — absent `deadNodeIds`, behavior is unchanged.

GraphCanvas: add an `observabilityOn` state + an "Observability" toggle in the existing control row (gated to research/lens views + node-link view, beside the metrics controls). When on, the metrics fetch URL gains `&observability=1`. Build `deadNodeIds = new Set(metrics.nodes.filter(n => n.deadWeight).map(n => n.id))` and pass it via the adapter `opts`. A small inline legend ("● dead-weight" in red) next to the toggle. Follow the EXACT pattern of the existing `highlightStructure`/`isolateCommunity` toggles.

- [ ] **Step 1: Adapter test (if feasible)** — add a case to `research-graph-adapter.test.mjs`: build a tiny researchGraph + metricsById with one node `deadWeight:true`, call `researchGraphToGraphology(rg, metricsById, 'degree', { deadNodeIds: new Set(['x']) })`, assert that node's color === '#ef4444' and `highlighted===true`. (If the unit runner can't load graphology for this file — a known pre-existing limitation — skip the unit assertion and rely on the web build + the engine tests; NOTE this in the report.)
- [ ] **Step 2: Run, verify FAIL** (if the test is feasible).
- [ ] **Step 3: Implement** the adapter `opts.deadNodeIds` coloring + the GraphCanvas toggle/fetch/derive wiring.
- [ ] **Step 4: Verify** — adapter test green (if feasible). The web image build (tsc) is the binding gate for the `.ts`/`.tsx` changes; the controller runs `docker compose -f docker-compose.test.yml build gitnexus-web-test` and confirms exit 0.
- [ ] **Step 5: Commit** (controller).

---

## Self-review checklist (controller)
- Spec coverage: §3.1 structural terminals + §3.2 reachability → Task 1; §3.4 API/cache/MCP + additivity → Task 2; §3.5 frontend highlight → Task 3; §3.3 hot-paths = reuse (no code). ✓
- Type consistency: `reachesOutput`/`reachableFromInput`/`deadWeight` node fields; `deadWeightCount`/`outputCount`/`inputCount`/`observabilityDegenerate` summary fields; `deadNodeIds` opts — identical across Tasks 1–3. ✓
- No placeholders; additivity guarded (Task 2 step1 default-off test); reachability cap-ungated + near-linear. ✓

## Post-build (controller)
1. Regen patches + drift → exit 0.
2. Final whole-diff review (or controller direct review).
3. Verify: engine + integration unit green; web image build (tsc) green for the frontend; best-effort browser-QA of the dead-node highlight (report if the dev-stack port hold blocks the test stack — do NOT disrupt the dev stack).
4. Commit + push `deployment`; update ROADMAP (P-IA.2 static shipped), INVENTORY, spec Status, memory.
