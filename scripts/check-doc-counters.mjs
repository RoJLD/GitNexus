#!/usr/bin/env node
/**
 * check-doc-counters.mjs — single source of truth for the doc counters that
 * silently drift (MCP tool count, patch file counts). It counts from the CODE,
 * never trusts the prose, and keeps the docs honest between AUTOGEN markers.
 *
 * Why this exists: the sidecar grew 12 -> 13 -> 34 -> 36 tools while INVENTORY,
 * mcp-server/README and the smoke assertion all named different stale numbers.
 * A counter nobody regenerates is a Zero-Masking violation waiting to mislead.
 *
 *   node scripts/check-doc-counters.mjs            # --check (default): exit 1 on drift
 *   node scripts/check-doc-counters.mjs --write    # rewrite the counters in place
 *
 * Marker syntax in a doc:  <!-- COUNTER:mcp-tools -->36<!-- /COUNTER -->
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

function read(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}
function countMatches(text, re) {
  return text ? (text.match(re) || []).length : 0;
}

// --- sources of truth (the code / the committed diffs) ---
const server = read('mcp-server/server.mjs') || '';
// Each TOOLS[] entry is `    name: '...'` at 4-space indent inside the array.
const TOOL_COUNT = countMatches(server, /^ {4}name: '/gm);
const ADDITIVE_COUNT = countMatches(read('patches/additive-files.diff'), /^diff --git /gm);
const INPLACE_COUNT = countMatches(read('patches/inplace-edits.diff'), /^diff --git /gm);

const COUNTERS = {
  'mcp-tools': TOOL_COUNT,
  'additive-files': ADDITIVE_COUNT,
  'inplace-files': INPLACE_COUNT,
};

// Cross-check: the smoke asserts a hard-coded tool count — it MUST equal source.
const smoke = read('mcp-server/smoke.mjs') || '';
const smokeAssert = smoke.match(/tools\.length !== (\d+)/);
let crossDrift = 0;
if (smokeAssert && Number(smokeAssert[1]) !== TOOL_COUNT) {
  console.error(`DRIFT smoke.mjs: asserts ${smokeAssert[1]} tools but server.mjs defines ${TOOL_COUNT}`);
  crossDrift++;
}

// Files that opt in by carrying AUTOGEN markers.
const DOC_FILES = ['INVENTORY.md', 'CLAUDE.md', 'mcp-server/README.md', 'patches/README.md'];

let markerDrift = 0;
let anyMarker = false;
for (const rel of DOC_FILES) {
  const content = read(rel);
  if (content == null) continue;
  let updated = content;
  for (const [key, val] of Object.entries(COUNTERS)) {
    const re = new RegExp(`(<!-- COUNTER:${key} -->)(.*?)(<!-- /COUNTER -->)`, 'gs');
    updated = updated.replace(re, (_m, a, cur, b) => {
      anyMarker = true;
      if (cur.trim() !== String(val)) {
        if (!WRITE) { console.error(`DRIFT ${rel}: COUNTER:${key} = "${cur.trim()}" but source = ${val}`); markerDrift++; }
      }
      return `${a}${val}${b}`;
    });
  }
  if (WRITE && updated !== content) { writeFileSync(join(ROOT, rel), updated); console.log(`updated ${rel}`); }
}

if (WRITE) {
  console.log(`counters written: mcp-tools=${TOOL_COUNT}, additive-files=${ADDITIVE_COUNT}, inplace-files=${INPLACE_COUNT}`);
  process.exit(0);
}

console.log(`counters (from source): mcp-tools=${TOOL_COUNT}, additive-files=${ADDITIVE_COUNT}, inplace-files=${INPLACE_COUNT}`);
if (!anyMarker) console.warn('note: no AUTOGEN <!-- COUNTER:* --> markers found in the doc files.');
const total = markerDrift + crossDrift;
if (total) {
  console.error(`\n${total} counter(s) drifted — run: node scripts/check-doc-counters.mjs --write (and fix smoke.mjs by hand if flagged)`);
  process.exit(1);
}
console.log('all doc counters in sync ✓');
