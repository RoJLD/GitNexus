import { startStack, stopStack, dumpLogs } from './stack.mjs';
import { analyzeFixture, snapshotFixtureFullHistory } from './analyze.mjs';

export default async function setup() {
  // Fast-iteration escape hatch (mirrors the e2e tier's E2E_SKIP_SETUP): when a
  // stack is already up and warmed (analyzed fixture + snapshots + ghosts), skip
  // the whole lifecycle so a `vitest run <one-file>` iterates in seconds instead
  // of re-building the stack and re-analyzing on every run.
  if (process.env.INTEG_SKIP_SETUP) {
    console.log('[global-setup] INTEG_SKIP_SETUP set — reusing the already-prepared stack/repo.');
    return async () => {};
  }
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
