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
    expect(out).toContain("It's a key");
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
});
