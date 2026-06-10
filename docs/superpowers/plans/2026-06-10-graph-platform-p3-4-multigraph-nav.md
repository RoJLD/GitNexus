# Graph Platform P3.4 — multigraph navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A graphs-list endpoint + GraphSidebar that lists & opens scaffolded graphs + a node inspector — completing P3 (meta→graph→node→inspector).

**Architecture:** `GET /graph/list` reads the existing index; `GraphSidebar` (Stage 2) lists graphs and opens them via `?research=`; a pure `nodeInspectorData` + `NodeInspector.tsx` show a selected node's fields+metrics, wired off `useSigma.selectedNode`. No Dockerfile change; frontend additive.

**Tech Stack:** Node ESM, React/TypeScript, vitest, node:test (MCP).

**Spec:** `docs/superpowers/specs/2026-06-10-graph-platform-p3-4-multigraph-nav-design.md`

**Current state (verified):**
- `docker-server-graph-templates.mjs`: imports `readIndex` (line 11); `/graph/templates` route (line 25); `sendJson` available; scaffold writes records `{name, template, schema_type, source, created}` (line 34).
- `mcp-server/server.mjs`: `gitnexus_list_graph_templates` tool (`handler: () => callWeb('/graph/templates')`, ~line 501-505).
- `services/research-client.ts`: `getResearchGraph`, `applyLens`, `listTemplates`, `scaffoldGraph`, `importGraph`.
- `components/GraphSidebar.tsx`: Stage-1 stub (header + "+ New"); mounted in `App.tsx:565` under `?multigraph=1` with `onNewGraph={handleNewGraph}`.
- `components/GraphCanvas.tsx`: `useSigma` destructures `selectedNode: sigmaSelectedNode` (~line 314); `researchData` + `metricsById` state present; the render wrapper is `<div className="relative h-full w-full bg-void">` (line 636+), controls at z-20.

---

### Task 1: `/graph/list` + MCP + `listGraphs` + `node-inspector.ts` + tests

**Files:** Modify `upstream/docker-server-graph-templates.mjs`, `mcp-server/server.mjs`, `mcp-server/server.test.mjs`, `upstream/gitnexus-web/src/services/research-client.ts`; Create `upstream/gitnexus-web/src/lib/node-inspector.ts`, `tests/unit/node-inspector.test.mjs`, `tests/unit/research-client-graphs.test.mjs`.

- [ ] **Step 1: Failing tests**

(1a) `tests/unit/node-inspector.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { nodeInspectorData } from '../../upstream/gitnexus-web/src/lib/node-inspector.ts';
const RG = { nodes: [{ id: 'a', type: 'Hypothesis', label: 'H-A', path: 'p/a', stage: '' }], edges: [] };
describe('nodeInspectorData', () => {
  it('returns node fields for a known id; metrics when present, null otherwise', () => {
    expect(nodeInspectorData(RG, undefined, 'a')).toMatchObject({ id: 'a', type: 'Hypothesis', label: 'H-A', path: 'p/a', metrics: null });
    const m = new Map([['a', { degree: 2, community: 0 }]]);
    expect(nodeInspectorData(RG, m, 'a').metrics).toEqual({ degree: 2, community: 0 });
  });
  it('returns null for unknown id / null selection / null graph', () => {
    expect(nodeInspectorData(RG, undefined, 'zzz')).toBeNull();
    expect(nodeInspectorData(RG, undefined, null)).toBeNull();
    expect(nodeInspectorData(null, undefined, 'a')).toBeNull();
  });
});
```

(1b) `tests/unit/research-client-graphs.test.mjs`:
```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { listGraphs } from '../../upstream/gitnexus-web/src/services/research-client.ts';
afterEach(() => vi.unstubAllGlobals());
describe('listGraphs', () => {
  it('GETs /graph/list and returns body.graphs', async () => {
    const fake = { graphs: [{ name: 'qa', template: 'research-graph', schema_type: 'research-graph', source: 'x', created: 't' }] };
    const f = vi.fn(async () => ({ ok: true, json: async () => fake }));
    vi.stubGlobal('fetch', f);
    const r = await listGraphs();
    expect(f).toHaveBeenCalledWith('/graph/list');
    expect(r[0].name).toBe('qa');
  });
});
```

(1c) `mcp-server/server.test.mjs` — add (after the list_graph_templates assertions):
```js
  it("registers 'gitnexus_list_graphs' hitting /graph/list", () => {
    assert.ok(src.includes("name: 'gitnexus_list_graphs'"), 'TOOLS must contain gitnexus_list_graphs');
    assert.ok(src.includes("callWeb('/graph/list')"), 'handler must call /graph/list');
  });
```

- [ ] **Step 2: Run → fail** (`cd tests && npx vitest run --config vitest.config.unit.mjs node-inspector research-client-graphs`; `cd mcp-server && node --test server.test.mjs`).

- [ ] **Step 3: Implement**

(3a) `docker-server-graph-templates.mjs` — add the route right after the `/graph/templates` line (~25):
```js
  if (path === '/graph/list' && req.method === 'GET') { sendJson(res, 200, { graphs: (await readIndex()).graphs }); return true; }
```
(Confirm the handler function is `async` — the templates route is in an async handler; `readIndex` returns a promise. If the enclosing handler isn't async, await won't work — in that case use `readIndex().then((idx) => sendJson(res, 200, { graphs: idx.graphs }))`. Read the handler signature first.)

(3b) `mcp-server/server.mjs` — add after the `gitnexus_list_graph_templates` tool object:
```js
  {
    name: 'gitnexus_list_graphs',
    description: 'List the INSTANTIATED sidecar graphs the user has scaffolded (name, template, schema_type, source, created) — vs gitnexus_list_graph_templates which lists the available templates. Use to discover existing graphs to open/inspect.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => callWeb('/graph/list'),
  },
```

(3c) `research-client.ts` — add:
```ts
export interface GraphInstance { name: string; template: string; schema_type: string; source: string | null; created: string }
export async function listGraphs(): Promise<GraphInstance[]> {
  const res = await fetch('/graph/list');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return (body as { graphs?: GraphInstance[] }).graphs ?? [];
}
```

(3d) `upstream/gitnexus-web/src/lib/node-inspector.ts` (new):
```ts
import type { ResearchGraph } from './research-graph-adapter';

export interface InspectorData { id: string; type: string; label: string; path: string; metrics: Record<string, number> | null }

/** Look up the selected node in a ResearchGraph + attach its metrics row (if any). Pure; null when
 *  no selection / not found / no graph. */
export function nodeInspectorData(
  rg: ResearchGraph | null | undefined,
  metricsById: Map<string, Record<string, number>> | undefined,
  selectedId: string | null | undefined,
): InspectorData | null {
  if (!selectedId || !rg) return null;
  const node = (rg.nodes || []).find((n) => n.id === selectedId);
  if (!node) return null;
  return { id: node.id, type: node.type, label: node.label, path: node.path, metrics: metricsById?.get(selectedId) ?? null };
}
```

- [ ] **Step 4: Run → pass** (the 3 unit + MCP).

- [ ] **Step 5: Commit** — controller.

---

### Task 2: GraphSidebar Stage 2 + NodeInspector + GraphCanvas wiring

**Files:** Modify `upstream/gitnexus-web/src/components/GraphSidebar.tsx`; Create `upstream/gitnexus-web/src/components/NodeInspector.tsx`; Modify `upstream/gitnexus-web/src/components/GraphCanvas.tsx`. (Build-checked + browser-QA.)

- [ ] **Step 1: GraphSidebar Stage 2** — replace `GraphSidebar.tsx` with:
```tsx
import { useEffect, useState } from 'react';
import { listGraphs, type GraphInstance } from '../services/research-client';

interface GraphSidebarProps { onNewGraph?: () => void }

export function GraphSidebar({ onNewGraph }: GraphSidebarProps) {
  const [graphs, setGraphs] = useState<GraphInstance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listGraphs().then(setGraphs).catch((e) => setError(e instanceof Error ? e.message : 'failed to list graphs'));
  }, []);
  const active = new URLSearchParams(window.location.search).get('research');
  const open = (name: string) => { window.location.search = `?research=${encodeURIComponent(name)}`; };
  return (
    <aside className="flex h-full w-48 flex-col border-r border-border-subtle bg-elevated text-xs text-text-secondary" data-testid="graph-sidebar">
      <div className="flex items-center justify-between px-3 py-2 font-semibold text-text-primary">
        <span>Graphs</span>
        {onNewGraph && (<button onClick={onNewGraph} className="text-xs px-2 py-1 rounded hover:bg-slate-800">+ New</button>)}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {error && <div className="px-1 py-2 text-rose-300">{error}</div>}
        {graphs && graphs.length === 0 && <div className="px-1 py-2 text-text-muted">No graphs yet — + New</div>}
        {graphs?.map((g) => (
          <button
            key={g.name}
            onClick={() => open(g.name)}
            className={`mb-1 flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-hover ${active === g.name ? 'bg-indigo-500/15 text-indigo-200' : 'text-text-secondary'}`}
            data-testid="graph-sidebar-item"
          >
            <span className="truncate font-mono" title={g.name}>{g.name}</span>
            <span className="rounded bg-slate-800 px-1 text-[10px] text-text-muted">{g.schema_type}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: `NodeInspector.tsx`** (new):
```tsx
import { nodeInspectorData, type InspectorData } from '../lib/node-inspector';
import type { ResearchGraph } from '../lib/research-graph-adapter';

const METRIC_KEYS = ['degree', 'pagerank', 'betweenness', 'eigenvector', 'closeness', 'katz', 'harmonic', 'coreness', 'clustering', 'community'];

interface NodeInspectorProps {
  researchData: ResearchGraph | null;
  metricsById?: Map<string, Record<string, number>>;
  selectedId: string | null;
}

export function NodeInspector({ researchData, metricsById, selectedId }: NodeInspectorProps) {
  const d: InspectorData | null = nodeInspectorData(researchData, metricsById, selectedId);
  if (!d) return null;
  return (
    <div className="absolute left-4 top-16 z-20 w-64 rounded-lg border border-border-subtle bg-elevated/95 p-3 font-mono text-xs text-text-secondary shadow-lg" data-testid="node-inspector">
      <div className="mb-2 truncate font-semibold text-text-primary" title={d.id}>{d.label || d.id}</div>
      <div className="space-y-0.5">
        <div><span className="text-text-muted">type</span> {d.type}</div>
        {d.path && <div className="truncate" title={d.path}><span className="text-text-muted">path</span> {d.path}</div>}
      </div>
      {d.metrics && (
        <div className="mt-2 border-t border-border-subtle pt-2">
          {METRIC_KEYS.filter((k) => d.metrics![k] !== undefined).map((k) => (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-text-muted">{k}</span>
              <span className="text-indigo-300">{k === 'community' || k === 'degree' || k === 'coreness' ? d.metrics![k] : (d.metrics![k] as number).toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: GraphCanvas wiring**
  - Import: `import { NodeInspector } from './NodeInspector';`
  - Render the inspector inside the `relative h-full w-full` wrapper (after the matrix overlay block / before the controls), gated on the research/lens view:
```tsx
      {(researchName || (lensId && lensRepo)) && view !== 'matrix' && (
        <NodeInspector researchData={researchData} metricsById={metricsById ?? undefined} selectedId={sigmaSelectedNode} />
      )}
```
  (`sigmaSelectedNode` is `useSigma`'s `selectedNode` — already destructured. `metricsById` is the existing `Map<string, …>` state; `NodeInspector` accepts `Map<string, Record<string,number>>` — the existing map's value type is a superset of `Record<string,number>` for the numeric keys; if TS complains, pass `metricsById as unknown as Map<string, Record<string, number>> ?? undefined` or widen the prop. Read the metricsById state type and reconcile.)

- [ ] **Step 4: Type-check** — `npx tsc -b --noEmit` if available, else the web image build (Final). Confirm: listGraphs/GraphInstance imported in GraphSidebar; NodeInspector + nodeInspectorData wired; the metricsById prop type reconciled; selectedId = sigmaSelectedNode; JSX balanced; existing controls intact.

- [ ] **Step 5: Commit** — controller.

---

## Final verification (controller)

1. **Drift** → exit 0.
2. **Unit:** `node-inspector` + `research-client-graphs` → pass; **MCP** `node --test server.test.mjs` → pass.
3. **Web image build** (tsc) → success.
4. **Browser-QA** (Playwright, fully exercisable — index is writable): scaffold+import a `research-graph` (`qa`), load `?multigraph=1&research=qa` → `graph-sidebar` lists `qa` (`graph-sidebar-item` present, active highlighted); click a node on the canvas → `node-inspector` shows the node's type/path + metrics (toggle Metrics on first). Optionally scaffold a 2nd graph and click it in the sidebar → navigates. 0 console/page errors. Tear down.
5. **No Dockerfile.web change** (only edits already-COPY'd modules + frontend).
6. Push is the **user's call** — summarize P3.4 shipped → **P3 complete → the whole Graph Platform (P0–P3) done**.
