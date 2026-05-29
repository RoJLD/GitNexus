# Upstream patches

Two diff files capture every modification we apply to the
[gitnexus/gitnexus](https://github.com/abhigyanpatwari/gitnexus)
repository (tag `v1.6.5`) for this deployment:

- **`additive-files.diff`** — ~99 new files we own entirely. These never
  conflict with upstream changes because they are new files, not edits.
- **`inplace-edits.diff`** — 17 modified upstream files. This is the
  real conflict surface when bumping upstream.

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

~99 additive files (new files we own, in `additive-files.diff`) + 17
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
