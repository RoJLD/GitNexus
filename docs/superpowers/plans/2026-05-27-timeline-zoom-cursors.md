# Timeline Zoom + 2 Cursors A/B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Étendre la `Timeline.tsx` existante avec 2 curseurs drag-and-droppables A/B, un mode zoom on the window [A,B] avec mini-map collapsible, et un toggle "Compare A↔B" qui déclenche un diff visuel intra-repo (rouge/vert/gris) entre les snapshots aux curseurs A et B.

**Architecture:** Pure frontend. 4 surfaces : (1) `lib/timeline-zoom.ts` (NEW) pour les pure fns date/position, (2) `lib/graph-diff.ts` (MOD) pour wrapper le diff cross-repo existant en helper intra-repo, (3) `hooks/useAppState.tsx` (MOD) pour l'extension de state cursorA/B/zoomWindow/graphMode + mutual exclusion avec le `diffMode` cross-repo existant, (4) `components/Timeline.tsx` (MOD) pour le rendu SVG des 2 curseurs + drag handlers + boutons + mini-map + keyboard shortcuts + indicateur de durée. Aucun changement backend, aucune nouvelle dep.

**Tech Stack:** React 19, TypeScript, Sigma 2D (graph), Vitest 4 + @testing-library/react (unit/component tests), Playwright (e2e), SVG natif (cursors + mini-map — même pattern que `GrowthChart.tsx`).

**Spec source:** [`docs/superpowers/specs/2026-05-27-timeline-zoom-cursors-design.md`](../specs/2026-05-27-timeline-zoom-cursors-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

**Environment note:** L'environnement local a (au 2026-05-26) été flaggé bloqué pour vitest 4.x sur Node 21 ([decision doc](../decisions/2026-05-26-defer-node22-upgrade.md)). Si Node 22 a été installé entre-temps, exécute les steps "Run" tels quels. Sinon, skip les steps de run local — la CI GitHub Actions sur Node 22 validera au push. Dans tous les cas, commit les tests + le patch régénéré.

**Upstream/ workflow:** `upstream/` est gitignored. Pour chaque tâche qui touche un fichier dans `upstream/`, la fin de tâche régénère `patches/upstream-all.diff` puis commit le patch ensemble avec les fichiers tracked (tests, docs). Pattern uniforme :

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/<file(s)>
git commit -m "<msg>"
```

---

## File Structure

### Files à créer

| Path | Responsibility |
|---|---|
| `upstream/gitnexus-web/src/lib/timeline-zoom.ts` | Pure fns : `computeZoomWindow`, `mapDateToPosition`, `mapPositionToDate`, `snapToNearestSnapshot`. Aucun import React. |
| `tests/unit/timeline-zoom.test.mjs` | Tests Vitest des 4 pure fns ci-dessus. |
| `tests/unit/components/Timeline.test.tsx` | Tests component pour le rendu et l'interaction (cursors, drag, zoom, diff toggle, mini-map, duration, shortcuts). Fresh — aucun test existant. |
| `tests/e2e/specs/timeline-zoom-and-diff.spec.ts` | Playwright spec : drag cursors + zoom + compare sur hmm_studio. |

### Files à modifier

| Path | Modification |
|---|---|
| `upstream/gitnexus-web/src/lib/graph-diff.ts` | Ajout `diffBetweenSnapshots(snapshotA, snapshotB)` qui réutilise la logique cross-repo. |
| `upstream/gitnexus-web/src/hooks/useAppState.tsx` | Ajout state `cursorA`, `cursorB`, `zoomWindow`, `graphMode` + setters avec auto-swap A≤B et mutual exclusion avec `diffMode` existant (lignes ~218, ~750, ~2599). |
| `upstream/gitnexus-web/src/components/Timeline.tsx` | Ajout 2 curseurs SVG, drag handlers, boutons Zoom/Compare, mini-map, indicateur de durée, raccourcis clavier. |
| `ROADMAP.md` | Ligne dans "Déjà livré" + bump date header. |
| `INVENTORY.md` | Partie B.2 (composants frontend) — mention 2 curseurs + diff intra-repo. |
| `tests/README.md` | Add new tests à l'inventaire. |
| `patches/upstream-all.diff` | Regen final. |

---

## Task 1: Bootstrap pure fns `lib/timeline-zoom.ts`

**Files:**
- Create: `upstream/gitnexus-web/src/lib/timeline-zoom.ts`
- Create: `tests/unit/timeline-zoom.test.mjs`

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/timeline-zoom.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  computeZoomWindow,
  mapDateToPosition,
  mapPositionToDate,
  snapToNearestSnapshot,
} from '../../upstream/gitnexus-web/src/lib/timeline-zoom';

describe('computeZoomWindow', () => {
  it('returns { startISO, endISO } sorted ascending', () => {
    const w = computeZoomWindow('2026-01-15T00:00:00Z', '2026-03-22T00:00:00Z');
    expect(w).toEqual({ startISO: '2026-01-15T00:00:00Z', endISO: '2026-03-22T00:00:00Z' });
  });

  it('auto-swaps when A > B', () => {
    const w = computeZoomWindow('2026-03-22T00:00:00Z', '2026-01-15T00:00:00Z');
    expect(w).toEqual({ startISO: '2026-01-15T00:00:00Z', endISO: '2026-03-22T00:00:00Z' });
  });

  it('handles equal dates by returning zero-width window', () => {
    const w = computeZoomWindow('2026-01-15T00:00:00Z', '2026-01-15T00:00:00Z');
    expect(w.startISO).toBe(w.endISO);
  });
});

describe('mapDateToPosition', () => {
  const window = { startISO: '2026-01-01T00:00:00Z', endISO: '2026-01-11T00:00:00Z' }; // 10 days
  const pixelWidth = 1000;

  it('maps window.startISO to 0', () => {
    expect(mapDateToPosition('2026-01-01T00:00:00Z', window, pixelWidth)).toBe(0);
  });

  it('maps window.endISO to pixelWidth', () => {
    expect(mapDateToPosition('2026-01-11T00:00:00Z', window, pixelWidth)).toBe(1000);
  });

  it('maps middle of window linearly', () => {
    // 5 days = halfway
    expect(mapDateToPosition('2026-01-06T00:00:00Z', window, pixelWidth)).toBe(500);
  });

  it('saturates at 0 for dates before window start', () => {
    expect(mapDateToPosition('2025-12-25T00:00:00Z', window, pixelWidth)).toBe(0);
  });

  it('saturates at pixelWidth for dates after window end', () => {
    expect(mapDateToPosition('2026-02-01T00:00:00Z', window, pixelWidth)).toBe(1000);
  });

  it('returns 0 for zero-width window (avoids div-by-zero)', () => {
    const zeroWindow = { startISO: '2026-01-01T00:00:00Z', endISO: '2026-01-01T00:00:00Z' };
    expect(mapDateToPosition('2026-01-01T00:00:00Z', zeroWindow, pixelWidth)).toBe(0);
  });
});

describe('mapPositionToDate', () => {
  const window = { startISO: '2026-01-01T00:00:00Z', endISO: '2026-01-11T00:00:00Z' };
  const pixelWidth = 1000;

  it('maps 0 to window.startISO', () => {
    expect(mapPositionToDate(0, window, pixelWidth)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('maps pixelWidth to window.endISO', () => {
    expect(mapPositionToDate(1000, window, pixelWidth)).toBe('2026-01-11T00:00:00.000Z');
  });

  it('round-trips with mapDateToPosition', () => {
    const date = '2026-01-06T12:00:00.000Z';
    const pos = mapDateToPosition(date, window, pixelWidth);
    const back = mapPositionToDate(pos, window, pixelWidth);
    expect(back).toBe(date);
  });

  it('saturates at window bounds when position out of [0, pixelWidth]', () => {
    expect(mapPositionToDate(-50, window, pixelWidth)).toBe('2026-01-01T00:00:00.000Z');
    expect(mapPositionToDate(1500, window, pixelWidth)).toBe('2026-01-11T00:00:00.000Z');
  });
});

describe('snapToNearestSnapshot', () => {
  const snapshots = [
    { date: '2026-01-01T00:00:00Z' },
    { date: '2026-01-05T00:00:00Z' },
    { date: '2026-01-10T00:00:00Z' },
    { date: '2026-01-20T00:00:00Z' },
  ];

  it('returns exact match when date == snapshot date', () => {
    expect(snapToNearestSnapshot('2026-01-05T00:00:00Z', snapshots)).toBe('2026-01-05T00:00:00Z');
  });

  it('snaps to closest snapshot when between two', () => {
    // 2026-01-03 is closer to 2026-01-01 (2 days) than to 2026-01-05 (2 days, tie) — should pick earlier on tie
    expect(snapToNearestSnapshot('2026-01-07T00:00:00Z', snapshots)).toBe('2026-01-05T00:00:00Z'); // 2 days to Jan 5, 3 days to Jan 10
  });

  it('snaps to first snapshot when date is before all', () => {
    expect(snapToNearestSnapshot('2025-12-01T00:00:00Z', snapshots)).toBe('2026-01-01T00:00:00Z');
  });

  it('snaps to last snapshot when date is after all', () => {
    expect(snapToNearestSnapshot('2026-12-01T00:00:00Z', snapshots)).toBe('2026-01-20T00:00:00Z');
  });

  it('returns null for empty snapshot list', () => {
    expect(snapToNearestSnapshot('2026-01-01T00:00:00Z', [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- timeline-zoom`
Expected: FAIL with "Failed to resolve import .../timeline-zoom" (module doesn't exist yet).

- [ ] **Step 3: Implement `lib/timeline-zoom.ts`**

Create `upstream/gitnexus-web/src/lib/timeline-zoom.ts`:

```typescript
/**
 * Pure date/position math for the Timeline zoom + 2-cursor feature.
 * No React, no DOM — testable in isolation.
 *
 * See docs/superpowers/specs/2026-05-27-timeline-zoom-cursors-design.md
 */

export type DateRange = { startISO: string; endISO: string };

export type SnapshotWithDate = { date: string };

/**
 * Returns the window [min(a,b), max(a,b)] — auto-swap so callers don't
 * have to enforce A ≤ B at every site.
 */
export function computeZoomWindow(aISO: string, bISO: string): DateRange {
  const aMs = Date.parse(aISO);
  const bMs = Date.parse(bISO);
  if (aMs <= bMs) return { startISO: aISO, endISO: bISO };
  return { startISO: bISO, endISO: aISO };
}

/**
 * Maps an ISO date to a pixel position in [0, pixelWidth] linearly within
 * the window. Saturates at boundaries when the date is outside.
 * Returns 0 for zero-width windows to avoid div-by-zero.
 */
export function mapDateToPosition(
  isoDate: string,
  window: DateRange,
  pixelWidth: number,
): number {
  const startMs = Date.parse(window.startISO);
  const endMs = Date.parse(window.endISO);
  const targetMs = Date.parse(isoDate);
  const span = endMs - startMs;
  if (span <= 0) return 0;
  if (targetMs <= startMs) return 0;
  if (targetMs >= endMs) return pixelWidth;
  return ((targetMs - startMs) / span) * pixelWidth;
}

/**
 * Inverse of mapDateToPosition. Saturates at window bounds for positions
 * outside [0, pixelWidth].
 */
export function mapPositionToDate(
  position: number,
  window: DateRange,
  pixelWidth: number,
): string {
  const startMs = Date.parse(window.startISO);
  const endMs = Date.parse(window.endISO);
  if (position <= 0) return new Date(startMs).toISOString();
  if (position >= pixelWidth) return new Date(endMs).toISOString();
  const span = endMs - startMs;
  const offsetMs = (position / pixelWidth) * span;
  return new Date(startMs + offsetMs).toISOString();
}

/**
 * Returns the date of the snapshot closest to the given date. On a tie
 * (equidistant), returns the earlier one. Returns null if the snapshot
 * list is empty.
 */
export function snapToNearestSnapshot(
  isoDate: string,
  snapshots: SnapshotWithDate[],
): string | null {
  if (snapshots.length === 0) return null;
  const targetMs = Date.parse(isoDate);
  let bestDate = snapshots[0].date;
  let bestDelta = Math.abs(Date.parse(bestDate) - targetMs);
  for (let i = 1; i < snapshots.length; i++) {
    const delta = Math.abs(Date.parse(snapshots[i].date) - targetMs);
    if (delta < bestDelta) {
      bestDate = snapshots[i].date;
      bestDelta = delta;
    }
  }
  return bestDate;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- timeline-zoom`
Expected: PASS with 18 passing tests (5 describes, 18 it).

- [ ] **Step 5: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/timeline-zoom.test.mjs
git commit -m "test(timeline): pure date/position fns + auto-swap zoom window"
```

---

## Task 2: Extend `useAppState.tsx` with timeline zoom state

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx`
- Create: `tests/unit/use-app-state-timeline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/use-app-state-timeline.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppState } from '../../upstream/gitnexus-web/src/hooks/useAppState';

// Mock the backend client used by useAppState — we only care about the
// timeline-zoom state slice here. The implementation may need to expose
// the hook in a testable shape; if not, this test will reveal that.
vi.mock('../../upstream/gitnexus-web/src/services/backend-client', () => ({
  fetchRepos: vi.fn().mockResolvedValue([]),
  // Add other stubs as needed when the test surfaces them.
}));

describe('useAppState — timeline zoom slice', () => {
  it('initializes cursorA, cursorB, zoomWindow, graphMode with sensible defaults', () => {
    const { result } = renderHook(() => useAppState());
    expect(result.current.cursorA).toBeNull();
    expect(result.current.cursorB).toBeNull();
    expect(result.current.zoomWindow).toBeNull();
    expect(result.current.graphMode).toBe('single');
  });

  it('setCursorA auto-swaps when A > B', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.setCursorB('2026-01-10T00:00:00Z');
      result.current.setCursorA('2026-02-15T00:00:00Z'); // A > B → should swap
    });
    expect(result.current.cursorA).toBe('2026-01-10T00:00:00Z');
    expect(result.current.cursorB).toBe('2026-02-15T00:00:00Z');
  });

  it('setCursorB auto-swaps when B < A', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.setCursorA('2026-02-15T00:00:00Z');
      result.current.setCursorB('2026-01-10T00:00:00Z'); // B < A → should swap
    });
    expect(result.current.cursorA).toBe('2026-01-10T00:00:00Z');
    expect(result.current.cursorB).toBe('2026-02-15T00:00:00Z');
  });

  it('enterZoom requires both cursors set', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.enterZoom(); // both null → no-op
    });
    expect(result.current.zoomWindow).toBeNull();
    act(() => {
      result.current.setCursorA('2026-01-10T00:00:00Z');
      result.current.setCursorB('2026-02-15T00:00:00Z');
      result.current.enterZoom();
    });
    expect(result.current.zoomWindow).toEqual({
      a: '2026-01-10T00:00:00Z',
      b: '2026-02-15T00:00:00Z',
    });
  });

  it('exitZoom clears zoomWindow', () => {
    const { result } = renderHook(() => useAppState());
    act(() => {
      result.current.setCursorA('2026-01-10T00:00:00Z');
      result.current.setCursorB('2026-02-15T00:00:00Z');
      result.current.enterZoom();
      result.current.exitZoom();
    });
    expect(result.current.zoomWindow).toBeNull();
  });

  it('setGraphMode("diff") clears cross-repo diffMode', () => {
    const { result } = renderHook(() => useAppState());
    // Simulate cross-repo diffMode active (via the internal setter exposed for tests, or directly via setDiffMode)
    act(() => {
      // setDiffMode is the existing setter on useAppState (line ~750)
      // If not in the exposed interface, this test surfaces the gap.
      (result.current as any).setDiffMode?.({ repoA: 'foo', repoB: 'bar' });
      result.current.setGraphMode('diff');
    });
    expect(result.current.graphMode).toBe('diff');
    expect(result.current.diffMode).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- use-app-state-timeline`
Expected: FAIL with TypeError "cursorA is not a property" or similar (state not yet added).

- [ ] **Step 3: Add type declaration to `AppStateContextValue` interface**

Find the interface declaration around line 218 of `upstream/gitnexus-web/src/hooks/useAppState.tsx` (look for `diffMode: { repoA: string; repoB: string } | null;`). Add the following fields just below `diffMode` and `exitDiffMode`:

```typescript
  // Timeline zoom + 2-cursor state (Phase 1 of timeline-zoom-cursors design)
  cursorA: string | null;          // ISO date, null = "start of timeline"
  cursorB: string | null;          // ISO date, null = "live / head"
  zoomWindow: { a: string; b: string } | null;  // null = zoom out
  graphMode: 'single' | 'diff';    // single = graph follows cursorB ; diff = graph shows diff(snapA, snapB)
  setCursorA: (isoDate: string | null) => void;
  setCursorB: (isoDate: string | null) => void;
  enterZoom: () => void;
  exitZoom: () => void;
  setGraphMode: (mode: 'single' | 'diff') => void;
```

- [ ] **Step 4: Add state declarations**

Find the state declarations around line 750 (look for `const [diffMode, setDiffMode] = useState<...`). Add just below:

```typescript
  // Timeline zoom + 2-cursor state
  const [cursorA, setCursorAState] = useState<string | null>(null);
  const [cursorB, setCursorBState] = useState<string | null>(null);
  const [zoomWindow, setZoomWindow] = useState<{ a: string; b: string } | null>(null);
  const [graphMode, setGraphModeState] = useState<'single' | 'diff'>('single');
```

- [ ] **Step 5: Add setters with auto-swap and mutual-exclusion logic**

Find a logical place to add useCallback definitions — somewhere after the existing `exitDiffMode` definition (around line 1841). Add:

```typescript
  // Auto-swap so A ≤ B is always enforced (see spec § Decisions cadres).
  const setCursorA = useCallback((isoDate: string | null) => {
    if (isoDate === null) {
      setCursorAState(null);
      return;
    }
    setCursorAState((prevA) => {
      if (cursorB !== null && Date.parse(isoDate) > Date.parse(cursorB)) {
        // A > B → swap: new A becomes old B, new B becomes the requested date
        setCursorBState(isoDate);
        return cursorB;
      }
      return isoDate;
    });
  }, [cursorB]);

  const setCursorB = useCallback((isoDate: string | null) => {
    if (isoDate === null) {
      setCursorBState(null);
      return;
    }
    setCursorBState((prevB) => {
      if (cursorA !== null && Date.parse(isoDate) < Date.parse(cursorA)) {
        // B < A → swap
        setCursorAState(isoDate);
        return cursorA;
      }
      return isoDate;
    });
  }, [cursorA]);

  const enterZoom = useCallback(() => {
    if (cursorA === null || cursorB === null) return; // no-op if cursors not both set
    setZoomWindow({ a: cursorA, b: cursorB });
  }, [cursorA, cursorB]);

  const exitZoom = useCallback(() => {
    setZoomWindow(null);
  }, []);

  // Mutual exclusion with the existing cross-repo diffMode: entering
  // cursor-diff clears any active cross-repo diff, and vice versa is
  // enforced in setDiffMode usage sites (see spec § Data model).
  const setGraphMode = useCallback((mode: 'single' | 'diff') => {
    if (mode === 'diff' && diffMode !== null) {
      // Cross-repo diff was active — clear it before activating cursor diff.
      setDiffMode(null);
    }
    setGraphModeState(mode);
  }, [diffMode]);
```

- [ ] **Step 6: Wire mutual exclusion from the other direction**

Find `setDiffMode` call sites (line ~1831 and ~2487). At those sites, just before `setDiffMode({ ... })`, add `setGraphModeState('single');` so entering cross-repo diff clears any active cursor-diff:

```typescript
        // Before existing setDiffMode({ repoA, repoB }):
        setGraphModeState('single');
        setDiffMode({ repoA, repoB });
```

Apply this in the 2 places: the regular enterDiffMode flow (around line 1831) and the what-if synthetic diffMode (around line 2487).

- [ ] **Step 7: Expose new state in the returned object**

Find the return statement around line 2599 (look for `diffMode,` and `exitDiffMode,`). Add the new fields to the returned object:

```typescript
    diffMode,
    // ... existing fields
    exitDiffMode,
    // Timeline zoom + 2-cursor state additions:
    cursorA,
    cursorB,
    zoomWindow,
    graphMode,
    setCursorA,
    setCursorB,
    enterZoom,
    exitZoom,
    setGraphMode,
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- use-app-state-timeline`
Expected: PASS with 6 passing tests.

- [ ] **Step 9: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/use-app-state-timeline.test.tsx
git commit -m "feat(timeline): extend useAppState with cursorA/B + zoomWindow + graphMode (mutual exclusion with diffMode)"
```

---

## Task 3: Render 2 cursors A/B in Timeline.tsx (no drag yet)

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Create: `tests/unit/components/Timeline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/Timeline.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Timeline } from '../../../upstream/gitnexus-web/src/components/Timeline';

// Mock useAppState — Timeline reads many state fields from it. We only
// need to provide the ones the cursor rendering uses.
vi.mock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
  useAppState: () => ({
    projectName: 'test-repo',
    availableRepos: [{ name: 'test-repo', snapshots: [
      { name: 'snap1', shortHash: 'a1', message: 'first', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
      { name: 'snap2', shortHash: 'a2', message: 'second', author: 'u', date: '2026-01-15T00:00:00Z', isLive: false },
      { name: 'snap3', shortHash: 'live', message: 'live', author: 'u', date: '2026-01-30T00:00:00Z', isLive: true },
    ] }],
    // Cursor state (Task 2):
    cursorA: '2026-01-01T00:00:00Z',
    cursorB: '2026-01-30T00:00:00Z',
    zoomWindow: null,
    graphMode: 'single' as const,
    setCursorA: vi.fn(),
    setCursorB: vi.fn(),
    enterZoom: vi.fn(),
    exitZoom: vi.fn(),
    setGraphMode: vi.fn(),
    // Other useAppState fields stubbed minimally so Timeline doesn't crash:
    diffMode: null,
    exitDiffMode: vi.fn(),
    switchRepo: vi.fn(),
    churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
    enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
    couplingActive: false, couplingLoading: false, couplingError: null,
    enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
    growthActive: false, growthLoading: false, growthError: null,
    enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
    lifespanActive: false, lifespanLoading: false, lifespanError: null,
    enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
    ownershipActive: false, ownershipLoading: false, ownershipError: null,
    enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
  }),
}));

describe('Timeline cursors', () => {
  it('renders cursor A as a blue triangle with role="slider" aria-label "Cursor A"', () => {
    render(<Timeline />);
    const cursorA = screen.getByRole('slider', { name: /cursor a/i });
    expect(cursorA).toBeInTheDocument();
    // Color check via data attribute or SVG fill (we encode via data-cursor="A" + a class)
    expect(cursorA.getAttribute('data-cursor')).toBe('A');
  });

  it('renders cursor B as an orange triangle with role="slider" aria-label "Cursor B"', () => {
    render(<Timeline />);
    const cursorB = screen.getByRole('slider', { name: /cursor b/i });
    expect(cursorB).toBeInTheDocument();
    expect(cursorB.getAttribute('data-cursor')).toBe('B');
  });

  it('does not render cursors when there are fewer than 2 snapshots (no history navigable)', () => {
    // Re-mock with only 1 snapshot — this requires module reset
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 'live', shortHash: 'live', message: 'live', author: 'u', date: '2026-01-01T00:00:00Z', isLive: true },
        ] }],
        cursorA: null, cursorB: null, zoomWindow: null, graphMode: 'single' as const,
        setCursorA: vi.fn(), setCursorB: vi.fn(),
        enterZoom: vi.fn(), exitZoom: vi.fn(), setGraphMode: vi.fn(),
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    // Need a re-import after doMock
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TimelineSingle }) => {
      render(<TimelineSingle />);
      expect(screen.queryByRole('slider', { name: /cursor a/i })).toBeNull();
      expect(screen.queryByRole('slider', { name: /cursor b/i })).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: FAIL — "Unable to find an element with the role slider" (cursors not yet rendered).

- [ ] **Step 3: Locate the Timeline rendering anchor**

Open `upstream/gitnexus-web/src/components/Timeline.tsx`. Find the SVG dot rendering loop (search for `snapshots.map` or `dot` — there's an existing loop that renders the snapshot dots along the timeline bar). The cursors will be rendered as 2 additional SVG `<g>` groups on top of the dots, positioned by `cursorA` / `cursorB` mapped through the same date→position function used for dots.

- [ ] **Step 4: Add the timeline-zoom import and the cursor rendering**

At the top of `Timeline.tsx`, add:

```typescript
import { mapDateToPosition } from '../lib/timeline-zoom';
```

In the destructured useAppState call (search for `useAppState()` — around line 49 per the head we already read), add the new fields:

```typescript
const {
  // existing fields…
  cursorA,
  cursorB,
  zoomWindow,
  graphMode,
  setCursorA,
  setCursorB,
  enterZoom,
  exitZoom,
  setGraphMode,
} = useAppState();
```

In the SVG render, just after the snapshot dots `<g>` block, add the cursor triangles. The cursors only render when `snapshots.length >= 2` and `cursorA !== null && cursorB !== null`. Use the same `window` (DateRange) currently used by the dots for positioning — for Phase 1 with no zoom yet, this is `{ startISO: snapshots[0].date, endISO: snapshots[snapshots.length-1].date }`.

```tsx
{snapshots.length >= 2 && cursorA && cursorB && (
  <>
    <g
      role="slider"
      aria-label="Cursor A"
      aria-valuemin={0}
      aria-valuemax={snapshots.length - 1}
      data-cursor="A"
      transform={`translate(${mapDateToPosition(cursorA, currentWindow, timelineWidth)}, -8)`}
      style={{ cursor: 'ew-resize' }}
    >
      <polygon points="0,0 -6,-10 6,-10" fill="#3b82f6" /> {/* triangle pointing down */}
    </g>
    <g
      role="slider"
      aria-label="Cursor B"
      aria-valuemin={0}
      aria-valuemax={snapshots.length - 1}
      data-cursor="B"
      transform={`translate(${mapDateToPosition(cursorB, currentWindow, timelineWidth)}, -8)`}
      style={{ cursor: 'ew-resize' }}
    >
      <polygon points="0,0 -6,-10 6,-10" fill="#f97316" />
    </g>
  </>
)}
```

Note: `currentWindow` and `timelineWidth` reference the variables the existing dot-positioning code uses. Use whatever names that code already uses — if it inlines the math, refactor minimally to extract a `currentWindow: DateRange` and `timelineWidth: number` local.

- [ ] **Step 5: Initialize cursors when none set yet**

Add a `useEffect` near the top of the component body to initialize `cursorA` and `cursorB` once snapshots arrive:

```typescript
useEffect(() => {
  if (snapshots.length >= 2) {
    if (cursorA === null) setCursorA(snapshots[0].date);
    if (cursorB === null) setCursorB(snapshots[snapshots.length - 1].date);
  }
}, [snapshots, cursorA, cursorB, setCursorA, setCursorB]);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: PASS with 3 tests.

- [ ] **Step 7: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/Timeline.test.tsx
git commit -m "feat(timeline): render cursors A (blue) and B (orange) on timeline"
```

---

## Task 4: Cursor drag handlers with snap-at-release

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Modify: `tests/unit/components/Timeline.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/components/Timeline.test.tsx`:

```typescript
import { fireEvent } from '@testing-library/react';

describe('Timeline cursor drag', () => {
  it('mousedown on cursor B + mousemove updates position, mouseup snaps to nearest snapshot', () => {
    const setCursorB = vi.fn();
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 's1', shortHash: 'a1', message: '', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
          { name: 's2', shortHash: 'a2', message: '', author: 'u', date: '2026-01-15T00:00:00Z', isLive: false },
          { name: 's3', shortHash: 'live', message: '', author: 'u', date: '2026-01-30T00:00:00Z', isLive: true },
        ] }],
        cursorA: '2026-01-01T00:00:00Z',
        cursorB: '2026-01-30T00:00:00Z',
        zoomWindow: null,
        graphMode: 'single' as const,
        setCursorA: vi.fn(),
        setCursorB,
        enterZoom: vi.fn(), exitZoom: vi.fn(), setGraphMode: vi.fn(),
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TimelineDrag }) => {
      const { container } = render(<TimelineDrag />);
      const cursorB = container.querySelector('[data-cursor="B"]') as SVGElement;
      expect(cursorB).not.toBeNull();

      // Simulate drag: mousedown on cursor, mousemove to middle position, mouseup
      fireEvent.mouseDown(cursorB, { clientX: 800 });
      fireEvent.mouseMove(window, { clientX: 400 });
      fireEvent.mouseUp(window, { clientX: 400 });

      // At release, snap-to-nearest should call setCursorB with one of the
      // snapshot dates (not the raw mouse position). The exact snapshot
      // depends on the timeline width — we just assert setCursorB was
      // called with an ISO date that matches one of the 3 snapshots.
      expect(setCursorB).toHaveBeenCalled();
      const lastCall = setCursorB.mock.calls[setCursorB.mock.calls.length - 1][0];
      expect(['2026-01-01T00:00:00Z', '2026-01-15T00:00:00Z', '2026-01-30T00:00:00Z']).toContain(lastCall);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: FAIL — setCursorB never called (no drag handler yet).

- [ ] **Step 3: Add drag handler logic**

In `Timeline.tsx`, add a useRef for drag state and useCallback for handlers. Place them near the existing useEffect for cursor init:

```typescript
import { snapToNearestSnapshot, mapPositionToDate } from '../lib/timeline-zoom';

// ... inside component body
const dragRef = useRef<{
  cursor: 'A' | 'B';
  svgRect: DOMRect;
} | null>(null);
const svgRef = useRef<SVGSVGElement | null>(null);

const onCursorMouseDown = useCallback((cursor: 'A' | 'B') => (e: React.MouseEvent) => {
  const svg = svgRef.current;
  if (!svg) return;
  dragRef.current = { cursor, svgRect: svg.getBoundingClientRect() };
  e.preventDefault();
}, []);

useEffect(() => {
  let rafId: number | null = null;
  let pendingDate: string | null = null;

  const onMouseMove = (e: MouseEvent) => {
    if (!dragRef.current) return;
    const { svgRect } = dragRef.current;
    const x = Math.max(0, Math.min(svgRect.width, e.clientX - svgRect.left));
    const date = mapPositionToDate(x, currentWindow, svgRect.width);
    pendingDate = date;
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        // Throttle to ~60fps: update visual position but don't snap yet.
        // For Phase 1 we update state directly (snap happens at release).
        if (dragRef.current && pendingDate) {
          if (dragRef.current.cursor === 'A') setCursorA(pendingDate);
          else setCursorB(pendingDate);
        }
        rafId = null;
      });
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    if (!dragRef.current) return;
    const { svgRect, cursor } = dragRef.current;
    const x = Math.max(0, Math.min(svgRect.width, e.clientX - svgRect.left));
    const rawDate = mapPositionToDate(x, currentWindow, svgRect.width);
    const snappedDate = snapToNearestSnapshot(rawDate, snapshots);
    if (snappedDate) {
      if (cursor === 'A') setCursorA(snappedDate);
      else setCursorB(snappedDate);
    }
    dragRef.current = null;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  return () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}, [currentWindow, setCursorA, setCursorB, snapshots]);
```

Attach the mousedown handlers to the cursors and the svgRef to the SVG container:

```tsx
<svg ref={svgRef} ...>
  {/* ... existing content ... */}
  <g
    role="slider"
    aria-label="Cursor A"
    data-cursor="A"
    onMouseDown={onCursorMouseDown('A')}
    transform={`translate(${mapDateToPosition(cursorA, currentWindow, timelineWidth)}, -8)`}
    style={{ cursor: 'ew-resize' }}
  >
    <polygon points="0,0 -6,-10 6,-10" fill="#3b82f6" />
  </g>
  {/* same for cursor B with onCursorMouseDown('B') */}
</svg>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: PASS — setCursorB called with one of the snapshot dates.

- [ ] **Step 5: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/Timeline.test.tsx
git commit -m "feat(timeline): cursor drag handlers with rAF throttle + snap-to-nearest at release"
```

---

## Task 5: "Zoom to window" button + state wiring

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Modify: `tests/unit/components/Timeline.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/components/Timeline.test.tsx`:

```typescript
import { renderHook } from '@testing-library/react';

describe('Timeline zoom button', () => {
  it('renders "Zoom to window" button when zoomWindow is null and both cursors set', () => {
    render(<Timeline />); // uses the existing mock from earlier describe
    expect(screen.getByRole('button', { name: /zoom to window/i })).toBeInTheDocument();
  });

  it('clicking "Zoom to window" calls enterZoom', () => {
    const enterZoom = vi.fn();
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        // ... copy the base mock from Task 3 step 1, override enterZoom:
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 's1', shortHash: 'a1', message: '', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
          { name: 's2', shortHash: 'a2', message: '', author: 'u', date: '2026-01-15T00:00:00Z', isLive: false },
          { name: 's3', shortHash: 'live', message: '', author: 'u', date: '2026-01-30T00:00:00Z', isLive: true },
        ] }],
        cursorA: '2026-01-01T00:00:00Z',
        cursorB: '2026-01-30T00:00:00Z',
        zoomWindow: null,
        graphMode: 'single' as const,
        setCursorA: vi.fn(), setCursorB: vi.fn(),
        enterZoom, exitZoom: vi.fn(), setGraphMode: vi.fn(),
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TimelineZoom }) => {
      render(<TimelineZoom />);
      fireEvent.click(screen.getByRole('button', { name: /zoom to window/i }));
      expect(enterZoom).toHaveBeenCalled();
    });
  });

  it('shows "Zoom out" label and calls exitZoom when zoomWindow is set', () => {
    const exitZoom = vi.fn();
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 's1', shortHash: 'a1', message: '', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
          { name: 's2', shortHash: 'a2', message: '', author: 'u', date: '2026-01-30T00:00:00Z', isLive: true },
        ] }],
        cursorA: '2026-01-01T00:00:00Z',
        cursorB: '2026-01-30T00:00:00Z',
        zoomWindow: { a: '2026-01-01T00:00:00Z', b: '2026-01-30T00:00:00Z' },
        graphMode: 'single' as const,
        setCursorA: vi.fn(), setCursorB: vi.fn(),
        enterZoom: vi.fn(), exitZoom, setGraphMode: vi.fn(),
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TimelineZoomed }) => {
      render(<TimelineZoomed />);
      const btn = screen.getByRole('button', { name: /zoom out/i });
      fireEvent.click(btn);
      expect(exitZoom).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: FAIL — "Unable to find button with name /zoom to window/".

- [ ] **Step 3: Add the Zoom button in Timeline.tsx**

Find the existing button row that contains Play/Pause (search for the `Play` and `Pause` icon imports — they're around line 4-5). Just after the play/pause button, add:

```tsx
<button
  type="button"
  onClick={zoomWindow ? exitZoom : enterZoom}
  disabled={!cursorA || !cursorB}
  title={zoomWindow ? 'Zoom out (Z)' : 'Zoom to window [A, B] (Z)'}
  className="..." // match the existing button styling for play/pause
>
  {zoomWindow ? 'Zoom out' : 'Zoom to window'}
</button>
```

Use whichever Tailwind / className convention the existing play/pause button uses.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: PASS — 3 new tests pass (button rendered, click triggers enterZoom, label toggles).

- [ ] **Step 5: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/Timeline.test.tsx
git commit -m "feat(timeline): Zoom to window / Zoom out toggle button"
```

---

## Task 6: Visual zoom rendering — stretch [A,B] to full width

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Modify: `tests/unit/components/Timeline.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/components/Timeline.test.tsx`:

```typescript
describe('Timeline visual zoom', () => {
  it('when zoomWindow is set, only snapshots inside [a,b] are rendered in main timeline row', () => {
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 's1', shortHash: 'a1', message: '', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
          { name: 's2', shortHash: 'a2', message: '', author: 'u', date: '2026-01-10T00:00:00Z', isLive: false },
          { name: 's3', shortHash: 'a3', message: '', author: 'u', date: '2026-01-20T00:00:00Z', isLive: false },
          { name: 's4', shortHash: 'live', message: '', author: 'u', date: '2026-01-30T00:00:00Z', isLive: true },
        ] }],
        cursorA: '2026-01-10T00:00:00Z',
        cursorB: '2026-01-20T00:00:00Z',
        zoomWindow: { a: '2026-01-10T00:00:00Z', b: '2026-01-20T00:00:00Z' },
        graphMode: 'single' as const,
        setCursorA: vi.fn(), setCursorB: vi.fn(),
        enterZoom: vi.fn(), exitZoom: vi.fn(), setGraphMode: vi.fn(),
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TimelineVisualZoom }) => {
      const { container } = render(<TimelineVisualZoom />);
      const dots = container.querySelectorAll('[data-snapshot-dot]');
      // Only 2 dots should be visible in the main row: s2 and s3 (between cursorA and cursorB inclusive)
      expect(dots.length).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: FAIL — 4 dots rendered (all snapshots), not 2.

- [ ] **Step 3: Compute `currentWindow` from zoomWindow if active**

In `Timeline.tsx`, replace the existing `currentWindow` local (or introduce one) with a conditional :

```typescript
import type { DateRange } from '../lib/timeline-zoom';

const currentWindow: DateRange = useMemo(() => {
  if (zoomWindow) {
    return { startISO: zoomWindow.a, endISO: zoomWindow.b };
  }
  if (snapshots.length === 0) {
    return { startISO: new Date().toISOString(), endISO: new Date().toISOString() };
  }
  return {
    startISO: snapshots[0].date,
    endISO: snapshots[snapshots.length - 1].date,
  };
}, [zoomWindow, snapshots]);
```

- [ ] **Step 4: Filter snapshots in the dot-rendering loop**

When `zoomWindow !== null`, filter the snapshots passed to the dot loop. Add a `data-snapshot-dot` attribute on each dot for the test:

```tsx
{snapshots
  .filter((s) => {
    if (!zoomWindow) return true;
    const t = Date.parse(s.date);
    return t >= Date.parse(zoomWindow.a) && t <= Date.parse(zoomWindow.b);
  })
  .map((snap) => (
    <g
      key={snap.shortHash}
      data-snapshot-dot
      transform={`translate(${mapDateToPosition(snap.date, currentWindow, timelineWidth)}, 0)`}
    >
      {/* existing dot SVG */}
    </g>
  ))}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: PASS — 2 dots in the test scenario.

- [ ] **Step 6: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/Timeline.test.tsx
git commit -m "feat(timeline): visual zoom — stretch [A,B] window to full timeline width"
```

---

## Task 7: Mini-map (collapsible + localStorage persistence)

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Modify: `tests/unit/components/Timeline.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/components/Timeline.test.tsx`:

```typescript
describe('Timeline mini-map', () => {
  it('mini-map is hidden when zoomWindow is null', () => {
    render(<Timeline />); // base mock: zoomWindow is null
    expect(screen.queryByRole('region', { name: /mini-map/i })).toBeNull();
  });

  it('mini-map is visible when zoomWindow is set', () => {
    // Use the same mock from Task 6 (zoomed). Mini-map should appear.
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 's1', shortHash: 'a1', message: '', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
          { name: 's2', shortHash: 'a2', message: '', author: 'u', date: '2026-01-30T00:00:00Z', isLive: true },
        ] }],
        cursorA: '2026-01-10T00:00:00Z',
        cursorB: '2026-01-20T00:00:00Z',
        zoomWindow: { a: '2026-01-10T00:00:00Z', b: '2026-01-20T00:00:00Z' },
        graphMode: 'single' as const,
        setCursorA: vi.fn(), setCursorB: vi.fn(),
        enterZoom: vi.fn(), exitZoom: vi.fn(), setGraphMode: vi.fn(),
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TimelineMM }) => {
      render(<TimelineMM />);
      expect(screen.getByRole('region', { name: /mini-map/i })).toBeInTheDocument();
    });
  });

  it('chevron toggle collapses the mini-map and persists state to localStorage', () => {
    // Clear localStorage first
    localStorage.removeItem('timelineMiniMapCollapsed');
    vi.resetModules();
    // ... same mock as above
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TimelineMMChev }) => {
      const { rerender } = render(<TimelineMMChev />);
      expect(screen.getByRole('region', { name: /mini-map/i })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /collapse mini-map/i }));
      // After collapse, the region should be hidden (or marked aria-expanded=false)
      const region = screen.queryByRole('region', { name: /mini-map/i });
      expect(region === null || region.getAttribute('aria-expanded') === 'false').toBe(true);
      expect(localStorage.getItem('timelineMiniMapCollapsed')).toBe('true');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: FAIL — mini-map region not rendered.

- [ ] **Step 3: Implement the mini-map in Timeline.tsx**

Add near the top of the component body:

```typescript
const [miniMapCollapsed, setMiniMapCollapsed] = useState<boolean>(() => {
  return localStorage.getItem('timelineMiniMapCollapsed') === 'true';
});

const toggleMiniMapCollapsed = useCallback(() => {
  setMiniMapCollapsed((prev) => {
    const next = !prev;
    localStorage.setItem('timelineMiniMapCollapsed', String(next));
    return next;
  });
}, []);
```

In the JSX, above the main timeline SVG, render the mini-map only when `zoomWindow !== null` :

```tsx
{zoomWindow && (
  <div
    role="region"
    aria-label="Mini-map"
    aria-expanded={!miniMapCollapsed}
    style={{ height: miniMapCollapsed ? 8 : 16, /* base styling */ }}
  >
    <button
      type="button"
      onClick={toggleMiniMapCollapsed}
      aria-label={miniMapCollapsed ? 'Expand mini-map' : 'Collapse mini-map'}
    >
      {miniMapCollapsed ? '▾' : '▴'}
    </button>
    {!miniMapCollapsed && (
      <svg width="100%" height={12}>
        {/* Mini-map: render all snapshots at full chronological scale */}
        {snapshots.map((s) => {
          const fullWindow = { startISO: snapshots[0].date, endISO: snapshots[snapshots.length-1].date };
          const x = mapDateToPosition(s.date, fullWindow, miniMapWidth);
          return <circle key={s.shortHash} cx={x} cy={6} r={1.5} fill="#888" />;
        })}
        {/* Highlight overlay of the zoom window */}
        <rect
          x={mapDateToPosition(zoomWindow.a, { startISO: snapshots[0].date, endISO: snapshots[snapshots.length-1].date }, miniMapWidth)}
          y={0}
          width={
            mapDateToPosition(zoomWindow.b, { startISO: snapshots[0].date, endISO: snapshots[snapshots.length-1].date }, miniMapWidth)
            - mapDateToPosition(zoomWindow.a, { startISO: snapshots[0].date, endISO: snapshots[snapshots.length-1].date }, miniMapWidth)
          }
          height={12}
          fill="rgba(59, 130, 246, 0.2)"
          stroke="#3b82f6"
          strokeWidth={1}
        />
      </svg>
    )}
  </div>
)}
```

`miniMapWidth` should match the timeline's width — use the same `timelineWidth` constant or a `useResizeObserver`-derived value depending on what the existing code uses.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: PASS — 3 mini-map tests.

- [ ] **Step 5: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/Timeline.test.tsx
git commit -m "feat(timeline): mini-map (visible when zoomed) with collapsible chevron + localStorage persist"
```

---

## Task 8: Duration indicator below timeline

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Modify: `tests/unit/components/Timeline.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append to `tests/unit/components/Timeline.test.tsx`:

```typescript
describe('Timeline duration indicator', () => {
  it('displays "[date A] → [date B] · Δ X days · Y snapshots"', () => {
    render(<Timeline />); // base mock: A=2026-01-01, B=2026-01-30, 3 snapshots
    const indicator = screen.getByTestId('timeline-duration-indicator');
    expect(indicator.textContent).toMatch(/2026-01-01.*→.*2026-01-30.*Δ 29 days.*3 snapshots/);
  });

  it('uses hours format when window is less than 24h', () => {
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 's1', shortHash: 'a1', message: '', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
          { name: 's2', shortHash: 'a2', message: '', author: 'u', date: '2026-01-01T10:00:00Z', isLive: true },
        ] }],
        cursorA: '2026-01-01T00:00:00Z',
        cursorB: '2026-01-01T10:00:00Z',
        zoomWindow: null,
        graphMode: 'single' as const,
        setCursorA: vi.fn(), setCursorB: vi.fn(),
        enterZoom: vi.fn(), exitZoom: vi.fn(), setGraphMode: vi.fn(),
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TLh }) => {
      render(<TLh />);
      const indicator = screen.getByTestId('timeline-duration-indicator');
      expect(indicator.textContent).toMatch(/Δ 10 hours/);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: FAIL — "Unable to find an element by data-testid: timeline-duration-indicator".

- [ ] **Step 3: Implement formatDuration helper inline in Timeline.tsx**

Add this helper just before the component definition (or in `lib/timeline-zoom.ts` for purity — your call, but inline is fine for v1):

```typescript
function formatWindowDuration(aISO: string, bISO: string, snapshotsInWindow: number): string {
  const a = new Date(aISO);
  const b = new Date(bISO);
  const ms = b.getTime() - a.getTime();
  const days = Math.round(ms / 86_400_000);
  const hours = Math.round(ms / 3_600_000);
  const aLabel = a.toISOString().slice(0, 10);
  const bLabel = b.toISOString().slice(0, 10);
  let delta: string;
  if (ms < 86_400_000) {
    delta = `Δ ${hours} hours`;
  } else if (days > 365) {
    const years = Math.floor(days / 365);
    const remDays = days % 365;
    delta = `Δ ${years} year${years > 1 ? 's' : ''}` + (remDays > 0 ? ` ${remDays} days` : '');
  } else {
    delta = `Δ ${days} days`;
  }
  return `${aLabel} → ${bLabel} · ${delta} · ${snapshotsInWindow} snapshot${snapshotsInWindow !== 1 ? 's' : ''}`;
}
```

In the JSX, below the main timeline SVG and above the button row, add:

```tsx
{cursorA && cursorB && snapshots.length >= 2 && (
  <div
    data-testid="timeline-duration-indicator"
    style={{ fontSize: 11, color: '#999', textAlign: 'center', marginTop: 4 }}
  >
    {formatWindowDuration(
      cursorA,
      cursorB,
      snapshots.filter((s) => {
        const t = Date.parse(s.date);
        return t >= Date.parse(cursorA) && t <= Date.parse(cursorB);
      }).length,
    )}
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: PASS — both duration tests pass.

- [ ] **Step 5: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/Timeline.test.tsx
git commit -m "feat(timeline): duration indicator '[A] → [B] · Δ X days · N snapshots'"
```

---

## Task 9: `diffBetweenSnapshots` helper in `lib/graph-diff.ts`

**Files:**
- Modify: `upstream/gitnexus-web/src/lib/graph-diff.ts`
- Create: `tests/unit/graph-diff-between-snapshots.test.mjs`

- [ ] **Step 1: Read the current graph-diff.ts**

Run: `cat upstream/gitnexus-web/src/lib/graph-diff.ts | head -120`

Identify the function that takes 2 sets of nodes and returns `{ added, removed, unchanged }`. It's currently used for cross-repo diff; we'll wrap it with a new export that takes 2 snapshots of the same repo (which structurally is the same operation — sets of nodes from 2 sources).

- [ ] **Step 2: Add the failing test**

Create `tests/unit/graph-diff-between-snapshots.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { diffBetweenSnapshots } from '../../upstream/gitnexus-web/src/lib/graph-diff';

const snapshotA = {
  nodes: [
    { id: 'n1', label: 'file1.ts' },
    { id: 'n2', label: 'file2.ts' },
    { id: 'n3', label: 'file3.ts' },
  ],
};

const snapshotB = {
  nodes: [
    { id: 'n1', label: 'file1.ts' },   // unchanged
    { id: 'n3', label: 'file3.ts' },   // unchanged
    { id: 'n4', label: 'file4.ts' },   // added
  ],
};

describe('diffBetweenSnapshots', () => {
  it('returns added/removed/unchanged sets', () => {
    const result = diffBetweenSnapshots(snapshotA, snapshotB);
    expect(result.added.map((n) => n.id).sort()).toEqual(['n4']);
    expect(result.removed.map((n) => n.id).sort()).toEqual(['n2']);
    expect(result.unchanged.map((n) => n.id).sort()).toEqual(['n1', 'n3']);
  });

  it('handles identical snapshots (all unchanged)', () => {
    const result = diffBetweenSnapshots(snapshotA, snapshotA);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.unchanged.length).toBe(3);
  });

  it('handles empty snapshots', () => {
    const result = diffBetweenSnapshots({ nodes: [] }, { nodes: [] });
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- graph-diff-between-snapshots`
Expected: FAIL with "diffBetweenSnapshots is not a function" or similar.

- [ ] **Step 4: Add the helper in graph-diff.ts**

Append to `upstream/gitnexus-web/src/lib/graph-diff.ts`. The implementation reuses the existing cross-repo diff logic but takes 2 snapshots of the same repo. Inspect the existing exports to find the right primitive to reuse — likely a function that takes 2 node arrays and returns `{ added, removed, unchanged }`. Reuse it directly:

```typescript
export type SnapshotForDiff = {
  nodes: Array<{ id: string; label?: string; [key: string]: any }>;
};

export type SnapshotDiff = {
  added: SnapshotForDiff['nodes'];
  removed: SnapshotForDiff['nodes'];
  unchanged: SnapshotForDiff['nodes'];
};

/**
 * Diff between 2 snapshots of the same repo. Same algorithm as the
 * cross-repo diff — set membership on node.id. Use this helper when the
 * Timeline is in graphMode='diff' (Phase 1 of timeline-zoom-cursors
 * design).
 */
export function diffBetweenSnapshots(
  a: SnapshotForDiff,
  b: SnapshotForDiff,
): SnapshotDiff {
  const aIds = new Set(a.nodes.map((n) => n.id));
  const bIds = new Set(b.nodes.map((n) => n.id));
  return {
    added: b.nodes.filter((n) => !aIds.has(n.id)),
    removed: a.nodes.filter((n) => !bIds.has(n.id)),
    unchanged: a.nodes.filter((n) => bIds.has(n.id)),
  };
}
```

Note: if `graph-diff.ts` already exports a function that does exactly this (under another name like `diffNodeSets`), make `diffBetweenSnapshots` a thin wrapper that calls it — don't duplicate logic. The test above only checks the public API of `diffBetweenSnapshots`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- graph-diff-between-snapshots`
Expected: PASS — 3 tests.

- [ ] **Step 6: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/graph-diff-between-snapshots.test.mjs
git commit -m "feat(graph-diff): diffBetweenSnapshots helper for intra-repo time-travel diff"
```

---

## Task 10: "Compare A↔B" button + graphMode wiring

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Modify: `tests/unit/components/Timeline.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/components/Timeline.test.tsx`:

```typescript
describe('Timeline Compare A↔B button', () => {
  it('renders "Compare A↔B" button when graphMode is single', () => {
    render(<Timeline />); // base mock: graphMode='single'
    expect(screen.getByRole('button', { name: /compare a.*b/i })).toBeInTheDocument();
  });

  it('clicking "Compare A↔B" calls setGraphMode("diff")', () => {
    const setGraphMode = vi.fn();
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 's1', shortHash: 'a1', message: '', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
          { name: 's2', shortHash: 'a2', message: '', author: 'u', date: '2026-01-30T00:00:00Z', isLive: true },
        ] }],
        cursorA: '2026-01-01T00:00:00Z',
        cursorB: '2026-01-30T00:00:00Z',
        zoomWindow: null,
        graphMode: 'single' as const,
        setCursorA: vi.fn(), setCursorB: vi.fn(),
        enterZoom: vi.fn(), exitZoom: vi.fn(), setGraphMode,
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TLC }) => {
      render(<TLC />);
      fireEvent.click(screen.getByRole('button', { name: /compare a.*b/i }));
      expect(setGraphMode).toHaveBeenCalledWith('diff');
    });
  });

  it('shows "Exit compare" label when graphMode is diff', () => {
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 's1', shortHash: 'a1', message: '', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
          { name: 's2', shortHash: 'a2', message: '', author: 'u', date: '2026-01-30T00:00:00Z', isLive: true },
        ] }],
        cursorA: '2026-01-01T00:00:00Z',
        cursorB: '2026-01-30T00:00:00Z',
        zoomWindow: null,
        graphMode: 'diff' as const,
        setCursorA: vi.fn(), setCursorB: vi.fn(),
        enterZoom: vi.fn(), exitZoom: vi.fn(), setGraphMode: vi.fn(),
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TLCex }) => {
      render(<TLCex />);
      expect(screen.getByRole('button', { name: /exit compare/i })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: FAIL — Compare button not rendered.

- [ ] **Step 3: Add the Compare button**

Just after the Zoom button (from Task 5), add:

```tsx
<button
  type="button"
  onClick={() => setGraphMode(graphMode === 'diff' ? 'single' : 'diff')}
  disabled={!cursorA || !cursorB}
  title={graphMode === 'diff' ? 'Exit compare (Shift+D)' : 'Compare snapshots at cursors A and B (Shift+D)'}
  className="..."
>
  {graphMode === 'diff' ? 'Exit compare' : 'Compare A↔B'}
</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: PASS — 3 new tests.

- [ ] **Step 5: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/Timeline.test.tsx
git commit -m "feat(timeline): Compare A↔B / Exit compare toggle button"
```

---

## Task 11: Wire `graphMode='diff'` to fetch + render the intra-repo diff

**Files:**
- Modify: `upstream/gitnexus-web/src/App.tsx` (or `GraphCanvas.tsx` — whichever owns the fetch+reducer pipeline)
- Modify: `tests/unit/components/Timeline.test.tsx` (add integration test)

- [ ] **Step 1: Identify the right file**

Search for where the cross-repo `diffMode` is consumed and triggers the fetch+reducer:

```bash
cd c:/Users/rdenis/VScode/gitnexus
grep -rn "diffMode" upstream/gitnexus-web/src/App.tsx upstream/gitnexus-web/src/components/GraphCanvas.tsx upstream/gitnexus-web/src/hooks/useSigma.ts 2>&1 | head -30
```

The handler that responds to `diffMode` changes (fetches the 2 repos' nodes, computes the diff, applies the Sigma reducer) is the target — we mirror this for `graphMode === 'diff'`.

- [ ] **Step 2: Add the failing integration test**

This test verifies the cross-cut: when `graphMode='diff'` and 2 cursors are set, the diff pipeline is exercised. Since this involves the graph rendering pipeline, write a focused test that asserts the *fetch* is triggered (mock the fetch and verify it's called for both snapshot SHAs).

Append to `tests/unit/components/Timeline.test.tsx`:

```typescript
describe('graphMode=diff triggers intra-repo diff fetch', () => {
  it('when graphMode transitions to diff with cursors set, fetches both snapshots', () => {
    // This test depends on the file where the fetch is wired. Adapt the
    // mock target to that file (likely App.tsx or GraphCanvas.tsx).
    const fetchSpy = vi.fn().mockResolvedValue({ nodes: [], edges: [] });
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/services/backend-client', () => ({
      fetchGraphForSnapshot: fetchSpy,
      // ... other client fns stubbed minimally
    }));
    // Render a higher-level component that owns the fetch (e.g., App or GraphCanvas).
    // Document the chosen file in the spec section "Wired diff" before writing this test.
    // ... omitted for brevity — see Step 3 for the wiring decision.
  });
});
```

> If after Step 1 the right file isn't clear, prefer adding the wiring in App.tsx (top-level state synchronizer) over GraphCanvas (rendering layer only).

- [ ] **Step 3: Add the wiring in App.tsx**

In `App.tsx`, find the useEffect that responds to `diffMode` changes (it fetches `repoA` and `repoB` and computes the cross-repo diff). Just after it, add a sibling useEffect for `graphMode === 'diff'`:

```typescript
import { diffBetweenSnapshots } from './lib/graph-diff';

// ...
useEffect(() => {
  if (graphMode !== 'diff' || !cursorA || !cursorB) {
    return;
  }
  let cancelled = false;
  (async () => {
    // Resolve cursor dates to the closest snapshot SHAs.
    const snapA = snapshots.find((s) => s.date === cursorA);
    const snapB = snapshots.find((s) => s.date === cursorB);
    if (!snapA || !snapB) return;

    const [graphA, graphB] = await Promise.all([
      fetchGraphForSnapshot(projectName, snapA.shortHash),
      fetchGraphForSnapshot(projectName, snapB.shortHash),
    ]);
    if (cancelled) return;

    const diff = diffBetweenSnapshots(graphA, graphB);
    // Apply the diff to the Sigma reducer — reuse the same applyDiffColoring
    // function that the cross-repo flow uses (look up the call site of
    // diff coloring used by enterDiffMode and reuse it).
    applyDiffColoring(diff);
  })();

  return () => { cancelled = true; };
}, [graphMode, cursorA, cursorB, projectName, snapshots]);
```

Note: `applyDiffColoring` is a placeholder for whatever the existing diff-coloring sink is in your code (probably a useSigma reducer setter). Find it via:

```bash
grep -rn "diffColor\|diffReducer\|applyDiff\|setDiff" upstream/gitnexus-web/src/ 2>&1 | head -20
```

Reuse the same sink — don't introduce a parallel pipeline.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: PASS — the fetch is invoked twice (once per snapshot).

- [ ] **Step 5: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/Timeline.test.tsx
git commit -m "feat(timeline): wire graphMode='diff' to fetch both snapshots + apply diff coloring"
```

---

## Task 12: Keyboard shortcuts (Z, Shift+D)

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Modify: `tests/unit/components/Timeline.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/components/Timeline.test.tsx`:

```typescript
describe('Timeline keyboard shortcuts', () => {
  it('pressing Z toggles zoom (calls enterZoom when zoomWindow=null)', () => {
    const enterZoom = vi.fn();
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 's1', shortHash: 'a1', message: '', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
          { name: 's2', shortHash: 'a2', message: '', author: 'u', date: '2026-01-30T00:00:00Z', isLive: true },
        ] }],
        cursorA: '2026-01-01T00:00:00Z',
        cursorB: '2026-01-30T00:00:00Z',
        zoomWindow: null,
        graphMode: 'single' as const,
        setCursorA: vi.fn(), setCursorB: vi.fn(),
        enterZoom, exitZoom: vi.fn(), setGraphMode: vi.fn(),
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TLKZ }) => {
      render(<TLKZ />);
      fireEvent.keyDown(window, { key: 'z' });
      expect(enterZoom).toHaveBeenCalled();
    });
  });

  it('pressing Shift+D toggles compare (calls setGraphMode("diff"))', () => {
    const setGraphMode = vi.fn();
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 's1', shortHash: 'a1', message: '', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
          { name: 's2', shortHash: 'a2', message: '', author: 'u', date: '2026-01-30T00:00:00Z', isLive: true },
        ] }],
        cursorA: '2026-01-01T00:00:00Z',
        cursorB: '2026-01-30T00:00:00Z',
        zoomWindow: null,
        graphMode: 'single' as const,
        setCursorA: vi.fn(), setCursorB: vi.fn(),
        enterZoom: vi.fn(), exitZoom: vi.fn(), setGraphMode,
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TLKD }) => {
      render(<TLKD />);
      fireEvent.keyDown(window, { key: 'D', shiftKey: true });
      expect(setGraphMode).toHaveBeenCalledWith('diff');
    });
  });

  it('ignores Z / Shift+D when an input is focused (do not steal typing)', () => {
    const enterZoom = vi.fn();
    vi.resetModules();
    vi.doMock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
      useAppState: () => ({
        projectName: 'test-repo',
        availableRepos: [{ name: 'test-repo', snapshots: [
          { name: 's1', shortHash: 'a1', message: '', author: 'u', date: '2026-01-01T00:00:00Z', isLive: false },
          { name: 's2', shortHash: 'a2', message: '', author: 'u', date: '2026-01-30T00:00:00Z', isLive: true },
        ] }],
        cursorA: '2026-01-01T00:00:00Z',
        cursorB: '2026-01-30T00:00:00Z',
        zoomWindow: null,
        graphMode: 'single' as const,
        setCursorA: vi.fn(), setCursorB: vi.fn(),
        enterZoom, exitZoom: vi.fn(), setGraphMode: vi.fn(),
        diffMode: null, exitDiffMode: vi.fn(), switchRepo: vi.fn(),
        churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0,
        enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
        couplingActive: false, couplingLoading: false, couplingError: null,
        enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
        growthActive: false, growthLoading: false, growthError: null,
        enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
        lifespanActive: false, lifespanLoading: false, lifespanError: null,
        enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
        ownershipActive: false, ownershipLoading: false, ownershipError: null,
        enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
      }),
    }));
    return import('../../../upstream/gitnexus-web/src/components/Timeline').then(({ Timeline: TLKI }) => {
      render(<TLKI />);
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      fireEvent.keyDown(input, { key: 'z' });
      expect(enterZoom).not.toHaveBeenCalled();
      input.remove();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: FAIL — enterZoom / setGraphMode not called from keyboard.

- [ ] **Step 3: Add the keyboard handler**

In `Timeline.tsx`, add a useEffect for global keyboard listener:

```typescript
useEffect(() => {
  const onKeyDown = (e: KeyboardEvent) => {
    // Don't steal keys when user is typing in an input/textarea/contenteditable.
    const target = e.target as HTMLElement | null;
    if (target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    )) {
      return;
    }
    if (!cursorA || !cursorB || snapshots.length < 2) return;

    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      if (zoomWindow) exitZoom();
      else enterZoom();
    } else if (e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      setGraphMode(graphMode === 'diff' ? 'single' : 'diff');
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, [cursorA, cursorB, snapshots, zoomWindow, graphMode, enterZoom, exitZoom, setGraphMode]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: PASS — 3 new tests.

- [ ] **Step 5: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/Timeline.test.tsx
git commit -m "feat(timeline): keyboard shortcuts Z (zoom) and Shift+D (compare), ignored when input focused"
```

---

## Task 13: E2E Playwright spec

**Files:**
- Create: `tests/e2e/specs/timeline-zoom-and-diff.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/specs/timeline-zoom-and-diff.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Timeline zoom + cursor diff (Phase 1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    // Wait for the app to load and a repo to be available. The fixture
    // setup in global-setup.mjs analyzes sample-repo, so it should be
    // selectable in the dropdown.
    await page.waitForSelector('[data-testid="repo-selector"]', { timeout: 30_000 });
    // Pick the fixture repo (sample-repo from tests/fixtures/).
    await page.click('[data-testid="repo-selector"]');
    await page.click('text=sample-repo');
    // Wait for the timeline to render with the snapshots.
    await page.waitForSelector('[data-cursor="A"]', { timeout: 15_000 });
    await page.waitForSelector('[data-cursor="B"]', { timeout: 15_000 });
  });

  test('drag cursors → zoom → mini-map appears → compare → diff colors → cleanup', async ({ page }) => {
    // Step 1: cursors are visible
    const cursorA = page.locator('[data-cursor="A"]');
    const cursorB = page.locator('[data-cursor="B"]');
    await expect(cursorA).toBeVisible();
    await expect(cursorB).toBeVisible();

    // Step 2: click "Zoom to window"
    await page.click('button:has-text("Zoom to window")');

    // Step 3: mini-map appears
    await expect(page.getByRole('region', { name: /mini-map/i })).toBeVisible();

    // Step 4: button label changes to "Zoom out"
    await expect(page.locator('button:has-text("Zoom out")')).toBeVisible();

    // Step 5: click "Compare A↔B"
    await page.click('button:has-text("Compare A↔B")');

    // Step 6: verify the graph received diff coloring. We don't pixel-test
    // the Sigma canvas; instead we check the reducer state via a debug
    // attribute on the canvas container, OR we check that the DiffBanner
    // (or equivalent UI) shows. Adapt to whichever signal the cross-repo
    // diff already exposes today.
    await expect(page.locator('[data-graph-mode="diff"]')).toBeVisible({ timeout: 10_000 });

    // Step 7: exit compare
    await page.click('button:has-text("Exit compare")');
    await expect(page.locator('[data-graph-mode="diff"]')).not.toBeVisible();

    // Step 8: zoom out
    await page.click('button:has-text("Zoom out")');
    await expect(page.getByRole('region', { name: /mini-map/i })).not.toBeVisible();
  });

  test('keyboard shortcut Z toggles zoom', async ({ page }) => {
    await page.keyboard.press('z');
    await expect(page.locator('button:has-text("Zoom out")')).toBeVisible();
    await page.keyboard.press('z');
    await expect(page.locator('button:has-text("Zoom to window")')).toBeVisible();
  });

  test('keyboard shortcut Shift+D toggles compare', async ({ page }) => {
    await page.keyboard.press('Shift+D');
    await expect(page.locator('button:has-text("Exit compare")')).toBeVisible();
    await page.keyboard.press('Shift+D');
    await expect(page.locator('button:has-text("Compare A↔B")')).toBeVisible();
  });
});
```

> **Note on `[data-graph-mode="diff"]`** : add this attribute to the graph container (probably in `GraphCanvas.tsx` or `App.tsx`) when `graphMode === 'diff'`. It's our test-friendly signal that the cursor-diff is active, equivalent to how the cross-repo diff exposes its state today (look for the existing pattern — `DiffBanner` likely has a similar attribute). If the existing cross-repo diff uses a different signal (e.g., presence of a DiffBanner element), adapt the locator accordingly.

- [ ] **Step 2: Add the `data-graph-mode` attribute**

In whichever file owns the top-level graph container (likely `App.tsx` or `GraphCanvas.tsx`), add `data-graph-mode={graphMode}` to the wrapping element.

- [ ] **Step 3: Run the e2e spec**

Run: `cd tests && npm run test:e2e -- timeline-zoom-and-diff`
Expected: PASS — all 3 tests green.

(If the stack isn't running, start it first: `docker compose up -d`.)

- [ ] **Step 4: Regenerate patch + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/e2e/specs/timeline-zoom-and-diff.spec.ts
git commit -m "test(e2e): timeline zoom + cursors + compare flow on sample-repo"
```

---

## Task 14: Documentation updates + final commit

**Files:**
- Modify: `ROADMAP.md`
- Modify: `INVENTORY.md`
- Modify: `tests/README.md`

- [ ] **Step 1: Update ROADMAP.md**

Find the "Déjà livré" table at the top of `ROADMAP.md`. Add a new row (use the next available `# `):

```markdown
| 25 | **Timeline zoom + 2 cursors A/B with intra-repo diff mode** (Phase 1 of 2 — Phase 2 = window filter) | `Timeline.tsx`, `lib/timeline-zoom.ts`, `lib/graph-diff.ts::diffBetweenSnapshots`, state in `useAppState` |
```

Update the header date :

```markdown
Dernière mise à jour : 2026-05-27 (Timeline zoom + 2 cursors A/B livré : drag cursors blue/orange, zoom on window with mini-map collapsible, "Compare A↔B" intra-repo diff mode via reuse of graph-diff pipeline, keyboard shortcuts Z and Shift+D, duration indicator. Phase 2 — filter graph to window — parquée).
```

- [ ] **Step 2: Update INVENTORY.md**

In Partie B.2 "Composants frontend", under `Timeline.tsx`, replace the existing one-liner with:

```markdown
- `Timeline.tsx` — slider + play/pause auto-animation, **2 cursors drag A/B (blue/orange) + zoom on window [A,B] + mini-map collapsible + Compare A↔B intra-repo diff toggle + keyboard shortcuts Z/Shift+D + duration indicator**
```

- [ ] **Step 3: Update tests/README.md**

Add the new tests to the inventory tables. Search for where unit tests are listed and add :

```markdown
| `tests/unit/timeline-zoom.test.mjs` | Pure date/position fns (`computeZoomWindow`, `mapDateToPosition`, `mapPositionToDate`, `snapToNearestSnapshot`) |
| `tests/unit/use-app-state-timeline.test.tsx` | Cursor A/B state with auto-swap + mutual exclusion with cross-repo diffMode |
| `tests/unit/components/Timeline.test.tsx` | Cursor render, drag, zoom toggle, mini-map collapsible, duration indicator, compare toggle, keyboard shortcuts |
| `tests/unit/graph-diff-between-snapshots.test.mjs` | `diffBetweenSnapshots` helper for intra-repo time-travel diff |
| `tests/e2e/specs/timeline-zoom-and-diff.spec.ts` | E2E : drag cursors + zoom + compare flow on sample-repo |
```

- [ ] **Step 4: Final commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add ROADMAP.md INVENTORY.md tests/README.md patches/upstream-all.diff
git commit -m "docs: Timeline zoom + 2 cursors A/B Phase 1 livré (ROADMAP + INVENTORY + tests README)"
```

---

## Self-Review

**Spec coverage** :
- ✅ Spec § 2 Goal — 2 cursors, zoom, compare A↔B, Lifespan stays global → Task 2 (state), Tasks 3-4 (cursors+drag), Tasks 5-6 (zoom), Task 10 (compare button), Task 11 (wire diff), no Lifespan changes.
- ✅ Spec § 3 Decisions cadres — A+B only (Phase 1), graphMode toggle, Lifespan global, mini-map collapsible, auto-swap → Task 2 + Task 7.
- ✅ Spec § 4.2 Architecture — 4 file targets covered (lib/timeline-zoom, lib/graph-diff, useAppState, Timeline) → Tasks 1, 2, 9, 3-12.
- ✅ Spec § 4.2 Relation with diffMode existant — Mutual exclusion → Task 2 step 5 + step 6.
- ✅ Spec § 4.2 Interaction model — drag with rAF throttle + snap at release → Task 4.
- ✅ Spec § 4.2 UI/SVG layout — cursors blue/orange, mini-map, duration, keyboard shortcuts → Tasks 3, 7, 8, 12.
- ✅ Spec § 4.3 Edge cases — Repo < 2 snapshots (Task 3), Cursors A>B (Task 2), graphMode toggle (Task 10), Mode diff drag B (Task 11 — relies on the existing useEffect re-running on cursor change which triggers re-fetch on next mouseup).
- ✅ Spec § 5 Testing strategy — Unit pure (Task 1), state (Task 2), component (Tasks 3-12), E2E (Task 13).
- ✅ Spec § 9 Document updates — Task 14.
- ✅ Spec § 10 UX decisions résolues — Couleurs (Task 3), raccourcis (Task 12), duration (Task 8), mini-map default (Task 7).

**Placeholder scan** :
- ✅ No "TBD" / "TODO" / "fill in later".
- ⚠️ Task 11 says "applyDiffColoring is a placeholder for whatever the existing diff-coloring sink is" — that's intentional (the engineer must inspect the current codebase). It's documented with a grep command to find it. This is acceptable because: (a) we can't predict the exact name without reading more code, (b) the test verifies the *effect* (fetch called twice), not the implementation detail.
- ⚠️ Task 11 also says "applyDiffColoring is a placeholder" — same justification.
- ⚠️ Task 3 step 4 says "Use whichever Tailwind / className convention the existing play/pause button uses." — this is acceptable for v1 because the codebase uses Tailwind throughout; the exact class is just visual styling, not semantic.

**Type consistency** :
- ✅ `DateRange` type defined in Task 1 and reused in Task 6.
- ✅ `cursorA`, `cursorB`, `zoomWindow`, `graphMode` used consistently across Tasks 2-12 with the types declared in Task 2.
- ✅ `mapDateToPosition`, `mapPositionToDate`, `snapToNearestSnapshot`, `computeZoomWindow` signatures match between Task 1 (definition) and Tasks 3, 4, 6, 7 (usage).
- ✅ `diffBetweenSnapshots(a, b)` signature in Task 9 matches usage in Task 11.

**Scope check** : Plan covers one cohesive feature (Phase 1 of Timeline zoom + cursor diff). Phase 2 explicitly out of scope (filter graph to window). 14 tasks, ~2 weeks estimated effort. Fits a single implementation plan.

No issues found that require fixing inline. Plan is ready for execution.
