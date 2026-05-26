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
