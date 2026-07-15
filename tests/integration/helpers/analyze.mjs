import { getApi } from './api-client.mjs';

const FIXTURE_NAME = 'sample-repo';
const FIXTURE_PATH = `/data/projects/${FIXTURE_NAME}`;

// 300s default: on a cold stack (fresh `down -v` + `up --build`, HF + tree-sitter
// caches empty) the fixture analyze plus the per-commit snapshot analyses run
// well past the old 180s ceiling, which surfaced as a spurious global-setup
// timeout. Warm, the same work finishes in a few seconds.
async function pollUntilDone(checker, { timeoutMs = 300_000, intervalMs = 1000 } = {}) {
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
  // Real contract (proven by the e2e global-setup): POST /api/analyze
  // { path, force, embeddings } → { jobId }, then poll GET /api/analyze/{jobId}
  // for a done/complete/ready status. The old code posted { skipEmbeddings }
  // (a key the endpoint ignores) and polled listRepos() for r.status==='ready'
  // — a field /api/repos never returns, so the poll could only time out.
  const { jobId } = await api.analyze(FIXTURE_PATH, {
    embeddings: withEmbeddings,
    force: true,
  });
  await pollUntilDone(async () => {
    const s = await api.analyzeStatus(jobId);
    const status = String(s.status || s.state || '');
    // Surface the worker's REAL diagnostic. GET /api/analyze/:id returns
    // { status, error } where `error` carries the actual cause (e.g. "Worker
    // crashed 3 times (code …)" or "FTS verification failed …"). The old code
    // returned `status` ('failed') and threw "Job failed: failed" — masking the
    // real error (Zero-Masking violation) and making every cold-start failure
    // opaque. Fall back to status only when no diagnostic is present.
    if (/error|fail/i.test(status)) return { error: s.error || s.message || status };
    return { done: /complete|ready|done/i.test(status) };
  });
  return FIXTURE_NAME;
}

export async function snapshotFixtureAtCommit(sha) {
  const api = getApi();
  return api.createSnapshot(FIXTURE_NAME, sha);
}

export async function snapshotFixtureFullHistory({ count = 5, sinceDays = 600, minSnapshots = 3 } = {}) {
  const api = getApi();
  // Mirror the proven e2e global-setup: POST /snapshot/bulk?repo= { count,
  // sinceDays }, then poll /snapshots until >= minSnapshots exist. The old code
  // used windowDays:30 (the fixture commits are dated 2025, so a 30-day window
  // finds ZERO commits → no snapshots) AND polled a JSON `state` on
  // GET /snapshot/bulk/:jobId (an SSE stream, never JSON) — two independent
  // reasons it could never succeed.
  await api.bulkSnapshot(FIXTURE_NAME, { count, sinceDays });
  await pollUntilDone(async () => {
    const l = await api.listSnapshots(FIXTURE_NAME);
    const n = Array.isArray(l.snapshots) ? l.snapshots.length : 0;
    return { done: n >= minSnapshots };
  });
  return api.listSnapshots(FIXTURE_NAME);
}

export const FIXTURE = { name: FIXTURE_NAME, path: FIXTURE_PATH };
