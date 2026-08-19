import { describe, it, expect } from 'vitest';
import {
  projectClassDiagram,
} from '../../upstream/docker-server-graph-lens-core.mjs';
import { renderMermaidClass } from '../../upstream/docker-server-sysml-export-core.mjs';

// Fixture matching the REAL /api/graph shape (measured 2026-07-11) :
// node.label carries the type (Class/Interface/Method/Property/Function), the
// name/filePath live under node.properties, relationships are {type,sourceId,targetId}.
// HAS_METHOD/HAS_PROPERTY = class->member ; MEMBER_OF = member->class.
const GRAPH = {
  nodes: [
    { id: 'C:Animal', label: 'Class', properties: { name: 'Animal', filePath: 'src/a.ts' } },
    { id: 'M:speak', label: 'Method', properties: { name: 'speak', filePath: 'src/a.ts' } },
    { id: 'P:name', label: 'Property', properties: { name: 'name', filePath: 'src/a.ts' } },
    { id: 'I:Walker', label: 'Interface', properties: { name: 'Walker', filePath: 'src/w.ts' } },
    { id: 'M:walk', label: 'Method', properties: { name: 'walk', filePath: 'src/w.ts' } },
    { id: 'F:free', label: 'Function', properties: { name: 'free', filePath: 'src/x.ts' } },
  ],
  relationships: [
    { type: 'HAS_METHOD', sourceId: 'C:Animal', targetId: 'M:speak' },
    { type: 'HAS_PROPERTY', sourceId: 'C:Animal', targetId: 'P:name' },
    { type: 'MEMBER_OF', sourceId: 'M:walk', targetId: 'I:Walker' },
    // Animal.speak -> Walker.walk : an inter-class call, rolled up to Animal ..> Walker
    { type: 'CALLS', sourceId: 'M:speak', targetId: 'M:walk' },
    // intra-Animal call (speak -> name is not a call, but add a self-ish call to test drop)
    { type: 'CALLS', sourceId: 'M:speak', targetId: 'P:name' },
  ],
};

describe('projectClassDiagram', () => {
  it('projects Class + Interface nodes with their members', () => {
    const cd = projectClassDiagram(GRAPH);
    expect(cd.schema_type).toBe('class-diagram');
    expect(cd.classes).toHaveLength(2); // Animal, Walker — Function is NOT a class
    const animal = cd.classes.find((c) => c.name === 'Animal');
    expect(animal.stereotype).toBe('class');
    expect(animal.members).toEqual(
      expect.arrayContaining([
        { kind: 'method', name: 'speak' },
        { kind: 'field', name: 'name' },
      ]),
    );
    const walker = cd.classes.find((c) => c.name === 'Walker');
    expect(walker.stereotype).toBe('interface');
    expect(walker.members).toEqual([{ kind: 'method', name: 'walk' }]); // via MEMBER_OF
  });

  it('rolls CALLS up to class-level associations, drops self + intra-class', () => {
    const cd = projectClassDiagram(GRAPH);
    // speak(Animal) -> walk(Walker) = one Animal..>Walker association.
    // speak(Animal) -> name(Animal) = intra-class, dropped.
    expect(cd.associations).toHaveLength(1);
    expect(cd.associations[0]).toMatchObject({ kind: 'calls' });
    const animal = cd.classes.find((c) => c.name === 'Animal');
    const walker = cd.classes.find((c) => c.name === 'Walker');
    expect(cd.associations[0].source).toBe(animal.id);
    expect(cd.associations[0].target).toBe(walker.id);
  });

  it('reports inheritance none-in-graph when no inheritance edge between in-graph classes — Zero Masking', () => {
    const cd = projectClassDiagram(GRAPH);
    expect(cd.meta.inheritance).toBe('none-in-graph');
    expect(cd.inheritances).toEqual([]);
    expect(cd.meta.total_classes).toBe(2);
    expect(cd.meta.truncated_from).toBeNull();
  });

  // MEASURED 2026-07-12 on a live probe (internal-inheritance repo, TS + Python):
  // the ingestion emits inheritance as EXTENDS (class→superclass) and IMPLEMENTS
  // (class→interface), NOT `INHERITS`. The v2 `INHERITS`-only projection rendered
  // ZERO arrows on real data (dead path). These tests pin the REAL edge types.
  it('renders inheritance from EXTENDS edges (real ingestion type) between two in-graph classes', () => {
    const g = {
      nodes: [
        { id: 'C:Animal', label: 'Class', properties: { name: 'Animal' } },
        { id: 'C:Dog', label: 'Class', properties: { name: 'Dog' } },
      ],
      // Ingestion emits EXTENDS source=subclass → target=superclass.
      relationships: [{ type: 'EXTENDS', sourceId: 'C:Dog', targetId: 'C:Animal' }],
    };
    const cd = projectClassDiagram(g);
    expect(cd.inheritances).toEqual([{ child: 'C:Dog', parent: 'C:Animal', kind: 'extends' }]);
    expect(cd.meta.inheritance).toBe('rendered');
    expect(cd.meta.inheritance_count).toBe(1);
  });

  it('renders realization from IMPLEMENTS edges (class → interface)', () => {
    const g = {
      nodes: [
        { id: 'C:Bird', label: 'Class', properties: { name: 'Bird' } },
        { id: 'I:Walker', label: 'Interface', properties: { name: 'Walker' } },
      ],
      // Ingestion emits IMPLEMENTS source=class → target=interface.
      relationships: [{ type: 'IMPLEMENTS', sourceId: 'C:Bird', targetId: 'I:Walker' }],
    };
    const cd = projectClassDiagram(g);
    expect(cd.inheritances).toEqual([{ child: 'C:Bird', parent: 'I:Walker', kind: 'implements' }]);
    expect(cd.meta.inheritance).toBe('rendered');
    expect(cd.meta.inheritance_count).toBe(1);
  });

  it('still accepts INHERITS as a generic-inheritance fallback (mapped to extends)', () => {
    const g = {
      nodes: [
        { id: 'C:A', label: 'Class', properties: { name: 'A' } },
        { id: 'C:B', label: 'Class', properties: { name: 'B' } },
      ],
      relationships: [{ type: 'INHERITS', sourceId: 'C:B', targetId: 'C:A' }],
    };
    const cd = projectClassDiagram(g);
    expect(cd.inheritances).toEqual([{ child: 'C:B', parent: 'C:A', kind: 'extends' }]);
    expect(cd.meta.inheritance).toBe('rendered');
  });

  it('drops inheritance whose base is external/unindexed (not in the graph)', () => {
    const g = {
      nodes: [{ id: 'C:Dog', label: 'Class', properties: { name: 'Dog' } }],
      relationships: [{ type: 'EXTENDS', sourceId: 'C:Dog', targetId: 'External:Protocol' }],
    };
    const cd = projectClassDiagram(g);
    expect(cd.inheritances).toEqual([]);
    expect(cd.meta.inheritance).toBe('none-in-graph');
  });

  it('caps rendering by member count and reports truncation', () => {
    const cd = projectClassDiagram(GRAPH, { cap: 1 });
    expect(cd.classes).toHaveLength(1);
    expect(cd.classes[0].name).toBe('Animal'); // richest (2 members) kept
    expect(cd.meta.truncated_from).toBe(2);
    // association referencing the dropped class is dropped too
    expect(cd.associations).toHaveLength(0);
  });

  it('dedupes a member reachable via both HAS_METHOD and MEMBER_OF', () => {
    const g = {
      nodes: [
        { id: 'C', label: 'Class', properties: { name: 'C' } },
        { id: 'm', label: 'Method', properties: { name: 'm' } },
      ],
      relationships: [
        { type: 'HAS_METHOD', sourceId: 'C', targetId: 'm' },
        { type: 'MEMBER_OF', sourceId: 'm', targetId: 'C' },
      ],
    };
    const cd = projectClassDiagram(g);
    expect(cd.classes[0].members).toEqual([{ kind: 'method', name: 'm' }]);
  });

  it('is robust to empty / malformed graph', () => {
    expect(projectClassDiagram({}).classes).toEqual([]);
    expect(projectClassDiagram(null).classes).toEqual([]);
  });
});

describe('renderMermaidClass', () => {
  it('emits valid classDiagram with class blocks, members, interface stereotype, associations', () => {
    const cd = projectClassDiagram(GRAPH);
    const out = renderMermaidClass({ ...cd, repoName: 'demo' });
    expect(out.startsWith('classDiagram')).toBe(true);
    expect(out).toContain('class Animal {');
    expect(out).toContain('+speak()');
    expect(out).toContain('+name');
    expect(out).toContain('<<interface>>');
    expect(out).toMatch(/Animal \.\.> Walker : calls/);
    // Zero Masking : the diagram states WHY there are no arrows (no in-graph inheritance).
    expect(out).toMatch(/inheritance: none in-graph/);
  });

  it('renders a mermaid inheritance arrow (parent <|-- child) from EXTENDS', () => {
    const g = {
      nodes: [
        { id: 'C:Animal', label: 'Class', properties: { name: 'Animal' } },
        { id: 'C:Dog', label: 'Class', properties: { name: 'Dog' } },
      ],
      relationships: [{ type: 'EXTENDS', sourceId: 'C:Dog', targetId: 'C:Animal' }],
    };
    const out = renderMermaidClass({ ...projectClassDiagram(g), repoName: 'demo' });
    expect(out).toMatch(/Animal <\|-- Dog/); // parent <|-- child (solid inheritance)
    expect(out).toMatch(/inheritance: 1 relation/);
  });

  it('renders a mermaid realization arrow (interface <|.. class) from IMPLEMENTS', () => {
    const g = {
      nodes: [
        { id: 'C:Bird', label: 'Class', properties: { name: 'Bird' } },
        { id: 'I:Walker', label: 'Interface', properties: { name: 'Walker' } },
      ],
      relationships: [{ type: 'IMPLEMENTS', sourceId: 'C:Bird', targetId: 'I:Walker' }],
    };
    const out = renderMermaidClass({ ...projectClassDiagram(g), repoName: 'demo' });
    expect(out).toMatch(/Walker <\|\.\. Bird/); // interface <|.. class (dashed realization)
  });

  it('disambiguates same-named classes with a suffix (mermaid ids must be unique)', () => {
    const out = renderMermaidClass({
      classes: [
        { id: 'a', name: 'Config', path: 'src/a.ts', stereotype: 'class', members: [] },
        { id: 'b', name: 'Config', path: 'src/b.ts', stereotype: 'class', members: [] },
      ],
      associations: [],
      meta: { inheritance: 'unavailable' },
      repoName: 'demo',
    });
    expect(out).toContain('class Config {');
    expect(out).toContain('class Config_1 {');
  });

  it('sanitizes member names that would break mermaid', () => {
    const out = renderMermaidClass({
      classes: [
        { id: 'a', name: 'Box', path: '', stereotype: 'class', members: [{ kind: 'method', name: '__init__' }, { kind: 'field', name: 'x<T>' }] },
      ],
      associations: [],
      meta: { inheritance: 'unavailable' },
      repoName: 'demo',
    });
    expect(out).toContain('+__init__()');
    expect(out).not.toContain('<T>'); // angle brackets stripped
  });
});
