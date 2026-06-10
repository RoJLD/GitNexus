import { describe, it, expect } from 'vitest';
import { researchTo3D } from '../../upstream/gitnexus-web/src/lib/research-to-3d.ts';

const RG = {
  nodes: [
    { id: 'a', type: 'Hypothesis', label: 'H-A', path: '', stage: '' },
    { id: 'b', type: 'Experiment', label: 'E-B', path: '', stage: '' },
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'b', kind: 'tests' },
    { id: 'e2', source: 'a', target: 'b', kind: 'tests' },   // dup
    { id: 'e3', source: 'a', target: 'a', kind: 'self' },     // self-loop
    { id: 'e4', source: 'a', target: 'zzz', kind: 'dangling' },
  ],
};

describe('researchTo3D', () => {
  it('no metrics → research-type color, fixed val, research flag; name=label, label=type', () => {
    const { nodes, links } = researchTo3D(RG);
    const a = nodes.find((n) => n.id === 'a');
    expect(a.name).toBe('H-A');
    expect(a.label).toBe('Hypothesis');
    expect(a.val).toBe(4);
    expect(a.research).toBe(true);
    expect(typeof a.baseColor).toBe('string');
    expect(links).toHaveLength(1);                 // dup + self-loop + dangling dropped
    expect(links[0]).toMatchObject({ source: 'a', target: 'b', type: 'tests' });
  });
  it('with metrics → community palette color + size scaled by metric', () => {
    const m = new Map([
      ['a', { community: 0, pagerank: 0.1 }],
      ['b', { community: 1, pagerank: 0.9 }],
    ]);
    const { nodes } = researchTo3D(RG, m, 'pagerank');
    const a = nodes.find((n) => n.id === 'a');
    const b = nodes.find((n) => n.id === 'b');
    expect(a.baseColor).not.toBe(b.baseColor);     // different communities → different palette colors
    expect(b.val).toBeGreaterThan(a.val);          // higher pagerank → bigger
  });
});
