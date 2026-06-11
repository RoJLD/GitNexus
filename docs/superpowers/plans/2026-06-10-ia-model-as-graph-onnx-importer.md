# ONNX → model-graph converter — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-10-ia-model-as-graph-onnx-importer-design.md`.

**Goal:** `tools/onnx-to-model-graph.mjs` — a pure `onnxGraphToModelGraph(onnxGraph,{name,maxNodes})` (ops→nodes, tensor-flow→edges) + a CLI. Reuses the P-IA.1 `model-graph` template for import. No `upstream/` change (no patch/Dockerfile/web build); `tools/` is tracked.

**Verification:** `cd tests && npx vitest run --config vitest.config.unit.mjs onnx-to-model-graph`.

### Task 1: `tools/onnx-to-model-graph.mjs` + unit test
**Files:** create `tools/onnx-to-model-graph.mjs`; create `tests/unit/onnx-to-model-graph.test.mjs`. (Mirror `tools/academic-extract.mjs` style: an exported pure fn + a CLI guarded by `import.meta.url === pathToFileURL(process.argv[1]).href`.)

`export function onnxGraphToModelGraph(onnxGraph, { name = null, maxNodes = 200000 } = {})`:
- `nodeList = onnxGraph.node ?? []`. If `nodeList.length > maxNodes` → `throw new Error(...)` (loud, no silent truncation).
- opId for node i: `node.name || `${node.opType}#${i}``; dedup — if an id repeats, suffix `#${i}`.
- nodes: `{ id, type: 'op', label: node.opType ?? 'op' }`.
- producer map: for each op, for each `t` in `node.output ?? []`, `producer.set(t, opId)`.
- edges: for each op B (id bId), for each `t` in `node.input ?? []`, if `producer.has(t)` and `producer.get(t) !== bId` → `{ from: producer.get(t), to: bId, kind: 'tensor', label: t }`, deduped by `${from}␟${to}␟${t}`.
- return `{ model: { name: name || onnxGraph.name || 'onnx-model', framework: 'onnx', version: null }, nodes, edges }`.
- empty graph → empty nodes/edges, no throw.

CLI: `node tools/onnx-to-model-graph.mjs <onnx-graph.json> <out-model-graph.json> [name]` → read+parse the input JSON, call the transform, `writeFileSync` `JSON.stringify(result, null, 2)`, `console.log` node/edge counts. Include a `--help`/usage string documenting the Python pre-step (the MessageToDict one-liner from spec §3.1).

- [ ] **Step 1: test first** `tests/unit/onnx-to-model-graph.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { onnxGraphToModelGraph } from '../../tools/onnx-to-model-graph.mjs';

const CHAIN = { name: 'tiny', node: [
  { opType: 'Conv', name: 'conv1', input: ['x', 'w'], output: ['t1'] },
  { opType: 'Relu', name: 'relu1', input: ['t1'], output: ['t2'] },
  { opType: 'Gemm', name: 'gemm1', input: ['t2', 'w2'], output: ['t3'] },
] };

describe('onnxGraphToModelGraph', () => {
  it('maps ops to nodes and tensor-flow to edges', () => {
    const g = onnxGraphToModelGraph(CHAIN, { name: 'tiny' });
    expect(g.model).toMatchObject({ name: 'tiny', framework: 'onnx' });
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes.every((n) => n.type === 'op')).toBe(true);
    expect(g.nodes.map((n) => n.label).sort()).toEqual(['Conv', 'Gemm', 'Relu']);
    expect(g.edges).toHaveLength(2);   // conv1->relu1 (t1), relu1->gemm1 (t2); 'w'/'w2'/'x' have no producer
    expect(g.edges).toContainEqual({ from: 'conv1', to: 'relu1', kind: 'tensor', label: 't1' });
    expect(g.edges).toContainEqual({ from: 'relu1', to: 'gemm1', kind: 'tensor', label: 't2' });
  });
  it('falls back to opType#i for nameless nodes', () => {
    const g = onnxGraphToModelGraph({ node: [{ opType: 'Add', input: [], output: ['o'] }] });
    expect(g.nodes[0].id).toBe('Add#0');
    expect(g.model.name).toBe('onnx-model');   // no graph name → default
  });
  it('graph-input tensors (no producer) yield no edge', () => {
    const g = onnxGraphToModelGraph({ node: [{ opType: 'Relu', name: 'r', input: ['x'], output: ['y'] }] });
    expect(g.edges).toEqual([]);
  });
  it('empty graph → empty, no throw', () => {
    const g = onnxGraphToModelGraph({});
    expect(g.nodes).toEqual([]); expect(g.edges).toEqual([]);
  });
  it('throws above maxNodes (no silent truncation)', () => {
    const big = { node: Array.from({ length: 5 }, (_, i) => ({ opType: 'X', name: `n${i}`, input: [], output: [] })) };
    expect(() => onnxGraphToModelGraph(big, { maxNodes: 3 })).toThrow(/max/i);
  });
  it('is JSON-serializable', () => { expect(() => JSON.stringify(onnxGraphToModelGraph(CHAIN))).not.toThrow(); });
});
```
- [ ] **Step 2: run, verify FAIL** — `cd tests && npx vitest run --config vitest.config.unit.mjs onnx-to-model-graph`.
- [ ] **Step 3: implement** the tool.
- [ ] **Step 4: run, verify PASS.**
- [ ] **Step 5:** report (controller commits).

### Post-build (controller)
1. Verify vitest green. No patch regen (tools/ tracked, not upstream/), no web build, no Dockerfile.
2. Commit + push `deployment`; update ROADMAP/INVENTORY (onnx converter shipped; reuses P-IA.1 import; scale-LoD deferred), spec Status, memory (batch end).
