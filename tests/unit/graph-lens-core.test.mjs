import { describe, it, expect } from 'vitest';
import { projectImports } from '../../upstream/docker-server-graph-lens-core.mjs';

const GRAPH = {
  nodes: [
    { id: 'n1', properties: { filePath: 'src/a.ts' } },
    { id: 'n2', properties: { filePath: 'src/a.ts' } },
    { id: 'n3', properties: { filePath: 'src/b.ts' } },
    { id: 'n4', properties: { filePath: 'src/c.ts' } },
  ],
  relationships: [
    { sourceId: 'n1', targetId: 'n3', type: 'IMPORTS' },
    { sourceId: 'n2', targetId: 'n3', type: 'IMPORTS' },
    { sourceId: 'n1', targetId: 'n4', type: 'CALLS' },
    { sourceId: 'n1', targetId: 'n2', type: 'IMPORTS' },
  ],
};

describe('projectImports', () => {
  it('keeps only IMPORTS edges, rolls up to file level, dedups, drops self-loops', () => {
    const rg = projectImports(GRAPH);
    expect(rg.schema_type).toBe('imports-deps');
    expect(rg.edges).toHaveLength(1);
    expect(rg.edges[0]).toMatchObject({ source: 'src/a.ts', target: 'src/b.ts', kind: 'imports' });
    expect(rg.nodes.map((n) => n.id).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    const a = rg.nodes.find((n) => n.id === 'src/a.ts');
    expect(a).toMatchObject({ type: 'file', label: 'a.ts', path: 'src/a.ts', stage: '' });
  });
});
