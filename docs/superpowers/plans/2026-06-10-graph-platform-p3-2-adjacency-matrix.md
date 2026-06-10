# Graph Platform P3.2 — adjacency-matrix view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A graph↔matrix view toggle on the research/lens canvas; a canvas-rendered, community-ordered adjacency matrix.

**Architecture:** Pure `orderNodes`/`matrixCells` (unit-tested) → a canvas `AdjacencyMatrix` component → a `view` toggle in GraphCanvas that overlays the matrix on the sigma container. Dep-free, frontend-only.

**Tech Stack:** React/TypeScript, canvas 2D, vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-graph-platform-p3-2-adjacency-matrix-design.md`

**Current state:**
- `lib/research-graph-adapter.ts:5`: `const COMMUNITY_PALETTE = [...]` (NOT exported — 10 hex colors).
- `components/GraphCanvas.tsx`: `metricsData` (full `GraphMetrics` | null) state; the sigma `containerRef` div at lines 651-654 inside `return (<div className="relative h-full w-full bg-void">…)` (line 635); overlay controls absolutely-positioned (z-20) further down; `researchData` (ResearchGraph|null) is the research/lens render data.

---

### Task 1: pure `adjacency-matrix.ts` + export palette + unit test

**Files:** Create `upstream/gitnexus-web/src/lib/adjacency-matrix.ts`; Modify `upstream/gitnexus-web/src/lib/research-graph-adapter.ts` (export the palette); Test `tests/unit/adjacency-matrix.test.mjs` (new).

- [ ] **Step 1: Failing tests** — create `tests/unit/adjacency-matrix.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { orderNodes, matrixCells } from '../../upstream/gitnexus-web/src/lib/adjacency-matrix.ts';

const M = (o) => new Map(Object.entries(o)); // {id:{community,degree}}

describe('orderNodes', () => {
  it('community mode groups same community contiguously (ties by id)', () => {
    const m = M({ a: { community: 0, degree: 1 }, b: { community: 1, degree: 1 }, c: { community: 0, degree: 1 } });
    expect(orderNodes(['a', 'b', 'c'], m, 'community')).toEqual(['a', 'c', 'b']);
  });
  it('degree mode sorts desc (ties by id)', () => {
    const m = M({ a: { community: 0, degree: 1 }, b: { community: 0, degree: 5 }, c: { community: 0, degree: 5 } });
    expect(orderNodes(['a', 'b', 'c'], m, 'degree')).toEqual(['b', 'c', 'a']);
  });
  it('input mode / no metrics passes through', () => {
    expect(orderNodes(['x', 'y'], undefined, 'community')).toEqual(['x', 'y']);
    expect(orderNodes(['x', 'y'], M({ x: { community: 1, degree: 0 } }), 'input')).toEqual(['x', 'y']);
  });
});
describe('matrixCells', () => {
  it('fills both (i,j) and (j,i) for an edge; drops self-loops + danglers', () => {
    const c = matrixCells(['a', 'b', 'c'], [{ source: 'a', target: 'b' }, { source: 'c', target: 'c' }, { source: 'a', target: 'zzz' }]);
    expect(c.has('0,1')).toBe(true);
    expect(c.has('1,0')).toBe(true);
    expect(c.has('2,2')).toBe(false);    // self-loop dropped
    expect([...c].length).toBe(2);        // only a-b (both dirs)
  });
});
```

- [ ] **Step 2: Run → fail** (`cd tests && npx vitest run --config vitest.config.unit.mjs adjacency-matrix`).

- [ ] **Step 3: Implement**

(3a) `research-graph-adapter.ts` line 5 — export the palette: change `const COMMUNITY_PALETTE = [` to `export const COMMUNITY_PALETTE = [` (everything else unchanged).

(3b) Create `upstream/gitnexus-web/src/lib/adjacency-matrix.ts`:
```ts
export type MatrixOrder = 'community' | 'degree' | 'input';
export interface MatrixNodeMetric { community: number; degree: number }

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Order node ids for the matrix. community → grouped by community asc then id; degree → desc then id;
 *  input (or no metrics) → as given. Deterministic, non-mutating. */
export function orderNodes(ids: string[], metricsById: Map<string, MatrixNodeMetric> | undefined, mode: MatrixOrder): string[] {
  const arr = [...ids];
  if (!metricsById || mode === 'input') return arr;
  if (mode === 'community') {
    return arr.sort((a, b) => ((metricsById.get(a)?.community ?? -1) - (metricsById.get(b)?.community ?? -1)) || byId(a, b));
  }
  return arr.sort((a, b) => ((metricsById.get(b)?.degree ?? 0) - (metricsById.get(a)?.degree ?? 0)) || byId(a, b));
}

/** Occupancy set of "row,col" index strings (UNDIRECTED — both (i,j) and (j,i); self-loops + danglers dropped). */
export function matrixCells(orderedIds: string[], edges: { source: string; target: string }[]): Set<string> {
  const idx = new Map<string, number>();
  orderedIds.forEach((id, i) => idx.set(id, i));
  const cells = new Set<string>();
  for (const e of edges || []) {
    if (!e) continue;
    const i = idx.get(e.source);
    const j = idx.get(e.target);
    if (i === undefined || j === undefined || i === j) continue;
    cells.add(`${i},${j}`);
    cells.add(`${j},${i}`);
  }
  return cells;
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** — controller.

---

### Task 2: `AdjacencyMatrix.tsx` (canvas) + GraphCanvas view toggle

**Files:** Create `upstream/gitnexus-web/src/components/AdjacencyMatrix.tsx`; Modify `upstream/gitnexus-web/src/components/GraphCanvas.tsx`. (Build-checked + browser-QA.)

- [ ] **Step 1: Create `AdjacencyMatrix.tsx`**
```tsx
import { useEffect, useMemo, useRef } from 'react';
import { orderNodes, matrixCells, type MatrixOrder, type MatrixNodeMetric } from '../lib/adjacency-matrix';
import { COMMUNITY_PALETTE } from '../lib/research-graph-adapter';

const MATRIX_MAX = 400;

interface AdjacencyMatrixProps {
  nodes: { id: string }[];
  edges: { source: string; target: string }[];
  metricsById?: Map<string, MatrixNodeMetric>;
  order: MatrixOrder;
}

export function AdjacencyMatrix({ nodes, edges, metricsById, order }: AdjacencyMatrixProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { ordered, capped, total } = useMemo(() => {
    const ids = orderNodes(nodes.map((n) => n.id), metricsById, order);
    const tot = ids.length;
    if (ids.length <= MATRIX_MAX) return { ordered: ids, capped: false, total: tot };
    const byDeg = [...ids].sort((a, b) => (metricsById?.get(b)?.degree ?? 0) - (metricsById?.get(a)?.degree ?? 0));
    return { ordered: orderNodes(byDeg.slice(0, MATRIX_MAX), metricsById, order), capped: true, total: tot };
  }, [nodes, metricsById, order]);

  const cells = useMemo(() => matrixCells(ordered, edges), [ordered, edges]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const draw = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, w * dpr);
      canvas.height = Math.max(1, h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const N = ordered.length;
      if (N === 0) return;
      const size = Math.max(1, Math.floor(Math.min(w, h) / N));
      for (const key of cells) {
        const comma = key.indexOf(',');
        const i = Number(key.slice(0, comma));
        const j = Number(key.slice(comma + 1));
        const c = metricsById?.get(ordered[i])?.community;
        ctx.fillStyle = c !== undefined ? COMMUNITY_PALETTE[c % COMMUNITY_PALETTE.length] : '#60a5fa';
        ctx.fillRect(j * size, i * size, size, size);
      }
      if (N <= 60) {
        ctx.strokeStyle = 'rgba(148,163,184,0.12)';
        ctx.lineWidth = 1;
        for (let k = 0; k <= N; k++) {
          ctx.beginPath(); ctx.moveTo(k * size, 0); ctx.lineTo(k * size, N * size); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, k * size); ctx.lineTo(N * size, k * size); ctx.stroke();
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [ordered, cells, metricsById]);

  return (
    <div ref={wrapRef} className="relative h-full w-full" data-testid="adjacency-matrix">
      <canvas ref={canvasRef} />
      <div className="pointer-events-none absolute bottom-2 left-2 font-mono text-xs text-text-secondary">
        Adjacency matrix — {ordered.length}{capped ? ` of ${total} (top by degree)` : ''} nodes
      </div>
    </div>
  );
}
```

- [ ] **Step 2: GraphCanvas wiring** (read the current lines to anchor)

(2a) Imports (~line 48 area):
```tsx
import { AdjacencyMatrix } from './AdjacencyMatrix';
import type { MatrixNodeMetric } from '../lib/adjacency-matrix';
```

(2b) State (near the other graph-view state, after `layoutMode` ~line 131):
```tsx
  const [view, setView] = useState<'graph' | 'matrix'>('graph');
```

(2c) Memo (near the other metrics memos):
```tsx
  const matrixMetrics = useMemo(
    () => new Map<string, MatrixNodeMetric>((metricsData?.nodes ?? []).map((n) => [n.id, { community: n.community, degree: n.degree }])),
    [metricsData],
  );
```

(2d) Overlay control — a view toggle in the cluster (gated on the graph view, independent of metrics), near the layout-select:
```tsx
        {(researchName || (lensId && lensRepo)) && (
          <select
            value={view}
            onChange={(e) => setView(e.target.value as 'graph' | 'matrix')}
            className="flex h-10 items-center rounded-lg border border-border-subtle bg-elevated px-3 font-mono text-xs font-semibold text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            data-testid="view-select" title="Render mode"
          >
            <option value="graph">View: graph</option>
            <option value="matrix">View: matrix</option>
          </select>
        )}
```

(2e) Render the matrix overlay — immediately AFTER the sigma `containerRef` div (line 654), inside the same `relative h-full w-full` wrapper:
```tsx
      {view === 'matrix' && researchData && (
        <div className="absolute inset-0 z-10 bg-void">
          <AdjacencyMatrix
            nodes={researchData.nodes}
            edges={researchData.edges}
            metricsById={metricsOn ? matrixMetrics : undefined}
            order={metricsOn ? 'community' : 'input'}
          />
        </div>
      )}
```
(z-10 sits above the sigma container, below the z-20 controls. The sigma container stays mounted.)

- [ ] **Step 3: Type-check** — `npx tsc -b --noEmit` if available, else the web image build (Final). Confirm `AdjacencyMatrix` + `MatrixNodeMetric` imported; `COMMUNITY_PALETTE` exported from the adapter + imported in the component; `matrixMetrics` memo typed; the `view` union cast; JSX balanced; existing controls + layout-select intact.

- [ ] **Step 4: Commit** — controller.

---

## Final verification (controller)

1. **Drift** → exit 0.
2. **Unit:** `adjacency-matrix` (+ existing `layered-layout`/`metrics-view` unaffected) → pass.
3. **Web image build** (tsc): `docker compose -f docker-compose.test.yml build gitnexus-web-test` → success.
4. **Browser-QA** (Playwright): up + import a `research-graph`, load `?research=<name>`, toggle `view-select` → Matrix → screenshot the matrix canvas (community-colored cells / diagonal blocks); toggle the community-method picker (with Metrics on) → re-order; toggle back to Graph → sigma returns. 0 console/page errors. Tear down.
5. **No server/MCP/Dockerfile.web change.**
6. Push is the **user's call** — summarize P3.2 shipped + P3.3/3.4 staged.
