# Build-gate falsification proof — red-on-gutting, measured

Date: 2026-07-11 · Context: ROADMAP § "Update 2026-07-10", phase (i) "CI durcie".

The anti-gutting gates (build-gate, boot-smoke) were written AFTER the two
patch-gutting incidents (2026-05-31, 2026-07-07) but had never seen a real
gutting — trusting them to gate the v1.6.7 re-bump was a bet, not a guarantee
(doctrine: falsify before you rely). This spec archives the empirical proof.

## Protocol

Two throwaway canary branches, each replaying one historical incident class,
pushed to CI. Success = the workflow goes RED.

### Canary A — patch gutting (incident class 2026-05-31 / 2026-07-07)

- Branch: `test/gutting-canary-a` (commit message says DO NOT MERGE)
- Mutation: `patches/inplace-edits.diff` cut from 21 file blocks to 5
  (replays "diff regenerated from a partial clone" — the additive components
  then reference store props / deps that the remaining in-place edits no
  longer provide).
- Run: <https://github.com/RoJLD/GitNexus/actions/runs/29149214444>
- Observed: **build-gate → FAILURE** ✓ (and unit → failure: double net).
  inventory-check → success (unrelated, correct).

### Canary B — missing Dockerfile COPY (incident class 10879d77)

- Branch: `test/gutting-canary-b`
- Mutation: `COPY docker-server-metrics.mjs` line removed from
  `upstream/Dockerfile.web` (file exists, COPY gone), diffs regenerated
  canonically. The image BUILDS green; the container crash-loops at boot.
- Run (workflow_dispatch — heavy jobs are dispatch/PR/deployment-only):
  <https://github.com/RoJLD/GitNexus/actions/runs/29149245966>
- Observed: **build-gate → SUCCESS** (the insidious case: green build!)
  and **boot-smoke → FAILURE** ✓ (asserts `/metrics` and `/graph/templates`
  after boot). unit → success (sources intact — correct). integration/e2e →
  failure (they boot the same stack — consistent).

## Verdict

Both historical incident classes turn the CI red. The gates are falsifiable
and now proven. This satisfies the gating precondition of the ratified
v1.6.7 re-bump (ROADMAP § Update 2026-07-10, phase (i) step 4b).

Along the way, the same CI-hardening pass root-caused and fixed what the
`continue-on-error` era had been hiding (all measured on live runs):

1. **Two tag namespaces**: upstream git tags are 'v'-prefixed (`v1.6.5`),
   docker image tags are not (`1.6.5`) — the pre-pull used the git form and
   broke every docker job since 2026-06-15. Pre-pull now derives the image
   tag from `Dockerfile.cli`.
2. **Engines-gated optional dep**: `@rolldown/binding-*` declares
   `^20.19.0 || >=22.12.0`; CI pinned Node 22.11.0, so npm SILENTLY skipped
   the linux binding ("Cannot find native binding", long misread as npm bug
   #4828). NODE_VERSION → 22.12.0.
3. **A month-stale THIRD patch source**: `apply-upstream-patches.mjs` (the
   CI patch path) still applied the legacy monolithic `upstream-all.diff`,
   frozen 2026-06-11 — CI tested a month-old snapshot of our edits while
   drift-check only guarded the canonical split diffs. Legacy file deleted;
   script switched to the split diffs.
4. **Σ-EMNAPI-LOCKFILE-DRIFT (again)**: `npm ci` for gitnexus-web hard-fails
   on platform-specific optionals; `npm install` per the Dockerfile.web
   precedent.
5. **Test inventory debt**: 35 test files never registered in
   `tests/README.md` (the check was continue-on-error since birth).

Cleanup: both canary branches deleted after the runs were archived here.
