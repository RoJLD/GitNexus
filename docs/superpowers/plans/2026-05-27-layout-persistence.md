# Layout Persistence + Pre-compute Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Persister les positions FA2 par snapshot dans localStorage + worker de pre-compute pendant Preload + bouton "Recompute layout" manuel. Résout 2 bugs UX (Play roadmap = grand reload + layout always from-scratch).

**Architecture:** 100% frontend. `lib/layout-cache.ts` (localStorage) + `lib/layout-worker.ts` (Vite `?worker` import). `useSigma.setGraph(graph, { cacheKey })` restore positions si hit, skip layout. `runLayout` save sur convergence. `useAppState.preloadAllSnapshots` spawn worker pool de 2. Header bouton "Recompute layout".

**Tech Stack:** TypeScript + Vite (worker import), zero new deps. Réutilise `graphology-layout-forceatlas2` déjà dans le bundle.

**Spec source:** [docs/superpowers/specs/2026-05-27-layout-persistence-design.md](../specs/2026-05-27-layout-persistence-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branch `deployment`).

**Implementer reminders:**
1. `upstream/gitnexus-web/src/**` is gitignored — regen `patches/upstream-all.diff` after each task.
2. Commit identity `roblastar@live.fr`.
3. `node --check` on `.ts` files will fail (TS syntax). Validate via TS-pass when docker build later succeeds.

---

## File Structure

```
upstream/gitnexus-web/src/
├── lib/
│   ├── layout-cache.ts                NEW  localStorage Map<cacheKey, positions>
│   └── layout-worker.ts               NEW  Worker source (FA2 in background)
├── hooks/
│   ├── useSigma.ts                    MOD  setGraph(graph, {cacheKey}), runLayout save on convergence, recomputeLayout
│   └── useAppState.tsx                MOD  thread cacheKey through switchRepo, spawn worker in preloadAllSnapshots
└── components/
    ├── Header.tsx                     MOD  +button "Recompute layout"
    └── GraphCanvas.tsx                MOD  (no change — wire is via useSigma + useAppState)

tests/unit/layout-cache.test.mjs       NEW
INVENTORY.md / ROADMAP.md              MOD pointer note
docs/superpowers/specs/2026-05-27-layout-persistence-design.md  MOD  Update — Shipped
patches/upstream-all.diff              REGEN
```

---

## Section A — Cache primitive (Task 1)

### Task 1: `layout-cache.ts` + tests

**Files:**
- Create: `upstream/gitnexus-web/src/lib/layout-cache.ts`
- Create: `tests/unit/layout-cache.test.mjs`

```ts
const STORAGE_PREFIX = 'gitnexus:layout:v1:';
const SCHEMA_VERSION = 1 as const;

export type CachedLayout = {
  version: typeof SCHEMA_VERSION;
  cacheKey: string;
  computedAt: string;
  nodeCount: number;
  positions: Record<string, { x: number; y: number }>;
};

export function saveLayoutPositions(cacheKey: string, positions: Record<string, { x: number; y: number }>): void {
  if (!cacheKey || typeof window === 'undefined' || !window.localStorage) return;
  const payload: CachedLayout = {
    version: SCHEMA_VERSION,
    cacheKey,
    computedAt: new Date().toISOString(),
    nodeCount: Object.keys(positions).length,
    positions,
  };
  try {
    window.localStorage.setItem(STORAGE_PREFIX + cacheKey, JSON.stringify(payload));
  } catch (e) {
    // QuotaExceededError or similar — best-effort, don't crash UI.
    console.warn('[layout-cache] save failed for', cacheKey, e);
  }
}

export function saveLayoutFromGraph(cacheKey: string, graph: { forEachNode: (cb: (id: string, attrs: any) => void) => void; order: number }): void {
  const positions: Record<string, { x: number; y: number }> = {};
  graph.forEachNode((id, attrs) => {
    if (typeof attrs.x === 'number' && typeof attrs.y === 'number') {
      positions[id] = { x: attrs.x, y: attrs.y };
    }
  });
  saveLayoutPositions(cacheKey, positions);
}

export function loadLayout(cacheKey: string): CachedLayout | null {
  if (!cacheKey || typeof window === 'undefined' || !window.localStorage) return null;
  const raw = window.localStorage.getItem(STORAGE_PREFIX + cacheKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== SCHEMA_VERSION) return null;
    if (typeof parsed.cacheKey !== 'string' || !parsed.positions) return null;
    return parsed as CachedLayout;
  } catch {
    return null;
  }
}

export function applyLayoutToGraph(
  cached: CachedLayout,
  graph: { forEachNode: (cb: (id: string, attrs: any) => void) => void; setNodeAttribute: (id: string, key: string, value: any) => void; order: number },
): { applied: number; missing: number } {
  let applied = 0;
  let missing = 0;
  graph.forEachNode((id) => {
    const p = cached.positions[id];
    if (p) {
      graph.setNodeAttribute(id, 'x', p.x);
      graph.setNodeAttribute(id, 'y', p.y);
      applied++;
    } else {
      missing++;
    }
  });
  return { applied, missing };
}

export function clearLayout(cacheKey: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.removeItem(STORAGE_PREFIX + cacheKey);
}

export function clearAllLayouts(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
  }
  for (const k of keys) window.localStorage.removeItem(k);
}
```

Test (use a localStorage shim — vitest provides `vi.fn` + Object.defineProperty for window.localStorage if needed) :
```js
import { describe, it, expect, beforeEach } from 'vitest';
import { saveLayoutPositions, loadLayout, applyLayoutToGraph, clearLayout, clearAllLayouts } from '../../upstream/gitnexus-web/src/lib/layout-cache.ts';

// Minimal localStorage shim for Node test runtime.
function setupLocalStorage() {
  const store = new Map<string, string>();
  globalThis.window = {
    localStorage: {
      getItem: (k) => store.has(k) ? store.get(k)! : null,
      setItem: (k, v) => { store.set(k, v); },
      removeItem: (k) => { store.delete(k); },
      get length() { return store.size; },
      key: (i) => [...store.keys()][i] ?? null,
    },
  } as any;
  return store;
}

describe('layout-cache', () => {
  beforeEach(() => { setupLocalStorage(); });

  it('save then load round-trip', () => {
    saveLayoutPositions('repo@sha1', { n1: { x: 10, y: 20 }, n2: { x: 30, y: 40 } });
    const c = loadLayout('repo@sha1');
    expect(c?.positions.n1).toEqual({ x: 10, y: 20 });
    expect(c?.nodeCount).toBe(2);
    expect(c?.version).toBe(1);
  });

  it('loadLayout returns null on absent / corrupt / wrong-version', () => {
    expect(loadLayout('nope')).toBeNull();
    // Simulate corrupt entry
    window.localStorage.setItem('gitnexus:layout:v1:bad', 'not json');
    expect(loadLayout('bad')).toBeNull();
    // Wrong version
    window.localStorage.setItem('gitnexus:layout:v1:v0', JSON.stringify({ version: 0 }));
    expect(loadLayout('v0')).toBeNull();
  });

  it('applyLayoutToGraph counts applied vs missing', () => {
    const positions = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } };
    saveLayoutPositions('key', positions);
    const cached = loadLayout('key')!;
    const seen: Record<string, { x: number; y: number }> = {};
    const graph = {
      order: 3,
      forEachNode(cb) { ['a', 'b', 'c'].forEach((id) => cb(id, {})); },
      setNodeAttribute(id, key, value) { seen[id] = { ...(seen[id] || { x: 0, y: 0 }), [key]: value }; },
    };
    const r = applyLayoutToGraph(cached, graph);
    expect(r).toEqual({ applied: 2, missing: 1 });
    expect(seen.a).toEqual({ x: 1, y: 2 });
  });

  it('clearLayout removes one entry', () => {
    saveLayoutPositions('k1', {}); saveLayoutPositions('k2', {});
    clearLayout('k1');
    expect(loadLayout('k1')).toBeNull();
    expect(loadLayout('k2')).not.toBeNull();
  });

  it('clearAllLayouts removes only prefixed entries', () => {
    saveLayoutPositions('k1', {});
    window.localStorage.setItem('unrelated', 'keep me');
    clearAllLayouts();
    expect(loadLayout('k1')).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('keep me');
  });
});
```

Commit : `feat(layout-cache): localStorage save/load/apply primitives + unit test`.

---

## Section B — Sigma integration (Task 2)

### Task 2: `useSigma.setGraph(graph, {cacheKey})` + persist on convergence

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useSigma.ts`

Changes :

1. Import `loadLayout`, `applyLayoutToGraph`, `saveLayoutFromGraph` from `../lib/layout-cache`.
2. Extend `setGraph` signature : `setGraph(newGraph, opts: { cacheKey?: string } = {})`. Update the TypeScript interface returned by the hook.
3. Inside `setGraph` :
   - Set graph as before
   - If `opts.cacheKey` :
     - `const cached = loadLayout(opts.cacheKey)`
     - If `cached` and `applied / graph.order >= 0.8` (apply via `applyLayoutToGraph`) → skip layout, just `sigma.refresh()` and short `camera.animatedReset({duration:200})`. Return early.
   - Else fallback to `runLayout(newGraph, { cacheKey: opts.cacheKey })` (signature extended).
4. Extend `runLayout(graph, opts: { cacheKey?: string } = {})` :
   - In the `setTimeout(...)` callback after FA2 converges + noverlap, add :
     ```ts
     if (opts.cacheKey) saveLayoutFromGraph(opts.cacheKey, graph);
     ```
5. Expose a new public `recomputeLayout(cacheKey?: string)` method on the hook return :
   ```ts
   recomputeLayout: (cacheKey?: string) => void; // wipes cache for cacheKey, re-runs FA2
   ```

Commit : `feat(layout-cache): useSigma.setGraph cache restore + save on convergence + recomputeLayout()`.

---

## Section C — Worker pre-compute (Task 3)

### Task 3: `layout-worker.ts` + worker pool in preloadAllSnapshots

**Files:**
- Create: `upstream/gitnexus-web/src/lib/layout-worker.ts`
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx` (worker spawn in preloadAllSnapshots)

`layout-worker.ts` :
```ts
// This file is imported via Vite as a Worker: `new Worker(new URL('./layout-worker.ts', import.meta.url), { type: 'module' })`
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';

export type WorkerInput = {
  cacheKey: string;
  graphData: any; // serialized via graph.export()
  iterations?: number; // default 200
};

export type WorkerOutput = {
  cacheKey: string;
  positions: Record<string, { x: number; y: number }>;
  nodeCount: number;
  durationMs: number;
};

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { cacheKey, graphData, iterations = 200 } = e.data;
  const start = performance.now();
  const graph = Graph.from(graphData);
  if (graph.order === 0) {
    (self as any).postMessage({ cacheKey, positions: {}, nodeCount: 0, durationMs: 0 });
    return;
  }
  const settings = forceAtlas2.inferSettings(graph);
  forceAtlas2.assign(graph, { iterations, settings });
  // Light noverlap
  noverlap.assign(graph, { gridSize: 20, margin: 5, ratio: 1.1 });
  const positions: Record<string, { x: number; y: number }> = {};
  graph.forEachNode((id, attrs) => {
    if (typeof attrs.x === 'number' && typeof attrs.y === 'number') {
      positions[id] = { x: attrs.x, y: attrs.y };
    }
  });
  (self as any).postMessage({
    cacheKey,
    positions,
    nodeCount: graph.order,
    durationMs: performance.now() - start,
  } satisfies WorkerOutput);
};
```

Worker pool helper (inside `useAppState.tsx` or a small `lib/layout-worker-pool.ts`) :
- Pool size 2
- Spawn worker via `new Worker(new URL('../lib/layout-worker.ts', import.meta.url), { type: 'module' })`
- For each snapshot in the preload list :
  - If `loadLayout(repoName)` exists → skip
  - Else send `{cacheKey: repoName, graphData: graph.export()}` to a free worker
- On worker response, call `saveLayoutPositions(cacheKey, positions)`
- Terminate all workers on repo switch or panel unmount

Wire into the existing `preloadAllSnapshots` (around `useAppState.tsx:2611`) :
- After each `snapshotCacheRef.current.set(next.name, result)`, also queue layout pre-compute for `result.graph` under `cacheKey = next.name`.

Commit : `feat(layout-cache): worker pre-compute layout during Preload all snapshots`.

---

## Section D — Header button + cacheKey threading (Tasks 4-5)

### Task 4: Wire `cacheKey` through `switchRepo`

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx`

In `switchRepo` (around line 1647), every `setGraph(newGraph)` call gains the cacheKey :
```ts
setGraph(newGraph, { cacheKey: pName });
```

(pName = the projectName used as the cache key — already includes `@<sha>` for snapshots).

Also extend `setGraph` typings in the AppState interface to accept the optional opts object.

Commit : `feat(layout-cache): switchRepo threads cacheKey through setGraph (skip layout on revisit)`.

---

### Task 5: Header "Recompute layout" button

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Header.tsx`
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx` (expose `recomputeLayout` action that bridges useSigma → useAppState)

Header button (placed near zoom controls or settings cluster) :
```tsx
const projectName = useAppState((s) => s.projectName);
const recomputeLayout = useAppState((s) => s.recomputeLayout);
return (
  <button
    type="button"
    data-testid="recompute-layout-button"
    onClick={() => projectName && recomputeLayout(projectName)}
    title="Recompute graph layout (wipes cached positions for the current view)"
  >
    Recompute layout
  </button>
);
```

In `useAppState`, expose :
```ts
recomputeLayout: (cacheKey: string) => void;
```
Implementation : delegates to `sigmaHook.recomputeLayout(cacheKey)` (which itself clears the cache and re-runs FA2 — exposed by useSigma Task 2).

Commit : `feat(layout-cache): Header Recompute layout button + useAppState bridge`.

---

## Section E — Docs (Task 6)

### Task 6: INVENTORY pointer + spec Update — Shipped

**Files:**
- Modify: `INVENTORY.md` (add a sub-bullet under existing "Composants frontend" or new "Layout cache" sub-section)
- Modify: `docs/superpowers/specs/2026-05-27-layout-persistence-design.md` (append Update — Shipped)

INVENTORY note (short — this is bug-fix infra, not a feature row in ROADMAP) :
```
- `upstream/gitnexus-web/src/lib/layout-cache.ts` — persiste positions FA2 par snapshot (localStorage `gitnexus:layout:v1:<repoName>`). Skip `runLayout` au revisite, save sur convergence.
- `upstream/gitnexus-web/src/lib/layout-worker.ts` — Web Worker FA2 (pool 2) lancé pendant Preload all snapshots → premier Play roadmap = instant.
- `useSigma.setGraph(graph, { cacheKey })` + `useSigma.recomputeLayout(cacheKey)` + Header "Recompute layout" button.
```

Spec Update :
```
---

## Update 2026-05-27 — Shipped

Layout persistence + worker livré. Notes :
- `lib/layout-cache.ts` (localStorage `gitnexus:layout:v1:<cacheKey>` + version field + applyLayoutToGraph coverage threshold 80%).
- `useSigma.setGraph(g, {cacheKey})` restore positions if hit AND ≥80% coverage, else fallback to FA2 (which saves on convergence).
- `lib/layout-worker.ts` Vite Worker (Graph.from + FA2 + noverlap) pool size 2 spawned during `preloadAllSnapshots`. Premier Play après preload = instant.
- Header `Recompute layout` button forces re-run (clearLayout + runLayout).
- 1 unit test pour layout-cache. Worker test deferred (jsdom + worker mock).
- Open question 1 (localStorage cap) : LRU eviction non implémenté MVP — sera ajouté si user observe.
```

Commit : `docs(layout-cache): INVENTORY note + spec Update — Shipped`.

---

## Final validation

- [ ] `git log --pretty=format:"%ae" --since=...` → `roblastar@live.fr` only.
- [ ] `node scripts/check-test-inventory.mjs` exits 0 (1 new test row).
- [ ] Docker compose build succeeds (no TS errors).
- [ ] Manual self-test : open browser → Animate roadmap → first run = compute (slow), second run = instant.

---

## Self-Review

**Spec coverage** : §3.2 layout-cache (T1), §3.2 setGraph cache restore (T2), §3.2 worker (T3), §3.2 switchRepo threading (T4), §3.2 Header button (T5), §3.2 docs (T6) — all covered.

**Placeholder scan** : Task 3 references `preloadAllSnapshots` location at useAppState.tsx:2611 — implementer reads first to confirm. Task 5 button placement is in Header.tsx — adapt to existing UI conventions.

**Type consistency** : `CachedLayout` shape consistent T1-T2. `WorkerInput`/`WorkerOutput` shape consistent T3.

**Known risks** :
- Vite `import.meta.url` worker needs `type: 'module'` ; check the existing build config supports it. If not, fallback to bundled inline worker via `worker-loader` (none currently — should be OK with Vite 5+).
- `Graph.from(graphData)` requires the serialized form to be JSON-clonable across postMessage. Sigma's graph attrs include functions sometimes — strip non-serializable attrs before postMessage if necessary (use `graph.export()` which is guaranteed serializable).
- The 80% coverage threshold might be too lax for snapshots with very different node sets — implementer can tune to 90% if needed.

---

**Plan complete. Execution: subagent-driven-development.**
