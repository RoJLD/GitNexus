# Regression Forensics Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Add a `coupling` watch evaluator + mapping so coupling regressions can be watched AND auto-fire the culprit (6 metrics). (B) A "Locate regression" button in `EntropyCommitTimeline` that calls `/regression` for the active entropy metric, shows a culprit banner, rings the worst commit's bar, and clicks through to the existing drill-down.

**Architecture:** Part A = tiny backend addition to `docker-server-watches.mjs` (one evaluator + one mapping line; everything else reuses the Tier-59 auto-forensics wiring). Part B = additive frontend in `EntropyCommitTimeline.tsx` (local state, one header button, one banner, one conditional bar ring, click-through to the existing `setSelected` drill-down). Entropy-scoped.

**Tech Stack:** Node zéro-dep (watches), React + TS, Vitest 4 (unit), Playwright (e2e).

**Spec source:** [`docs/superpowers/specs/2026-05-29-regression-forensics-polish-design.md`](../specs/2026-05-29-regression-forensics-polish-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

---

## Environment notes

**Node 21** : vitest crashe (rolldown). Tests committés "blind", CI Node 22 valide. `npm run test:unit` peut crasher → ATTENDU.

**Patches/upstream-all.diff** : UTF-16 LE + CRLF via PowerShell `Out-File -Encoding Unicode`. Regen à chaque tâche touchant `upstream/` :

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
```

**Parallel session** : `docker-server-watches.mjs` + `EntropyCommitTimeline.tsx` sont chauds. Committer vite. Avant chaque commit : `git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null`. Ne JAMAIS committer : `.claude/`, `AGENTS.md`, `roadmap.yml`, `tests/package-lock.json`.

**Git identity** : déjà `roblastar@live.fr`.

**Verified anchors (controller):**
- `docker-server-watches.mjs`: `METRIC_EVALUATORS` is a const map of `metric → async (repo, webBase) => { ok, value }|{ ok:false, error }` (5 entries: entropy.density/modularity, ownership.busFactor/topAuthorShare, dissonance.purity, each using `fetchJson`). `mapWatchToRegressionMetric` (Tier 59) has a `MAP` object returning the regression metric or null (currently coupling absent → null).
- `tests/unit/auto-regression-forensics.test.mjs`: has `it('returns null for unmapped metrics (coupling, custom)', ...)` asserting `mapWatchToRegressionMetric('coupling')` → null.
- `EntropyCommitTimeline.tsx`: header strip (~lines 150-207) holds the metric toggle (`['density','modularity'].map`) + window input + an `X` exit button (`ml-auto`). Bars: the attributed commits render as SVG `<rect>` via `attributed.map(...)` (after ~line 250), each with `onClick={() => setSelected(c)}`. Local state block (~line 83): `metric`, `selected`, `copiedSha`. `fieldFor`/`colorFor` (~123-132). The component reads `/regression` is NOT yet imported (uses `fetch` directly elsewhere? — it uses useAppState actions; for the new call use `fetch('/regression?...')` directly).

---

## File Structure

| Path | Rôle | Tâche |
|---|---|---|
| `upstream/docker-server-watches.mjs` | MOD — coupling evaluator + mapping | T1 |
| `tests/unit/auto-regression-forensics.test.mjs` | MOD — coupling map null→'coupling' | T1 |
| `upstream/gitnexus-web/src/components/EntropyCommitTimeline.tsx` | MOD — state + button + fetch + banner (T2) ; bar ring + clear-on-toggle + click-through (T3) | T2, T3 |
| `tests/e2e/specs/regression-highlight.spec.ts` | NEW | T4 |
| `ROADMAP.md` / `INVENTORY.md` / `tests/README.md` / `CLAUDE.md` | docs | T5 |

---

## Task 1: Coupling watch evaluator + mapping + test update

**Files:**
- Modify: `upstream/docker-server-watches.mjs`
- Modify: `tests/unit/auto-regression-forensics.test.mjs`

- [ ] **Step 1: Update the failing test**

In `tests/unit/auto-regression-forensics.test.mjs`, find:

```javascript
  it('returns null for unmapped metrics (coupling, custom)', () => {
    expect(mapWatchToRegressionMetric('coupling')).toBeNull();
    expect(mapWatchToRegressionMetric('something.custom')).toBeNull();
  });
```

Replace it with (coupling now maps; only truly-unknown → null):

```javascript
  it('maps coupling to itself (Tier 60)', () => {
    expect(mapWatchToRegressionMetric('coupling')).toBe('coupling');
  });
  it('returns null for genuinely unknown metrics', () => {
    expect(mapWatchToRegressionMetric('something.custom')).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests; npm run test:unit -- auto-regression-forensics`
Expected: FAIL (coupling still → null) or Node 21 crash — proceed.

- [ ] **Step 3: Add the coupling evaluator**

In `docker-server-watches.mjs`, find the `METRIC_EVALUATORS` const. After the `'dissonance.purity'` evaluator entry (the last one), add a `coupling` entry (mirroring the others' shape):

```javascript
  coupling: async (repo, webBase) => {
    const r = await fetchJson(`${webBase}/coupling?repo=${encodeURIComponent(repo)}`);
    if (!r.ok) return r;
    if (typeof r.body?.pairsAboveThreshold !== 'number') return { ok: false, error: 'no pairsAboveThreshold' };
    return { ok: true, value: r.body.pairsAboveThreshold };
  },
```

- [ ] **Step 4: Add `coupling` to the regression mapping**

In `mapWatchToRegressionMetric`, find the `MAP` object and add `coupling: 'coupling',` to it (alongside the existing entries):

```javascript
  const MAP = {
    'entropy.density': 'density',
    'entropy.modularity': 'modularity',
    'ownership.busFactor': 'ownership.busFactor',
    'ownership.topAuthorShare': 'ownership.topAuthorShare',
    'dissonance.purity': 'dissonance.purity',
    coupling: 'coupling',
  };
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd tests; npm run test:unit -- auto-regression-forensics`
Expected: PASS or Node 21 crash — proceed.

- [ ] **Step 6: Syntax-check + regen + commit**

```
node --check upstream/docker-server-watches.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff tests/unit/auto-regression-forensics.test.mjs
git commit -m "feat(auto-forensics): coupling watch evaluator + coupling→coupling mapping (6th watchable metric) (Task 1)"
```

---

## Task 2: `EntropyCommitTimeline` — state + button + fetch + banner

**Files:**
- Modify: `upstream/gitnexus-web/src/components/EntropyCommitTimeline.tsx`

- [ ] **Step 1: Add local state + the verdict type**

Near the top of the component (after the existing `const [copiedSha, setCopiedSha] = useState<string | null>(null);` ~line 85), add:

```tsx
  const [regressionVerdict, setRegressionVerdict] = useState<{
    regressed: boolean;
    attribution: string;
    netDelta: number;
    worstCommit: { sha: string; shortSha?: string; author?: string; filesTouched?: number; files?: unknown[] } | null;
  } | null>(null);
  const [regressionLoading, setRegressionLoading] = useState(false);
  const [regressionError, setRegressionError] = useState<string | null>(null);

  const locateRegression = async () => {
    setRegressionLoading(true);
    setRegressionError(null);
    setRegressionVerdict(null);
    try {
      const res = await fetch(`/regression?repo=${encodeURIComponent(projectName.split('@')[0])}&metric=${encodeURIComponent(metric)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRegressionVerdict(await res.json());
    } catch (e) {
      setRegressionError(e instanceof Error ? e.message : 'failed to locate regression');
    } finally {
      setRegressionLoading(false);
    }
  };
```

(`metric` and `projectName` are already in scope. `fetch('/regression?...')` hits our own web server — same-origin.)

- [ ] **Step 2: Add the "Locate regression" button to the header**

In the header strip, after the metric-toggle `<div className="ml-2 flex gap-0.5 rounded bg-elevated p-0.5">…</div>` block (the one mapping `['density','modularity']`), add a button:

```tsx
        <button
          type="button"
          onClick={locateRegression}
          disabled={regressionLoading}
          className="ml-2 cursor-pointer rounded border border-border-default px-1.5 py-0 text-[9px] font-medium text-text-muted transition-all hover:text-text-primary disabled:opacity-50"
          title="Locate the commit that caused a regression on the active metric"
          data-testid="locate-regression"
        >
          {regressionLoading ? 'Locating…' : 'Locate regression'}
        </button>
```

- [ ] **Step 3: Add the banner (below the header div, near the error/warning blocks)**

After the existing `{entropyCommitsError && (…)}` block (~line 215) — or right after the header `</div>` — add a regression banner:

```tsx
      {/* Regression highlight banner (Tier 60) */}
      {regressionError && (
        <div className="flex items-start gap-1.5 px-1 py-1 text-[10px] text-red-400" data-testid="regression-banner">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="font-mono">regression: {regressionError}</span>
        </div>
      )}
      {regressionVerdict && (
        <div className="flex items-center gap-1.5 px-1 py-1 text-[10px]" data-testid="regression-banner">
          {regressionVerdict.worstCommit ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const wc = regressionVerdict.worstCommit;
                  if (!wc) return;
                  const hit = (entropyCommitsData?.commits || []).find((c) => c.sha === wc.sha);
                  if (hit) setSelected(hit);
                }}
                className="cursor-pointer rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200 hover:bg-amber-500/25"
                title="Open this commit in the drill-down"
              >
                Regression: {regressionVerdict.worstCommit.shortSha || regressionVerdict.worstCommit.sha.slice(0, 7)} by{' '}
                {regressionVerdict.worstCommit.author || 'unknown'} (
                {regressionVerdict.worstCommit.filesTouched ?? regressionVerdict.worstCommit.files?.length ?? 0} files) · net{' '}
                {regressionVerdict.netDelta > 0 ? '+' : ''}{regressionVerdict.netDelta.toExponential(2)} [{regressionVerdict.attribution}]
              </button>
            </>
          ) : (
            <span className="text-text-muted">No clear regression on {metric}.</span>
          )}
          <button
            type="button"
            onClick={() => setRegressionVerdict(null)}
            className="ml-1 cursor-pointer rounded p-0.5 text-text-muted hover:text-text-primary"
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
```

(`X`, `AlertCircle` are already imported. `entropyCommitsData` + `setSelected` are in scope.)

- [ ] **Step 4: Regen + commit**

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(regression-ui): Locate regression button + culprit banner in EntropyCommitTimeline (Task 2)"
```

---

## Task 3: Bar culprit ring + clear-on-metric-toggle

**Files:**
- Modify: `upstream/gitnexus-web/src/components/EntropyCommitTimeline.tsx`

- [ ] **Step 1: Clear the verdict when the metric toggles**

The verdict is computed for a specific metric; toggling must not leave a stale highlight. Find the metric-toggle button `onClick={() => setMetric(m)}` and change it to also clear the verdict:

```tsx
              onClick={() => { setMetric(m); setRegressionVerdict(null); setRegressionError(null); }}
```

- [ ] **Step 2: Ring the culprit bar**

Read the attributed-bars render (the `attributed.map((c) => …)` returning an SVG `<rect>` for each commit, after ~line 250). Each `<rect>` has an `onClick={() => setSelected(c)}` and some className/stroke. Add a culprit ring: when `regressionVerdict?.worstCommit?.sha === c.sha`, give the rect a distinct stroke. Locate the `<rect ... />` and add (merging with any existing `stroke`/`className`):

```tsx
                stroke={regressionVerdict?.worstCommit?.sha === c.sha ? '#fbbf24' : undefined}
                strokeWidth={regressionVerdict?.worstCommit?.sha === c.sha ? 2 : undefined}
```

If the rect already has a `stroke`/`strokeWidth` (e.g. for the `selected` state), combine: prefer the culprit amber ring when it's the culprit, else the existing behavior. Read the current rect attributes first and adapt so both `selected` (cyan) and `culprit` (amber) can show (culprit ring is fine to take precedence). Keep it minimal — a conditional `stroke` is enough.

- [ ] **Step 3: Regen + commit**

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(regression-ui): ring the culprit bar + clear verdict on metric toggle (Task 3)"
```

---

## Task 4: E2E test

**Files:**
- Create: `tests/e2e/specs/regression-highlight.spec.ts`

- [ ] **Step 1: Study a neighbor spec's setup**

Read `tests/e2e/specs/timeline-temporal-filter.spec.ts` (or `timeline-zoom-and-diff.spec.ts`) for the `beforeEach` (goto + waitForSelector). Note how the Timeline's mode toggles are clicked (the "Commit Δ" / Activity toggle that turns on the entropy-commits sparkline).

- [ ] **Step 2: Write the spec**

Create `tests/e2e/specs/regression-highlight.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Regression highlight in EntropyCommitTimeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
  });

  test('Locate regression fires /regression and shows the banner', async ({ page }) => {
    // Turn on the commit-entropy sparkline (the Activity / "Commit Δ" toggle in the Timeline).
    // The toggle button has an Activity icon; click by its title/aria if present, else by role.
    const toggle = page.getByRole('button', { name: /commit.*Δ|commit entropy|activity/i }).first();
    await toggle.click().catch(() => { /* may already be on, or named differently */ });

    // Wait for the Locate regression button (only present when the sparkline is mounted).
    const locate = page.getByTestId('locate-regression');
    await expect(locate).toBeVisible({ timeout: 30_000 });

    const reqPromise = page.waitForRequest(/\/regression\?.*metric=(density|modularity)/, { timeout: 15_000 });
    await locate.click();
    const req = await reqPromise;
    expect(req.url()).toMatch(/\/regression\?/);

    // The banner appears (culprit or "no clear regression").
    await expect(page.getByTestId('regression-banner')).toBeVisible({ timeout: 15_000 });
  });
});
```

(If the entropy-commits toggle can't be reliably located by name, adapt the selector after reading the Timeline's toggle button — it uses the `Activity` lucide icon; you may add/confirm a `data-testid` on that toggle in the Timeline if needed, but prefer not to expand scope — a role/title selector should work.)

- [ ] **Step 3: Commit**

```
git add tests/e2e/specs/regression-highlight.spec.ts
git commit -m "test(e2e): regression highlight — Locate regression fires /regression + banner (Task 4)"
```

---

## Task 5: Docs + build validation + final commit

**Files:**
- Modify: `ROADMAP.md`, `INVENTORY.md`, `tests/README.md`, `CLAUDE.md`

- [ ] **Step 1: Build + smoke**

```
docker compose build gitnexus-web
docker compose up -d gitnexus gitnexus-web
```

Wait for the web server, then:

```
curl -s "http://localhost:4173/watches" | grep -o '"supportedMetrics":\[[^]]*\]'
curl -s -o /dev/null -w "regression coupling: HTTP %{http_code}\n" --max-time 90 "http://localhost:4173/regression?repo=hmm_studio&metric=coupling"
```

Expected: `supportedMetrics` now includes `"coupling"`; `/regression?metric=coupling` → 200. The UI button is validated by the Task 4 e2e (run separately if the e2e harness is up) + a manual click.

- [ ] **Step 2: CLAUDE.md note**

Near the `/watches` smoke line, update/append a note that `coupling` is now a watchable metric (6 total) and auto-forensiquable. (The `supportedMetrics` grep above is the check.)

- [ ] **Step 3: ROADMAP.md**

Add a "Déjà livré" row (`grep "^| 59 " ROADMAP.md` → next number):

```markdown
| 60 | **Regression forensics polish (coupling watch + UI highlight)** : (A) évaluateur watch `coupling` (`/coupling` → `pairsAboveThreshold`) + `coupling→coupling` dans le mapping auto-forensics ⇒ coupling devient la 6e métrique watchable ET auto-forensiquable. (B) bouton "Locate regression" dans `EntropyCommitTimeline` : appelle `/regression` pour la métrique entropy active, bannière coupable + ring de la barre du commit fautif + clic → drill-down existant. Entropy-scoped, state local. | `docker-server-watches.mjs` (évaluateur coupling + mapping), `EntropyCommitTimeline.tsx` (bouton + bannière + ring) |
```

In the enterprise table, on the "Auto regression forensics" ✅ row, note coupling now auto-forensiquable (the last optional follow-on done). Bump date header.

- [ ] **Step 4: INVENTORY.md**

`/watches` : 6 métriques supportées (coupling ajouté), auto-forensiquable. `EntropyCommitTimeline` : highlight regression (bouton Locate + bannière + ring).

- [ ] **Step 5: tests/README.md**

Note the e2e `regression-highlight.spec.ts` + the updated `auto-regression-forensics.test.mjs` (coupling now maps).

- [ ] **Step 6: Final commit**

```
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add ROADMAP.md INVENTORY.md tests/README.md CLAUDE.md
git commit -m "Regression forensics polish livré: ROADMAP #60/INVENTORY/CLAUDE/tests (Task 5)"
```

(No patch regen — Task 5 touches only top-level docs.)

---

## Self-Review

**Spec coverage:**
- ✅ Spec § 4.2 coupling evaluator + mapping → Task 1.
- ✅ Spec § 6 coupling test update (null→'coupling') → Task 1 Step 1.
- ✅ Spec § 4.3 state + button + fetch + banner → Task 2 ; bar ring + clear-on-toggle + click-through → Task 3.
- ✅ Spec § 5 edge cases (regression fail→error line ; regressed:false/no worstCommit→"No clear regression" ; culprit sha not rendered→banner, no ring, no drill-down [the `find` returns undefined → `setSelected` not called] ; metric toggle clears verdict) → Tasks 2+3 code.
- ✅ Spec § 6 e2e → Task 4 ; smoke supportedMetrics → Task 5.
- ✅ Spec § 10 docs → Task 5.

**Placeholder scan:**
- ✅ Full code for the evaluator, mapping, state, button, banner, test.
- ⚠️ Task 3 Step 2 uses a grep-anchored instruction for the SVG `<rect>` (can't quote the exact current rect attributes without re-reading; the precise conditional stroke is given + the rule to combine with any existing `selected` stroke). Task 4 adapts the entropy-commits toggle selector after reading the Timeline. Intentional.

**Type/contract consistency:**
- ✅ `regressionVerdict` shape (`{ regressed, attribution, netDelta, worstCommit:{sha,shortSha?,author?,filesTouched?,files?}|null }`) — declared Task 2, read in Task 2 banner + Task 3 ring (`regressionVerdict?.worstCommit?.sha`).
- ✅ `/regression?repo=&metric=<density|modularity>` — the button uses the active `metric` (entropy-only), matching what the component displays.
- ✅ `coupling` evaluator returns `{ ok, value: pairsAboveThreshold }` — matches the evaluator contract (`{ok,value}`), and `pairsAboveThreshold` is the field `/coupling` exposes (Tier 58).
- ✅ `mapWatchToRegressionMetric('coupling')` → `'coupling'` — Task 1 + the auto-forensics fetch (Tier 59) calls `/regression?metric=coupling` (valid, Tier 58).

**Scope:** small, 2 parts (backend tiny + frontend additive), 5 tasks, ~2-3 days. One plan.

Plan ready for execution.

---

## Effort summary

| Task | Estimate |
|---|---|
| 1. coupling evaluator + mapping + test | ~½j |
| 2. state + button + fetch + banner | ~¾j |
| 3. bar ring + clear-on-toggle | ~½j |
| 4. e2e | ~½j |
| 5. docs + build + smoke | ~½j |
| **Total** | **~2-3 jours** |
