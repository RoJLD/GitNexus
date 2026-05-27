/**
 * Brainstorm-hook end-to-end :
 *   1. Init a temp project with a minimal ROADMAP.md + a fake spec.
 *   2. Copy the 3 brainstorm-hook scripts in.
 *   3. Run `node ghost-from-spec.mjs <spec>` against the temp project.
 *   4. Assert ROADMAP.md gained the managed section + the row.
 *   5. Feed the updated ROADMAP.md to the CORE parser (the same path
 *      `/ghosts/sync` walks server-side) and assert a `planned` ghost
 *      with the right title is emitted.
 *
 * We deliberately do not start the docker stack here :
 * `tests/integration/endpoints/ghosts-sync.test.mjs` already covers the
 * HTTP wiring on the fixture repo. Doing the same thing twice + having
 * to dirty the fixture's ROADMAP would only buy us re-tested coverage.
 *
 * See docs/superpowers/specs/2026-05-26-roadmap-predictive-brainstorm-hook-design.md
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

describe('brainstorm-hook end-to-end', () => {
  it('script run → managed section in ROADMAP → CORE parser emits planned ghost', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bh-e2e-'));
    try {
      // 1. Init a fake project with a minimal ROADMAP and a spec
      mkdirSync(join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(
        join(dir, 'ROADMAP.md'),
        '# Roadmap\n\n## ✅ Déjà livré\n\n| # | Feature | Endpoint(s) / Composant(s) |\n|---|---|---|\n',
      );
      writeFileSync(
        join(dir, 'docs', 'superpowers', 'specs', '2026-05-26-foo-design.md'),
        '# Foo design\n\n## 2. Goal\n\nBuild Tier 2.3 foo.\n\n## 3. Design\n\nUses `services/foo.ts`.\n',
      );

      // 2. Copy the 3 brainstorm-hook scripts into the temp project so
      //    the CLI can resolve its sibling pure modules.
      const scriptsDir = join(REPO_ROOT, 'scripts');
      for (const f of [
        'ghost-from-spec.mjs',
        'ghost-from-spec-parser.mjs',
        'ghost-from-spec-roadmap.mjs',
      ]) {
        writeFileSync(join(dir, 'scripts', f), readFileSync(join(scriptsDir, f), 'utf8'));
      }

      // 3. Run the script — relative spec path resolves through findRoadmapMd
      execFileSync(
        process.execPath,
        [
          join(dir, 'scripts', 'ghost-from-spec.mjs'),
          join(dir, 'docs', 'superpowers', 'specs', '2026-05-26-foo-design.md'),
        ],
        { cwd: dir, stdio: 'pipe' },
      );

      // 4. ROADMAP.md now contains the managed section + the spec row
      const updated = readFileSync(join(dir, 'ROADMAP.md'), 'utf8');
      expect(updated).toContain('## 🧪 From spec brainstorms');
      expect(updated).toContain('<!-- specs:start -->');
      expect(updated).toContain('<!-- specs:end -->');
      expect(updated).toContain('2026-05-26-foo-design');
      expect(updated).toContain('services/foo.ts');

      // 5. CORE parser (the server-side path /ghosts/sync uses) picks
      //    up the new row as a planned ghost.
      const corePath = join(REPO_ROOT, 'upstream', 'docker-server-ghosts-core.mjs');
      const { parseRoadmap } = await import(`file://${corePath.replaceAll('\\', '/')}`);
      const ghosts = parseRoadmap(updated);
      const foo = ghosts.find(g => g.title === 'Foo');
      expect(foo).toBeDefined();
      expect(foo.status).toBe('planned');
      expect(foo.tier).toBe('2.3');
      expect(foo.expectedLinks.some(l => l.value === 'services/foo.ts' && l.kind === 'path')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent : running the script twice does not duplicate the row', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bh-e2e-idem-'));
    try {
      mkdirSync(join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(
        join(dir, 'ROADMAP.md'),
        '# Roadmap\n\n## ✅ Déjà livré\n\n| # | Feature | Endpoint(s) / Composant(s) |\n|---|---|---|\n',
      );
      writeFileSync(
        join(dir, 'docs', 'superpowers', 'specs', '2026-05-26-foo-design.md'),
        '# Foo design\n\n## 2. Goal\n\nBuild Tier 2.3 foo.\n\n## 3. Design\n\nUses `services/foo.ts`.\n',
      );

      const scriptsDir = join(REPO_ROOT, 'scripts');
      for (const f of [
        'ghost-from-spec.mjs',
        'ghost-from-spec-parser.mjs',
        'ghost-from-spec-roadmap.mjs',
      ]) {
        writeFileSync(join(dir, 'scripts', f), readFileSync(join(scriptsDir, f), 'utf8'));
      }

      const args = [
        join(dir, 'scripts', 'ghost-from-spec.mjs'),
        join(dir, 'docs', 'superpowers', 'specs', '2026-05-26-foo-design.md'),
      ];
      execFileSync(process.execPath, args, { cwd: dir, stdio: 'pipe' });
      const first = readFileSync(join(dir, 'ROADMAP.md'), 'utf8');
      execFileSync(process.execPath, args, { cwd: dir, stdio: 'pipe' });
      const second = readFileSync(join(dir, 'ROADMAP.md'), 'utf8');

      expect(first).toBe(second);
      // Only one row referencing the spec
      const rowOccurrences = (second.match(/2026-05-26-foo-design/g) || []).length;
      expect(rowOccurrences).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
