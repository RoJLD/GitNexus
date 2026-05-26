import { describe, it, expect } from 'vitest';
import { matchExpectedLinks } from '../../upstream/docker-server-ghosts-core.mjs';

describe('matchExpectedLinks', () => {
  const ghost = {
    id: 'g1',
    expectedLinks: [
      { kind: 'path', value: 'docker-server-entropy.mjs' },
      { kind: 'path', value: 'src/components/EntropyBadge.tsx' },
      { kind: 'label', value: 'Layers toggle' },
      { kind: 'path', value: 'docker-server-*.mjs' },
    ],
  };

  it('matches paths by suffix (no wildcards)', () => {
    const r = matchExpectedLinks(ghost, ['upstream/docker-server-entropy.mjs']);
    expect(r.matched.some(m => m.matchedPath === 'upstream/docker-server-entropy.mjs')).toBe(true);
  });

  it('matches paths by glob (wildcards)', () => {
    const r = matchExpectedLinks(ghost, ['upstream/docker-server-foo.mjs']);
    expect(r.matched.some(m => m.pattern === 'docker-server-*.mjs')).toBe(true);
  });

  it('ignores `label` expectedLinks (only matches paths)', () => {
    const r = matchExpectedLinks(ghost, ['Layers toggle is now visible']);
    expect(r.matched.find(m => m.pattern === 'Layers toggle')).toBeUndefined();
  });

  it('returns unmatched paths when nothing matches', () => {
    const r = matchExpectedLinks(ghost, ['unrelated/file.txt']);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatched.length).toBeGreaterThan(0);
  });

  it('treats empty changedFiles as all unmatched', () => {
    const r = matchExpectedLinks(ghost, []);
    expect(r.matched).toHaveLength(0);
  });
});
