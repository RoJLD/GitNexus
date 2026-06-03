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
});
