# Graph Platform P2.3.3a — community picker + top-N panel + metrics export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a community-method picker, a top-N panel, and JSON/CSV export to the metrics overlay, with the ranking/serialization logic in a unit-tested pure module.

**Architecture:** Pure logic → `upstream/gitnexus-web/src/lib/metrics-view.ts` (unit-tested). The client fns gain a `{community?}` option. GraphCanvas wires the picker (re-fetch), the panel, and the export controls. Frontend-only — no server/MCP/Dockerfile change.

**Tech Stack:** React/TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-graph-platform-p2-3-3a-picker-topn-export-design.md`

**Current state (verified):**
- `services/graph-theory-client.ts`: `GraphMetricNode`, `GraphMetrics` (summary has optional `capped?`/`omittedMetrics?`), `SizeMetric` union (9 metrics), `getGraphMetrics(name)`, `getGraphLensMetrics(lensId, repo)`.
- `components/GraphCanvas.tsx`: `metricsOn`/`metricsById`/`sizeMetric` state (lines ~126-128); the metrics-fetch effect (~141-156) gated `metricsOn && (researchName || (lensId && lensRepo))`, picks `getGraphMetrics(researchName)` / `getGraphLensMetrics(lensId!, lensRepo!)`, sets `metricsById`; the Metrics toggle (~890) + size `<select data-testid="metric-select">` (~904).

---

### Task 1: pure `metrics-view.ts` + client community option + tests

**Files:** Create `upstream/gitnexus-web/src/lib/metrics-view.ts`; Modify `upstream/gitnexus-web/src/services/graph-theory-client.ts`; Test `tests/unit/metrics-view.test.mjs` (new) + `tests/unit/graph-theory-client.test.mjs` (extend).

- [ ] **Step 1: Failing tests**

Create `tests/unit/metrics-view.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { topNByMetric, metricsToCsv, metricsToJson } from '../../upstream/gitnexus-web/src/lib/metrics-view.ts';

const N = (id, over = {}) => ({ id, degree: 0, pagerank: 0, betweenness: 0, eigenvector: 0, closeness: 0, katz: 0, harmonic: 0, coreness: 0, clustering: 0, articulation: false, componentId: 0, community: 0, ...over });
const NODES = [N('a', { pagerank: 0.1 }), N('b', { pagerank: 0.9 }), N('c', { pagerank: 0.5 }), N('d', { pagerank: 0.5 })];

describe('topNByMetric', () => {
  it('sorts descending by the metric, ties broken by id asc, clamps n', () => {
    expect(topNByMetric(NODES, 'pagerank', 2).map((n) => n.id)).toEqual(['b', 'c']);     // 0.9, then 0.5 (c before d by id)
    expect(topNByMetric(NODES, 'pagerank', 99).map((n) => n.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(topNByMetric(NODES, 'pagerank', 0)).toEqual([]);
    expect(topNByMetric([], 'pagerank', 5)).toEqual([]);
  });
});
describe('metricsToCsv', () => {
  it('emits a header + one row per node, with basic escaping', () => {
    const csv = metricsToCsv([N('x'), N('a,b')]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('id,degree,pagerank,betweenness,eigenvector,closeness,katz,harmonic,coreness,clustering,articulation,componentId,community');
    expect(lines).toHaveLength(3);
    expect(lines[2].startsWith('"a,b",')).toBe(true);   // comma-containing id quoted
  });
});
describe('metricsToJson', () => {
  it('round-trips the payload', () => {
    const payload = { nodes: [N('x')], bridges: [{ source: 'x', target: 'y' }], summary: { nodeCount: 1, edgeCount: 0, communityCount: 1, modularity: 0, density: 0, componentCount: 1, transitivity: 0 } };
    const back = JSON.parse(metricsToJson(payload));
    expect(back.nodes[0].id).toBe('x'); expect(back.bridges).toHaveLength(1); expect(back.summary.nodeCount).toBe(1);
  });
});
```

Extend `tests/unit/graph-theory-client.test.mjs` (add inside the existing describes or a new one):
```js
describe('client community option', () => {
  it('getGraphMetrics appends ?community=', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ nodes: [], bridges: [], summary: {} }) }));
    vi.stubGlobal('fetch', f);
    await getGraphMetrics('g', { community: 'leiden' });
    expect(f).toHaveBeenCalledWith('/graph/metrics/g?community=leiden');
  });
  it('getGraphLensMetrics appends &community=', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ nodes: [], bridges: [], summary: {} }) }));
    vi.stubGlobal('fetch', f);
    await getGraphLensMetrics('imports-deps', 'r', { community: 'labelprop' });
    expect(f).toHaveBeenCalledWith('/graph/metrics/lens/imports-deps?repo=r&community=labelprop');
  });
});
```
(Ensure the existing no-opts client tests still assert the bare URLs `/graph/metrics/my%20graph` and `/graph/metrics/lens/imports-deps?repo=my%20repo`.)

- [ ] **Step 2: Run → fail** (`cd tests && npx vitest run --config vitest.config.unit.mjs metrics-view graph-theory-client`).

- [ ] **Step 3: Implement**

(3a) Create `upstream/gitnexus-web/src/lib/metrics-view.ts`:
```ts
import type { GraphMetricNode, GraphMetrics, SizeMetric } from '../services/graph-theory-client';

const CSV_COLS: (keyof GraphMetricNode)[] = ['id', 'degree', 'pagerank', 'betweenness', 'eigenvector', 'closeness', 'katz', 'harmonic', 'coreness', 'clustering', 'articulation', 'componentId', 'community'];

/** Top-N nodes by a numeric metric, descending; ties broken by id ascending; n clamped to [0, len]. */
export function topNByMetric(nodes: GraphMetricNode[], metric: SizeMetric, n: number): GraphMetricNode[] {
  const sorted = [...nodes].sort((a, b) => (b[metric] - a[metric]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted.slice(0, Math.max(0, n));
}

function csvCell(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Metrics nodes → CSV (fixed column order, basic RFC-4180-ish escaping). */
export function metricsToCsv(nodes: GraphMetricNode[]): string {
  const header = CSV_COLS.join(',');
  const rows = nodes.map((nd) => CSV_COLS.map((c) => csvCell(nd[c] as string | number | boolean)).join(','));
  return [header, ...rows].join('\n') + '\n';
}

/** Pretty-printed JSON of the full metrics payload. */
export function metricsToJson(metrics: GraphMetrics): string {
  return JSON.stringify(metrics, null, 2);
}

/** DOM download helper (not unit-tested — trivial Blob+anchor). */
export function downloadText(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
```

(3b) `graph-theory-client.ts` — add the option type + thread it. Replace the two fns + add the type:
```ts
export type CommunityMethod = 'louvain' | 'leiden' | 'labelprop';
export interface MetricsOpts { community?: CommunityMethod; resolution?: number }

function metricsQuery(opts?: MetricsOpts, base?: URLSearchParams): string {
  const q = base ?? new URLSearchParams();
  if (opts?.community) q.set('community', opts.community);
  if (opts?.resolution !== undefined) q.set('resolution', String(opts.resolution));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export async function getGraphMetrics(name: string, opts?: MetricsOpts): Promise<GraphMetrics> {
  const res = await fetch(`/graph/metrics/${encodeURIComponent(name)}${metricsQuery(opts)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as GraphMetrics;
}

export async function getGraphLensMetrics(lensId: string, repo: string, opts?: MetricsOpts): Promise<GraphMetrics> {
  const base = new URLSearchParams({ repo });
  const res = await fetch(`/graph/metrics/lens/${encodeURIComponent(lensId)}${metricsQuery(opts, base)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as GraphMetrics;
}
```
Also add the optional P2.3.2c summary fields to the `GraphMetrics.summary` type (additive): `approximate?: boolean; sampleSize?: number | null`.

> **Encoding note:** for the lens no-opts case, `new URLSearchParams({repo:'my repo'}).toString()` yields `repo=my+repo` (space → `+`), whereas the existing test expects `repo=my%20repo`. To keep the existing test green, build the lens URL as `?repo=${encodeURIComponent(repo)}` and append `metricsQuery` extras with a leading `&` when present, rather than via URLSearchParams for the repo. Concretely:
> ```ts
> export async function getGraphLensMetrics(lensId: string, repo: string, opts?: MetricsOpts): Promise<GraphMetrics> {
>   const extra = metricsQuery(opts).replace(/^\?/, '');
>   const qs = `?repo=${encodeURIComponent(repo)}${extra ? `&${extra}` : ''}`;
>   const res = await fetch(`/graph/metrics/lens/${encodeURIComponent(lensId)}${qs}`);
>   ...
> }
> ```
> This yields `/graph/metrics/lens/imports-deps?repo=my%20repo` (no opts) and `?repo=r&community=labelprop` (with opts) — both as the tests expect.

- [ ] **Step 4: Run → pass** (`metrics-view` + `graph-theory-client`, incl. the existing bare-URL tests).

- [ ] **Step 5: Commit** — controller.

---

### Task 2: GraphCanvas — community picker + top-N panel + export controls

**Files:** Modify `upstream/gitnexus-web/src/components/GraphCanvas.tsx`.

(Build-checked via the web image; no unit test for the React wiring — the pure logic is covered in Task 1. Read the current lines first to anchor edits.)

- [ ] **Step 1: State + imports**

- Import the lib + types:
```tsx
import { getGraphMetrics, getGraphLensMetrics, type CommunityMethod } from '../services/graph-theory-client';
import type { GraphMetrics } from '../services/graph-theory-client';
import { topNByMetric, metricsToCsv, metricsToJson, downloadText } from '../lib/metrics-view';
```
- Add state near the existing metrics state (after line ~128):
```tsx
  const [communityMethod, setCommunityMethod] = useState<CommunityMethod>('louvain');
  const [metricsData, setMetricsData] = useState<GraphMetrics | null>(null);
  const [topNOpen, setTopNOpen] = useState(false);
```

- [ ] **Step 2: Thread the picker into the fetch effect**

Replace the fetch effect (lines ~141-156) so it passes `{ community: communityMethod }` and stores the full payload + adds `communityMethod` to deps:
```tsx
  useEffect(() => {
    const lensActive = !!(lensId && lensRepo);
    if (!metricsOn || (!researchName && !lensActive)) {
      setMetricsById(null); setMetricsData(null);
      return;
    }
    let cancelled = false;
    const opts = { community: communityMethod };
    const p = researchName ? getGraphMetrics(researchName, opts) : getGraphLensMetrics(lensId!, lensRepo!, opts);
    p
      .then((m) => {
        if (cancelled) return;
        setMetricsData(m);
        setMetricsById(new Map(m.nodes.map((n) => [n.id, { degree: n.degree, pagerank: n.pagerank, betweenness: n.betweenness, eigenvector: n.eigenvector, closeness: n.closeness, katz: n.katz, harmonic: n.harmonic, coreness: n.coreness, clustering: n.clustering, community: n.community }])));
      })
      .catch((e) => { if (!cancelled) console.error('graph metrics load failed', e); });
    return () => { cancelled = true; };
  }, [metricsOn, researchName, lensId, lensRepo, communityMethod]);
```

- [ ] **Step 3: UI controls** — in the overlay cluster where the size `<select data-testid="metric-select">` lives (gated `metricsOn && (researchName || (lensId && lensRepo))`), add, alongside it:

```tsx
          <select
            value={communityMethod}
            onChange={(e) => setCommunityMethod(e.target.value as CommunityMethod)}
            className="flex h-10 items-center rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-3 font-mono text-xs font-semibold text-indigo-200 transition-colors hover:border-indigo-300/60 hover:bg-indigo-500/20"
            data-testid="community-select"
            title="Community-detection method"
          >
            <option value="louvain">Louvain</option>
            <option value="leiden">Leiden</option>
            <option value="labelprop">Label prop</option>
          </select>
          <button
            onClick={() => setTopNOpen((v) => !v)}
            className="flex h-10 items-center gap-1.5 rounded-lg border border-border-subtle bg-elevated px-3 text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            title="Top nodes by the selected metric"
            data-testid="topn-toggle"
          >
            <span className="font-mono text-xs font-semibold">Top 10</span>
          </button>
          {metricsData && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => downloadText('graph-metrics.json', 'application/json', metricsToJson(metricsData))}
                className="flex h-10 items-center rounded-lg border border-border-subtle bg-elevated px-2 text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                title="Export metrics as JSON" data-testid="export-json"
              ><span className="font-mono text-xs font-semibold">JSON</span></button>
              <button
                onClick={() => downloadText('graph-metrics.csv', 'text/csv', metricsToCsv(metricsData.nodes))}
                className="flex h-10 items-center rounded-lg border border-border-subtle bg-elevated px-2 text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                title="Export metrics as CSV" data-testid="export-csv"
              ><span className="font-mono text-xs font-semibold">CSV</span></button>
            </div>
          )}
```

And the top-N panel (absolutely positioned, below the top-right control cluster; rendered when `topNOpen && metricsData`):
```tsx
        {topNOpen && metricsData && (
          <div className="absolute right-4 top-16 z-20 w-64 rounded-lg border border-border-subtle bg-elevated/95 p-3 font-mono text-xs text-text-secondary shadow-lg" data-testid="topn-panel">
            <div className="mb-2 font-semibold text-text-primary">Top 10 by {sizeMetric}</div>
            <ol className="space-y-1">
              {topNByMetric(metricsData.nodes, sizeMetric, 10).map((n) => (
                <li key={n.id} className="flex justify-between gap-2">
                  <span className="truncate" title={n.id}>{n.id.split('/').pop() || n.id}</span>
                  <span className="shrink-0 text-indigo-300">{(n[sizeMetric] as number).toFixed(4)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
```
(Place the panel block adjacent to the existing top-right control cluster, inside the same absolutely-positioned region — read the surrounding JSX to position it so it doesn't overlap the controls. Adjust `top-16`/positioning to sit below the control row.)

- [ ] **Step 4: Type-check** — `cd upstream/gitnexus-web && npx tsc -b --noEmit` if available, else rely on the web image build (Final). Fix any type errors in the edited file.

- [ ] **Step 5: Commit** — controller.

---

## Final verification (controller)

1. **Drift** → exit 0.
2. **Unit (host-native):** `metrics-view` + `graph-theory-client` (incl. the existing bare-URL tests) → pass.
3. **Web build type-check** — via the test stack build (the only reliable tsc here): `docker compose -f docker-compose.test.yml up -d --build` succeeding ⇒ the GraphCanvas wiring type-checks. (Or a local `tsc` if deps are present.)
4. **No server/MCP/Dockerfile.web change** — confirm `git diff` touches only `gitnexus-web/` + the new lib + tracked tests.
5. **Visual QA** — NOT performed here (no browser path); the panel/control layout is unverified visually. Flag this in the summary.
6. Push is the **user's call** — summarize P2.3.3a shipped + P2.3.3b (heatmap/highlight/filter) staged next + the visual-QA debt.
