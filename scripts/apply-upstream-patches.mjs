#!/usr/bin/env node
/**
 * Clone upstream gitnexus at $GITNEXUS_VERSION (default v1.6.5) and apply the
 * TWO canonical diffs: patches/additive-files.diff (new files we own, zero
 * conflict risk) then patches/inplace-edits.diff (edits to upstream files).
 * Used both locally (one-time setup) and in CI.
 *
 * History (2026-07-11): this script used to apply the legacy monolithic
 * patches/upstream-all.diff — frozen at 2026-06-11 and silently a MONTH stale
 * vs the canonical split diffs (drift-check only guards the split ones). CI
 * was therefore testing an old snapshot of our edits while builds stayed
 * green. The legacy file is deleted; the split diffs are the only truth.
 *
 * Safety: refuses to wipe an existing upstream/ unless FORCE_CLEAN_UPSTREAM=1.
 * Locally, upstream/ usually contains active edits — don't lose them.
 * CI runs from a fresh checkout so upstream/ doesn't exist there anyway.
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const UPSTREAM = join(ROOT, 'upstream');
const TAG = process.env.GITNEXUS_VERSION || 'v1.6.5';

function sh(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

if (existsSync(UPSTREAM)) {
  if (process.env.FORCE_CLEAN_UPSTREAM !== '1') {
    console.error(`upstream/ already exists at ${UPSTREAM}.`);
    console.error('Refusing to wipe it; you probably have local edits to preserve.');
    console.error('To override: FORCE_CLEAN_UPSTREAM=1 node scripts/apply-upstream-patches.mjs');
    process.exit(2);
  }
  console.log(`removing existing ${UPSTREAM}…`);
  rmSync(UPSTREAM, { recursive: true, force: true });
}

// Full history clone (no --depth) so `git apply --3way` has the blobs it
// needs to do a proper 3-way merge for the inevitable conflicts when bumping
// across upstream versions. Shallow clones force a fallback to direct apply,
// which fails noisily on every diverged file.
sh(`git clone --branch ${TAG} https://github.com/abhigyanpatwari/gitnexus.git upstream`);
// Additive first (new files, cannot conflict), then in-place (--3way needs
// the full-history clone above for its blobs). Same order as patches/README.md.
sh(`git apply --3way --whitespace=fix ../patches/additive-files.diff`, { cwd: UPSTREAM });
sh(`git apply --3way --whitespace=fix ../patches/inplace-edits.diff`, { cwd: UPSTREAM });

console.log(`\nupstream/ ready at ${TAG} with patches applied.`);
