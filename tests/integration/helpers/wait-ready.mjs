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
