import { describe, it, expect } from 'vitest';
import { collapseToFileLevel, mergeRepoGraphs } from '../../upstream/docker-server-group-graph-core.mjs';

const repoAGraph = {
  nodes: [
    { id: 'file:a.ts', label: 'File', properties: { name: 'a.ts', filePath: 'a.ts' } },
    { id: 'fn:a.ts:foo', label: 'Function', properties: { name: 'foo', filePath: 'a.ts' } },
    { id: 'fn:b.ts:bar', label: 'Function', properties: { name: 'bar', filePath: 'b.ts' } },
  ],
  relationships: [
    { id: 'r1', sourceId: 'fn:a.ts:foo', targetId: 'fn:b.ts:bar', type: 'CALLS' },
    { id: 'r2', sourceId: 'file:a.ts', targetId: 'fn:a.ts:foo', type: 'CONTAINS' }, // intra-file → self-loop, dropped
  ],
};

describe('collapseToFileLevel', () => {
  it('folds symbols into files, namespaces ids by repo, rolls up + dedups edges, drops self-loops', () => {
    const c = collapseToFileLevel(repoAGraph, 'repoA');
    const ids = c.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['repoA::a.ts', 'repoA::b.ts']);
    expect(c.nodes.every((n) => n.repo === 'repoA' && n.kind === 'file')).toBe(true);
    expect(c.edges).toEqual([{ source: 'repoA::a.ts', target: 'repoA::b.ts' }]);
  });
  it('handles empty graph', () => {
    expect(collapseToFileLevel({ nodes: [], relationships: [] }, 'r')).toEqual({ nodes: [], edges: [] });
  });
});

describe('mergeRepoGraphs', () => {
  it('unions collapsed graphs + adds cross-repo edges from crossLinks (by symbolRef.filePath)', () => {
    const a = collapseToFileLevel(repoAGraph, 'repoA');
    const b = collapseToFileLevel({ nodes: [{ id: 'file:x.ts', label: 'File', properties: { name: 'x.ts', filePath: 'x.ts' } }], relationships: [] }, 'repoB');
    const crossLinks = [
      { from: { repo: 'repoA', symbolRef: { filePath: 'a.ts' } }, to: { repo: 'repoB', symbolRef: { filePath: 'x.ts' } }, type: 'http', matchType: 'exact' },
      { from: { repo: 'repoA', symbolRef: { filePath: 'ghost.ts' } }, to: { repo: 'repoB', symbolRef: { filePath: 'x.ts' } }, type: 'http', matchType: 'bm25' },
    ];
    const merged = mergeRepoGraphs([a, b], crossLinks);
    expect(merged.nodes.map((n) => n.id).sort()).toEqual(['repoA::a.ts', 'repoA::b.ts', 'repoB::x.ts']);
    const cross = merged.edges.filter((e) => e.crossRepo);
    expect(cross).toEqual([{ source: 'repoA::a.ts', target: 'repoB::x.ts', crossRepo: true, matchType: 'exact', contractType: 'http' }]);
  });
});
