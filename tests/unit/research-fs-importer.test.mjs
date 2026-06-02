import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importResearchFs } from '../../upstream/docker-server-research-fs-importer.mjs';

let dir;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'research-fs-'));
  await mkdir(join(dir, '01_exploration'), { recursive: true });
  await writeFile(join(dir, '01_exploration', 'hypo.md'),
    '---\ntype: hypothesis\nid: h1\ntitle: Mean reversion\nlinks:\n  - to: r1\n    kind: validates\n---\n# Mean reversion\nbody');
  await writeFile(join(dir, '01_exploration', 'result.md'),
    '---\ntype: result\nid: r1\n---\n# Result\n');
  await writeFile(join(dir, '01_exploration', 'nb.ipynb'),
    JSON.stringify({ metadata: { gitnexus: { type: 'experiment', id: 'e1', title: 'Exp 1' } }, cells: [] }));
  await mkdir(join(dir, '.ipynb_checkpoints'), { recursive: true });
  await writeFile(join(dir, '.ipynb_checkpoints', 'junk.md'), 'x');
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('importResearchFs', () => {
  it('builds nodes from files, honors frontmatter types, and resolves links', async () => {
    const g = await importResearchFs(dir, { include: ['**/*.ipynb', '**/*.md'], exclude: ['.ipynb_checkpoints'] });
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(byId.h1.type).toBe('hypothesis');
    expect(byId.h1.label).toBe('Mean reversion');
    expect(byId.r1.type).toBe('result');
    expect(byId.e1.type).toBe('experiment');
    expect(byId.h1.stage).toBe('01_exploration');
    const edge = g.edges.find((e) => e.source === 'h1' && e.target === 'r1');
    expect(edge.kind).toBe('validates');
    expect(g.nodes.some((n) => n.path.includes('.ipynb_checkpoints'))).toBe(false);
    expect(g.report.byType.hypothesis).toBe(1);
  });

  it('records unresolved links instead of throwing', async () => {
    const d2 = await mkdtemp(join(tmpdir(), 'research-fs2-'));
    await writeFile(join(d2, 'a.md'), '---\nid: a\nlinks:\n  - to: ghost\n    kind: derives_from\n---\n# A');
    const g = await importResearchFs(d2, { include: ['**/*.md'], exclude: [] });
    expect(g.edges).toHaveLength(0);
    expect(g.report.unresolvedLinks[0]).toMatchObject({ source: 'a', to: 'ghost', kind: 'derives_from' });
    await rm(d2, { recursive: true, force: true });
  });
});
