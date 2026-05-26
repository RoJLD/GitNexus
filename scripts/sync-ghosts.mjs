#!/usr/bin/env node
/**
 * CLI : invokes POST /ghosts/sync on the local gitnexus server.
 * Equivalent to `curl -X POST :4173/ghosts/sync?repo=<basename>`,
 * but with a clearer success/error message.
 *
 * Usage   : node scripts/sync-ghosts.mjs <repo-basename>
 * Example : node scripts/sync-ghosts.mjs gitnexus
 *
 * Assumes the gitnexus stack is running (docker compose up).
 */
const repo = process.argv[2];
if (!repo) {
  console.error('Usage   : node scripts/sync-ghosts.mjs <repo-basename>');
  console.error('Example : node scripts/sync-ghosts.mjs gitnexus');
  process.exit(2);
}

const port = process.env.GITNEXUS_PORT || 4173;
const url = `http://localhost:${port}/ghosts/sync?repo=${encodeURIComponent(repo)}`;

try {
  const res = await fetch(url, { method: 'POST' });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Sync failed (HTTP ${res.status}) :`, body.error || body);
    process.exit(1);
  }
  console.log(`Synced ${body.ghosts?.length ?? 0} ghosts at commit ${body.syncedCommit?.slice(0, 8) ?? '?'}`);
  console.log(`Wrote  : <repo>/roadmap.yml + <repo>/.gitnexus/ghosts.json`);
  console.log(`Reminder : commit roadmap.yml to version the change.`);
} catch (err) {
  console.error('Failed to reach gitnexus server :', err.message);
  console.error(`Is the stack up at http://localhost:${port} ?`);
  process.exit(1);
}
