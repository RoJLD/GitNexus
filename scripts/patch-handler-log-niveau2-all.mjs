#!/usr/bin/env node
/**
 * SIGIL-HANDLER-LOG-ON-REJECT Phase B execution — mass apply niveau 2 to 35 handlers
 *
 * Pattern : pour chaque `export async function handle<X>Route(req, url, res[, opts])`
 * dans docker-server-*.mjs, insère avant le `return false;\n}` final un block log :
 *
 *   if (url.pathname.startsWith('<extracted-prefix>')) {
 *     console.warn(`[<handler-slug>] no sub-path/method match: ${req.method} ${url.pathname} (handler=<X>)`);
 *   }
 *
 * Le préfixe est extrait de la PREMIÈRE check `url.pathname === '/X/Y'` ou
 * `url.pathname.startsWith('/X')` rencontrée dans la fonction. Heuristique :
 *  - `/coupling/cross` → prefix `/coupling`
 *  - `/snapshot/promote` → prefix `/snapshot`
 *  - `/ghosts/sync` → prefix `/ghosts`
 *
 * Idempotent : skip si déjà MARKER présent dans le block près du return false.
 *
 * Pattern frère de patch-handler-log-on-reject.mjs (handleGhostsRoute déjà patché).
 *
 * Cf docs/governance/sigils/SIGIL-HANDLER-LOG-ON-REJECT.md Phase B execution.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Build-time override : GITNEXUS_APP_ROOT pointe vers /app dans le container Kaniko
const UPSTREAM_ROOT = process.env.GITNEXUS_APP_ROOT || resolve(__dirname, '../upstream');

const MARKER = 'Σ-HANDLER-LOG-ON-REJECT';

// Skip handleGhostsRoute (already patched by patch-handler-log-on-reject.mjs)
const SKIP_HANDLERS = new Set(['handleGhostsRoute']);

// Manual prefix overrides for handlers where heuristic fails or is ambiguous.
// Keyed by handler function name.
const PREFIX_OVERRIDES = {
  // Multi-prefix : on prend le préfixe commun le plus court
  handleSnapshotRoute: '/snapshot',
  handleSnapshotBulkRoute: '/snapshot',
  handleSnapshotAutoRoute: '/snapshot',
  handleSnapshotFromPrRoute: '/snapshot',
  handleSnapshotIncrementalRoute: '/snapshot',
  handleGraphAtCommitRoute: '/graph',
  handleBaselineSeedRoute: '/snapshot',
  handlePrewarmRoute: '/snapshot',
  handleGroupGraphRoute: '/graph',
  handleGhostAuditRoute: '/ghost-audit',
  handleGhostsCleanupRoute: '/ghosts',
  handleClustersRoute: '/clusters',
  handleSysmlExportRoute: '/sysml-export',
  // Phase B+2 (2026-06-01) — gate-pattern handlers : prefix garanti pour
  // débloquer patchHandler() qui détecte la gate-pattern via regex et split.
  // Sans override, heuristique extractPrefixFromBody peut rater (cause inconnue
  // sur nodes-alive-between malgré présence du `!==` regex).
  handleAutoReindexRoute: '/auto-reindex',
  handleRegressionRoute: '/regression',
  handleNodesAliveBetweenRoute: '/nodes',
  // handleGroupGraphRoute deja overrided ci-dessus (/graph)
};

function extractHandlerName(funcLine) {
  const m = funcLine.match(/function\s+(handle\w+Route)\s*\(/);
  return m ? m[1] : null;
}

function extractPrefixFromBody(body, handlerName) {
  if (PREFIX_OVERRIDES[handlerName]) return PREFIX_OVERRIDES[handlerName];

  // Pattern 1 : `url.pathname === '/foo/bar'` (positive match)
  // Pattern 2 : `url.pathname.startsWith('/foo')`
  // Pattern 3 : `url.pathname !== '/foo'` (negative early-return Pattern A)
  // Pattern 4 : `path === '/foo'` (variant where url.pathname was aliased)
  const candidates = [];
  const eqMatches = body.matchAll(/url\.pathname\s*===\s*['"]([^'"]+)['"]/g);
  for (const m of eqMatches) candidates.push(m[1]);
  const startsWithMatches = body.matchAll(/url\.pathname\.startsWith\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const m of startsWithMatches) candidates.push(m[1]);
  const neqMatches = body.matchAll(/url\.pathname\s*!==\s*['"]([^'"]+)['"]/g);
  for (const m of neqMatches) candidates.push(m[1]);
  const pathEqMatches = body.matchAll(/\bpath\s*===\s*['"]([^'"]+)['"]/g);
  for (const m of pathEqMatches) candidates.push(m[1]);
  const pathStartsMatches = body.matchAll(/\bpath\.startsWith\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const m of pathStartsMatches) candidates.push(m[1]);

  if (candidates.length === 0) return null;

  // Trouve le préfixe commun le plus court (~ premier segment significatif).
  // E.g. ['/coupling/cross', '/coupling/cross/foo'] → '/coupling'
  // E.g. ['/ghosts/sync', '/ghosts', '/ghosts/at'] → '/ghosts'
  // Heuristique simple : on prend le premier segment "/X" de la première candidate.
  const first = candidates[0];
  const firstSeg = first.match(/^(\/[a-z][a-z0-9-]*)/i);
  return firstSeg ? firstSeg[1] : first;
}

function slugify(handlerName) {
  // handleSnapshotIncrementalRoute → snapshot-incremental
  // handleGhostAuditRoute → ghost-audit
  return handlerName
    .replace(/^handle/, '')
    .replace(/Route$/, '')
    .replace(/([A-Z])/g, (m, c, i) => (i === 0 ? c.toLowerCase() : '-' + c.toLowerCase()));
}

function findHandlerEnd(content, handlerStart) {
  // À partir de la ligne `export async function handleXRoute(...) {`,
  // trouve le `\n}` qui ferme cette fonction (balance des accolades).
  // FIX Phase B+2 2026-06-01 : skip d'abord la signature `(...)` pour éviter
  // que le brace-counter ne démarre sur un default param `{}` (ex: opts = {}).
  let depth = 0;
  let i = handlerStart;
  // Skip jusqu'à la `(` de la signature
  while (i < content.length && content[i] !== '(') i++;
  if (i >= content.length) return -1;
  // Skip jusqu'à la `)` de fermeture de la signature (paren balance)
  let parenDepth = 1;
  i++;
  while (i < content.length && parenDepth > 0) {
    const c = content[i];
    if (c === '(') parenDepth++;
    else if (c === ')') parenDepth--;
    // Skip strings (les params peuvent contenir des chaînes par default)
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') i++;
        i++;
      }
    }
    i++;
  }
  if (parenDepth !== 0) return -1;
  // Maintenant skip jusqu'à la première `{` (body opening)
  while (i < content.length && content[i] !== '{') i++;
  if (i >= content.length) return -1;
  depth = 1;
  i++;
  while (i < content.length && depth > 0) {
    const c = content[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    // Skip strings & comments roughly to avoid false-positive braces
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') i++;
        i++;
      }
    }
    if (c === '/' && content[i + 1] === '/') {
      while (i < content.length && content[i] !== '\n') i++;
    }
    if (c === '/' && content[i + 1] === '*') {
      i += 2;
      while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) i++;
      i++;
    }
    i++;
  }
  return depth === 0 ? i - 1 : -1; // index du `}` final
}

function generateLogBlock(handlerName, prefix) {
  const slug = slugify(handlerName);
  return `  // ${MARKER} niveau 2 (Phase B 2026-06-01) — log domain-scope reject
  // si path est dans le domaine ${prefix} mais method/sub-path ne matche pas.
  if (url.pathname.startsWith('${prefix}')) {
    console.warn(\`[${slug}] no sub-path/method match: \${req.method} \${url.pathname} (handler=${handlerName})\`);
  }
`;
}

// Σ-HANDLER-LOG-ON-REJECT Phase B+2 (2026-06-01) — gate-pattern detection.
// Détecte les handlers à pattern :
//   if (url.pathname !== '/X' || req.method !== 'METHOD') return false;
// (au début de la fonction, sans return false; à la fin).
// Transforme en :
//   if (url.pathname !== '/X') return false;
//   if (req.method !== 'METHOD') {
//     console.warn(`[X-slug] method-mismatch: ${req.method} ${url.pathname} (expected METHOD)`);
//     return false;
//   }
//
// Aussi détecte la variante multi-ligne avec block braces :
//   if (url.pathname !== '/X' || req.method !== 'METHOD') {
//     return false;
//   }
function tryPatchGatePattern(handlerBody, handlerName) {
  // Pattern 1 : single-line `if (url.pathname !== '/X' || req.method !== 'M') return false;`
  // Pattern 2 : multi-line block
  const singleLine = /if\s*\(\s*url\.pathname\s*!==\s*['"]([^'"]+)['"]\s*\|\|\s*req\.method\s*!==\s*['"](\w+)['"]\s*\)\s*return\s+false\s*;/;
  const multiLine = /if\s*\(\s*url\.pathname\s*!==\s*['"]([^'"]+)['"]\s*\|\|\s*req\.method\s*!==\s*['"](\w+)['"]\s*\)\s*\{\s*\n?\s*return\s+false\s*;\s*\n?\s*\}/;

  let match = handlerBody.match(singleLine);
  let isMultiLine = false;
  if (!match) {
    match = handlerBody.match(multiLine);
    isMultiLine = !!match;
  }
  if (!match) return null;

  const path = match[1];
  const method = match[2];
  const slug = slugify(handlerName);
  const original = match[0];
  const replacement =
    `if (url.pathname !== '${path}') return false;\n` +
    `  // ${MARKER} niveau 2 gate-pattern (Phase B+2 2026-06-01)\n` +
    `  if (req.method !== '${method}') {\n` +
    `    console.warn(\`[${slug}] method-mismatch: \${req.method} \${url.pathname} (expected ${method})\`);\n` +
    `    return false;\n` +
    `  }`;

  return { original, replacement, path, method, isMultiLine };
}

async function patchHandler(filePath, content, handlerName, prefix) {
  // Find the function declaration
  const sigPattern = new RegExp(`export\\s+(async\\s+)?function\\s+${handlerName}\\s*\\(`);
  const sigMatch = content.match(sigPattern);
  if (!sigMatch) return { status: 'skip', reason: 'signature not found' };

  const handlerStart = sigMatch.index;
  const handlerEnd = findHandlerEnd(content, handlerStart);
  if (handlerEnd === -1) return { status: 'fail', reason: 'unbalanced braces' };

  const handlerBody = content.slice(handlerStart, handlerEnd + 1);

  if (handlerBody.includes(MARKER)) {
    return { status: 'noop', reason: 'already patched' };
  }

  // Trouve le `return false;\n}` final (last occurrence within handler body)
  const lastReturnFalseRe = /(\s+)return\s+false\s*;\s*\n}/m;
  const trailingMatch = handlerBody.match(lastReturnFalseRe);

  if (!trailingMatch) {
    // Pas de return false; final → fallback gate-pattern detection (Phase B+2)
    const gate = tryPatchGatePattern(handlerBody, handlerName);
    if (gate) {
      const newHandlerBody = handlerBody.replace(gate.original, gate.replacement);
      const newContent = content.slice(0, handlerStart) + newHandlerBody + content.slice(handlerEnd + 1);
      return { status: 'patched', newContent, variant: 'gate-pattern', path: gate.path, method: gate.method };
    }
    return { status: 'skip', reason: 'no return false at end (variant pattern, no gate detected)' };
  }

  // Insert log block BEFORE the leading whitespace of `return false;`
  const insertPoint = handlerStart + trailingMatch.index;
  const logBlock = generateLogBlock(handlerName, prefix);
  const newContent = content.slice(0, insertPoint) + '\n' + logBlock + content.slice(insertPoint);

  return { status: 'patched', newContent };
}

async function main() {
  const files = (await readdir(UPSTREAM_ROOT)).filter(
    (f) => f.startsWith('docker-server-') && f.endsWith('.mjs') && f !== 'docker-server.mjs' && f !== 'docker-server-routes.mjs',
  );

  const results = { patched: [], noop: [], skip: [], fail: [] };

  for (const file of files) {
    const filePath = resolve(UPSTREAM_ROOT, file);
    let content = await readFile(filePath, 'utf8');
    let modified = false;

    // Find all `export async/sync function handleXRoute` in this file
    const handlerRegex = /export\s+(async\s+)?function\s+(handle\w+Route)\s*\(/g;
    const handlers = [];
    let m;
    while ((m = handlerRegex.exec(content)) !== null) {
      handlers.push(m[2]);
    }

    for (const handlerName of handlers) {
      if (SKIP_HANDLERS.has(handlerName)) {
        results.noop.push({ file, handler: handlerName, reason: 'skip set' });
        continue;
      }

      // Re-read content because previous patches may have shifted positions
      // (Actually, we work on `content` in memory and only write at the end)
      const sigPattern = new RegExp(`export\\s+(async\\s+)?function\\s+${handlerName}\\s*\\(`);
      const sigMatch = content.match(sigPattern);
      if (!sigMatch) {
        results.skip.push({ file, handler: handlerName, reason: 'sig vanished' });
        continue;
      }

      const handlerStart = sigMatch.index;
      const handlerEnd = findHandlerEnd(content, handlerStart);
      if (handlerEnd === -1) {
        results.fail.push({ file, handler: handlerName, reason: 'unbalanced braces' });
        continue;
      }

      const handlerBody = content.slice(handlerStart, handlerEnd + 1);
      const prefix = extractPrefixFromBody(handlerBody, handlerName);
      if (!prefix) {
        results.skip.push({ file, handler: handlerName, reason: 'no prefix extractable' });
        continue;
      }

      const result = await patchHandler(filePath, content, handlerName, prefix);
      if (result.status === 'patched') {
        content = result.newContent;
        modified = true;
        results.patched.push({ file, handler: handlerName, prefix });
      } else if (result.status === 'noop') {
        results.noop.push({ file, handler: handlerName, reason: result.reason });
      } else if (result.status === 'skip') {
        results.skip.push({ file, handler: handlerName, reason: result.reason });
      } else {
        results.fail.push({ file, handler: handlerName, reason: result.reason });
      }
    }

    if (modified) {
      await writeFile(filePath, content, 'utf8');
    }
  }

  console.log(`[${MARKER}] Phase B execution summary`);
  console.log(`  Patched : ${results.patched.length}`);
  for (const r of results.patched) console.log(`    + ${r.file} :: ${r.handler} (prefix=${r.prefix})`);
  console.log(`  Noop    : ${results.noop.length}`);
  for (const r of results.noop) console.log(`    = ${r.file} :: ${r.handler} (${r.reason})`);
  console.log(`  Skip    : ${results.skip.length}`);
  for (const r of results.skip) console.log(`    ~ ${r.file} :: ${r.handler} (${r.reason})`);
  console.log(`  Fail    : ${results.fail.length}`);
  for (const r of results.fail) console.log(`    ! ${r.file} :: ${r.handler} (${r.reason})`);

  if (results.fail.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(`[${MARKER}] FAIL: ${e.message}`);
  console.error(e.stack);
  process.exit(2);
});
