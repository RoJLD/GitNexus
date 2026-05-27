# Roadmap Predictive — Augmented Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Extend the existing Timeline to be **ghost-time-aware** : when the cursor points to a past snapshot, ghosts displayed are those planned at that point in history (not today's). Cross-fade animation when ghosts materialize during Play. 3 activation triggers (auto-detect default + lock toggle + Animate button).

**Architecture:** 100% frontend. Reuses CORE per-snapshot `ghosts.json` sidecars via `/ghosts/at?repo=&commit=<sha>`. New `lib/augmented-timeline.ts` (pure fns) + `services/snapshot-ghosts-cache.ts` (parallel pre-fetch + Map cache, pattern of `snapshotCacheRef`). Extends `useSigma`, `Timeline.tsx`, `GraphCanvas.tsx`, `GhostFiltersSection.tsx`, `useAppState.tsx`.

**Tech Stack:** TypeScript / React, zero new deps.

**Spec source:** [docs/superpowers/specs/2026-05-27-roadmap-predictive-augmented-timeline-design.md](../specs/2026-05-27-roadmap-predictive-augmented-timeline-design.md) (commit `88e20e80`)

**Depends on:** CORE (per-snapshot sidecars + `/ghosts/at` endpoint) + Augmented graph (`showGhosts` toggle + useSigma ghost layer + GhostFiltersSection) — all shipped.

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branch `deployment`).

**Implementer reminders:**
1. `upstream/gitnexus-web/src/**` is gitignored — regen `patches/upstream-all.diff` after each task.
2. Local Node 21 can't run vitest 4.x — validate via `node --check` + smoke; CI handles runtime.
3. `git config user.email` must print `roblastar@live.fr`.
4. Append `## Update — Shipped` at the final task.

---

## File Structure

```
upstream/gitnexus-web/src/
├── lib/augmented-timeline.ts                NEW  selectGhostsAt + computeTransitions
├── services/snapshot-ghosts-cache.ts        NEW  parallel pre-fetch + Map cache
├── hooks/
│   ├── useAppState.tsx                      MOD  +lockGhostsToHead, +animationActive
│   └── useSigma.ts                          MOD  opacity override map for cross-fade
├── components/
│   ├── Timeline.tsx                         MOD  +Animate roadmap button
│   ├── GraphCanvas.tsx                      MOD  picks ghosts via selectGhostsAt
│   └── GhostFiltersSection.tsx              MOD  +Lock toggle

tests/
├── unit/
│   ├── augmented-timeline.test.mjs                  NEW
│   ├── snapshot-ghosts-cache.test.mjs               NEW
│   └── components/Timeline.augmented.test.tsx       NEW
└── e2e/specs/07-augmented-timeline.spec.ts          NEW

ROADMAP.md / INVENTORY.md / tests/README.md          MOD
docs/superpowers/specs/2026-05-27-roadmap-predictive-augmented-timeline-design.md  MOD  Update — Shipped
patches/upstream-all.diff                            REGEN
```

---

## Section A — Pure fns (Task 1)

### Task 1: `augmented-timeline.ts` pure fns

**Files:**
- Create: `upstream/gitnexus-web/src/lib/augmented-timeline.ts`
- Create: `tests/unit/augmented-timeline.test.mjs`

Implementation:

```ts
import type { GhostInput } from './ghost-layout';

export type SnapshotGhosts = { sha: string; date: string; ghosts: GhostInput[] };

// Closest-prior lookup : find the snapshot whose date <= cursorTime, return its ghosts.
// In 'lock-to-head' mode, returns liveGhosts unchanged (no time-aware behavior).
export function selectGhostsAt(
  cache: Map<string, SnapshotGhosts>,
  cursorTime: Date,
  mode: 'time-aware' | 'lock-to-head',
  liveGhosts: GhostInput[],
): GhostInput[] {
  if (mode === 'lock-to-head') return liveGhosts;
  if (cache.size === 0) return [];
  let best: SnapshotGhosts | null = null;
  for (const snap of cache.values()) {
    const d = new Date(snap.date);
    if (d.getTime() > cursorTime.getTime()) continue;
    if (!best || d.getTime() > new Date(best.date).getTime()) best = snap;
  }
  return best?.ghosts ?? [];
}

// For Play animation : returns ghosts that crossed materialized/cancelled
// thresholds between prev and next. Used to trigger cross-fade transitions.
export function computeTransitions(
  cache: Map<string, SnapshotGhosts>,
  prevTime: Date,
  nextTime: Date,
): { materializing: string[]; cancelling: string[] } {
  const materializing: string[] = [];
  const cancelling: string[] = [];
  const prev = prevTime.getTime();
  const next = nextTime.getTime();
  // Walk EVERY ghost ever seen in the cache (union of all snapshots), check transitions.
  const seen = new Set<string>();
  for (const snap of cache.values()) {
    for (const g of snap.ghosts) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      const matAt = (g as any).materializedAt?.date ? new Date((g as any).materializedAt.date).getTime() : null;
      const canAt = (g as any).cancelledAt?.date ? new Date((g as any).cancelledAt.date).getTime() : null;
      if (matAt && matAt > prev && matAt <= next) materializing.push(g.id);
      if (canAt && canAt > prev && canAt <= next) cancelling.push(g.id);
    }
  }
  return { materializing, cancelling };
}

// Pure mode resolution helper.
export function resolveAugmentedTimelineMode(opts: {
  cursor: Date;
  head: Date;
  lockGhostsToHead: boolean;
  skewToleranceMs?: number;
}): 'live' | 'time-aware' {
  if (opts.lockGhostsToHead) return 'live';
  const skew = opts.skewToleranceMs ?? 60_000;
  if (Math.abs(opts.cursor.getTime() - opts.head.getTime()) < skew) return 'live';
  return 'time-aware';
}
```

Test cases (8) :
- selectGhostsAt with empty cache → empty
- selectGhostsAt picks closest-prior
- selectGhostsAt before earliest → empty
- selectGhostsAt lock-to-head returns liveGhosts unchanged
- computeTransitions detects materializing in window
- computeTransitions detects cancelling in window
- computeTransitions doesn't double-count across snapshots
- resolveAugmentedTimelineMode lock + skew + threshold

Commit: `feat(augmented-timeline): pure fns (selectGhostsAt + computeTransitions + resolveMode)`.

---

## Section B — Snapshot ghosts cache (Task 2)

### Task 2: `snapshot-ghosts-cache.ts` service

**Files:**
- Create: `upstream/gitnexus-web/src/services/snapshot-ghosts-cache.ts`
- Create: `tests/unit/snapshot-ghosts-cache.test.mjs`

```ts
import type { SnapshotGhosts } from '../lib/augmented-timeline';

const TTL_MS = 30_000;
const POOL = 3;
const cache = new Map<string, { at: number; promise: Promise<Map<string, SnapshotGhosts>> }>();

export function clearSnapshotGhostsCache(): void {
  cache.clear();
}

export async function prefetchSnapshotGhosts(repo: string, signal?: AbortSignal): Promise<Map<string, SnapshotGhosts>> {
  const now = Date.now();
  const cached = cache.get(repo);
  if (cached && now - cached.at < TTL_MS) return cached.promise;

  const promise = (async (): Promise<Map<string, SnapshotGhosts>> => {
    const listRes = await fetch(`/snapshots?repo=${encodeURIComponent(repo)}`, { signal });
    if (!listRes.ok) return new Map();
    const listBody = await listRes.json();
    const snapshots: Array<{ key: string; commit?: { shortHash?: string; date?: string } }> =
      listBody.snapshots || [];
    // Cap to 50 most-recent (chronological) to bound pre-fetch cost.
    const capped = snapshots.slice(0, 50);

    const out = new Map<string, SnapshotGhosts>();
    // Parallel pool fetch.
    const queue = [...capped];
    async function worker() {
      while (queue.length) {
        const s = queue.shift();
        if (!s) return;
        const sha = s.commit?.shortHash || s.key;
        if (!sha) continue;
        try {
          const r = await fetch(`/ghosts/at?repo=${encodeURIComponent(repo)}&commit=${encodeURIComponent(sha)}`, { signal });
          if (!r.ok) continue;
          const body = await r.json();
          out.set(sha, { sha, date: s.commit?.date || '', ghosts: body.ghosts || [] });
        } catch {
          // Skip silently; CI integration test asserts non-throw.
        }
      }
    }
    await Promise.all(Array.from({ length: POOL }, () => worker()));
    return out;
  })();

  cache.set(repo, { at: now, promise });
  return promise;
}
```

Test cases (5) :
- Empty `/snapshots` list → empty Map
- 3 snapshots → Map with 3 entries
- Cache hit on second call within TTL → no second fetch
- Cap to 50 snapshots when list > 50
- AbortSignal aborts in-flight fetches

Commit: `feat(augmented-timeline): snapshot-ghosts-cache (parallel pool + 30s TTL)`.

---

## Section C — Sigma opacity override (Task 3)

### Task 3: Extend `useSigma.ts` with `opacityOverride` map

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useSigma.ts`

Add to the ghost-node reducer:
```ts
// Existing : if (data.isGhost) { return { ... opacity: vs.opacity ... } }
// Extended : if (data.isGhost) { const override = opacityOverrideRef.current?.get(data.sourceGhostId); return { ... opacity: override ?? vs.opacity ... } }
```

Add a ref `opacityOverrideRef = useRef<Map<string, number>>(new Map())` to the hook.

Expose new public API:
```ts
return {
  ...existing,
  startGhostCrossFade(ghostId: string, durationMs: number): void {
    // rAF loop : interpolate opacity from current → 0 over durationMs, write to ref, refresh sigma.
  },
  startRealNodeCrossFade(nodeId: string, durationMs: number): void {
    // Similar, for real node opacity (0 → 1).
  },
  clearCrossFades(): void {
    // Reset all transient overrides.
  },
};
```

The rAF loop is cheap : at most ~10 in-flight transitions at the same time (5 ghosts materializing simultaneously is rare). Each rAF tick refreshes sigma once.

Test : extend `tests/unit/components/GraphCanvas.test.tsx` (if exists) or add an inline smoke that verifies the override map is consulted.

Commit: `feat(augmented-timeline): useSigma opacityOverride + cross-fade rAF loop`.

---

## Section D — UI integration (Tasks 4-6)

### Task 4: Timeline.tsx Animate roadmap button

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`

Add a button next to Play/Preload :
```tsx
<button
  type="button"
  data-testid="animate-roadmap-button"
  onClick={() => {
    if (!showGhosts) setShowGhosts(true);
    if (lockGhostsToHead) setLockGhostsToHead(false);
    // Find earliest snapshot
    const earliest = snapshots[snapshots.length - 1]; // sorted newest-first per existing code
    if (earliest) {
      setCursor(new Date(earliest.commit.date).getTime());
      startPlay(); // existing function
    }
    setAnimationActive(true);
  }}
>
  🎬 Animate roadmap
</button>
{animationActive && (
  <div className="anim-banner">Animating roadmap…</div>
)}
```

Add state setters `setAnimationActive(false)` on Stop press.

Test: 3 cases (button visible, click sets cursor + plays, banner shown when animationActive).

Commit: `feat(augmented-timeline): Timeline Animate roadmap button + banner`.

---

### Task 5: GhostFiltersSection Lock toggle + useAppState fields

**Files:**
- Modify: `upstream/gitnexus-web/src/components/GhostFiltersSection.tsx`
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx`

In useAppState add :
```ts
lockGhostsToHead: boolean;
setLockGhostsToHead: (v: boolean) => void;
animationActive: boolean;
setAnimationActive: (v: boolean) => void;
```

Default both `false`.

In GhostFiltersSection, when `showGhosts` is ON, add :
```tsx
<label>
  <input
    type="checkbox"
    checked={lockGhostsToHead}
    onChange={(e) => setLockGhostsToHead(e.target.checked)}
  />
  Lock ghosts to today's view
</label>
```

Test: 2 cases (toggle hidden when showGhosts OFF, click updates state).

Commit: `feat(augmented-timeline): Lock toggle + useAppState lockGhostsToHead + animationActive`.

---

### Task 6: GraphCanvas integration

**Files:**
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx`

Add new useEffect that uses `selectGhostsAt` + `prefetchSnapshotGhosts` :
```tsx
import { selectGhostsAt, resolveAugmentedTimelineMode, computeTransitions } from '../lib/augmented-timeline';
import { prefetchSnapshotGhosts } from '../services/snapshot-ghosts-cache';

const cursorTime = useAppState(s => s.timelineCursorDate); // assumed existing — verify shape
const lockGhostsToHead = useAppState(s => s.lockGhostsToHead);

const cacheRef = useRef<Map<string, SnapshotGhosts>>(new Map());

// Pre-fetch on repo change.
useEffect(() => {
  if (!repoName || !showGhosts) return;
  const ctrl = new AbortController();
  prefetchSnapshotGhosts(repoName, ctrl.signal).then(c => { cacheRef.current = c; });
  return () => ctrl.abort();
}, [repoName, showGhosts]);

// Switch ghost set when cursor changes.
const prevCursorRef = useRef<Date>(new Date());
useEffect(() => {
  if (!sigmaRef.current) return;
  const graph = sigmaRef.current.getGraph();
  if (!showGhosts || !repoName) return;
  const mode = resolveAugmentedTimelineMode({
    cursor: cursorTime,
    head: new Date(/* HEAD date — read from live repo metadata */),
    lockGhostsToHead,
  });
  const liveGhosts = lastFetchedGhostsRef.current; // existing
  const effectiveGhosts = selectGhostsAt(cacheRef.current, cursorTime, mode === 'time-aware' ? 'time-aware' : 'lock-to-head', liveGhosts);
  applyGhostLayer(graph, effectiveGhosts /* and filters */);

  // Transitions (only during animation)
  if (animationActive) {
    const transitions = computeTransitions(cacheRef.current, prevCursorRef.current, cursorTime);
    for (const id of transitions.materializing) startGhostCrossFade(`ghost:${id}`, 200);
    for (const id of transitions.cancelling) startGhostCrossFade(`ghost:${id}`, 200);
  }
  prevCursorRef.current = cursorTime;
  sigmaRef.current?.refresh();
}, [cursorTime, lockGhostsToHead, animationActive, showGhosts, repoName]);
```

If `cursorTime` or HEAD-date sources don't exist with exactly those names, the implementer adapts to the actual `useAppState` shape (Timeline cursor state was added by Timeline-zoom Phase 1).

Commit: `feat(augmented-timeline): GraphCanvas time-aware ghosts + cross-fade trigger`.

---

## Section E — E2E + docs (Tasks 7-8)

### Task 7: E2E + ROADMAP + INVENTORY + tests/README

**Files:**
- Create: `tests/e2e/specs/07-augmented-timeline.spec.ts`
- Modify: `ROADMAP.md` (next row)
- Modify: `INVENTORY.md` (new sub-section under Partie B)
- Modify: `tests/README.md` (4 new rows)

E2E :
```ts
import { test, expect } from '@playwright/test';

test.describe('Augmented Timeline', () => {
  test('scrub timeline → ghosts change (or skip if no snapshots)', async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.locator('[data-testid="graph-canvas"]').waitFor();
    // Activate showGhosts toggle
    const showGhosts = page.locator('text=Show ghosts').first();
    await showGhosts.click();
    // Find Timeline slider — if no snapshots, skip
    const slider = page.locator('[data-testid="timeline-slider"]');
    if (await slider.count() === 0) test.skip(true, 'No timeline slider');
    // Drag to first position
    await slider.dragTo(slider, { targetPosition: { x: 5, y: 5 } });
    // Wait a tick, assert ghosts container still renders
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="graph-canvas"]')).toBeVisible();
  });

  test('Animate roadmap button triggers play (or skip)', async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.locator('[data-testid="graph-canvas"]').waitFor();
    const btn = page.locator('[data-testid="animate-roadmap-button"]');
    if (await btn.count() === 0) test.skip(true, 'No Animate button — fixture has no snapshots');
    await btn.click();
    await expect(page.locator('text=Animating roadmap')).toBeVisible({ timeout: 2000 });
  });
});
```

ROADMAP row (next available number — check `grep "^| 4" ROADMAP.md | tail -3`):

```
| <N> | **Roadmap predictive — Augmented Timeline** : Timeline existante devient **ghost-time-aware**. Cursor < HEAD → ghosts au snapshot le plus proche (closest-prior). 3 activation triggers : (1) auto-detect (default, cursor < HEAD ⇒ time-aware), (2) Lock toggle Filters "Lock ghosts to today's view", (3) Animate roadmap button Timeline (auto-cursor earliest + auto-play + ghost overlay). Cross-fade 200ms quand un ghost matérialise pendant Play. Pure frontend, snapshot ghosts cache parallel pool (50 max). 0 endpoint serveur (réutilise `/ghosts/at` du CORE). | `upstream/gitnexus-web/src/lib/augmented-timeline.ts`, `upstream/gitnexus-web/src/services/snapshot-ghosts-cache.ts`, `upstream/gitnexus-web/src/components/{Timeline,GraphCanvas,GhostFiltersSection}.tsx`, `upstream/gitnexus-web/src/hooks/{useSigma,useAppState}.tsx` |
```

Update "Dernière mise à jour" at the top.

INVENTORY sub-section (under Partie B) :
```
#### Roadmap-predictive Augmented Timeline (Tier 3.x, 2026-05-27)
- `upstream/gitnexus-web/src/lib/augmented-timeline.ts` — `selectGhostsAt` (closest-prior), `computeTransitions` (Play cross-fade), `resolveAugmentedTimelineMode` (auto-detect).
- `upstream/gitnexus-web/src/services/snapshot-ghosts-cache.ts` — parallel pool fetch des `<repo>/snapshot/<sha>/ghosts.json` via `/ghosts/at` CORE endpoint, Map<sha, ghosts> cache 30s TTL, cap 50 snapshots.
- `upstream/gitnexus-web/src/components/Timeline.tsx` — bouton "Animate roadmap" 🎬 (auto-cursor earliest + auto-play + setAnimationActive true), banner pendant l'animation.
- `upstream/gitnexus-web/src/components/GhostFiltersSection.tsx` — toggle "Lock ghosts to today's view" sous `Show ghosts`.
- `upstream/gitnexus-web/src/components/GraphCanvas.tsx` — useEffect mode-resolution + cross-fade trigger via useSigma opacityOverride.
- `upstream/gitnexus-web/src/hooks/{useSigma,useAppState}.tsx` — opacityOverride Map + lockGhostsToHead + animationActive.
- **Réutilise 100%** des sidecars CORE existants (`/ghosts/at?repo=&commit=`). Aucun endpoint serveur nouveau.
```

tests/README new rows :
```
| Augmented timeline | unit/augmented-timeline.test.mjs | selectGhostsAt + computeTransitions + resolveMode |
| Snapshot ghosts cache | unit/snapshot-ghosts-cache.test.mjs | parallel pool + TTL + cap 50 + abort |
| Timeline Animate button | unit/components/Timeline.augmented.test.tsx | button click + banner + state |
| E2E Augmented Timeline | e2e/specs/07-augmented-timeline.spec.ts | scrub + Animate button |
```

Run `node scripts/check-test-inventory.mjs` → exits 0.

Commit: `docs+test: Augmented Timeline shipped (E2E + ROADMAP + INVENTORY + tests/README)`.

---

### Task 8: Append Update — Shipped to spec

```
---

## Update 2026-05-27 — Shipped

Augmented Timeline livré. Notes :
- 3 pure fns (`selectGhostsAt`, `computeTransitions`, `resolveAugmentedTimelineMode`) + snapshot ghosts cache (parallel pool).
- 3 activation triggers fonctionnels : auto-detect (cursor < HEAD - 60s), Lock toggle (Filters), Animate button (Timeline).
- Cross-fade 200ms via `useSigma.opacityOverride` + rAF loop pendant Play uniquement (hard swap au drag manuel pour ne pas freezer).
- Cap 50 snapshots (cost ~2s pre-fetch initial), TTL 30s.
- Aucun endpoint serveur ajouté — pure réutilisation `/ghosts/at` du CORE.
- Tests : 2 unit + 1 component + 1 e2e. Runtime local Node 21 bloqué (vitest 4.x), CI Node 22.
- **Dernier item IDEAS-PARKING-roadmap-predictive.md** — clôture la série (8 sous-specs + 1 CORE + bonus SysML).

### Limitations connues

1. Skew tolerance "current" = 60s. Sub-1-min snapshots déclencheraient time-aware par erreur.
2. Cap 50 snapshots — repos plus longs voient seulement les 50 derniers en mode time-aware.
3. Cluster halos PAS time-aware en v1 (toujours latest). Future si demandé.
4. Animation playback position non persistante entre sessions.
```

Commit: `docs(spec): append Update — Shipped on roadmap-predictive Augmented Timeline`.

---

## Final validation

- [ ] `git log --pretty=format:"%ae" --since=...` → `roblastar@live.fr` only.
- [ ] `node scripts/check-test-inventory.mjs` exits 0.
- [ ] `patches/upstream-all.diff` contains the new frontend files.
- [ ] 3 triggers fonctionnent : auto-detect on cursor move, Lock toggle, Animate button.

---

## Self-Review

**Spec coverage** : §3.2 pure fns (T1), §3.2 cache (T2), §3.2 cross-fade (T3), §3.2 Animate button (T4), §3.2 Lock toggle (T5), §3.2 integration (T6), §3.2 tests (T1-T7), §4 out-of-scope respected.

**Placeholder scan** : Tasks 3 (rAF loop) et 6 (mode integration) référencent du code existant (`useSigma`, `lastFetchedGhostsRef`, `timelineCursorDate`) — l'implémenteur adapte aux noms réels (Timeline-zoom Phase 1 a introduit la cursor state mais shape exacte à vérifier).

**Type consistency** : `SnapshotGhosts` shape consistent entre Tasks 1, 2, 6. `GhostInput` réutilisé depuis `ghost-layout.ts`.

**Known risks** :
- Task 6 dépend du shape exact de `useAppState.timelineCursorDate` (Timeline-zoom Phase 1). L'implémenteur lit le fichier en premier.
- Task 3 rAF loop : ne pas multiplier les loops (une seule loop gère toutes les transitions actives).
- Si `/snapshots?repo=` ne retourne pas `commit.date` dans `commit.shortHash`, adapter au shape réel (vérifier dans `docker-server-snapshots.mjs`).

---

**Plan complete. Execution: subagent-driven-development.**
