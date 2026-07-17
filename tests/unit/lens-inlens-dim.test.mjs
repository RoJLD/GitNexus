import { describe, it, expect } from 'vitest';
import {
  knowledgeGraphToGraphology,
  knowledgeGraphToTreeGraphology,
  knowledgeGraphToCirclesGraphology,
} from '../../upstream/gitnexus-web/src/lib/graph-adapter';

// Minimal KnowledgeGraph fixture — only the fields graph-adapter.ts actually
// reads (nodes/relationships) are required at runtime; the TS `KnowledgeGraph`
// interface's extra methods (addNode/addRelationship/counts) are unused by
// knowledgeGraphToGraphology and irrelevant to a plain-JS vitest fixture.
function kg(nodes) {
  return { nodes, relationships: [] };
}

describe('inLens dim (knowledgeGraphToGraphology)', () => {
  it('dims a CodeElement node with inLens===false, leaves true/absent intact', () => {
    const g = knowledgeGraphToGraphology(
      kg([
        { id: 'a', label: 'CodeElement', properties: { name: 'a', filePath: 'a', communityColor: '#abc', inLens: true } },
        { id: 'b', label: 'CodeElement', properties: { name: 'b', filePath: 'b', communityColor: '#abc', inLens: false } },
        { id: 'c', label: 'CodeElement', properties: { name: 'c', filePath: 'c', communityColor: '#abc' } },
      ]),
    );

    expect(g.getNodeAttribute('b', 'color')).toBe('#374151');
    expect(g.getNodeAttribute('a', 'color')).toBe('#abc');
    expect(g.getNodeAttribute('c', 'color')).toBe('#abc');
  });

  it('reduces size for inLens===false and leaves size untouched otherwise', () => {
    // 'Class' has a base NODE_SIZE of 8 (> the dim cap of 2), so the dim
    // branch's size reduction is actually observable here — unlike
    // 'CodeElement' whose base size is already 2.
    const g = knowledgeGraphToGraphology(
      kg([
        { id: 'x', label: 'Class', properties: { name: 'x', filePath: 'x', inLens: true } },
        { id: 'y', label: 'Class', properties: { name: 'y', filePath: 'y', inLens: false } },
      ]),
    );

    expect(g.getNodeAttribute('x', 'size')).toBe(8);
    expect(g.getNodeAttribute('y', 'size')).toBeLessThan(g.getNodeAttribute('x', 'size'));
    expect(g.getNodeAttribute('y', 'size')).toBe(2);
  });

  it('does not affect edges or unrelated node attributes', () => {
    const g = knowledgeGraphToGraphology(
      kg([
        { id: 'a', label: 'CodeElement', properties: { name: 'nodeA', filePath: 'a.ts', inLens: false } },
      ]),
    );

    expect(g.getNodeAttribute('a', 'label')).toBe('nodeA');
    expect(g.getNodeAttribute('a', 'filePath')).toBe('a.ts');
    expect(g.getNodeAttribute('a', 'hidden')).toBe(false);
  });
});

describe('inLens dim (knowledgeGraphToTreeGraphology)', () => {
  it('dims a Class node with inLens===false, leaves true intact', () => {
    // 'Class' has a base NODE_SIZE of 8 (> the dim cap of 2), so the dim
    // branch's size reduction is actually observable here — like the Force
    // adapter tests above.
    const g = knowledgeGraphToTreeGraphology(
      kg([
        { id: 'x', label: 'Class', properties: { name: 'x', filePath: 'x', inLens: true } },
        { id: 'y', label: 'Class', properties: { name: 'y', filePath: 'y', inLens: false } },
      ]),
    );

    expect(g.getNodeAttribute('y', 'color')).toBe('#374151');
    expect(g.getNodeAttribute('x', 'color')).not.toBe('#374151');
    expect(g.getNodeAttribute('y', 'size')).toBeLessThan(g.getNodeAttribute('x', 'size'));
    expect(g.getNodeAttribute('y', 'size')).toBe(2);
  });
});

describe('inLens dim (knowledgeGraphToCirclesGraphology)', () => {
  it('dims a Class node with inLens===false, leaves true intact', () => {
    const g = knowledgeGraphToCirclesGraphology(
      kg([
        { id: 'x', label: 'Class', properties: { name: 'x', filePath: 'x', inLens: true } },
        { id: 'y', label: 'Class', properties: { name: 'y', filePath: 'y', inLens: false } },
      ]),
    );

    expect(g.getNodeAttribute('y', 'color')).toBe('#374151');
    expect(g.getNodeAttribute('x', 'color')).not.toBe('#374151');
    expect(g.getNodeAttribute('y', 'size')).toBeLessThan(g.getNodeAttribute('x', 'size'));
    expect(g.getNodeAttribute('y', 'size')).toBe(2);
  });
});
