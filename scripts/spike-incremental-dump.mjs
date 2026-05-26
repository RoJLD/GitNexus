#!/usr/bin/env node
/**
 * Spike v2 — patch gitnexus' compiled run-analyze.js to dump the
 * incremental `subgraph` to disk before it's written to LBugDB.
 *
 * This is a SPIKE script: it modifies a file in the running container's
 * /app/gitnexus/dist tree, runs an analyze, captures the dump, and
 * reverts. Output: tells us whether the in-memory subgraph contains
 * what we need for Phase C diff persistence (nodes + relationships)
 * and what's missing (notably tracking of REMOVED nodes since they're
 * deleted from DB before the subgraph write).
 *
 * Usage (host side):
 *   1. docker cp scripts/spike-incremental-dump.mjs gitnexus:/tmp/spike.mjs
 *   2. docker exec gitnexus node /tmp/spike.mjs patch
 *   3. docker exec gitnexus sh -c 'GITNEXUS_INCREMENTAL_DUMP_DIR=/tmp/dumps GITNEXUS_INCREMENTAL_DUMP_NAME=run1 gitnexus analyze /data/projects/Tools/hmm_studio-spike-c1 --name hmm-spike'
 *   4. docker exec gitnexus cat /tmp/dumps/run1.json | head -200
 *   5. docker exec gitnexus node /tmp/spike.mjs revert
 *
 * The patch and revert are idempotent (verify shape before any write).
 */

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const TARGET = '/app/gitnexus/dist/core/run-analyze.js';

// Marker we look for to inject right after. The line is stable enough
// across upstream versions to anchor on.
const MARKER = `const subgraph = extractChangedSubgraph(pipelineResult.graph, effectiveWriteSet);`;

// Patch block. Env-var-gated so it's a no-op unless we ask.
// Uses dynamic import for fs/path to stay ESM-compatible.
const PATCH = `
            // SPIKE-PATCH: dump incremental subgraph for Phase C investigation.
            process.stderr.write('[SPIKE] reached injection point. env DUMP_DIR=' + (process.env.GITNEXUS_INCREMENTAL_DUMP_DIR || 'unset') + ' DUMP_NAME=' + (process.env.GITNEXUS_INCREMENTAL_DUMP_NAME || 'unset') + '\\n');
            try {
                if (process.env.GITNEXUS_INCREMENTAL_DUMP_DIR && process.env.GITNEXUS_INCREMENTAL_DUMP_NAME) {
                    const _fs = await import('node:fs/promises');
                    const _path = await import('node:path');
                    const _outDir = process.env.GITNEXUS_INCREMENTAL_DUMP_DIR;
                    const _outName = process.env.GITNEXUS_INCREMENTAL_DUMP_NAME;
                    await _fs.mkdir(_outDir, { recursive: true });
                    const _payload = {
                        ts: new Date().toISOString(),
                        repoPath: pipelineResult.repoPath,
                        hashDiff: {
                            changed: Array.from(hashDiff.changed || []),
                            added: Array.from(hashDiff.added || []),
                            deleted: Array.from(hashDiff.deleted || []),
                            toWrite: Array.from(hashDiff.toWrite || []),
                        },
                        writableFiles: Array.from(writableFiles || []),
                        effectiveWriteSet: Array.from(effectiveWriteSet || []),
                        nodesCount: subgraph.nodes ? subgraph.nodes.length : 0,
                        relationshipsCount: subgraph.relationships ? subgraph.relationships.length : 0,
                        nodes: subgraph.nodes || [],
                        relationships: subgraph.relationships || [],
                    };
                    await _fs.writeFile(_path.join(_outDir, _outName + '.json'), JSON.stringify(_payload, null, 0));
                    progress('lbug', 64, 'SPIKE: dumped subgraph to ' + _path.join(_outDir, _outName + '.json'));
                }
            } catch (_e) {
                progress('lbug', 64, 'SPIKE: subgraph dump failed (non-fatal): ' + (_e && _e.message ? _e.message : _e));
            }
            // /SPIKE-PATCH`;

const PATCH_MARKER_INLINE = 'SPIKE-PATCH: dump incremental subgraph';

async function patch() {
  const src = await readFile(TARGET, 'utf8');
  if (src.includes(PATCH_MARKER_INLINE)) {
    console.log('[spike] already patched, skipping.');
    return;
  }
  if (!src.includes(MARKER)) {
    console.error('[spike] marker not found in ' + TARGET + ' — upstream shape changed?');
    process.exit(2);
  }
  // Insert the patch RIGHT AFTER the marker line.
  const idx = src.indexOf(MARKER) + MARKER.length;
  const out = src.slice(0, idx) + PATCH + src.slice(idx);
  await writeFile(TARGET, out, 'utf8');
  console.log('[spike] patched ' + TARGET + ' — inserted ' + PATCH.length + ' chars after the marker.');
}

async function revert() {
  const src = await readFile(TARGET, 'utf8');
  if (!src.includes(PATCH_MARKER_INLINE)) {
    console.log('[spike] not patched, nothing to revert.');
    return;
  }
  // Find the patch block by its markers.
  const startMarker = '\n            // SPIKE-PATCH:';
  const endMarker = '\n            // /SPIKE-PATCH';
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    console.error('[spike] patch markers found but range invalid — manual cleanup needed.');
    process.exit(3);
  }
  const out = src.slice(0, startIdx) + src.slice(endIdx + endMarker.length);
  await writeFile(TARGET, out, 'utf8');
  console.log('[spike] reverted ' + TARGET + '.');
}

const action = process.argv[2];
if (action === 'patch') await patch();
else if (action === 'revert') await revert();
else {
  console.error('Usage: node spike-incremental-dump.mjs patch|revert');
  process.exit(1);
}
