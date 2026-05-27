import { describe, it, expect } from 'vitest';
import { matchExistingNodes, computeGhostLayout, tierColor } from '../../upstream/gitnexus-web/src/lib/ghost-layout.ts';

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

const ghost = (id, status, links) => ({
  id, title: id, tier: '2.3', status,
  expectedLinks: links.map(v => ({ kind: 'path', value: v })),
});

describe('computeGhostLayout', () => {
  const existing = [
    { id: 'a.ts', x: 0, y: 0 },
    { id: 'b.ts', x: 10, y: 0 },
  ];

  it('anchored ghosts get the centroid of matched nodes', () => {
    const { ghostNodes, ghostEdges } = computeGhostLayout(
      [ghost('g1', 'planned', ['a.ts', 'b.ts'])],
      existing,
    );
    expect(ghostNodes).toHaveLength(1);
    expect(ghostNodes[0].anchored).toBe(true);
    expect(ghostNodes[0].x).toBeCloseTo(5, 1);   // centroid of a (0) and b (10)
    expect(ghostEdges).toHaveLength(2);          // edge to a.ts + edge to b.ts
  });

  it('satellite ghosts are placed in a grid at top-right', () => {
    const result = computeGhostLayout(
      [
        ghost('g1', 'planned', ['missing.ts']),
        ghost('g2', 'planned', ['also-missing.ts']),
      ],
      existing,
      { canvasBounds: { xMax: 100, yMin: 100 }, satelliteCols: 5 },
    );
    expect(result.ghostNodes).toHaveLength(2);
    expect(result.ghostNodes[0].anchored).toBe(false);
    expect(result.ghostEdges).toHaveLength(0); // satellite ghosts have no edges
  });

  it('skips materialized ghosts (already represented by real nodes)', () => {
    const { ghostNodes } = computeGhostLayout(
      [ghost('g1', 'materialized', ['a.ts'])],
      existing,
    );
    expect(ghostNodes).toHaveLength(0);
  });
});

describe('tierColor', () => {
  it('returns the right color per major tier', () => {
    expect(tierColor('1.4')).toBe('#5b9bd5');
    expect(tierColor('2.3')).toBe('#e1aa55');
    expect(tierColor('3.1')).toBe('#9b59b6');
  });
  it('returns gray for null or unknown', () => {
    expect(tierColor(null)).toBe('#6d6d6d');
    expect(tierColor('99.9')).toBe('#6d6d6d');
  });
});
