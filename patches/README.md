# Upstream patches

`upstream-all.diff` captures every modification we apply to the
[gitnexus/gitnexus](https://github.com/abhigyanpatwari/gitnexus)
repository (tag `v1.6.3`) for this deployment.

We don't track `upstream/` itself in this repo — it's a working clone we
modify in place and use as the Docker build context. Tracking it would
include ~2500 vendored files we don't own. Instead, we serialize our
deltas here so the work is reproducible and reviewable.

## Apply on a fresh clone

```powershell
# From the repo root
git clone --depth 1 --branch v1.6.3 https://github.com/abhigyanpatwari/gitnexus.git upstream
cd upstream
git apply ../patches/upstream-all.diff
# Verify
git status
```

`git apply` will fail loudly if upstream has drifted from the v1.6.3
baseline (e.g. you cloned a different tag, or upstream rewrote one of
the files we patch). When that happens, regenerate the diff after
manually re-applying the changes — see "Regenerate the diff" below.

## What's inside

The patch covers:

- **`Dockerfile.web`** — adds `git`, `zip`/`unzip`, runtime safety
  config, copies the extra `docker-server-*.mjs` modules.
- **`docker-server.mjs`** — wires in route handlers for `/listdir`,
  `/export`, `/import`, `/snapshot`, `/snapshot/bulk`, `/churn`,
  `/coupling`, `/growth`, `/lifespan`.
- **`docker-server-*.mjs`** (6 new files) — the actual implementations
  of every analytics endpoint.
- **`gitnexus-web/src/`** — all the React/TypeScript changes:
  - `App.tsx`, `hooks/useAppState.tsx`, `hooks/useSigma.ts` —
    diff/churn/coupling/growth/lifespan state, color reducers
  - `lib/graph-diff.ts`, `lib/lucide-icons.tsx` — utilities + extra icons
  - `components/` — `Timeline.tsx`, `SnapshotsPanel.tsx`,
    `BulkSnapshotModal.tsx`, `CouplingPanel.tsx`, `GrowthChart.tsx`,
    `LifespanPanel.tsx`, `DiffBanner.tsx`, `Graph3DCanvas.tsx`,
    and edits to existing components (`Header.tsx`, `RepoAnalyzer.tsx`,
    `GraphCanvas.tsx`, `DropZone.tsx`)
  - `services/backend-client.ts` — `cache: 'no-store'` on `fetchRepos`
- **`gitnexus-web/package.json`** + **`package-lock.json`** — new deps
  for the 3D graph mode (`react-force-graph-3d`, `three`, etc.)

## Regenerate the diff

After you edit anything inside `upstream/`:

```powershell
# From the repo root
cd upstream
git add -N .                              # so git diff includes new files
git diff HEAD > ../patches/upstream-all.diff
git reset                                  # un-stage the intent-to-add
```

Then commit the updated `patches/upstream-all.diff` from the repo root.

## Why not a git submodule?

A submodule would be the textbook answer, but it'd force every user of
this repo to know about submodules and to keep the upstream remote
reachable. Our patches stay small enough (~7k lines) that a flat diff
file is simpler to read, review, and apply. If the upstream we depend
on grows or our deltas explode, revisit this decision.
