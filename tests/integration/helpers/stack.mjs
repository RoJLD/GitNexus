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
  const tarSrc = join(HERE, '..', '..', 'fixtures', 'sample-repo.tar.gz');
  // On Windows, Git tar treats "C:" as a remote hostname; use --force-local and
  // forward-slash paths so that both GNU tar (Git) and bsdtar (System32) work.
  const sep = String.fromCharCode(92); // backslash — avoids escaping issues
  const toFwd = (p) => p.split(sep).join('/');
  execSync(`tar --force-local -xzf "${toFwd(tarSrc)}" -C "${toFwd(dir)}"`, { stdio: 'pipe' });
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
