# Timeline URL Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persister tout l'état Timeline (cursorA/B, zoom, graphMode, temporalFilterMode) dans 5 query params URL préfixés `tl`, et restaurer cet état au load une fois les snapshots disponibles — pour des liens partageables et résistance au refresh F5.

**Architecture:** Pure frontend, aucun endpoint. 2 pure fns (`serializeTimelineToParams`, `parseTimelineParams`) testables en isolation + un hook dédié `useTimelineUrlSync` qui orchestre un read one-shot (guardé par ref, attend snapshots) et un write `replaceState` sur changement. Aligné sur le pattern existant (`?project=` via URLSearchParams + history.replaceState). shortHash comme identifiant de cursor (stable across re-index).

**Tech Stack:** React 19 + TypeScript, URLSearchParams + window.history.replaceState (pas de react-router), Vitest 4 + Playwright.

**Spec source:** [`docs/superpowers/specs/2026-05-28-timeline-url-persistence-design.md`](../specs/2026-05-28-timeline-url-persistence-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

---

## Environment notes

**Node 21 limitation** : Local vitest crashes (rolldown binding). CI on Node 22 validates. Commit blind on Node 21.

**Patches/upstream-all.diff encoding** : UTF-16 LE + CRLF via PowerShell `Out-File -Encoding Unicode`.

**Patch regen command** (each task touching `upstream/`) :

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
```

**Parallel session coordination** : `App.tsx` is a hot file. Commit fast. Before each commit : `git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true`.

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `upstream/gitnexus-web/src/lib/timeline-url.ts` | Pure fns `serializeTimelineToParams` + `parseTimelineParams` + `TimelineUrlState` type. No React, no DOM. |
| `upstream/gitnexus-web/src/hooks/useTimelineUrlSync.ts` | Hook : read one-shot (ref-guarded) + write replaceState effects. Self-subscribes to useAppState. |
| `tests/unit/timeline-url.test.mjs` | Vitest for the 2 pure fns. |
| `tests/e2e/specs/timeline-url-persistence.spec.ts` | Playwright : set state → URL updates → reload → restored. |

### Files to modify

| Path | Modification |
|---|---|
| `upstream/gitnexus-web/src/App.tsx` | Mount `useTimelineUrlSync()` once in the App component body. |
| `ROADMAP.md` / `INVENTORY.md` / `tests/README.md` | Standard docs. |
| `patches/upstream-all.diff` | Regen on each task commit. |

---

## Task 1: Pure fns `lib/timeline-url.ts` + unit tests

**Files:**
- Create: `upstream/gitnexus-web/src/lib/timeline-url.ts`
- Create: `tests/unit/timeline-url.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/timeline-url.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  serializeTimelineToParams,
  parseTimelineParams,
} from '../../upstream/gitnexus-web/src/lib/timeline-url';

describe('serializeTimelineToParams', () => {
  it('sets all 5 params for a full non-default state', () => {
    const { set, remove } = serializeTimelineToParams({
      cursorAShortHash: 'a8f3c2d',
      cursorBShortHash: 'live',
      zoom: true,
      graphMode: 'diff',
      filterMode: 'strict',
    });
    expect(set).toEqual({
      tlA: 'a8f3c2d',
      tlB: 'live',
      tlZoom: '1',
      tlMode: 'diff',
      tlFilter: 'strict',
    });
    expect(remove).toEqual([]);
  });

  it('puts default values in the remove list (clean URL)', () => {
    const { set, remove } = serializeTimelineToParams({
      cursorAShortHash: null,
      cursorBShortHash: null,
      zoom: false,
      graphMode: 'single',
      filterMode: 'off',
    });
    expect(set).toEqual({});
    expect(remove.sort()).toEqual(['tlA', 'tlB', 'tlFilter', 'tlMode', 'tlZoom']);
  });

  it('filter=off → tlFilter removed; filter=normal → tlFilter set', () => {
    const off = serializeTimelineToParams({ cursorAShortHash: 'x', cursorBShortHash: 'y', zoom: false, graphMode: 'single', filterMode: 'off' });
    expect(off.remove).toContain('tlFilter');
    const normal = serializeTimelineToParams({ cursorAShortHash: 'x', cursorBShortHash: 'y', zoom: false, graphMode: 'single', filterMode: 'normal' });
    expect(normal.set.tlFilter).toBe('normal');
  });

  it('graphMode=single → tlMode removed; diff → tlMode set', () => {
    const single = serializeTimelineToParams({ cursorAShortHash: 'x', cursorBShortHash: 'y', zoom: false, graphMode: 'single', filterMode: 'off' });
    expect(single.remove).toContain('tlMode');
    const diff = serializeTimelineToParams({ cursorAShortHash: 'x', cursorBShortHash: 'y', zoom: false, graphMode: 'diff', filterMode: 'off' });
    expect(diff.set.tlMode).toBe('diff');
  });
});

describe('parseTimelineParams', () => {
  it('parses all params present', () => {
    const params = new URLSearchParams('tlA=a8f3c2d&tlB=live&tlZoom=1&tlMode=diff&tlFilter=permissive');
    expect(parseTimelineParams(params)).toEqual({
      cursorAShortHash: 'a8f3c2d',
      cursorBShortHash: 'live',
      zoom: true,
      graphMode: 'diff',
      filterMode: 'permissive',
    });
  });

  it('returns defaults when params missing', () => {
    const params = new URLSearchParams('');
    expect(parseTimelineParams(params)).toEqual({
      cursorAShortHash: null,
      cursorBShortHash: null,
      zoom: false,
      graphMode: 'single',
      filterMode: 'off',
    });
  });

  it('invalid tlFilter defaults to off', () => {
    const params = new URLSearchParams('tlFilter=garbage');
    expect(parseTimelineParams(params).filterMode).toBe('off');
  });

  it('tlZoom only true for exactly "1"', () => {
    expect(parseTimelineParams(new URLSearchParams('tlZoom=1')).zoom).toBe(true);
    expect(parseTimelineParams(new URLSearchParams('tlZoom=0')).zoom).toBe(false);
    expect(parseTimelineParams(new URLSearchParams('tlZoom=true')).zoom).toBe(false);
    expect(parseTimelineParams(new URLSearchParams('')).zoom).toBe(false);
  });

  it('tlMode only diff for exactly "diff"', () => {
    expect(parseTimelineParams(new URLSearchParams('tlMode=diff')).graphMode).toBe('diff');
    expect(parseTimelineParams(new URLSearchParams('tlMode=single')).graphMode).toBe('single');
    expect(parseTimelineParams(new URLSearchParams('tlMode=xyz')).graphMode).toBe('single');
  });

  it('round-trips with serializeTimelineToParams (set values)', () => {
    const state = { cursorAShortHash: 'aaa', cursorBShortHash: 'bbb', zoom: true, graphMode: 'diff', filterMode: 'strict' };
    const { set } = serializeTimelineToParams(state);
    const params = new URLSearchParams(set);
    const parsed = parseTimelineParams(params);
    expect(parsed).toEqual(state);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- timeline-url`
Expected: FAIL with "Failed to resolve import .../timeline-url". On Node 21, crash — proceed.

- [ ] **Step 3: Implement `lib/timeline-url.ts`**

Create `upstream/gitnexus-web/src/lib/timeline-url.ts`:

```typescript
/**
 * Pure serialization of the Timeline state to / from URL query params.
 * shortHash-based identifiers (stable across re-index). See spec :
 * docs/superpowers/specs/2026-05-28-timeline-url-persistence-design.md
 */

export interface TimelineUrlState {
  cursorAShortHash: string | null;   // shortHash or 'live' or null
  cursorBShortHash: string | null;
  zoom: boolean;
  graphMode: 'single' | 'diff';
  filterMode: 'off' | 'strict' | 'normal' | 'permissive';
}

/**
 * Serialize Timeline state into a set/remove patch for URLSearchParams.
 * Only sets params that carry non-default info (so the URL stays clean) ;
 * default values go in the `remove` list so the caller deletes them.
 */
export function serializeTimelineToParams(state: TimelineUrlState): {
  set: Record<string, string>;
  remove: string[];
} {
  const set: Record<string, string> = {};
  const remove: string[] = [];

  if (state.cursorAShortHash) set.tlA = state.cursorAShortHash;
  else remove.push('tlA');

  if (state.cursorBShortHash) set.tlB = state.cursorBShortHash;
  else remove.push('tlB');

  if (state.zoom) set.tlZoom = '1';
  else remove.push('tlZoom');

  if (state.graphMode === 'diff') set.tlMode = 'diff';
  else remove.push('tlMode');

  if (state.filterMode !== 'off') set.tlFilter = state.filterMode;
  else remove.push('tlFilter');

  return { set, remove };
}

/**
 * Parse Timeline params out of a URLSearchParams. Returns raw shortHashes
 * (caller resolves them to dates via the snapshot list). Invalid / missing
 * params return null / defaults.
 */
export function parseTimelineParams(params: URLSearchParams): TimelineUrlState {
  const filterRaw = params.get('tlFilter');
  const validFilter =
    filterRaw === 'strict' || filterRaw === 'normal' || filterRaw === 'permissive'
      ? filterRaw
      : 'off';
  return {
    cursorAShortHash: params.get('tlA'),
    cursorBShortHash: params.get('tlB'),
    zoom: params.get('tlZoom') === '1',
    graphMode: params.get('tlMode') === 'diff' ? 'diff' : 'single',
    filterMode: validFilter,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- timeline-url`
Expected: PASS with 9 tests (4 serialize + 5 parse, includes round-trip). Or Node 21 crash — proceed.

- [ ] **Step 5: Regen patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true
git add patches/upstream-all.diff tests/unit/timeline-url.test.mjs
git commit -m "feat(timeline-url): pure fns serializeTimelineToParams + parseTimelineParams + 9 unit tests (Task 1)"
```

---

## Task 2: Hook `useTimelineUrlSync` (read + write effects)

**Files:**
- Create: `upstream/gitnexus-web/src/hooks/useTimelineUrlSync.ts`

- [ ] **Step 1: Verify the useAppState fields the hook needs exist**

Run:
```bash
grep -n "cursorA\|cursorB\|zoomWindow\|graphMode\|temporalFilterMode\|setCursorA\|setCursorB\|enterZoom\|setGraphMode\|setTemporalFilterMode\|availableRepos\|projectName" upstream/gitnexus-web/src/hooks/useAppState.tsx | grep "return\|:" | head -30
```

Confirm these are all exposed by useAppState (they were added in Phase 1 + Phase 2 Item #1). If any is missing, STOP and report — the hook depends on them.

- [ ] **Step 2: Implement the hook**

Create `upstream/gitnexus-web/src/hooks/useTimelineUrlSync.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { useAppState } from './useAppState';
import { serializeTimelineToParams, parseTimelineParams } from '../lib/timeline-url';

/**
 * Two-way sync between Timeline state and the URL query string :
 *   - WRITE : on any change to cursorA/B/zoomWindow/graphMode/temporalFilterMode,
 *     replaceState the 5 tl* params (resolving cursor dates -> shortHash).
 *   - READ : one-shot on mount once snapshots are available, parse the URL
 *     params (resolving shortHash -> date) and apply to state.
 *
 * Mounted once in App.tsx. Self-subscribes to useAppState. Produces no UI.
 * See docs/superpowers/specs/2026-05-28-timeline-url-persistence-design.md
 */
export function useTimelineUrlSync(): void {
  const {
    projectName,
    availableRepos,
    cursorA,
    cursorB,
    zoomWindow,
    graphMode,
    temporalFilterMode,
    setCursorA,
    setCursorB,
    enterZoom,
    setGraphMode,
    setTemporalFilterMode,
  } = useAppState();

  const baseRepo = projectName ? projectName.split('@')[0] : '';
  const readDone = useRef(false);

  const dateToShortHash = (date: string | null): string | null => {
    if (!date) return null;
    const repo = availableRepos.find((r) => r.name === baseRepo);
    const snap = repo?.snapshots?.find((s) => s.commit?.date === date);
    if (snap) return snap.commit?.shortHash || null;
    if (repo?.indexedAt === date) return 'live';
    return null;
  };

  const shortHashToDate = (sh: string | null): string | null => {
    if (!sh) return null;
    const repo = availableRepos.find((r) => r.name === baseRepo);
    if (sh === 'live') return repo?.indexedAt || null;
    const snap = repo?.snapshots?.find((s) => s.commit?.shortHash === sh);
    return snap?.commit?.date || null;
  };

  // READ (one-shot, after snapshots load)
  useEffect(() => {
    if (readDone.current) return;
    const repo = availableRepos.find((r) => r.name === baseRepo);
    if (!repo || !repo.snapshots?.length) return; // wait for snapshots

    const params = new URLSearchParams(window.location.search);
    const hasAny =
      params.has('tlA') ||
      params.has('tlB') ||
      params.has('tlZoom') ||
      params.has('tlMode') ||
      params.has('tlFilter');
    if (!hasAny) {
      readDone.current = true; // nothing to restore, unblock the write effect
      return;
    }

    const parsed = parseTimelineParams(params);
    const dateA = shortHashToDate(parsed.cursorAShortHash);
    const dateB = shortHashToDate(parsed.cursorBShortHash);
    if (dateA) setCursorA(dateA);
    if (dateB) setCursorB(dateB);
    if (parsed.filterMode !== 'off') setTemporalFilterMode(parsed.filterMode);
    if (parsed.graphMode === 'diff') setGraphMode('diff');
    if (parsed.zoom && dateA && dateB) enterZoom();
    readDone.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableRepos, baseRepo]);

  // WRITE (on any state change, only after read is done)
  useEffect(() => {
    if (!readDone.current) return; // don't clobber a shared link before reading it
    const { set, remove } = serializeTimelineToParams({
      cursorAShortHash: dateToShortHash(cursorA),
      cursorBShortHash: dateToShortHash(cursorB),
      zoom: zoomWindow !== null,
      graphMode,
      filterMode: temporalFilterMode,
    });
    const urlObj = new URL(window.location.href);
    for (const [k, v] of Object.entries(set)) urlObj.searchParams.set(k, v);
    for (const k of remove) urlObj.searchParams.delete(k);
    window.history.replaceState(null, '', urlObj.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorA, cursorB, zoomWindow, graphMode, temporalFilterMode, availableRepos, baseRepo]);
}
```

- [ ] **Step 3: Regen patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true
git add patches/upstream-all.diff
git commit -m "feat(timeline-url): useTimelineUrlSync hook — read one-shot + write replaceState (Task 2)"
```

---

## Task 3: Mount `useTimelineUrlSync` in App.tsx

**Files:**
- Modify: `upstream/gitnexus-web/src/App.tsx`

- [ ] **Step 1: Locate the App component body + existing hook calls**

Run: `grep -n "useAppState\|useEffect\|export function App\|export default\|const App\|function App" upstream/gitnexus-web/src/App.tsx | head -15`

Find where the App component body begins and where other hooks are called (e.g., `useAppState()`).

- [ ] **Step 2: Add the import**

At the top of `App.tsx`, with the other hook imports, add:

```typescript
import { useTimelineUrlSync } from './hooks/useTimelineUrlSync';
```

(Adapt the relative path if App.tsx is in a subfolder — it's at `src/App.tsx`, hook at `src/hooks/`, so `./hooks/useTimelineUrlSync` is correct.)

- [ ] **Step 3: Call the hook in the App component body**

In the App component function body (near other hook calls like `useAppState()` or top-level `useEffect`s), add:

```typescript
  // Two-way sync of Timeline state <-> URL query params (shareable links).
  useTimelineUrlSync();
```

Place it after the component's other hook calls. It takes no args and returns nothing.

- [ ] **Step 4: Regen patches + commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true
git add patches/upstream-all.diff
git commit -m "feat(timeline-url): mount useTimelineUrlSync in App (Task 3)"
```

---

## Task 4: E2E Playwright spec

**Files:**
- Create: `tests/e2e/specs/timeline-url-persistence.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/specs/timeline-url-persistence.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

/**
 * E2E spec for Timeline URL Persistence (Phase 2 Item #5).
 * Verify Timeline state round-trips through URL query params.
 */

test.describe('Timeline URL persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    await page.waitForSelector('[data-cursor="B"]', { timeout: 30_000 });
  });

  test('selecting filter + compare writes tl* params to URL', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');
    await page.click('button:has-text("Compare A↔B")');
    await page.waitForTimeout(1500);

    const url = page.url();
    expect(url).toMatch(/tlFilter=strict/);
    expect(url).toMatch(/tlMode=diff/);
    // tlA + tlB written once cursors resolve to shortHashes
    expect(url).toMatch(/tlA=/);
    expect(url).toMatch(/tlB=/);
  });

  test('state restores after reload', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('normal');
    await page.waitForTimeout(1500);
    expect(page.url()).toMatch(/tlFilter=normal/);

    await page.reload();
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    await page.waitForTimeout(1500);

    // Filter dropdown restored to "normal"
    await expect(page.locator('label:has-text("Filter:")').locator('select')).toHaveValue('normal');
    // URL still has the param
    expect(page.url()).toMatch(/tlFilter=normal/);
  });

  test('resetting filter to off removes tlFilter from URL', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');
    await page.waitForTimeout(1000);
    expect(page.url()).toMatch(/tlFilter=strict/);

    await select.selectOption('off');
    await page.waitForTimeout(1000);
    expect(page.url()).not.toMatch(/tlFilter=/);
  });

  test('zoom writes tlZoom=1, zoom out removes it', async ({ page }) => {
    await page.click('button:has-text("Zoom to window")');
    await page.waitForTimeout(1000);
    expect(page.url()).toMatch(/tlZoom=1/);

    await page.click('button:has-text("Zoom out")');
    await page.waitForTimeout(1000);
    expect(page.url()).not.toMatch(/tlZoom=/);
  });
});
```

- [ ] **Step 2: Commit (no patch regen — pure tracked file)**

```bash
git add tests/e2e/specs/timeline-url-persistence.spec.ts
git commit -m "test(e2e): timeline URL persistence — write params + reload restore + clear (Task 4)"
```

---

## Task 5: Documentation updates + final commit

**Files:**
- Modify: `ROADMAP.md`
- Modify: `INVENTORY.md`
- Modify: `tests/README.md`

- [ ] **Step 1: Update ROADMAP.md**

Find the "Déjà livré" table. Run `grep "^| [0-9]" ROADMAP.md | tail -3` to find the current last row number. Add a new row with the next number :

```markdown
| <NEXT_NUM> | **Timeline URL Persistence (shareable view links)** — Phase 2 Item #5 sur 5. Persiste tout l'état Timeline (cursorA/B, zoom, graphMode, temporalFilterMode) dans 5 query params préfixés `tl` (tlA/tlB/tlZoom/tlMode/tlFilter), shortHash-based (stable across re-index, `live` alias pour le head). Read one-shot guardé attendant snapshots ; write `replaceState` sur changement. Lien partageable + résistance F5. Pure frontend, aucun endpoint. | `lib/timeline-url.ts` (serializeTimelineToParams + parseTimelineParams), `hooks/useTimelineUrlSync.ts`, mount dans `App.tsx` |
```

Update the date header :

```markdown
Dernière mise à jour : 2026-05-28 (Timeline URL Persistence Phase 2 Item #5 livré : 5 params tl* shareable + restore au reload. Reste 1 item Phase 2 : Zoom mousewheel (#4). Item #2 subsumed.).
```

- [ ] **Step 2: Update INVENTORY.md**

In the frontend components/hooks section, find a logical spot (near the Timeline.tsx entry) and add:

```markdown
- `hooks/useTimelineUrlSync.ts` + `lib/timeline-url.ts` — **Timeline URL Persistence Phase 2 Item #5** (Tier <NEXT_NUM>) : sync bidirectionnel état Timeline ↔ URL via 5 params `tl*` (shortHash-based). Read one-shot guardé (readDone ref) attendant snapshots ; write replaceState. Aligné sur le pattern `?project=` existant.
```

(Use same NEXT_NUM as ROADMAP.)

- [ ] **Step 3: Update tests/README.md**

Find the "Pure logic units" table. Add:

```markdown
| Timeline URL — pure fns | `unit/timeline-url.test.mjs` | serializeTimelineToParams + parseTimelineParams (round-trip, 9 cases) |
```

Find the E2E tests section. Add:

```markdown
| Timeline URL persistence | `e2e/specs/timeline-url-persistence.spec.ts` | write tl* params + reload restore + clear on default + zoom param (4 cases) |
```

- [ ] **Step 4: Final commit**

```bash
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>/dev/null || true
git add ROADMAP.md INVENTORY.md tests/README.md patches/upstream-all.diff
git commit -m "Timeline URL Persistence Phase 2 Item #5 livré: ROADMAP/INVENTORY/tests (Task 5)"
```

---

## Self-Review

**Spec coverage** :
- ✅ Spec § 2 Goal : 5 params tl* + read/write → Task 1 (pure fns) + Task 2 (hook) + Task 3 (mount)
- ✅ Spec § 3 D1 all 5 params → Task 1 serialize covers all 5
- ✅ Spec § 3 D2 shortHash identifier → Task 2 `dateToShortHash`/`shortHashToDate` resolution
- ✅ Spec § 3 D3 read one-shot guarded → Task 2 `readDone` ref + `snapshots?.length` wait
- ✅ Spec § 3 D4 replaceState + tl prefix → Task 2 write effect
- ✅ Spec § 3 D5 pure fns extracted → Task 1
- ✅ Spec § 4.3 Edge cases — no params (Task 2 hasAny guard), shortHash not found (shortHashToDate returns null → cursor not set), tlZoom without cursors (enterZoom no-op), garbage tlFilter (parseTimelineParams validates), write-before-read race (readDone guard), repo switch (documented), tlMode+filter compose (Task 2 read applies both)
- ✅ Spec § 5 Testing — 1 unit (Task 1, 9 cases) + 1 e2e (Task 4, 4 cases)
- ✅ Spec § 9 Document updates → Task 5

**Placeholder scan** :
- ✅ No "TBD"/"TODO".
- ⚠️ Task 3 step 2/3 + Task 5 use "<NEXT_NUM>" placeholders — these are intentional : the engineer must check the current last ROADMAP row (parallel session keeps adding) and use the next number. The grep command to determine it is provided.
- ⚠️ Task 3 says "Adapt the relative path if..." + "Place it after the component's other hook calls" — acceptable, since App.tsx exact structure can't be predicted ; the import path is given and the placement constraint (after useAppState is available) is clear.

**Type consistency** :
- ✅ `TimelineUrlState` shape consistent : Task 1 defines `{ cursorAShortHash, cursorBShortHash, zoom, graphMode, filterMode }`, Task 2 uses the same fields when calling `serializeTimelineToParams`.
- ✅ `serializeTimelineToParams` returns `{ set, remove }` — Task 1 defines, Task 2 destructures `{ set, remove }`.
- ✅ `parseTimelineParams(params)` returns `TimelineUrlState` — Task 1 defines, Task 2 reads `.cursorAShortHash/.filterMode/.graphMode/.zoom`.
- ✅ Hook consumes useAppState fields that exist from Phase 1 + Item #1 (verified in Task 2 Step 1).

**Scope check** : Single feature (URL persistence), ~2-3 days, 5 tasks. Fits a single plan.

Plan ready for execution.

---

## Effort summary

| Task | Estimate |
|---|---|
| 1. Pure fns + 9 unit tests | ~½j |
| 2. useTimelineUrlSync hook | ~1j |
| 3. Mount in App.tsx | ~¼j |
| 4. E2E spec | ~½j |
| 5. Docs + final commit | ~½j |
| **Total** | **~2-3 days** |
