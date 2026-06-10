# Graph Platform P3.3 — research/lens graphs in 3D + metrics parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Render research/lens graphs in `Graph3DCanvas` (parity with the 2D toggle) with community color + centrality size via a 3D Metrics toggle + size selector.

**Architecture:** Pure `researchTo3D` (unit-tested) maps a ResearchGraph (+metrics) to the 3D node/link shapes; `Graph3DCanvas` reads `?research`/`?lens`, fetches the render + metrics, and branches its `data` to `researchTo3D` when a research/lens graph is active (code-graph path unchanged otherwise). Dep-free, frontend-only.

**Tech Stack:** React/TypeScript, react-force-graph-3d/three, vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-graph-platform-p3-3-research-lens-3d-design.md`

**Current state (verified):**
- `components/Graph3DCanvas.tsx`: `Node3D` interface (lines 71-78: `{id,name,label,baseColor,val,raw:GraphNode}`); `Link3D` (80-87); builds `data` from `useAppState().graph` in a useMemo (183-257); `onNodeClick={(n) => { setSelectedNode(n.raw); openCodePanel(); }}` (454-457); the "2D" button top-right (562-571). Imports `useAppState`, `NODE_COLORS`/`NODE_SIZES`.
- `services/research-client.ts`: `getResearchGraph(name)`, `applyLens(lensId, repo)`.
- `services/graph-theory-client.ts`: `getGraphMetrics(name, opts?)`, `getGraphLensMetrics(lensId, repo, opts?)`, `type SizeMetric`.
- `lib/research-graph-adapter.ts`: `export const COMMUNITY_PALETTE`, `interface ResearchGraph`.
- `lib/research-colors.ts`: `RESEARCH_COLORS`, `RESEARCH_FALLBACK_COLOR`.

---

### Task 1: pure `research-to-3d.ts` + unit test

**Files:** Create `upstream/gitnexus-web/src/lib/research-to-3d.ts`; Test `tests/unit/research-to-3d.test.mjs` (new).

- [ ] **Step 1: Failing tests** — create `tests/unit/research-to-3d.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { researchTo3D } from '../../upstream/gitnexus-web/src/lib/research-to-3d.ts';

const RG = {
  nodes: [
    { id: 'a', type: 'Hypothesis', label: 'H-A', path: '', stage: '' },
    { id: 'b', type: 'Experiment', label: 'E-B', path: '', stage: '' },
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'b', kind: 'tests' },
    { id: 'e2', source: 'a', target: 'b', kind: 'tests' },   // dup
    { id: 'e3', source: 'a', target: 'a', kind: 'self' },     // self-loop
    { id: 'e4', source: 'a', target: 'zzz', kind: 'dangling' },
  ],
};

describe('researchTo3D', () => {
  it('no metrics → research-type color, fixed val, research flag; name=label, label=type', () => {
    const { nodes, links } = researchTo3D(RG);
    const a = nodes.find((n) => n.id === 'a');
    expect(a.name).toBe('H-A');
    expect(a.label).toBe('Hypothesis');
    expect(a.val).toBe(4);
    expect(a.research).toBe(true);
    expect(typeof a.baseColor).toBe('string');
    expect(links).toHaveLength(1);                 // dup + self-loop + dangling dropped
    expect(links[0]).toMatchObject({ source: 'a', target: 'b', type: 'tests' });
  });
  it('with metrics → community palette color + size scaled by metric', () => {
    const m = new Map([
      ['a', { community: 0, pagerank: 0.1 }],
      ['b', { community: 1, pagerank: 0.9 }],
    ]);
    const { nodes } = researchTo3D(RG, m, 'pagerank');
    const a = nodes.find((n) => n.id === 'a');
    const b = nodes.find((n) => n.id === 'b');
    expect(a.baseColor).not.toBe(b.baseColor);     // different communities → different palette colors
    expect(b.val).toBeGreaterThan(a.val);          // higher pagerank → bigger
  });
});
```

- [ ] **Step 2: Run → fail** (`cd tests && npx vitest run --config vitest.config.unit.mjs research-to-3d`).

- [ ] **Step 3: Implement** — create `upstream/gitnexus-web/src/lib/research-to-3d.ts`:
```ts
import type { ResearchGraph } from './research-graph-adapter';
import { COMMUNITY_PALETTE } from './research-graph-adapter';
import { RESEARCH_COLORS, RESEARCH_FALLBACK_COLOR } from './research-colors';

export interface Node3DLite { id: string; name: string; label: string; baseColor: string; val: number; research: true }
export interface Link3DLite { source: string; target: string; type: string; baseColor: string }

const EDGE_COLOR = '#475569';

/** Map a ResearchGraph (+optional metrics) to 3D node/link shapes. Community color + centrality
 *  size when metricsById present, else research-type color + fixed size. Dedups edges, drops
 *  self-loops + dangling. Pure. */
export function researchTo3D(
  rg: ResearchGraph,
  metricsById?: Map<string, { community: number } & Record<string, number>>,
  sizeBy: string = 'pagerank',
): { nodes: Node3DLite[]; links: Link3DLite[] } {
  const maxV = metricsById
    ? Math.max(...[...metricsById.values()].map((v) => v[sizeBy] ?? 0), 1e-9)
    : 1;
  const nodes: Node3DLite[] = [];
  const idSet = new Set<string>();
  for (const n of rg.nodes || []) {
    if (!n || n.id == null || idSet.has(n.id)) continue;
    idSet.add(n.id);
    const m = metricsById?.get(n.id);
    const baseColor = m
      ? COMMUNITY_PALETTE[m.community % COMMUNITY_PALETTE.length]
      : (RESEARCH_COLORS[n.type] || RESEARCH_FALLBACK_COLOR);
    const val = m ? 2 + 8 * Math.sqrt((m[sizeBy] ?? 0) / maxV) : 4;
    nodes.push({ id: n.id, name: n.label, label: n.type, baseColor, val, research: true });
  }
  const eseen = new Set<string>();
  const links: Link3DLite[] = [];
  for (const e of rg.edges || []) {
    if (!e || !idSet.has(e.source) || !idSet.has(e.target) || e.source === e.target) continue;
    const key = `${e.source}\0${e.target}`;
    if (eseen.has(key)) continue;
    eseen.add(key);
    links.push({ source: e.source, target: e.target, type: e.kind, baseColor: EDGE_COLOR });
  }
  return { nodes, links };
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** — controller.

---

### Task 2: `Graph3DCanvas` — research/lens path + metrics

**Files:** Modify `upstream/gitnexus-web/src/components/Graph3DCanvas.tsx`. (Build-checked + browser-QA.)

- [ ] **Step 1: Node3D type — optional raw + research flag** (lines 71-78):
```tsx
interface Node3D {
  id: string;
  name: string;
  label: NodeLabel | string;
  baseColor: string;
  val: number;
  raw?: GraphNode;
  research?: boolean;
}
```
(`label` widened to allow research types; `raw` optional; `research` flag.)

- [ ] **Step 2: Imports** (after the existing imports ~line 32):
```tsx
import { getResearchGraph, applyLens } from '../services/research-client';
import { getGraphMetrics, getGraphLensMetrics, type SizeMetric } from '../services/graph-theory-client';
import { researchTo3D } from '../lib/research-to-3d';
import type { ResearchGraph } from '../lib/research-graph-adapter';
```

- [ ] **Step 3: State + fetch effects** (near the top of the component, after the existing `useState`s ~line 115):
```tsx
  const researchName = new URLSearchParams(window.location.search).get('research');
  const lensId = new URLSearchParams(window.location.search).get('lens');
  const lensRepo = new URLSearchParams(window.location.search).get('repo');
  const [researchData, setResearchData] = useState<ResearchGraph | null>(null);
  const [metricsOn, setMetricsOn] = useState(false);
  const [metricsById3D, setMetricsById3D] = useState<Map<string, { community: number } & Record<string, number>> | null>(null);
  const [sizeMetric3D, setSizeMetric3D] = useState<SizeMetric>('pagerank');

  useEffect(() => {
    if (researchName) { getResearchGraph(researchName).then(setResearchData).catch((e) => console.error('research 3D load failed', e)); return; }
    if (lensId && lensRepo) { applyLens(lensId, lensRepo).then(setResearchData).catch((e) => console.error('lens 3D load failed', e)); return; }
    setResearchData(null);
  }, [researchName, lensId, lensRepo]);

  useEffect(() => {
    const active = !!(researchName || (lensId && lensRepo));
    if (!metricsOn || !active) { setMetricsById3D(null); return; }
    let cancelled = false;
    const p = researchName ? getGraphMetrics(researchName) : getGraphLensMetrics(lensId!, lensRepo!);
    p.then((mm) => { if (!cancelled) setMetricsById3D(new Map(mm.nodes.map((n) => [n.id, n as unknown as { community: number } & Record<string, number>]))); })
     .catch((e) => { if (!cancelled) console.error('3D metrics load failed', e); });
    return () => { cancelled = true; };
  }, [metricsOn, researchName, lensId, lensRepo]);
```

- [ ] **Step 4: `data` branch** — at the TOP of the `data` useMemo (line ~183, before `if (!graph) return …`), add the research/lens branch + extend deps:
```tsx
  const data = useMemo<{ nodes: Node3D[]; links: Link3D[] }>(() => {
    if (researchData) {
      const r = researchTo3D(researchData, metricsOn ? (metricsById3D ?? undefined) : undefined, sizeMetric3D);
      return { nodes: r.nodes as Node3D[], links: r.links as Link3D[] };
    }
    if (!graph) return { nodes: [], links: [] };
    // … existing code-graph build unchanged …
```
and add `researchData, metricsOn, metricsById3D, sizeMetric3D` to the useMemo deps array (line ~257).

- [ ] **Step 5: `onNodeClick` guard** (line ~454) — research nodes are display-only:
```tsx
          onNodeClick={(n) => {
            if (n.research || !n.raw) return;
            setSelectedNode(n.raw);
            openCodePanel();
          }}
```

- [ ] **Step 6: 3D overlay controls** — in the top-right control area (next to the "2D" button, ~line 562), add a metrics toggle + size selector, shown only for research/lens:
```tsx
        {(researchName || (lensId && lensRepo)) && (
          <button
            onClick={() => setMetricsOn((v) => !v)}
            className={metricsOn
              ? 'flex h-10 items-center gap-1.5 rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-3 text-indigo-200'
              : 'flex h-10 items-center gap-1.5 rounded-lg border border-border-subtle bg-elevated px-3 text-text-secondary transition-colors hover:bg-hover hover:text-text-primary'}
            data-testid="metrics-toggle-3d" title={metricsOn ? 'Hide metrics' : 'Show metrics'}
          ><span className="font-mono text-xs font-semibold">Metrics: {metricsOn ? 'on' : 'off'}</span></button>
        )}
        {metricsOn && (researchName || (lensId && lensRepo)) && (
          <select
            value={sizeMetric3D}
            onChange={(e) => setSizeMetric3D(e.target.value as SizeMetric)}
            className="flex h-10 items-center rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-3 font-mono text-xs font-semibold text-indigo-200"
            data-testid="metric-select-3d" title="Size metric"
          >
            <option value="degree">Degree</option><option value="pagerank">PageRank</option>
            <option value="betweenness">Betweenness</option><option value="eigenvector">Eigenvector</option>
            <option value="closeness">Closeness</option><option value="katz">Katz</option>
            <option value="harmonic">Harmonic</option><option value="coreness">k-core</option>
            <option value="clustering">Clustering</option>
          </select>
        )}
```
(Read the current top-right `<div className="absolute top-4 right-4 z-20">` block (~562) and place these buttons inside it, before/around the existing 2D button, so they share the control row.)

- [ ] **Step 7: Type-check** — `npx tsc -b --noEmit` if available, else the web image build (Final). Confirm: research-to-3d + services + ResearchGraph imported; `Node3D.raw` optional everywhere it's read is guarded; the `data` branch returns the right shape; deps updated; selector union cast; existing code-graph path + controls intact; JSX balanced.

- [ ] **Step 8: Commit** — controller.

---

## Final verification (controller)

1. **Drift** → exit 0.
2. **Unit:** `research-to-3d` (+ existing unaffected) → pass.
3. **Web image build** (tsc) → success.
4. **Browser-QA** (Playwright): up + import a `research-graph`, load `?research=<name>`, click the **3D** button → screenshot the 3D research graph; click 3D **Metrics: on** → nodes recolor (community) + resize; toggle the size selector; click **2D** → back to the 2D canvas. 0 console/page errors. Tear down.
5. **No server/MCP/Dockerfile.web change.**
6. Push is the **user's call** — summarize P3.3 shipped + P3.4 (multigraph nav) staged.
