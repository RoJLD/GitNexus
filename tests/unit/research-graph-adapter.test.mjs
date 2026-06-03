import { describe, it, expect } from 'vitest';
import { researchGraphToGraphology } from '../../upstream/gitnexus-web/src/lib/research-graph-adapter';

const rg = {
  schema_type: 'research-artifacts',
  nodes: [
    { id: 'h1', type: 'hypothesis', label: 'H1', path: 'a/h1.md', stage: 'a' },
    { id: 'r1', type: 'result', label: 'R1', path: 'a/r1.md', stage: 'a' },
    { id: 'x', type: 'mystery', label: 'X', path: 'a/x.md', stage: 'a' },
  ],
  edges: [{ id: 'h1->validates->r1', source: 'h1', target: 'r1', kind: 'validates' }],
};

describe('researchGraphToGraphology', () => {
  it('creates one node per ResearchGraph node with palette colors', () => {
    const g = researchGraphToGraphology(rg);
    expect(g.order).toBe(3);
    expect(g.size).toBe(1);
    expect(g.getNodeAttribute('h1', 'color')).toBe('#a855f7');
    expect(g.getNodeAttribute('r1', 'color')).toBe('#10b981');
    expect(g.getNodeAttribute('h1', 'label')).toBe('H1');
  });

  it('falls back to gray for unknown types', () => {
    const g = researchGraphToGraphology(rg);
    expect(g.getNodeAttribute('x', 'color')).toBe('#9ca3af');
  });

  it('skips edges with missing endpoints without throwing', () => {
    const g = researchGraphToGraphology({ nodes: [{ id: 'h1', type: 'note', label: 'H', path: 'h.md', stage: '' }], edges: [{ id: 'e', source: 'h1', target: 'ghost', kind: 'validates' }] });
    expect(g.order).toBe(1);
    expect(g.size).toBe(0);
  });
});

describe('adapter on sidecar render payload', () => {
  it('renders {nodes,edges} from the sidecar (no schema_type field)', () => {
    const payload = {
      nodes: [{ id: 'h1', type: 'hypothesis', label: 'H1', path: 'a/h1.md', stage: 'a' }],
      edges: [{ source: 'h1', target: 'h1b', kind: 'validates', id: 'e1' }],
    };
    const g = researchGraphToGraphology(payload); // defensive: missing edge endpoint skipped, node colored by type
    expect(g.order).toBe(1);
    expect(g.getNodeAttribute('h1', 'color')).toBe('#a855f7');
  });
});
