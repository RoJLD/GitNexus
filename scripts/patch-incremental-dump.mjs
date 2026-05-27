#!/usr/bin/env node
/**
 * Patch /app/gitnexus/dist/core/run-analyze.js to dump the incremental
 * subgraph + hashDiff to `<repoPath>/.gitnexus/_last-incremental-subgraph.json`
 * just before LBugDB write-back.
 *
 * --- Why this patch exists ---
 *
 * gitnexus has full incremental machinery (file-hash diffing, importer BFS,
 * subgraph extraction) but doesn't expose the in-memory subgraph to outside
 * callers — it's serialised straight to LBugDB. Phase C of the incremental-
 * snapshots design (see docs/superpowers/specs/2026-05-26-incremental-
 * snapshots-phase-c-design.md) needs that subgraph to persist per-commit
 * diffs for graph-at-commit reconstruction.
 *
 * --- What the patch does ---
 *
 * Injects ~25 lines right after the `const subgraph = extractChangedSubgraph(...)`
 * call. The injected block writes a JSON file with:
 *   - the full subgraph (nodes + relationships)
 *   - hashDiff (changed, added, deleted, toWrite paths)
 *   - effectiveWriteSet
 *   - timestamps + repoPath for caller correlation
 *
 * --- Always-on ---
 *
 * Unlike the spike script (which was env-var-gated), the production patch
 * dumps unconditionally to `<repoPath>/.gitnexus/_last-incremental-
 * subgraph.json`. This is:
 *   - safe (file lives inside .gitnexus/, already gitignored)
 *   - cheap (~1-3 MB write per analyze, negligible vs the analyze itself)
 *   - simple (no env var coordination between gitnexus + gitnexus-web)
 *   - ephemeral (overwritten on each pass; consumers must read post-analyze)
 *
 * The /snapshot/incremental endpoint reads this file right after triggering
 * an analyze via /api/analyze.
 *
 * --- Same self-validation as patch-lbug-staleness.mjs ---
 *
 * Looks for an exact marker line. If upstream's run-analyze.js changes shape,
 * the build fails loudly here — we'd rather know than ship a silent regression.
 */

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const TARGET = '/app/gitnexus/dist/core/run-analyze.js';

// Marker we look for to inject right after. Stable across recent upstream
// versions; verified on v1.6.5. If upstream rewrites the incremental
// pipeline, this script will fail loudly at image build time.
const MARKER =
  `const subgraph = extractChangedSubgraph(pipelineResult.graph, effectiveWriteSet);`;

// Patch block. Always-on, no env gating.
const PATCH = `
            // INCREMENTAL-DUMP: dump subgraph + hashDiff for Phase C
            //                   incremental-snapshots reconstruction.
            //                   Installed by scripts/patch-incremental-dump.mjs.
            try {
                const _fs = await import('node:fs/promises');
                const _path = await import('node:path');
                const _outDir = _path.join(pipelineResult.repoPath, '.gitnexus');
                const _outPath = _path.join(_outDir, '_last-incremental-subgraph.json');
                await _fs.mkdir(_outDir, { recursive: true });
                await _fs.writeFile(_outPath, JSON.stringify({
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
                    nodes: subgraph.nodes || [],
                    relationships: subgraph.relationships || [],
                }, null, 0));
                progress('lbug', 64, 'Incremental subgraph dumped to ' + _outPath);
            } catch (_e) {
                // Non-fatal — analyze must succeed even if our dump fails.
                progress('lbug', 64, 'Incremental subgraph dump failed (non-fatal): ' + (_e && _e.message ? _e.message : _e));
            }
            // /INCREMENTAL-DUMP`;

const PATCH_MARKER_INLINE = 'INCREMENTAL-DUMP: dump subgraph + hashDiff';

const src = await readFile(TARGET, 'utf8');

if (src.includes(PATCH_MARKER_INLINE)) {
  console.log('[patch-incremental-dump] already patched, no-op.');
  process.exit(0);
}

if (!src.includes(MARKER)) {
  console.error(
    '[patch-incremental-dump] marker not found in ' + TARGET + '.\n' +
    '  Expected: ' + MARKER + '\n' +
    '  Upstream gitnexus changed the incremental pipeline shape — review\n' +
    '  scripts/patch-incremental-dump.mjs against the new run-analyze.js.',
  );
  process.exit(2);
}

const idx = src.indexOf(MARKER) + MARKER.length;
const out = src.slice(0, idx) + PATCH + src.slice(idx);
await writeFile(TARGET, out, 'utf8');
console.log(
  '[patch-incremental-dump] patched ' + TARGET + ' (+' + PATCH.length + ' chars). ' +
  'Subgraph dumps will now land at <repoPath>/.gitnexus/_last-incremental-subgraph.json.',
);
