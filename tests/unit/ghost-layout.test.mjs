import { describe, it, expect } from 'vitest';
import { matchExistingNodes } from '../../upstream/gitnexus-web/src/lib/ghost-layout.ts';

describe('matchExistingNodes', () => {
  it('matches by suffix (no wildcards)', () => {
    const links = [{ kind: 'path', value: 'docker-server-entropy.mjs' }];
    const nodes = ['upstream/docker-server-entropy.mjs', 'foo.ts'];
    expect(matchExistingNodes(links, nodes)).toEqual(['upstream/docker-server-entropy.mjs']);
  });

  it('matches by glob', () => {
    const links = [{ kind: 'path', value: 'docker-server-*.mjs' }];
    const nodes = ['upstream/docker-server-entropy.mjs', 'upstream/docker-server-churn.mjs', 'unrelated.ts'];
    expect(matchExistingNodes(links, nodes)).toHaveLength(2);
  });

  it('ignores label-kind links', () => {
    const links = [{ kind: 'label', value: 'Layers toggle' }, { kind: 'path', value: 'foo.ts' }];
    const nodes = ['foo.ts', 'Layers toggle is here'];
    expect(matchExistingNodes(links, nodes)).toEqual(['foo.ts']);
  });

  it('returns empty array when nothing matches', () => {
    expect(matchExistingNodes([{ kind: 'path', value: 'missing.ts' }], ['foo.ts'])).toEqual([]);
  });
});
