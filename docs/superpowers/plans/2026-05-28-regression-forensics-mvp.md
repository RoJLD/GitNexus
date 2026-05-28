# Regression Forensics MVP (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /regression?repo=&metric=density|modularity&from=&to=` (+ MCP tool) qui localise la régression structurelle dans une fenêtre, classe le commit coupable (réutilise `/entropy/commits`), et joint les fichiers impliqués (`/commit/footprint`) — sur un skeleton générique réutilisable en Phase 2.

**Architecture:** Module pur `docker-server-regression-core.mjs` (METRIC_REGISTRY + `locateRegression` + `rankCulprits`) + module I/O `docker-server-regression.mjs` (`handleRegressionRoute` qui fetch nos endpoints existants sur le web server et assemble). Tout dans le conteneur web. MCP tool dans le sidecar.

**Tech Stack:** Node http zéro-dep (docker-server pattern), Vitest 4 (unit), MCP stdio sidecar. Réutilise `/entropy`, `/entropy/commits`, `/commit/footprint`.

**Spec source:** [`docs/superpowers/specs/2026-05-28-regression-forensics-mvp-design.md`](../specs/2026-05-28-regression-forensics-mvp-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

---

## Environment notes

**Node 21** : vitest crashe (rolldown). Tests committés "blind", CI Node 22 valide. `npm run test:unit` peut crasher → ATTENDU.

**Patches/upstream-all.diff** : UTF-16 LE + CRLF via PowerShell `Out-File -Encoding Unicode`. Regen à chaque tâche touchant `upstream/`. Commande :

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
```

**Parallel session** : `docker-server.mjs` chaud. Committer vite. Avant chaque commit : `git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null`. Ne JAMAIS committer : `.claude/`, `AGENTS.md`, `roadmap.yml`, `tests/package-lock.json`.

**Git identity** : déjà `roblastar@live.fr`.

**VERIFIED (controller, 2026-05-28):** la convention de signe est confirmée dans `EntropyCommitTimeline.tsx` (lignes 25-27 + 130) : **density `> 0` = dégradation (worseDirection `'up'`)** ; **modularity `< 0` = dégradation (worseDirection `'down'`)**. Le `bad` test du composant : `metric === 'density' ? v > 0 : v < 0`. Le `METRIC_REGISTRY` ci-dessous est aligné. Task 1 re-confirme.

**`mcp-server/` runs on the host (not the web container).** It talks to the live stack over HTTP. Its tools target the web server base URL it already uses (check existing tools in `server.mjs` for the base — likely `http://localhost:4173` or an env var).

---

## File Structure

| Path | Rôle | Tâche |
|---|---|---|
| `upstream/docker-server-regression-core.mjs` | NEW — pur : METRIC_REGISTRY + locateRegression + rankCulprits | T2 |
| `upstream/docker-server-regression.mjs` | NEW — I/O : handleRegressionRoute (fetch+assemble) | T3 |
| `upstream/docker-server.mjs` | MOD — monte handleRegressionRoute | T4 |
| `upstream/Dockerfile.web` | MOD — COPY les 2 modules | T4 |
| `mcp-server/server.mjs` | MOD — tool gitnexus_regression | T5 |
| `mcp-server/smoke.mjs` | MOD — smoke du tool | T5 |
| `tests/unit/regression-core.test.mjs` | NEW | T2 |
| `tests/integration/endpoints/regression.test.mjs` | NEW | T6 |
| `ROADMAP.md` / `INVENTORY.md` / `tests/README.md` / `CLAUDE.md` | docs | T7 |

---

## Task 1: Confirm the worseDirection convention (gate, no code)

- [ ] **Step 1: Re-confirm**

Run: `grep -n "density.*> 0\|modular\|v > 0 : v < 0\|densifying\|less modular" upstream/gitnexus-web/src/components/EntropyCommitTimeline.tsx`
Confirm: density `> 0` = bad, modularity `< 0` = bad (the `bad = metric === 'density' ? v > 0 : v < 0` rule). This sets `density → worseDirection 'up'`, `modularity → worseDirection 'down'`.

- [ ] **Step 2: Record**

No code. State in your report: "Confirmed — density worseDirection 'up', modularity 'down', matching EntropyCommitTimeline." (Already verified by the controller; this is a sanity re-check.)

---

## Task 2: Core pure module + unit tests

**Files:**
- Create: `upstream/docker-server-regression-core.mjs`
- Create: `tests/unit/regression-core.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/regression-core.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { METRIC_REGISTRY, locateRegression, rankCulprits } from '../../upstream/docker-server-regression-core.mjs';

describe('METRIC_REGISTRY', () => {
  it('density worsens upward, modularity downward', () => {
    expect(METRIC_REGISTRY.density.worseDirection).toBe('up');
    expect(METRIC_REGISTRY.density.seriesField).toBe('density');
    expect(METRIC_REGISTRY.density.attrField).toBe('attributedDensityDelta');
    expect(METRIC_REGISTRY.modularity.worseDirection).toBe('down');
    expect(METRIC_REGISTRY.modularity.seriesField).toBe('modularity');
    expect(METRIC_REGISTRY.modularity.attrField).toBe('attributedModularityDelta');
  });
});

describe('locateRegression', () => {
  const s = (vals) => vals.map((v, i) => ({ name: `s${i}`, date: `2026-01-0${i + 1}T00:00:00Z`, value: v }));

  it('density worsening (rising) → regressed, worstPair = steepest rise', () => {
    const r = locateRegression(s([0.10, 0.12, 0.30, 0.31]), 'up');
    expect(r.regressed).toBe(true);
    expect(r.netDelta).toBeCloseTo(0.21, 6);     // 0.31 - 0.10
    expect(r.stepDelta).toBeCloseTo(0.18, 6);    // steepest adverse step 0.12→0.30
    expect(r.worstPair[0].value).toBeCloseTo(0.12, 6);
    expect(r.worstPair[1].value).toBeCloseTo(0.30, 6);
  });

  it('density improving (falling) → not regressed', () => {
    const r = locateRegression(s([0.30, 0.20, 0.10]), 'up');
    expect(r.regressed).toBe(false);
  });

  it('modularity worsening (falling) → regressed (worseDirection down)', () => {
    const r = locateRegression(s([0.80, 0.79, 0.50]), 'down');
    expect(r.regressed).toBe(true);
    expect(r.stepDelta).toBeCloseTo(0.29, 6);    // adverse = prev-next, steepest 0.79→0.50
  });

  it('flat series → not regressed', () => {
    expect(locateRegression(s([0.5, 0.5, 0.5]), 'up').regressed).toBe(false);
  });

  it('skips null/NaN values', () => {
    const series = [{ value: 0.1 }, { value: null }, { value: 0.4 }];
    const r = locateRegression(series, 'up');
    expect(r.regressed).toBe(true);
    expect(r.netDelta).toBeCloseTo(0.3, 6);
  });

  it('fewer than 2 valid points → not regressed, worstPair null', () => {
    const r = locateRegression([{ value: 0.5 }], 'up');
    expect(r.regressed).toBe(false);
    expect(r.worstPair).toBeNull();
  });
});

describe('rankCulprits', () => {
  const commits = [
    { sha: 'a', attributedDensityDelta: 0.05 },
    { sha: 'b', attributedDensityDelta: 0.20 },
    { sha: 'c', attributedDensityDelta: -0.10 },
  ];
  it('density (up): worst = biggest positive delta first', () => {
    const ranked = rankCulprits(commits, 'attributedDensityDelta', 'up');
    expect(ranked.map((c) => c.sha)).toEqual(['b', 'a', 'c']);
  });
  it('modularity (down): worst = most negative delta first', () => {
    const mc = [
      { sha: 'a', attributedModularityDelta: 0.05 },
      { sha: 'b', attributedModularityDelta: -0.20 },
      { sha: 'c', attributedModularityDelta: -0.01 },
    ];
    const ranked = rankCulprits(mc, 'attributedModularityDelta', 'down');
    expect(ranked.map((c) => c.sha)).toEqual(['b', 'c', 'a']);
  });
  it('empty array → empty', () => {
    expect(rankCulprits([], 'attributedDensityDelta', 'up')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests; npm run test:unit -- regression-core`
Expected: FAIL (import unresolved) or Node 21 crash — proceed.

- [ ] **Step 3: Implement the core module**

Create `upstream/docker-server-regression-core.mjs`:

```javascript
/**
 * Regression forensics — pure core. No I/O. See spec:
 * docs/superpowers/specs/2026-05-28-regression-forensics-mvp-design.md
 *
 * worseDirection convention matches EntropyCommitTimeline.tsx (density up = bad,
 * modularity down = bad). Phase 2 adds registry rows; the fns never change.
 */

export const METRIC_REGISTRY = {
  density:    { worseDirection: 'up',   seriesField: 'density',    attrField: 'attributedDensityDelta' },
  modularity: { worseDirection: 'down', seriesField: 'modularity', attrField: 'attributedModularityDelta' },
};

// Adverse delta normalizes direction so "bigger = worse" regardless of metric.
function adverse(delta, worseDirection) {
  return worseDirection === 'up' ? delta : -delta;
}

/**
 * series : [{ name?, sha?, date?, value: number|null }, ...] oldest→newest.
 * Returns { worstPair: [a,b]|null, stepDelta, netDelta, regressed, first, last }.
 *   stepDelta : the largest adverse snapshot-to-snapshot delta (>0 = got worse).
 *   netDelta  : signed (last.value - first.value) in raw units.
 *   regressed : net moved in the worse direction beyond eps.
 */
export function locateRegression(series, worseDirection, eps = 1e-9) {
  const pts = (Array.isArray(series) ? series : []).filter(
    (p) => p && typeof p.value === 'number' && Number.isFinite(p.value),
  );
  if (pts.length < 2) {
    return { worstPair: null, stepDelta: 0, netDelta: 0, regressed: false, first: pts[0] || null, last: pts[0] || null };
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  const netDelta = last.value - first.value;
  let worstPair = null;
  let stepDelta = 0;
  for (let i = 1; i < pts.length; i++) {
    const adv = adverse(pts[i].value - pts[i - 1].value, worseDirection);
    if (adv > stepDelta) {
      stepDelta = adv;
      worstPair = [pts[i - 1], pts[i]];
    }
  }
  const regressed = adverse(netDelta, worseDirection) > eps;
  return { worstPair, stepDelta, netDelta, regressed, first, last };
}

/**
 * attributedCommits : the `commits` array from /entropy/commits.
 * Returns a copy sorted worst-first by adverse attributed delta. Commits whose
 * attr field is missing/non-numeric sort last (treated as 0).
 */
export function rankCulprits(attributedCommits, attrField, worseDirection) {
  const list = Array.isArray(attributedCommits) ? attributedCommits.slice() : [];
  const advOf = (c) => {
    const v = c && typeof c[attrField] === 'number' && Number.isFinite(c[attrField]) ? c[attrField] : 0;
    return adverse(v, worseDirection);
  };
  return list.sort((a, b) => advOf(b) - advOf(a));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests; npm run test:unit -- regression-core`
Expected: PASS (10 cases) or Node 21 crash — proceed.

- [ ] **Step 5: Regen + commit**

```
node --check upstream/docker-server-regression-core.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff tests/unit/regression-core.test.mjs
git commit -m "feat(regression): core (METRIC_REGISTRY + locateRegression + rankCulprits) + 10 unit cases (Task 2)"
```

---

## Task 3: I/O module `docker-server-regression.mjs`

**Files:**
- Create: `upstream/docker-server-regression.mjs`

- [ ] **Step 1: Write the module**

Create `upstream/docker-server-regression.mjs`:

```javascript
/**
 * Regression forensics — I/O + route. Calls OUR existing web-server endpoints
 * (/entropy, /entropy/commits, /commit/footprint) and assembles a verdict.
 * Handler contract: returns true if it owned the route, false otherwise.
 * See spec: docs/superpowers/specs/2026-05-28-regression-forensics-mvp-design.md
 */
import { METRIC_REGISTRY, locateRegression, rankCulprits } from './docker-server-regression-core.mjs';

// Our endpoints live on THIS web server, not the upstream API server. Use the
// loopback web base (same pattern as the watches cron's webBase).
const WEB_BASE = () => `http://127.0.0.1:${process.env.PORT || '4173'}`;

async function getJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
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
  const enc = encodeURIComponent;

  // 1) Metric time-series from /entropy timeline.
  const entropy = await getJson(`${base}/entropy?repo=${enc(repo)}`);
  const timeline = entropy && Array.isArray(entropy.timeline) ? entropy.timeline : [];
  const series = timeline.map((t) => ({ name: t.name, sha: t.sha, date: t.date, value: t[cfg.seriesField] }));
  const loc = locateRegression(series, cfg.worseDirection);

  if (series.length < 2) {
    sendJson(res, 200, {
      repo, metric, regressed: false, window: { from, to },
      note: 'Need at least 2 snapshots to detect a regression.',
      worstCommit: null, runnersUp: [],
    });
    return true;
  }

  // 2) Per-commit attribution from /entropy/commits.
  const qs = [`repo=${enc(repo)}`];
  if (from) qs.push(`from=${enc(from)}`);
  if (to) qs.push(`to=${enc(to)}`);
  const attrib = await getJson(`${base}/entropy/commits?${qs.join('&')}`);
  const commits = attrib && Array.isArray(attrib.commits) ? attrib.commits : [];
  const ranked = rankCulprits(commits, cfg.attrField, cfg.worseDirection);

  // Only keep a worst culprit if it is actually adverse (delta in the worse dir).
  const worstRaw = ranked[0] || null;
  const worstAdverse = worstRaw && typeof worstRaw[cfg.attrField] === 'number'
    ? (cfg.worseDirection === 'up' ? worstRaw[cfg.attrField] : -worstRaw[cfg.attrField])
    : 0;
  const hasCulprit = worstRaw && worstAdverse > 0;

  // 3) Footprint of the worst culprit (files + message).
  let worstCommit = null;
  if (hasCulprit) {
    const fp = await getJson(`${base}/commit/footprint?repo=${enc(repo)}&sha=${enc(worstRaw.sha)}`);
    worstCommit = {
      sha: worstRaw.sha,
      shortSha: worstRaw.shortSha || (worstRaw.sha ? worstRaw.sha.slice(0, 7) : null),
      author: worstRaw.author || (fp && fp.author) || null,
      date: worstRaw.date || (fp && fp.date) || null,
      message: (fp && fp.message) || null,
      attributedDelta: worstRaw[cfg.attrField],
      files: fp && Array.isArray(fp.filesTouched) ? fp.filesTouched : [],
    };
  }

  const runnersUp = ranked.slice(1, 4)
    .filter((c) => (cfg.worseDirection === 'up' ? c[cfg.attrField] : -c[cfg.attrField]) > 0)
    .map((c) => ({
      sha: c.sha,
      shortSha: c.shortSha || (c.sha ? c.sha.slice(0, 7) : null),
      author: c.author || null,
      attributedDelta: c[cfg.attrField],
    }));

  sendJson(res, 200, {
    repo, metric,
    regressed: loc.regressed,
    window: { from, to },
    before: loc.first ? loc.first.value : null,
    after: loc.last ? loc.last.value : null,
    netDelta: loc.netDelta,
    steepestDrop: loc.worstPair
      ? { between: [loc.worstPair[0].date, loc.worstPair[1].date], delta: loc.stepDelta }
      : null,
    worstCommit,
    runnersUp,
  });
  return true;
}
```

- [ ] **Step 2: Syntax-check + regen + commit**

```
node --check upstream/docker-server-regression.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(regression): handleRegressionRoute — locate + rank + footprint join (Task 3)"
```

---

## Task 4: Wiring (mount + Dockerfile.web)

**Files:**
- Modify: `upstream/docker-server.mjs`
- Modify: `upstream/Dockerfile.web`

- [ ] **Step 1: Mount the route**

Grep `grep -n "handleAutoReindexRoute" upstream/docker-server.mjs`. There's an import (~line 35) and a dispatch line (before the `// ── Static asset serving` block). Add a sibling import:

```javascript
import { handleRegressionRoute } from './docker-server-regression.mjs';
```

And a sibling dispatch line immediately after the `handleAutoReindexRoute` dispatch (still before the static block). NOTE: `handleRegressionRoute` takes only `(req, url, res)` — no opts:

```javascript
  // Regression forensics (locate metric regression + culprit commit)
  if (await handleRegressionRoute(req, reqUrl, res)) return;
```

- [ ] **Step 2: COPY both modules in `Dockerfile.web`**

Grep `grep -n "COPY docker-server-auto-reindex.mjs" upstream/Dockerfile.web`. Add two sibling lines mirroring that style:

```dockerfile
# Regression forensics (core + route)
COPY docker-server-regression-core.mjs ./docker-server-regression-core.mjs
COPY docker-server-regression.mjs ./docker-server-regression.mjs
```

- [ ] **Step 3: Syntax-check + regen + commit**

```
node --check upstream/docker-server.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(regression): mount GET /regression + Dockerfile.web COPY (Task 4)"
```

---

## Task 5: MCP tool `gitnexus_regression`

**Files:**
- Modify: `mcp-server/server.mjs`
- Modify: `mcp-server/smoke.mjs`

- [ ] **Step 1: Study an existing tool**

Read `mcp-server/server.mjs`. Find an existing simple read tool that wraps a GET with a `repo` param (e.g. `gitnexus_entropy_commits` or `gitnexus_churn`). Note: (a) the base URL it uses (grep for the base/`fetch` — e.g. `http://localhost:4173`), (b) the tool registration shape (name, description, inputSchema, handler), (c) how params are forwarded. Mirror it EXACTLY.

- [ ] **Step 2: Add the tool**

Register `gitnexus_regression` mirroring the neighbor tool. Input schema: `{ repo: string (required), metric?: 'density'|'modularity' (default density), from?: string, to?: string }`. Handler: `GET <base>/regression?repo=&metric=&from=&to=` (omit empty params), return the JSON (mirror how the neighbor returns — likely `{ content: [{ type:'text', text: JSON.stringify(...) }] }`). Match the neighbor's exact return shape and error handling.

- [ ] **Step 3: Extend smoke**

Read `mcp-server/smoke.mjs`. Find where it calls a tool (e.g. `gitnexus_entropy_commits`) and asserts. Add a call to `gitnexus_regression` with `{ repo: '<the repo the smoke uses>', metric: 'density' }` and assert the result parses to an object containing `metric` and a boolean `regressed`. Mirror the neighbor assertions' style.

- [ ] **Step 4: Run the MCP smoke (if the stack is up) + commit**

If the docker stack is running: `node mcp-server/smoke.mjs` — expect it to pass including the new tool. If not up, skip (Task 7 runs it after building). Commit (these are top-level tracked files, no patch regen):

```
git add mcp-server/server.mjs mcp-server/smoke.mjs
git commit -m "feat(regression): MCP tool gitnexus_regression + smoke (Task 5)"
```

---

## Task 6: Integration test

**Files:**
- Create: `tests/integration/endpoints/regression.test.mjs`

- [ ] **Step 1: Mirror the harness + write the test**

Read `tests/integration/endpoints/lifespan-windowed.test.mjs` for the harness (imports `vitest` + `FIXTURE` from `../helpers/analyze.mjs`, base `http://localhost:4173`). Create `tests/integration/endpoints/regression.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = 'http://localhost:4173';

const fetchReg = async (params) => {
  const res = await fetch(`${BASE}/regression?${params}`);
  return { status: res.status, body: res.ok ? await res.json() : await res.json().catch(() => ({})) };
};

describe('GET /regression', () => {
  it('returns a density regression verdict', async () => {
    const { status, body } = await fetchReg(`repo=${encodeURIComponent(FIXTURE.name)}&metric=density`);
    expect(status).toBe(200);
    expect(body.metric).toBe('density');
    expect(typeof body.regressed).toBe('boolean');
    expect('worstCommit' in body).toBe(true);   // object or null
    expect(Array.isArray(body.runnersUp)).toBe(true);
  });

  it('supports modularity', async () => {
    const { status, body } = await fetchReg(`repo=${encodeURIComponent(FIXTURE.name)}&metric=modularity`);
    expect(status).toBe(200);
    expect(body.metric).toBe('modularity');
    expect(typeof body.regressed).toBe('boolean');
  });

  it('rejects an unknown metric with 400', async () => {
    const { status, body } = await fetchReg(`repo=${encodeURIComponent(FIXTURE.name)}&metric=garbage`);
    expect(status).toBe(400);
    expect(typeof body.error).toBe('string');
  });

  it('rejects a missing repo with 400', async () => {
    const { status } = await fetchReg(`metric=density`);
    expect(status).toBe(400);
  });
});
```

(If the neighbor uses a different base/fixture mechanism, match it exactly.)

- [ ] **Step 2: Commit**

```
git add tests/integration/endpoints/regression.test.mjs
git commit -m "test(regression): GET /regression density + modularity + 400s (Task 6)"
```

---

## Task 7: Docs + build validation + final commit

**Files:**
- Modify: `ROADMAP.md`, `INVENTORY.md`, `tests/README.md`, `CLAUDE.md`

- [ ] **Step 1: Build the web image + smoke**

```
docker compose build gitnexus-web
docker compose up -d gitnexus gitnexus-web
```

Wait for the web server, then:

```
curl -s -o /dev/null -w "regression density: HTTP %{http_code}\n" "http://localhost:4173/regression?repo=hmm_studio&metric=density"
curl -s -o /dev/null -w "regression modularity: HTTP %{http_code}\n" "http://localhost:4173/regression?repo=hmm_studio&metric=modularity"
curl -s -o /dev/null -w "regression bad-metric: HTTP %{http_code}\n" "http://localhost:4173/regression?repo=hmm_studio&metric=garbage"
node mcp-server/smoke.mjs
```

Expected: density/modularity → 200, garbage → 400, MCP smoke passes (incl. `gitnexus_regression`). If 404 on /regression, the mount (Task 4 Step 1) is wrong/after the static block.

- [ ] **Step 2: Update CLAUDE.md smoke loop**

After the `auto-reindex` curl block (grep `auto-reindex: HTTP`), add:

```bash
# Regression forensics (Tier 57) — locate a metric regression + culprit commit.
# 200 with { regressed, worstCommit, runnersUp }; 400 on unknown metric.
curl -s -o /dev/null -w "regression: HTTP %{http_code}\n" \
  "http://localhost:4173/regression?repo=hmm_studio&metric=density"
```

Also: where the MCP tool count is noted, bump it (+1 → `gitnexus_regression`).

- [ ] **Step 3: Update ROADMAP.md**

Add a "Déjà livré" row (`grep "^| 56 " ROADMAP.md` to find the current last). Add the next number:

```markdown
| 57 | **Regression Forensics MVP — Phase 1 (entropy)** (enterprise parity, partiel) : `GET /regression?repo=&metric=density|modularity&from=&to=` localise la régression (chute adverse la plus raide + delta net), classe le commit coupable (réutilise `/entropy/commits`), joint les fichiers impliqués (`/commit/footprint`). Skeleton générique (METRIC_REGISTRY + locateRegression + rankCulprits) prêt pour Phase 2 (ownership/dissonance/coupling). Endpoint + MCP tool `gitnexus_regression`, on-demand. | `upstream/docker-server-regression-core.mjs`, `upstream/docker-server-regression.mjs` (`GET /regression`), MCP tool |
```

In the enterprise table (§ "Enterprise / commercial offering"), change the **(Upcoming) Auto regression forensics** verdict from 🔴 to 🟡 (MVP Phase 1 livré ; Phase 2 + auto-on-watch restants) + pointer Tier 57. Bump the `Dernière mise à jour` header.

- [ ] **Step 4: Update INVENTORY.md**

In the endpoints section, add `GET /regression`. Mention the 2 modules (core pur + I/O), the reuse of /entropy + /entropy/commits + /commit/footprint, the generic skeleton, and the MCP tool (bump the tool count).

- [ ] **Step 5: Update tests/README.md**

Add: unit `regression-core.test.mjs` (locateRegression + rankCulprits + registry, 10 cases); integration `endpoints/regression.test.mjs` (density + modularity + 400s).

- [ ] **Step 6: Final commit**

```
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add ROADMAP.md INVENTORY.md tests/README.md CLAUDE.md
git commit -m "Regression Forensics MVP Phase 1 livré: ROADMAP #57/INVENTORY/CLAUDE smoke/tests (Task 7)"
```

(No patch regen — Task 7 touches only top-level tracked docs.)

---

## Self-Review

**Spec coverage:**
- ✅ Spec § 4.2 core (METRIC_REGISTRY + locateRegression + rankCulprits) → Task 2 with full code + 10 unit cases.
- ✅ Spec § 4.3 I/O (fetch /entropy + /entropy/commits + /commit/footprint on the WEB base, assemble the response shape) → Task 3.
- ✅ Spec § 4.4 MCP tool → Task 5.
- ✅ Spec § 3 worseDirection per registry, aligned to EntropyCommitTimeline → verified (Task 1) + encoded in Task 2.
- ✅ Spec § 5 edge cases (unknown metric 400, <2 snapshots note, no culprit → null, footprint fail → files:[], null/NaN skipped) → Task 3 code + Task 2 tests + Task 6 tests.
- ✅ Spec § 6 testing (unit + integration + smoke + MCP smoke) → Tasks 2/6/7.
- ✅ Spec § 10 doc checklist → Task 7.

**Placeholder scan:**
- ✅ No "TBD"/"implement later". Full code for core + I/O module + tests.
- ⚠️ Task 5 uses "mirror the neighbor MCP tool" because `mcp-server/server.mjs`'s exact registration API + base URL can't be quoted without reading it; the precise input schema + behavior are given. Intentional.
- ⚠️ Task 4 uses grep-anchored mount instructions (line numbers shift). Precise code given.

**Type/contract consistency:**
- ✅ `locateRegression(series, worseDirection)` returns `{ worstPair, stepDelta, netDelta, regressed, first, last }` — Task 2 def + tests, consumed in Task 3 (`loc.regressed/netDelta/worstPair/first/last`).
- ✅ `rankCulprits(commits, attrField, worseDirection)` returns sorted array — Task 2 def + tests, consumed in Task 3 (`ranked[0]`, `ranked.slice(1,4)`).
- ✅ `METRIC_REGISTRY[metric] = { worseDirection, seriesField, attrField }` — Task 2 def, consumed in Task 3 (`cfg.seriesField`, `cfg.attrField`, `cfg.worseDirection`).
- ✅ `/entropy` timeline field `density`/`modularity` (per exploration) → `series[].value = t[cfg.seriesField]`.
- ✅ `/entropy/commits` `commits[].attributedDensityDelta`/`attributedModularityDelta` (per exploration) → `cfg.attrField`.
- ✅ `/commit/footprint` `{ filesTouched:[{path,status}], message, author, date }` (per exploration) → worstCommit assembly.
- ✅ `handleRegressionRoute(req, url, res)` (no opts) — Task 3 def, Task 4 mount matches (no opts passed).

**Scope:** Phase 1 only (entropy), 7 tasks, ~3-4 days, all web container + MCP. Fits one plan.

Plan ready for execution.

---

## Effort summary

| Task | Estimate |
|---|---|
| 1. Confirm convention (gate) | ~¼j |
| 2. Core pur + 10 unit cases | ~1j |
| 3. I/O module (assemble 3 endpoints) | ~1j |
| 4. Wiring | ~¼j |
| 5. MCP tool + smoke | ~½j |
| 6. Integration test | ~½j |
| 7. Docs + build + smoke | ~½j |
| **Total** | **~3-4 jours** |
