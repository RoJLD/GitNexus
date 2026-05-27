import { describe, it, expect } from 'vitest';
import { deriveAutoClusters } from '../../upstream/docker-server-ghosts-core.mjs';
import { createHash } from 'node:crypto';

function expectedAutoId(memberIds) {
  const sorted = [...memberIds].sort();
  const sha = createHash('sha256').update(sorted.join(',')).digest('hex');
  return `auto-cluster-${sha.slice(0, 8)}`;
}

describe('deriveAutoClusters', () => {
  it('groups ghosts connected via dependsOn (undirected)', () => {
    const ghosts = [
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: [] },
      { id: 'c', dependsOn: ['d'] },
      { id: 'd', dependsOn: [] },
      { id: 'e', dependsOn: [] }, // isolated, ignored
    ];
    const out = deriveAutoClusters(ghosts, new Set());
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ source: 'auto', memberIds: ['a', 'b'] });
    expect(out[1].memberIds.sort()).toEqual(['c', 'd']);
  });

  it('excludes ghosts in claimedIds (already in declared cluster)', () => {
    const ghosts = [
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: [] },
    ];
    const claimed = new Set(['a']); // 'a' already declared elsewhere
    const out = deriveAutoClusters(ghosts, claimed);
    expect(out).toHaveLength(0); // 'b' alone is not a cluster
  });

  it('id is deterministic sha256(sorted memberIds)[:8]', () => {
    const ghosts = [
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: [] },
    ];
    const out = deriveAutoClusters(ghosts, new Set());
    expect(out[0].id).toBe(expectedAutoId(['a', 'b']));
  });

  it('skips singletons (composant connecté = 1)', () => {
    const ghosts = [{ id: 'a', dependsOn: [] }];
    expect(deriveAutoClusters(ghosts, new Set())).toEqual([]);
  });
});
