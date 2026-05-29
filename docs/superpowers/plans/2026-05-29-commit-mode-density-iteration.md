# Commit-mode density iteration (#1 #2 #4 #6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Make Commits-mode usable at any history size: window-filter + thin the dots so they're clickable (#1+#2), seed the baseline at the window's oldest commit so a whole era is navigable from one seed (#4), and surface pre-warm progress (#6).

**Architecture:** All frontend (`Timeline.tsx` + one `useAppState` signature tweak). Commit dots are filtered to the effective zoom window `[a,b]` and even-spaced (reusing the existing `effectiveWindow`/`positionFor` machinery); over a density cap they're evenly **sampled** (wheel-zoom narrows the window → reveals the rest). The Seed-baseline button anchors at the window's oldest commit. A small chip polls `GET /snapshot/prewarm`. Backend unchanged.

**Parent spec:** [2026-05-28-commit-level-time-travel-design.md](../specs/2026-05-28-commit-level-time-travel-design.md) → `## Update 2026-05-29` (this iteration). Refines the shipped A/B/C.

## Notes d'environnement (identiques)
- PowerShell shell → **Bash tool** for `&&`. `upstream/` gitignored → patch via the **split scheme** (`--diff-filter=A → additive-files.diff`, `--diff-filter=M → inplace-edits.diff`); `Timeline.tsx`/`useAppState.tsx` are *added* files → `additive-files.diff`. Commit tracked test files only per-task.
- Docker for build + smoke; **Playwright** re-verify (chromium installed). Host vitest blocked (Node 21<22) — component test written, executed later.

## Design simplification vs spec note
The spec #1 mentioned a "+N cluster" dot. This plan ships the simpler **cap + even-sample + lean on the existing wheel-zoom** (the wheel-zoom IS the "drill into the segment" mechanism — scrolling narrows `[cursorA,cursorB]` → fewer windowed commits → individual dots). Same goal (no overlap, everything reachable via zoom), less new surface. The spec `## Update` will be tweaked to say so at ship time.

---

### Task 1 : useAppState — `seedBaseline(baselineSha, retrySha?)`

**Files:** Modify `upstream/gitnexus-web/src/hooks/useAppState.tsx`

- [ ] **Step 1** — Interface: change
```tsx
  seedBaseline: (sha: string) => Promise<void>;
```
to
```tsx
  // baselineSha = where to seed the hidden baseline (window-oldest, #4);
  // retrySha = the commit to reconstruct after the seed (defaults to baselineSha).
  seedBaseline: (baselineSha: string, retrySha?: string) => Promise<void>;
```

- [ ] **Step 2** — Implementation: change the callback signature + the final retry. Replace
```tsx
  const seedBaseline = useCallback(
    async (sha: string) => {
      if (!projectName) return;
      const baseRepo = projectName.split('@')[0];
```
with
```tsx
  const seedBaseline = useCallback(
    async (baselineSha: string, retrySha?: string) => {
      if (!projectName) return;
      const baseRepo = projectName.split('@')[0];
```
and the two uses of `sha` inside: the POST uses `baselineSha`, the final retry uses `retrySha ?? baselineSha`. Specifically:
- `...&commit=${encodeURIComponent(sha)}` → `...&commit=${encodeURIComponent(baselineSha)}`
- `await loadGraphAtCommit(sha);` → `await loadGraphAtCommit(retrySha ?? baselineSha);`

- [ ] **Step 3** — Commit (signature only; behavior verified via build + Playwright):
```bash
git commit --allow-empty -m "feat(timeline): seedBaseline accepts (baselineSha, retrySha) for era-anchored seeding (Task 1)"
```
*(useAppState.tsx is an added file → captured in additive-files.diff at Task 5.)*

---

### Task 2 : Timeline — window-filter + density cap for commit dots (#1+#2)

**Files:** Modify `upstream/gitnexus-web/src/components/Timeline.tsx`

- [ ] **Step 1** — Add a constant near the top of the component (after the other consts):
```tsx
  // Max commit dots before we evenly-sample (wheel-zoom reveals the rest).
  const MAX_COMMIT_DOTS = 60;
```

- [ ] **Step 2** — After the `commits` state + the `effectiveWindow` memo, add the windowing/sampling memos:
```tsx
  // Commits restricted to the effective zoom window (else full commit range),
  // mirroring visiblePoints for snapshots (#1+#2). commits are newest-first.
  const windowedCommits = useMemo(() => {
    if (commits.length === 0) return commits;
    const win = effectiveWindow ?? { a: commits[commits.length - 1].date, b: commits[0].date };
    const aMs = Date.parse(win.a);
    const bMs = Date.parse(win.b);
    return commits.filter((c) => {
      const t = Date.parse(c.date);
      return t >= aMs && t <= bMs;
    });
  }, [commits, effectiveWindow]);

  // If the window still holds more commits than the bar can show without
  // overlap, evenly sample down to MAX_COMMIT_DOTS. Zooming (wheel) narrows
  // the window → fewer windowedCommits → individual dots reappear.
  const commitOverflow = windowedCommits.length > MAX_COMMIT_DOTS;
  const renderedCommits = useMemo(() => {
    if (!commitOverflow) return windowedCommits;
    const step = (windowedCommits.length - 1) / (MAX_COMMIT_DOTS - 1);
    const picked = [];
    const seen = new Set();
    for (let i = 0; i < MAX_COMMIT_DOTS; i++) {
      const c = windowedCommits[Math.round(i * step)];
      if (c && !seen.has(c.hash)) {
        seen.add(c.hash);
        picked.push(c);
      }
    }
    return picked;
  }, [windowedCommits, commitOverflow]);
```

- [ ] **Step 3** — Change the commit-dots render to iterate `renderedCommits` and even-space over it. Replace the block opener
```tsx
        {navMode === 'commits' && commits.map((c, i) => {
          const isActive = atCommitActive && atCommitSha === c.hash;
          // commits newest-first → on place le plus récent à droite (100%).
          const left = commits.length === 1 ? 50 : (1 - i / (commits.length - 1)) * 100;
```
with
```tsx
        {navMode === 'commits' && renderedCommits.map((c, i) => {
          const isActive = atCommitActive && atCommitSha === c.hash;
          // commits newest-first → on place le plus récent à droite (100%).
          const left = renderedCommits.length === 1 ? 50 : (1 - i / (renderedCommits.length - 1)) * 100;
```

- [ ] **Step 4** — Add an overflow hint. Right after the commit-dots `})}` (inside the bar, before `</div>` closing the bar), add:
```tsx
        {navMode === 'commits' && commitOverflow && (
          <div
            data-testid="commit-density-hint"
            className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-deep/80 px-1.5 py-0.5 text-[9px] text-text-muted"
          >
            {windowedCommits.length} commits · molette pour zoomer
          </div>
        )}
```

- [ ] **Step 5** — Commit (test file follows in Task 5):
```bash
git commit --allow-empty -m "feat(timeline): window-filter + density-cap commit dots; wheel-zoom thins them (#1+#2) (Task 2)"
```

---

### Task 3 : Timeline — seed baseline at window-oldest (#4)

**Files:** Modify `upstream/gitnexus-web/src/components/Timeline.tsx`

- [ ] **Step 1** — The Seed-baseline button onClick currently:
```tsx
            onClick={() => clickedCommit && seedBaseline(clickedCommit)}
```
Change to seed at the **oldest commit in the window** while reconstructing the clicked commit:
```tsx
            onClick={() => {
              // #4: anchor the baseline at the window's oldest commit so the
              // whole visible window becomes navigable from one seed; then
              // reconstruct the commit the user actually clicked.
              const oldest = windowedCommits[windowedCommits.length - 1];
              if (clickedCommit && oldest) seedBaseline(oldest.hash, clickedCommit);
            }}
```

- [ ] **Step 2** — Commit:
```bash
git commit --allow-empty -m "feat(timeline): seed baseline at window-oldest commit, reconstruct the clicked one (#4) (Task 3)"
```

---

### Task 4 : Timeline — pre-warm feedback chip (#6)

**Files:** Modify `upstream/gitnexus-web/src/components/Timeline.tsx`

- [ ] **Step 1** — Add state near `commitsError`:
```tsx
  const [prewarm, setPrewarm] = useState<{ warm: number; total: number } | null>(null);
```

- [ ] **Step 2** — Add a poll effect after the `/commits` fetch effect:
```tsx
  // Pre-warm progress (#6): poll GET /snapshot/prewarm while in Commits mode.
  // Light cadence (5s) only while there are cold diffs; stops when all warm.
  useEffect(() => {
    if (navMode !== 'commits' || !baseRepo) {
      setPrewarm(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const r = await fetch(`/snapshot/prewarm?repo=${encodeURIComponent(baseRepo)}&max=200`, {
          cache: 'no-store',
        });
        if (r.ok) {
          const d = await r.json();
          if (cancelled) return;
          setPrewarm({ warm: d.warm ?? 0, total: d.total ?? 0 });
          if ((d.cold ?? 0) > 0) timer = setTimeout(poll, 5000);
        }
      } catch {
        /* best-effort */
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [navMode, baseRepo, commits]);
```

- [ ] **Step 3** — Render the chip next to the nav-mode toggle (right after the `</div>` closing `timeline-navmode-toggle`):
```tsx
      {navMode === 'commits' && prewarm && prewarm.total > 0 && (
        <span
          data-testid="prewarm-status"
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${
            prewarm.warm >= prewarm.total
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-amber-500/15 text-amber-300'
          }`}
          title="Diffs incrémentaux pré-chauffés (clic instantané) sur les derniers commits"
        >
          {prewarm.warm}/{prewarm.total} chauds
        </span>
      )}
```

- [ ] **Step 4** — Commit:
```bash
git commit --allow-empty -m "feat(timeline): pre-warm warm/total chip in Commits mode (#6) (Task 4)"
```

---

### Task 5 : Component tests, build, Playwright re-verify, docs, patch

**Files:** Modify `tests/unit/components/Timeline.commits.test.tsx` ; docs ; patches

- [ ] **Step 1** — Update/extend the component test. The existing "renders one dot per commit" test mocks 2 commits (< MAX_COMMIT_DOTS) so it still passes (renderedCommits === all). Add a density case + a prewarm case:
```tsx
  it('density-caps commit dots and shows a hint when over MAX_COMMIT_DOTS', async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({
      hash: `h${i}`, shortHash: `h${i}`, message: `c${i}`, author: 'a',
      date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString(),
    }));
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('/snapshots')) return { ok: true, json: async () => ({ snapshots: [
        { name: 'demo@a', key: 'demo@a', commit: { shortHash: 'a', message: 'm', author: 'a', date: '2026-01-01T00:00:00Z' } },
        { name: 'demo@b', key: 'demo@b', commit: { shortHash: 'b', message: 'm', author: 'a', date: '2026-06-01T00:00:00Z' } },
      ] }) };
      if (u.startsWith('/commits')) return { ok: true, json: async () => ({ commits: many, truncated: false }) };
      if (u.startsWith('/snapshot/prewarm')) return { ok: true, json: async () => ({ total: 130, warm: 40, cold: 90 }) };
      return { ok: true, json: async () => ({}) };
    });
    render(<Timeline />);
    fireEvent.click(await screen.findByTestId('navmode-commits'));
    await waitFor(() => expect(screen.getByTestId('commit-density-hint')).toBeInTheDocument());
    expect(screen.getAllByTestId('commit-dot').length).toBeLessThanOrEqual(60);
    expect(screen.getByTestId('prewarm-status').textContent).toMatch(/40\/130/);
  });
```
*(Keep the existing tests; the 2-commit fetch mock in `beforeEach` still drives them. This new test overrides fetch locally.)*

- [ ] **Step 2** — Build: `cd /c/Users/rdenis/VScode/gitnexus && docker compose build gitnexus-web` → exit 0 ; `docker compose up -d gitnexus-web`.

- [ ] **Step 3** — Playwright re-verify (reuse the driver pattern from the prior verify): navigate `:4173/?server=http://localhost:4747&project=hmm_studio`, enter Commits mode, assert `commit-dot` count ≤ 60 + `commit-density-hint` present + `prewarm-status` present; screenshot. Confirm dots are now individually clickable (no force needed for a spaced dot).

- [ ] **Step 4** — Docs: tweak the spec `## Update 2026-05-29` #1 note (cap+sample+wheel-zoom, not "+N cluster"). No new endpoint → no smoke-loop change. INVENTORY: note the Commits-mode density/window + prewarm chip refinement under the existing time-travel rows (1 line).

- [ ] **Step 5** — Regen patches (split scheme) + verify:
```bash
cd /c/Users/rdenis/VScode/gitnexus
git -C upstream add -N .
git -C upstream diff HEAD --diff-filter=A > patches/additive-files.diff
git -C upstream diff HEAD --diff-filter=M > patches/inplace-edits.diff
git -C upstream diff HEAD > patches/upstream-all.diff
git -C upstream reset
```
Verify: `grep -c 'Binary files' patches/additive-files.diff` = 0 ; `grep -c 'MAX_COMMIT_DOTS' patches/additive-files.diff` ≥ 1 (Timeline.tsx is additive).

- [ ] **Step 6** — Commit:
```bash
git add tests/unit/components/Timeline.commits.test.tsx docs/superpowers/specs/2026-05-28-commit-level-time-travel-design.md INVENTORY.md patches/additive-files.diff patches/inplace-edits.diff patches/upstream-all.diff
git commit -m "feat(timeline): commit-mode density/window + era-baseline anchor + prewarm chip (#1#2#4#6)"
```

---

## Self-Review
- **#1+#2**: `windowedCommits` (effectiveWindow filter) + `renderedCommits` (cap 60, even-sample) + even-spacing over rendered set + overflow hint. Wheel-zoom (updates effectiveWindow) thins them. ✅
- **#4**: seed button anchors at `windowedCommits[last]` (oldest), reconstructs `clickedCommit` via `seedBaseline(oldest, clicked)`. ✅
- **#6**: poll `GET /snapshot/prewarm` → `prewarm-status` chip. ✅
- **Consistency**: `seedBaseline(baselineSha, retrySha?)` signature ↔ interface ↔ call site. `renderedCommits`/`windowedCommits`/`commitOverflow` names consistent. data-testids `commit-density-hint`/`prewarm-status` test↔impl.
- **No placeholders.** `--allow-empty` per-task commits intentional (upstream code rides in additive-files.diff at Task 5; Timeline.tsx + useAppState.tsx are added files).
- **Verification**: Docker build + Playwright (host vitest Node-22-blocked). The density fix is itself verifiable in-browser (dot count ≤ 60, clickable).
- **Hors scope**: #3/#5/#7/#8 unchanged.
