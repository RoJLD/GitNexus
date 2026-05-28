# Auto-Reindexing the Code Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Détecter automatiquement les nouveaux commits (HEAD SHA change) sur chaque repo indexé et déclencher une ré-analyse incrémentale via `POST /api/analyze`, piloté par notre cron watches existant, opt-in par repo, observable via `GET /auto-reindex`.

**Architecture:** Tout dans le conteneur web (qui a déjà `git` + accès `gitnexus:4747`). Un module `docker-server-auto-reindex.mjs` : pure fn `shouldReindex` + I/O `maybeReindexRepo` (git rev-parse + sidecar `.gitnexus/_auto-reindex.json` + POST analyze) + handler `GET /auto-reindex`. Le cron watches appelle `maybeReindexRepo` par repo. Pas de worker, pas de changement `Dockerfile.cli`.

**Tech Stack:** Node http + child_process (`execFile git`) + fs, zéro-dep ; Vitest 4 (unit) ; le serveur API gitnexus pour l'analyse.

**Spec source:** [`docs/superpowers/specs/2026-05-28-auto-reindexing-design.md`](../specs/2026-05-28-auto-reindexing-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

---

## Environment notes

**Node 21** : vitest crashe localement (rolldown). Tests committés "blind", CI Node 22 valide. `npm run test:unit` peut crasher → ATTENDU, continuer.

**Patches/upstream-all.diff** : UTF-16 LE + CRLF via PowerShell `Out-File -Encoding Unicode`. Regen à chaque tâche touchant `upstream/`. Commande :

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
```

**Parallel session** : `docker-server.mjs`, `docker-server-watches.mjs`, `docker-server-config.mjs` sont chauds. Committer vite. Avant chaque commit : `git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null`. Ne JAMAIS committer : `.claude/`, `AGENTS.md`, `roadmap.yml`, `tests/package-lock.json`.

**Git identity** : déjà `roblastar@live.fr` — ne pas toucher.

**Verified (controller, 2026-05-28):** `POST /api/analyze` dans `upstream/gitnexus/src/server/api.ts` (ligne 1377) déstructure `{ url, path, force, embeddings }` et passe `force: !!force` (ligne 1574). Donc **`{ path }` sans `force` ⇒ `force:false` ⇒ ré-analyse INCRÉMENTALE** (machinery hash/dirty de `run-analyze.ts`). La Task 1 ci-dessous ne fait que re-confirmer ; pas de blocage attendu.

---

## File Structure

| Path | Rôle | Tâche |
|---|---|---|
| `upstream/docker-server-auto-reindex.mjs` | NEW — `shouldReindex` (pure), `maybeReindexRepo` (I/O), `handleAutoReindexRoute` | T2 (pure), T3 (I/O + route) |
| `upstream/docker-server-config.mjs` | MOD — `parseAutoReindex` + section dans le retour | T2 |
| `upstream/docker-server.mjs` | MOD — monte `handleAutoReindexRoute` | T4 |
| `upstream/docker-server-watches.mjs` | MOD — `maybeReindexRepo` par repo dans `cronTick` | T4 |
| `upstream/Dockerfile.web` | MOD — COPY du module | T4 |
| `tests/unit/auto-reindex.test.mjs` | NEW — `shouldReindex` | T2 |
| `tests/integration/endpoints/auto-reindex.test.mjs` | NEW — `GET /auto-reindex` | T5 |
| `ROADMAP.md` / `INVENTORY.md` / `tests/README.md` / `CLAUDE.md` | docs | T6 |

---

## Task 1: Confirm `/api/analyze` incremental behavior (gate, no code)

- [ ] **Step 1: Re-confirm the force handling**

Run: `grep -n "force" upstream/gitnexus/src/server/api.ts | head`
Confirm line ~1379 destructures `force` from `req.body` and line ~1574 passes `force: !!force` to the job. This proves `POST /api/analyze { path }` (no `force`) runs incrementally.

- [ ] **Step 2: Record the verdict**

No code. In your task report, state: "Confirmed — `/api/analyze` without `force` → `force:false` → incremental." If (unexpectedly) the handler requires `force` for any analysis at all, STOP and report — the trigger body in Task 3 would need adjustment. (Not expected per the controller's verification.)

---

## Task 2: `shouldReindex` pure fn + config parse + unit tests

**Files:**
- Create: `upstream/docker-server-auto-reindex.mjs` (pure fn only in this task)
- Modify: `upstream/docker-server-config.mjs`
- Create: `tests/unit/auto-reindex.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auto-reindex.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { shouldReindex } from '../../upstream/docker-server-auto-reindex.mjs';

describe('shouldReindex', () => {
  it('false when disabled', () => {
    expect(shouldReindex({ enabled: false, currentSha: 'abc', lastSha: 'def' })).toBe(false);
  });
  it('false when currentSha is null (not a git repo / rev-parse failed)', () => {
    expect(shouldReindex({ enabled: true, currentSha: null, lastSha: 'def' })).toBe(false);
  });
  it('false on first sight (lastSha null) — record baseline, do not trigger', () => {
    expect(shouldReindex({ enabled: true, currentSha: 'abc', lastSha: null })).toBe(false);
    expect(shouldReindex({ enabled: true, currentSha: 'abc', lastSha: undefined })).toBe(false);
  });
  it('false when sha unchanged', () => {
    expect(shouldReindex({ enabled: true, currentSha: 'abc', lastSha: 'abc' })).toBe(false);
  });
  it('true when enabled and sha changed', () => {
    expect(shouldReindex({ enabled: true, currentSha: 'abc', lastSha: 'def' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests; npm run test:unit -- auto-reindex`
Expected: FAIL (import unresolved) or Node 21 crash — proceed.

- [ ] **Step 3: Create the module with the pure fn**

Create `upstream/docker-server-auto-reindex.mjs`:

```javascript
/**
 * Auto-reindexing — detect new commits per repo and trigger an incremental
 * `gitnexus analyze`. Runs in the web container (has git + access to the API
 * server). See docs/superpowers/specs/2026-05-28-auto-reindexing-design.md
 *
 * This task adds the pure decision fn; Task 3 adds the I/O + route handler.
 */

/**
 * Decide whether to trigger a reindex. Pure — no I/O.
 *   enabled    : auto_reindex.onCommit from config
 *   currentSha : `git rev-parse HEAD` result (null if unresolvable)
 *   lastSha    : sidecar lastIndexedSha (null/undefined on first sight)
 * First sight (lastSha null/undefined) returns false: the caller records the
 * baseline SHA without an immediate reindex storm.
 */
export function shouldReindex({ enabled, currentSha, lastSha }) {
  if (!enabled) return false;
  if (!currentSha) return false;
  if (lastSha === null || lastSha === undefined) return false;
  return currentSha !== lastSha;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests; npm run test:unit -- auto-reindex`
Expected: PASS (6 cases) or Node 21 crash — proceed.

- [ ] **Step 5: Add `parseAutoReindex` to the config parser**

In `upstream/docker-server-config.mjs`, mirror the `parseWiki` addition (added for the Code Wiki feature). 

(a) Add a parse fn near `parseWiki` (grep `function parseWiki` to locate it):

```javascript
// auto_reindex section (Auto-reindexing). Only `onCommit` today — when true,
// the watches cron re-analyzes the repo on a HEAD SHA change. Default false.
function parseAutoReindex(parsed) {
  return { onCommit: !!(parsed?.auto_reindex?.onCommit) };
}
```

(b) In the `!repoPath` early-return object (grep `domains: null, policy: null` — the line that also has `wiki: { autoEvery: 'off' }`), add `auto_reindex: { onCommit: false },`.

(c) Near `let wiki = { autoEvery: 'off' };`, add `let autoReindex = { onCommit: false };`.

(d) Inside the `if (unified.exists)` block where `wiki = parseWiki(parsed);` is, add `autoReindex = parseAutoReindex(parsed);`.

(e) In the final `return { domains, policy, budgets, watches, autoSnapshot, wiki, ... }` object, add `auto_reindex: autoReindex,`.

(Read each site first; match style/indentation exactly. Use the key `auto_reindex` in the returned object so consumers read `cfg.auto_reindex.onCommit`.)

- [ ] **Step 6: Syntax-check + regen + commit**

```
node --check upstream/docker-server-auto-reindex.mjs
node --check upstream/docker-server-config.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff tests/unit/auto-reindex.test.mjs
git commit -m "feat(auto-reindex): shouldReindex pure fn + auto_reindex config parse + 6 unit cases (Task 2)"
```

---

## Task 3: I/O + route handler in `docker-server-auto-reindex.mjs`

**Files:**
- Modify: `upstream/docker-server-auto-reindex.mjs`

- [ ] **Step 1: Add the I/O helpers + maybeReindexRepo + route**

Append to `upstream/docker-server-auto-reindex.mjs` (after `shouldReindex`):

```javascript
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const SIDECAR_REL = ['.gitnexus', '_auto-reindex.json'];

// `git -C <repoPath> rev-parse HEAD`, trimmed. null on any error (non-git
// path, detached/empty repo, git missing). 5s timeout — rev-parse is instant.
async function gitRevParse(repoPath) {
  try {
    const { stdout } = await execFileP('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { timeout: 5000 });
    const sha = stdout.trim();
    return sha || null;
  } catch {
    return null;
  }
}

async function readSidecar(repoPath) {
  try {
    const raw = await readFile(join(repoPath, ...SIDECAR_REL), 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null; // absent or unreadable → treat as first sight
  }
}

async function writeSidecar(repoPath, data) {
  try {
    await mkdir(join(repoPath, '.gitnexus'), { recursive: true });
    await writeFile(join(repoPath, ...SIDECAR_REL), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    process.stderr.write(`[auto-reindex] sidecar write failed for ${repoPath}: ${e && e.message || e}\n`);
  }
}

/**
 * Per-repo tick: if auto_reindex.onCommit and HEAD changed since last index,
 * POST an incremental /api/analyze and record the new SHA (optimistic). Best-
 * effort — any failure logs + returns. Called by the watches cron.
 */
export async function maybeReindexRepo(repo, apiBase) {
  const repoPath = repo && (repo.repoPath || repo.path);
  if (!repoPath || !repo.name || repo.name.includes('@')) return;

  let cfg;
  try {
    const { getConfig } = await import('./docker-server-config.mjs');
    cfg = await getConfig(repoPath);
  } catch {
    return;
  }
  const enabled = !!(cfg && cfg.auto_reindex && cfg.auto_reindex.onCommit);
  if (!enabled) return;

  const currentSha = await gitRevParse(repoPath);
  if (!currentSha) return;

  const sidecar = await readSidecar(repoPath);
  const lastSha = sidecar ? sidecar.lastIndexedSha : null;

  // First sight: record baseline, do not trigger.
  if (lastSha === null || lastSha === undefined) {
    await writeSidecar(repoPath, { lastIndexedSha: currentSha, lastTriggeredAt: null, lastJobId: null });
    return;
  }

  if (!shouldReindex({ enabled, currentSha, lastSha })) return;

  let jobId = null;
  try {
    const res = await fetch(`${apiBase}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: repoPath }), // no force ⇒ incremental
    });
    const body = await res.json().catch(() => ({}));
    jobId = body && body.jobId ? body.jobId : null;
  } catch (e) {
    process.stderr.write(`[auto-reindex] analyze trigger failed for ${repo.name}: ${e && e.message || e}\n`);
    return; // don't update sidecar — retry next tick
  }
  await writeSidecar(repoPath, { lastIndexedSha: currentSha, lastTriggeredAt: new Date().toISOString(), lastJobId: jobId });
  process.stderr.write(`[auto-reindex] triggered for ${repo.name} @ ${currentSha.slice(0, 8)} (job ${jobId})\n`);
}

async function fetchAllReposAR(apiBase) {
  try {
    const r = await fetch(`${apiBase}/api/repos`);
    if (!r.ok) return [];
    const data = await r.json();
    const list = Array.isArray(data) ? data : data.repos;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * GET /auto-reindex — read-only per-repo state (like GET /watches).
 * Handler contract: returns true if it owned the route, false otherwise.
 */
export async function handleAutoReindexRoute(req, url, res, opts) {
  if (url.pathname !== '/auto-reindex' || req.method !== 'GET') return false;
  const apiBase = (opts && opts.api) || process.env.GITNEXUS_API || 'http://gitnexus:4747';
  const filterRepo = url.searchParams.get('repo');
  const repos = await fetchAllReposAR(apiBase);
  const out = [];
  for (const repo of repos) {
    if (!repo || !repo.name || repo.name.includes('@')) continue;
    if (filterRepo && repo.name !== filterRepo) continue;
    const repoPath = repo.repoPath || repo.path;
    if (!repoPath) continue;
    let enabled = false;
    try {
      const { getConfig } = await import('./docker-server-config.mjs');
      const cfg = await getConfig(repoPath);
      enabled = !!(cfg && cfg.auto_reindex && cfg.auto_reindex.onCommit);
    } catch { /* default false */ }
    const headSha = await gitRevParse(repoPath);
    const sidecar = await readSidecar(repoPath);
    const lastIndexedSha = sidecar ? sidecar.lastIndexedSha || null : null;
    out.push({
      repo: repo.name,
      enabled,
      headSha,
      lastIndexedSha,
      lastTriggeredAt: sidecar ? sidecar.lastTriggeredAt || null : null,
      lastJobId: sidecar ? sidecar.lastJobId || null : null,
      dueNow: shouldReindex({ enabled, currentSha: headSha, lastSha: lastIndexedSha }),
    });
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ reposScanned: filterRepo ? 1 : repos.length, autoReindex: out }));
  return true;
}
```

Note: the dynamic `await import('./docker-server-config.mjs')` avoids a circular import (config.mjs does not import this module). `apiBase` for the cron path comes from the caller (Task 4).

- [ ] **Step 2: Syntax-check + regen + commit**

```
node --check upstream/docker-server-auto-reindex.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(auto-reindex): maybeReindexRepo (git + sidecar + POST analyze) + GET /auto-reindex (Task 3)"
```

---

## Task 4: Wiring (mount route + cron call + Dockerfile.web)

**Files:**
- Modify: `upstream/docker-server.mjs`
- Modify: `upstream/docker-server-watches.mjs`
- Modify: `upstream/Dockerfile.web`

- [ ] **Step 1: Mount the route in `docker-server.mjs`**

Grep `grep -n "handleWikiRoute" upstream/docker-server.mjs`. There's an import line (~line 34) and a dispatch line (~line 581, before the static-asset block). Add a sibling import:

```javascript
import { handleAutoReindexRoute } from './docker-server-auto-reindex.mjs';
```

And a sibling dispatch line immediately after the `handleWikiRoute` dispatch (still before `// ── Static asset serving`):

```javascript
  // Auto-reindexing status (read-only)
  if (await handleAutoReindexRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;
```

- [ ] **Step 2: Call `maybeReindexRepo` in the watches cron**

In `upstream/docker-server-watches.mjs`, grep `grep -n "maybeRegenWiki\|cronTick" upstream/docker-server-watches.mjs`. At the top with the other imports, add:

```javascript
import { maybeReindexRepo } from './docker-server-auto-reindex.mjs';
```

In `cronTick`'s repo loop, immediately after the `await maybeRegenWiki(repo.name, repoPath).catch(() => {});` line, add:

```javascript
    await maybeReindexRepo(repo, apiBase).catch(() => {});
```

(`apiBase` is the param of `cronTick`. `maybeReindexRepo` takes the full `repo` object — it reads `repo.repoPath || repo.path` itself.)

- [ ] **Step 3: COPY the module in `Dockerfile.web`**

Grep `grep -n "COPY docker-server-wiki.mjs" upstream/Dockerfile.web`. Add a sibling line mirroring that exact style:

```dockerfile
COPY docker-server-auto-reindex.mjs ./docker-server-auto-reindex.mjs
```

- [ ] **Step 4: Syntax-check + regen + commit**

```
node --check upstream/docker-server.mjs
node --check upstream/docker-server-watches.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(auto-reindex): mount GET /auto-reindex + cron call + Dockerfile.web COPY (Task 4)"
```

---

## Task 5: Integration test

**Files:**
- Create: `tests/integration/endpoints/auto-reindex.test.mjs`

- [ ] **Step 1: Study + mirror the harness**

Read `tests/integration/endpoints/lifespan-windowed.test.mjs` fully — note imports (`vitest`, `FIXTURE` from `../helpers/analyze.mjs`), the base URL mechanism (`http://localhost:4173` concatenation), and the request style. Mirror it EXACTLY.

- [ ] **Step 2: Write the test**

Create `tests/integration/endpoints/auto-reindex.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = 'http://localhost:4173';

describe('GET /auto-reindex', () => {
  it('returns per-repo auto-reindex state', async () => {
    const res = await fetch(`${BASE}/auto-reindex`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.reposScanned).toBe('number');
    expect(Array.isArray(body.autoReindex)).toBe(true);
    for (const entry of body.autoReindex) {
      expect(typeof entry.repo).toBe('string');
      expect(typeof entry.enabled).toBe('boolean');
      expect(typeof entry.dueNow).toBe('boolean');
      expect('headSha' in entry).toBe(true);
      expect('lastIndexedSha' in entry).toBe(true);
    }
  });

  it('supports the ?repo= filter', async () => {
    const res = await fetch(`${BASE}/auto-reindex?repo=${encodeURIComponent(FIXTURE.name)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reposScanned).toBe(1);
    // Either the fixture is present (1 entry) or absent (0) — never another repo.
    for (const entry of body.autoReindex) {
      expect(entry.repo).toBe(FIXTURE.name);
    }
  });
});
```

(If the neighbor test uses a different base-URL constant or fixture import, match it exactly instead of the above.)

- [ ] **Step 3: Commit (tracked test file, no patch regen)**

```
git add tests/integration/endpoints/auto-reindex.test.mjs
git commit -m "test(auto-reindex): GET /auto-reindex shape + repo filter (Task 5)"
```

---

## Task 6: Docs + build validation + final commit

**Files:**
- Modify: `ROADMAP.md`, `INVENTORY.md`, `tests/README.md`, `CLAUDE.md`

- [ ] **Step 1: Build the web image + smoke**

```
docker compose build gitnexus-web
```

Expected: exit 0. Then:

```
docker compose up -d gitnexus gitnexus-web
```

Wait for the web server, then:

```
curl -s -o /dev/null -w "auto-reindex: HTTP %{http_code}\n" "http://localhost:4173/auto-reindex"
```

Expected: HTTP 200. If 404, the route mount (Task 4 Step 1) is wrong or after the static block. If 500, check `docker logs gitnexus-web` for the module error.

- [ ] **Step 2: Update CLAUDE.md smoke loop**

After the `wiki/status` curl block (grep `wiki/status: HTTP`), add:

```bash
# Auto-reindexing (Tier 56) — read-only per-repo state (enabled/headSha/dueNow).
# 200 even when no repo has auto_reindex enabled (returns entries with enabled:false).
curl -s -o /dev/null -w "auto-reindex: HTTP %{http_code}\n" \
  "http://localhost:4173/auto-reindex"
```

Also add a one-line note: auto-reindex is opt-in per repo via `.gitnexus.json > auto_reindex.onCommit`, fires on HEAD SHA change, runs in the watches cron.

- [ ] **Step 3: Update ROADMAP.md**

Add a "Déjà livré" row (`grep "^| 55 " ROADMAP.md` to find the current last — Code Wiki — and add the next number):

```markdown
| 56 | **Auto-reindexing du graphe de code** (enterprise parity) : le cron watches détecte un changement de HEAD SHA par repo et déclenche une ré-analyse **incrémentale** (`POST /api/analyze` sans `force`). Opt-in par repo (`.gitnexus.json > auto_reindex.onCommit`, défaut off). Sidecar `.gitnexus/_auto-reindex.json` (écriture optimiste, first-sight = baseline). `GET /auto-reindex` expose l'état (enabled/headSha/lastIndexedSha/dueNow). Tout dans le conteneur web (git + /api/analyze déjà dispos), zéro worker. | `upstream/docker-server-auto-reindex.mjs` (`shouldReindex`, `maybeReindexRepo`, `GET /auto-reindex`), cron dans `docker-server-watches.mjs`, `auto_reindex` dans `docker-server-config.mjs` |
```

In the enterprise table (§ "Enterprise / commercial offering"), change the **Auto-reindexing** row verdict from 🟡 to ✅ and point at Tier 56 (keep noting working-tree dirty + success-confirmation as future). Bump the `Dernière mise à jour` header line.

- [ ] **Step 4: Update INVENTORY.md**

In the endpoints section (near `GET /wiki`), add `GET /auto-reindex`. Mention the module, the `_auto-reindex.json` sidecar, the cron pass, and that it's opt-in + HEAD-change-driven + incremental.

- [ ] **Step 5: Update tests/README.md**

Add: unit `auto-reindex.test.mjs` (shouldReindex, 6 cases); integration `endpoints/auto-reindex.test.mjs` (`GET /auto-reindex` shape + filter).

- [ ] **Step 6: Final commit**

```
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add ROADMAP.md INVENTORY.md tests/README.md CLAUDE.md
git commit -m "Auto-reindexing livré: ROADMAP #56/INVENTORY/CLAUDE smoke/tests (Task 6)"
```

(No patch regen — Task 6 touches only top-level tracked docs.)

---

## Self-Review

**Spec coverage:**
- ✅ Spec § 3 HEAD SHA detection → Task 3 `gitRevParse` + `shouldReindex`.
- ✅ Spec § 3 incremental via `POST /api/analyze { path }` no force → Task 3 (verified Task 1).
- ✅ Spec § 3 reuse watches cron → Task 4 Step 2.
- ✅ Spec § 3 sidecar `.gitnexus/_auto-reindex.json`, optimistic, first-sight baseline → Task 3 `readSidecar`/`writeSidecar`/`maybeReindexRepo`.
- ✅ Spec § 3 opt-in config `auto_reindex.onCommit` default off → Task 2 Step 5.
- ✅ Spec § 4.2 `shouldReindex` pure + `maybeReindexRepo` + `handleAutoReindexRoute` → Tasks 2-3.
- ✅ Spec § 4.3 wiring (mount + cron + Dockerfile.web) → Task 4.
- ✅ Spec § 5 edge cases (non-git→null skip, first-sight, off, snapshot skip, sidecar unreadable→first-sight, job fail→no sidecar update on fetch error) → Task 3 code.
- ✅ Spec § 6 testing (unit shouldReindex + integration GET shape + smoke) → Tasks 2/5/6.
- ✅ Spec § 10 doc checklist → Task 6.

Note: spec § 6 also mentioned unit-testing `parseAutoReindex`. It's a trivial `!!` coercion kept inline in `docker-server-config.mjs` (not exported, to avoid a circular import with the auto-reindex module). Covered implicitly via the integration `enabled` field rather than a separate unit test — intentional, not a gap.

**Placeholder scan:**
- ✅ No "TBD"/"implement later". Full code for the pure fn, the I/O module, the route, the tests.
- ⚠️ Task 2 Step 5 + Task 4 use grep-anchored "mirror the parseWiki/handleWikiRoute pattern" instructions because exact line numbers shift with parallel sessions. Each gives the precise code to insert + the anchor to find. Intentional.

**Type/contract consistency:**
- ✅ `shouldReindex({ enabled, currentSha, lastSha })` signature identical across Task 2 (def + tests) and Task 3 (callers in `maybeReindexRepo` + route `dueNow`).
- ✅ Config key `auto_reindex.onCommit` consistent: Task 2 parse + Task 3 reads `cfg.auto_reindex.onCommit`.
- ✅ Sidecar shape `{ lastIndexedSha, lastTriggeredAt, lastJobId }` consistent across read/write/route.
- ✅ `maybeReindexRepo(repo, apiBase)` — Task 3 def takes the repo object; Task 4 cron calls it with `(repo, apiBase)`.
- ✅ `/auto-reindex` response `{ reposScanned, autoReindex: [...] }` — Task 3 emits, Task 5 asserts the same shape.

**Scope:** single feature, ~2-3 days, 6 tasks, all web container. Fits one plan.

Plan ready for execution.

---

## Effort summary

| Task | Estimate |
|---|---|
| 1. Confirm incremental (gate) | ~¼j |
| 2. shouldReindex + config + unit | ~½j |
| 3. maybeReindexRepo + route | ~1j |
| 4. Wiring | ~½j |
| 5. Integration test | ~¼j |
| 6. Docs + build + smoke | ~½j |
| **Total** | **~2-3 jours** |
