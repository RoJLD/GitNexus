# CI/CD Test Pyramid — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire la pyramide de tests (unit + integration + e2e) sur la base actuelle `v1.6.3` pour servir de filet de régression avant le bump v1.6.5.

**Architecture:** Vitest-centrique pour unit + integration (HTTP via `fetch` natif), Playwright runner séparé pour 5 specs e2e. Fixture déterministe (mini-repo tar.gz) + auto-référence (gitnexus indexe gitnexus). Docker stack dédié tests (`docker-compose.test.yml`) avec volumes nommés isolés. GitHub Actions non-bloquant.

**Tech Stack:** Vitest 4, @testing-library/react, Playwright 1.x, Node 22, Docker Compose, GitHub Actions.

**Spec source:** [docs/superpowers/specs/2026-05-26-cicd-test-pyramid-design.md](../specs/2026-05-26-cicd-test-pyramid-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

**OS notes:** L'utilisateur tourne sous Windows/PowerShell avec Rancher Desktop. Tous les scripts utilisent Node (cross-platform). Les commandes `docker compose` fonctionnent partout. Les commits utilisent `git` standard.

---

## Section A — Bootstrap (Tasks 1-3)

Établit le squelette du harness : `tests/`, `package.json`, configs Vitest, compose dédié tests.

### Task 1: Test infrastructure skeleton

**Files:**
- Create: `tests/package.json`
- Create: `tests/vitest.config.unit.mjs`
- Create: `tests/vitest.config.integ.mjs`
- Create: `tests/.gitignore`
- Create: `tests/unit/.gitkeep`
- Create: `tests/integration/helpers/.gitkeep`
- Create: `tests/integration/endpoints/.gitkeep`
- Create: `tests/fixtures/.gitkeep`
- Create: `tests/fixtures/expected/.gitkeep`
- Create: `tests/e2e/specs/.gitkeep`

- [ ] **Step 1: Create `tests/package.json`**

```json
{
  "name": "gitnexus-deployment-tests",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test:unit": "vitest run --config vitest.config.unit.mjs",
    "test:integ": "vitest run --config vitest.config.integ.mjs",
    "test:smoke": "vitest run --config vitest.config.integ.mjs --reporter=verbose integration/stack-health.test.mjs",
    "test:e2e": "playwright test --config e2e/playwright.config.ts",
    "test": "npm run test:unit && npm run test:integ",
    "test:all": "npm run test && npm run test:e2e",
    "fixture:rebuild": "node fixtures/make-fixture.mjs"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "vitest": "^4.1.6"
  }
}
```

- [ ] **Step 2: Create `tests/vitest.config.unit.mjs`**

```js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'unit',
    include: ['unit/**/*.test.{mjs,ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./unit/setup.mjs'],
    testTimeout: 10_000,
    pool: 'threads',
    reporters: ['default'],
  },
});
```

- [ ] **Step 3: Create `tests/vitest.config.integ.mjs`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['integration/**/*.test.mjs'],
    environment: 'node',
    globalSetup: ['./integration/helpers/global-setup.mjs'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    reporters: ['default'],
  },
});
```

- [ ] **Step 4: Create `tests/.gitignore`**

```
node_modules/
playwright-report/
test-results/
fixtures/sample-repo-extracted/
docker-logs.txt
```

- [ ] **Step 5: Create empty `.gitkeep` files**

```bash
touch tests/unit/.gitkeep tests/integration/helpers/.gitkeep tests/integration/endpoints/.gitkeep tests/fixtures/.gitkeep tests/fixtures/expected/.gitkeep tests/e2e/specs/.gitkeep
```

- [ ] **Step 6: Install dependencies**

Run: `cd tests && npm install`
Expected: `node_modules/` populated, `package-lock.json` generated, no peer-dep errors.

- [ ] **Step 7: Verify Vitest is callable**

Run: `cd tests && npx vitest run --version`
Expected: prints `4.1.x` (or whatever resolved).

- [ ] **Step 8: Commit**

```bash
git add tests/package.json tests/vitest.config.unit.mjs tests/vitest.config.integ.mjs tests/.gitignore tests/unit/.gitkeep tests/integration/helpers/.gitkeep tests/integration/endpoints/.gitkeep tests/fixtures/.gitkeep tests/fixtures/expected/.gitkeep tests/e2e/specs/.gitkeep tests/package-lock.json
git commit -m "test: bootstrap test infrastructure skeleton"
```

---

### Task 2: Unit-test setup file

**Files:**
- Create: `tests/unit/setup.mjs`

- [ ] **Step 1: Create the setup file**

```js
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 2: Smoke-verify Vitest can pick it up**

Create a temporary `tests/unit/_sanity.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
describe('vitest sanity', () => {
  it('runs', () => { expect(1 + 1).toBe(2); });
});
```

Run: `cd tests && npm run test:unit`
Expected: 1 test passed.

- [ ] **Step 3: Delete the sanity file**

```bash
rm tests/unit/_sanity.test.mjs
```

- [ ] **Step 4: Commit**

```bash
git add tests/unit/setup.mjs
git commit -m "test: add unit test setup with testing-library cleanup"
```

---

### Task 3: Dedicated docker-compose for tests

**Files:**
- Create: `docker-compose.test.yml`

- [ ] **Step 1: Create `docker-compose.test.yml`**

Copie de `docker-compose.yml` actuel mais avec :
- noms de services suffixés `-test`
- volumes nommés `gitnexus-test-data` et `gitnexus-test-hf-cache`
- port 4747 mappé (sera surchargé en CI si besoin via env var)
- bind mount vers `${TEST_PROJECTS_ROOT:-./tests/fixtures/sample-repo-extracted}`

```yaml
name: gitnexus-test
services:
  gitnexus-server-test:
    build:
      context: .
      dockerfile: Dockerfile.cli
    image: gitnexus-cli-test:local
    container_name: gitnexus-test
    restart: unless-stopped
    ports:
      - "${TEST_PORT:-4747}:4747"
    environment:
      - GITNEXUS_HOME=/data/gitnexus
      - HF_HOME=/data/hf-cache
      - NODE_ENV=production
    volumes:
      - gitnexus-test-data:/data/gitnexus
      - gitnexus-test-hf-cache:/data/hf-cache
      - ${TEST_PROJECTS_ROOT:-./tests/fixtures/sample-repo-extracted}:/data/projects:ro
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:4747/health"]
      interval: 5s
      timeout: 3s
      retries: 20

  gitnexus-web-test:
    build:
      context: ./upstream
      dockerfile: Dockerfile.web
    image: gitnexus-web-test:local
    container_name: gitnexus-web-test
    restart: unless-stopped
    ports:
      - "${TEST_WEB_PORT:-4173}:4173"
    depends_on:
      gitnexus-server-test:
        condition: service_healthy
    environment:
      - VITE_GITNEXUS_BACKEND_URL=http://localhost:${TEST_PORT:-4747}

volumes:
  gitnexus-test-data:
    name: gitnexus-test-data
  gitnexus-test-hf-cache:
    name: gitnexus-test-hf-cache
```

- [ ] **Step 2: Validate compose syntax**

Run: `docker compose -f docker-compose.test.yml config`
Expected: prints the resolved compose without errors.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.test.yml
git commit -m "test: add dedicated docker-compose.test.yml with isolated volumes"
```

---

## Section B — Fixture (Tasks 4-5)

Mini-repo déterministe + golden snapshots des valeurs attendues.

### Task 4: Fixture generation script

**Files:**
- Create: `tests/fixtures/make-fixture.mjs`

- [ ] **Step 1: Create the script**

```js
#!/usr/bin/env node
/**
 * Reconstruit tests/fixtures/sample-repo.tar.gz from scratch with a
 * deterministic git history (fixed timestamps, fixed authors).
 *
 * Usage: node tests/fixtures/make-fixture.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '_build', 'sample-repo');
const TARBALL = join(HERE, 'sample-repo.tar.gz');
const ALICE = 'Alice Test <alice@test.local>';
const BOB = 'Bob Test <bob@test.local>';

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO, stdio: 'pipe', ...opts }).toString();
}

function commit({ author, date, message, files }) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(REPO, path);
    mkdirSync(dirname(full), { recursive: true });
    if (content === null) {
      sh(`git rm -f "${path}"`);
    } else {
      writeFileSync(full, content);
      sh(`git add "${path}"`);
    }
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: author.split(' <')[0],
    GIT_AUTHOR_EMAIL: author.split(' <')[1].slice(0, -1),
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: author.split(' <')[0],
    GIT_COMMITTER_EMAIL: author.split(' <')[1].slice(0, -1),
    GIT_COMMITTER_DATE: date,
  };
  execSync(`git commit -m "${message}"`, { cwd: REPO, env, stdio: 'pipe' });
}

console.log('Resetting fixture build directory…');
rmSync(REPO, { recursive: true, force: true });
mkdirSync(REPO, { recursive: true });
sh('git init -q -b main');
sh('git config commit.gpgsign false');

console.log('Committing fixture history…');

// Commit 1 (alice, 2025-01-01) — initial scaffold
commit({
  author: ALICE,
  date: '2025-01-01T10:00:00 +0100',
  message: 'feat: scaffold project',
  files: {
    'README.md': '# Sample\n',
    'src/utils/helpers.ts': 'export const id = <T>(x: T): T => x;\n',
    'src/auth/login.ts': 'export function login() { return false; }\n',
    'src/db/schema.ts': 'export const schema = { tables: [] };\n',
    'gitnexus-domains.json': JSON.stringify(
      { domains: { auth: ['src/auth/**'], data: ['src/db/**'] } },
      null,
      2,
    ),
  },
});

// Commits 2-6 (alice) — login.ts heavy churn
const loginVersions = [
  'export function login(u: string) { return u === "alice"; }\n',
  'export function login(u: string, p: string) { return u === "alice" && p.length > 3; }\n',
  'export function login(u: string, p: string) { return u === "alice" && p.length > 5; }\n',
  'import { id } from "../utils/helpers";\nexport function login(u: string, p: string) { return id(u === "alice" && p.length > 5); }\n',
  'import { id } from "../utils/helpers";\nexport function login(u: string, p: string, mfa?: string) { return id(u === "alice" && p.length > 5 && !!mfa); }\n',
];
for (let i = 0; i < 5; i++) {
  commit({
    author: ALICE,
    date: `2025-01-0${2 + i}T10:00:00 +0100`,
    message: `feat(auth): iterate login signature #${i + 1}`,
    files: { 'src/auth/login.ts': loginVersions[i] },
  });
}

// Commit 7 (bob, 2025-01-10) — schema.ts edits
commit({
  author: BOB,
  date: '2025-01-10T14:00:00 +0100',
  message: 'feat(db): add users table',
  files: {
    'src/db/schema.ts': 'export const schema = { tables: ["users"] };\n',
    'src/auth/legacy.js': 'module.exports = { ssoLogin: () => false };\n',
  },
});

// Commit 8 (alice, 2025-01-15) — schema.ts again
commit({
  author: ALICE,
  date: '2025-01-15T09:30:00 +0100',
  message: 'feat(db): add sessions table',
  files: { 'src/db/schema.ts': 'export const schema = { tables: ["users", "sessions"] };\n' },
});

// Commit 9 (alice, 2025-01-22) — drop legacy.js
commit({
  author: ALICE,
  date: '2025-01-22T16:00:00 +0100',
  message: 'refactor(auth): drop legacy sso path',
  files: {
    'src/auth/legacy.js': null,
    'src/db/schema.ts': 'export const schema = { tables: ["users", "sessions", "audit"] };\n',
  },
});

// Commit 10 (bob, 2025-01-30) — orphan recent file + schema final
commit({
  author: BOB,
  date: '2025-01-30T11:00:00 +0100',
  message: 'feat(db): wire migration runner',
  files: {
    'src/db/orphan.py': '# placeholder for migration runner\nprint("noop")\n',
    'src/db/schema.ts': 'export const schema = { tables: ["users", "sessions", "audit"], version: 4 };\n',
  },
});

console.log('Packing tarball…');
execSync(`tar -czf "${TARBALL}" -C "${REPO}/.." sample-repo`, { stdio: 'inherit' });
console.log(`Wrote ${TARBALL}`);
```

- [ ] **Step 2: Run the fixture builder**

Run: `cd tests && node fixtures/make-fixture.mjs`
Expected: stdout shows commits being made, then `Wrote …/sample-repo.tar.gz`. File `tests/fixtures/sample-repo.tar.gz` exists.

- [ ] **Step 3: Inspect the tarball**

Run: `tar -tzf tests/fixtures/sample-repo.tar.gz | head -20`
Expected: lists `sample-repo/.git/…`, `sample-repo/src/auth/login.ts`, etc.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/make-fixture.mjs tests/fixtures/sample-repo.tar.gz
git commit -m "test: add deterministic fixture builder + sample-repo.tar.gz"
```

---

### Task 5: Golden snapshots placeholder

**Files:**
- Create: `tests/fixtures/expected/README.md`

> **Important:** Les valeurs réelles dans `expected/*.json` seront capturées au premier run de chaque test integration (avec un flag `WRITE_GOLDEN=1`). Pour l'instant on commit juste un README qui documente la convention.

- [ ] **Step 1: Create the README**

```markdown
# Golden snapshots

Chaque test integration `tests/integration/endpoints/<endpoint>.test.mjs`
charge `tests/fixtures/expected/<endpoint>.json` et compare la réponse.

## Capture initiale

La première fois qu'on écrit un test integration, on lance :

```
WRITE_GOLDEN=1 npm run test:integ -- <endpoint>
```

Le helper `expectGolden()` (voir `tests/integration/helpers/golden.mjs`)
écrit la réponse au lieu de comparer.

## Régénération volontaire

Après une évolution consciente d'une analytique (changement de
formule), on relance la capture pour le endpoint concerné et on commit
le `.json` modifié. Le diff doit être petit et expliqué dans le commit.

## Convention de tolérance

- Floats : comparaison `closeTo(value, 1e-6)`.
- Tableaux : ordre préservé (assurer un `ORDER BY` côté serveur si besoin).
- Strings : exact match.
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/expected/README.md
git commit -m "test: document golden snapshot convention"
```

---

## Section C — Helpers integration (Tasks 6-9)

Les briques que tous les tests integration vont réutiliser.

### Task 6: API client helper

**Files:**
- Create: `tests/integration/helpers/api-client.mjs`

- [ ] **Step 1: Create the client**

```js
/**
 * Minimal typed-ish client for the gitnexus REST API.
 * Used by integration tests to avoid repeating fetch() everywhere.
 */
export class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async _get(path, query = {}) {
    const qs = new URLSearchParams(query).toString();
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${await res.text()}`);
    const ctype = res.headers.get('content-type') || '';
    return ctype.includes('application/json') ? res.json() : res.text();
  }

  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }

  health() { return this._get('/health'); }
  listRepos() { return this._get('/api/repos'); }
  analyze(repo, opts = {}) { return this._post('/analyze', { repo, ...opts }); }

  // Snapshots
  createSnapshot(repo, sha) { return this._post('/snapshot', { repo, sha }); }
  listSnapshots(repo) { return this._get('/snapshots', { repo }); }
  bulkSnapshot(repo, opts) { return this._post('/snapshot/bulk', { repo, ...opts }); }
  bulkSnapshotStatus(jobId) { return this._get(`/snapshot/bulk/${jobId}`); }

  // Analytics
  churn(repo, opts = {}) { return this._get('/churn', { repo, ...opts }); }
  coupling(repo, opts = {}) { return this._get('/coupling', { repo, ...opts }); }
  couplingCross(repos, opts = {}) { return this._get('/coupling/cross', { repos: repos.join(','), ...opts }); }
  growth(repo, opts = {}) { return this._get('/growth', { repo, ...opts }); }
  growthCross(repos, opts = {}) { return this._get('/growth/cross', { repos: repos.join(','), ...opts }); }
  lifespan(repo, opts = {}) { return this._get('/lifespan', { repo, ...opts }); }
  entropy(repo, opts = {}) { return this._get('/entropy', { repo, ...opts }); }
  ownership(repo, opts = {}) { return this._get('/ownership', { repo, ...opts }); }
  dissonance(repo, opts = {}) { return this._get('/dissonance', { repo, ...opts }); }
  semanticLabels(repo) { return this._get('/semantic-labels', { repo }); }
  setSemanticLabel(repo, communityId, label) { return this._post('/semantic-labels', { repo, communityId, label }); }

  // Misc
  listdir(path) { return this._get('/listdir', { path }); }
  graph(repo, opts = {}) { return this._get('/api/graph', { repo, ...opts }); }
  export(repo, opts = {}) { return this._get('/export', { repo, ...opts }); }
  importBundle(payload) { return this._post('/import', payload); }
}

export function getApi(port = process.env.TEST_PORT || 4747) {
  return new ApiClient(`http://localhost:${port}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/integration/helpers/api-client.mjs
git commit -m "test: add ApiClient helper for integration tests"
```

---

### Task 7: wait-ready helper

**Files:**
- Create: `tests/integration/helpers/wait-ready.mjs`

- [ ] **Step 1: Create the script**

```js
/**
 * Poll GET /health until 200 or timeout. Used both by globalSetup and
 * directly by the CI workflow before running e2e.
 */
import { getApi } from './api-client.mjs';

export async function waitForReady({ timeoutMs = 90_000, intervalMs = 500 } = {}) {
  const api = getApi();
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await api.health();
      if (res && (res.status === 'ok' || res.ok === true)) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Stack did not become ready within ${timeoutMs}ms. Last error: ${lastErr?.message ?? 'none'}`);
}

// Allow `node wait-ready.mjs` as a CLI step in CI.
if (import.meta.url === `file://${process.argv[1]}`) {
  waitForReady().then(
    () => { console.log('ready'); process.exit(0); },
    err => { console.error(err.message); process.exit(1); },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/integration/helpers/wait-ready.mjs
git commit -m "test: add wait-ready helper (CLI + module)"
```

---

### Task 8: Stack helper (Docker lifecycle)

**Files:**
- Create: `tests/integration/helpers/stack.mjs`

- [ ] **Step 1: Create the helper**

```js
/**
 * Docker stack lifecycle for integration tests.
 *
 * The compose file is at the repo root: docker-compose.test.yml.
 * We resolve TEST_PROJECTS_ROOT to the extracted fixture by default.
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForReady } from './wait-ready.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const COMPOSE_FILE = join(REPO_ROOT, 'docker-compose.test.yml');

function compose(args, opts = {}) {
  const cmd = `docker compose -f "${COMPOSE_FILE}" ${args}`;
  return execSync(cmd, { stdio: opts.silent ? 'pipe' : 'inherit', cwd: REPO_ROOT, env: { ...process.env, ...opts.env } });
}

let extractedFixtureDir = null;

export function extractFixture() {
  if (extractedFixtureDir && existsSync(extractedFixtureDir)) return extractedFixtureDir;
  const dir = mkdtempSync(join(tmpdir(), 'gitnexus-fixture-'));
  execSync(`tar -xzf "${join(HERE, '..', '..', 'fixtures', 'sample-repo.tar.gz')}" -C "${dir}"`, { stdio: 'pipe' });
  extractedFixtureDir = dir;
  return dir;
}

export async function startStack({ port = 4747, projectsRoot } = {}) {
  const root = projectsRoot ?? extractFixture();
  compose('up -d --build', { env: { TEST_PORT: String(port), TEST_PROJECTS_ROOT: root } });
  await waitForReady({ timeoutMs: 120_000 });
}

export async function stopStack({ collectLogs = false } = {}) {
  if (collectLogs) {
    try { compose('logs --no-color > docker-logs.txt'); } catch { /* best effort */ }
  }
  compose('down -v', { silent: true });
  if (extractedFixtureDir) {
    rmSync(extractedFixtureDir, { recursive: true, force: true });
    extractedFixtureDir = null;
  }
}

export function dumpLogs() {
  try {
    return execSync(`docker compose -f "${COMPOSE_FILE}" logs --no-color`, { encoding: 'utf8', cwd: REPO_ROOT });
  } catch (err) {
    return `failed to collect logs: ${err.message}`;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/integration/helpers/stack.mjs
git commit -m "test: add Docker stack lifecycle helper"
```

---

### Task 9: Analyze + snapshot helpers + globalSetup

**Files:**
- Create: `tests/integration/helpers/analyze.mjs`
- Create: `tests/integration/helpers/golden.mjs`
- Create: `tests/integration/helpers/global-setup.mjs`

- [ ] **Step 1: Create `analyze.mjs`**

```js
import { getApi } from './api-client.mjs';

const FIXTURE_NAME = 'sample-repo';
const FIXTURE_PATH = `/data/projects/${FIXTURE_NAME}`;

async function pollUntilDone(checker, { timeoutMs = 180_000, intervalMs = 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await checker();
    if (state.done) return state;
    if (state.error) throw new Error(`Job failed: ${state.error}`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Job did not finish within ${timeoutMs}ms`);
}

export async function analyzeFixture({ withEmbeddings = false } = {}) {
  const api = getApi();
  const job = await api.analyze(FIXTURE_PATH, {
    skipEmbeddings: !withEmbeddings,
    force: true,
  });
  await pollUntilDone(async () => {
    const repos = await api.listRepos();
    const r = repos.find(x => x.name === FIXTURE_NAME);
    return { done: r?.status === 'ready', error: r?.error };
  });
  return FIXTURE_NAME;
}

export async function snapshotFixtureAtCommit(sha) {
  const api = getApi();
  return api.createSnapshot(FIXTURE_NAME, sha);
}

export async function snapshotFixtureFullHistory({ count = 10, windowDays = 30 } = {}) {
  const api = getApi();
  const job = await api.bulkSnapshot(FIXTURE_NAME, { count, windowDays });
  await pollUntilDone(async () => {
    const status = await api.bulkSnapshotStatus(job.jobId);
    return { done: status.state === 'done', error: status.error };
  });
  return api.listSnapshots(FIXTURE_NAME);
}

export const FIXTURE = { name: FIXTURE_NAME, path: FIXTURE_PATH };
```

- [ ] **Step 2: Create `golden.mjs`**

```js
/**
 * Golden snapshot helper. Reads expected/<name>.json and compares.
 * If WRITE_GOLDEN=1, writes the actual response instead of comparing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECTED_DIR = join(HERE, '..', '..', 'fixtures', 'expected');

export function expectGolden(name, actual, { tolerance = 1e-6 } = {}) {
  const file = join(EXPECTED_DIR, `${name}.json`);
  if (process.env.WRITE_GOLDEN === '1' || !existsSync(file)) {
    writeFileSync(file, JSON.stringify(actual, null, 2) + '\n');
    console.warn(`[golden] wrote ${file}`);
    return;
  }
  const expected = JSON.parse(readFileSync(file, 'utf8'));
  compareWithTolerance(actual, expected, tolerance, name);
}

function compareWithTolerance(actual, expected, tolerance, path) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    expect(actual, `${path} (float)`).toBeCloseTo(expected, -Math.log10(tolerance));
    return;
  }
  if (Array.isArray(expected)) {
    expect(actual, `${path} (length)`).toHaveLength(expected.length);
    expected.forEach((v, i) => compareWithTolerance(actual[i], v, tolerance, `${path}[${i}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    expect(Object.keys(actual ?? {}).sort(), `${path} (keys)`).toEqual(Object.keys(expected).sort());
    for (const k of Object.keys(expected)) compareWithTolerance(actual[k], expected[k], tolerance, `${path}.${k}`);
    return;
  }
  expect(actual, path).toEqual(expected);
}
```

- [ ] **Step 3: Create `global-setup.mjs`**

```js
import { startStack, stopStack, dumpLogs } from './stack.mjs';
import { analyzeFixture, snapshotFixtureFullHistory } from './analyze.mjs';

export default async function setup() {
  console.log('[global-setup] starting docker stack…');
  try {
    await startStack();
    console.log('[global-setup] analyzing fixture…');
    await analyzeFixture();
    console.log('[global-setup] taking full-history bulk snapshot…');
    await snapshotFixtureFullHistory();
    console.log('[global-setup] ready');
  } catch (err) {
    console.error('[global-setup] failed; dumping logs:');
    console.error(dumpLogs());
    throw err;
  }
  return async () => {
    console.log('[global-setup] tearing down stack…');
    await stopStack();
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add tests/integration/helpers/analyze.mjs tests/integration/helpers/golden.mjs tests/integration/helpers/global-setup.mjs
git commit -m "test: add analyze/golden/global-setup helpers"
```

---

## Section D — Pure-logic unit tests (Tasks 10-13)

Tests sur les fonctions pures qu'on a écrites côté serveur. Pas de Docker, pas de fetch.

> **Pre-req:** Pour chaque test pure, il faut que le module serveur **exporte** la fonction pure. La plupart de nos `docker-server-*.mjs` n'ont pas d'exports explicites (ils sont chargés comme route handlers). On va donc créer une couche `core/` séparée et faire que les `docker-server-*.mjs` l'importent. Cette refacto est petite (extraire la fonction maths) et nécessaire pour la testabilité.

### Task 10: Extract pure CSV serializer + unit test

**Files:**
- Modify: `upstream/docker-server-csv.mjs` (extract pure functions)
- Create: `upstream/docker-server-csv-core.mjs` (pure)
- Create: `tests/unit/csv-serializer.test.mjs`

- [ ] **Step 1: Read current docker-server-csv.mjs**

Run: `Get-Content upstream/docker-server-csv.mjs | Select-Object -First 100`
Expected: voir la structure actuelle pour identifier la fonction pure de serialization.

- [ ] **Step 2: Create `upstream/docker-server-csv-core.mjs`**

```js
/**
 * Pure CSV serialization. No HTTP, no fs. Importable by tests.
 */

const CSV_ESCAPE_RE = /[",\r\n]/;

export function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (!CSV_ESCAPE_RE.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows, { columns } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return columns ? columns.join(',') + '\n' : '';
  }
  const cols = columns ?? Object.keys(rows[0]);
  const header = cols.join(',');
  const body = rows.map(r => cols.map(c => escapeCsvCell(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}
```

- [ ] **Step 3: Update `upstream/docker-server-csv.mjs` to re-export from core**

Edit `upstream/docker-server-csv.mjs` — replace whatever inline serializer existed with:

```js
import { escapeCsvCell, toCsv } from './docker-server-csv-core.mjs';
export { escapeCsvCell, toCsv };
// … rest of routing/handler code unchanged
```

(The exact edit depends on current contents. If the existing file already has a clean inline serializer, just move those functions to `*-core.mjs` and re-export.)

- [ ] **Step 4: Write the failing test**

`tests/unit/csv-serializer.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { escapeCsvCell, toCsv } from '../../upstream/docker-server-csv-core.mjs';

describe('escapeCsvCell', () => {
  it('passes safe values through', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell(42)).toBe('42');
  });
  it('quotes values with commas, quotes, or newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });
  it('treats null/undefined as empty', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('emits header + rows', () => {
    const out = toCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
    expect(out).toBe('a,b\n1,x\n2,y\n');
  });
  it('honors explicit column order', () => {
    const out = toCsv([{ a: 1, b: 'x' }], { columns: ['b', 'a'] });
    expect(out).toBe('b,a\nx,1\n');
  });
  it('emits just the header when rows is empty (with columns)', () => {
    expect(toCsv([], { columns: ['a', 'b'] })).toBe('a,b\n');
  });
});
```

- [ ] **Step 5: Run the test, expect green**

Run: `cd tests && npm run test:unit -- csv-serializer`
Expected: 6 tests passed.

- [ ] **Step 6: Commit**

```bash
git add upstream/docker-server-csv-core.mjs upstream/docker-server-csv.mjs tests/unit/csv-serializer.test.mjs
git commit -m "test(csv): extract pure serializer + add unit tests

Also regenerate patches/upstream-all.diff in a follow-up commit."
```

- [ ] **Step 7: Regenerate the upstream patch**

```bash
cd upstream
git add -N .
git diff HEAD > ../patches/upstream-all.diff
git reset
cd ..
git add patches/upstream-all.diff
git commit -m "test(csv): regenerate upstream patch after csv-core extraction"
```

---

### Task 11: Extract pure entropy math + unit test

**Files:**
- Create: `upstream/docker-server-entropy-core.mjs`
- Modify: `upstream/docker-server-entropy.mjs` (re-export pure fns)
- Create: `tests/unit/entropy-math.test.mjs`

- [ ] **Step 1: Create the core module**

```js
/**
 * Pure entropy math: density + modularity ratio per snapshot.
 */

export function density(nodeCount, edgeCount) {
  if (nodeCount < 2) return 0;
  const max = nodeCount * (nodeCount - 1);
  return (2 * edgeCount) / max;
}

export function modularityRatio(communityCount, nodeCount) {
  if (nodeCount === 0) return 0;
  return communityCount / nodeCount;
}

export function entropyForSnapshot({ nodes, edges, communities }) {
  return {
    density: density(nodes, edges),
    modularity: modularityRatio(communities, nodes),
  };
}
```

- [ ] **Step 2: Update `upstream/docker-server-entropy.mjs` to use the core**

Read current contents, then refactor: import from `-core` and remove duplicated math.

- [ ] **Step 3: Write the test**

`tests/unit/entropy-math.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { density, modularityRatio, entropyForSnapshot } from '../../upstream/docker-server-entropy-core.mjs';

describe('density', () => {
  it('is 0 for fewer than 2 nodes', () => {
    expect(density(0, 0)).toBe(0);
    expect(density(1, 0)).toBe(0);
  });
  it('matches 2*E / N*(N-1)', () => {
    expect(density(4, 6)).toBeCloseTo(1.0, 6);   // complete graph
    expect(density(4, 3)).toBeCloseTo(0.5, 6);
  });
});

describe('modularityRatio', () => {
  it('is 0 for empty graph', () => {
    expect(modularityRatio(0, 0)).toBe(0);
  });
  it('is communities / nodes', () => {
    expect(modularityRatio(3, 12)).toBe(0.25);
  });
});

describe('entropyForSnapshot', () => {
  it('combines density and modularity', () => {
    const res = entropyForSnapshot({ nodes: 4, edges: 6, communities: 2 });
    expect(res.density).toBeCloseTo(1.0, 6);
    expect(res.modularity).toBeCloseTo(0.5, 6);
  });
});
```

- [ ] **Step 4: Run, expect green**

Run: `cd tests && npm run test:unit -- entropy-math`
Expected: 6 tests passed.

- [ ] **Step 5: Commit + regenerate patch**

```bash
git add upstream/docker-server-entropy-core.mjs upstream/docker-server-entropy.mjs tests/unit/entropy-math.test.mjs
git commit -m "test(entropy): extract pure math + add unit tests"
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "test(entropy): regenerate upstream patch"
```

---

### Task 12: Extract pure bus-factor math + unit test

**Files:**
- Create: `upstream/docker-server-ownership-core.mjs`
- Modify: `upstream/docker-server-ownership.mjs`
- Create: `tests/unit/ownership-bus-factor.test.mjs`

- [ ] **Step 1: Create the core**

```js
/**
 * Pure ownership math: bus factor from per-author commit counts.
 */

/**
 * Returns the smallest k such that the top-k authors cover >= threshold
 * fraction of the total commits for a file.
 */
export function busFactor(authorCounts, threshold = 0.8) {
  const total = Object.values(authorCounts).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const sorted = Object.values(authorCounts).sort((a, b) => b - a);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i];
    if (acc / total >= threshold) return i + 1;
  }
  return sorted.length;
}

export function topAuthors(authorCounts, limit = 3) {
  return Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([author, count]) => ({ author, count }));
}
```

- [ ] **Step 2: Update `docker-server-ownership.mjs` to use core**

Re-export and remove inline math.

- [ ] **Step 3: Write the test**

`tests/unit/ownership-bus-factor.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { busFactor, topAuthors } from '../../upstream/docker-server-ownership-core.mjs';

describe('busFactor', () => {
  it('returns 0 for empty input', () => {
    expect(busFactor({})).toBe(0);
  });
  it('returns 1 when a single author wrote everything', () => {
    expect(busFactor({ alice: 10 })).toBe(1);
  });
  it('returns 1 when one author owns >= 80% with default threshold', () => {
    expect(busFactor({ alice: 8, bob: 2 })).toBe(1);
  });
  it('returns 2 when two authors cumulatively reach the threshold', () => {
    expect(busFactor({ alice: 5, bob: 4, carol: 1 })).toBe(2);
  });
  it('honors custom threshold', () => {
    expect(busFactor({ alice: 5, bob: 4, carol: 1 }, 0.95)).toBe(3);
  });
});

describe('topAuthors', () => {
  it('returns sorted descending by count', () => {
    const out = topAuthors({ alice: 1, bob: 5, carol: 3 });
    expect(out).toEqual([
      { author: 'bob', count: 5 },
      { author: 'carol', count: 3 },
      { author: 'alice', count: 1 },
    ]);
  });
  it('respects the limit', () => {
    const out = topAuthors({ a: 1, b: 2, c: 3, d: 4 }, 2);
    expect(out).toHaveLength(2);
    expect(out[0].author).toBe('d');
  });
});
```

- [ ] **Step 4: Run, expect green**

Run: `cd tests && npm run test:unit -- ownership-bus-factor`
Expected: 7 tests passed.

- [ ] **Step 5: Commit + regen patch**

```bash
git add upstream/docker-server-ownership-core.mjs upstream/docker-server-ownership.mjs tests/unit/ownership-bus-factor.test.mjs
git commit -m "test(ownership): extract pure bus-factor math + add unit tests"
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "test(ownership): regenerate upstream patch"
```

---

### Task 13: Extract pure dissonance overlap + unit test

**Files:**
- Create: `upstream/docker-server-dissonance-core.mjs`
- Modify: `upstream/docker-server-dissonance.mjs`
- Create: `tests/unit/dissonance-overlap.test.mjs`

- [ ] **Step 1: Create the core**

```js
/**
 * Pure dissonance math: purity per cluster, misplaced files list.
 *
 * Inputs:
 *   fileDomains:    Map<filePath, declaredDomain>
 *   fileClusters:   Map<filePath, detectedClusterId>
 *
 * For each cluster, "purity" = max count of any single domain / total files in cluster.
 * A misplaced file is one whose declaredDomain != the dominant domain of its cluster.
 */

export function clusterPurity(fileDomains, fileClusters) {
  const clusters = new Map();
  for (const [file, cluster] of fileClusters.entries()) {
    const domain = fileDomains.get(file) ?? null;
    if (!clusters.has(cluster)) clusters.set(cluster, { counts: {}, total: 0 });
    const c = clusters.get(cluster);
    c.counts[domain] = (c.counts[domain] ?? 0) + 1;
    c.total += 1;
  }
  const result = {};
  for (const [id, { counts, total }] of clusters.entries()) {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const [dominant, dominantCount] = sorted[0];
    result[id] = {
      total,
      dominantDomain: dominant,
      purity: dominantCount / total,
    };
  }
  return result;
}

export function misplacedFiles(fileDomains, fileClusters, purityByCluster) {
  const out = [];
  for (const [file, cluster] of fileClusters.entries()) {
    const declared = fileDomains.get(file) ?? null;
    const dominant = purityByCluster[cluster]?.dominantDomain ?? null;
    if (declared !== dominant) {
      out.push({ file, declaredDomain: declared, clusterId: cluster, dominantDomain: dominant });
    }
  }
  return out;
}
```

- [ ] **Step 2: Update `docker-server-dissonance.mjs` to use core**

Re-export and remove inline math.

- [ ] **Step 3: Write the test**

`tests/unit/dissonance-overlap.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { clusterPurity, misplacedFiles } from '../../upstream/docker-server-dissonance-core.mjs';

const domains = new Map([
  ['src/auth/login.ts', 'auth'],
  ['src/auth/legacy.js', 'auth'],
  ['src/db/schema.ts', 'data'],
  ['src/db/orphan.py', 'data'],
  ['src/utils/helpers.ts', null],
]);

describe('clusterPurity', () => {
  it('reports 100% purity when all files in a cluster share a domain', () => {
    const clusters = new Map([
      ['src/auth/login.ts', 'C1'],
      ['src/auth/legacy.js', 'C1'],
    ]);
    const out = clusterPurity(domains, clusters);
    expect(out.C1).toEqual({ total: 2, dominantDomain: 'auth', purity: 1 });
  });
  it('reports fractional purity when a cluster mixes domains', () => {
    const clusters = new Map([
      ['src/auth/login.ts', 'C1'],
      ['src/db/schema.ts', 'C1'],
      ['src/db/orphan.py', 'C1'],
    ]);
    const out = clusterPurity(domains, clusters);
    expect(out.C1.total).toBe(3);
    expect(out.C1.dominantDomain).toBe('data');
    expect(out.C1.purity).toBeCloseTo(2 / 3, 6);
  });
});

describe('misplacedFiles', () => {
  it('lists files whose declared domain differs from cluster dominant', () => {
    const clusters = new Map([
      ['src/auth/login.ts', 'C1'],
      ['src/db/schema.ts', 'C1'],
      ['src/db/orphan.py', 'C1'],
    ]);
    const purity = clusterPurity(domains, clusters);
    const out = misplacedFiles(domains, clusters, purity);
    expect(out).toHaveLength(1);
    expect(out[0].file).toBe('src/auth/login.ts');
    expect(out[0].declaredDomain).toBe('auth');
    expect(out[0].dominantDomain).toBe('data');
  });
});
```

- [ ] **Step 4: Run, expect green**

Run: `cd tests && npm run test:unit -- dissonance-overlap`
Expected: 3 tests passed.

- [ ] **Step 5: Commit + regen patch**

```bash
git add upstream/docker-server-dissonance-core.mjs upstream/docker-server-dissonance.mjs tests/unit/dissonance-overlap.test.mjs
git commit -m "test(dissonance): extract pure overlap math + add unit tests"
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "test(dissonance): regenerate upstream patch"
```

---

## Section E — Component unit tests (Tasks 14-23)

Tests render-and-smoke pour chacun de nos 10 composants React. Pattern identique — render avec props raisonnables, assert que des éléments-clés apparaissent, simuler un événement clé.

> **Pattern :** chaque test importe le composant **depuis le checkout `upstream/`** (les composants vivent dans `upstream/gitnexus-web/src/components/`). Le wrapper Vitest peut résoudre ces chemins grâce à `@vitejs/plugin-react`. Si un composant a besoin de contexte (Sigma, Router), on le wrap dans le test.

### Task 14: EntropyBadge component test

**Files:**
- Create: `tests/unit/components/EntropyBadge.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EntropyBadge from '../../../upstream/gitnexus-web/src/components/EntropyBadge';

describe('EntropyBadge', () => {
  it('returns null with fewer than 2 data points', () => {
    const { container } = render(<EntropyBadge points={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders density and trend with >=2 points', () => {
    render(<EntropyBadge points={[
      { commit: 'a', density: 0.1, modularity: 0.5 },
      { commit: 'b', density: 0.15, modularity: 0.45 },
    ]} />);
    expect(screen.getByText(/density/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect green (or red with import path issue)**

Run: `cd tests && npm run test:unit -- EntropyBadge`
Expected: 2 tests passed. If import path is wrong, the error tells you exactly which file to look at.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/EntropyBadge.test.tsx
git commit -m "test(component): EntropyBadge render + auto-hide"
```

---

### Task 15: OwnershipPanel component test

**Files:**
- Create: `tests/unit/components/OwnershipPanel.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OwnershipPanel from '../../../upstream/gitnexus-web/src/components/OwnershipPanel';

const sample = [
  { file: 'src/auth/login.ts', busFactor: 1, topAuthors: [{ author: 'alice', count: 6 }], totalCommits: 6 },
  { file: 'src/db/schema.ts', busFactor: 2, topAuthors: [{ author: 'alice', count: 3 }, { author: 'bob', count: 2 }], totalCommits: 5 },
];

describe('OwnershipPanel', () => {
  it('renders rows for each file', () => {
    render(<OwnershipPanel data={sample} onFileSelect={vi.fn()} />);
    expect(screen.getByText('src/auth/login.ts')).toBeInTheDocument();
    expect(screen.getByText('src/db/schema.ts')).toBeInTheDocument();
  });

  it('filters by bus-factor slider', () => {
    render(<OwnershipPanel data={sample} onFileSelect={vi.fn()} />);
    const slider = screen.getByLabelText(/bus.factor/i);
    fireEvent.change(slider, { target: { value: '1' } });
    expect(screen.getByText('src/auth/login.ts')).toBeInTheDocument();
    expect(screen.queryByText('src/db/schema.ts')).not.toBeInTheDocument();
  });

  it('calls onFileSelect on row click', () => {
    const onFileSelect = vi.fn();
    render(<OwnershipPanel data={sample} onFileSelect={onFileSelect} />);
    fireEvent.click(screen.getByText('src/auth/login.ts'));
    expect(onFileSelect).toHaveBeenCalledWith('src/auth/login.ts');
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:unit -- OwnershipPanel`
Expected: 3 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/OwnershipPanel.test.tsx
git commit -m "test(component): OwnershipPanel render + slider filter + click"
```

---

### Task 16: CouplingPanel component test

**Files:**
- Create: `tests/unit/components/CouplingPanel.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CouplingPanel from '../../../upstream/gitnexus-web/src/components/CouplingPanel';

const pairs = [
  { fileA: 'src/auth/login.ts', fileB: 'src/db/schema.ts', cochanges: 4, support: 0.4 },
  { fileA: 'src/auth/login.ts', fileB: 'src/utils/helpers.ts', cochanges: 1, support: 0.1 },
];

describe('CouplingPanel', () => {
  it('renders each pair', () => {
    render(<CouplingPanel pairs={pairs} onPairSelect={vi.fn()} />);
    expect(screen.getByText('src/db/schema.ts')).toBeInTheDocument();
    expect(screen.getByText('src/utils/helpers.ts')).toBeInTheDocument();
  });

  it('sorts by cochanges descending by default', () => {
    render(<CouplingPanel pairs={pairs} onPairSelect={vi.fn()} />);
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('schema.ts');
    expect(rows[2]).toHaveTextContent('helpers.ts');
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:unit -- CouplingPanel`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/CouplingPanel.test.tsx
git commit -m "test(component): CouplingPanel render + default sort"
```

---

### Task 17: GrowthChart component test

**Files:**
- Create: `tests/unit/components/GrowthChart.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GrowthChart from '../../../upstream/gitnexus-web/src/components/GrowthChart';

const series = [
  { commit: 'a', date: '2025-01-01', counts: { File: 5, Function: 10 } },
  { commit: 'b', date: '2025-01-15', counts: { File: 8, Function: 14 } },
  { commit: 'c', date: '2025-01-30', counts: { File: 10, Function: 20 } },
];

describe('GrowthChart', () => {
  it('renders an SVG with one line per category', () => {
    const { container } = render(<GrowthChart series={series} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
  });

  it('shows category labels in a legend', () => {
    render(<GrowthChart series={series} />);
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('Function')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:unit -- GrowthChart`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/GrowthChart.test.tsx
git commit -m "test(component): GrowthChart renders svg + legend"
```

---

### Task 18: LifespanPanel component test

**Files:**
- Create: `tests/unit/components/LifespanPanel.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LifespanPanel from '../../../upstream/gitnexus-web/src/components/LifespanPanel';

const buckets = {
  foundational: ['src/utils/helpers.ts'],
  recent: ['src/db/orphan.py'],
  discontinued: ['src/auth/legacy.js'],
  ephemeral: [],
};

describe('LifespanPanel', () => {
  it('renders each non-empty bucket', () => {
    render(<LifespanPanel buckets={buckets} onFileSelect={vi.fn()} />);
    expect(screen.getByText(/foundational/i)).toBeInTheDocument();
    expect(screen.getByText(/recent/i)).toBeInTheDocument();
    expect(screen.getByText(/discontinued/i)).toBeInTheDocument();
    expect(screen.getByText('src/utils/helpers.ts')).toBeInTheDocument();
  });

  it('hides empty buckets', () => {
    render(<LifespanPanel buckets={buckets} onFileSelect={vi.fn()} />);
    expect(screen.queryByText(/ephemeral/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:unit -- LifespanPanel`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/LifespanPanel.test.tsx
git commit -m "test(component): LifespanPanel renders non-empty buckets"
```

---

### Task 19: DissonancePanel component test

**Files:**
- Create: `tests/unit/components/DissonancePanel.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DissonancePanel from '../../../upstream/gitnexus-web/src/components/DissonancePanel';

const data = {
  globalScore: 0.72,
  clusters: {
    C1: { total: 3, dominantDomain: 'data', purity: 0.66 },
    C2: { total: 2, dominantDomain: 'auth', purity: 1 },
  },
  misplaced: [{ file: 'src/auth/login.ts', declaredDomain: 'auth', clusterId: 'C1', dominantDomain: 'data' }],
};

describe('DissonancePanel', () => {
  it('shows the global purity score', () => {
    render(<DissonancePanel data={data} onFileSelect={vi.fn()} />);
    expect(screen.getByText(/0\.72/)).toBeInTheDocument();
  });

  it('lists misplaced files', () => {
    render(<DissonancePanel data={data} onFileSelect={vi.fn()} />);
    expect(screen.getByText('src/auth/login.ts')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:unit -- DissonancePanel`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/DissonancePanel.test.tsx
git commit -m "test(component): DissonancePanel shows score + misplaced files"
```

---

### Task 20: DiffBanner component test

**Files:**
- Create: `tests/unit/components/DiffBanner.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiffBanner from '../../../upstream/gitnexus-web/src/components/DiffBanner';

describe('DiffBanner', () => {
  it('shows added/removed/kept counts', () => {
    render(<DiffBanner repoA="a" repoB="b" added={5} removed={3} kept={42} />);
    expect(screen.getByText(/5/)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it('mentions both repo names', () => {
    render(<DiffBanner repoA="alpha" repoB="beta" added={0} removed={0} kept={0} />);
    expect(screen.getByText(/alpha/)).toBeInTheDocument();
    expect(screen.getByText(/beta/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:unit -- DiffBanner`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/DiffBanner.test.tsx
git commit -m "test(component): DiffBanner shows counts + repo names"
```

---

### Task 21: Timeline component test

**Files:**
- Create: `tests/unit/components/Timeline.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Timeline from '../../../upstream/gitnexus-web/src/components/Timeline';

const snapshots = [
  { id: 's1', commit: 'a', date: '2025-01-01', label: 'commit 1' },
  { id: 's2', commit: 'b', date: '2025-01-15', label: 'commit 2' },
  { id: 's3', commit: 'c', date: '2025-01-30', label: 'commit 3' },
];

describe('Timeline', () => {
  it('renders a slider with one tick per snapshot', () => {
    render(<Timeline snapshots={snapshots} current="s1" onSelect={vi.fn()} />);
    const slider = screen.getByRole('slider');
    expect(slider).toBeInTheDocument();
  });

  it('calls onSelect when play advances', async () => {
    const onSelect = vi.fn();
    render(<Timeline snapshots={snapshots} current="s1" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    await new Promise(r => setTimeout(r, 200));
    expect(onSelect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:unit -- Timeline`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/Timeline.test.tsx
git commit -m "test(component): Timeline slider + play advances"
```

---

### Task 22: SnapshotsPanel component test

**Files:**
- Create: `tests/unit/components/SnapshotsPanel.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SnapshotsPanel from '../../../upstream/gitnexus-web/src/components/SnapshotsPanel';

const snapshots = [
  { id: 's1', commit: 'aaa1', date: '2025-01-01', author: 'alice' },
  { id: 's2', commit: 'bbb2', date: '2025-01-15', author: 'bob' },
];

describe('SnapshotsPanel', () => {
  it('lists each snapshot', () => {
    render(<SnapshotsPanel snapshots={snapshots} onDelete={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText(/aaa1/)).toBeInTheDocument();
    expect(screen.getByText(/bbb2/)).toBeInTheDocument();
  });

  it('calls onDelete when delete button clicked', () => {
    const onDelete = vi.fn();
    render(<SnapshotsPanel snapshots={snapshots} onDelete={onDelete} onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(buttons[0]);
    expect(onDelete).toHaveBeenCalledWith('s1');
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:unit -- SnapshotsPanel`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/SnapshotsPanel.test.tsx
git commit -m "test(component): SnapshotsPanel list + delete"
```

---

### Task 23: BulkSnapshotModal component test

**Files:**
- Create: `tests/unit/components/BulkSnapshotModal.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BulkSnapshotModal from '../../../upstream/gitnexus-web/src/components/BulkSnapshotModal';

describe('BulkSnapshotModal', () => {
  it('renders count and windowDays inputs', () => {
    render(<BulkSnapshotModal open onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByLabelText(/count/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/window/i)).toBeInTheDocument();
  });

  it('calls onConfirm with the chosen values', () => {
    const onConfirm = vi.fn();
    render(<BulkSnapshotModal open onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/count/i), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText(/window/i), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith({ count: 15, windowDays: 45 });
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:unit -- BulkSnapshotModal`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/BulkSnapshotModal.test.tsx
git commit -m "test(component): BulkSnapshotModal inputs + confirm"
```

---

## Section F — Integration baseline (Tasks 24-26)

Tests qui vérifient que la stack démarre, que les routes attendues existent, et que le patch lbug-staleness tient.

### Task 24: stack-health integration test

**Files:**
- Create: `tests/integration/stack-health.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from './helpers/api-client.mjs';

const REQUIRED_ROUTES = [
  '/health',
  '/api/repos',
  '/snapshots',
  '/churn',
  '/coupling',
  '/coupling/cross',
  '/growth',
  '/growth/cross',
  '/lifespan',
  '/entropy',
  '/ownership',
  '/dissonance',
  '/semantic-labels',
  '/listdir',
  '/api/graph',
  '/export',
];

describe('stack health', () => {
  const api = getApi();

  it('returns ok on /health', async () => {
    const res = await api.health();
    expect(res).toMatchObject({ status: 'ok' });
  });

  it('exposes every documented route (200 or 4xx, not 404)', async () => {
    for (const route of REQUIRED_ROUTES) {
      const r = await fetch(`http://localhost:${process.env.TEST_PORT || 4747}${route}`);
      expect(r.status, `${route} should not be 404`).not.toBe(404);
    }
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:integ -- stack-health`
Expected: 2 tests passed. (Global setup boots Docker + analyzes fixture before the test runs — ~90s first time.)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/stack-health.test.mjs
git commit -m "test(integ): stack health + route presence"
```

---

### Task 25: Snapshot integration test

**Files:**
- Create: `tests/integration/endpoints/snapshot.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect, beforeAll } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

describe('snapshot endpoints', () => {
  const api = getApi();
  let snapshotsBefore;

  beforeAll(async () => {
    snapshotsBefore = await api.listSnapshots(FIXTURE.name);
  });

  it('GET /snapshots returns the bulk-snapshotted history', async () => {
    expect(snapshotsBefore.length).toBeGreaterThanOrEqual(10);
    expect(snapshotsBefore[0]).toMatchObject({
      id: expect.any(String),
      commit: expect.any(String),
      date: expect.any(String),
    });
  });

  it('POST /snapshot creates an extra snapshot when given a commit', async () => {
    // Use the first commit of the fixture (deterministic).
    const sha = snapshotsBefore[snapshotsBefore.length - 1].commit;
    await api.createSnapshot(FIXTURE.name, sha);
    const after = await api.listSnapshots(FIXTURE.name);
    expect(after.length).toBe(snapshotsBefore.length + 1);
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:integ -- snapshot.test`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/snapshot.test.mjs
git commit -m "test(integ): /snapshot create + list"
```

---

### Task 26: Snapshot bulk integration test

**Files:**
- Create: `tests/integration/endpoints/snapshot-bulk.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

describe('POST /snapshot/bulk + GET /snapshot/bulk/:jobId', () => {
  const api = getApi();

  it('starts a job and reports completion via the status endpoint', async () => {
    const job = await api.bulkSnapshot(FIXTURE.name, { count: 3, windowDays: 30 });
    expect(job).toMatchObject({ jobId: expect.any(String) });

    let state = await api.bulkSnapshotStatus(job.jobId);
    const start = Date.now();
    while (state.state !== 'done' && Date.now() - start < 60_000) {
      await new Promise(r => setTimeout(r, 500));
      state = await api.bulkSnapshotStatus(job.jobId);
    }
    expect(state.state).toBe('done');
    expect(state.progress).toBeGreaterThanOrEqual(state.total);
  });
});
```

- [ ] **Step 2: Run, expect green**

Run: `cd tests && npm run test:integ -- snapshot-bulk`
Expected: 1 test passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/snapshot-bulk.test.mjs
git commit -m "test(integ): /snapshot/bulk job lifecycle"
```

---

## Section G — Analytics integration tests (Tasks 27-37)

Pattern identique pour chaque endpoint analytique : schema check + golden snapshot.

### Task 27: /churn integration test

**Files:**
- Create: `tests/integration/endpoints/churn.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';
import { expectGolden } from '../helpers/golden.mjs';

describe('GET /churn', () => {
  const api = getApi();
  let response;

  it('returns an array of {file, changes, snapshots}', async () => {
    response = await api.churn(FIXTURE.name);
    expect(Array.isArray(response)).toBe(true);
    expect(response[0]).toMatchObject({
      file: expect.any(String),
      changes: expect.any(Number),
    });
  });

  it('marks login.ts as the hottest file in the fixture', () => {
    const sorted = [...response].sort((a, b) => b.changes - a.changes);
    expect(sorted[0].file).toContain('src/auth/login.ts');
  });

  it('matches golden snapshot', () => {
    expectGolden('churn', response);
  });
});
```

- [ ] **Step 2: Capture golden + run**

Run (first time only): `cd tests && WRITE_GOLDEN=1 npm run test:integ -- churn`
Then: `cd tests && npm run test:integ -- churn`
Expected: 3 tests passed (after golden capture).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/churn.test.mjs tests/fixtures/expected/churn.json
git commit -m "test(integ): /churn schema + golden"
```

---

### Task 28: /coupling integration test

**Files:**
- Create: `tests/integration/endpoints/coupling.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';
import { expectGolden } from '../helpers/golden.mjs';

describe('GET /coupling', () => {
  const api = getApi();
  let response;

  it('returns an array of {fileA, fileB, cochanges, support}', async () => {
    response = await api.coupling(FIXTURE.name);
    expect(Array.isArray(response)).toBe(true);
    if (response.length > 0) {
      expect(response[0]).toMatchObject({
        fileA: expect.any(String),
        fileB: expect.any(String),
        cochanges: expect.any(Number),
        support: expect.any(Number),
      });
    }
  });

  it('matches golden snapshot', () => {
    expectGolden('coupling', response);
  });
});
```

- [ ] **Step 2: Capture + run**

Run: `cd tests && WRITE_GOLDEN=1 npm run test:integ -- coupling.test`
Then: `cd tests && npm run test:integ -- coupling.test`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/coupling.test.mjs tests/fixtures/expected/coupling.json
git commit -m "test(integ): /coupling schema + golden"
```

---

### Task 29: /coupling/cross integration test

**Files:**
- Create: `tests/integration/endpoints/coupling-cross.test.mjs`

> **Note:** Cross-repo a besoin de ≥ 2 repos indexés. Pour ce test on indexe une 2ème copie du fixture sous un nom différent. C'est suffisant pour exercer la route sans bâtir une deuxième fixture distincte.

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect, beforeAll } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';
import { expectGolden } from '../helpers/golden.mjs';

const SECOND_NAME = 'sample-repo-clone';

describe('GET /coupling/cross', () => {
  const api = getApi();
  let response;

  beforeAll(async () => {
    // Register the same fixture under a 2nd name to exercise multi-repo.
    await api.analyze(FIXTURE.path, { skipEmbeddings: true, force: true, as: SECOND_NAME });
    await api.bulkSnapshot(SECOND_NAME, { count: 5, windowDays: 30 });
    // wait for the bulk to finish
    let s;
    do { await new Promise(r => setTimeout(r, 500)); s = await api.listSnapshots(SECOND_NAME); } while (s.length < 5);
  }, 120_000);

  it('accepts ?repos=A,B and returns cross-repo pairs', async () => {
    response = await api.couplingCross([FIXTURE.name, SECOND_NAME]);
    expect(Array.isArray(response)).toBe(true);
  });

  it('matches golden snapshot', () => {
    expectGolden('coupling-cross', response);
  });
});
```

- [ ] **Step 2: Capture + run**

Run: `cd tests && WRITE_GOLDEN=1 npm run test:integ -- coupling-cross`
Then: `cd tests && npm run test:integ -- coupling-cross`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/coupling-cross.test.mjs tests/fixtures/expected/coupling-cross.json
git commit -m "test(integ): /coupling/cross schema + golden"
```

---

### Task 30: /growth integration test

**Files:**
- Create: `tests/integration/endpoints/growth.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';
import { expectGolden } from '../helpers/golden.mjs';

describe('GET /growth', () => {
  const api = getApi();
  let response;

  it('returns one entry per snapshot with counts by category', async () => {
    response = await api.growth(FIXTURE.name);
    expect(Array.isArray(response)).toBe(true);
    expect(response.length).toBeGreaterThanOrEqual(10);
    expect(response[0]).toMatchObject({
      commit: expect.any(String),
      counts: expect.any(Object),
    });
  });

  it('reports a non-zero File count', () => {
    const last = response[response.length - 1];
    expect(last.counts.File ?? 0).toBeGreaterThan(0);
  });

  it('matches golden snapshot', () => {
    expectGolden('growth', response);
  });
});
```

- [ ] **Step 2: Capture + run**

Run: `cd tests && WRITE_GOLDEN=1 npm run test:integ -- growth.test`
Then: `cd tests && npm run test:integ -- growth.test`
Expected: 3 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/growth.test.mjs tests/fixtures/expected/growth.json
git commit -m "test(integ): /growth schema + golden"
```

---

### Task 31: /growth/cross integration test

**Files:**
- Create: `tests/integration/endpoints/growth-cross.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';
import { expectGolden } from '../helpers/golden.mjs';

describe('GET /growth/cross', () => {
  const api = getApi();
  let response;

  it('returns aligned timeline across repos', async () => {
    // Reuses the sample-repo-clone registered in coupling-cross test.
    response = await api.growthCross([FIXTURE.name, 'sample-repo-clone']);
    expect(Array.isArray(response)).toBe(true);
    expect(response[0]).toMatchObject({
      date: expect.any(String),
      countsByRepo: expect.any(Object),
    });
  });

  it('matches golden snapshot', () => {
    expectGolden('growth-cross', response);
  });
});
```

- [ ] **Step 2: Capture + run**

Run: `cd tests && WRITE_GOLDEN=1 npm run test:integ -- growth-cross`
Then: `cd tests && npm run test:integ -- growth-cross`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/growth-cross.test.mjs tests/fixtures/expected/growth-cross.json
git commit -m "test(integ): /growth/cross schema + golden"
```

---

### Task 32: /lifespan integration test

**Files:**
- Create: `tests/integration/endpoints/lifespan.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';
import { expectGolden } from '../helpers/golden.mjs';

describe('GET /lifespan', () => {
  const api = getApi();
  let response;

  it('returns 4 buckets', async () => {
    response = await api.lifespan(FIXTURE.name);
    expect(Object.keys(response).sort()).toEqual(['discontinued', 'ephemeral', 'foundational', 'recent']);
  });

  it('classifies legacy.js as discontinued', () => {
    expect(response.discontinued).toContain('src/auth/legacy.js');
  });

  it('classifies orphan.py as recent', () => {
    expect(response.recent).toContain('src/db/orphan.py');
  });

  it('classifies helpers.ts as foundational', () => {
    expect(response.foundational).toContain('src/utils/helpers.ts');
  });

  it('matches golden snapshot', () => {
    expectGolden('lifespan', response);
  });
});
```

- [ ] **Step 2: Capture + run**

Run: `cd tests && WRITE_GOLDEN=1 npm run test:integ -- lifespan`
Then: `cd tests && npm run test:integ -- lifespan`
Expected: 5 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/lifespan.test.mjs tests/fixtures/expected/lifespan.json
git commit -m "test(integ): /lifespan buckets + golden"
```

---

### Task 33: /entropy integration test

**Files:**
- Create: `tests/integration/endpoints/entropy.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';
import { expectGolden } from '../helpers/golden.mjs';

describe('GET /entropy', () => {
  const api = getApi();
  let response;

  it('returns density+modularity per snapshot', async () => {
    response = await api.entropy(FIXTURE.name);
    expect(Array.isArray(response)).toBe(true);
    expect(response.length).toBeGreaterThanOrEqual(10);
    expect(response[0]).toMatchObject({
      commit: expect.any(String),
      density: expect.any(Number),
      modularity: expect.any(Number),
    });
  });

  it('density is between 0 and 1', () => {
    for (const p of response) expect(p.density).toBeGreaterThanOrEqual(0);
    for (const p of response) expect(p.density).toBeLessThanOrEqual(1);
  });

  it('matches golden snapshot', () => {
    expectGolden('entropy', response);
  });
});
```

- [ ] **Step 2: Capture + run**

Run: `cd tests && WRITE_GOLDEN=1 npm run test:integ -- entropy.test`
Then: `cd tests && npm run test:integ -- entropy.test`
Expected: 3 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/entropy.test.mjs tests/fixtures/expected/entropy.json
git commit -m "test(integ): /entropy schema + range + golden"
```

---

### Task 34: /ownership integration test

**Files:**
- Create: `tests/integration/endpoints/ownership.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';
import { expectGolden } from '../helpers/golden.mjs';

describe('GET /ownership', () => {
  const api = getApi();
  let response;

  it('returns per-file bus factor + top authors', async () => {
    response = await api.ownership(FIXTURE.name);
    expect(response.files).toBeDefined();
    expect(response.files[0]).toMatchObject({
      file: expect.any(String),
      busFactor: expect.any(Number),
      topAuthors: expect.any(Array),
    });
  });

  it('reports login.ts as bus_factor=1 (alice-only writes)', () => {
    const login = response.files.find(f => f.file.endsWith('src/auth/login.ts'));
    expect(login.busFactor).toBe(1);
    expect(login.topAuthors[0].author).toMatch(/alice/i);
  });

  it('matches golden snapshot', () => {
    expectGolden('ownership', response);
  });
});
```

- [ ] **Step 2: Capture + run**

Run: `cd tests && WRITE_GOLDEN=1 npm run test:integ -- ownership.test`
Then: `cd tests && npm run test:integ -- ownership.test`
Expected: 3 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/ownership.test.mjs tests/fixtures/expected/ownership.json
git commit -m "test(integ): /ownership bus factor + golden"
```

---

### Task 35: /dissonance integration test

**Files:**
- Create: `tests/integration/endpoints/dissonance.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';
import { expectGolden } from '../helpers/golden.mjs';

describe('GET /dissonance', () => {
  const api = getApi();
  let response;

  it('returns global score + clusters + misplaced', async () => {
    response = await api.dissonance(FIXTURE.name);
    expect(response).toMatchObject({
      globalScore: expect.any(Number),
      clusters: expect.any(Object),
      misplaced: expect.any(Array),
    });
  });

  it('reports purity between 0 and 1 per cluster', () => {
    for (const c of Object.values(response.clusters)) {
      expect(c.purity).toBeGreaterThanOrEqual(0);
      expect(c.purity).toBeLessThanOrEqual(1);
    }
  });

  it('matches golden snapshot', () => {
    expectGolden('dissonance', response);
  });
});
```

- [ ] **Step 2: Capture + run**

Run: `cd tests && WRITE_GOLDEN=1 npm run test:integ -- dissonance`
Then: `cd tests && npm run test:integ -- dissonance`
Expected: 3 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/dissonance.test.mjs tests/fixtures/expected/dissonance.json
git commit -m "test(integ): /dissonance schema + range + golden"
```

---

### Task 36: /semantic-labels integration test

**Files:**
- Create: `tests/integration/endpoints/semantic-labels.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

describe('semantic labels endpoints', () => {
  const api = getApi();

  it('GET /semantic-labels returns the cache (may be empty)', async () => {
    const res = await api.semanticLabels(FIXTURE.name);
    expect(typeof res).toBe('object');
  });

  it('POST /semantic-labels stores a label and GET retrieves it', async () => {
    await api.setSemanticLabel(FIXTURE.name, 'C1', 'test-label');
    const res = await api.semanticLabels(FIXTURE.name);
    expect(res.C1).toMatchObject({ label: 'test-label' });
  });
});
```

- [ ] **Step 2: Run**

Run: `cd tests && npm run test:integ -- semantic-labels`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/semantic-labels.test.mjs
git commit -m "test(integ): /semantic-labels GET + POST cache"
```

---

### Task 37: CSV format universel integration test

**Files:**
- Create: `tests/integration/endpoints/csv-format.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const PORT = process.env.TEST_PORT || 4747;
const BASE = `http://localhost:${PORT}`;

const ENDPOINTS_WITH_CSV = [
  '/churn',
  '/coupling',
  '/growth',
  '/lifespan',
  '/entropy',
  '/ownership',
  '/dissonance',
];

describe.each(ENDPOINTS_WITH_CSV)('%s?format=csv', (path) => {
  it('returns text/csv with a Content-Disposition attachment header', async () => {
    const url = `${BASE}${path}?repo=${FIXTURE.name}&format=csv`;
    const res = await fetch(url);
    expect(res.ok, `${path} GET → ${res.status}`).toBe(true);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment/);
    const body = await res.text();
    expect(body).toMatch(/,/); // a CSV has commas
    expect(body.split('\n').length).toBeGreaterThan(1); // header + at least 1 row
  });
});
```

- [ ] **Step 2: Run**

Run: `cd tests && npm run test:integ -- csv-format`
Expected: 7 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/csv-format.test.mjs
git commit -m "test(integ): ?format=csv works on all analytics endpoints"
```

---

### Task 38: Export / Import integration test

**Files:**
- Create: `tests/integration/endpoints/export-import.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

describe('export / import', () => {
  const api = getApi();

  it('GET /export?repo=… returns a bundle blob', async () => {
    const res = await fetch(`http://localhost:${process.env.TEST_PORT || 4747}/export?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it('GET /export?repo=…&indexOnly=true returns a smaller blob', async () => {
    const full = await fetch(`http://localhost:${process.env.TEST_PORT || 4747}/export?repo=${FIXTURE.name}`).then(r => r.arrayBuffer());
    const idx = await fetch(`http://localhost:${process.env.TEST_PORT || 4747}/export?repo=${FIXTURE.name}&indexOnly=true`).then(r => r.arrayBuffer());
    expect(idx.byteLength).toBeLessThan(full.byteLength);
  });
});
```

- [ ] **Step 2: Run**

Run: `cd tests && npm run test:integ -- export-import`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/export-import.test.mjs
git commit -m "test(integ): /export bundle + indexOnly variants"
```

---

### Task 39: /api/graph diff integration test

**Files:**
- Create: `tests/integration/endpoints/diff.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

describe('GET /api/graph?diff', () => {
  const api = getApi();

  it('returns added/removed/kept counts when comparing 2 repos', async () => {
    const res = await api.graph(FIXTURE.name, { diff: `${FIXTURE.name},sample-repo-clone` });
    expect(res).toMatchObject({
      added: expect.any(Number),
      removed: expect.any(Number),
      kept: expect.any(Number),
    });
  });

  it('nodes carry a diff flag (+/-/=)', async () => {
    const res = await api.graph(FIXTURE.name, { diff: `${FIXTURE.name},sample-repo-clone`, withNodes: true });
    if (res.nodes && res.nodes.length > 0) {
      expect(['+', '-', '=']).toContain(res.nodes[0].diff);
    }
  });
});
```

- [ ] **Step 2: Run**

Run: `cd tests && npm run test:integ -- diff.test`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/diff.test.mjs
git commit -m "test(integ): /api/graph diff between 2 repos"
```

---

## Section H — Playwright e2e (Tasks 40-45)

5 specs ciblés sur les **flux utilisateur**, headless en CI, headed en local.

### Task 40: Playwright config + bootstrap

**Files:**
- Create: `tests/e2e/playwright.config.ts`

- [ ] **Step 1: Install Playwright browsers**

Run: `cd tests && npx playwright install chromium`
Expected: chromium binary installed (~150MB).

- [ ] **Step 2: Create the config**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playwright.config.ts
git commit -m "test(e2e): Playwright config (chromium, baseURL, artifacts)"
```

---

### Task 41: e2e — analyze + snapshot flow

**Files:**
- Create: `tests/e2e/specs/01-analyze-and-snapshot.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test.describe('analyze + snapshot', () => {
  test('home page loads and shows the repo picker', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Repo|Analyzer|GitNexus/i)).toBeVisible({ timeout: 30_000 });
  });

  test('shows the fixture repo in the list after analyze', async ({ page }) => {
    await page.goto('/');
    // The fixture is already indexed by globalSetup of the integration suite.
    // For e2e we expect the UI to list `sample-repo`.
    await expect(page.getByText('sample-repo')).toBeVisible({ timeout: 30_000 });
  });
});
```

- [ ] **Step 2: Run (against running stack)**

Pre-req: `docker compose -f docker-compose.test.yml up -d` + analyze a déjà tourné (en local : `cd tests && npm run test:integ` puis on garde la stack up).

Run: `cd tests && npm run test:e2e -- 01-analyze`
Expected: 2 tests passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/01-analyze-and-snapshot.spec.ts
git commit -m "test(e2e): home page loads and lists sample-repo"
```

---

### Task 42: e2e — timeline navigation

**Files:**
- Create: `tests/e2e/specs/02-timeline-navigation.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('timeline slider + play/pause', async ({ page }) => {
  await page.goto('/');
  await page.getByText('sample-repo').click();

  const slider = page.getByRole('slider');
  await expect(slider).toBeVisible({ timeout: 30_000 });

  const playButton = page.getByRole('button', { name: /play/i });
  await playButton.click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /pause/i }).click();
});
```

- [ ] **Step 2: Run**

Run: `cd tests && npm run test:e2e -- 02-timeline`
Expected: 1 test passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/02-timeline-navigation.spec.ts
git commit -m "test(e2e): timeline slider + play/pause"
```

---

### Task 43: e2e — analytics panels render

**Files:**
- Create: `tests/e2e/specs/03-analytics-panels.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

const PANELS = ['Coupling', 'Growth', 'Lifespan', 'Ownership', 'Dissonance'];

for (const name of PANELS) {
  test(`${name} panel renders content`, async ({ page }) => {
    await page.goto('/');
    await page.getByText('sample-repo').click();
    await page.getByRole('button', { name: new RegExp(name, 'i') }).click();
    await expect(page.locator(`[data-testid="${name.toLowerCase()}-panel"]`)).toBeVisible({ timeout: 15_000 });
  });
}
```

> **Note:** Requires that each panel adds `data-testid="<name>-panel"` to its
> outer wrapper. Add the attribute as part of this task if missing (small
> upstream patch).

- [ ] **Step 2: Add `data-testid` to each panel wrapper if missing**

Edit each of `upstream/gitnexus-web/src/components/{Coupling,Growth,Lifespan,Ownership,Dissonance}Panel.tsx` to add `data-testid="<name>-panel"` to the root element.

- [ ] **Step 3: Run**

Run: `cd tests && npm run test:e2e -- 03-analytics`
Expected: 5 tests passed.

- [ ] **Step 4: Commit (test) + regen patch**

```bash
git add tests/e2e/specs/03-analytics-panels.spec.ts upstream/gitnexus-web/src/components/CouplingPanel.tsx upstream/gitnexus-web/src/components/GrowthChart.tsx upstream/gitnexus-web/src/components/LifespanPanel.tsx upstream/gitnexus-web/src/components/OwnershipPanel.tsx upstream/gitnexus-web/src/components/DissonancePanel.tsx
git commit -m "test(e2e): analytics panels render + data-testid hooks"
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "test(e2e): regenerate upstream patch with data-testid hooks"
```

---

### Task 44: e2e — CSV download

**Files:**
- Create: `tests/e2e/specs/04-csv-download.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('CSV download from a panel', async ({ page }) => {
  await page.goto('/');
  await page.getByText('sample-repo').click();
  await page.getByRole('button', { name: /coupling/i }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /download.*csv/i }).click();
  const download = await downloadPromise;

  const path = await download.path();
  expect(path).toBeTruthy();
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});
```

- [ ] **Step 2: Run**

Run: `cd tests && npm run test:e2e -- 04-csv`
Expected: 1 test passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/04-csv-download.spec.ts
git commit -m "test(e2e): CSV download from coupling panel"
```

---

### Task 45: e2e — diff view

**Files:**
- Create: `tests/e2e/specs/05-diff-view.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('diff view shows red/green/grey banner', async ({ page }) => {
  await page.goto('/');
  // Both repos should already be indexed by the integration global setup.
  await page.getByText('sample-repo').click();
  // Open diff modal/picker (button label may vary, adjust if needed)
  await page.getByRole('button', { name: /diff|compare/i }).click();
  await page.getByText('sample-repo-clone').click();
  await page.getByRole('button', { name: /go|run|compare/i }).click();

  await expect(page.locator('[data-testid="diff-banner"]')).toBeVisible({ timeout: 15_000 });
});
```

> **Note:** add `data-testid="diff-banner"` to `DiffBanner.tsx` root if not
> present.

- [ ] **Step 2: Add testid if needed + run**

If missing, edit `upstream/gitnexus-web/src/components/DiffBanner.tsx` to add `data-testid="diff-banner"`.

Run: `cd tests && npm run test:e2e -- 05-diff`
Expected: 1 test passed.

- [ ] **Step 3: Commit + regen patch**

```bash
git add tests/e2e/specs/05-diff-view.spec.ts upstream/gitnexus-web/src/components/DiffBanner.tsx
git commit -m "test(e2e): diff view shows banner"
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "test(e2e): regenerate patch with diff-banner testid"
```

---

## Section I — Inventory + CI (Tasks 46-50)

### Task 46: tests/README.md inventory

**Files:**
- Create: `tests/README.md`

- [ ] **Step 1: Write the inventory**

```markdown
# GitNexus deployment — Test inventory

Dernière mise à jour automatique : voir `git log tests/README.md`.

## Commandes

| Command | Tourne | Durée cible |
|---|---|---|
| `cd tests && npm run test:smoke` | health + routes attendues | ~30s |
| `cd tests && npm run test:unit` | unit (pures + composants React) | ~30s |
| `cd tests && npm run test:integ` | docker stack + endpoints | ~6min |
| `cd tests && npm run test:e2e` | Playwright sur UI live | ~5min |
| `cd tests && npm test` | unit + integ | ~7min |
| `cd tests && npm run test:all` | tout y compris e2e | ~12min |

Pré-requis local : Rancher Desktop running. CI : `.github/workflows/test.yml`.

## Couverture

### Pure logic units
| Test | Fichier | Couvre |
|---|---|---|
| CSV serializer | `unit/csv-serializer.test.mjs` | `escapeCsvCell`, `toCsv` |
| Entropy math | `unit/entropy-math.test.mjs` | `density`, `modularityRatio`, `entropyForSnapshot` |
| Bus factor | `unit/ownership-bus-factor.test.mjs` | `busFactor`, `topAuthors` |
| Dissonance overlap | `unit/dissonance-overlap.test.mjs` | `clusterPurity`, `misplacedFiles` |

### Components React (unit)
| Test | Fichier | Couvre |
|---|---|---|
| EntropyBadge | `unit/components/EntropyBadge.test.tsx` | Auto-hide <2 points + density display |
| OwnershipPanel | `unit/components/OwnershipPanel.test.tsx` | Render + slider filter + click |
| CouplingPanel | `unit/components/CouplingPanel.test.tsx` | Render + default sort |
| GrowthChart | `unit/components/GrowthChart.test.tsx` | SVG + legend |
| LifespanPanel | `unit/components/LifespanPanel.test.tsx` | Non-empty buckets only |
| DissonancePanel | `unit/components/DissonancePanel.test.tsx` | Global score + misplaced list |
| DiffBanner | `unit/components/DiffBanner.test.tsx` | Counts + repo names |
| Timeline | `unit/components/Timeline.test.tsx` | Slider + play advances |
| SnapshotsPanel | `unit/components/SnapshotsPanel.test.tsx` | List + delete |
| BulkSnapshotModal | `unit/components/BulkSnapshotModal.test.tsx` | Inputs + confirm |

### Stack health
| Test | Fichier | Couvre |
|---|---|---|
| Health + routes | `integration/stack-health.test.mjs` | `/health`, présence des 16 routes |

### Endpoints integration
| Test | Fichier | Couvre |
|---|---|---|
| Snapshots | `integration/endpoints/snapshot.test.mjs` | `POST /snapshot`, `GET /snapshots` |
| Snapshots bulk | `integration/endpoints/snapshot-bulk.test.mjs` | `POST /snapshot/bulk` + status |
| Diff | `integration/endpoints/diff.test.mjs` | `GET /api/graph?diff=A,B` |
| Churn | `integration/endpoints/churn.test.mjs` | `/churn` schema + golden |
| Coupling | `integration/endpoints/coupling.test.mjs` | `/coupling` schema + golden |
| Coupling cross | `integration/endpoints/coupling-cross.test.mjs` | `/coupling/cross?repos=` |
| Growth | `integration/endpoints/growth.test.mjs` | `/growth` schema + golden |
| Growth cross | `integration/endpoints/growth-cross.test.mjs` | `/growth/cross?repos=` |
| Lifespan | `integration/endpoints/lifespan.test.mjs` | `/lifespan` buckets + golden |
| Entropy | `integration/endpoints/entropy.test.mjs` | `/entropy` schema + range + golden |
| Ownership | `integration/endpoints/ownership.test.mjs` | `/ownership` bus factor + golden |
| Dissonance | `integration/endpoints/dissonance.test.mjs` | `/dissonance` schema + range + golden |
| Semantic labels | `integration/endpoints/semantic-labels.test.mjs` | `/semantic-labels` GET + POST |
| CSV format universel | `integration/endpoints/csv-format.test.mjs` | `?format=csv` sur 7 routes |
| Export / Import | `integration/endpoints/export-import.test.mjs` | `/export` bundle + indexOnly |

### UI flows e2e
| Test | Fichier | Couvre |
|---|---|---|
| Home + repo list | `e2e/specs/01-analyze-and-snapshot.spec.ts` | Home loads, lists sample-repo |
| Timeline navigation | `e2e/specs/02-timeline-navigation.spec.ts` | Slider + play/pause |
| Panels render | `e2e/specs/03-analytics-panels.spec.ts` | 5 panels open, render content |
| CSV download | `e2e/specs/04-csv-download.spec.ts` | Download icon → .csv file |
| Diff view | `e2e/specs/05-diff-view.spec.ts` | Diff banner appears |

## Tests désactivés / connus fragiles

| Test | Statut | Pourquoi |
|---|---|---|
| (aucun pour l'instant) | | |

## Comment ajouter un test

1. Identifier la famille (unit / integration endpoint / e2e).
2. Copier un test existant de la même famille comme template.
3. Ajouter une ligne dans le bon tableau ci-dessus.
4. Lancer la suite localement, vérifier vert.
5. Push, vérifier que GH Actions passe.
6. Le check `inventory-check` du workflow fait échouer toute PR qui crée un test sans l'inscrire ici.
```

- [ ] **Step 2: Commit**

```bash
git add tests/README.md
git commit -m "test: inventory file listing all 39 tests across the 3 tiers"
```

---

### Task 47: Inventory orphan-check script

**Files:**
- Create: `scripts/check-test-inventory.mjs`

- [ ] **Step 1: Create the check**

```js
#!/usr/bin/env node
/**
 * Fails if any *.test.{mjs,ts,tsx} under tests/ does not appear in
 * tests/README.md. Run in CI as a sanity guard.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TESTS = join(ROOT, 'tests');
const README = readFileSync(join(TESTS, 'README.md'), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.test\.(mjs|ts|tsx)$/.test(name)) out.push(relative(TESTS, full).replaceAll('\\', '/'));
  }
  return out;
}

const tests = walk(TESTS);
const orphans = tests.filter(t => !README.includes(t));

if (orphans.length > 0) {
  console.error('Test files missing from tests/README.md:');
  for (const o of orphans) console.error(`  - ${o}`);
  process.exit(1);
}

console.log(`OK — ${tests.length} test files all listed in tests/README.md`);
```

- [ ] **Step 2: Run it locally**

Run: `node scripts/check-test-inventory.mjs`
Expected: prints `OK — N test files all listed`.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-test-inventory.mjs
git commit -m "test: add inventory orphan-check (used by CI)"
```

---

### Task 48: ci-apply-patches Node script

**Files:**
- Create: `scripts/apply-upstream-patches.mjs`

- [ ] **Step 1: Create the script**

```js
#!/usr/bin/env node
/**
 * Clone upstream gitnexus at $GITNEXUS_VERSION (default v1.6.3) and apply
 * patches/upstream-all.diff. Used both locally (one-time setup) and in CI.
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const UPSTREAM = join(ROOT, 'upstream');
const TAG = process.env.GITNEXUS_VERSION || 'v1.6.3';

function sh(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

if (existsSync(UPSTREAM)) {
  console.log(`removing existing ${UPSTREAM}…`);
  rmSync(UPSTREAM, { recursive: true, force: true });
}

sh(`git clone --depth 50 --branch ${TAG} https://github.com/abhigyanpatwari/gitnexus.git upstream`);
sh(`git apply --3way --whitespace=fix patches/upstream-all.diff`, { cwd: UPSTREAM });

console.log(`\nupstream/ ready at ${TAG} with patches applied.`);
```

- [ ] **Step 2: Test locally**

> **Caution:** This will wipe and re-clone `upstream/`. Only run if you don't have uncommitted work in `upstream/`.

Run: `node scripts/apply-upstream-patches.mjs`
Expected: clone proceeds, patch applies cleanly (some "Falling back to direct application" lines are fine if 3-way blob lookup fails).

- [ ] **Step 3: Commit**

```bash
git add scripts/apply-upstream-patches.mjs
git commit -m "test: add cross-platform script to clone+patch upstream"
```

---

### Task 49: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: tests

on:
  push:
    branches: [deployment]
  workflow_dispatch:

env:
  GITNEXUS_VERSION: ${{ vars.GITNEXUS_VERSION || 'v1.6.3' }}

jobs:
  inventory-check:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - name: Verify test inventory
        run: node scripts/check-test-inventory.mjs

  unit:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm', cache-dependency-path: 'tests/package-lock.json' }
      - run: cd tests && npm ci
      - name: Apply upstream patches (for components paths)
        run: node scripts/apply-upstream-patches.mjs
      - run: cd tests && npm run test:unit -- --reporter=verbose

  integration:
    runs-on: ubuntu-latest
    continue-on-error: true
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm', cache-dependency-path: 'tests/package-lock.json' }
      - run: cd tests && npm ci
      - name: Apply upstream patches
        run: node scripts/apply-upstream-patches.mjs
      - name: Pre-pull upstream image
        run: docker pull ghcr.io/abhigyanpatwari/gitnexus:${{ env.GITNEXUS_VERSION }}
      - name: Build derived images
        run: docker compose -f docker-compose.test.yml build
      - name: Run integration tests
        run: cd tests && npm run test:integ -- --reporter=verbose
      - name: Dump logs on failure
        if: failure()
        run: docker compose -f docker-compose.test.yml logs --no-color > docker-logs.txt
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: docker-logs
          path: docker-logs.txt
      - name: Teardown stack
        if: always()
        run: docker compose -f docker-compose.test.yml down -v

  e2e:
    runs-on: ubuntu-latest
    needs: integration
    continue-on-error: true
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm', cache-dependency-path: 'tests/package-lock.json' }
      - run: cd tests && npm ci
      - name: Install Playwright chromium
        run: cd tests && npx playwright install --with-deps chromium
      - name: Apply upstream patches
        run: node scripts/apply-upstream-patches.mjs
      - name: Build derived images
        run: docker compose -f docker-compose.test.yml build
      - name: Bring stack up
        run: docker compose -f docker-compose.test.yml up -d
      - name: Wait for stack
        run: cd tests && node integration/helpers/wait-ready.mjs
      - name: Run e2e
        run: cd tests && npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: tests/playwright-report
      - if: always()
        run: docker compose -f docker-compose.test.yml down -v
```

- [ ] **Step 2: Validate YAML syntax**

Run: `npx --yes js-yaml .github/workflows/test.yml`
Expected: prints the parsed JSON, no error.

- [ ] **Step 3: Commit + push to trigger**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add tests workflow (inventory + unit + integ + e2e, non-blocking)"
git push origin deployment
```

- [ ] **Step 4: Open GitHub Actions tab and verify the run**

Visit: `https://github.com/RoJLD/GitNexus/actions`
Expected: a "tests" run appears, 4 jobs visible. They may be green or yellow (`continue-on-error` makes yellow on failure). They MUST NOT be entirely red (red = workflow itself broken, e.g., YAML syntax).

---

### Task 50: README badge + final smoke

**Files:**
- Modify: `README.md` (add badge near the top)

- [ ] **Step 1: Read current README**

Run: `Get-Content README.md | Select-Object -First 10`
Expected: see line 1-3 for context.

- [ ] **Step 2: Add the badge after the title**

Insert this block at line 2 of `README.md`:

```markdown
[![tests](https://github.com/RoJLD/GitNexus/actions/workflows/test.yml/badge.svg?branch=deployment)](https://github.com/RoJLD/GitNexus/actions/workflows/test.yml)
```

- [ ] **Step 3: Final local smoke**

Run: `cd tests && npm run test:smoke`
Expected: 2 tests passed in ~30s.

Run: `cd tests && npm test`
Expected: all unit + integ tests green.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add tests CI badge to README"
git push origin deployment
```

---

## Final validation

- [ ] All tests pass locally: `cd tests && npm run test:all` exits 0.
- [ ] CI badge displays on the GitHub repo home page.
- [ ] `tests/README.md` references every `.test.*` file present in `tests/`.
- [ ] `node scripts/check-test-inventory.mjs` returns OK.
- [ ] `patches/upstream-all.diff` has been regenerated after the small upstream edits (cores extracted, data-testid added).
- [ ] No uncommitted changes : `git status` is clean.

Phase 1 terminée. Le filet est posé sur `v1.6.3`. Phase 2 (bump v1.6.5) à
faire dans une session dédiée, en suivant le séquencement de la section 5 du
spec — chaque conflit résolu sera maintenant vérifiable contre le baseline
vert qu'on vient d'établir.

---

## Self-review (writer-side)

**1. Spec coverage:** Vérifié contre `2026-05-26-cicd-test-pyramid-design.md` :
- §3.1 layout : tasks 1, 4, 5, 6-9, 24-39, 40-45, 46-47, 49 couvrent tout
- §3.2 commandes : Task 1 step 1 (`package.json` scripts)
- §4.1 fixture : Tasks 4-5
- §4.2 helpers : Tasks 6-9
- §4.3 pattern endpoint : Tasks 27-39
- §4.4 unit components : Tasks 14-23
- §4.5 e2e : Tasks 40-45
- §4.6 inventaire : Tasks 46-47
- §4.7 CI workflow : Task 49 (+ badge en Task 50)
- §5 séquencement Phase 1 : ordre des tâches respecte la dépendance bootstrap → fixture → helpers → tests → CI

**2. Placeholder scan:** Aucun TBD/TODO. Quelques "labels may vary, adjust if needed" sur les e2e — explicitement signalés comme variabilité réelle du DOM upstream, pas comme placeholder paresseux.

**3. Type consistency:** Méthodes ApiClient utilisées de façon cohérente (`api.snapshot…`, `api.entropy`, `api.churn`). Le nom `bulkSnapshotStatus` est utilisé partout (pas `getBulkStatus` ailleurs). Les helpers `analyzeFixture`/`snapshotFixtureFullHistory` sont importés tels quels dans tous les tests integration.

**4. Risques identifiés en cours d'écriture:**
- Le `globalSetup` ne ré-extrait pas le fixture si déjà fait — bon, mais fragile si `extractedFixtureDir` survit. Mitigation : `stopStack` nettoie.
- Les tests cross-repo (29, 31, 39) supposent que `coupling-cross.test.mjs` tourne avant. Vitest ne garantit pas l'ordre des fichiers. Mitigation : chaque test cross peut ré-enregistrer le 2ème repo idempotamment, ou on utilise un `beforeAll` partagé (suite-level). Note pour l'engineer : si flakey, déplacer le register du 2ème repo dans `global-setup.mjs`.
- Le patch upstream est régénéré 5-6 fois pendant Phase 1 (cores extracted + testids added). À chaque fois c'est un commit séparé pour traçabilité.

Plan complete and saved to `docs/superpowers/plans/2026-05-26-cicd-test-pyramid-phase1.md`.
