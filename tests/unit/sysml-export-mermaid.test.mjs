import { describe, it, expect } from 'vitest';
import { renderMermaid } from '../../upstream/docker-server-sysml-export-core.mjs';

describe('renderMermaid', () => {
  it('emits graph TD header', () => {
    expect(renderMermaid({ ghosts: [], files: [], repoName: 'r' })).toMatch(/^graph TD/m);
  });

  it('emits a node per file and per ghost with stereotype', () => {
    const out = renderMermaid({
      ghosts: [{ id: 'g1', declared: { title: 'G' }, status: 'planned', tier: '1', links: [{ file: 'a.ts' }] }],
      files: ['a.ts'], repoName: 'r',
    });
    expect(out).toMatch(/B_a_ts\[/);
    expect(out).toMatch(/R_g1\[/);
    expect(out).toMatch(/R_g1\s*-->\|satisfy\|\s*B_a_ts/);
  });

  it('groups tiers in subgraphs', () => {
    const out = renderMermaid({
      ghosts: [{ id: 'a', declared: { title: 'A' }, status: 'planned', tier: '2', links: [] }],
      files: [], repoName: 'r',
    });
    expect(out).toMatch(/subgraph Tier_2/);
    expect(out).toMatch(/^end$/m);
  });
});
