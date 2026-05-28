# Code Wiki in the Web UI + Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surfacer le Code Wiki upstream dans l'UI web (panel iframe), avec génération à la demande (bouton) + auto-update sur intervalle configurable piloté par notre cron watches, via un worker dans le conteneur `gitnexus-server` qui spawn la CLI publique `gitnexus wiki`.

**Architecture:** Le générateur n'existe que dans le conteneur `gitnexus-server`. On y ajoute `wiki-worker.mjs` (HTTP :4748, spawn la CLI headless). Le conteneur `gitnexus-web` sert l'`index.html` généré (volume partagé) + proxy les triggers + status. Le cron watches existant déclenche les régénérations dues. Un `WikiPanel.tsx` affiche le tout en iframe.

**Tech Stack:** Node http zéro-dep (worker + docker-server pattern), React 19 + TS, Vitest 4 (unit), Playwright (e2e), Docker Compose.

**Spec source:** [`docs/superpowers/specs/2026-05-28-code-wiki-web-ui-design.md`](../specs/2026-05-28-code-wiki-web-ui-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

---

## Environment notes

**Node 21 limitation** : vitest crashe localement (rolldown). Tests committés "blind", CI Node 22 valide. Si `npm run test:unit` crashe → ATTENDU, continuer.

**Patches/upstream-all.diff** : UTF-16 LE + CRLF via PowerShell `Out-File -Encoding Unicode`. Regen à chaque tâche touchant `upstream/`. Commande :

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
```

**Parallel session** : `useAppState.tsx`, `App.tsx` chauds. Committer vite. Avant chaque commit : `git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null` (PowerShell). Ne JAMAIS committer : `.claude/`, `AGENTS.md`, `roadmap.yml`, `tests/package-lock.json`.

**Git identity** : déjà `roblastar@live.fr` — ne pas toucher.

**Build validation** : ce feature touche 2 Dockerfiles + docker-compose. La validation finale (Task 11) lance `docker compose build` des DEUX images + un `docker compose up` smoke. Ne pas considérer livré sans ça.

---

## File Structure

| Path | Rôle | Tâche |
|---|---|---|
| `upstream/gitnexus-web/src/lib/wiki-schedule.ts` | NEW — pure fn `isWikiRegenDue` | T2 |
| `upstream/wiki-worker.mjs` | NEW — conteneur server : HTTP :4748, spawn CLI, status | T3 |
| `upstream/Dockerfile.cli` | MOD — COPY worker + wrapper d'entrypoint (2 process) | T4 |
| `upstream/docker-server-wiki.mjs` | NEW — conteneur web : serve + proxy + status | T5 |
| `upstream/docker-server.mjs` | MOD — monte handleWikiRoute | T5 |
| `upstream/Dockerfile.web` | MOD — COPY docker-server-wiki.mjs | T5 |
| `upstream/docker-server-config.mjs` | MOD — parse section `wiki` | T6 |
| `upstream/docker-server-watches.mjs` | MOD — passe wiki-regen dans le cron | T7 |
| `upstream/gitnexus-web/src/components/WikiPanel.tsx` | NEW — iframe + Regenerate + status | T8 |
| `upstream/gitnexus-web/src/hooks/useAppState.tsx` | MOD — `isWikiPanelOpen` + toggle | T8 |
| (panel registration — App.tsx / RightPanel / toolbar) | MOD — bouton + render WikiPanel | T8 |
| `docker-compose.yml` | MOD — env LLM sur gitnexus-server | T9 |
| `tests/unit/wiki-schedule.test.mjs` | NEW | T2 |
| `tests/integration/endpoints/wiki.test.mjs` | NEW | T10 |
| `tests/e2e/specs/wiki-panel.spec.ts` | NEW | T10 |
| `ROADMAP.md` / `INVENTORY.md` / `tests/README.md` / `CLAUDE.md` | docs | T11 |

---

## Task 1: Verify shared volume (BLOCKING gate, no code)

The web container must read `.gitnexus/wiki/` **written by** the server container. If they don't share the repo-data path, the whole feature can't serve. Verify before writing any code.

- [ ] **Step 1: Read the compose volumes**

Run: `grep -nE "volumes:|/data|/workspace|gitnexus-web|gitnexus-server|image:|build:" docker-compose.yml` then read the full `docker-compose.yml`.

- [ ] **Step 2: Confirm or fix**

Confirm BOTH `gitnexus-server` and `gitnexus-web` mount the same volume covering the repo data root (where `<repo>/.gitnexus/wiki/` lives — likely `/data` per `GITNEXUS_HOME=/data/gitnexus` in `Dockerfile.cli`). 

- If both already share it → record the exact mounted path (e.g. `/data`) in your task report; proceed.
- If `gitnexus-web` does NOT mount the data volume → add the same volume mount (read-only is fine for the web container, e.g. `- gitnexus-data:/data:ro`) so it can read the wiki HTML. Make the minimal compose edit.

- [ ] **Step 3: Commit only if compose changed**

```
git add docker-compose.yml
git commit -m "chore(wiki): ensure gitnexus-web mounts repo-data volume to serve wiki HTML (Task 1)"
```

If no change was needed, skip the commit and note "volume already shared at <path>" in your report.

---

## Task 2: Pure fn `isWikiRegenDue` + unit tests

**Files:**
- Create: `upstream/gitnexus-web/src/lib/wiki-schedule.ts`
- Create: `tests/unit/wiki-schedule.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/wiki-schedule.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { isWikiRegenDue, parseAutoEvery } from '../../upstream/gitnexus-web/src/lib/wiki-schedule';

describe('parseAutoEvery', () => {
  it('parses h/d units to ms', () => {
    expect(parseAutoEvery('1h')).toBe(3_600_000);
    expect(parseAutoEvery('24h')).toBe(86_400_000);
    expect(parseAutoEvery('7d')).toBe(604_800_000);
  });
  it('returns null for off / undefined / malformed', () => {
    expect(parseAutoEvery('off')).toBeNull();
    expect(parseAutoEvery(undefined)).toBeNull();
    expect(parseAutoEvery('')).toBeNull();
    expect(parseAutoEvery('garbage')).toBeNull();
    expect(parseAutoEvery('10x')).toBeNull();
  });
});

describe('isWikiRegenDue', () => {
  const now = Date.parse('2026-05-28T12:00:00.000Z');
  it('false when autoEvery is off/undefined', () => {
    expect(isWikiRegenDue(null, 'off', now)).toBe(false);
    expect(isWikiRegenDue(Date.parse('2026-05-01T00:00:00Z'), undefined, now)).toBe(false);
  });
  it('true when never generated and autoEvery set', () => {
    expect(isWikiRegenDue(null, '24h', now)).toBe(true);
  });
  it('false when interval not elapsed', () => {
    const last = now - 3_600_000; // 1h ago
    expect(isWikiRegenDue(last, '24h', now)).toBe(false);
  });
  it('true when interval elapsed', () => {
    const last = now - 90_000_000; // ~25h ago
    expect(isWikiRegenDue(last, '24h', now)).toBe(true);
  });
  it('false on malformed autoEvery (no regen on broken config)', () => {
    expect(isWikiRegenDue(null, 'garbage', now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests; npm run test:unit -- wiki-schedule`
Expected: FAIL (import unresolved) or Node 21 crash — proceed.

- [ ] **Step 3: Implement `wiki-schedule.ts`**

Create `upstream/gitnexus-web/src/lib/wiki-schedule.ts`:

```typescript
/**
 * Pure scheduling helper for Code Wiki auto-regeneration. No DOM, no React.
 * See docs/superpowers/specs/2026-05-28-code-wiki-web-ui-design.md § 4.4
 */

/** Parse an autoEvery string ('1h', '24h', '7d') to milliseconds. 'off',
 *  undefined, empty, or malformed → null (no auto-regen). */
export function parseAutoEvery(autoEvery: string | undefined | null): number | null {
  if (!autoEvery || autoEvery === 'off') return null;
  const m = /^(\d+)([hd])$/.exec(autoEvery.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2] === 'h' ? n * 3_600_000 : n * 86_400_000;
}

/** True when a regen is due. lastGeneratedAt is ms epoch or null (never). */
export function isWikiRegenDue(
  lastGeneratedAt: number | null,
  autoEvery: string | undefined | null,
  now: number,
): boolean {
  const intervalMs = parseAutoEvery(autoEvery);
  if (intervalMs === null) return false;
  if (lastGeneratedAt === null) return true;
  return now - lastGeneratedAt >= intervalMs;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests; npm run test:unit -- wiki-schedule`
Expected: PASS (12 cases) or Node 21 crash — proceed.

- [ ] **Step 5: Regen patches + commit**

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff tests/unit/wiki-schedule.test.mjs
git commit -m "feat(wiki): isWikiRegenDue + parseAutoEvery pure fns + 12 unit cases (Task 2)"
```

---

## Task 3: `wiki-worker.mjs` (server container HTTP trigger)

**Files:**
- Create: `upstream/wiki-worker.mjs`

This runs INSIDE the `gitnexus-server` container (where `/usr/local/bin/gitnexus` + the data volume live). Zero-dep Node, mirrors our docker-server style.

- [ ] **Step 1: Write the worker**

Create `upstream/wiki-worker.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Code Wiki generation worker — runs in the gitnexus-server container next to
 * the API server. Exposes a tiny HTTP trigger that spawns the public
 * `gitnexus wiki <repoPath>` CLI headlessly (non-TTY → LLM config from env:
 * GITNEXUS_API_KEY / GITNEXUS_MODEL / GITNEXUS_LLM_BASE_URL). Generation is
 * async (minutes); the trigger returns 202 immediately. Status is reported via
 * an in-memory map + the mtime of <repoPath>/.gitnexus/wiki/meta.json.
 *
 * Zero-dep (Node http + child_process + fs). See spec § 4.2.
 * Internal port 4748 (compose-internal, not host-exposed).
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.WIKI_WORKER_PORT) || 4748;
const API = process.env.GITNEXUS_API || 'http://localhost:4747';
const GITNEXUS_BIN = process.env.GITNEXUS_BIN || 'gitnexus';

// repoName -> { generating: bool, error: string|null, finishedAt: number|null }
const state = new Map();

async function resolveRepoPath(name) {
  try {
    const res = await fetch(`${API}/api/repos`);
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.repos;
    const repo = Array.isArray(list) ? list.find((r) => r.name === name) : null;
    return repo ? repo.repoPath || repo.path || null : null;
  } catch {
    return null;
  }
}

function lastGeneratedAt(repoPath) {
  try {
    return statSync(join(repoPath, '.gitnexus', 'wiki', 'meta.json')).mtimeMs;
  } catch {
    return null;
  }
}

function startGeneration(name, repoPath) {
  state.set(name, { generating: true, error: null, finishedAt: null });
  // Non-interactive: CLI reads LLM config from env. Inherit container env.
  const child = spawn(GITNEXUS_BIN, ['wiki', repoPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });
  child.on('error', (err) => {
    state.set(name, { generating: false, error: String(err && err.message || err), finishedAt: Date.now() });
  });
  child.on('close', (code) => {
    state.set(name, {
      generating: false,
      error: code === 0 ? null : `gitnexus wiki exited ${code}: ${stderr.trim().slice(-500)}`,
      finishedAt: Date.now(),
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const repo = url.searchParams.get('repo');
  const json = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/generate' && req.method === 'POST') {
    if (!repo) return json(400, { error: 'missing repo' });
    const cur = state.get(repo);
    if (cur && cur.generating) return json(409, { generating: true });
    const repoPath = await resolveRepoPath(repo);
    if (!repoPath) return json(404, { error: 'repo not found' });
    startGeneration(repo, repoPath);
    return json(202, { started: true });
  }

  if (url.pathname === '/status' && req.method === 'GET') {
    if (!repo) return json(400, { error: 'missing repo' });
    const repoPath = await resolveRepoPath(repo);
    const cur = state.get(repo) || { generating: false, error: null };
    const lga = repoPath ? lastGeneratedAt(repoPath) : null;
    return json(200, {
      generating: !!cur.generating,
      lastGeneratedAt: lga ? new Date(lga).toISOString() : null,
      error: cur.error || null,
    });
  }

  if (url.pathname === '/health') return json(200, { ok: true });
  json(404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`[wiki-worker] listening on :${PORT} · bin=${GITNEXUS_BIN} · api=${API}\n`);
});
```

- [ ] **Step 2: Syntax-check**

Run: `node --check upstream/wiki-worker.mjs`
Expected: no output (valid). (This only checks syntax, not runtime — runtime is validated in Task 11's docker build.)

- [ ] **Step 3: Regen patches + commit**

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(wiki): wiki-worker.mjs — HTTP trigger spawns gitnexus wiki CLI (Task 3)"
```

---

## Task 4: `Dockerfile.cli` — COPY worker + run alongside API server

**Files:**
- Modify: `upstream/Dockerfile.cli`

- [ ] **Step 1: COPY the worker into the runtime stage**

In `upstream/Dockerfile.cli`, in the **runtime** stage (after the existing `COPY --from=builder ... ./gitnexus/dist` block, around line 55-59), add:

```dockerfile
# Code Wiki generation worker (our addition) — runs next to the API server.
COPY --chown=node:node wiki-worker.mjs ./wiki-worker.mjs
```

(Note: `wiki-worker.mjs` is at the build-context root — same place the Dockerfile is. Confirm the compose build context for `gitnexus-server` includes it; if the context is `upstream/`, the path is `wiki-worker.mjs`.)

- [ ] **Step 2: Replace the CMD to run both processes**

The current final line is:

```dockerfile
CMD ["node", "gitnexus/dist/cli/index.js", "serve", "--host", "0.0.0.0", "--port", "4747"]
```

Replace it with a shell form that backgrounds the worker (non-fatal) and execs the API server as the main process (so signals/health target the API server):

```dockerfile
# Run the wiki worker in the background (non-fatal: if it dies the API server
# stays up as the container's main process), then exec the API server.
CMD ["sh", "-c", "node /app/wiki-worker.mjs & exec node gitnexus/dist/cli/index.js serve --host 0.0.0.0 --port 4747"]
```

- [ ] **Step 3: Commit (Dockerfile.cli is a top-level tracked file, no patch regen)**

Note: `upstream/Dockerfile.cli` — check whether it's tracked at top level or only via the patch. Run `git status upstream/Dockerfile.cli`. The repo `.gitignore`s `upstream/` EXCEPT specific files; if `Dockerfile.cli` shows as ignored, it goes through the patch regen instead. **Most likely** `upstream/` is fully gitignored and ALL upstream edits go through `patches/upstream-all.diff`. So regen + commit the patch:

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(wiki): Dockerfile.cli runs wiki-worker alongside API server (Task 4)"
```

---

## Task 5: `docker-server-wiki.mjs` (web container serve + proxy)

**Files:**
- Create: `upstream/docker-server-wiki.mjs`
- Modify: `upstream/docker-server.mjs` (mount the handler)
- Modify: `upstream/Dockerfile.web` (COPY the module)

- [ ] **Step 1: Write the handler module**

Create `upstream/docker-server-wiki.mjs`:

```javascript
/**
 * Code Wiki routes (web container). Serves the generated index.html from the
 * shared volume, and proxies generate/status to the wiki-worker in the
 * gitnexus-server container. See spec § 4.3.
 *
 * Handler contract: returns true if it owned the route, false otherwise.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

const WORKER = process.env.WIKI_WORKER_URL || 'http://gitnexus:4748';

async function findRepoPath(api, name) {
  try {
    const res = await fetch(`${api}/api/repos`);
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.repos;
    const repo = Array.isArray(list) ? list.find((r) => r.name === name) : null;
    return repo ? repo.repoPath || repo.path || null : null;
  } catch {
    return null;
  }
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function handleWikiRoute(req, url, res, opts) {
  const api = (opts && opts.api) || process.env.GITNEXUS_API || 'http://gitnexus:4747';
  const path = url.pathname;
  const repo = url.searchParams.get('repo');

  // Serve the generated wiki HTML (iframe src).
  if (path === '/wiki' && req.method === 'GET') {
    if (!repo) { sendJson(res, 400, { error: 'missing repo' }); return true; }
    const repoPath = await findRepoPath(api, repo);
    if (!repoPath) { sendJson(res, 404, { error: 'repo not found' }); return true; }
    const indexPath = join(repoPath, '.gitnexus', 'wiki', 'index.html');
    const st = await stat(indexPath).catch(() => null);
    if (!st || !st.isFile()) { sendJson(res, 404, { error: 'no wiki yet' }); return true; }
    // Deliberately NOT setting COEP require-corp here so the wiki's CDN
    // (marked/mermaid) subresources are not blocked. CORP same-origin lets the
    // same-origin app embed it.
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    const stream = createReadStream(indexPath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
  }

  // Trigger generation (proxy to the worker).
  if (path === '/wiki/generate' && req.method === 'POST') {
    if (!repo) { sendJson(res, 400, { error: 'missing repo' }); return true; }
    try {
      const wres = await fetch(`${WORKER}/generate?repo=${encodeURIComponent(repo)}`, { method: 'POST' });
      const body = await wres.json().catch(() => ({}));
      sendJson(res, wres.status, body);
    } catch (e) {
      sendJson(res, 502, { error: `wiki worker unreachable: ${e && e.message || e}` });
    }
    return true;
  }

  // Generation status (proxy to the worker).
  if (path === '/wiki/status' && req.method === 'GET') {
    if (!repo) { sendJson(res, 400, { error: 'missing repo' }); return true; }
    try {
      const wres = await fetch(`${WORKER}/status?repo=${encodeURIComponent(repo)}`);
      const body = await wres.json().catch(() => ({}));
      sendJson(res, wres.status, body);
    } catch (e) {
      sendJson(res, 502, { error: `wiki worker unreachable: ${e && e.message || e}` });
    }
    return true;
  }

  return false;
}
```

- [ ] **Step 2: Mount it in `docker-server.mjs`**

Find the import block where other handlers are imported (grep `import { handleClustersRoute }` or similar). Add:

```javascript
import { handleWikiRoute } from './docker-server-wiki.mjs';
```

Then find the handler-chain (around line 575-578, the `if (await handleClustersRoute(...)) return;` block, BEFORE the `// ── Static asset serving` comment at line 580). Add:

```javascript
  // Code Wiki (serve generated HTML + proxy generate/status to wiki-worker)
  if (await handleWikiRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;
```

It MUST be added before the static-asset fallthrough (so `/wiki` isn't swallowed by static serving).

- [ ] **Step 3: COPY the module in `Dockerfile.web`**

Find the block of `COPY docker-server-*.mjs` lines in `upstream/Dockerfile.web` (grep `COPY docker-server`). Add a line mirroring the existing pattern:

```dockerfile
COPY docker-server-wiki.mjs ./docker-server-wiki.mjs
```

(Match the exact COPY style used by the neighbors — some use `--chown`, some don't. Mirror the adjacent lines precisely.)

- [ ] **Step 4: Syntax-check + regen + commit**

```
node --check upstream/docker-server-wiki.mjs
node --check upstream/docker-server.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(wiki): docker-server-wiki.mjs (serve+proxy+status) mounted in web server (Task 5)"
```

---

## Task 6: Parse the `wiki` config section

**Files:**
- Modify: `upstream/docker-server-config.mjs`

- [ ] **Step 1: Inspect the existing parser**

Run: `grep -n "export function\|export async function\|domains\|policy\|budgets\|watches\|function read\|\.gitnexus" upstream/docker-server-config.mjs | head -30` and read the function that loads `.gitnexus.json` and returns the parsed sections.

- [ ] **Step 2: Add `wiki` to the parsed shape**

Following the EXACT pattern used for an existing optional section (e.g. how `watches` or `auto_snapshot` is read and defaulted), add a `wiki` section so the parsed config exposes `wiki.autoEvery` (string, default `'off'`). Concretely, wherever the parser builds its result object from the raw JSON, add:

```javascript
    wiki: {
      autoEvery: (raw && raw.wiki && typeof raw.wiki.autoEvery === 'string') ? raw.wiki.autoEvery : 'off',
    },
```

(Adapt `raw` to the actual variable name the parser uses for the loaded JSON. If the parser exposes a typed default object, add the same `wiki` default there too. Keep backward-compat: absence of a `wiki` section → `autoEvery: 'off'`.)

- [ ] **Step 3: Syntax-check + regen + commit**

```
node --check upstream/docker-server-config.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(wiki): parse .gitnexus.json > wiki.autoEvery (Task 6)"
```

---

## Task 7: Auto-regen pass in the watches cron

**Files:**
- Modify: `upstream/docker-server-watches.mjs`

- [ ] **Step 1: Read the cron tick**

Read `upstream/docker-server-watches.mjs` around `startWatchesCron` (line ~281) and its `setInterval` callback (line ~292). Identify the function the tick calls to iterate repos (it already enumerates repos to evaluate metric watches). Note how it lists repos and how it reads each repo's `.gitnexus.json` config.

- [ ] **Step 2: Add the wiki-regen pass**

In the same module, add a function that runs on each tick after the existing watch evaluation:

```javascript
import { isWikiRegenDue } from './gitnexus-web/src/lib/wiki-schedule.ts';
```

⚠️ The cron runs in the **web container** as plain Node ESM — it CANNOT import a `.ts` file. So DO NOT import from `gitnexus-web/src`. Instead, inline a tiny JS copy of the pure logic in this module (DRY is secondary to the container boundary here — the canonical version is the tested `.ts`; this is its runtime twin):

```javascript
// Runtime twin of lib/wiki-schedule.ts (the .ts is unit-tested; this .mjs
// copy exists because the cron runs as plain Node ESM and can't import .ts).
function parseAutoEveryMs(autoEvery) {
  if (!autoEvery || autoEvery === 'off') return null;
  const m = /^(\d+)([hd])$/.exec(String(autoEvery).trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2] === 'h' ? n * 3_600_000 : n * 86_400_000;
}
```

Then add the per-tick pass. For each repo the cron already knows about: read its config (`wiki.autoEvery` via the config parser from Task 6), get `lastGeneratedAt` (call `GET /wiki/status` on localhost, or stat the meta.json if the data volume is mounted in the web container — prefer the status proxy: `fetch('http://localhost:4747'...)` is the API; use the web server's own `/wiki/status`). Compute due-ness; if due AND not already generating → `POST /wiki/generate?repo=<name>` against the web server itself (or directly against the worker `WIKI_WORKER_URL`). Use a guard map so we don't re-trigger while one is in flight.

Concretely, add to the tick:

```javascript
const WIKI_WORKER_URL = process.env.WIKI_WORKER_URL || 'http://gitnexus:4748';

async function wikiRegenPass(apiBase, listRepos, readRepoConfig) {
  let repos = [];
  try { repos = await listRepos(); } catch { return; }
  for (const repo of repos) {
    try {
      const cfg = await readRepoConfig(repo.name); // { wiki: { autoEvery } }
      const autoEvery = cfg && cfg.wiki && cfg.wiki.autoEvery;
      if (parseAutoEveryMs(autoEvery) === null) continue;
      const sres = await fetch(`${WIKI_WORKER_URL}/status?repo=${encodeURIComponent(repo.name)}`);
      const status = await sres.json().catch(() => ({}));
      if (status.generating) continue;
      const lastMs = status.lastGeneratedAt ? Date.parse(status.lastGeneratedAt) : null;
      const intervalMs = parseAutoEveryMs(autoEvery);
      const due = lastMs === null ? true : (Date.now() - lastMs >= intervalMs);
      if (due) {
        await fetch(`${WIKI_WORKER_URL}/generate?repo=${encodeURIComponent(repo.name)}`, { method: 'POST' });
      }
    } catch { /* skip this repo this tick */ }
  }
}
```

Wire `wikiRegenPass(...)` into the existing `setInterval` callback (call it after the metric-watch evaluation; pass the existing repo-listing + config-reading helpers the module already uses). If the module has no repo-listing helper, fetch `${apiBase}/api/repos` like the other modules do.

- [ ] **Step 3: Syntax-check + regen + commit**

```
node --check upstream/docker-server-watches.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(wiki): watches cron triggers due wiki regen (configurable autoEvery) (Task 7)"
```

---

## Task 8: `WikiPanel.tsx` + panel wiring

**Files:**
- Create: `upstream/gitnexus-web/src/components/WikiPanel.tsx`
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx` (`isWikiPanelOpen` + setter)
- Modify: the panel/toolbar registration site (App.tsx or wherever panels mount)

- [ ] **Step 1: Add the panel-open state to useAppState**

Find an existing boolean panel toggle in `useAppState.tsx` (grep `isSettingsPanelOpen` or `isRightPanelOpen`). Mirror it for the wiki: add `isWikiPanelOpen: boolean;` + `setWikiPanelOpen: (open: boolean) => void;` to the context type interface, the `useState(false)`, and the context value object — copy the exact pattern of `isSettingsPanelOpen` line-for-line, renamed.

- [ ] **Step 2: Write the panel component**

Create `upstream/gitnexus-web/src/components/WikiPanel.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState } from '../hooks/useAppState';

type WikiStatus = { generating: boolean; lastGeneratedAt: string | null; error: string | null };

export function WikiPanel() {
  const { projectName } = useAppState();
  const baseRepo = projectName ? projectName.split('@')[0] : '';
  const [status, setStatus] = useState<WikiStatus>({ generating: false, lastGeneratedAt: null, error: null });
  const [hasWiki, setHasWiki] = useState<boolean | null>(null);
  const [iframeTs, setIframeTs] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!baseRepo) return;
    try {
      const res = await fetch(`/wiki/status?repo=${encodeURIComponent(baseRepo)}`);
      const s: WikiStatus = await res.json();
      setStatus(s);
      if (s.lastGeneratedAt) { setHasWiki(true); setIframeTs(s.lastGeneratedAt); }
      return s;
    } catch {
      return null;
    }
  }, [baseRepo]);

  // Probe wiki existence + status on repo change.
  useEffect(() => {
    setHasWiki(null);
    if (!baseRepo) return;
    (async () => {
      const s = await refreshStatus();
      if (!s || !s.lastGeneratedAt) {
        // No meta yet — check if an index.html exists anyway (HEAD /wiki).
        try {
          const head = await fetch(`/wiki?repo=${encodeURIComponent(baseRepo)}`, { method: 'GET' });
          setHasWiki(head.ok);
          if (head.ok) setIframeTs(String(Date.now()));
        } catch { setHasWiki(false); }
      }
    })();
  }, [baseRepo, refreshStatus]);

  // Poll while generating.
  useEffect(() => {
    if (status.generating && pollRef.current === null) {
      pollRef.current = setInterval(async () => {
        const s = await refreshStatus();
        if (s && !s.generating) {
          if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
          if (s.lastGeneratedAt) { setHasWiki(true); setIframeTs(s.lastGeneratedAt || String(Date.now())); }
        }
      }, 3000);
    }
    return () => {
      if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [status.generating, refreshStatus]);

  const regenerate = useCallback(async () => {
    if (!baseRepo) return;
    setStatus((s) => ({ ...s, error: null, generating: true }));
    try {
      await fetch(`/wiki/generate?repo=${encodeURIComponent(baseRepo)}`, { method: 'POST' });
      await refreshStatus();
    } catch {
      setStatus((s) => ({ ...s, generating: false, error: 'Failed to reach the wiki generator.' }));
    }
  }, [baseRepo, refreshStatus]);

  const updatedLabel = status.lastGeneratedAt
    ? `updated ${new Date(status.lastGeneratedAt).toLocaleString()}`
    : 'never generated';
  const wikiUrl = `/wiki?repo=${encodeURIComponent(baseRepo)}&ts=${encodeURIComponent(iframeTs)}`;

  return (
    <div className="flex h-full flex-col" data-testid="wiki-panel">
      <div className="flex items-center justify-between gap-2 border-b border-border-default px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">Wiki</span>
          <span className="text-xs text-muted">{updatedLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {hasWiki && (
            <a href={wikiUrl} target="_blank" rel="noreferrer" className="text-xs underline">Open ↗</a>
          )}
          <button
            type="button"
            onClick={regenerate}
            disabled={status.generating}
            className="rounded border border-border-default px-2 py-1 text-xs disabled:opacity-50"
            data-testid="wiki-regenerate"
          >
            {status.generating ? 'Generating…' : 'Regenerate'}
          </button>
        </div>
      </div>
      <div className="relative flex-1">
        {status.error && (
          <div className="m-3 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300" data-testid="wiki-error">
            {status.error.includes('exited') ? 'Generation failed. Make sure the repo was analyzed and a server-side LLM key is configured.' : status.error}
          </div>
        )}
        {status.generating && (
          <div className="m-3 text-xs text-muted">Generating wiki… this can take a few minutes.</div>
        )}
        {hasWiki === false && !status.generating && (
          <div className="m-3 text-sm text-muted" data-testid="wiki-empty">
            No wiki yet — click <span className="font-medium">Regenerate</span> to build it.
          </div>
        )}
        {hasWiki && (
          <iframe
            key={iframeTs}
            title="Code Wiki"
            src={wikiUrl}
            className="absolute inset-0 h-full w-full border-0"
            data-testid="wiki-iframe"
          />
        )}
      </div>
    </div>
  );
}

export default WikiPanel;
```

- [ ] **Step 3: Register the panel + a toggle button**

Find how an existing panel is rendered + toggled (grep `isSettingsPanelOpen` / `SettingsPanel` in `App.tsx` and any toolbar/header). Mirror that wiring for `WikiPanel`: import it, render `{isWikiPanelOpen && <WikiPanel />}` in the same region SettingsPanel renders, and add a toolbar button that calls `setWikiPanelOpen(true)` (and close affordance matching the others). Use a lucide icon already re-exported in `lib/lucide-icons.tsx` (e.g. `BookOpen` if present; otherwise reuse an existing one like `FileText`). If the icon isn't exported, add it to `lib/lucide-icons.tsx` following the existing re-export pattern.

- [ ] **Step 4: Regen patches + commit**

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(wiki): WikiPanel.tsx (iframe + regenerate + status) + panel toggle (Task 8)"
```

---

## Task 9: docker-compose LLM env

**Files:**
- Modify: `docker-compose.yml`
- Modify: `README.md` (document the env + the `.env` convention)

- [ ] **Step 1: Add the env to gitnexus-server**

In `docker-compose.yml`, on the `gitnexus-server` service, add (using `${VAR}` interpolation from a local `.env`, NOT hardcoded keys):

```yaml
    environment:
      # ... keep existing ...
      GITNEXUS_API_KEY: ${GITNEXUS_API_KEY:-}
      GITNEXUS_MODEL: ${GITNEXUS_MODEL:-}
      GITNEXUS_LLM_BASE_URL: ${GITNEXUS_LLM_BASE_URL:-}
```

(Merge into the existing `environment:` block if present; create it if not. The `:-` default keeps the stack bootable without a key — the wiki just can't generate until one is set, which the panel surfaces as an error.)

- [ ] **Step 2: Document in README**

Add a short "Code Wiki" subsection to `README.md` noting: the wiki needs a server-side LLM key; set `GITNEXUS_API_KEY` (+ optional `GITNEXUS_MODEL`, `GITNEXUS_LLM_BASE_URL`) in a local `.env` (gitignored); the wiki appears in the Wiki panel; auto-update via `.gitnexus.json > wiki.autoEvery` (e.g. `"24h"`, default `off`).

- [ ] **Step 3: Commit (top-level tracked files)**

```
git add docker-compose.yml README.md
git commit -m "feat(wiki): docker-compose LLM env for gitnexus-server + README (Task 9)"
```

(Verify `.env` is gitignored: `grep -n "^\.env" .gitignore`. If not, add `.env` to `.gitignore` in this commit. NEVER commit a real key.)

---

## Task 10: Integration + E2E tests

**Files:**
- Create: `tests/integration/endpoints/wiki.test.mjs`
- Create: `tests/e2e/specs/wiki-panel.spec.ts`

- [ ] **Step 1: Integration test (handler logic, worker mocked)**

Look at an existing integration endpoint test (e.g. `tests/integration/endpoints/lifespan-windowed.test.mjs`) for the harness shape (how it starts/targets the server, how `repo=` is passed). Create `tests/integration/endpoints/wiki.test.mjs` mirroring that harness, asserting:
- `GET /wiki/status?repo=<fixture>` → 200 with `{ generating, lastGeneratedAt, error }` shape.
- `GET /wiki?repo=<fixture>` → 200 (text/html) if a wiki exists for the fixture, OR 404 `{ error: 'no wiki yet' }` if not (accept either; assert the 404 JSON shape when absent).
- `POST /wiki/generate?repo=<fixture>` → 202/409/502 (don't require a real worker; assert it's one of these and JSON-shaped).

Follow the EXACT import/harness pattern of the neighbor test — do not invent a new harness. If the harness can't reach a wiki-worker (none running in CI), the generate proxy returns 502 — assert that path explicitly so the test is deterministic.

- [ ] **Step 2: E2E test (wiring, not real generation)**

Create `tests/e2e/specs/wiki-panel.spec.ts` mirroring an existing spec's `beforeEach` (e.g. `timeline-temporal-filter.spec.ts`):

```typescript
import { test, expect } from '@playwright/test';

test.describe('Code Wiki panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
  });

  test('opens the Wiki panel and shows iframe or empty-state', async ({ page }) => {
    // Open via the toolbar button (adapt the selector to the real button text/icon).
    await page.getByRole('button', { name: /wiki/i }).first().click();
    await expect(page.getByTestId('wiki-panel')).toBeVisible();
    // Either an empty-state CTA or the iframe is present.
    const empty = page.getByTestId('wiki-empty');
    const iframe = page.getByTestId('wiki-iframe');
    await expect(empty.or(iframe)).toBeVisible();
  });

  test('Regenerate fires POST /wiki/generate', async ({ page }) => {
    await page.getByRole('button', { name: /wiki/i }).first().click();
    await expect(page.getByTestId('wiki-panel')).toBeVisible();
    const reqPromise = page.waitForRequest(/\/wiki\/generate\?/, { timeout: 10_000 });
    await page.getByTestId('wiki-regenerate').click();
    const req = await reqPromise;
    expect(req.method()).toBe('POST');
  });
});
```

(If the toolbar button name differs, adapt the selector in Step 3 of Task 8 to expose an accessible name matching `/wiki/i`, or use a `data-testid` on the button.)

- [ ] **Step 3: Commit (tracked test files)**

```
git add tests/integration/endpoints/wiki.test.mjs tests/e2e/specs/wiki-panel.spec.ts
git commit -m "test(wiki): integration (serve/status/generate proxy) + e2e (panel + regenerate) (Task 10)"
```

---

## Task 11: Docs + build validation + final commit

**Files:**
- Modify: `ROADMAP.md`, `INVENTORY.md`, `tests/README.md`, `CLAUDE.md`

- [ ] **Step 1: Build BOTH images + smoke**

Run (this is the real validation — the feature touches 2 Dockerfiles + compose):

```
docker compose build gitnexus-server gitnexus-web
```

Expected: both build exit 0. If `gitnexus-server` fails on the new CMD/COPY, fix before proceeding. Then a quick up + curl smoke:

```
docker compose up -d
```

Then curl the new endpoints (the wiki may 404 if never generated — that's acceptable; we're checking routing, not content):

```
curl -s -o /dev/null -w "wiki: HTTP %{http_code}\n" "http://localhost:4173/wiki?repo=hmm_studio"
curl -s -o /dev/null -w "wiki/status: HTTP %{http_code}\n" "http://localhost:4173/wiki/status?repo=hmm_studio"
```

Expected: `/wiki` → 200 or 404; `/wiki/status` → 200. If `/wiki/status` is 502, the worker isn't running — check the `gitnexus-server` logs (`docker logs gitnexus-server | grep wiki-worker`) and the Dockerfile.cli CMD.

- [ ] **Step 2: Update CLAUDE.md smoke loop**

Add to the smoke block in `CLAUDE.md` (after the lifespan windowed entry):

```bash
# Code Wiki (web UI feature) — serve may 404 if never generated; status should be 200.
curl -s -o /dev/null -w "wiki: HTTP %{http_code}\n" \
  "http://localhost:4173/wiki?repo=hmm_studio"
curl -s -o /dev/null -w "wiki/status: HTTP %{http_code}\n" \
  "http://localhost:4173/wiki/status?repo=hmm_studio"
```

Also add a one-line note in CLAUDE.md that the `gitnexus-server` container now runs a second process (`wiki-worker.mjs` on :4748, internal) and that the wiki needs a server-side LLM key.

- [ ] **Step 3: Update ROADMAP.md**

Add a new "Déjà livré" row (next number after the current last — `grep "^| 5" ROADMAP.md | tail -3` to find it):

```markdown
| <N> | **Code Wiki dans l'UI web + auto-update** (enterprise parity) : panel iframe affichant le wiki upstream généré (`.gitnexus/wiki/index.html`), bouton Regenerate + auto-régen sur intervalle configurable (`.gitnexus.json > wiki.autoEvery`, défaut off) via le cron watches. `wiki-worker.mjs` (conteneur server) spawn la CLI publique `gitnexus wiki` headless (clé LLM en env). Conteneur web sert + proxy. | `upstream/wiki-worker.mjs`, `upstream/docker-server-wiki.mjs` (`/wiki`, `/wiki/generate`, `/wiki/status`), `WikiPanel.tsx`, `lib/wiki-schedule.ts`, cron dans `docker-server-watches.mjs` |
```

In the enterprise table (§ "Enterprise / commercial offering"), change the **Code Wiki** row verdict from 🟡 to ✅ and update its third cell to point at the shipped row + keep the 4 future enhancements. Bump the `Dernière mise à jour` header line.

- [ ] **Step 4: Update INVENTORY.md**

In the frontend components section, add the WikiPanel entry; in the endpoints section, add `/wiki`, `/wiki/generate`, `/wiki/status`. Mention the `wiki-worker.mjs` second process in the `gitnexus-server` container and the server-side LLM env requirement.

- [ ] **Step 5: Update tests/README.md**

Add rows: unit `wiki-schedule.test.mjs` (isWikiRegenDue + parseAutoEvery, 12 cases); integration `endpoints/wiki.test.mjs`; e2e `wiki-panel.spec.ts`.

- [ ] **Step 6: Final commit**

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff ROADMAP.md INVENTORY.md tests/README.md CLAUDE.md
git commit -m "Code Wiki web UI + auto-update livré: ROADMAP/INVENTORY/CLAUDE smoke/tests (Task 11)"
```

---

## Self-Review

**Spec coverage:**
- ✅ Spec § 4.1 fichiers → tous mappés dans File Structure + tâches.
- ✅ Spec § 4.2 worker (spawn CLI headless, in-progress map, async 202, /status via meta.json mtime) → Task 3.
- ✅ Spec § 4.3 web serve+proxy+status → Task 5.
- ✅ Spec § 4.4 cron auto-regen + isWikiRegenDue → Task 2 (pure+tests) + Task 7 (cron, runtime twin documented).
- ✅ Spec § 4.5 WikiPanel (iframe, regenerate, polling, empty/error) → Task 8.
- ✅ Spec § 4.6 Dockerfile.cli wrapper (2 process, non-fatal worker) → Task 4.
- ✅ Spec § 4.7 compose env → Task 9.
- ✅ Spec § 5 edge cases → handled across T3/T5/T8 (404 empty, analyze-not-run error, 409 concurrent, async, worker crash non-fatal).
- ✅ Spec § 6 testing (unit + integration + e2e + smoke) → Task 2/10/11.
- ✅ Spec § 8 volume risk → Task 1 BLOCKING gate first.
- ✅ Spec § 10 doc checklist → Task 11.

**Placeholder scan:**
- ✅ No "TBD"/"implement later". Full code for the pure fn, worker, web handler, panel.
- ⚠️ Tasks 6/7/8 use grep-anchored instructions ("mirror the existing X pattern") because the exact lines in `docker-server-config.mjs`, `docker-server-watches.mjs`, `useAppState.tsx`, and the panel-registration site shift with parallel sessions and can't be quoted verbatim safely. Each gives the precise pattern to mirror + the exact code to insert. This is intentional, not a placeholder.
- ⚠️ Task 7 deliberately inlines a JS "runtime twin" of the `.ts` pure fn — documented WHY (container boundary: cron is plain Node ESM, can't import `.ts`). The canonical tested version is the `.ts`.

**Type/contract consistency:**
- ✅ Worker `/status` returns `{ generating, lastGeneratedAt (ISO|null), error }` — consumed identically by web `/wiki/status` proxy (Task 5), the cron (Task 7), and `WikiPanel` `WikiStatus` type (Task 8).
- ✅ `/wiki/generate` returns 202/409/404/502 — panel treats any non-2xx gracefully (sets generating, polls, surfaces error).
- ✅ `wiki.autoEvery` string default `'off'` — produced by config parser (Task 6), consumed by `parseAutoEvery`/twin (Task 2/7).
- ✅ `WIKI_WORKER_URL` (`http://gitnexus:4748`) consistent between Task 5 and Task 7.

**COEP/iframe risk (important):** the app's static route sets `Cross-Origin-Embedder-Policy: require-corp`. The wiki HTML loads marked/mermaid from CDN. The `/wiki` route deliberately omits COEP and sets `CORP: same-origin` (Task 5). If the embedded iframe is still blocked under the parent's COEP, the panel always renders an **"Open ↗"** link (Task 8) that opens the wiki as a top-level tab (COEP of the app shell doesn't apply to a top-level navigation) — a built-in fallback. Task 11 Step 1 manual browser check confirms which path works; if the iframe is blocked, that's acceptable v1 (the Open-in-tab path works) and noted, not a blocker.

**Scope:** broad (2 containers + worker + proxy + cron + config + panel + compose) but one coherent feature. 11 tasks, ~6-7 days. Acceptable as one plan.

Plan ready for execution.

---

## Effort summary

| Task | Estimate |
|---|---|
| 1. Verify shared volume (gate) | ~¼j |
| 2. isWikiRegenDue pure + tests | ~½j |
| 3. wiki-worker.mjs | ~1j |
| 4. Dockerfile.cli wrapper | ~½j |
| 5. docker-server-wiki.mjs + mount | ~1j |
| 6. config parse | ~¼j |
| 7. watches cron pass | ~½j |
| 8. WikiPanel + wiring | ~1½j |
| 9. compose env + README | ~¼j |
| 10. integration + e2e | ~1j |
| 11. docs + build validation | ~½j |
| **Total** | **~6-7 jours** |
