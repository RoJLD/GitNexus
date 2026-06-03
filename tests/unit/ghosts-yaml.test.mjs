import { describe, it, expect } from 'vitest';
import { renderRoadmapYml, parseRoadmap } from '../../upstream/docker-server-ghosts-core.mjs';

const sampleGhost = {
  id: 'tier-1-4-entropie-structurelle',
  tier: '1.4',
  title: 'Entropie structurelle',
  description: 'un seul chiffre — le Coefficient de Cohérence',
  status: 'materialized',
  expectedLinks: [
    { kind: 'path', value: '/entropy?repo=<base>' },
    { kind: 'label', value: 'EntropyBadge' },
  ],
  dependsOn: [],
};

describe('renderRoadmapYml', () => {
  it('produces YAML starting with `ghosts:`', () => {
    const out = renderRoadmapYml([sampleGhost]);
    expect(out.startsWith('ghosts:\n')).toBe(true);
  });

  it('is deterministic (same input → bit-identical output)', () => {
    const a = renderRoadmapYml([sampleGhost]);
    const b = renderRoadmapYml([sampleGhost]);
    expect(a).toBe(b);
  });

  it('escapes characters that would break YAML (backticks, apostrophes, colons)', () => {
    const ghost = { ...sampleGhost, description: "It's a key: a value with `backticks`" };
    const out = renderRoadmapYml([ghost]);
    expect(out).toContain("It''s a key");
    expect(out).toContain('backticks');
  });

  it('emits ghosts in stable order (by id)', () => {
    const a = { ...sampleGhost, id: 'a' };
    const b = { ...sampleGhost, id: 'b' };
    const c = { ...sampleGhost, id: 'c' };
    expect(renderRoadmapYml([c, a, b])).toBe(renderRoadmapYml([a, b, c]));
  });

  it('emits empty array as `ghosts: []`', () => {
    expect(renderRoadmapYml([]).trim()).toBe('ghosts: []');
  });

  it('emits expectedBy field for every ghost (null if absent)', () => {
    const out = renderRoadmapYml([sampleGhost]);
    expect(out).toContain('expectedBy: null');

    const withDate = { ...sampleGhost, expectedBy: '2026-Q3' };
    const out2 = renderRoadmapYml([withDate]);
    expect(out2).toContain("expectedBy: 2026-Q3");
  });

  it('renders clusters section when opts.clusters provided', () => {
    const cluster = {
      id: 'observability-cluster',
      source: 'declared',
      title: 'Observability cluster',
      expectedBy: '2026-Q3',
      memberIds: ['ghost-a', 'ghost-b'],
      declaredStatus: null,
    };
    const out = renderRoadmapYml([sampleGhost], { clusters: [cluster] });
    expect(out).toContain('\nclusters:\n');
    expect(out).toContain('  - id: observability-cluster');
    expect(out).toContain('    title: Observability cluster');
    expect(out).toContain('    expectedBy: 2026-Q3');
    expect(out).toContain('    members:');
    expect(out).toContain('      - ghost-a');
    expect(out).toContain('      - ghost-b');
    // declaredStatus null → no status line
    expect(out).not.toContain('    status: null');
  });

  it('omits clusters section when opts.clusters is empty or absent', () => {
    expect(renderRoadmapYml([sampleGhost])).not.toContain('clusters:');
    expect(renderRoadmapYml([sampleGhost], { clusters: [] })).not.toContain('clusters:');
  });

  it('emits clusters sorted by id (deterministic order)', () => {
    const c1 = { id: 'b-cluster', title: 'B', memberIds: ['x'] };
    const c2 = { id: 'a-cluster', title: 'A', memberIds: ['y'] };
    const out = renderRoadmapYml([], { clusters: [c1, c2] });
    expect(out.indexOf('a-cluster')).toBeLessThan(out.indexOf('b-cluster'));
  });

  it('emits declaredStatus when present', () => {
    const c = {
      id: 'shipped-cluster',
      title: 'Shipped',
      memberIds: ['a'],
      declaredStatus: 'shipped',
    };
    const out = renderRoadmapYml([], { clusters: [c] });
    expect(out).toContain('    status: shipped');
  });
});
