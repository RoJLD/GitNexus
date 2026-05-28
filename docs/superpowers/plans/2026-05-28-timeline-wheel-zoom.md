# Timeline Wheel Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un zoom continu à la molette sur la Timeline gitnexus, ancré sur la souris, qui rapproche/écarte les curseurs A/B (donc la fenêtre `[A,B]`) et entre/sort du zoom tout seul, snappant aux snapshots au repos.

**Architecture:** Couplé aux curseurs (réutilise `zoomWindow` + le pipeline curseur→graphe Phase 1). Approche 1 : une pure fn `applyWheelZoom` + un état transitoire local `wheelWindow` dans `Timeline.tsx` (update rAF-throttlé pendant le scroll), et un commit-on-settle debouncé qui snappe aux snapshots puis appelle les setters existants. `useAppState` reçoit une seule extension rétro-compatible (`enterZoom` accepte des bornes explicites).

**Tech Stack:** React 19 + TypeScript, `window.addEventListener('wheel', …, {passive:false})` + requestAnimationFrame + debounce, Vitest 4 (unit), Playwright (e2e).

**Spec source:** [`docs/superpowers/specs/2026-05-28-timeline-wheel-zoom-design.md`](../specs/2026-05-28-timeline-wheel-zoom-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

---

## Environment notes

**Node 21 limitation** : vitest crashe localement (rolldown binding `@rolldown/binding-win32-x64-msvc`). Les tests unitaires sont committés "blind" ; CI Node 22 valide. Si `npm run test:unit` crashe, c'est ATTENDU — continuer.

**Patches/upstream-all.diff encoding** : UTF-16 LE + CRLF via PowerShell `Out-File -Encoding Unicode`. Bash `>` produit de l'UTF-8 LF → churn binaire. Toujours utiliser la commande PowerShell ci-dessous.

**Patch regen command** (chaque tâche touchant `upstream/`) :

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
```

**Parallel session coordination** : `Timeline.tsx` + `useAppState.tsx` sont des fichiers chauds. Committer vite. Avant chaque commit : `git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null` (PowerShell `2>$null`). Ne JAMAIS committer : `.claude/`, `AGENTS.md`, `roadmap.yml`, `tests/package-lock.json`.

**Git identity** : déjà `roblastar@live.fr` — ne pas toucher `git config`.

---

## File Structure

### Files to create
Aucun fichier nouveau.

### Files to modify

| Path | Modification |
|---|---|
| `upstream/gitnexus-web/src/lib/timeline-zoom.ts` | + pure fn `applyWheelZoom` (Task 1) |
| `upstream/gitnexus-web/src/config/ui-constants.ts` | + 3 constantes wheel zoom (Task 2) |
| `upstream/gitnexus-web/src/hooks/useAppState.tsx` | `enterZoom` accepte bornes explicites optionnelles (Task 2) |
| `upstream/gitnexus-web/src/components/Timeline.tsx` | état transitoire + wheel listener + settle commit (Task 3) |
| `tests/unit/timeline-zoom.test.mjs` | + cas `applyWheelZoom` (Task 1) |
| `tests/e2e/specs/timeline-zoom-and-diff.spec.ts` | + scénario wheel up/down (Task 4) |
| `ROADMAP.md` / `INVENTORY.md` / `tests/README.md` | docs (Task 5) |
| `patches/upstream-all.diff` | regen (Tasks 1, 2, 3, 5) |

**Testing tier note** : pas de test composant jsdom. `tests/unit/components/Timeline.test.tsx` n'existe pas et créer une infra jsdom pour wheel + rAF + debounce + listener non-passif serait flaky et non exécutable sur Node 21. La logique réelle est dans la pure fn `applyWheelZoom` (Task 1, unit) ; l'interaction navigateur est couverte par l'E2E (Task 4). C'est le tier honnête conforme à l'existant.

---

## Task 1: Pure fn `applyWheelZoom` + unit tests

**Files:**
- Modify: `upstream/gitnexus-web/src/lib/timeline-zoom.ts`
- Modify: `tests/unit/timeline-zoom.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/timeline-zoom.test.mjs` (the file already imports from `../../upstream/gitnexus-web/src/lib/timeline-zoom`; add `applyWheelZoom` to that import and add this block at the end of the file):

```javascript
describe('applyWheelZoom', () => {
  const full = { startISO: '2026-01-01T00:00:00.000Z', endISO: '2026-02-01T00:00:00.000Z' };

  it('zoom in (deltaY<0) shrinks the span', () => {
    const cur = { startISO: '2026-01-01T00:00:00.000Z', endISO: '2026-02-01T00:00:00.000Z' };
    const out = applyWheelZoom(cur, '2026-01-16T00:00:00.000Z', -120, full);
    const span = Date.parse(out.endISO) - Date.parse(out.startISO);
    const curSpan = Date.parse(cur.endISO) - Date.parse(cur.startISO);
    expect(span).toBeLessThan(curSpan);
  });

  it('zoom out (deltaY>0) grows the span', () => {
    const cur = { startISO: '2026-01-10T00:00:00.000Z', endISO: '2026-01-20T00:00:00.000Z' };
    const out = applyWheelZoom(cur, '2026-01-15T00:00:00.000Z', 120, full);
    const span = Date.parse(out.endISO) - Date.parse(out.startISO);
    const curSpan = Date.parse(cur.endISO) - Date.parse(cur.startISO);
    expect(span).toBeGreaterThan(curSpan);
  });

  it('keeps the anchor at the same relative position when zooming in', () => {
    const cur = { startISO: '2026-01-01T00:00:00.000Z', endISO: '2026-01-31T00:00:00.000Z' };
    const anchor = '2026-01-08T00:00:00.000Z'; // ratio ~0.233
    const ratioBefore = (Date.parse(anchor) - Date.parse(cur.startISO)) / (Date.parse(cur.endISO) - Date.parse(cur.startISO));
    const out = applyWheelZoom(cur, anchor, -120, full);
    const ratioAfter = (Date.parse(anchor) - Date.parse(out.startISO)) / (Date.parse(out.endISO) - Date.parse(out.startISO));
    expect(ratioAfter).toBeCloseTo(ratioBefore, 5);
  });

  it('clamps the span to minSpanMs (no infinite zoom in)', () => {
    const cur = { startISO: '2026-01-15T00:00:00.000Z', endISO: '2026-01-15T02:00:00.000Z' };
    const out = applyWheelZoom(cur, '2026-01-15T01:00:00.000Z', -10000, full, { minSpanMs: 3_600_000 });
    const span = Date.parse(out.endISO) - Date.parse(out.startISO);
    expect(span).toBeGreaterThanOrEqual(3_600_000);
  });

  it('clamps to full span on aggressive zoom out and stays within fullRange', () => {
    const cur = { startISO: '2026-01-14T00:00:00.000Z', endISO: '2026-01-16T00:00:00.000Z' };
    const out = applyWheelZoom(cur, '2026-01-15T00:00:00.000Z', 10000, full);
    const span = Date.parse(out.endISO) - Date.parse(out.startISO);
    const fullSpan = Date.parse(full.endISO) - Date.parse(full.startISO);
    expect(span).toBe(fullSpan);
    expect(Date.parse(out.startISO)).toBeGreaterThanOrEqual(Date.parse(full.startISO));
    expect(Date.parse(out.endISO)).toBeLessThanOrEqual(Date.parse(full.endISO));
  });

  it('shift-to-fit: a window pushed past the left edge is translated back inside', () => {
    const cur = { startISO: '2026-01-02T00:00:00.000Z', endISO: '2026-01-06T00:00:00.000Z' };
    // anchor near the left, zoom out — would push start before full.start
    const out = applyWheelZoom(cur, '2026-01-03T00:00:00.000Z', 200, full);
    expect(Date.parse(out.startISO)).toBeGreaterThanOrEqual(Date.parse(full.startISO));
    expect(Date.parse(out.endISO)).toBeLessThanOrEqual(Date.parse(full.endISO));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tests; npm run test:unit -- timeline-zoom`
Expected: FAIL (`applyWheelZoom is not a function`) OR Node 21 rolldown crash. Either way, proceed.

- [ ] **Step 3: Implement `applyWheelZoom`**

Append to `upstream/gitnexus-web/src/lib/timeline-zoom.ts` (after `snapToNearestSnapshot`):

```typescript
/**
 * Continuous mouse-anchored wheel zoom for the Timeline. Scales the span of
 * `current` around `anchorISO` by exp(deltaY * sensitivity) — deltaY<0 zooms
 * in (smaller span), deltaY>0 zooms out (larger span). The result is clamped
 * to [minSpanMs, full span] and shifted to stay inside `fullRange` without
 * changing the resulting span. A returned span === full span signals the
 * caller to exit zoom. See spec § 4.2.
 */
export function applyWheelZoom(
  current: DateRange,
  anchorISO: string,
  deltaY: number,
  fullRange: DateRange,
  opts?: { sensitivity?: number; minSpanMs?: number },
): DateRange {
  const sensitivity = opts?.sensitivity ?? 0.0015;
  const minSpanMs = opts?.minSpanMs ?? 3_600_000; // 1 hour floor

  const startMs = Date.parse(current.startISO);
  const endMs = Date.parse(current.endISO);
  const fullStartMs = Date.parse(fullRange.startISO);
  const fullEndMs = Date.parse(fullRange.endISO);
  const fullSpan = Math.max(0, fullEndMs - fullStartMs);
  const span = endMs - startMs;

  // Degenerate inputs — return the full range (nothing sensible to zoom).
  if (!(span > 0) || !(fullSpan > 0)) {
    return { startISO: fullRange.startISO, endISO: fullRange.endISO };
  }

  const anchorMs = Date.parse(anchorISO);
  let anchorRatio = (anchorMs - startMs) / span;
  if (!Number.isFinite(anchorRatio)) anchorRatio = 0.5;
  anchorRatio = Math.max(0, Math.min(1, anchorRatio));

  const scale = Math.exp(deltaY * sensitivity); // <1 zoom in, >1 zoom out
  const newSpan = Math.max(minSpanMs, Math.min(fullSpan, span * scale));

  let newStart = anchorMs - anchorRatio * newSpan;
  let newEnd = newStart + newSpan;

  // Shift-to-fit inside fullRange (preserve newSpan).
  if (newStart < fullStartMs) {
    newStart = fullStartMs;
    newEnd = newStart + newSpan;
  }
  if (newEnd > fullEndMs) {
    newEnd = fullEndMs;
    newStart = newEnd - newSpan;
  }

  return {
    startISO: new Date(newStart).toISOString(),
    endISO: new Date(newEnd).toISOString(),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tests; npm run test:unit -- timeline-zoom`
Expected: PASS (6 new cases + the existing ones), OR Node 21 crash — proceed.

- [ ] **Step 5: Regen patches + commit**

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff tests/unit/timeline-zoom.test.mjs
git commit -m "feat(timeline-wheel): applyWheelZoom pure fn + 6 unit cases (Task 1)"
```

---

## Task 2: Wheel constants + `enterZoom` explicit bounds

**Files:**
- Modify: `upstream/gitnexus-web/src/config/ui-constants.ts`
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx`

- [ ] **Step 1: Add the constants**

Append to `upstream/gitnexus-web/src/config/ui-constants.ts`:

```typescript
/** Timeline wheel zoom — span scaling sensitivity per wheel deltaY unit. */
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;
/** Timeline wheel zoom — minimum window span in ms (zoom-in floor). */
export const WHEEL_ZOOM_MIN_SPAN_MS = 3_600_000; // 1 hour
/** Timeline wheel zoom — idle delay before snapping cursors + recomputing. */
export const WHEEL_ZOOM_SETTLE_MS = 200;
```

- [ ] **Step 2: Locate the existing `enterZoom`**

Run: `grep -n "const enterZoom = useCallback" upstream/gitnexus-web/src/hooks/useAppState.tsx`
Expected: one match (around line 2014). Read the surrounding 5 lines to confirm it currently reads:

```typescript
  const enterZoom = useCallback(() => {
    if (cursorA === null || cursorB === null) return;
    setZoomWindow({ a: cursorA, b: cursorB });
  }, [cursorA, cursorB]);
```

- [ ] **Step 3: Extend `enterZoom` to accept optional explicit bounds**

Replace that `enterZoom` definition with:

```typescript
  const enterZoom = useCallback((aISO?: string, bISO?: string) => {
    const a = aISO ?? cursorA;
    const b = bISO ?? cursorB;
    if (a === null || b === null) return;
    setZoomWindow({ a, b });
  }, [cursorA, cursorB]);
```

- [ ] **Step 4: Update the `enterZoom` type in the context interface**

Run: `grep -n "enterZoom:" upstream/gitnexus-web/src/hooks/useAppState.tsx`
Expected: one match in the context type interface (around line 241), currently `enterZoom: () => void;`.

Replace it with:

```typescript
  enterZoom: (aISO?: string, bISO?: string) => void;
```

- [ ] **Step 5: Regen patches + commit**

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(timeline-wheel): wheel zoom constants + enterZoom optional explicit bounds (Task 2)"
```

(No new test: `enterZoom()` arg-less callers — the button at Timeline ~line 1030 and keyboard `Z` at ~line 387 — keep working via the `?? cursorA/cursorB` fallback. The explicit-bounds path is exercised by the E2E in Task 4.)

---

## Task 3: Wheel zoom in `Timeline.tsx`

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`

Context (already in the file): `timelineBarRef` (line ~304) is the main track `<div>` (`getBoundingClientRect` used by drag). `points` = all snapshots+live oldest→newest (~line 202). `visiblePoints` filters `points` by `zoomWindow` (~line 230). Setters `setCursorA/setCursorB/enterZoom/exitZoom` are destructured (~lines 128-132). `mapPositionToDate`, `snapToNearestSnapshot`, `applyWheelZoom` come from `../lib/timeline-zoom`.

- [ ] **Step 1: Add imports**

Run: `grep -n "from '../lib/timeline-zoom'" upstream/gitnexus-web/src/components/Timeline.tsx`

If the import exists, extend it; otherwise add it near the other `../lib` imports. The final import must include all four names:

```typescript
import { mapPositionToDate, snapToNearestSnapshot, applyWheelZoom } from '../lib/timeline-zoom';
```

Also add the constants import (near the existing config import):

```typescript
import { WHEEL_ZOOM_MIN_SPAN_MS, WHEEL_ZOOM_SENSITIVITY, WHEEL_ZOOM_SETTLE_MS } from '../config/ui-constants';
```

(If `mapPositionToDate`/`snapToNearestSnapshot` are not yet imported because the Phase 1 code computed positions inline, just add the single import line above — they are exported by `lib/timeline-zoom.ts`.)

- [ ] **Step 2: Add the transient wheel-window state + refs**

Just after the `miniMapCollapsed` state block (around line 169, before the `baseRepo` memo), add:

```typescript
  // Wheel zoom — transient continuous view window during an active scroll.
  // null = settled (render from committed zoomWindow). See spec § 4.3.
  const [wheelWindow, setWheelWindow] = useState<{ startISO: string; endISO: string } | null>(null);
  const wheelSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelRafId = useRef<number | null>(null);
  const wheelWindowRef = useRef<{ startISO: string; endISO: string } | null>(null);
  wheelWindowRef.current = wheelWindow;
```

- [ ] **Step 3: Make the rendered window zoom-aware of `wheelWindow`**

Replace the existing `visiblePoints` memo (currently keyed on `zoomWindow`, ~lines 230-238):

```typescript
  const visiblePoints = useMemo(() => {
    if (!zoomWindow) return points;
    const aMs = Date.parse(zoomWindow.a);
    const bMs = Date.parse(zoomWindow.b);
    return points.filter((p) => {
      const t = Date.parse(p.date);
      return t >= aMs && t <= bMs;
    });
  }, [points, zoomWindow]);
```

with a version that prefers the transient window during a wheel scroll:

```typescript
  // During an active wheel scroll, render against the transient window so the
  // dots reflow live. When settled, fall back to the committed zoomWindow.
  const effectiveWindow = useMemo(() => {
    if (wheelWindow) return { a: wheelWindow.startISO, b: wheelWindow.endISO };
    return zoomWindow;
  }, [wheelWindow, zoomWindow]);

  const visiblePoints = useMemo(() => {
    if (!effectiveWindow) return points;
    const aMs = Date.parse(effectiveWindow.a);
    const bMs = Date.parse(effectiveWindow.b);
    return points.filter((p) => {
      const t = Date.parse(p.date);
      return t >= aMs && t <= bMs;
    });
  }, [points, effectiveWindow]);
```

- [ ] **Step 4: Add the non-passive wheel listener + settle commit**

Add this `useEffect` immediately after the keyboard-shortcuts `useEffect` (the one ending around line 395 with `}, [cursorA, cursorB, points, zoomWindow, graphMode, enterZoom, exitZoom, setGraphMode]);`):

```typescript
  // Wheel zoom — continuous, mouse-anchored, coupled to cursors. The rapid
  // wheel burst only updates a transient window (rAF-throttled). A debounced
  // settle snaps the edges to snapshots and commits to the cursors exactly
  // once, reusing the existing cursor→graph pipeline. See spec § 4.3.
  useEffect(() => {
    const el = timelineBarRef.current;
    if (!el || points.length < 2) return;

    const fullRange = { startISO: points[0].date, endISO: points[points.length - 1].date };

    const commitSettle = () => {
      const w = wheelWindowRef.current;
      if (!w) return;
      const startSnap = snapToNearestSnapshot(w.startISO, points);
      let endSnap = snapToNearestSnapshot(w.endISO, points);
      if (startSnap === null || endSnap === null) {
        setWheelWindow(null);
        return;
      }
      // Non-degenerate: if both edges snapped to the same snapshot, widen by
      // one neighbour so the window always spans >= 2 snapshots.
      if (startSnap === endSnap) {
        const idx = points.findIndex((p) => p.date === endSnap);
        if (idx < points.length - 1) endSnap = points[idx + 1].date;
        else if (idx > 0) endSnap = points[idx - 1].date;
      }
      const ordered = startSnap <= endSnap ? [startSnap, endSnap] : [endSnap, startSnap];
      const isFull = ordered[0] === points[0].date && ordered[1] === points[points.length - 1].date;
      setCursorA(ordered[0]);
      setCursorB(ordered[1]);
      if (isFull) exitZoom();
      else enterZoom(ordered[0], ordered[1]);
      setWheelWindow(null);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // stop page scroll while zooming the timeline
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const current =
        wheelWindowRef.current ??
        (zoomWindow
          ? { startISO: zoomWindow.a, endISO: zoomWindow.b }
          : fullRange);
      const anchorISO = mapPositionToDate(x, { startISO: current.startISO, endISO: current.endISO }, rect.width);
      const next = applyWheelZoom(current, anchorISO, e.deltaY, fullRange, {
        sensitivity: WHEEL_ZOOM_SENSITIVITY,
        minSpanMs: WHEEL_ZOOM_MIN_SPAN_MS,
      });
      wheelWindowRef.current = next;
      if (wheelRafId.current === null) {
        wheelRafId.current = requestAnimationFrame(() => {
          setWheelWindow(wheelWindowRef.current);
          wheelRafId.current = null;
        });
      }
      if (wheelSettleTimer.current !== null) clearTimeout(wheelSettleTimer.current);
      wheelSettleTimer.current = setTimeout(commitSettle, WHEEL_ZOOM_SETTLE_MS);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelRafId.current !== null) cancelAnimationFrame(wheelRafId.current);
      if (wheelSettleTimer.current !== null) clearTimeout(wheelSettleTimer.current);
    };
  }, [points, zoomWindow, setCursorA, setCursorB, enterZoom, exitZoom]);
```

- [ ] **Step 5: Render the cursor triangles at the window edges during an active wheel scroll**

The cursors are positioned by `cursorPosition(cursorDate)` (~line 258), which returns `null` when the cursor date is outside `visiblePoints`. During a wheel scroll the committed cursors may be off-window, so the triangles would vanish. Find where cursor A and cursor B compute their `left` position (the `role="slider"` blocks around lines 1102-1130). Each uses a value like `cursorPosition(cursorA)` / `cursorPosition(cursorB)`.

Add this helper right after the `cursorPosition` definition (~line 263):

```typescript
  // While wheel-zooming, the committed cursors may sit outside the transient
  // window — pin the triangles to the window edges so they track the preview.
  const cursorDisplayPosition = (which: 'A' | 'B'): number | null => {
    if (wheelWindow) return which === 'A' ? 0 : 100;
    return cursorPosition(which === 'A' ? cursorA : cursorB);
  };
```

Then in the cursor A slider block, replace its position source `cursorPosition(cursorA)` with `cursorDisplayPosition('A')`, and in the cursor B block replace `cursorPosition(cursorB)` with `cursorDisplayPosition('B')`. (Search for the two `cursorPosition(` call sites in the JSX and swap them; leave any other use of `cursorPosition` untouched.)

- [ ] **Step 6: Regen patches + commit**

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(timeline-wheel): mouse-anchored continuous wheel zoom in Timeline (Task 3)"
```

---

## Task 4: E2E Playwright spec

**Files:**
- Modify: `tests/e2e/specs/timeline-zoom-and-diff.spec.ts`

- [ ] **Step 1: Add the wheel-zoom test block**

Append inside the existing `test.describe('Timeline zoom + cursor diff (Phase 1)', () => { ... })` block in `tests/e2e/specs/timeline-zoom-and-diff.spec.ts` (just before its closing `});`):

```typescript
  test('mousewheel zooms in (mini-map appears, tlZoom=1) and out (exits)', async ({ page }) => {
    // Locate the timeline track (the bar that holds the cursor sliders).
    const cursorA = page.locator('[role="slider"][aria-label="Cursor A"]');
    await expect(cursorA).toBeVisible();
    const box = await cursorA.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Wheel UP (deltaY<0) over the middle of the timeline → zoom in.
    const cx = box.x + 150;
    const cy = box.y;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(60);
    }
    // After the settle debounce, zoom is committed: mini-map visible + URL param.
    await page.waitForTimeout(600);
    await expect(page.getByRole('region', { name: /mini-map/i })).toBeVisible();
    expect(page.url()).toMatch(/tlZoom=1/);

    // Wheel DOWN (deltaY>0) hard → zoom out fully → exits.
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(600);
    await expect(page.getByRole('region', { name: /mini-map/i })).not.toBeVisible();
    expect(page.url()).not.toMatch(/tlZoom=1/);
  });
```

- [ ] **Step 2: Commit (pure tracked file, no patch regen)**

```
git add tests/e2e/specs/timeline-zoom-and-diff.spec.ts
git commit -m "test(e2e): timeline wheel zoom — zoom in shows mini-map + tlZoom, zoom out exits (Task 4)"
```

---

## Task 5: Documentation updates + final commit

**Files:**
- Modify: `ROADMAP.md`, `INVENTORY.md`, `tests/README.md`

- [ ] **Step 1: Update ROADMAP.md**

Run: `grep -n "^| 53 " ROADMAP.md` to find the current last "Déjà livré" row (Item #5 URL persistence). Add row #54 immediately after it:

```markdown
| 54 | **Timeline Wheel Zoom (mousewheel)** — Phase 2 Item #4 sur 5 (**dernier item Phase 2**). Zoom continu à la molette sur la Timeline, ancré sur la souris (le snapshot sous le curseur reste fixe, A/B convergent autour), auto enter/exit (scroll-in entre en zoom, scroll-out complet sort), continu avec snap aux snapshots au repos (debounce ~200ms). Couplé aux curseurs : la molette pilote `[cursorA,cursorB]` → persistance URL gratuite via `tlA/tlB/tlZoom` (Item #5). Pure fn `applyWheelZoom` + état transitoire local + commit-on-settle ; `enterZoom` accepte des bornes explicites (fix stale-closure). Bouton "Zoom to window" + `Z` conservés. Pure frontend, aucun endpoint. | `lib/timeline-zoom.ts::applyWheelZoom`, listener non-passif + `wheelWindow` dans `Timeline.tsx`, `enterZoom(a?,b?)` dans `useAppState` |
```

Update the date header line (near the top, the `Dernière mise à jour :` line):

```markdown
Dernière mise à jour : 2026-05-28 (Timeline Wheel Zoom Phase 2 Item #4 livré : zoom molette continu ancré souris + snap-on-settle, couplé curseurs → persistance URL gratuite. **Phase 2 complète : 5/5 items livrés** (Item #2 subsumed).).
```

- [ ] **Step 2: Update INVENTORY.md**

Run: `grep -n "Timeline zoom + 2 cursors A/B Phase 1" INVENTORY.md` to find the Timeline.tsx entry (around line 156). At the end of that bullet's text (after the Temporal Filter sentence), append:

```markdown
 **Timeline Wheel Zoom Phase 2 Item #4** (Tier 54) : zoom molette continu ancré souris, couplé aux curseurs. Listener `wheel` non-passif sur `timelineBarRef`, état transitoire `wheelWindow` (update rAF-throttlé) rendu via `effectiveWindow`, commit-on-settle debouncé (`WHEEL_ZOOM_SETTLE_MS`) qui snappe aux snapshots puis appelle `setCursorA/B` + `enterZoom(a,b)`/`exitZoom`. Pure fn `applyWheelZoom` dans `lib/timeline-zoom.ts`. Persistance URL gratuite (couplage curseurs → `tlA/tlB/tlZoom`).
```

- [ ] **Step 3: Update tests/README.md**

Run: `grep -n "timeline-zoom" tests/README.md` to find the unit + e2e rows. In the "Pure logic units" table, find the existing timeline-zoom row (e.g. `| Timeline zoom — pure fns | unit/timeline-zoom.test.mjs | ... |`) and update its description to mention the new fn, e.g. append `+ applyWheelZoom (anchor-preserving, clamp min/full, shift-to-fit)`. If no dedicated row exists, add one:

```markdown
| Timeline zoom — pure fns | `unit/timeline-zoom.test.mjs` | computeZoomWindow + map fns + snapToNearestSnapshot + applyWheelZoom (anchor-preserving, clamp min span / full range, shift-to-fit) |
```

In the E2E table, update the existing `timeline-zoom-and-diff.spec.ts` row description to add `+ mousewheel zoom in/out`. If you prefer a separate row, the spec file is the same one, so editing the existing row's description is correct.

- [ ] **Step 4: Final commit**

```
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add ROADMAP.md INVENTORY.md tests/README.md
git commit -m "Timeline Wheel Zoom Phase 2 Item #4 livré: ROADMAP #54/INVENTORY/tests (Task 5) — Phase 2 complete 5/5"
```

(No patch regen here — Task 5 touches only top-level tracked docs, not `upstream/`. The patch is already current from Task 3.)

---

## Self-Review

**Spec coverage** :
- ✅ Spec § 2 Goal (zoom molette continu ancré souris, auto enter/exit, snap-on-settle, pure frontend) → Tasks 1+2+3
- ✅ Spec § 3 décision "couplé curseurs" → Task 3 commit appelle setCursorA/B + enterZoom/exitZoom (pas de viewWindow séparé)
- ✅ Spec § 4.1 fichiers → tous couverts (timeline-zoom.ts T1, ui-constants T2, useAppState T2, Timeline.tsx T3)
- ✅ Spec § 4.1 bis `enterZoom` bornes explicites → Task 2 Steps 3-4
- ✅ Spec § 4.2 `applyWheelZoom` algo (exp scale, anchorRatio, clamp min/full, shift-to-fit) → Task 1 Step 3 + 6 unit cases
- ✅ Spec § 4.3 listener non-passif + fenêtre transitoire + rAF + settle debounce → Task 3 Steps 2-4
- ✅ Spec § 4.3 snap dégénéré (widen d'un voisin) → Task 3 Step 4 `commitSettle`
- ✅ Spec § 4.3 ctrl+wheel pinch → couvert : le même `onWheel` traite tous les events wheel (ctrlKey inclus, pas de branche spéciale nécessaire car deltaY porte le zoom)
- ✅ Spec § 4.4 edge cases (<2 snapshots no-op via guard `points.length<2` ; clamp min/full dans applyWheelZoom ; momentum via rAF+debounce ; preventDefault) → Tasks 1+3
- ✅ Spec § 5 testing (unit applyWheelZoom + e2e wheel) → Tasks 1+4 ; composant jsdom volontairement omis (justifié File Structure note)
- ✅ Spec § 6 persistance URL gratuite → vérifiée par l'assertion `tlZoom=1` dans l'E2E Task 4
- ✅ Spec § 10 doc updates → Task 5

**Placeholder scan** :
- ✅ Aucun "TBD"/"TODO"/"implement later".
- ⚠️ Task 3 Step 5 dit "Search for the two `cursorPosition(` call sites in the JSX and swap them" — acceptable : la structure JSX exacte des deux blocs slider ne peut pas être citée ligne-à-ligne sans fragilité, mais l'ancre (`role="slider"` blocks ~1102-1130, helper `cursorDisplayPosition`) et la règle de swap sont sans ambiguïté.
- ⚠️ Task 5 Steps 1-3 utilisent des `grep` pour localiser les lignes exactes (les sessions parallèles ajoutent des lignes) — intentionnel, commande fournie.

**Type consistency** :
- ✅ `applyWheelZoom(current, anchorISO, deltaY, fullRange, opts?)` retourne `DateRange` ({startISO, endISO}) — défini Task 1, appelé Task 3 avec la même forme.
- ✅ `wheelWindow` est `{startISO, endISO} | null` partout (state Task 3 Step 2, lu Steps 3-4).
- ✅ `effectiveWindow` a la forme `{a, b}` (comme `zoomWindow`) — cohérent avec le filtre `visiblePoints`.
- ✅ `enterZoom(aISO?, bISO?)` — signature étendue Task 2, appelée `enterZoom(ordered[0], ordered[1])` Task 3 ; les appels arg-less existants restent valides.
- ✅ `snapToNearestSnapshot(iso, points)` — `points` ont `.date`, structurellement compatibles avec `SnapshotWithDate`.
- ✅ `mapPositionToDate(x, {startISO,endISO}, width)` — signature existante respectée Task 3 Step 4.

**Scope check** : Feature unique (zoom molette), ~3-5j, 5 tâches. Une seule slice cohérente.

Plan prêt pour exécution.

---

## Effort summary

| Task | Estimate |
|---|---|
| 1. applyWheelZoom pure + 6 unit cases | ~½j |
| 2. constants + enterZoom bounds | ~¼j |
| 3. Timeline wheel listener + transient + settle | ~2j |
| 4. E2E spec | ~½j |
| 5. Docs + final | ~½j |
| **Total** | **~3-4 jours** |
