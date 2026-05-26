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
