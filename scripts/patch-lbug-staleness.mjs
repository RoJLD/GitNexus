#!/usr/bin/env node
/**
 * Patch /app/gitnexus/dist/core/lbug/lbug-adapter.js to add a staleness
 * check to ensureLbugInitialized.
 *
 * --- Why this patch exists ---
 *
 * gitnexus 1.6.3's REST API caches the LadybugDB connection by path
 * (lbug-adapter.ts, ensureLbugInitialized). The analyze worker is a child
 * process that replaces the on-disk lbug file. The parent's cached
 * connection then keeps pointing at the *old* file — every subsequent
 * /api/graph / /api/query call returns stale data until the server is
 * restarted (or until a *different* repo is queried, which evicts the
 * cached handle).
 *
 * The MCP backend (mcp/local/local-backend.ts, ensureInitialized line 439)
 * already has the right behaviour: compare meta.json's `indexedAt` against
 * the value last seen, evict if it changed. The REST adapter just never
 * got the same treatment. This patch mirrors that logic into withLbugDb's
 * common path.
 *
 * --- What the patch does ---
 *
 * Replaces the body of `const ensureLbugInitialized = async (dbPath) => {…}`
 * with a version that:
 *   1. On a cache hit, reads `<dirname(dbPath)>/meta.json` and compares
 *      meta.indexedAt against the value remembered the last time we opened
 *      this connection.
 *   2. If they differ, closes the stale conn/db and re-runs `doInitLbug`.
 *   3. After every fresh init, records the current `indexedAt` so a later
 *      analyze pass can be detected.
 *
 * Failure modes are silent (meta.json missing/unparseable → assume the
 * connection is still valid) to avoid breaking pre-1.0 indexes that lack
 * the indexedAt field.
 *
 * --- Why a JS post-patch rather than building from source ---
 *
 * Our gitnexus image (Dockerfile.cli) layers two minimal fixes on top of
 * the upstream ghcr.io/abhigyanpatwari/gitnexus:1.6.3 image. Building
 * gitnexus itself from source would multiply the build time and the
 * maintenance surface (we'd own the entire build pipeline, not just our
 * patches). This script is a 30-line surgical edit instead.
 *
 * Idempotent: detects the patched marker and exits 0 without re-applying.
 * If the upstream `ensureLbugInitialized` shape changes in a future
 * gitnexus release, the regex match will fail and the script will exit
 * non-zero so the image build surfaces the breakage.
 */

import { readFile, writeFile } from 'node:fs/promises';

const target = process.argv[2] || '/app/gitnexus/dist/core/lbug/lbug-adapter.js';
const marker = '/* PATCHED:lbug-staleness-check */';

const src = await readFile(target, 'utf8');

if (src.includes(marker)) {
  console.log(`[patch-lbug-staleness] already applied to ${target} — skipping`);
  process.exit(0);
}

// Match the exact original function. If gitnexus changes it, this fails
// loudly rather than silently producing a broken image.
const original = /const ensureLbugInitialized = async \(dbPath\) => \{\s*if \(conn && currentDbPath === dbPath\) \{\s*return \{ db, conn \};\s*\}\s*await doInitLbug\(dbPath\);\s*return \{ db, conn \};\s*\};/;

if (!original.test(src)) {
  console.error(
    `[patch-lbug-staleness] FATAL: could not locate the original ensureLbugInitialized ` +
      `in ${target}. The upstream shape changed — review the patch script before continuing.`,
  );
  process.exit(1);
}

const replacement = `${marker}
let __patchedLastSeenIndexedAt = null;
const ensureLbugInitialized = async (dbPath) => {
    if (conn && currentDbPath === dbPath) {
        // STALENESS CHECK (mirrors mcp/local/local-backend.ts:439): compare
        // meta.json's indexedAt against the value we recorded when this
        // connection was opened. If the analyze worker rebuilt the index,
        // close the stale handle so the next request opens a fresh one.
        try {
            const metaPath = path.join(path.dirname(dbPath), 'meta.json');
            const metaRaw = await fs.readFile(metaPath, 'utf-8');
            const meta = JSON.parse(metaRaw);
            if (meta.indexedAt && __patchedLastSeenIndexedAt && __patchedLastSeenIndexedAt !== meta.indexedAt) {
                try { if (conn) await conn.close(); } catch {}
                try { if (db) await db.close(); } catch {}
                conn = null;
                db = null;
                currentDbPath = null;
                ftsLoaded = false;
                vectorExtensionLoaded = false;
                ensuredFTSIndexes.clear();
                await doInitLbug(dbPath);
                __patchedLastSeenIndexedAt = meta.indexedAt;
            }
        } catch {
            // meta.json missing or unreadable — keep using the cached conn.
        }
        return { db, conn };
    }
    await doInitLbug(dbPath);
    try {
        const metaPath = path.join(path.dirname(dbPath), 'meta.json');
        const metaRaw = await fs.readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaRaw);
        __patchedLastSeenIndexedAt = meta.indexedAt || null;
    } catch {
        __patchedLastSeenIndexedAt = null;
    }
    return { db, conn };
};`;

const patched = src.replace(original, replacement);

if (patched === src) {
  console.error('[patch-lbug-staleness] FATAL: regex matched but replacement was a no-op.');
  process.exit(1);
}

await writeFile(target, patched, 'utf8');
console.log(`[patch-lbug-staleness] applied to ${target}`);
