import { describe, it, expect } from 'vitest';
import { researchGraphToIngest } from '../../upstream/docker-server-graph-templates-core.mjs';

describe('researchGraphToIngest', () => {
  it('maps ResearchGraph nodes/edges to sidecar ingest shape', () => {
    const rg = {
      nodes: [{ id: 'h1', type: 'hypothesis', label: 'H1', path: 'a/h1.md', stage: 'a' }],
      edges: [{ id: 'h1->r1', source: 'h1', target: 'r1', kind: 'validates' }],
    };
    const out = researchGraphToIngest(rg);
    expect(out.nodes[0]).toEqual({ table: 'Artifact', props: { id: 'h1', type: 'hypothesis', label: 'H1', path: 'a/h1.md', stage: 'a' } });
    expect(out.edges[0]).toEqual({ table: 'Link', from: 'h1', to: 'r1', props: { id: 'h1->r1', kind: 'validates' } });
  });
});
