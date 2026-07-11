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

  it('declares inheritance unavailable (no EXTENDS/IMPLEMENTS in the graph) — Zero Masking', () => {
    const cd = projectClassDiagram(GRAPH);
    expect(cd.meta.inheritance).toBe('unavailable');
    expect(cd.meta.total_classes).toBe(2);
    expect(cd.meta.truncated_from).toBeNull();
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
    // Zero Masking : the diagram states what it does NOT show.
    expect(out).toMatch(/inheritance: unavailable/);
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
