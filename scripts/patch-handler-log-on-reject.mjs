#!/usr/bin/env node
/**
 * SIGIL-HANDLER-LOG-ON-REJECT — surgical patch script
 *
 * Applies Σ-HANDLER-LOG-ON-REJECT (niveau 1 + niveau 2 POC) to GitNexus upstream :
 *   - docker-server-routes.mjs : dispatch-level fall-through log avec whitelist
 *   - docker-server-ghosts.mjs : per-handler reject log (cardinal case du V3 misdiagnosis)
 *
 * Idempotent : detecte le marker "Σ-HANDLER-LOG-ON-REJECT" et skip si déjà appliqué.
 * Run order : à appliquer APRES patch-lbug-staleness.mjs et patch-incremental-dump.mjs
 *             (les autres patches sovereign GitNexus).
 *
 * Pattern identique à scripts/patch-lbug-staleness.mjs et patch-incremental-dump.mjs :
 * fail loud si les ancres source ont changé upstream (force review humain).
 *
 * Cf docs/governance/sigils/SIGIL-HANDLER-LOG-ON-REJECT.md (doctrine complète).
 * Cas révélateur : V3 GitNexus misdiagnosis 2026-05-31 — curl GET sur route POST-only
 * → silent fall-through SPA HTML 200 → 2h diagnostic.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Build-time override : GITNEXUS_APP_ROOT pointe vers /app dans le container Kaniko
// (Dockerfile RUN GITNEXUS_APP_ROOT=/app node ./patch-X.mjs). Dev local : reste sur ../upstream.
const UPSTREAM_ROOT = process.env.GITNEXUS_APP_ROOT || resolve(__dirname, '../upstream');

const MARKER = 'Σ-HANDLER-LOG-ON-REJECT';

const ROUTES_FILE = resolve(UPSTREAM_ROOT, 'docker-server-routes.mjs');
const GHOSTS_FILE = resolve(UPSTREAM_ROOT, 'docker-server-ghosts.mjs');

const ROUTES_WHITELIST_HELPER = `
// ${MARKER} (SIGIL 2026-05-31) — whitelist des paths attendus en
// fall-through (assets statiques + index SPA). Tout autre fall-through est loggé
// au niveau warn pour distinguer method-mismatch / unknown-route / silent-handler-
// crash. Cas révélateur : V3 image misdiagnosis 2026-05-31 — curl GET sur
// /ghosts/sync (POST-only) → silent fall-through SPA HTML 200 → 2h diagnostic
// perdues. Cf docs/governance/sigils/SIGIL-HANDLER-LOG-ON-REJECT.md.
function isExpectedStaticFallthrough(reqUrl) {
  const path = reqUrl.pathname;
  if (path.startsWith('/assets/')) return true;
  if (path === '/' || path === '/index.html') return true;
  if (path === '/favicon.ico' || path === '/robots.txt') return true;
  return /\\.(js|css|map|svg|png|jpg|jpeg|woff|woff2|ico|html|webp|gif)$/i.test(path);
}

`;

const ROUTES_LOG_BLOCK = `
  // ${MARKER} — log fall-through API-shaped avant SPA catch-all.
  // Évite le bug-classe "silent route absence" qui rend les misdiagnosis comme
  // V3 GitNexus (2h diagnostic pour curl GET sur route POST-only).
  if (!isExpectedStaticFallthrough(reqUrl)) {
    console.warn(
      \`[routes] no handler matched: \${req.method} \${reqUrl.pathname}\${reqUrl.search || ''} — falling through to SPA static (likely method-mismatch, content-type-mismatch, auth-fail, or unknown route)\`,
    );
  }
`;

const GHOSTS_LOG_BLOCK = `  // ${MARKER} niveau 2 (SIGIL 2026-05-31) — log domain-scope reject
  // si le path est dans le domaine /ghosts/* mais method/sub-path ne matche pas.
  // Distingue 'mauvaise méthode sur ma route' de 'route appartient à autre handler'.
  // Cas révélateur direct : curl GET /ghosts/sync → silent return false avant ce fix.
  if (url.pathname.startsWith('/ghosts')) {
    console.warn(
      \`[ghosts] method-mismatch or unknown sub-path: \${req.method} \${url.pathname} \` +
        \`(expected: POST /ghosts/sync | GET /ghosts | GET /ghosts/at)\`,
    );
  }
`;

async function patchRoutes() {
  const content = await readFile(ROUTES_FILE, 'utf8');
  if (content.includes(MARKER)) {
    console.log(`[${MARKER}] docker-server-routes.mjs : already patched, skip`);
    return false;
  }

  // Ancre 1 : insérer le helper isExpectedStaticFallthrough() avant
  // 'export async function registerGitnexusRoutes'
  const anchor1 = '// Returns true once a handler claims (responds to) the request; false if no route matched.';
  if (!content.includes(anchor1)) {
    throw new Error(
      `[${MARKER}] anchor1 missing in docker-server-routes.mjs — upstream drift, review needed`,
    );
  }

  // Ancre 2 : insérer le log block avant 'return false;' à la fin de registerGitnexusRoutes
  // On cherche le dernier 'return true;' juste avant 'return false;' et on insère après.
  const anchor2 = `  if (await handleGroupGraphRoute(req, reqUrl, res)) return true;\n  return false;\n}`;
  if (!content.includes(anchor2)) {
    throw new Error(
      `[${MARKER}] anchor2 missing in docker-server-routes.mjs — upstream drift, review needed`,
    );
  }

  let patched = content.replace(anchor1, ROUTES_WHITELIST_HELPER.trim() + '\n\n' + anchor1);
  patched = patched.replace(
    anchor2,
    `  if (await handleGroupGraphRoute(req, reqUrl, res)) return true;\n${ROUTES_LOG_BLOCK}  return false;\n}`,
  );

  await writeFile(ROUTES_FILE, patched, 'utf8');
  console.log(`[${MARKER}] docker-server-routes.mjs : niveau 1 patched OK`);
  return true;
}

async function patchGhosts() {
  const content = await readFile(GHOSTS_FILE, 'utf8');
  if (content.includes(MARKER)) {
    console.log(`[${MARKER}] docker-server-ghosts.mjs : already patched, skip`);
    return false;
  }

  // Ancre : trouver le `return false;\n}` à la fin de handleGhostsRoute (dernière fonction du fichier)
  const anchor = `  if (url.pathname === '/ghosts/at' && req.method === 'GET') {
    await handleGhostsAt(url, res, opts);
    return true;
  }
  return false;
}`;

  if (!content.includes(anchor)) {
    throw new Error(
      `[${MARKER}] anchor missing in docker-server-ghosts.mjs — upstream drift, review needed`,
    );
  }

  const replacement = `  if (url.pathname === '/ghosts/at' && req.method === 'GET') {
    await handleGhostsAt(url, res, opts);
    return true;
  }
${GHOSTS_LOG_BLOCK}  return false;
}`;

  const patched = content.replace(anchor, replacement);
  await writeFile(GHOSTS_FILE, patched, 'utf8');
  console.log(`[${MARKER}] docker-server-ghosts.mjs : niveau 2 patched OK`);
  return true;
}

async function main() {
  if (!existsSync(ROUTES_FILE)) {
    console.error(`[${MARKER}] missing file: ${ROUTES_FILE}`);
    console.error(`[CAUSE] upstream/ not cloned? Run patches/README.md apply steps first.`);
    process.exit(2);
  }
  if (!existsSync(GHOSTS_FILE)) {
    console.error(`[${MARKER}] missing file: ${GHOSTS_FILE}`);
    process.exit(2);
  }

  const r = await patchRoutes();
  const g = await patchGhosts();

  console.log('');
  console.log(`[${MARKER}] summary: routes=${r ? 'patched' : 'noop'} ghosts=${g ? 'patched' : 'noop'}`);
  console.log(`[${MARKER}] SIGIL doc: docs/governance/sigils/SIGIL-HANDLER-LOG-ON-REJECT.md`);
  console.log(`[${MARKER}] Phase B backlog: 35 remaining handlers (mecanique copy-paste pattern niveau 2)`);
}

main().catch((e) => {
  console.error(`[${MARKER}] FAIL: ${e.message}`);
  process.exit(1);
});
