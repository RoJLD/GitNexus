/**
 * Playwright globalSetup for the e2e tier.
 *
 * WHY (measured 2026-07-12) : the CI `e2e` job brings the stack up but NEVER
 * analyzes/snapshots the fixture, so the app has no repo to connect to and every
 * spec would fail. This mirrors the integration global-setup's intent, but uses
 * the REAL, VERIFIED endpoints (`POST /api/analyze {path}`, `POST /snapshot/bulk`,
 * `POST /ghosts/sync`) — NOT tests/integration/helpers/analyze.mjs, whose
 * api-client posts to `/analyze` with `{repo}` (a 404 on gitnexus ≥1.6.x; the real
 * route is `/api/analyze` with `{path}`), which is likely why the docker CI tier
 * has never had a green baseline.
 *
 * Assumes the stack is already UP with the fixture mounted at /data/projects
 * (CI: `docker compose -f docker-compose.test.yml up` after the "Extract fixture"
 * step; the compose mount defaults to ./tests/fixtures/sample-repo-extracted).
 *
 * Local dev runs against an already-prepared stack: set E2E_SKIP_SETUP=1 to skip.
 */
const REPO = process.env.E2E_REPO || 'sample-repo';
const API = process.env.E2E_API_URL || `http://localhost:${process.env.TEST_PORT || 4747}`;
const WEB = process.env.E2E_WEB_URL || `http://localhost:${process.env.TEST_WEB_PORT || 4173}`;
const FIXTURE_PATH = `/data/projects/${REPO}`;

async function poll(check, { timeoutMs = 180_000, intervalMs = 2500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('e2e global-setup: poll timed out');
}

export default async function globalSetup() {
  if (process.env.E2E_SKIP_SETUP) {
    console.log('[e2e global-setup] E2E_SKIP_SETUP set — reusing the already-prepared stack/repo.');
    return;
  }
  // 1) Analyze the fixture (real endpoint + body).
  console.log(`[e2e global-setup] analyzing ${FIXTURE_PATH} …`);
  const res = await fetch(`${API}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: FIXTURE_PATH, force: true, embeddings: false }),
  });
  if (!res.ok) throw new Error(`analyze → ${res.status}: ${await res.text()}`);
  const { jobId } = await res.json();
  await poll(async () => {
    const s = await (await fetch(`${API}/api/analyze/${jobId}`)).json();
    const status = String(s.status || s.state || '');
    if (/error|fail/i.test(status)) throw new Error(`analyze job failed: ${status}`);
    return /complete|ready|done/i.test(status);
  });

  // 2) Bulk-snapshot so the Timeline (cursors + cursor-diff) has ≥ 2 snapshots.
  console.log('[e2e global-setup] bulk snapshot …');
  await fetch(`${WEB}/snapshot/bulk?repo=${encodeURIComponent(REPO)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ count: 8, sinceDays: 600 }),
  });
  await poll(async () => {
    const l = await (await fetch(`${WEB}/snapshots?repo=${encodeURIComponent(REPO)}`)).json();
    return (Array.isArray(l.snapshots) ? l.snapshots.length : 0) >= 3;
  });

  // 3) Ghost sync (best-effort) so the ghost-dependent specs have data.
  try {
    const g = await fetch(`${WEB}/ghosts/sync?repo=${encodeURIComponent(REPO)}`, { method: 'POST' });
    console.log(`[e2e global-setup] ghosts/sync → ${g.status}`);
  } catch (e) {
    console.log('[e2e global-setup] ghosts/sync skipped (non-fatal):', e.message);
  }
  console.log('[e2e global-setup] ready');
}
