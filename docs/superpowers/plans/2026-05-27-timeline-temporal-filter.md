# Timeline Temporal Filter (3 modes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a temporal filter dropdown to the Timeline (4 modes : Off / Strict A∩B / Normal A∪B / Permissive window-union) that controls which nodes appear on the graph canvas. Composable with the existing `graphMode='diff'` cursor diff — filter selects the set, diff colors it.

**Architecture:** Backend endpoint `/nodes/alive-between` for permissive mode (the only mode requiring snapshots intermediate between A and B). Strict/normal computed client-side from the 2 cursor snapshots via the existing diff pipeline. State in `useAppState` (mode + filteredNodeIds + loading/error), persisted to localStorage. Sigma reducer applies the filter as a hide-mask, composable with the existing diff coloring reducer.

**Tech Stack:** Node.js (backend endpoint), React 19 + TypeScript (frontend), Sigma 2D (graph), Vitest 4 + Playwright (tests).

**Spec source:** [`docs/superpowers/specs/2026-05-27-timeline-temporal-filter-design.md`](../specs/2026-05-27-timeline-temporal-filter-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

---

## Environment notes

**Node 21 limitation** : Local vitest crashes on Node 21 (rolldown binding incompatibility). Tests run on CI (Node 22) at push. If your local environment has Node 22+, run tests as shown ; otherwise commit blindly and let CI validate. See [`docs/superpowers/decisions/2026-05-26-defer-node22-upgrade.md`](../decisions/2026-05-26-defer-node22-upgrade.md).

**Patches/upstream-all.diff encoding** : The parallel session writes this file as UTF-16 LE + CRLF (default PowerShell Out-File encoding). Use **PowerShell with `Out-File -Encoding Unicode`** to regen — Bash `>` redirection produces UTF-8 + LF which causes binary diff churn between commits.

**Patch regen command** (used at the end of every task that touches `upstream/`) :

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
```

**Parallel session coordination** : The parallel session edits `upstream/gitnexus-web/src/hooks/useAppState.tsx`, `components/Timeline.tsx`, `hooks/useSigma.ts` for Ghost Cluster + Augmented Timeline work. To minimize absorption (parallel commits capture our WIP under their names), commit fast between tasks (~5-10 min windows). Before each commit, run `git reset HEAD <parallel-files>` if you see their staged WIP (e.g., `tests/unit/cluster-layout.test.mjs` was a common offender).

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `upstream/docker-server-nodes-alive-between.mjs` | Backend route handler + pure compute fns (windowed snapshot union). |
| `upstream/gitnexus-web/src/lib/temporal-filter.ts` | Pure client-side fns : `computeStrictFilter(graphA, graphB)`, `computeNormalFilter(graphA, graphB)`. |
| `tests/unit/temporal-filter-modes.test.mjs` | Vitest unit for the 2 client pure fns. |
| `tests/unit/nodes-alive-between-core.test.mjs` | Vitest unit for the backend pure compute. |
| `tests/unit/use-app-state-temporal-filter.test.tsx` | Vitest unit for useAppState state slice + setter + effect. |
| `tests/integration/endpoints/nodes-alive-between.test.mjs` | Integration test against running docker stack. |
| `tests/e2e/specs/timeline-temporal-filter.spec.ts` | Playwright E2E covering 4 modes + composition with Compare A↔B. |

### Files to modify

| Path | Modification |
|---|---|
| `upstream/docker-server.mjs` | Register `handleNodesAliveBetweenRoute` in the dispatch chain (1 import + 1 if-block). |
| `upstream/gitnexus-web/src/hooks/useAppState.tsx` | + `temporalFilterMode` state + 3 related (loading, error, filteredNodeIds) + setter with localStorage + effect watcher orchestrating 3 modes. |
| `upstream/gitnexus-web/src/services/backend-client.ts` | + `fetchNodesAliveBetween(repo, from, to)`. |
| `upstream/gitnexus-web/src/hooks/useSigma.ts` | Apply `temporalFilteredNodeIds` as a hide-mask in the node reducer (additive to existing diff/churn reducers). |
| `upstream/gitnexus-web/src/components/Timeline.tsx` | Add `<select>` dropdown next to "Compare A↔B" button. |
| `ROADMAP.md` | Add a row in the "Déjà livré" table + bump the date header. |
| `INVENTORY.md` | Mention `/nodes/alive-between` in B.2 endpoints + dropdown in Timeline component. |
| `tests/README.md` | Add 4 test rows (3 unit + 1 integ + 1 e2e). |
| `CLAUDE.md` | Add `/nodes/alive-between` to the canonical smoke loop. |
| `patches/upstream-all.diff` | Regen after every task that touches `upstream/`. |

---

## Task 1: Pure client filter fns (strict + normal)

**Files:**
- Create: `upstream/gitnexus-web/src/lib/temporal-filter.ts`
- Create: `tests/unit/temporal-filter-modes.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/temporal-filter-modes.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  computeStrictFilter,
  computeNormalFilter,
} from '../../upstream/gitnexus-web/src/lib/temporal-filter';

const node = (id) => ({ id });

describe('computeStrictFilter (intersection A ∩ B)', () => {
  it('returns node IDs present in both graphs', () => {
    const a = { nodes: [node('n1'), node('n2'), node('n3')] };
    const b = { nodes: [node('n2'), node('n3'), node('n4')] };
    const result = computeStrictFilter(a, b);
    expect([...result].sort()).toEqual(['n2', 'n3']);
  });

  it('returns empty set when no overlap', () => {
    const a = { nodes: [node('n1')] };
    const b = { nodes: [node('n2')] };
    expect(computeStrictFilter(a, b).size).toBe(0);
  });

  it('returns all IDs when graphs are identical', () => {
    const a = { nodes: [node('n1'), node('n2')] };
    const result = computeStrictFilter(a, a);
    expect([...result].sort()).toEqual(['n1', 'n2']);
  });

  it('handles empty graphs', () => {
    expect(computeStrictFilter({ nodes: [] }, { nodes: [] }).size).toBe(0);
    expect(computeStrictFilter({ nodes: [node('n1')] }, { nodes: [] }).size).toBe(0);
  });
});

describe('computeNormalFilter (union A ∪ B)', () => {
  it('returns node IDs from either graph', () => {
    const a = { nodes: [node('n1'), node('n2')] };
    const b = { nodes: [node('n2'), node('n3')] };
    const result = computeNormalFilter(a, b);
    expect([...result].sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('dedupes nodes present in both', () => {
    const a = { nodes: [node('n1'), node('n2')] };
    const result = computeNormalFilter(a, a);
    expect(result.size).toBe(2);
  });

  it('handles empty graphs', () => {
    expect(computeNormalFilter({ nodes: [] }, { nodes: [] }).size).toBe(0);
    const a = { nodes: [node('n1')] };
    expect([...computeNormalFilter(a, { nodes: [] })]).toEqual(['n1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- temporal-filter-modes`
Expected: FAIL with "Failed to resolve import .../temporal-filter" (module doesn't exist yet).

- [ ] **Step 3: Implement `lib/temporal-filter.ts`**

Create `upstream/gitnexus-web/src/lib/temporal-filter.ts`:

```typescript
/**
 * Pure filter computation for the Timeline temporal filter (Phase 2 Item #1).
 * Strict and Normal modes are computed client-side from 2 cursor snapshots.
 * Permissive mode requires the backend endpoint /nodes/alive-between.
 *
 * See docs/superpowers/specs/2026-05-27-timeline-temporal-filter-design.md
 */

export interface GraphLike {
  nodes: Array<{ id: string }>;
}

/**
 * Strict mode : intersection A ∩ B — node IDs present in BOTH graphs.
 * Sémantique : "nodes that lived continuously through the window".
 */
export function computeStrictFilter(graphA: GraphLike, graphB: GraphLike): Set<string> {
  const idsA = new Set(graphA.nodes.map((n) => n.id));
  const result = new Set<string>();
  for (const n of graphB.nodes) {
    if (idsA.has(n.id)) result.add(n.id);
  }
  return result;
}

/**
 * Normal mode : union A ∪ B — node IDs present in EITHER graph.
 * Sémantique : "nodes alive at one of the window boundaries".
 */
export function computeNormalFilter(graphA: GraphLike, graphB: GraphLike): Set<string> {
  const result = new Set<string>();
  for (const n of graphA.nodes) result.add(n.id);
  for (const n of graphB.nodes) result.add(n.id);
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- temporal-filter-modes`
Expected: PASS with 7 passing tests (2 describes, 7 it).

- [ ] **Step 5: Regenerate patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true
git add patches/upstream-all.diff tests/unit/temporal-filter-modes.test.mjs
git commit -m "feat(temporal-filter): pure client fns computeStrictFilter + computeNormalFilter (Task 1)"
```

---

## Task 2: Backend pure compute for `/nodes/alive-between`

**Files:**
- Create: `upstream/docker-server-nodes-alive-between.mjs` (initial — pure fns only)
- Create: `tests/unit/nodes-alive-between-core.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/nodes-alive-between-core.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  filterSnapshotsInWindow,
  unionSnapshotNodeIds,
} from '../../upstream/docker-server-nodes-alive-between.mjs';

const snap = (shortHash, dateISO) => ({
  shortHash,
  commit: { date: dateISO, shortHash },
  name: `repo@${shortHash}`,
});

describe('filterSnapshotsInWindow', () => {
  const snapshots = [
    snap('a1', '2026-01-01T00:00:00Z'),
    snap('a2', '2026-01-10T00:00:00Z'),
    snap('a3', '2026-01-20T00:00:00Z'),
    snap('a4', '2026-01-30T00:00:00Z'),
  ];

  it('returns snapshots within [from, to] inclusive', () => {
    const result = filterSnapshotsInWindow(snapshots, 'a2', 'a3');
    expect(result.map((s) => s.shortHash)).toEqual(['a2', 'a3']);
  });

  it('returns all when from=oldest to=newest', () => {
    const result = filterSnapshotsInWindow(snapshots, 'a1', 'a4');
    expect(result.length).toBe(4);
  });

  it('returns empty when from > to', () => {
    expect(filterSnapshotsInWindow(snapshots, 'a3', 'a2')).toEqual([]);
  });

  it('returns single snapshot when from === to', () => {
    const result = filterSnapshotsInWindow(snapshots, 'a2', 'a2');
    expect(result.map((s) => s.shortHash)).toEqual(['a2']);
  });

  it('returns empty when unknown shortHash', () => {
    expect(filterSnapshotsInWindow(snapshots, 'unknown', 'a3')).toEqual([]);
  });
});

describe('unionSnapshotNodeIds', () => {
  it('unions node IDs from all snapshot graphs', () => {
    const graphs = [
      { nodes: [{ id: 'n1' }, { id: 'n2' }] },
      { nodes: [{ id: 'n2' }, { id: 'n3' }] },
      { nodes: [{ id: 'n3' }, { id: 'n4' }] },
    ];
    const result = unionSnapshotNodeIds(graphs);
    expect([...result].sort()).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('returns empty when no graphs', () => {
    expect(unionSnapshotNodeIds([]).size).toBe(0);
  });

  it('dedupes correctly', () => {
    const g = { nodes: [{ id: 'n1' }, { id: 'n1' }] };
    expect(unionSnapshotNodeIds([g, g]).size).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- nodes-alive-between-core`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement pure fns in `docker-server-nodes-alive-between.mjs`**

Create `upstream/docker-server-nodes-alive-between.mjs`:

```javascript
/**
 * Backend endpoint /nodes/alive-between?repo=&from=&to= for the Timeline
 * Temporal Filter Phase 2 Item #1 (permissive mode).
 *
 * Returns the union of node IDs across all snapshots in window [from, to]
 * inclusive. Caches per (repo, from, to) — windowed results are stable
 * until a new snapshot lands in the range.
 *
 * Pure fns first, HTTP wrapper at the bottom. See spec:
 * docs/superpowers/specs/2026-05-27-timeline-temporal-filter-design.md
 */

/**
 * Filter the snapshot list to those whose shortHash is in window [from, to].
 * Snapshots are assumed pre-sorted by commit date ascending. Returns the
 * sublist between the from-snapshot and to-snapshot inclusive. Returns
 * [] if from or to is not in the list, or if from > to.
 */
export function filterSnapshotsInWindow(snapshots, fromShortHash, toShortHash) {
  const fromIdx = snapshots.findIndex((s) => s.shortHash === fromShortHash);
  const toIdx = snapshots.findIndex((s) => s.shortHash === toShortHash);
  if (fromIdx === -1 || toIdx === -1) return [];
  if (fromIdx > toIdx) return [];
  return snapshots.slice(fromIdx, toIdx + 1);
}

/**
 * Take a list of snapshot graphs ({ nodes: [{id}] }) and return the union
 * of all node IDs across them.
 */
export function unionSnapshotNodeIds(graphs) {
  const result = new Set();
  for (const g of graphs) {
    for (const n of g.nodes) result.add(n.id);
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- nodes-alive-between-core`
Expected: PASS with 8 tests.

- [ ] **Step 5: Regenerate patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git add patches/upstream-all.diff tests/unit/nodes-alive-between-core.test.mjs
git commit -m "feat(nodes-alive-between): pure compute fns filterSnapshotsInWindow + unionSnapshotNodeIds (Task 2)"
```

---

## Task 3: Backend HTTP route + register in docker-server.mjs

**Files:**
- Modify: `upstream/docker-server-nodes-alive-between.mjs` (add `handleNodesAliveBetweenRoute`)
- Modify: `upstream/docker-server.mjs` (register the route)
- Create: `tests/integration/endpoints/nodes-alive-between.test.mjs`

- [ ] **Step 1: Add the HTTP handler to `docker-server-nodes-alive-between.mjs`**

Append at the bottom of `upstream/docker-server-nodes-alive-between.mjs`:

```javascript
/**
 * Path to the alive-between cache file inside the repo's .gitnexus/ dir.
 * Cache key : (fromShortHash, toShortHash) — windowed results stable
 * until a new snapshot lands in the range.
 */
function aliveBetweenCachePath(repoPath) {
  return `${repoPath}/.gitnexus/alive-between-cache.json`;
}

async function readCache(repoPath) {
  try {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(aliveBetweenCachePath(repoPath), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeCache(repoPath, cache) {
  const fs = await import('node:fs/promises');
  await fs.writeFile(aliveBetweenCachePath(repoPath), JSON.stringify(cache, null, 2), 'utf8');
}

/**
 * HTTP handler for GET /nodes/alive-between?repo=&from=&to=
 * - Resolves repo via API (/api/repos)
 * - Lists snapshots, filters to window
 * - Caches by (from, to) — invalidate when snapshotCount changes
 * - Fetches each snapshot's graph (via /api/graph)
 * - Returns union of node IDs
 *
 * Returns false if this route doesn't match (so the caller can try the
 * next route in the dispatch chain) — matches the pattern of all other
 * docker-server-*.mjs handlers.
 */
export async function handleNodesAliveBetweenRoute(req, url, res, opts = {}) {
  if (url.pathname !== '/nodes/alive-between' || req.method !== 'GET') {
    return false;
  }
  const api = opts.api || 'http://gitnexus:4747';
  const repoName = url.searchParams.get('repo');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!repoName || !from || !to) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing required params : repo, from, to' }));
    return true;
  }

  try {
    // Resolve repo to get its path + snapshot list
    const reposResp = await fetch(`${api}/api/repos`);
    const reposBody = await reposResp.json();
    const reposList = Array.isArray(reposBody) ? reposBody : reposBody.repos;
    const repo = reposList?.find((r) => r.name === repoName);
    if (!repo) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `repo not found : ${repoName}` }));
      return true;
    }

    const snapshotsResp = await fetch(`${api}/snapshots?repo=${encodeURIComponent(repoName)}`);
    const snapshotsBody = await snapshotsResp.json();
    const snapshots = (snapshotsBody.snapshots || [])
      .slice()
      .sort((a, b) => (a.commit?.date || '').localeCompare(b.commit?.date || ''));

    const windowed = filterSnapshotsInWindow(snapshots, from, to);
    if (windowed.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `invalid window : from=${from} to=${to} not in repo snapshots` }));
      return true;
    }

    // Check cache
    const cacheKey = `${from}__${to}__${windowed.length}`;
    const cache = await readCache(repo.path || repo.repoPath || '/tmp');
    if (cache[cacheKey]) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...cache[cacheKey], cached: true }));
      return true;
    }

    // Fetch each snapshot's graph and union the node IDs
    const graphs = await Promise.all(
      windowed.map((s) =>
        fetch(`${api}/api/graph?repo=${encodeURIComponent(s.name)}&stream=false`)
          .then((r) => r.json())
          .then((data) => ({ nodes: data.nodes || [] })),
      ),
    );
    const nodeIdsSet = unionSnapshotNodeIds(graphs);
    const result = {
      nodeIds: [...nodeIdsSet].sort(),
      snapshotCount: windowed.length,
      fromSnapshot: from,
      toSnapshot: to,
      computedAt: new Date().toISOString(),
    };

    // Cache result
    cache[cacheKey] = result;
    await writeCache(repo.path || repo.repoPath || '/tmp', cache).catch(() => {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return true;
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err?.message || 'alive-between failed' }));
    return true;
  }
}
```

- [ ] **Step 2: Register the route in `docker-server.mjs`**

In `upstream/docker-server.mjs`, find the import block where other handlers are imported (look for `handleSimilarityRoute` around line 19). Add:

```javascript
import { handleNodesAliveBetweenRoute } from './docker-server-nodes-alive-between.mjs';
```

Then find the dispatch chain in the `createServer` callback (look for the line `if (await handleSimilarityRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;`). Add just after :

```javascript
  // Nodes alive between A and B (ROADMAP Phase 2 Item #1 — Permissive temporal filter)
  if (await handleNodesAliveBetweenRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;
```

- [ ] **Step 3: Write integration test**

Create `tests/integration/endpoints/nodes-alive-between.test.mjs`:

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startStack, stopStack, getApi } from '../helpers/stack.mjs';
import { analyzeFixture, snapshotFixtureFullHistory, FIXTURE } from '../helpers/analyze.mjs';

describe('GET /nodes/alive-between', () => {
  beforeAll(async () => {
    await startStack({ projectsRoot: '<fixture-projects-root>' });
    await analyzeFixture();
    await snapshotFixtureFullHistory();
  }, 180_000);
  afterAll(stopStack);

  const fetchAB = async (repo, from, to) => {
    const url = `http://localhost:4173/nodes/alive-between?repo=${encodeURIComponent(repo)}&from=${from}&to=${to}`;
    const res = await fetch(url);
    return { status: res.status, body: res.ok ? await res.json() : await res.text() };
  };

  it('returns 200 with nodeIds + snapshotCount + window metadata for a valid range', async () => {
    const api = getApi();
    const snapshots = (await api.listSnapshots(FIXTURE.name)).snapshots || [];
    expect(snapshots.length).toBeGreaterThan(1);
    const from = snapshots[0].commit.shortHash;
    const to = snapshots[snapshots.length - 1].commit.shortHash;

    const { status, body } = await fetchAB(FIXTURE.name, from, to);
    expect(status).toBe(200);
    expect(Array.isArray(body.nodeIds)).toBe(true);
    expect(body.nodeIds.length).toBeGreaterThan(0);
    expect(body.snapshotCount).toBe(snapshots.length);
    expect(body.fromSnapshot).toBe(from);
    expect(body.toSnapshot).toBe(to);
  });

  it('returns 400 on missing params', async () => {
    const url = 'http://localhost:4173/nodes/alive-between?repo=foo';
    const res = await fetch(url);
    expect(res.status).toBe(400);
  });

  it('returns 404 on unknown repo', async () => {
    const { status } = await fetchAB('nonexistent-repo-xyz', 'aaa', 'bbb');
    expect(status).toBe(404);
  });

  it('caches the result (second call sets cached: true)', async () => {
    const api = getApi();
    const snapshots = (await api.listSnapshots(FIXTURE.name)).snapshots || [];
    const from = snapshots[0].commit.shortHash;
    const to = snapshots[snapshots.length - 1].commit.shortHash;
    await fetchAB(FIXTURE.name, from, to); // prime cache
    const { body } = await fetchAB(FIXTURE.name, from, to);
    expect(body.cached).toBe(true);
  });
});
```

- [ ] **Step 4: Run the integration test (requires docker stack)**

Run: `cd tests && npm run test:integ -- nodes-alive-between`
Expected: PASS with 4 tests (assumes docker stack is up + fixture analyzed).

- [ ] **Step 5: Regenerate patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git add patches/upstream-all.diff tests/integration/endpoints/nodes-alive-between.test.mjs
git commit -m "feat(nodes-alive-between): HTTP route + register in docker-server + integration test (Task 3)"
```

---

## Task 4: backend-client fetchNodesAliveBetween

**Files:**
- Modify: `upstream/gitnexus-web/src/services/backend-client.ts`

- [ ] **Step 1: Locate the existing fetchGraph signature in backend-client.ts**

Run: `grep -n "fetchGraph\|export const fetch" upstream/gitnexus-web/src/services/backend-client.ts | head -5`

Find a logical place after `fetchGraph` to add the new function.

- [ ] **Step 2: Add the new function**

Append after `fetchGraph` (line ~570) in `upstream/gitnexus-web/src/services/backend-client.ts`:

```typescript
/**
 * Fetch the union of node IDs across all snapshots in window [from, to]
 * (inclusive) for the given base repo. Backend endpoint for the
 * "Permissive" mode of the Timeline Temporal Filter.
 *
 * See docs/superpowers/specs/2026-05-27-timeline-temporal-filter-design.md
 */
export interface AliveBetweenResult {
  nodeIds: string[];
  snapshotCount: number;
  fromSnapshot: string;
  toSnapshot: string;
  computedAt: string;
  cached?: boolean;
}

export const fetchNodesAliveBetween = async (
  repo: string,
  fromShortHash: string,
  toShortHash: string,
): Promise<AliveBetweenResult> => {
  const params = new URLSearchParams({ repo, from: fromShortHash, to: toShortHash });
  const url = `${_backendUrl}/nodes/alive-between?${params.toString()}`;
  const response = await fetchWithTimeout(url, {}, 60_000);
  await assertOk(response);
  return response.json();
};
```

- [ ] **Step 3: Regenerate patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git add patches/upstream-all.diff
git commit -m "feat(backend-client): fetchNodesAliveBetween for permissive temporal filter (Task 4)"
```

---

## Task 5: useAppState state + setter

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx`
- Create: `tests/unit/use-app-state-temporal-filter.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/use-app-state-temporal-filter.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../upstream/gitnexus-web/src/services/backend-client', () => ({
  fetchRepos: vi.fn().mockResolvedValue([]),
  fetchSnapshots: vi.fn().mockResolvedValue([]),
  probeBackend: vi.fn().mockResolvedValue(false),
  fetchGraph: vi.fn().mockResolvedValue({ nodes: [], relationships: [] }),
  fetchNodesAliveBetween: vi.fn().mockResolvedValue({
    nodeIds: ['n1', 'n2'],
    snapshotCount: 3,
    fromSnapshot: 'a',
    toSnapshot: 'b',
    computedAt: '2026-05-27T00:00:00Z',
  }),
}));

import { useAppState, AppStateProvider } from '../../upstream/gitnexus-web/src/hooks/useAppState';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppStateProvider>{children}</AppStateProvider>
);

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('timelineTemporalFilterMode');
  }
});

describe('useAppState — temporal filter slice', () => {
  it('defaults to mode "off" with null filteredNodeIds', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    expect(result.current.temporalFilterMode).toBe('off');
    expect(result.current.temporalFilteredNodeIds).toBeNull();
    expect(result.current.temporalFilterLoading).toBe(false);
    expect(result.current.temporalFilterError).toBeNull();
  });

  it('restores mode from localStorage on mount', () => {
    window.localStorage.setItem('timelineTemporalFilterMode', 'strict');
    const { result } = renderHook(() => useAppState(), { wrapper });
    expect(result.current.temporalFilterMode).toBe('strict');
  });

  it('setTemporalFilterMode persists to localStorage', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    act(() => {
      result.current.setTemporalFilterMode('normal');
    });
    expect(result.current.temporalFilterMode).toBe('normal');
    expect(window.localStorage.getItem('timelineTemporalFilterMode')).toBe('normal');
  });

  it('setTemporalFilterMode("off") clears filteredNodeIds + persists', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    act(() => {
      result.current.setTemporalFilterMode('strict');
    });
    act(() => {
      result.current.setTemporalFilterMode('off');
    });
    expect(result.current.temporalFilterMode).toBe('off');
    expect(result.current.temporalFilteredNodeIds).toBeNull();
    expect(window.localStorage.getItem('timelineTemporalFilterMode')).toBe('off');
  });

  it('accepts all 4 modes', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    const modes = ['off', 'strict', 'normal', 'permissive'] as const;
    for (const mode of modes) {
      act(() => {
        result.current.setTemporalFilterMode(mode);
      });
      expect(result.current.temporalFilterMode).toBe(mode);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- use-app-state-temporal-filter`
Expected: FAIL with "temporalFilterMode is not a property" or similar.

- [ ] **Step 3: Add type to AppState interface in useAppState.tsx**

Find the AppState interface in `upstream/gitnexus-web/src/hooks/useAppState.tsx`. Search for the timeline-zoom additions (`cursorA: string | null;`) — they're around line 226. Add just after `setGraphMode: (mode: 'single' | 'diff') => void;` :

```typescript
  // Timeline Temporal Filter (Phase 2 Item #1). Filter mode + computed
  // node-id mask + loading/error. See spec:
  // docs/superpowers/specs/2026-05-27-timeline-temporal-filter-design.md
  temporalFilterMode: 'off' | 'strict' | 'normal' | 'permissive';
  setTemporalFilterMode: (mode: 'off' | 'strict' | 'normal' | 'permissive') => void;
  temporalFilterLoading: boolean;
  temporalFilterError: string | null;
  temporalFilteredNodeIds: Set<string> | null;
```

- [ ] **Step 4: Add state declarations**

Find the state declarations area in useAppState.tsx — search for the timeline-zoom state (`const [cursorA, setCursorAState]`). Add just after the `graphMode` state declaration :

```typescript
  // Timeline Temporal Filter (Phase 2 Item #1) state.
  const [temporalFilterMode, setTemporalFilterModeState] = useState<'off' | 'strict' | 'normal' | 'permissive'>(() => {
    if (typeof window === 'undefined') return 'off';
    const stored = window.localStorage.getItem('timelineTemporalFilterMode');
    if (stored === 'strict' || stored === 'normal' || stored === 'permissive') return stored;
    return 'off';
  });
  const [temporalFilterLoading, setTemporalFilterLoading] = useState(false);
  const [temporalFilterError, setTemporalFilterError] = useState<string | null>(null);
  const [temporalFilteredNodeIds, setTemporalFilteredNodeIds] = useState<Set<string> | null>(null);
```

- [ ] **Step 5: Add the setter**

Find a logical place near other setters (e.g., after `setGraphMode` useCallback around line 1943). Add :

```typescript
  const setTemporalFilterMode = useCallback((mode: 'off' | 'strict' | 'normal' | 'permissive') => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('timelineTemporalFilterMode', mode);
    }
    if (mode === 'off') {
      // Clear filtered node IDs immediately so the canvas un-hides nodes
      // even before the effect re-runs.
      setTemporalFilteredNodeIds(null);
      setTemporalFilterError(null);
    }
    setTemporalFilterModeState(mode);
  }, []);
```

- [ ] **Step 6: Add the 4 new fields + setter to the returned object**

Find the return statement (search for `cursorA,` near the existing return additions ~line 2697-2710). Add just after `setGraphMode,` :

```typescript
    // Timeline Temporal Filter (Phase 2 Item #1)
    temporalFilterMode,
    setTemporalFilterMode,
    temporalFilterLoading,
    temporalFilterError,
    temporalFilteredNodeIds,
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- use-app-state-temporal-filter`
Expected: PASS with 5 tests.

- [ ] **Step 8: Regenerate patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git add patches/upstream-all.diff tests/unit/use-app-state-temporal-filter.test.tsx
git commit -m "feat(useAppState): temporalFilterMode state + setter with localStorage persist (Task 5)"
```

---

## Task 6: useAppState effect watcher (3-mode orchestration)

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx`

- [ ] **Step 1: Locate the insertion point**

In `upstream/gitnexus-web/src/hooks/useAppState.tsx`, find the existing cursor-diff useEffect (search for `// Effect: watch graphMode + cursors and trigger enter/exit cursor diff.`). Add a new useEffect just after the closing of that useEffect (likely line ~2020+).

- [ ] **Step 2: Add the effect**

```typescript
  // Effect: watch temporalFilterMode + cursors + projectName + availableRepos
  // and compute temporalFilteredNodeIds accordingly. See spec § 4.2.
  //   - off → null (no filter)
  //   - strict → intersection A ∩ B (client-side via fetchGraph + computeStrictFilter)
  //   - normal → union A ∪ B (client-side via fetchGraph + computeNormalFilter)
  //   - permissive → window union (backend /nodes/alive-between)
  useEffect(() => {
    if (temporalFilterMode === 'off') {
      setTemporalFilteredNodeIds(null);
      return;
    }
    if (!cursorA || !cursorB || !projectName) {
      // Cursors not set yet → can't filter. Wait.
      return;
    }
    const baseRepo = projectName.split('@')[0];
    const repo = availableRepos.find((r) => r.name === baseRepo);
    if (!repo) return;

    // Resolve cursor dates to snapshot names (matches the cursor-diff effect logic)
    const findSnapshotName = (cursorDate: string): { name: string; shortHash: string } | null => {
      const snap = repo.snapshots?.find((s) => s.commit?.date === cursorDate);
      if (snap) return { name: snap.name, shortHash: snap.commit?.shortHash || snap.name.split('@')[1] || '' };
      if (repo.indexedAt === cursorDate) return { name: baseRepo, shortHash: 'live' };
      return null;
    };
    const refA = findSnapshotName(cursorA);
    const refB = findSnapshotName(cursorB);
    if (!refA || !refB) return;

    let cancelled = false;
    setTemporalFilterLoading(true);
    setTemporalFilterError(null);

    (async () => {
      try {
        let nodeIds: Set<string>;
        if (temporalFilterMode === 'permissive') {
          const result = await fetchNodesAliveBetween(baseRepo, refA.shortHash, refB.shortHash);
          nodeIds = new Set(result.nodeIds);
        } else {
          // 'strict' or 'normal' — client-side from the 2 cursor snapshot graphs
          const [graphA, graphB] = await Promise.all([
            fetchGraph(refA.name),
            fetchGraph(refB.name),
          ]);
          nodeIds = temporalFilterMode === 'strict'
            ? computeStrictFilter(graphA, graphB)
            : computeNormalFilter(graphA, graphB);
        }
        if (!cancelled) setTemporalFilteredNodeIds(nodeIds);
      } catch (err) {
        if (!cancelled) {
          setTemporalFilterError(err instanceof Error ? err.message : 'Failed to compute temporal filter');
        }
      } finally {
        if (!cancelled) setTemporalFilterLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [temporalFilterMode, cursorA, cursorB, projectName, availableRepos]);
```

- [ ] **Step 3: Add imports at the top of useAppState.tsx**

Find the existing imports of `fetchGraph` (line ~31). Modify to add `fetchNodesAliveBetween`:

```typescript
import {
  fetchGraph,
  fetchNodesAliveBetween,
  // ... existing imports
} from '../services/backend-client';
```

Also import the client filter fns. Find the `computeGraphDiff` import (line ~43) and add a sibling import :

```typescript
import { computeStrictFilter, computeNormalFilter } from '../lib/temporal-filter';
```

- [ ] **Step 4: Manual smoke (optional, requires Node 22)**

Run: `cd tests && npm run test:unit -- use-app-state-temporal-filter`
Expected: PASS (now that the effect actually computes, the test from Task 5 still passes — the test doesn't trigger the effect path since it doesn't set cursors).

- [ ] **Step 5: Regenerate patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git add patches/upstream-all.diff
git commit -m "feat(useAppState): effect watcher orchestrates 3 temporal filter modes (Task 6)"
```

---

## Task 7: useSigma reducer — apply filter hide-mask

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useSigma.ts`

- [ ] **Step 1: Locate the node reducer**

Run: `grep -n "nodeReducer\|setNodeReducer\|hidden:" upstream/gitnexus-web/src/hooks/useSigma.ts | head -10`

The reducer is a function that's set via Sigma's `setSetting('nodeReducer', ...)`. Find the existing one — it returns `{ color, hidden, ...attrs }` for each node.

- [ ] **Step 2: Pull temporalFilteredNodeIds from useAppState**

In `useSigma.ts`, find the destructuring of useAppState (look for `const { graph,`). Add `temporalFilteredNodeIds` to the destructured fields:

```typescript
const {
  // ... existing fields
  temporalFilteredNodeIds,
} = useAppState();
```

- [ ] **Step 3: Apply the hide-mask in the reducer**

In the existing `nodeReducer` (or whatever function builds the per-node display attrs), add the filter check **AFTER** all existing logic, so the filter wins over diff coloring etc. :

```typescript
const nodeReducer = (node: string, attrs: NodeAttrs) => {
  // ... existing logic that sets color, hidden, size, etc.
  let result = { color, hidden, size, label, ...rest };

  // Temporal filter mask (Phase 2 Item #1) — wins over all other reducers.
  // When the filter set is non-null, nodes outside the set are hidden.
  if (temporalFilteredNodeIds !== null && !temporalFilteredNodeIds.has(node)) {
    result.hidden = true;
  }

  return result;
};
```

The exact placement depends on the existing reducer shape. The key invariant : **the temporal filter mask only ever adds `hidden: true` — it never colors or otherwise modifies the node**. Diff coloring + filter compose because diff sets `color`, filter sets `hidden`.

- [ ] **Step 4: Add temporalFilteredNodeIds to the reducer's useEffect deps**

If the reducer is set via `useEffect`, ensure `temporalFilteredNodeIds` is in the dependency array. Without this, the reducer won't re-run when the filter changes.

- [ ] **Step 5: Manual visual smoke (requires running stack)**

In the browser at `http://localhost:4173/`, with snapshots available :
1. Open a repo with cursors auto-set.
2. The Timeline shows the temporal filter dropdown (Task 8 not yet wired — skip this step until Task 8 is done).

Note : full E2E validation happens in Task 9.

- [ ] **Step 6: Regenerate patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git add patches/upstream-all.diff
git commit -m "feat(useSigma): apply temporalFilteredNodeIds as hide-mask in node reducer (Task 7)"
```

---

## Task 8: Timeline.tsx dropdown UI

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`

- [ ] **Step 1: Destructure the new state from useAppState**

Find the useAppState destructuring in Timeline.tsx (search for `setGraphMode,` ~ line 132). Add :

```typescript
    setGraphMode,
    // Temporal Filter (Phase 2 Item #1)
    temporalFilterMode,
    setTemporalFilterMode,
    temporalFilterLoading,
```

- [ ] **Step 2: Add the dropdown next to the Compare A↔B button**

Find the Compare A↔B button (search for `Compare A↔B`). Add just after its closing `</button>` :

```tsx
      {/* Temporal filter dropdown — Phase 2 Item #1.
          Off / Strict / Normal / Permissive. Composable with Compare A↔B. */}
      <label className="flex shrink-0 items-center gap-1 text-[10px] text-text-secondary">
        Filter:
        <select
          value={temporalFilterMode}
          onChange={(e) => setTemporalFilterMode(e.target.value as 'off' | 'strict' | 'normal' | 'permissive')}
          disabled={!cursorA || !cursorB}
          className="rounded-md border border-border-subtle bg-elevated px-1.5 py-0.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-40"
          title={
            !cursorA || !cursorB
              ? 'Set both cursors A and B to enable filter'
              : 'Filter the graph to nodes alive in [A, B]'
          }
        >
          <option value="off">Off</option>
          <option value="strict" title="A ∩ B — nodes that lived continuously through the window">Strict (A ∩ B)</option>
          <option value="normal" title="A ∪ B — nodes alive at one of the window boundaries">Normal (A ∪ B)</option>
          <option value="permissive" title="Window union — includes ephemerals (created and deleted within the window)">Permissive (window)</option>
        </select>
        {temporalFilterLoading && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      </label>
```

- [ ] **Step 3: Regenerate patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git add patches/upstream-all.diff
git commit -m "feat(timeline): temporal filter dropdown Off/Strict/Normal/Permissive (Task 8)"
```

---

## Task 9: E2E Playwright spec

**Files:**
- Create: `tests/e2e/specs/timeline-temporal-filter.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/specs/timeline-temporal-filter.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

/**
 * E2E spec for Timeline Temporal Filter (Phase 2 Item #1).
 * 4 modes : Off / Strict / Normal / Permissive.
 * Composable with Compare A↔B.
 */

test.describe('Timeline Temporal Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    await page.waitForSelector('[data-cursor="B"]', { timeout: 30_000 });
  });

  test('dropdown renders with 4 options', async ({ page }) => {
    const select = page.locator('select').filter({ hasText: /Off|Strict|Normal|Permissive/ });
    await expect(select).toBeVisible();
    const options = await select.locator('option').allTextContents();
    expect(options).toEqual(expect.arrayContaining(['Off', 'Strict (A ∩ B)', 'Normal (A ∪ B)', 'Permissive (window)']));
  });

  test('default mode is "off"', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await expect(select).toHaveValue('off');
  });

  test('selecting Strict computes intersection (graph node count decreases)', async ({ page }) => {
    // Measure baseline node count by counting [data-graph-node] elements or
    // by inspecting Sigma's internal state. Approximation : count visible nodes
    // before and after selecting Strict — should be ≤.
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');
    // Wait for filter to compute
    await page.waitForTimeout(2000);
    // No spinner means done
    await expect(page.locator('label:has-text("Filter:")').locator('svg[class*="animate-spin"]')).toHaveCount(0);
    // localStorage persisted
    const stored = await page.evaluate(() => localStorage.getItem('timelineTemporalFilterMode'));
    expect(stored).toBe('strict');
  });

  test('selecting Normal computes union', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('normal');
    await page.waitForTimeout(2000);
    const stored = await page.evaluate(() => localStorage.getItem('timelineTemporalFilterMode'));
    expect(stored).toBe('normal');
  });

  test('selecting Permissive calls backend and updates filter', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');

    // Set up listener for the backend call
    const requestPromise = page.waitForRequest(/\/nodes\/alive-between\?/, { timeout: 10_000 });
    await select.selectOption('permissive');
    const request = await requestPromise;
    expect(request.url()).toContain('/nodes/alive-between');
    expect(request.url()).toMatch(/repo=/);
    expect(request.url()).toMatch(/from=/);
    expect(request.url()).toMatch(/to=/);
  });

  test('selecting Off clears the filter', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');
    await page.waitForTimeout(1000);
    await select.selectOption('off');
    const stored = await page.evaluate(() => localStorage.getItem('timelineTemporalFilterMode'));
    expect(stored).toBe('off');
  });

  test('mode is restored from localStorage on page reload', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('normal');
    await page.reload();
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    const stored = await page.evaluate(() => localStorage.getItem('timelineTemporalFilterMode'));
    expect(stored).toBe('normal');
    await expect(page.locator('label:has-text("Filter:")').locator('select')).toHaveValue('normal');
  });

  test('composes with Compare A↔B (both can be active)', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');
    await page.click('button:has-text("Compare A↔B")');
    // Both should be active simultaneously
    await expect(page.locator('button:has-text("Exit compare")')).toBeVisible();
    await expect(select).toHaveValue('strict');
  });
});
```

- [ ] **Step 2: Run the E2E spec (requires running stack)**

Run: `cd tests && npm run test:e2e -- timeline-temporal-filter`
Expected: PASS with 8 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/timeline-temporal-filter.spec.ts
git commit -m "test(e2e): timeline temporal filter 4 modes + composition with compare (Task 9)"
```

---

## Task 10: Documentation updates + final commit

**Files:**
- Modify: `ROADMAP.md`
- Modify: `INVENTORY.md`
- Modify: `tests/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update ROADMAP.md**

Find the "Déjà livré" table (around line 17). Find the last row (currently row 47 "Timeline zoom + 2 cursors A/B"). Add a new row after it :

```markdown
| 48 | **Timeline Temporal Filter (3 modes : Strict / Normal / Permissive)** — Phase 2 Item #1 sur 5. Dropdown <select> à côté de "Compare A↔B" qui filtre les nodes du graphe à la fenêtre [A, B]. 3 modes : Strict (A ∩ B), Normal (A ∪ B), Permissive (union de tous les snapshots dans [A,B] — capture les éphémères, via backend `/nodes/alive-between`). Off par défaut + persisté en localStorage. Cumulable avec graphMode='diff' : filter = quel set, diff = coloring de ce set. | `/nodes/alive-between`, `lib/temporal-filter.ts`, dropdown dans `Timeline.tsx`, state `temporalFilterMode` + setter + effect watcher dans `useAppState`, hide-mask dans `useSigma.ts` node reducer |
```

Update the header date :

```markdown
Dernière mise à jour : 2026-05-27 (Timeline Temporal Filter Phase 2 Item #1 livré : dropdown 3 modes + backend `/nodes/alive-between` pour permissive. 5 items Phase 2 restants : Mode union dedié, Lifespan fenêtré, URL persistence, Zoom mousewheel).
```

- [ ] **Step 2: Update INVENTORY.md**

Find the endpoints table in Partie B.2 (around line 119). After the row for `/similarity`, add :

```markdown
| `GET /nodes/alive-between` | Union des node IDs sur tous les snapshots dans [from, to] inclusive. Backend du mode "Permissive" du Timeline Temporal Filter (Phase 2 Item #1). Cache par `(repo, from, to, snapshotCount)` dans `.gitnexus/alive-between-cache.json`. |
```

In the components section, find the `Timeline.tsx` line and append to its description :

```markdown
**Timeline Temporal Filter Phase 2 Item #1** (Tier 48) : dropdown 4 modes (Off / Strict A∩B / Normal A∪B / Permissive window-union) à côté de "Compare A↔B". State dans useAppState (`temporalFilterMode`, `temporalFilteredNodeIds`, etc.). Filter appliqué via hide-mask dans `useSigma.ts` node reducer (composable avec diff coloring).
```

- [ ] **Step 3: Update tests/README.md**

Find the "Pure logic units" table. After the last Timeline-zoom row, add :

```markdown
| Temporal filter — pure client fns | `unit/temporal-filter-modes.test.mjs` | computeStrictFilter + computeNormalFilter (intersection + union) |
| Temporal filter — backend core | `unit/nodes-alive-between-core.test.mjs` | filterSnapshotsInWindow + unionSnapshotNodeIds |
| Temporal filter — useAppState slice | `unit/use-app-state-temporal-filter.test.tsx` | 4 modes + localStorage persist + restore |
```

Find the integration tests section. Add :

```markdown
| Nodes alive between | `integration/endpoints/nodes-alive-between.test.mjs` | GET 200 + 400 missing params + 404 unknown repo + cache hit |
```

Find the E2E tests section. Add :

```markdown
| Timeline Temporal Filter | `e2e/specs/timeline-temporal-filter.spec.ts` | 4 modes dropdown + localStorage + backend call (permissive) + composition with Compare A↔B (8 cases) |
```

- [ ] **Step 4: Update CLAUDE.md smoke loop**

Find the canonical smoke check section in `CLAUDE.md` (the `for ep in repos snapshots ...` loop). Add `nodes/alive-between` to the loop. The loop becomes :

```bash
for ep in snapshots churn coupling growth lifespan entropy ownership semantic-labels ghost-audit ghosts; do
  curl -s -o /dev/null -w "$ep: HTTP %{http_code}\n" \
    "http://localhost:4173/$ep?repo=hmm_studio"
done
# Temporal filter (Phase 2 Item #1) — requires from/to params, separate check:
curl -s -o /dev/null -w "nodes/alive-between: HTTP %{http_code}\n" \
  "http://localhost:4173/nodes/alive-between?repo=hmm_studio&from=oldest&to=live"
```

- [ ] **Step 5: Final commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git add ROADMAP.md INVENTORY.md tests/README.md CLAUDE.md patches/upstream-all.diff
git commit -m "Timeline Temporal Filter Phase 2 Item #1 livré: ROADMAP/INVENTORY/tests/CLAUDE (Task 10)"
```

---

## Self-Review

**Spec coverage** :
- ✅ Spec § 2 Goal — dropdown 4 modes + composable with diff → Tasks 5 (state), 8 (dropdown), 6 (effect), 7 (reducer composition)
- ✅ Spec § 3 D1 Backend endpoint → Tasks 2 (pure) + 3 (route) + 4 (client)
- ✅ Spec § 3 D2 Dropdown placement → Task 8
- ✅ Spec § 3 D3 Off default + localStorage → Task 5 (init from localStorage, setter persists)
- ✅ Spec § 3 D4 Cumulable with diff → Task 7 (reducer composition — filter sets hidden, diff sets color, both apply)
- ✅ Spec § 3 D5 Client-side strict/normal → Task 1 (pure fns) + Task 6 (effect dispatch)
- ✅ Spec § 3 D6 Backend permissive → Task 2/3/4 + Task 6 (effect dispatch)
- ✅ Spec § 4.2 Backend response shape → Task 3 returns `{ nodeIds, snapshotCount, fromSnapshot, toSnapshot, computedAt, cached? }`
- ✅ Spec § 4.3 Edge cases — Repo < 2 snapshots (Task 8 disabled dropdown), Cursors not set (Task 8 disabled + Task 6 early return), Permissive 404 (Task 6 catch + setTemporalFilterError), Mode persisted but cursors stale (Task 5/6 — restore mode, wait for cursors)
- ✅ Spec § 5 Testing strategy — 3 unit (Tasks 1, 2, 5) + 1 integ (Task 3) + 1 e2e (Task 9)
- ✅ Spec § 9 Document updates → Task 10

**Placeholder scan** :
- ✅ No "TBD" / "TODO".
- ⚠️ Task 7 Step 3 says "The exact placement depends on the existing reducer shape." — this is acceptable because we can't predict the exact line/shape without reading the file, but the engineer has clear guidance : the invariant ("filter never colors, only hides") + the deps add for re-trigger. The placement is "after all existing logic so filter wins".
- ⚠️ Task 3 Step 3 test uses `'<fixture-projects-root>'` as a placeholder for `startStack`. Replace with the actual fixture path from `tests/integration/helpers/stack.mjs`'s `extractFixture()` default. Documentation point : the engineer should follow the pattern from existing integration tests (e.g., `tests/integration/endpoints/similarity.test.mjs` or similar).

**Type consistency** :
- ✅ `'off' | 'strict' | 'normal' | 'permissive'` used consistently across Tasks 5, 6, 8, 9.
- ✅ `temporalFilteredNodeIds: Set<string> | null` used consistently in Task 5 (state), Task 6 (effect setter), Task 7 (reducer reader).
- ✅ `fetchNodesAliveBetween(repo, from, to)` signature consistent : Task 4 defines, Task 6 uses (passing `baseRepo, refA.shortHash, refB.shortHash`).
- ✅ `AliveBetweenResult.nodeIds: string[]` — Task 4 defines, Task 6 wraps as `new Set(result.nodeIds)`.
- ✅ `filterSnapshotsInWindow` + `unionSnapshotNodeIds` exports — Task 2 defines, Task 3 imports both.

**Scope check** : Single feature (Temporal Filter), ~1.5-2 weeks, 10 tasks. Fits a single plan.

Plan ready for execution.

---

## Effort summary

| Task | Estimate |
|---|---|
| 1. Pure client fns | ~½d |
| 2. Backend pure compute | ~½d |
| 3. Backend HTTP route + integ test | ~1-2d |
| 4. backend-client fetchNodesAliveBetween | ~½d |
| 5. useAppState state + setter | ~1d |
| 6. useAppState effect watcher | ~1-2d |
| 7. useSigma reducer hide-mask | ~1d |
| 8. Timeline.tsx dropdown UI | ~½d |
| 9. E2E spec | ~1d |
| 10. Docs + final commit | ~½d |
| **Total** | **~8-10 days** |
