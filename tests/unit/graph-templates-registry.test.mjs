import { describe, it, expect } from 'vitest';
import { resolve, sep } from 'node:path';
import {
  listTemplates,
  getTemplate,
  registerTemplate,
  sanitizeSource,
} from '../../upstream/docker-server-graph-templates-core.mjs';

describe('graph-templates registry', () => {
  it('ships the built-in research-artifacts template', () => {
    const ids = listTemplates().map((t) => t.id);
    expect(ids).toContain('research-artifacts');
    const t = getTemplate('research-artifacts');
    expect(t.schema_type).toBe('research-artifacts');
    expect(t.importer).toBe('research-fs');
    expect(t.include).toEqual(['**/*.ipynb', '**/*.md']);
  });

  it('getTemplate returns null for unknown id', () => {
    expect(getTemplate('nope')).toBeNull();
  });

  it('registerTemplate adds and is builtin-protected', () => {
    registerTemplate({ id: 'demo', label: 'Demo', schema_type: 'demo', importer: 'research-fs' });
    expect(getTemplate('demo').label).toBe('Demo');
    expect(() => registerTemplate({ id: 'research-artifacts', label: 'x', schema_type: 'x', importer: 'research-fs' }))
      .toThrow(/builtin/);
  });

  it('sanitizeSource keeps paths inside the projects root and rejects traversal', () => {
    const root = '/data/projects';
    const out = sanitizeSource('foo/bar', root);
    expect(out.startsWith(resolve(root) + sep)).toBe(true);
    expect(out.endsWith(['foo', 'bar'].join(sep))).toBe(true);
    expect(() => sanitizeSource('../../etc', root)).toThrow(/outside/);
  });
});

import { getTemplate as gt2 } from '../../upstream/docker-server-graph-templates-core.mjs';

describe('template kinds + ddl', () => {
  it('research-artifacts is an import template with Kùzu DDL', () => {
    const t = gt2('research-artifacts');
    expect(t.kind).toBe('import');
    expect(Array.isArray(t.ddl)).toBe(true);
    expect(t.ddl.join(' ')).toMatch(/CREATE NODE TABLE Artifact/);
    expect(t.ddl.join(' ')).toMatch(/CREATE REL TABLE Link/);
  });

  it('registers the academic-literature import template with a multi-table DDL', () => {
    const acad = listTemplates().find((t) => t.id === 'academic-literature');
    expect(acad).toBeTruthy();
    expect(acad.kind).toBe('import');
    expect(acad.importer).toBe('academic-json');
    expect(acad.ddl.some((s) => /CREATE NODE TABLE Paper/.test(s))).toBe(true);
    expect(acad.ddl.some((s) => /CREATE REL TABLE AUTHORED/.test(s))).toBe(true);
    expect(acad.ddl.some((s) => /CREATE NODE TABLE Topic/.test(s))).toBe(true);
    expect(acad.ddl.some((s) => /CREATE REL TABLE ABOUT/.test(s))).toBe(true);
  });

  it('registers the imports-deps lens descriptor', () => {
    const lens = listTemplates().find((t) => t.id === 'imports-deps');
    expect(lens).toBeTruthy();
    expect(lens.kind).toBe('lens');
    expect(lens.target).toBe('astkg');
  });

  it('registers the research-graph import template (generic Entity/Relates DDL)', async () => {
    const { listTemplates } = await import('../../upstream/docker-server-graph-templates-core.mjs');
    const rg = listTemplates().find((t) => t.id === 'research-graph');
    expect(rg).toBeTruthy();
    expect(rg.kind).toBe('import');
    expect(rg.importer).toBe('research-graph-json');
    expect(rg.ddl.some((s) => /CREATE NODE TABLE Entity/.test(s))).toBe(true);
    expect(rg.ddl.some((s) => /CREATE REL TABLE Relates/.test(s))).toBe(true);
  });

  it('registers the model-graph import template (ModelNode/ModelEdge DDL)', () => {
    const mg = listTemplates().find((t) => t.id === 'model-graph');
    expect(mg).toBeTruthy();
    expect(mg.kind).toBe('import');
    expect(mg.schema_type).toBe('model-graph');
    expect(mg.importer).toBe('model-graph-json');
    expect(mg.ddl.some((s) => /CREATE NODE TABLE ModelNode\(.*type STRING.*\)/.test(s))).toBe(true);
    expect(mg.ddl.some((s) => /CREATE REL TABLE ModelEdge\(.*kind STRING.*weight DOUBLE.*\)/.test(s))).toBe(true);
  });
});
