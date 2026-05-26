#!/usr/bin/env node
/**
 * Clone upstream gitnexus at $GITNEXUS_VERSION (default v1.6.3) and apply
 * patches/upstream-all.diff. Used both locally (one-time setup) and in CI.
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
const TAG = process.env.GITNEXUS_VERSION || 'v1.6.3';

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

sh(`git clone --depth 50 --branch ${TAG} https://github.com/abhigyanpatwari/gitnexus.git upstream`);
sh(`git apply --3way --whitespace=fix patches/upstream-all.diff`, { cwd: UPSTREAM });

console.log(`\nupstream/ ready at ${TAG} with patches applied.`);
