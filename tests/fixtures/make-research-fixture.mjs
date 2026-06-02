import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '_build', 'research-sample');
const TARBALL = join(HERE, 'research-sample.tar.gz');

rmSync(REPO, { recursive: true, force: true });
mkdirSync(join(REPO, '01_exploration'), { recursive: true });
const sh = (cmd) => execSync(cmd, { cwd: REPO, stdio: 'pipe' });
sh('git init -q -b main');

function write(path, content) {
  const full = join(REPO, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

write('01_exploration/hypo.md', '---\ntype: hypothesis\nid: h1\ntitle: Mean reversion\nlinks:\n  - to: r1\n    kind: validates\n---\n# Mean reversion\n');
write('01_exploration/result.md', '---\ntype: result\nid: r1\n---\n# Result\n');
write('01_exploration/nb.ipynb', JSON.stringify({ metadata: { gitnexus: { type: 'experiment', id: 'e1', title: 'Exp 1' } }, cells: [] }));

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Alice', GIT_AUTHOR_EMAIL: 'alice@research', GIT_AUTHOR_DATE: '2025-03-01T10:00:00 +0100',
  GIT_COMMITTER_NAME: 'Alice', GIT_COMMITTER_EMAIL: 'alice@research', GIT_COMMITTER_DATE: '2025-03-01T10:00:00 +0100',
};
execSync('git add -A', { cwd: REPO, env, stdio: 'pipe' });
execSync('git commit -m "research sample"', { cwd: REPO, env, stdio: 'pipe' });

sh('git gc --quiet --prune=all');
sh('git read-tree HEAD');

const buildParent = join(REPO, '..');
execSync(
  `tar -czf "../research-sample.tar.gz" --sort=name --mtime='2025-03-01T00:00:00Z' --owner=0 --group=0 --numeric-owner research-sample`,
  { cwd: buildParent, stdio: 'inherit' },
);
console.log(`Wrote ${TARBALL}`);
