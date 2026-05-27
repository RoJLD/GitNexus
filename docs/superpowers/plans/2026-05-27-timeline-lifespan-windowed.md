# Lifespan Windowed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand le temporal filter (Phase 2 Item #1) est actif, le panneau Lifespan recompute ses 4 buckets (foundational/recent/discontinued/ephemeral) sur la fenêtre [cursorA, cursorB] au lieu de toute l'histoire, avec UX feedback (header text + badge daterange).

**Architecture:** Extension de l'endpoint `/lifespan` existant avec params optionnels `?from=&to=` (backward-compat — sans params, comportement global inchangé). Réutilise la machinerie `/nodes/alive-between` (`filterSnapshotsInWindow` + `unionSnapshotNodeIds` du Item #1 Task 2) pour le calcul des intermédiaires d'ephemeral. Frontend : effect watcher dans useAppState branche sur `temporalFilterMode`, LifespanPanel affiche un badge quand `data.windowed` est présent dans la réponse.

**Tech Stack:** Node.js (backend), React 19 + TypeScript (frontend), Vitest 4 + Playwright (tests).

**Spec source:** [`docs/superpowers/specs/2026-05-27-timeline-lifespan-windowed-design.md`](../specs/2026-05-27-timeline-lifespan-windowed-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

---

## Environment notes

**Node 21 limitation** : Local vitest crashes (rolldown binding incompatibility). CI on Node 22 validates. Si Node 21, commit aveugle après écriture du code, CI vérifiera.

**Patches/upstream-all.diff encoding** : UTF-16 LE + CRLF via PowerShell `Out-File -Encoding Unicode`. Bash `>` redirection produit UTF-8 + LF → binary diff churn entre commits.

**Patch regen command** (à chaque task qui touche `upstream/`) :

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
```

**Parallel session coordination** : `useAppState.tsx` + `LifespanPanel.tsx` sont des fichiers hot. Commit rapidement entre tasks. Avant chaque commit, unstage les fichiers parallel (`git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true`).

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `upstream/docker-server-lifespan-windowed-core.mjs` | Pure fn `computeWindowedBuckets(idsA, idsB, ephemeralIds)` returning the 4 buckets. Isolated for testability. |
| `tests/unit/lifespan-windowed-core.test.mjs` | Vitest unit for the pure fn (5 cases). |
| `tests/integration/endpoints/lifespan-windowed.test.mjs` | Integration test for `/lifespan?from=&to=`. |
| `tests/e2e/specs/lifespan-windowed.spec.ts` | Playwright E2E covering filter toggle → windowed header. |

### Files to modify

| Path | Modification |
|---|---|
| `upstream/docker-server-lifespan.mjs` | Add windowed branch when `from`/`to` params present. Import + use `computeWindowedBuckets` from new core module. Imports `filterSnapshotsInWindow` and `unionSnapshotNodeIds` from `./docker-server-nodes-alive-between.mjs` (Item #1 Task 2). |
| `upstream/Dockerfile.web` | Add `COPY docker-server-lifespan-windowed-core.mjs ./docker-server-lifespan-windowed-core.mjs` (matches the pattern from Item #1 Dockerfile fix). |
| `upstream/gitnexus-web/src/hooks/useAppState.tsx` | Branch existing lifespan effect on `temporalFilterMode` — pass `from`/`to` params when filter active. |
| `upstream/gitnexus-web/src/components/LifespanPanel.tsx` | Add header text variation + badge when `data.windowed` is present. |
| `ROADMAP.md` / `INVENTORY.md` / `tests/README.md` / `CLAUDE.md` | Standard docs updates. |
| `patches/upstream-all.diff` | Regen on each task commit. |

---

## Task 1: Pure fn `computeWindowedBuckets` + unit tests

**Files:**
- Create: `upstream/docker-server-lifespan-windowed-core.mjs`
- Create: `tests/unit/lifespan-windowed-core.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lifespan-windowed-core.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { computeWindowedBuckets } from '../../upstream/docker-server-lifespan-windowed-core.mjs';

describe('computeWindowedBuckets', () => {
  it('distributes IDs across 4 buckets correctly (typical window)', () => {
    const idsA = new Set(['n1', 'n2', 'n3']);           // in snapshot A
    const idsB = new Set(['n2', 'n3', 'n4']);           // in snapshot B
    const ephemeralIds = new Set(['n5']);               // appeared+gone within window (not in A or B)
    const result = computeWindowedBuckets(idsA, idsB, ephemeralIds);

    expect([...result.foundational].sort()).toEqual(['n2', 'n3']);  // in both A and B
    expect([...result.recent].sort()).toEqual(['n4']);              // not in A, in B
    expect([...result.discontinued].sort()).toEqual(['n1']);         // in A, not in B
    expect([...result.ephemeral].sort()).toEqual(['n5']);            // intermediate-only
  });

  it('empty intermediates → empty ephemeral', () => {
    const idsA = new Set(['n1']);
    const idsB = new Set(['n2']);
    const result = computeWindowedBuckets(idsA, idsB, new Set());
    expect(result.ephemeral.size).toBe(0);
    expect([...result.recent]).toEqual(['n2']);
    expect([...result.discontinued]).toEqual(['n1']);
  });

  it('identical A and B → all foundational, others empty', () => {
    const ids = new Set(['n1', 'n2']);
    const result = computeWindowedBuckets(ids, ids, new Set());
    expect([...result.foundational].sort()).toEqual(['n1', 'n2']);
    expect(result.recent.size).toBe(0);
    expect(result.discontinued.size).toBe(0);
    expect(result.ephemeral.size).toBe(0);
  });

  it('all empty → all buckets empty', () => {
    const result = computeWindowedBuckets(new Set(), new Set(), new Set());
    expect(result.foundational.size).toBe(0);
    expect(result.recent.size).toBe(0);
    expect(result.discontinued.size).toBe(0);
    expect(result.ephemeral.size).toBe(0);
  });

  it('ephemeral IDs that ALSO happen to be in A or B are NOT counted as ephemeral (no double-counting)', () => {
    // If an ID happens to be in idsA AND ephemeralIds (e.g., caller bug), the bucket
    // assignment should be deterministic. The pure fn filters ephemeral to those
    // strictly not in A and not in B.
    const idsA = new Set(['n1']);
    const idsB = new Set(['n2']);
    const ephemeralIds = new Set(['n1', 'n3']);  // n1 leaks from idsA
    const result = computeWindowedBuckets(idsA, idsB, ephemeralIds);

    expect([...result.foundational]).toEqual([]);      // nothing in both A and B
    expect([...result.recent]).toEqual(['n2']);
    expect([...result.discontinued]).toEqual(['n1']);  // n1 stays discontinued
    expect([...result.ephemeral]).toEqual(['n3']);     // n1 filtered out, only n3 remains
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- lifespan-windowed-core`
Expected: FAIL with "Failed to resolve import .../lifespan-windowed-core" (module doesn't exist yet). On Node 21, crash entire test runner — that's expected, proceed to Step 3.

- [ ] **Step 3: Implement `lifespan-windowed-core.mjs`**

Create `upstream/docker-server-lifespan-windowed-core.mjs`:

```javascript
/**
 * Pure compute for the windowed Lifespan buckets (Phase 2 Item #3 of
 * Timeline series). Takes sets of node IDs for snapshots A, B, and the
 * intermediates, returns the 4 buckets.
 *
 * Semantics (windowed) :
 *   - foundational : in A AND in B (survives the window)
 *   - recent       : not in A, in B (appeared during the window)
 *   - discontinued : in A, not in B (disappeared during the window)
 *   - ephemeral    : not in A, present in intermediates, not in B
 *                    (created+deleted within the window — only visible
 *                    via /nodes/alive-between or windowed snapshot scan)
 *
 * See spec :
 * docs/superpowers/specs/2026-05-27-timeline-lifespan-windowed-design.md
 */

/**
 * @param {Set<string>} idsA  Node IDs in snapshot at cursor A.
 * @param {Set<string>} idsB  Node IDs in snapshot at cursor B.
 * @param {Set<string>} ephemeralIds  Node IDs found in intermediate
 *   snapshots that are neither in A nor in B (caller should filter
 *   before passing, but we re-filter defensively here).
 * @returns {{ foundational: Set<string>, recent: Set<string>,
 *   discontinued: Set<string>, ephemeral: Set<string> }}
 */
export function computeWindowedBuckets(idsA, idsB, ephemeralIds) {
  const foundational = new Set();
  for (const id of idsA) {
    if (idsB.has(id)) foundational.add(id);
  }

  const recent = new Set();
  for (const id of idsB) {
    if (!idsA.has(id)) recent.add(id);
  }

  const discontinued = new Set();
  for (const id of idsA) {
    if (!idsB.has(id)) discontinued.add(id);
  }

  // Defensive : ephemeral = strictly NOT in A and NOT in B
  const ephemeral = new Set();
  for (const id of ephemeralIds) {
    if (!idsA.has(id) && !idsB.has(id)) ephemeral.add(id);
  }

  return { foundational, recent, discontinued, ephemeral };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- lifespan-windowed-core`
Expected: PASS with 5 tests (or Node 21 crash — proceed to Step 5).

- [ ] **Step 5: Regen patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true
git add patches/upstream-all.diff tests/unit/lifespan-windowed-core.test.mjs
git commit -m "feat(lifespan-windowed): pure fn computeWindowedBuckets + 5 unit tests (Task 1)"
```

---

## Task 2: Backend windowed branch in `/lifespan` + integration test

**Files:**
- Modify: `upstream/docker-server-lifespan.mjs`
- Modify: `upstream/Dockerfile.web` (add COPY line)
- Create: `tests/integration/endpoints/lifespan-windowed.test.mjs`

- [ ] **Step 1: Read the existing `/lifespan` handler**

Run: `wc -l upstream/docker-server-lifespan.mjs && head -60 upstream/docker-server-lifespan.mjs`

Identify the route handler function. Note where global logic lives — the windowed branch will sit BEFORE the global logic and short-circuit when `from`/`to` are both present.

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/endpoints/lifespan-windowed.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

describe('GET /lifespan windowed mode', () => {
  const fetchLifespan = async (repo, params = '') => {
    const url = `http://localhost:4173/lifespan?repo=${encodeURIComponent(repo)}${params}`;
    const res = await fetch(url);
    return { status: res.status, body: res.ok ? await res.json() : await res.text() };
  };

  it('returns global response (no windowed field) when no from/to', async () => {
    const { status, body } = await fetchLifespan(FIXTURE.name);
    expect(status).toBe(200);
    expect(body.windowed).toBeUndefined();
    expect(body.counts).toBeDefined();
    expect(body.nodes).toBeDefined();
  });

  it('returns windowed response with windowed field when from/to set', async () => {
    const api = getApi();
    const snapshots = (await api.listSnapshots(FIXTURE.name)).snapshots || [];
    expect(snapshots.length).toBeGreaterThan(1);
    const from = snapshots[0].commit.shortHash;
    const to = snapshots[snapshots.length - 1].commit.shortHash;

    const { status, body } = await fetchLifespan(FIXTURE.name, `&from=${from}&to=${to}`);
    expect(status).toBe(200);
    expect(body.windowed).toBeDefined();
    expect(body.windowed.from).toBe(from);
    expect(body.windowed.to).toBe(to);
    expect(body.windowed.snapshotCount).toBe(snapshots.length);
    expect(body.counts.foundational + body.counts.recent + body.counts.discontinued + body.counts.ephemeral).toBeGreaterThanOrEqual(0);
  });

  it('returns 400 when only from is set (windowed needs both)', async () => {
    const api = getApi();
    const snapshots = (await api.listSnapshots(FIXTURE.name)).snapshots || [];
    const { status } = await fetchLifespan(FIXTURE.name, `&from=${snapshots[0].commit.shortHash}`);
    expect(status).toBe(400);
  });

  it('returns 400 on invalid range (from > to)', async () => {
    const api = getApi();
    const snapshots = (await api.listSnapshots(FIXTURE.name)).snapshots || [];
    expect(snapshots.length).toBeGreaterThan(1);
    const reversedFrom = snapshots[snapshots.length - 1].commit.shortHash;
    const reversedTo = snapshots[0].commit.shortHash;
    const { status } = await fetchLifespan(FIXTURE.name, `&from=${reversedFrom}&to=${reversedTo}`);
    expect(status).toBe(400);
  });

  it('resolves "oldest"/"live" aliases like /nodes/alive-between', async () => {
    const { status, body } = await fetchLifespan(FIXTURE.name, `&from=oldest&to=live`);
    expect(status).toBe(200);
    expect(body.windowed).toBeDefined();
    // Resolved fromShortHash and toShortHash should NOT be the literal aliases
    expect(body.windowed.from).not.toBe('oldest');
    expect(body.windowed.to).not.toBe('live');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tests && npm run test:integ -- lifespan-windowed`
Expected: FAIL — 5/5 tests fail because the windowed branch doesn't exist yet (response has no `windowed` field). On Node 21, crash — proceed.

- [ ] **Step 4: Modify `docker-server-lifespan.mjs` to add windowed branch**

In `upstream/docker-server-lifespan.mjs`, find the route handler (likely `handleLifespanRoute` or similar). Locate where it reads `url.searchParams.get('repo')` and the early returns for missing params. Add `from`/`to` parsing immediately after :

At the top of the file, add imports :

```javascript
import { filterSnapshotsInWindow, unionSnapshotNodeIds } from './docker-server-nodes-alive-between.mjs';
import { computeWindowedBuckets } from './docker-server-lifespan-windowed-core.mjs';
```

In the handler, after the `repo` param check, add :

```javascript
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  // Validate windowed mode preconditions
  if ((from && !to) || (!from && to)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'windowed mode requires both from and to params (or neither)' }));
    return true;
  }

  if (from && to) {
    // Windowed mode — branches off the global code path entirely.
    return await handleWindowedLifespan(req, url, res, { api: opts.api, repoName: repo, from, to });
  }

  // ... existing global code below stays unchanged
```

Add the `handleWindowedLifespan` function at the bottom of the file :

```javascript
async function handleWindowedLifespan(req, url, res, opts) {
  const { api, repoName, from, to } = opts;

  try {
    // Resolve repo
    const reposResp = await fetch(`${api}/api/repos`);
    const reposBody = await reposResp.json();
    const reposList = Array.isArray(reposBody) ? reposBody : reposBody.repos;
    const repo = reposList?.find((r) => r.name === repoName);
    if (!repo) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `repo not found : ${repoName}` }));
      return true;
    }

    // Resolve snapshots
    const snapshotsResp = await fetch(`${api}/snapshots?repo=${encodeURIComponent(repoName)}`);
    const snapshotsBody = await snapshotsResp.json();
    const snapshots = (snapshotsBody.snapshots || [])
      .slice()
      .sort((a, b) => (a.commit?.date || '').localeCompare(b.commit?.date || ''));

    // Resolve aliases (same pattern as /nodes/alive-between)
    let resolvedFrom = from;
    let resolvedTo = to;
    if (snapshots.length > 0) {
      if (from === 'oldest') resolvedFrom = snapshots[0].commit.shortHash;
      if (to === 'live' || to === 'newest') resolvedTo = snapshots[snapshots.length - 1].commit.shortHash;
    }

    const windowed = filterSnapshotsInWindow(snapshots, resolvedFrom, resolvedTo);
    if (windowed.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `invalid window : from=${resolvedFrom} to=${resolvedTo} not in repo snapshots, or from > to` }));
      return true;
    }

    const snapA = windowed[0];
    const snapB = windowed[windowed.length - 1];

    // Fetch graphs for A and B
    const [graphA, graphB] = await Promise.all([
      fetch(`${api}/api/graph?repo=${encodeURIComponent(snapA.name)}&stream=false`).then((r) => r.json()),
      fetch(`${api}/api/graph?repo=${encodeURIComponent(snapB.name)}&stream=false`).then((r) => r.json()),
    ]);
    const idsA = new Set((graphA.nodes || []).map((n) => n.id));
    const idsB = new Set((graphB.nodes || []).map((n) => n.id));

    // Ephemeral : compute union over STRICTLY intermediate snapshots, then
    // filter to those not in A or B.
    let ephemeralIds = new Set();
    const intermediates = windowed.slice(1, -1);
    if (intermediates.length > 0) {
      const interGraphs = await Promise.all(
        intermediates.map((s) =>
          fetch(`${api}/api/graph?repo=${encodeURIComponent(s.name)}&stream=false`).then((r) => r.json()),
        ),
      );
      const interUnion = unionSnapshotNodeIds(interGraphs.map((g) => ({ nodes: g.nodes || [] })));
      for (const id of interUnion) {
        if (!idsA.has(id) && !idsB.has(id)) ephemeralIds.add(id);
      }
    }

    const buckets = computeWindowedBuckets(idsA, idsB, ephemeralIds);

    // Enrich nodes for response (look up label from graphA / graphB)
    const nodeMap = new Map();
    for (const n of graphA.nodes || []) nodeMap.set(n.id, n);
    for (const n of graphB.nodes || []) if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);

    const enrich = (idSet) =>
      [...idSet].map((id) => {
        const n = nodeMap.get(id);
        return n
          ? { id, label: n.label || id, name: n.name || n.label || id, path: n.path || n.name || id }
          : { id, label: id, name: id, path: id };
      });

    const response = {
      counts: {
        foundational: buckets.foundational.size,
        recent: buckets.recent.size,
        discontinued: buckets.discontinued.size,
        ephemeral: buckets.ephemeral.size,
      },
      nodes: {
        foundational: enrich(buckets.foundational),
        recent: enrich(buckets.recent),
        discontinued: enrich(buckets.discontinued),
        ephemeral: enrich(buckets.ephemeral),
      },
      windowed: {
        from: resolvedFrom,
        to: resolvedTo,
        snapshotCount: windowed.length,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
    return true;
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err?.message || 'windowed lifespan failed' }));
    return true;
  }
}
```

- [ ] **Step 5: Modify `Dockerfile.web` to COPY the new core module**

In `upstream/Dockerfile.web`, find the existing line `COPY docker-server-nodes-alive-between.mjs ./docker-server-nodes-alive-between.mjs`. Add IMMEDIATELY after :

```dockerfile
COPY docker-server-lifespan-windowed-core.mjs ./docker-server-lifespan-windowed-core.mjs
```

- [ ] **Step 6: Run test to verify it passes (or commit blind on Node 21)**

Run: `cd tests && npm run test:integ -- lifespan-windowed`
Expected: PASS with 5 tests (or Node 21 crash, CI validates).

- [ ] **Step 7: Regen patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true
git add patches/upstream-all.diff tests/integration/endpoints/lifespan-windowed.test.mjs
git commit -m "feat(lifespan-windowed): backend branch + alias resolution + integration test (Task 2)"
```

---

## Task 3: useAppState effect branches on temporalFilterMode

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx`

- [ ] **Step 1: Locate the existing lifespan fetch logic**

Run: `grep -n "lifespan\|/lifespan\|Lifespan" upstream/gitnexus-web/src/hooks/useAppState.tsx | head -20`

Find the function that fetches `/lifespan` (likely inside `enterLifespanMode` callback or similar). It probably looks like : `fetch('/lifespan?repo=' + baseRepo)`.

- [ ] **Step 2: Modify the lifespan fetch to branch on temporalFilterMode**

Find the lifespan fetch call. Modify the URL construction. The pattern (adapt to actual code) :

```typescript
// BEFORE (existing) :
// const url = `/lifespan?repo=${encodeURIComponent(baseRepo)}`;

// AFTER : branch on temporalFilterMode
let url = `/lifespan?repo=${encodeURIComponent(baseRepo)}`;
if (temporalFilterMode !== 'off' && cursorA && cursorB) {
  const repo = availableRepos.find((r) => r.name === baseRepo);
  const findShortHash = (cursorDate: string): string | null => {
    const snap = repo?.snapshots?.find((s) => s.commit?.date === cursorDate);
    if (snap) return snap.commit?.shortHash || null;
    if (repo?.indexedAt === cursorDate) return 'live';
    return null;
  };
  const fromHash = findShortHash(cursorA);
  const toHash = findShortHash(cursorB);
  if (fromHash && toHash) {
    url += `&from=${fromHash}&to=${toHash}`;
  }
}
```

If the existing logic is wrapped in a useCallback or useEffect, make sure to update the dependency array to include `temporalFilterMode`, `cursorA`, `cursorB`, `availableRepos` so the lifespan re-fetches when these change.

- [ ] **Step 3: Find the useCallback/useEffect that uses the URL**

Trace where the URL is used. Add the missing deps to its dependency array if not already present :

```typescript
}, [/* existing deps */, temporalFilterMode, cursorA, cursorB, availableRepos]);
```

- [ ] **Step 4: Regen patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true
git add patches/upstream-all.diff
git commit -m "feat(useAppState): lifespan fetch branches on temporalFilterMode for windowed mode (Task 3)"
```

---

## Task 4: LifespanPanel header text + badge

**Files:**
- Modify: `upstream/gitnexus-web/src/components/LifespanPanel.tsx`

- [ ] **Step 1: Locate the LifespanPanel header**

Run: `grep -n "Lifespan\|h2\|<h\|title" upstream/gitnexus-web/src/components/LifespanPanel.tsx | head -10`

Find the JSX that renders the panel title (likely "Lifespan" as `<h2>` or similar).

- [ ] **Step 2: Read the lifespan data prop / state**

Identify where `lifespanData` (or equivalent) is consumed. The new `windowed` field will be `lifespanData?.windowed` when present.

- [ ] **Step 3: Update the header**

Replace the existing title section with conditional rendering. Adapt to actual code style. Example :

```tsx
{lifespanData?.windowed ? (
  <div className="flex items-center gap-2">
    <h2 className="text-sm font-semibold">
      Lifespan <span className="text-text-muted">(window)</span>
    </h2>
    <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
      {lifespanData.windowed.from} → {lifespanData.windowed.to} · {lifespanData.windowed.snapshotCount} snapshots
    </span>
  </div>
) : (
  <h2 className="text-sm font-semibold">Lifespan</h2>
)}
```

If there's a more compact `formatWindowDuration` helper from Phase 1 Timeline available, reuse it. Otherwise inline the format above.

- [ ] **Step 4: Regen patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true
git add patches/upstream-all.diff
git commit -m "feat(lifespan-panel): header text + badge when data.windowed present (Task 4)"
```

---

## Task 5: E2E Playwright spec

**Files:**
- Create: `tests/e2e/specs/lifespan-windowed.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/specs/lifespan-windowed.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

/**
 * E2E spec for Lifespan Windowed (Phase 2 Item #3).
 * Verify the panel header switches between global and windowed modes
 * based on temporalFilterMode.
 */

test.describe('Lifespan windowed', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    // Wait for the timeline cursors to initialize
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    await page.waitForSelector('[data-cursor="B"]', { timeout: 30_000 });
  });

  test('initial header is "Lifespan" (global mode, temporalFilterMode=off)', async ({ page }) => {
    // Open the Lifespan panel (assumes there's a button/tab to toggle it open)
    // Adapt to actual UI : maybe click "Lifespan" in a sidebar or similar
    const lifespanBtn = page.locator('button:has-text("Lifespan")').first();
    await lifespanBtn.click();

    const header = page.locator('h2:has-text("Lifespan"), [data-panel="lifespan"] h2').first();
    await expect(header).toBeVisible();
    await expect(header).toContainText('Lifespan');
    await expect(header).not.toContainText('(window)');
  });

  test('selecting Strict filter → header becomes "Lifespan (window)" + badge', async ({ page }) => {
    // Open the Lifespan panel
    const lifespanBtn = page.locator('button:has-text("Lifespan")').first();
    await lifespanBtn.click();

    // Activate temporal filter via the dropdown (Item #1)
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');

    // Wait for the windowed re-fetch
    await page.waitForTimeout(2000);

    // Header should now show "(window)" + a badge
    const header = page.locator('h2:has-text("Lifespan")').first();
    await expect(header).toContainText('(window)');

    // Badge format : "<from> → <to> · <N> snapshots"
    const badge = page.locator('[class*="bg-accent"]:has-text("snapshot")').first();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/→/);
    await expect(badge).toContainText(/snapshots?/);
  });

  test('resetting Filter to Off → header reverts to "Lifespan"', async ({ page }) => {
    const lifespanBtn = page.locator('button:has-text("Lifespan")').first();
    await lifespanBtn.click();

    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('normal');
    await page.waitForTimeout(1500);

    // Confirm windowed mode active
    await expect(page.locator('h2:has-text("Lifespan")').first()).toContainText('(window)');

    // Reset to off
    await select.selectOption('off');
    await page.waitForTimeout(1500);

    // Header reverts
    const header = page.locator('h2:has-text("Lifespan")').first();
    await expect(header).not.toContainText('(window)');
  });
});
```

- [ ] **Step 2: Commit (no patch regen — pure tracked file)**

```bash
git add tests/e2e/specs/lifespan-windowed.spec.ts
git commit -m "test(e2e): lifespan windowed header + badge + reset behavior (Task 5)"
```

---

## Task 6: Documentation updates + final commit

**Files:**
- Modify: `ROADMAP.md`
- Modify: `INVENTORY.md`
- Modify: `tests/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update ROADMAP.md**

Find the "Déjà livré" table. Check the current last row number (likely 50 or higher). Add a new row immediately after :

```markdown
| 51 | **Lifespan Windowed (cursors A/B as bounds)** — Phase 2 Item #3 sur 5. Quand `temporalFilterMode !== 'off'` (Item #1), `/lifespan` recompute les 4 buckets (foundational/recent/discontinued/ephemeral) sur la fenêtre [cursorA, cursorB]. Backend : extension du `/lifespan?repo=&from=&to=` existant (backward-compat — sans params, global inchangé). Ephemeral fenêtré réutilise `/nodes/alive-between` machinery (filterSnapshotsInWindow + unionSnapshotNodeIds). UX : header "Lifespan (window)" + badge daterange compact quand `data.windowed` présent dans la réponse. Item #2 (Mode union) subsumed by Item #1 Permissive mode. | `/lifespan?from=&to=`, `lib/lifespan-windowed-core.mjs` (pure fn `computeWindowedBuckets`), branchement dans `useAppState` effect, header + badge dans `LifespanPanel.tsx` |
```

Adjust the row number if needed (check current last row).

Update the date header :

```markdown
Dernière mise à jour : 2026-05-27 (Lifespan Windowed Phase 2 Item #3 livré : /lifespan?from=&to= avec params optionnels backward-compat + LifespanPanel header "(window)" + badge daterange quand temporalFilterMode actif. 3 items Phase 2 restants : URL persistence (#5), Zoom mousewheel (#4). Item #2 subsumed.).
```

- [ ] **Step 2: Update INVENTORY.md**

Find the `/lifespan` row in Partie B.2 endpoints table. Update its description :

```markdown
| `GET /lifespan` | Buckets foundational / recent / discontinued / ephemeral. **Mode global (default)** : computed sur toute l'histoire (1er snapshot → live). **Mode windowed (Phase 2 Item #3)** : `?from=<shortHash\|oldest>&to=<shortHash\|live\|newest>` redéfinit "1er snapshot" → cursorA, "live" → cursorB. Backward-compat — sans params, comportement inchangé. Réponse en mode windowed inclut un champ `windowed: { from, to, snapshotCount }`. Ephemeral fenêtré nécessite snapshots intermédiaires (réutilise `/nodes/alive-between` machinery). |
```

In the components section, find the `LifespanPanel.tsx` line and append :

```markdown
**Lifespan Windowed Phase 2 Item #3** (Tier 51) : header text "(window)" + badge daterange "from → to · N snapshots" affichés quand `data.windowed` présent (i.e. quand temporalFilterMode actif).
```

- [ ] **Step 3: Update tests/README.md**

Find the "Pure logic units" table. Add :

```markdown
| Lifespan windowed — pure fn | `unit/lifespan-windowed-core.test.mjs` | computeWindowedBuckets (4 buckets + ephemeral filter, 5 cases) |
```

Find integration tests section. Add :

```markdown
| Lifespan windowed | `integration/endpoints/lifespan-windowed.test.mjs` | GET 200 global + 200 windowed + 400 partial params + 400 invalid range + alias resolution (5 cases) |
```

Find E2E tests section. Add :

```markdown
| Lifespan windowed | `e2e/specs/lifespan-windowed.spec.ts` | Header + badge toggle on filter mode change (3 cases) |
```

- [ ] **Step 4: Update CLAUDE.md smoke loop**

Find the canonical smoke check section. Add after the existing `/nodes/alive-between` line :

```bash
# Lifespan windowed (Phase 2 Item #3) — requires from/to params, separate check:
curl -s -o /dev/null -w "lifespan windowed: HTTP %{http_code}\n" \
  "http://localhost:4173/lifespan?repo=hmm_studio&from=oldest&to=live"
```

- [ ] **Step 5: Final commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true
git add ROADMAP.md INVENTORY.md tests/README.md CLAUDE.md patches/upstream-all.diff
git commit -m "Lifespan Windowed Phase 2 Item #3 livré: ROADMAP/INVENTORY/tests/CLAUDE (Task 6)"
```

---

## Self-Review

**Spec coverage** :
- ✅ Spec § 2 Goal : 4 buckets with new windowed semantics → Task 1 (pure fn) + Task 2 (backend wiring)
- ✅ Spec § 3 D1 Trigger temporalFilterMode → Task 3 (useAppState branch)
- ✅ Spec § 3 D2 Endpoint extension /lifespan?from=&to= → Task 2
- ✅ Spec § 3 D3 UX header + badge → Task 4
- ✅ Spec § 3 D4 Reuse /nodes/alive-between for ephemeral → Task 2 imports `unionSnapshotNodeIds`
- ✅ Spec § 3 D5 Endpoint branch on params → Task 2
- ✅ Spec § 4.3 Edge cases — from-only or to-only (400, Task 2 Step 4), single-snapshot window (no ephemeral, Task 1 covers), 2-snapshot window (empty intermediates, Task 1), invalid range (400, Task 2), filter=off but lifespanActive (Task 3 falls through to global)
- ✅ Spec § 5 Testing strategy — 1 unit (Task 1) + 1 integ (Task 2) + 1 e2e (Task 5)
- ✅ Spec § 9 Document updates checklist → Task 6

**Placeholder scan** :
- ✅ No "TBD" / "TODO" / "fill in details".
- ⚠️ Task 3 step 2 says "BEFORE (existing)" — that's a comment explaining the transformation, not a placeholder.
- ⚠️ Task 3 step 2 + Task 4 step 3 use "Adapt to actual code" phrasing — this is acceptable because the existing code's exact shape can't be predicted without reading the file ; the patterns and key invariants are spelled out (URL construction with new params ; conditional header rendering with `data.windowed`).

**Type consistency** :
- ✅ `computeWindowedBuckets(idsA, idsB, ephemeralIds): { foundational, recent, discontinued, ephemeral }` consistent in Task 1 (define) + Task 2 (use).
- ✅ `windowed: { from, to, snapshotCount }` response field consistent in Task 2 (return) + Task 3 (param-based URL construction) + Task 4 (reads `data.windowed.from/to/snapshotCount`).
- ✅ `filterSnapshotsInWindow` + `unionSnapshotNodeIds` signatures match Phase 2 Item #1's exports (already shipped).
- ✅ `'oldest' | 'live' | 'newest'` alias strings consistent.

**Scope check** : Single feature (Lifespan windowed), ~3-5 days, 6 tasks. Fits a single plan.

Plan ready for execution.

---

## Effort summary

| Task | Estimate |
|---|---|
| 1. Pure fn computeWindowedBuckets + 5 unit tests | ~½j |
| 2. Backend windowed branch + Dockerfile COPY + integ test | ~1-2j |
| 3. useAppState effect branches | ~½-1j |
| 4. LifespanPanel header + badge | ~½j |
| 5. E2E spec | ~½j |
| 6. Docs + final commit | ~½j |
| **Total** | **~3-5 days** |
