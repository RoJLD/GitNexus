#!/usr/bin/env node
/**
 * Reconstruit tests/fixtures/sample-repo.tar.gz from scratch with a
 * deterministic git history (fixed timestamps, fixed authors).
 *
 * Usage: node tests/fixtures/make-fixture.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '_build', 'sample-repo');
const TARBALL = join(HERE, 'sample-repo.tar.gz');
const ALICE = 'Alice Test <alice@test.local>';
const BOB = 'Bob Test <bob@test.local>';

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO, stdio: 'pipe', ...opts }).toString();
}

function commit({ author, date, message, files }) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(REPO, path);
    mkdirSync(dirname(full), { recursive: true });
    if (content === null) {
      sh(`git rm -f "${path}"`);
    } else {
      writeFileSync(full, content);
      sh(`git add "${path}"`);
    }
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: author.split(' <')[0],
    GIT_AUTHOR_EMAIL: author.split(' <')[1].slice(0, -1),
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: author.split(' <')[0],
    GIT_COMMITTER_EMAIL: author.split(' <')[1].slice(0, -1),
    GIT_COMMITTER_DATE: date,
  };
  execSync(`git commit -m "${message}"`, { cwd: REPO, env, stdio: 'pipe' });
}

console.log('Resetting fixture build directory…');
rmSync(REPO, { recursive: true, force: true });
mkdirSync(REPO, { recursive: true });
sh('git init -q -b main');
sh('git config commit.gpgsign false');

console.log('Committing fixture history…');

// Commit 1 (alice, 2025-01-01) — initial scaffold
commit({
  author: ALICE,
  date: '2025-01-01T10:00:00 +0100',
  message: 'feat: scaffold project',
  files: {
    'README.md': '# Sample\n',
    'src/utils/helpers.ts': 'export const id = <T>(x: T): T => x;\n',
    'src/auth/login.ts': 'export function login() { return false; }\n',
    'src/db/schema.ts': 'export const schema = { tables: [] };\n',
    'gitnexus-domains.json': JSON.stringify(
      { domains: { auth: ['src/auth/**'], data: ['src/db/**'] } },
      null,
      2,
    ),
  },
});

// Commits 2-6 (alice) — login.ts heavy churn
const loginVersions = [
  'export function login(u: string) { return u === "alice"; }\n',
  'export function login(u: string, p: string) { return u === "alice" && p.length > 3; }\n',
  'export function login(u: string, p: string) { return u === "alice" && p.length > 5; }\n',
  'import { id } from "../utils/helpers";\nexport function login(u: string, p: string) { return id(u === "alice" && p.length > 5); }\n',
  'import { id } from "../utils/helpers";\nexport function login(u: string, p: string, mfa?: string) { return id(u === "alice" && p.length > 5 && !!mfa); }\n',
];
for (let i = 0; i < 5; i++) {
  commit({
    author: ALICE,
    date: `2025-01-0${2 + i}T10:00:00 +0100`,
    message: `feat(auth): iterate login signature #${i + 1}`,
    files: { 'src/auth/login.ts': loginVersions[i] },
  });
}

// Commit 7 (bob, 2025-01-10) — schema.ts edits
commit({
  author: BOB,
  date: '2025-01-10T14:00:00 +0100',
  message: 'feat(db): add users table',
  files: {
    'src/db/schema.ts': 'export const schema = { tables: ["users"] };\n',
    'src/auth/legacy.js': 'module.exports = { ssoLogin: () => false };\n',
  },
});

// Commit 8 (alice, 2025-01-15) — schema.ts again
commit({
  author: ALICE,
  date: '2025-01-15T09:30:00 +0100',
  message: 'feat(db): add sessions table',
  files: { 'src/db/schema.ts': 'export const schema = { tables: ["users", "sessions"] };\n' },
});

// Commit 9 (alice, 2025-01-22) — drop legacy.js
commit({
  author: ALICE,
  date: '2025-01-22T16:00:00 +0100',
  message: 'refactor(auth): drop legacy sso path',
  files: {
    'src/auth/legacy.js': null,
    'src/db/schema.ts': 'export const schema = { tables: ["users", "sessions", "audit"] };\n',
  },
});

// Commit 10 (bob, 2025-01-30) — orphan recent file + schema final
commit({
  author: BOB,
  date: '2025-01-30T11:00:00 +0100',
  message: 'feat(db): wire migration runner',
  files: {
    'src/db/orphan.py': '# placeholder for migration runner\nprint("noop")\n',
    'src/db/schema.ts': 'export const schema = { tables: ["users", "sessions", "audit"], version: 4 };\n',
  },
});

// Commit 11 (alice, 2025-02-05) — adds a minimal ROADMAP.md for ghosts CORE tests
commit({
  author: ALICE,
  date: '2025-02-05T10:00:00 +0100',
  message: 'docs(roadmap): add minimal ROADMAP for ghost-predictive tests',
  files: {
    'ROADMAP.md': [
      '# Sample Project — Roadmap',
      '',
      '## ✅ Déjà livré',
      '',
      '| # | Feature | Endpoint(s) / Composant(s) |',
      '|---|---|---|',
      '| 1 | **Login flow** | `src/auth/login.ts` |',
      '| 2 | **DB schema** | `src/db/schema.ts` |',
      '',
      '## 🎯 Tier 1',
      '',
      '### 1.1 — Migration runner ✅',
      '**Promesse** : runner pour appliquer les migrations.',
      '',
      '**Premier pas** : `src/db/orphan.py` placeholder.',
      '',
      '### 1.2 — Helpers utility',
      '**Promesse** : fonctions partagées.',
      '',
      '**Premier pas** : `src/utils/helpers.ts` exports an `id` function.',
      '',
      '### 2.1 — Audit log 🗑️',
      "**Promesse** : journal d'audit.",
      '',
      '**Premier pas** : cancelled, not implementing.',
      '',
    ].join('\n'),
  },
});

// Commit 12 (alice, 2025-02-12) — Audit-specific fixture changes:
//   - flip ### 1.2 to ⏳ (planned, still pending) + add **Expected by** line
//     so Audit can compute slippage / expired metrics.
//   - add ### 2.2 — Cancelled feature 🗑️ to give the cancellation-rate
//     metric a second data point beyond 2.1.
// Section 1.1 is left ✅ on purpose so we still have a "materialized"
// ghost in the audit dataset.
commit({
  author: ALICE,
  date: '2025-02-12T10:00:00 +0100',
  message: 'docs(roadmap): flip 1.2 to planned + expectedBy + add cancelled 2.2',
  files: {
    'ROADMAP.md': [
      '# Sample Project — Roadmap',
      '',
      '## ✅ Déjà livré',
      '',
      '| # | Feature | Endpoint(s) / Composant(s) |',
      '|---|---|---|',
      '| 1 | **Login flow** | `src/auth/login.ts` |',
      '| 2 | **DB schema** | `src/db/schema.ts` |',
      '',
      '## 🎯 Tier 1',
      '',
      '### 1.1 — Migration runner ✅',
      '**Promesse** : runner pour appliquer les migrations.',
      '',
      '**Premier pas** : `src/db/orphan.py` placeholder.',
      '',
      '### 1.2 — Helpers utility ⏳',
      '**Expected by** : 2026-Q2',
      '',
      '**Promesse** : fonctions partagées.',
      '',
      '**Premier pas** : `src/utils/helpers.ts` exports an `id` function.',
      '',
      '### 2.1 — Audit log 🗑️',
      "**Promesse** : journal d'audit.",
      '',
      '**Premier pas** : cancelled, not implementing.',
      '',
      '### 2.2 — Cancelled feature 🗑️',
      '**Promesse** : another feature we never shipped.',
      '',
      '**Premier pas** : cancelled, kept here to exercise audit cancellation-rate.',
      '',
    ].join('\n'),
  },
});

// Normalise the git repo so tar output is byte-identical across regens.
// 1. gc packs loose objects and removes non-deterministic loose-object files.
// 2. read-tree HEAD rewrites .git/index clearing per-file stat cache
//    (timestamps that git stores for fast-status checks).
sh('git gc --quiet --prune=all');
sh('git read-tree HEAD');

// Build academic-corpus alongside sample-repo (non-breaking: separate dir,
// sample-repo untouched). academic-corpus/ is NOT a git repo and is not
// analyzed — it simply provides papers.json for the academic-literature
// integ test at /data/projects/academic-corpus/papers.json.
const buildParent = join(REPO, '..');          // …/tests/fixtures/_build
const academicDir = join(buildParent, 'academic-corpus');
console.log('Building academic-corpus fixture…');
mkdirSync(academicDir, { recursive: true });
writeFileSync(
  join(academicDir, 'papers.json'),
  JSON.stringify(
    { papers: [
      { id: 'kyle1985', title: 'Continuous Auctions and Insider Trading', year: 1985,
        path: 'kyle.pdf', authors: ['Albert S. Kyle'], topics: ['market microstructure'] },
      { id: 'fama1970', title: 'Efficient Capital Markets', year: 1970,
        path: 'fama.pdf', authors: ['Eugene F. Fama'], topics: ['market efficiency'] },
      { id: 'famafrench1993', title: 'Common Risk Factors', year: 1993,
        path: 'ff.pdf', authors: ['Eugene F. Fama', 'Kenneth R. French'], topics: ['market efficiency'] },
    ] },
    null, 0,
  ) + '\n',
);

console.log('Packing tarball…');
// Windows tar.exe (GNU tar on Git for Windows) does not accept
// drive-letter paths (e.g. C:\...) in -f or -C arguments.
// Work around: cd into _build (parent of sample-repo) and write
// the tarball with a relative path so no drive letter appears.
const tarRelOut   = '../sample-repo.tar.gz';  // Fix B: POSIX literal — avoids Windows backslash
execSync(
  `tar -czf "${tarRelOut}" --sort=name --mtime='2025-01-30T11:00:00Z' --owner=0 --group=0 --numeric-owner sample-repo academic-corpus`,
  { cwd: buildParent, stdio: 'inherit' },
);
console.log(`Wrote ${TARBALL}`);
