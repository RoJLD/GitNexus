#!/usr/bin/env node
/**
 * Fails if any *.test.{mjs,ts,tsx} under tests/ does not appear in
 * tests/README.md. Run in CI as a sanity guard.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TESTS = join(ROOT, 'tests');
const README = readFileSync(join(TESTS, 'README.md'), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.test\.(mjs|ts|tsx)$/.test(name)) out.push(relative(TESTS, full).replaceAll('\\', '/'));
  }
  return out;
}

const tests = walk(TESTS);
const orphans = tests.filter(t => !README.includes(t));

if (orphans.length > 0) {
  console.error('Test files missing from tests/README.md:');
  for (const o of orphans) console.error(`  - ${o}`);
  process.exit(1);
}

console.log(`OK — ${tests.length} test files all listed in tests/README.md`);
