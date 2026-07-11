# Upstream patches

Two diff files capture every modification we apply to the
[gitnexus/gitnexus](https://github.com/abhigyanpatwari/gitnexus)
repository (tag `v1.6.5`) for this deployment:

- **`additive-files.diff`** — ~132 new files we own entirely (measured
  2026-07-11). These never conflict with upstream changes because they are
  new files, not edits.
- **`inplace-edits.diff`** — 21 modified upstream files (measured 2026-07-11).
  This is the real conflict surface when bumping upstream.

We don't track `upstream/` itself in this repo — it's a working clone we
modify in place and use as the Docker build context. Tracking it would
include ~2500 vendored files we don't own. Instead, we serialize our
deltas here so the work is reproducible and reviewable.

## Apply on a fresh clone

```powershell
# From the repo root
git clone --depth 1 --branch v1.6.5 https://github.com/abhigyanpatwari/gitnexus.git upstream
cd upstream
git apply ../patches/additive-files.diff
git apply ../patches/inplace-edits.diff
# Verify
git status
```

`git apply` will fail loudly if upstream has drifted from the v1.6.5
baseline (e.g. you cloned a different tag, or upstream rewrote one of
the files we patch). When that happens, regenerate the diffs after
manually re-applying the changes — see "Regenerate the diffs" below.

## What's inside

~132 additive files (new files we own, in `additive-files.diff`) + 21
in-place edits to upstream files (the real conflict surface, in
`inplace-edits.diff`); zero deletions.

Key highlights:

- **`docker-server-routes.mjs`** (additive) — route registry shim that
  wires all our analytics routes into the upstream Express app. The
  route-wiring (imports + dispatch chain + cron start) that used to live
  inline in `docker-server.mjs` now lives here. The inline utility
  handlers `handleExport`/`handleImport`/`/listdir` remain in
  `docker-server.mjs` by design.
- **`docker-server-*.mjs`** (additive) — one file per analytics endpoint
  implementation.
- **`Dockerfile.web`** (in-place) — adds `git`, `zip`/`unzip`, runtime
  safety config, COPY blocks for our new modules.
- **`docker-server.mjs`** (in-place, footprint reduced) — a minimal shim
  that imports and calls `registerGitnexusRoutes` + `startGitnexusCron`
  from `docker-server-routes.mjs`.
- **`gitnexus-web/src/`** (mix of additive + in-place) — React/TypeScript
  additions (new panels, new services, new libs) plus in-place edits to
  `App.tsx`, `hooks/useAppState.tsx`, `hooks/useSigma.ts`, and other
  upstream components.
- **`gitnexus-web/package.json`** + **`package-lock.json`** (in-place) —
  new deps for the 3D graph mode and analytics panels.

## Regenerate the diffs

After you edit anything inside `upstream/`:

```powershell
# From the repo root
cd upstream
git add -N .                                              # so git diff includes new files
git diff HEAD --diff-filter=A > ../patches/additive-files.diff
git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff
git reset                                                  # un-stage the intent-to-add
```

Then commit both updated diff files from the repo root.

## Bump dry-run

Before bumping to a new upstream tag or branch, run the dry-run tool to
get a per-file conflict report without touching your working tree:

```powershell
node scripts/bump-upstream.mjs <tag-or-branch>
# e.g. node scripts/bump-upstream.mjs v1.7.0
#      node scripts/bump-upstream.mjs main
```

The tool clones the target upstream ref into a throwaway directory,
applies `additive-files.diff` (must be clean — fails loudly otherwise),
then attempts `inplace-edits.diff` with `git apply --3way`. It writes a
per-file report to `patches/bump-dry-run-<target>.md` showing each file
as **clean** / **conflict** / **fail**.

The first run against `main` is in
[`patches/bump-dry-run-main.md`](bump-dry-run-main.md): 107 clean /
0 conflict / 9 fail (the 9 in-place files that will need manual re-merge
for a future bump to `main`).

## Cohabitation contract

The durable contract for living alongside upstream is
[docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md](../docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md).
In short:

- **Tracking model:** flat split diffs (`additive-files.diff` + `inplace-edits.diff`),
  not a submodule/subtree — the dry-run shows the hard files fail even in `--3way`,
  so a different merge mechanism would not reduce the conflict surface.
- **Bump rule (conservative):** bump ONLY when a stable `v1.7.x+` release ships AND
  we need something from it. Never track `main`. `bump-upstream.mjs` is the go/no-go gate.
- **Bump playbook:** dry-run -> clone tag -> apply `additive-files.diff` (clean) ->
  `git apply --3way inplace-edits.diff` -> resolve the handful of fails -> rebuild +
  smoke loop + tests -> regenerate the two diffs -> bump version pins -> update docs.
- **Watch guards:**
  - `scripts/check-patch-drift.mjs` — internal drift: committed diffs vs the `upstream/`
    clone (run before committing upstream edits; exit 1 on drift).
  - `scripts/check-upstream-releases.mjs` — external drift: alerts (exit 10) when a
    newer stable upstream release exists than our pin.

L'outil générique multi-repo vit désormais dans le dépôt frère `fork-cohabitation` (CLI `cohabit`). Les 3 scripts `scripts/check-patch-drift.mjs` / `check-upstream-releases.mjs` / `bump-upstream.mjs` de gitnexus sont CONSERVÉS et GELÉS (référence autonome + oracle de parité) : toute évolution de leur logique va désormais dans `fork-cohabitation`. Consolidation (suppression au profit du seul outil central) conditionnée à l'onboarding d'un 2ᵉ repo. Voir le spec Phase 3 : `docs/superpowers/specs/2026-05-29-fork-cohabitation-extraction-design.md`.

## Recurrence-prevention (2026-06-03)

On **2026-05-31** the multigraph commit series (`dc32b89b..21a2be15`) regenerated
these diffs from a **partial/inconsistent `upstream/` clone**, gutting them
(`additive-files.diff` 914 KB → 5.6 KB, `inplace-edits.diff` 7722 → 102 lines).
The result: the patches no longer reproduced a building `gitnexus-web` frontend
(the infra files — `useAppState`/`backend-client`/`agent` — were dropped while
the components stayed). It went unnoticed because **every CI job was
`continue-on-error: true`** and the live deployment ran an old cached image.
Restored from the last-good commit `d2a9234a` on 2026-06-03.

**It recurred on 2026-07-07.** The `v1.6.5 → v1.6.7` bump series (through
`d7f88358 feat(web-bump): … regen inplace-edits.diff`) regenerated
`inplace-edits.diff` from an inconsistent clone again — gutting it to
**9 files / 591 lines**, dropping the same infra edits (`useAppState`
analytics props, `package.json` deps `three`/`umap-js`/`react-force-graph-3d`,
the `lucide-icons` shim). The clone was also left on `v1.6.7` while the pin
docs still said `v1.6.5`. Neither `v1.6.5` nor `v1.6.7` reapply produced a
building tree. Restored 2026-07-07 by reverting the clone to `v1.6.5` and
re-applying the last complete diffs from **`2ed93b73`** (17→18 in-place files,
8480 lines), then re-layering `graph-adapter` domainType colouring + the
`BackendRepo.family` field. The `gitnexus-web` image builds again.
**Re-applied against this v1.6.5 base (measured 2026-07-11):** the P0-5 wiki
prompt-injection guard landed — the original `fa647b88` targeted v1.6.7 wiki
files, so it was re-posed and its unit test repaired against v1.6.5 in
`16d9bfec` (`tests/unit/wiki-prompt-injection-guard.test.mjs`, green 3/3; the
guard ships inside `additive-files.diff`).
**Still deferred (re-pose at the v1.6.7 re-bump — verified absent from the
current diffs by grep):** the auto-fit camera edit (`f8c9eb91` — targeted a
`stopAllLayouts` that doesn't exist in v1.6.5) and the Header family-grouping
presentation. The multigraph layout (`e3337fd2`) was intentionally dropped
(abandoned UX).

**The 2026-07-07 recurrence proved the two guards below were not enforced
during the bump** — the local drift-guard passes when clone AND diffs are
gutted consistently, and the CI `build-gate` either didn't run or was still
`continue-on-error`. **Resolved 2026-07-11:** `build-gate` is now proven
red-on-gutting by two falsification canaries (a truncated `inplace-edits.diff`
turns `build-gate` red; a missing `Dockerfile.web` COPY turns `boot-smoke`
red), and `unit` + `inventory-check` are no longer `continue-on-error`. Proof
archived in
[`docs/superpowers/specs/2026-07-11-build-gate-falsification.md`](../docs/superpowers/specs/2026-07-11-build-gate-falsification.md).

To stop this recurring:

1. **Local guard — before committing ANY `upstream/` edit:** run
   `cohabit drift gitnexus` (from the sibling `fork-cohabitation` repo) **or**
   `node scripts/check-patch-drift.mjs`. Both must exit 0 (committed diffs ==
   clone). Regenerate the diffs per "Regenerate the diffs" above first.
2. **CI gate — `build-gate` job** (`.github/workflows/test.yml`) is **NOT**
   `continue-on-error`: it applies the committed patches to a fresh clone and
   `docker compose build`s the web image. A gutted/inconsistent patch set makes
   it go red and blocks the workflow.

## Why not a git submodule?

A submodule would be the textbook answer, but it'd force every user of
this repo to know about submodules and to keep the upstream remote
reachable. When the flat-diff approach was first chosen, the README noted
that *"if our deltas explode, revisit this decision"*.

That threshold has now been crossed: the monolithic diff grew to ~29k
lines / 114 files (×4 the original estimate). Phase 1 of the divergence
paydown (this work) isolated the conflict surface by splitting the diff
and adding the bump tool. The **decision on cohabitation format** —
whether to stay on split flat-diffs or migrate to a subtree/submodule
model — is **deferred to Phase 2**, once `v1.7.x` is released and the
Phase 1 dry-run data shapes the cost estimate. See
[`docs/superpowers/specs/2026-05-29-upstream-divergence-paydown-design.md`](../docs/superpowers/specs/2026-05-29-upstream-divergence-paydown-design.md)
for the full design rationale.
