import { describe, it, expect } from 'vitest';
import { upsertManagedSection } from '../../scripts/ghost-from-spec-roadmap.mjs';

const ghost = {
  id: 'spec-2026-05-26-foo',
  title: 'Foo feature',
  tier: '2.3',
  expectedLinks: [
    { kind: 'path', value: 'services/foo.ts' },
    { kind: 'path', value: 'FooPanel.tsx' },
  ],
  description: '',
  status: 'planned',
};

describe('upsertManagedSection', () => {
  it('appends a new section when no markers exist', () => {
    const input = '# Roadmap\n\nbody\n';
    const out = upsertManagedSection(input, ghost, 'docs/superpowers/specs/2026-05-26-foo-design.md');
    expect(out).toContain('## 🧪 From spec brainstorms');
    expect(out).toContain('<!-- specs:start -->');
    expect(out).toContain('<!-- specs:end -->');
    expect(out).toContain('| [2026-05-26-foo-design]');
    expect(out).toContain('Foo feature');
    expect(out).toContain('`services/foo.ts`');
  });

  it('upserts in place when the section already exists', () => {
    const input = [
      '# R', '',
      '## 🧪 From spec brainstorms', '',
      '<!-- specs:start -->',
      '| Spec | Tier | Title | Endpoint(s) / Composant(s) |',
      '|---|---|---|---|',
      '| [2026-05-26-foo-design](path) | 2.3 | OLD TITLE | `old.ts` |',
      '<!-- specs:end -->',
    ].join('\n');
    const out = upsertManagedSection(input, ghost, 'docs/superpowers/specs/2026-05-26-foo-design.md');
    expect(out).not.toContain('OLD TITLE');
    expect(out).not.toContain('`old.ts`');
    expect(out).toContain('Foo feature');
    expect(out).toContain('`services/foo.ts`');
    // Should still contain the markers exactly once
    expect(out.match(/<!-- specs:start -->/g)).toHaveLength(1);
  });

  it('appends a new row when id is new', () => {
    const input = [
      '# R', '',
      '## 🧪 From spec brainstorms', '',
      '<!-- specs:start -->',
      '| Spec | Tier | Title | Endpoint(s) / Composant(s) |',
      '|---|---|---|---|',
      '| [other](path) | 1.1 | Other | `other.ts` |',
      '<!-- specs:end -->',
    ].join('\n');
    const out = upsertManagedSection(input, ghost, 'docs/superpowers/specs/2026-05-26-foo-design.md');
    expect(out).toContain('Other');
    expect(out).toContain('Foo feature');
  });

  it('is idempotent on identical re-runs', () => {
    let buf = '# R\n';
    buf = upsertManagedSection(buf, ghost, 'docs/superpowers/specs/2026-05-26-foo-design.md');
    const once = buf;
    buf = upsertManagedSection(buf, ghost, 'docs/superpowers/specs/2026-05-26-foo-design.md');
    expect(buf).toBe(once);
  });
});
