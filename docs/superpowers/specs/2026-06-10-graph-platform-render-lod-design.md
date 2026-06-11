# Graph Platform — render LoD (node-cap + top-N prune) v1

**Date**: 2026-06-10
**Status**: current
**Context**: the ONNX converter (`2026-06-10-ia-model-as-graph-onnx-importer-design.md`)
flagged 10⁴–10⁶-node model graphs as the gating render-legibility problem. The metrics
engine already node-caps (`computeMetricsCapped`, cap 2000); this adds the missing
**render-side** guard so huge graphs are renderable at all, without silent truncation.

## 1. Context / problem

The 2D canvas (sigma) chokes + becomes illegible on graphs of many thousands of nodes —
the case a real ONNX model produces. There is no render-side bound today: a large
model-graph would lock the browser. The vision's "model-graph scale" open question
(sampling / LoD / op-group collapsing) is unsolved. This is a **v1 LoD**: a deterministic
node-cap that renders the top-N most-connected nodes + a visible "showing N of M" banner,
so large graphs render and the truncation is never silent. (Op-group / community
collapsing — the richer LoD — stays deferred.)

## 2. Goal

When a graph exceeds a node threshold, the canvas renders only the top-N nodes (by degree)
plus the edges among them, and shows a banner stating "showing N of M nodes (top by
degree)". Below the threshold, behavior is unchanged (no-op). Success: a synthetic
3000-node graph renders 1500 nodes + a banner; a 50-node graph renders unchanged with no
banner.

## 3. Design

### 3.1 Pure `pruneForRender` — `gitnexus-web/src/lib/graph-lod.ts` (graphology-free, host-tested)

Mirrors the testable pure-lib pattern (`metrics-view.ts`, `graph-diff-view.ts` — no
graphology import → runs in the unit tier). Generic over the render shape `{ nodes:[{id}],
edges:[{source,target}] }`:

```ts
export const LOD_MAX_NODES = 1500;   // below the metrics cap (2000); renderable in sigma without choking

export interface LodResult<N, E> { nodes: N[]; edges: E[]; pruned: boolean; shown: number; total: number; by: string }

export function pruneForRender<N extends {id:string}, E extends {source:string;target:string}>(
  graph: { nodes: N[]; edges: E[] } | undefined,
  { maxNodes = LOD_MAX_NODES, by = 'degree' }: { maxNodes?: number; by?: string } = {},
): LodResult<N, E>
```

- `nodes = graph?.nodes ?? []`, `edges = graph?.edges ?? []`. `total = nodes.length`.
- If `total <= maxNodes` → `{ nodes, edges, pruned: false, shown: total, total, by }` (no-op,
  same arrays).
- Else: compute degree per id from edges (count each endpoint; self-loops count once or
  twice — irrelevant for ranking). Sort node ids by **degree desc, then id asc**
  (deterministic tie-break). Keep the top `maxNodes` ids in a Set. `keptNodes` = nodes whose
  id ∈ Set (preserving original order); `keptEdges` = edges whose BOTH endpoints ∈ Set.
  Return `{ nodes: keptNodes, edges: keptEdges, pruned: true, shown: keptNodes.length,
  total, by }`.
- Generic + pure → returns the caller's node/edge types (type-transparent, like
  `unionResearchGraphs`).

### 3.2 GraphCanvas wiring

In the render path, before handing the graph to the adapter: `const lod =
pruneForRender(renderRg, { maxNodes: LOD_MAX_NODES });` then render `{ nodes: lod.nodes,
edges: lod.edges }` (as the ResearchGraph — generic prune preserves the type). When
`lod.pruned`, show a small banner (near the other overlay legends): "LoD · showing
{shown} of {total} nodes (top by degree)". The banner is gated on `lod.pruned` only — no
new toggle (LoD is automatic above the threshold). Add `LOD_MAX_NODES`/`lod.pruned` to the
render-effect deps where relevant. Applies to research/model graphs AND the diff union
(prune after union). Below threshold → no banner, identical render.

(Optional, low-cost: a "Show all (slow)" escape that sets a higher `maxNodes` for the
current render — include only if trivial; otherwise the banner alone is v1.)

### 3.3 Interaction with existing overlays

LoD prunes the **node/edge set fed to the adapter**; metrics/community/diff coloring then
applies to the kept subgraph (the metricsById map is keyed by id — kept nodes look up
fine; pruned-away nodes are simply absent). No conflict. The activation/diff/observability
opts operate on whatever node set is rendered.

## 4. Verification

- **Unit (host-native vitest)** — `graph-lod.test.mjs`: below-threshold → no-op (`pruned
  false`, same counts); above-threshold (e.g. 5 nodes, maxNodes 3) → keeps the 3
  highest-degree (build a star so the hub + 2 others win), `pruned true`, `shown 3`,
  `total 5`, and kept edges only among kept nodes; deterministic tie-break (equal-degree →
  id asc); empty/undefined graph → empty no-throw; type-transparent (returns same shapes).
- **Web image build (tsc)** gates the `.ts`/`.tsx` (GraphCanvas wiring).
- No backend change → no patch beyond the gitnexus-web/src files (which are in the patch
  surface — regen + drift as usual). No web behavior below the threshold.

## 5. Scope boundaries

**In scope**: pure `pruneForRender` + `LOD_MAX_NODES` + GraphCanvas node-cap render + the
"showing N of M" banner. Applies to 2D research/model/diff canvas.

**Out of scope (deferred)**:
- **Op-group / community collapsing** (the richer LoD — collapse repeated subgraphs / use
  multi-level Louvain super-nodes with expand/collapse). The genuinely-hard piece; v1 is a
  flat top-N prune.
- **3D LoD** (Graph3DCanvas) — v1 is the 2D canvas; 3D can choke too but is a follow-up.
- **Importance metric beyond degree** (betweenness/pagerank-ranked prune) — degree is
  cheap + dependency-free in the pure lib; a metric-ranked prune (reusing the metrics
  overlay) is a follow-up.
- **Backend/sidecar render prune** — v1 prunes client-side (the full graph still transfers;
  fine up to ~10⁴; a backend `?topN=` for 10⁵⁺ is a later optimization).

## 6. Open questions

- **Threshold (1500).** A guess at sigma's comfortable ceiling; tune against a real large
  model. Configurable via `LOD_MAX_NODES`.
- **Degree vs a better importance signal for ONNX.** Degree is weak on near-uniform compute
  DAGs; community/op-group collapsing is the real answer (deferred). v1's banner makes the
  flat prune honest.
