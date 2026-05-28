# Regression Forensics Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Étendre `/regression` (Phase 1, entropy) à `ownership.busFactor`, `ownership.topAuthorShare`, `dissonance.purity`, `coupling` — via des series-providers par snapshot + une attribution heuristique `window-suspects`, sur un skeleton généralisé.

**Architecture:** Foundation partagée `docker-server-git-utils.mjs` (extrait de entropy-commits, DRY). `METRIC_REGISTRY` gagne `series` (tag) + `attribution` mode + `worseDirection`. La route `/regression` dispatche : `getSeries(tag)` (entropy timeline / N appels ownership `?until=` / coupling `?asOf=` / dissonance `repo@sha`) → `locateRegression` (inchangé) → attribution (`entropy-commits` ou `window-suspects` via `commitsInWindow` + `rankSuspects`). Endpoint + MCP inchangés.

**Tech Stack:** Node zéro-dep (docker-server pattern), Vitest 4 (unit), réutilise /entropy /entropy/commits /ownership /coupling /dissonance /commit/footprint.

**Spec source:** [`docs/superpowers/specs/2026-05-28-regression-forensics-phase2-design.md`](../specs/2026-05-28-regression-forensics-phase2-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

---

## Environment notes

**Node 21** : vitest crashe (rolldown). Tests committés "blind", CI Node 22 valide. `npm run test:unit` peut crasher → ATTENDU.

**Patches/upstream-all.diff** : UTF-16 LE + CRLF via PowerShell `Out-File -Encoding Unicode`. Regen à chaque tâche touchant `upstream/` :

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
```

**Parallel session** : fichiers chauds. Committer vite. Avant chaque commit : `git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null`. Ne JAMAIS committer : `.claude/`, `AGENTS.md`, `roadmap.yml`, `tests/package-lock.json`.

**Git identity** : déjà `roblastar@live.fr`.

**Verified anchors (controller):**
- `docker-server-entropy-commits.mjs` has private `runCmd` (spawn helper, ~line 48), `parseGitLog` (165-189), `resolveWindowEnd` (192-210), `loadSnapshotEntropyTimeline` (119-161). Per-commit shape includes `sha, shortSha, author, date, filesTouched, attributedDensityDelta, attributedModularityDelta`.
- `docker-server-ownership.mjs` git-log call (145-152): `runCmd('git', ['-C', repoPath, 'log', '--pretty=format:%an', '--name-only', '--no-merges'])`; response has `repoBusFactor` + `repoAuthors[0].share`.
- `docker-server-coupling.mjs` has local `listSnapshotNamesAndDates` (43-65); response has `pairs: [{a,b,count,jaccard}]`.
- `docker-server-dissonance.mjs` `fetchFileCommunities(baseRepo, api)` posts a Cypher to `/api/query` with `repo: baseRepo`; response has `purity`.
- Phase 1 regression files: `docker-server-regression-core.mjs` (METRIC_REGISTRY + locateRegression + rankCulprits), `docker-server-regression.mjs` (handleRegressionRoute, uses WEB_BASE loopback).

---

## File Structure

| Path | Rôle | Tâche |
|---|---|---|
| `upstream/docker-server-git-utils.mjs` | NEW — runCmd + parseGitLog + resolveWindowEnd + commitsInWindow + listSnapshotNamesAndDates (exportés) | T1 |
| `upstream/docker-server-entropy-commits.mjs` | MOD — importe git-utils (DRY refactor) | T1 |
| `upstream/docker-server-regression-core.mjs` | MOD — registry Phase 2 rows + rankSuspects | T2 |
| `upstream/docker-server-regression.mjs` | MOD — getSeries dispatch + window-suspects attribution | T3 (+ providers in T4/5/6) |
| `upstream/docker-server-ownership.mjs` | MOD — `?until=<iso>` | T4 |
| `upstream/docker-server-coupling.mjs` | MOD — `?asOf=<iso>` + pairsAboveThreshold | T5 |
| `upstream/docker-server-dissonance.mjs` | MOD — snapshot Cypher + config fallback | T6 |
| `upstream/Dockerfile.web` | MOD — COPY docker-server-git-utils.mjs | T1 |
| `tests/unit/regression-suspects.test.mjs` | NEW | T2 |
| `tests/integration/endpoints/regression-phase2.test.mjs` | NEW | T7 |
| `ROADMAP.md` / `INVENTORY.md` / `tests/README.md` / `CLAUDE.md` | docs | T8 |

---

## Task 1: `docker-server-git-utils.mjs` + refactor entropy-commits

**Files:**
- Create: `upstream/docker-server-git-utils.mjs`
- Modify: `upstream/docker-server-entropy-commits.mjs`
- Modify: `upstream/Dockerfile.web`

- [ ] **Step 1: Create the shared module**

Create `upstream/docker-server-git-utils.mjs`. Read the CURRENT `runCmd` (≈line 48), `parseGitLog` (165-189), `resolveWindowEnd` (192-210), and `listSnapshotNamesAndDates` (in `docker-server-coupling.mjs` 43-65) and MOVE them verbatim into this module, then add `commitsInWindow`. The module:

```javascript
/**
 * Shared git + snapshot helpers (extracted from docker-server-entropy-commits.mjs
 * and docker-server-coupling.mjs for reuse by regression forensics Phase 2).
 * Zero-dep. See docs/superpowers/specs/2026-05-28-regression-forensics-phase2-design.md
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SNAPSHOTS_ROOT } from './docker-server-snapshots.mjs';

// Copy the EXACT runCmd from entropy-commits (spawn → resolve(stdout)/reject(err)).
export function runCmd(cmd, args, opts = {}) { /* paste verbatim from entropy-commits ~line 48 */ }

// parseGitLog — paste VERBATIM from entropy-commits 165-189. Add shortSha:
export function parseGitLog(stdout) { /* verbatim; ensure each commit has shortSha = sha.slice(0,7) and filesTouched = files.length */ }

// resolveWindowEnd — paste VERBATIM from entropy-commits 192-210.
export async function resolveWindowEnd(repoPath, value) { /* verbatim */ }

// listSnapshotNamesAndDates — paste VERBATIM from coupling 43-65 (reads
// SNAPSHOTS_ROOT/<repoName>/<dir>/commit.json → [{ name:'<repo>@<sha>', date, isLive:false }]).
export function listSnapshotNamesAndDates(repoName) { /* verbatim */ }

// NEW: commits in a [fromIso, toIso] window with filesTouched counts.
export async function commitsInWindow(repoPath, fromIso, toIso) {
  const args = ['-C', repoPath, 'log', '--pretty=format:%H%x09%aI%x09%an', '--name-only', '--no-merges'];
  if (fromIso) args.push(`--since=${fromIso}`);
  if (toIso) args.push(`--until=${toIso}`);
  let out;
  try { out = await runCmd('git', args); } catch { return []; }
  return parseGitLog(out).map((c) => ({
    sha: c.sha,
    shortSha: c.sha ? c.sha.slice(0, 7) : null,
    author: c.author,
    date: c.date,
    filesTouched: Array.isArray(c.files) ? c.files.length : 0,
  }));
}
```

IMPORTANT: when pasting `parseGitLog`, ensure the returned commits expose `shortSha` and (for `commitsInWindow`) the file count. If the existing `parseGitLog` returns `files` array, keep it; `commitsInWindow` derives `filesTouched` from `files.length`.

- [ ] **Step 2: Refactor entropy-commits to import from git-utils**

In `docker-server-entropy-commits.mjs`: delete its private `parseGitLog`, `resolveWindowEnd`, and `runCmd` definitions; add at the top:

```javascript
import { runCmd, parseGitLog, resolveWindowEnd } from './docker-server-git-utils.mjs';
```

Leave `loadSnapshotEntropyTimeline` and all attribution logic untouched (only the 3 helpers move). Verify no other code in the file redefines those names.

- [ ] **Step 3: COPY git-utils in Dockerfile.web**

Grep `grep -n "COPY docker-server-regression-core.mjs" upstream/Dockerfile.web`. Add a sibling line:

```dockerfile
# Shared git/snapshot helpers (regression Phase 2)
COPY docker-server-git-utils.mjs ./docker-server-git-utils.mjs
```

- [ ] **Step 4: Syntax-check + regen + commit**

```
node --check upstream/docker-server-git-utils.mjs
node --check upstream/docker-server-entropy-commits.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "refactor(regression): extract docker-server-git-utils.mjs (parseGitLog/resolveWindowEnd/runCmd/listSnapshots/commitsInWindow) + entropy-commits imports it (Task 1)"
```

(The existing entropy-commits integration test + the Task 8 build validate the refactor introduced no regression.)

---

## Task 2: Skeleton generalization — registry rows + `rankSuspects`

**Files:**
- Modify: `upstream/docker-server-regression-core.mjs`
- Create: `tests/unit/regression-suspects.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/regression-suspects.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { METRIC_REGISTRY, rankSuspects } from '../../upstream/docker-server-regression-core.mjs';

describe('METRIC_REGISTRY Phase 2 rows', () => {
  it('has the 4 new metrics with correct directions + attribution', () => {
    expect(METRIC_REGISTRY['ownership.busFactor'].worseDirection).toBe('down');
    expect(METRIC_REGISTRY['ownership.busFactor'].attribution).toBe('window-suspects');
    expect(METRIC_REGISTRY['ownership.topAuthorShare'].worseDirection).toBe('up');
    expect(METRIC_REGISTRY['dissonance.purity'].worseDirection).toBe('down');
    expect(METRIC_REGISTRY['dissonance.purity'].attribution).toBe('window-suspects');
    expect(METRIC_REGISTRY.coupling.worseDirection).toBe('up');
    expect(METRIC_REGISTRY.coupling.attribution).toBe('window-suspects');
  });
  it('keeps entropy metrics on entropy-commits attribution', () => {
    expect(METRIC_REGISTRY.density.attribution).toBe('entropy-commits');
    expect(METRIC_REGISTRY.modularity.attribution).toBe('entropy-commits');
  });
  it('every metric declares a series tag', () => {
    for (const k of Object.keys(METRIC_REGISTRY)) {
      expect(typeof METRIC_REGISTRY[k].series).toBe('string');
    }
  });
});

describe('rankSuspects', () => {
  it('ranks by filesTouched descending', () => {
    const out = rankSuspects([
      { sha: 'a', filesTouched: 2, date: '2026-01-01T00:00:00Z' },
      { sha: 'b', filesTouched: 9, date: '2026-01-02T00:00:00Z' },
      { sha: 'c', filesTouched: 5, date: '2026-01-03T00:00:00Z' },
    ]);
    expect(out.map((c) => c.sha)).toEqual(['b', 'c', 'a']);
  });
  it('breaks ties by most recent date first', () => {
    const out = rankSuspects([
      { sha: 'old', filesTouched: 3, date: '2026-01-01T00:00:00Z' },
      { sha: 'new', filesTouched: 3, date: '2026-01-09T00:00:00Z' },
    ]);
    expect(out[0].sha).toBe('new');
  });
  it('empty array → empty', () => {
    expect(rankSuspects([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests; npm run test:unit -- regression-suspects`
Expected: FAIL (rankSuspects undefined / new registry keys missing) or Node 21 crash — proceed.

- [ ] **Step 3: Extend the registry + add rankSuspects**

In `docker-server-regression-core.mjs`, replace the existing `METRIC_REGISTRY` with (note: existing density/modularity gain an `attribution` + `series` field; keep their `attrField`):

```javascript
export const METRIC_REGISTRY = {
  density:    { worseDirection: 'up',   series: 'entropy:density',    attribution: 'entropy-commits', attrField: 'attributedDensityDelta' },
  modularity: { worseDirection: 'down', series: 'entropy:modularity', attribution: 'entropy-commits', attrField: 'attributedModularityDelta' },
  'ownership.busFactor':      { worseDirection: 'down', series: 'ownership:repoBusFactor',      attribution: 'window-suspects' },
  'ownership.topAuthorShare': { worseDirection: 'up',   series: 'ownership:topAuthorShare',     attribution: 'window-suspects' },
  'dissonance.purity':        { worseDirection: 'down', series: 'dissonance:purity',            attribution: 'window-suspects' },
  coupling:                   { worseDirection: 'up',   series: 'coupling:pairsAboveThreshold', attribution: 'window-suspects' },
};
```

Add the pure `rankSuspects` (after `rankCulprits`):

```javascript
/**
 * Rank commits in the regression window as "suspects" by filesTouched (desc),
 * tie-broken by most-recent date first. Used when no per-commit attribution
 * exists (ownership/dissonance/coupling). Returns a sorted copy.
 */
export function rankSuspects(commitsInWindow) {
  const list = Array.isArray(commitsInWindow) ? commitsInWindow.slice() : [];
  return list.sort((a, b) => {
    const fa = typeof a.filesTouched === 'number' ? a.filesTouched : 0;
    const fb = typeof b.filesTouched === 'number' ? b.filesTouched : 0;
    if (fb !== fa) return fb - fa;
    const da = Date.parse(a.date || '') || 0;
    const db = Date.parse(b.date || '') || 0;
    return db - da;
  });
}
```

Keep `locateRegression` and `rankCulprits` unchanged. NOTE: the Phase 1 `docker-server-regression.mjs` reads `cfg.seriesField`/`cfg.attrField`; the new `series` tag replaces `seriesField`. Task 3 updates the I/O to use `series`. For the entropy rows, `attrField` is retained (still used by the entropy-commits attribution path).

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests; npm run test:unit -- regression-suspects`
Expected: PASS or Node 21 crash — proceed. Also run `cd tests; npm run test:unit -- regression-core` (Phase 1 tests) — the registry change keeps `worseDirection`/`attrField` so those stay green (or Node 21 crash).

- [ ] **Step 5: Syntax-check + regen + commit**

```
node --check upstream/docker-server-regression-core.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff tests/unit/regression-suspects.test.mjs
git commit -m "feat(regression): registry Phase 2 rows (ownership/dissonance/coupling) + rankSuspects + unit (Task 2)"
```

---

## Task 3: I/O generalization — `getSeries` dispatch + window-suspects attribution

**Files:**
- Modify: `upstream/docker-server-regression.mjs`

This rewrites `handleRegressionRoute` to dispatch on `cfg.series` + `cfg.attribution`. The entropy path must keep working identically (Phase 1 integration test). The new series tags return `[]` until their providers land in T4/5/6 (so the route degrades gracefully: empty series → `regressed:false` + note).

- [ ] **Step 1: Rewrite the route to dispatch**

Read the current `docker-server-regression.mjs`. Replace its body with this generalized version (preserves the entropy behavior, adds the dispatch). Key changes: `getSeries(seriesTag, repo, base)` + `getAttribution(cfg, repo, base, loc, from, to)`:

```javascript
import { METRIC_REGISTRY, locateRegression, rankCulprits, rankSuspects } from './docker-server-regression-core.mjs';
import { commitsInWindow, listSnapshotNamesAndDates, resolveWindowEnd } from './docker-server-git-utils.mjs';
import { findRepoByName, SNAPSHOTS_ROOT } from './docker-server-snapshots.mjs';

const WEB_BASE = () => `http://127.0.0.1:${process.env.PORT || '4173'}`;

async function getJson(url) {
  try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); } catch { return null; }
}
function sendJson(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

// Build a [{ name, sha, date, value }] series for a metric's series tag.
// New providers (ownership/coupling/dissonance) are added by T4/5/6.
async function getSeries(seriesTag, repo, base) {
  const [source, field] = seriesTag.split(':');
  if (source === 'entropy') {
    const entropy = await getJson(`${base}/entropy?repo=${encodeURIComponent(repo)}`);
    const timeline = entropy && Array.isArray(entropy.timeline) ? entropy.timeline : [];
    return timeline.map((t) => ({ name: t.name, sha: t.sha, date: t.date, value: t[field] }));
  }
  // T4: ownership, T5: coupling, T6: dissonance providers slot in here.
  return [];
}

export async function handleRegressionRoute(req, url, res) {
  if (url.pathname !== '/regression' || req.method !== 'GET') return false;
  const repo = url.searchParams.get('repo');
  const metric = url.searchParams.get('metric') || 'density';
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  if (!repo) { sendJson(res, 400, { error: 'missing repo' }); return true; }
  const cfg = METRIC_REGISTRY[metric];
  if (!cfg) { sendJson(res, 400, { error: `unknown metric '${metric}' (supported: ${Object.keys(METRIC_REGISTRY).join(', ')})` }); return true; }

  const base = WEB_BASE();
  const series = await getSeries(cfg.series, repo, base);
  const loc = locateRegression(series, cfg.worseDirection);

  if (series.length < 2) {
    sendJson(res, 200, { repo, metric, regressed: false, window: { from, to }, note: 'Need at least 2 snapshots to detect a regression.', worstCommit: null, runnersUp: [], attribution: cfg.attribution === 'entropy-commits' ? 'attributed' : 'suspects' });
    return true;
  }

  // Attribution.
  let worstCommit = null;
  let runnersUp = [];
  let attribution = 'suspects';

  if (cfg.attribution === 'entropy-commits') {
    attribution = 'attributed';
    const qs = [`repo=${encodeURIComponent(repo)}`];
    if (from) qs.push(`from=${encodeURIComponent(from)}`);
    if (to) qs.push(`to=${encodeURIComponent(to)}`);
    const attrib = await getJson(`${base}/entropy/commits?${qs.join('&')}`);
    const commits = attrib && Array.isArray(attrib.commits) ? attrib.commits : [];
    const ranked = rankCulprits(commits, cfg.attrField, cfg.worseDirection);
    const worstRaw = ranked[0] || null;
    const adv = worstRaw && typeof worstRaw[cfg.attrField] === 'number' ? (cfg.worseDirection === 'up' ? worstRaw[cfg.attrField] : -worstRaw[cfg.attrField]) : 0;
    if (worstRaw && adv > 0) {
      const fp = await getJson(`${base}/commit/footprint?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(worstRaw.sha)}`);
      worstCommit = { sha: worstRaw.sha, shortSha: worstRaw.shortSha || (worstRaw.sha ? worstRaw.sha.slice(0, 7) : null), author: worstRaw.author || (fp && fp.author) || null, date: worstRaw.date || (fp && fp.date) || null, message: (fp && fp.message) || null, attributedDelta: worstRaw[cfg.attrField], files: fp && Array.isArray(fp.filesTouched) ? fp.filesTouched : [] };
      runnersUp = ranked.slice(1, 4).filter((c) => (cfg.worseDirection === 'up' ? c[cfg.attrField] : -c[cfg.attrField]) > 0).map((c) => ({ sha: c.sha, shortSha: c.shortSha || (c.sha ? c.sha.slice(0, 7) : null), author: c.author || null, attributedDelta: c[cfg.attrField] }));
    }
  } else {
    // window-suspects: commits in the regression window ranked by filesTouched.
    attribution = 'suspects';
    const repoObj = await findRepoByName(repo.split('@')[0]);
    const repoPath = repoObj && (repoObj.repoPath || repoObj.path);
    if (repoPath) {
      const fromIso = loc.worstPair ? loc.worstPair[0].date : (loc.first ? loc.first.date : null);
      const toIso = loc.worstPair ? loc.worstPair[1].date : (loc.last ? loc.last.date : null);
      const suspects = await commitsInWindow(repoPath, fromIso, toIso);
      const ranked = rankSuspects(suspects);
      const top = ranked[0] || null;
      if (top) {
        const fp = await getJson(`${base}/commit/footprint?repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(top.sha)}`);
        worstCommit = { sha: top.sha, shortSha: top.shortSha, author: top.author || (fp && fp.author) || null, date: top.date || null, message: (fp && fp.message) || null, attributedDelta: null, filesTouched: top.filesTouched, files: fp && Array.isArray(fp.filesTouched) ? fp.filesTouched : [] };
        runnersUp = ranked.slice(1, 4).map((c) => ({ sha: c.sha, shortSha: c.shortSha, author: c.author || null, attributedDelta: null, filesTouched: c.filesTouched }));
      }
    }
  }

  sendJson(res, 200, {
    repo, metric, regressed: loc.regressed, window: { from, to },
    before: loc.first ? loc.first.value : null, after: loc.last ? loc.last.value : null, netDelta: loc.netDelta,
    steepestDrop: loc.worstPair ? { between: [loc.worstPair[0].date, loc.worstPair[1].date], delta: loc.stepDelta } : null,
    attribution, worstCommit, runnersUp,
  });
  return true;
}
```

NOTE on `findRepoByName`: Phase 1's regression module didn't import it. Confirm `findRepoByName` is exported from `docker-server-snapshots.mjs` (the explore report says it is). If its signature needs an `api` arg, pass `process.env.GITNEXUS_API || 'http://gitnexus:4747'` as the 2nd arg (check the export's signature and match it).

- [ ] **Step 2: Syntax-check + regen + commit**

```
node --check upstream/docker-server-regression.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(regression): generalize route — getSeries dispatch + window-suspects attribution (Task 3)"
```

---

## Task 4: Ownership series — `/ownership?until=` + provider

**Files:**
- Modify: `upstream/docker-server-ownership.mjs`
- Modify: `upstream/docker-server-regression.mjs`

- [ ] **Step 1: Add `?until=` to /ownership**

In `docker-server-ownership.mjs`, find the git-log call (≈line 145: `runCmd('git', ['-C', repoPath, 'log', '--pretty=format:%an', '--name-only', '--no-merges'])`). Read the `until` param near the top of the handler (`const until = url.searchParams.get('until');` — add it next to the existing `repo` param read) and append `--until=` to the args when present:

```javascript
const until = url.searchParams.get('until');
// ...
const logArgs = ['-C', repoPath, 'log', '--pretty=format:%an', '--name-only', '--no-merges'];
if (until) logArgs.push(`--until=${until}`);
logOut = await runCmd('git', logArgs);
```

(Absent `until` → unchanged full history. Backward-compat.)

- [ ] **Step 2: Add the ownership provider to getSeries**

In `docker-server-regression.mjs` `getSeries`, before the final `return []`, add the ownership branch:

```javascript
  if (source === 'ownership') {
    const baseRepo = repo.split('@')[0];
    const snaps = listSnapshotNamesAndDates(baseRepo);
    const live = { name: baseRepo, sha: 'live', date: new Date().toISOString(), isLive: true };
    const points = [...snaps, live];
    const out = [];
    for (const p of points) {
      const o = await getJson(`${base}/ownership?repo=${encodeURIComponent(baseRepo)}&until=${encodeURIComponent(p.date)}`);
      if (!o) continue;
      const value = field === 'repoBusFactor'
        ? (typeof o.repoBusFactor === 'number' ? o.repoBusFactor : null)
        : (Array.isArray(o.repoAuthors) && o.repoAuthors[0] ? o.repoAuthors[0].share : null);
      out.push({ name: p.name, sha: p.sha, date: p.date, value });
    }
    return out;
  }
```

(`field` is `repoBusFactor` or `topAuthorShare` from the series tag.)

- [ ] **Step 3: Syntax-check + regen + commit**

```
node --check upstream/docker-server-ownership.mjs
node --check upstream/docker-server-regression.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(regression): ownership series via /ownership?until= (busFactor + topAuthorShare) (Task 4)"
```

---

## Task 5: Coupling series — `/coupling?asOf=` + pairsAboveThreshold + provider

**Files:**
- Modify: `upstream/docker-server-coupling.mjs`
- Modify: `upstream/docker-server-regression.mjs`

- [ ] **Step 1: Add `?asOf=` + pairsAboveThreshold to /coupling**

In `docker-server-coupling.mjs`: read the `asOf` param (`const asOf = url.searchParams.get('asOf');`). After `listSnapshotNamesAndDates` builds the timeline (and before the co-occurrence loop), truncate when `asOf` is present:

```javascript
const COUPLING_REGRESSION_THRESHOLD = Number(process.env.COUPLING_REGRESSION_THRESHOLD) || 0.5;
// ... after the timeline (snaps + live) is assembled, e.g. `timeline`:
let effectiveTimeline = timeline;
if (asOf) {
  const cut = Date.parse(asOf);
  if (Number.isFinite(cut)) effectiveTimeline = timeline.filter((t) => Date.parse(t.date) <= cut);
}
// use effectiveTimeline in the co-occurrence loop instead of timeline.
```

Then, in the response object, add the derived scalar:

```javascript
pairsAboveThreshold: pairs.filter((p) => typeof p.jaccard === 'number' && p.jaccard >= COUPLING_REGRESSION_THRESHOLD).length,
```

(Adapt `timeline`/`pairs` to the actual local variable names in the handler — read it first. Absent `asOf` → unchanged behavior; `pairsAboveThreshold` is always added, harmless.)

- [ ] **Step 2: Add the coupling provider to getSeries**

In `docker-server-regression.mjs` `getSeries`, add:

```javascript
  if (source === 'coupling') {
    const baseRepo = repo.split('@')[0];
    const snaps = listSnapshotNamesAndDates(baseRepo);
    const live = { name: baseRepo, sha: 'live', date: new Date().toISOString(), isLive: true };
    const points = [...snaps, live];
    const out = [];
    for (const p of points) {
      const c = await getJson(`${base}/coupling?repo=${encodeURIComponent(baseRepo)}&asOf=${encodeURIComponent(p.date)}`);
      const value = c && typeof c.pairsAboveThreshold === 'number' ? c.pairsAboveThreshold : null;
      out.push({ name: p.name, sha: p.sha, date: p.date, value });
    }
    return out;
  }
```

- [ ] **Step 3: Syntax-check + regen + commit**

```
node --check upstream/docker-server-coupling.mjs
node --check upstream/docker-server-regression.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(regression): coupling series via /coupling?asOf= + pairsAboveThreshold scalar (Task 5)"
```

---

## Task 6: Dissonance series — snapshot Cypher + config fallback + provider

**Files:**
- Modify: `upstream/docker-server-dissonance.mjs`
- Modify: `upstream/docker-server-regression.mjs`

- [ ] **Step 1: Make /dissonance snapshot-aware**

In `docker-server-dissonance.mjs`: `fetchFileCommunities(baseRepo, api)` currently passes the stripped `baseRepo` to the Cypher `repo` param. Change the handler to pass the FULL `repoName` (including any `@sha`) to `fetchFileCommunities` so a snapshot graph is queried:

```javascript
// handler: keep baseRepo for path/config, but pass the full repoName to the query.
fileToCommunity = await fetchFileCommunities(repoName, opts.api);
```

And for the domain config: read it from the snapshot's source dir when `repoName` has an `@sha`, falling back to the live config. Find where the config is loaded (`getConfig(repoPath)` or the domains read) and add a snapshot-source fallback:

```javascript
// If repoName has @sha, prefer the snapshot's source domain config, else live.
// (Reuse SNAPSHOTS_ROOT + the snapshot dir; if not found, keep the live getConfig path.)
```

Keep live behavior (no `@sha`) byte-for-byte unchanged. If the snapshot graph isn't loaded, the Cypher returns empty/errs → the handler already handles "no communities" gracefully (returns an error or empty) — that's the best-effort skip the provider relies on.

NOTE: this is the fragile task. If reading the snapshot source config is non-trivial, the MINIMAL acceptable change is just passing `repoName` to the Cypher query (snapshot graph) + keeping the LIVE domain config for all cases (domains rarely change per snapshot). Document that choice in a code comment.

- [ ] **Step 2: Add the dissonance provider to getSeries**

In `docker-server-regression.mjs` `getSeries`, add:

```javascript
  if (source === 'dissonance') {
    const baseRepo = repo.split('@')[0];
    const snaps = listSnapshotNamesAndDates(baseRepo); // name = '<base>@<sha>'
    const live = { name: baseRepo, sha: 'live', date: new Date().toISOString(), isLive: true };
    const points = [...snaps, live];
    const out = [];
    for (const p of points) {
      const d = await getJson(`${base}/dissonance?repo=${encodeURIComponent(p.name)}`);
      const value = d && typeof d.purity === 'number' ? d.purity : null;
      out.push({ name: p.name, sha: p.sha, date: p.date, value }); // null values skipped by locateRegression
    }
    return out;
  }
```

(Snapshots whose graph isn't loaded → `d` null or no purity → `value: null` → `locateRegression` skips them. Best-effort.)

- [ ] **Step 3: Syntax-check + regen + commit**

```
node --check upstream/docker-server-dissonance.mjs
node --check upstream/docker-server-regression.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(regression): dissonance series via snapshot-aware /dissonance (purity, best-effort) (Task 6)"
```

---

## Task 7: Integration tests

**Files:**
- Create: `tests/integration/endpoints/regression-phase2.test.mjs`

- [ ] **Step 1: Write the test (mirror lifespan-windowed harness)**

Create `tests/integration/endpoints/regression-phase2.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = 'http://localhost:4173';
const reg = async (metric) => {
  const res = await fetch(`${BASE}/regression?repo=${encodeURIComponent(FIXTURE.name)}&metric=${encodeURIComponent(metric)}`);
  return { status: res.status, body: res.ok ? await res.json() : await res.json().catch(() => ({})) };
};

describe('GET /regression — Phase 2 metrics', () => {
  for (const metric of ['ownership.busFactor', 'ownership.topAuthorShare', 'dissonance.purity', 'coupling']) {
    it(`${metric} returns a suspects-mode verdict`, async () => {
      const { status, body } = await reg(metric);
      expect(status).toBe(200);
      expect(body.metric).toBe(metric);
      expect(typeof body.regressed).toBe('boolean');
      expect(body.attribution).toBe('suspects');
      expect('worstCommit' in body).toBe(true);
      expect(Array.isArray(body.runnersUp)).toBe(true);
    });
  }

  it('entropy still uses attributed mode (Phase 1 regression check)', async () => {
    const { status, body } = await reg('density');
    expect(status).toBe(200);
    expect(body.attribution).toBe('attributed');
  });
});

describe('endpoint params', () => {
  it('/ownership?until= returns a busFactor', async () => {
    const res = await fetch(`${BASE}/ownership?repo=${encodeURIComponent(FIXTURE.name)}&until=${encodeURIComponent(new Date().toISOString())}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.repoBusFactor).toBe('number');
  });
  it('/coupling?asOf= returns pairsAboveThreshold', async () => {
    const res = await fetch(`${BASE}/coupling?repo=${encodeURIComponent(FIXTURE.name)}&asOf=${encodeURIComponent(new Date().toISOString())}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.pairsAboveThreshold).toBe('number');
  });
});
```

- [ ] **Step 2: Commit (tracked test file)**

```
git add tests/integration/endpoints/regression-phase2.test.mjs
git commit -m "test(regression): Phase 2 metrics (ownership/dissonance/coupling) + until/asOf params (Task 7)"
```

---

## Task 8: Docs + build validation + final commit

**Files:**
- Modify: `ROADMAP.md`, `INVENTORY.md`, `tests/README.md`, `CLAUDE.md`

- [ ] **Step 1: Build + smoke**

```
docker compose build gitnexus-web
docker compose up -d gitnexus gitnexus-web
```

Wait for the web server. Then smoke the new metrics + the params + an entropy regression check + MCP:

```
for m in ownership.busFactor ownership.topAuthorShare dissonance.purity coupling density; do
  curl -s -o /dev/null -w "regression $m: HTTP %{http_code}\n" --max-time 60 "http://localhost:4173/regression?repo=hmm_studio&metric=$m"
done
curl -s -o /dev/null -w "ownership until: HTTP %{http_code}\n" "http://localhost:4173/ownership?repo=hmm_studio&until=2030-01-01T00:00:00Z"
curl -s -o /dev/null -w "coupling asOf: HTTP %{http_code}\n" "http://localhost:4173/coupling?repo=hmm_studio&asOf=2030-01-01T00:00:00Z"
node mcp-server/smoke.mjs
```

Expected: all 5 regression metrics → 200; ownership/coupling params → 200; MCP smoke passes (regression still green). Inspect one suspects body: `curl -s "http://localhost:4173/regression?repo=hmm_studio&metric=ownership.busFactor" | head -c 400` — confirm `attribution:"suspects"`. **Also confirm entropy didn't regress** from the git-utils refactor: `curl -s -o /dev/null -w "entropy/commits: %{http_code}\n" "http://localhost:4173/entropy/commits?repo=hmm_studio&days=90"` → 200.

- [ ] **Step 2: CLAUDE.md smoke loop**

After the existing `regression: HTTP` curl (grep `regression: HTTP`), add a line for a Phase 2 metric:

```bash
# Regression forensics Phase 2 (Tier 58) — suspects-mode metrics.
curl -s -o /dev/null -w "regression ownership: HTTP %{http_code}\n" \
  "http://localhost:4173/regression?repo=hmm_studio&metric=ownership.busFactor"
```

- [ ] **Step 3: ROADMAP.md**

Add a "Déjà livré" row (`grep "^| 57 " ROADMAP.md` → use next number):

```markdown
| 58 | **Regression Forensics Phase 2 (ownership + dissonance + coupling)** : `/regression` couvre 6 scalaires. Skeleton généralisé (`series` tag + `attribution` mode dans METRIC_REGISTRY, `rankSuspects`). Séries par snapshot : `/ownership?until=` (busFactor/topAuthorShare), `/coupling?asOf=` (+ `pairsAboveThreshold@0.5`), `/dissonance` snapshot-aware (purity, best-effort). Attribution `window-suspects` (commits de la fenêtre par filesTouched — fidélité étiquetée `attribution:'suspects'`, vs `'attributed'` pour entropy). Foundation partagée `docker-server-git-utils.mjs`. | `docker-server-git-utils.mjs`, `docker-server-regression-core.mjs` (rankSuspects), `docker-server-regression.mjs` (getSeries), params `/ownership?until=` + `/coupling?asOf=` + `/dissonance` snapshot |
```

In the enterprise table, update "Auto regression forensics" note: Phase 1 + Phase 2 livrées (6 métriques) ; restent "auto" (watch-fire) + UI. Bump date header.

- [ ] **Step 4: INVENTORY.md**

Update the `/regression` entry: now 6 scalaires + `attribution` mode. Add: `docker-server-git-utils.mjs` (shared), `/ownership?until=`, `/coupling?asOf=`+pairsAboveThreshold, `/dissonance` snapshot-aware.

- [ ] **Step 5: tests/README.md**

Add: unit `regression-suspects.test.mjs` (rankSuspects + Phase 2 registry); integration `regression-phase2.test.mjs` (4 metrics + until/asOf params + entropy attributed check).

- [ ] **Step 6: Final commit**

```
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add ROADMAP.md INVENTORY.md tests/README.md CLAUDE.md
git commit -m "Regression Forensics Phase 2 livré: ROADMAP #58/INVENTORY/CLAUDE smoke/tests (Task 8)"
```

(No patch regen — Task 8 touches only top-level docs.)

---

## Self-Review

**Spec coverage:**
- ✅ Spec § 4.2 git-utils extraction + entropy-commits refactor → Task 1.
- ✅ Spec § 4.3 registry rows (series + attribution) + rankSuspects → Task 2.
- ✅ Spec § 4.4 getSeries dispatch + window-suspects attribution + `attribution` field → Task 3.
- ✅ Spec § 4.5 `/ownership?until=` → Task 4 ; `/coupling?asOf=`+pairsAboveThreshold → Task 5 ; `/dissonance` snapshot-aware → Task 6.
- ✅ Spec § 3 worse-directions (busFactor↓, topAuthorShare↑, purity↓, coupling↑) → Task 2 registry.
- ✅ Spec § 5 edge cases (empty series → not regressed+note ; null values skipped ; dissonance best-effort skip ; suspects window empty → worstCommit null) → Task 3/6 code.
- ✅ Spec § 6 testing (unit rankSuspects + integration Phase 2 + entropy non-regression) → Task 2/7 + Task 8 smoke.
- ✅ Spec § 10 docs → Task 8.

**Placeholder scan:**
- ✅ Full code for git-utils skeleton, rankSuspects, registry, getSeries + 3 providers, the generalized route, tests.
- ⚠️ Task 1 Step 1 says "paste verbatim from entropy-commits" for runCmd/parseGitLog/resolveWindowEnd/listSnapshot — intentional: these are existing functions being relocated, with exact source line numbers given; pasting verbatim is the correct DRY extraction (re-writing them risks divergence).
- ⚠️ Tasks 4/5/6 Step 1 use grep-anchored edits to existing handlers (ownership git-log, coupling timeline, dissonance fetchFileCommunities) — the precise change is given; the surrounding handler code can't be fully inlined. Intentional.
- ⚠️ Task 6 documents a fragility fallback (minimal = snapshot Cypher + live config) — explicit, not a placeholder.

**Type/contract consistency:**
- ✅ `METRIC_REGISTRY[m] = { worseDirection, series, attribution, attrField? }` — Task 2 defines, Task 3 reads `cfg.series`/`cfg.attribution`/`cfg.worseDirection`/`cfg.attrField`.
- ✅ `getSeries` returns `[{ name, sha, date, value }]` — consumed by `locateRegression` (expects `.value`/`.date`). All 3 providers (T4/5/6) return that shape.
- ✅ `rankSuspects(commitsInWindow)` — Task 2 def + tests, Task 3 calls it on `commitsInWindow(...)` output (`{ sha, shortSha, author, date, filesTouched }`).
- ✅ `commitsInWindow(repoPath, fromIso, toIso)` → `[{ sha, shortSha, author, date, filesTouched }]` — Task 1 def, Task 3 consumes.
- ✅ Response `attribution: 'attributed'|'suspects'` consistent (Task 3) ; integration asserts it (Task 7).
- ✅ entropy path unchanged: `cfg.attrField` retained for density/modularity (Task 2), used in Task 3 entropy-commits branch.

**Scope:** big but cohesive (one feature, generalize + 3 metrics), 8 tasks, ~7-9 days. User explicitly chose all-3-in-one. Fits one plan.

Plan ready for execution.

---

## Effort summary

| Task | Estimate |
|---|---|
| 1. git-utils extract + entropy-commits refactor | ~1j |
| 2. registry rows + rankSuspects + unit | ~½j |
| 3. getSeries dispatch + window-suspects attribution | ~1½j |
| 4. ownership ?until= + provider | ~1j |
| 5. coupling ?asOf= + pairsAboveThreshold + provider | ~1-1½j |
| 6. dissonance snapshot-aware + provider | ~1½-2j |
| 7. integration tests | ~½j |
| 8. docs + build + smoke | ~½j |
| **Total** | **~7-9 jours** |
