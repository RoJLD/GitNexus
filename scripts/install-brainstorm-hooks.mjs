#!/usr/bin/env node
/**
 * One-shot wizard : configures the brainstorm-hook in 3 ways
 * (Claude PostToolUse, git post-commit, GH Actions workflow).
 *
 * Usage: node scripts/install-brainstorm-hooks.mjs
 *
 * See docs/superpowers/specs/2026-05-26-roadmap-predictive-brainstorm-hook-design.md
 */
import { readFile, writeFile, mkdir, chmod, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const HOOK_DEF = {
  matcher: 'Write',
  filePattern: 'docs/superpowers/specs/*.md',
  command: 'node scripts/ghost-from-spec.mjs $CLAUDE_TOOL_FILE_PATH',
};

export const GIT_HOOK = `#!/bin/sh
# Auto-installed by scripts/install-brainstorm-hooks.mjs
git diff-tree --no-commit-id --name-only HEAD | grep -E '^docs/superpowers/specs/.*\\.md$' | while read spec; do
  node scripts/ghost-from-spec.mjs "$spec"
done
`;

export const GHA_WORKFLOW = `name: roadmap-sync
on:
  push:
    branches: [deployment]
    paths: ['docs/superpowers/specs/**']
jobs:
  sync-ghosts-from-specs:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 2 }
      - uses: actions/setup-node@v4
        with: { node-version: '22.11.0' }
      - name: Find newly-changed specs and update ROADMAP
        run: |
          for spec in $(git diff --name-only HEAD~1 HEAD | grep '^docs/superpowers/specs/'); do
            node scripts/ghost-from-spec.mjs "$spec"
          done
      - name: Commit ROADMAP changes back
        run: |
          if ! git diff --quiet ROADMAP.md; then
            git config user.email "roblastar@live.fr"
            git config user.name "Robin DENIS"
            git add ROADMAP.md
            git commit -m "chore(roadmap): sync ghosts from specs (auto)"
            git push
          fi
`;

export function mergeClaudeHook(settings) {
  const out = { ...(settings ?? {}) };
  out.hooks = { ...(out.hooks ?? {}) };
  const list = [...(out.hooks.PostToolUse ?? [])];
  const dup = list.some(
    (h) => h?.matcher === HOOK_DEF.matcher && h?.filePattern === HOOK_DEF.filePattern,
  );
  if (!dup) list.push(HOOK_DEF);
  out.hooks.PostToolUse = list;
  return out;
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOr(p, fallback) {
  if (!(await fileExists(p))) return fallback;
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
}

async function installClaudeHook() {
  const p = join(ROOT, '.claude', 'settings.local.json');
  const cur = await readJsonOr(p, {});
  const merged = mergeClaudeHook(cur);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(merged, null, 2) + '\n');
  console.log(`✓ Claude hook merged into ${p}`);
}

async function installGitHook() {
  const p = join(ROOT, '.git', 'hooks', 'post-commit');
  await writeFile(p, GIT_HOOK);
  await chmod(p, 0o755).catch(() => {}); // Windows ignores chmod
  console.log(`✓ Git post-commit hook installed at ${p}`);
}

async function installGhaWorkflow() {
  const p = join(ROOT, '.github', 'workflows', 'roadmap-sync.yml');
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, GHA_WORKFLOW);
  console.log(`✓ GHA workflow installed at ${p}`);
}

async function main() {
  console.log('Installing brainstorm-hook in 3 modes...');
  await installClaudeHook();
  await installGitHook();
  await installGhaWorkflow();
  console.log('\nDone. The hook is now active on this machine.');
  console.log('Test it : touch a spec under docs/superpowers/specs/ and commit.');
}

// Only run main if this is the entrypoint (cross-platform check)
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('install-brainstorm-hooks.mjs') ||
    process.argv[1] === fileURLToPath(import.meta.url));
if (isMain) main().catch((err) => { console.error(err); process.exit(1); });
