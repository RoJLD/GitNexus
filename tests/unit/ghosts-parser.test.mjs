import { describe, it, expect } from 'vitest';
import { parseRoadmap, warnMissingExpectedBy } from '../../upstream/docker-server-ghosts-core.mjs';

describe('parseRoadmap — table rows', () => {
  it('extracts ghosts from the "Déjà livré" markdown table', () => {
    const md = [
      '# Roadmap',
      '',
      '## ✅ Déjà livré',
      '',
      '| # | Feature | Endpoint(s) / Composant(s) |',
      '|---|---|---|',
      '| 1 | **Loading bars** | `/listdir`, `DropZone.LoadingCard` |',
      '| 2 | **CSV export** | `?format=csv`, `docker-server-csv.mjs` |',
      '',
    ].join('\n');
    const ghosts = parseRoadmap(md);
    expect(ghosts).toHaveLength(2);
    expect(ghosts[0]).toMatchObject({
      id: '1-loading-bars',
      title: 'Loading bars',
      status: 'materialized',
      expectedLinks: [
        { kind: 'path', value: '/listdir' },
        { kind: 'label', value: 'DropZone.LoadingCard' },
      ],
    });
    expect(ghosts[1].expectedLinks.some(l => l.value === 'docker-server-csv.mjs' && l.kind === 'path')).toBe(true);
  });

  it('returns [] on empty input', () => {
    expect(parseRoadmap('')).toEqual([]);
  });

  it('returns [] when no "Déjà livré" section exists', () => {
    expect(parseRoadmap('# Just a title\n\nNo content.\n')).toEqual([]);
  });

  it('emits dependsOn as empty array by default', () => {
    const md = [
      '## ✅ Déjà livré', '',
      '| # | Feature | Endpoint(s) / Composant(s) |',
      '|---|---|---|',
      '| 1 | **Feature A** | `a.ts` |',
      '',
    ].join('\n');
    const ghosts = parseRoadmap(md);
    expect(ghosts[0].dependsOn).toEqual([]);
  });

  it('classifies query-string endpoints (?format=csv) as path', () => {
    const md = [
      '## ✅ Déjà livré', '',
      '| # | Feature | Endpoint(s) / Composant(s) |',
      '|---|---|---|',
      '| 1 | **CSV export** | `?format=csv`, `docker-server-csv.mjs` |',
      '',
    ].join('\n');
    const ghosts = parseRoadmap(md);
    expect(ghosts[0].expectedLinks).toContainEqual({ kind: 'path', value: '?format=csv' });
    expect(ghosts[0].expectedLinks).toContainEqual({ kind: 'path', value: 'docker-server-csv.mjs' });
  });

  it('tolerates blank lines inside the table without dropping subsequent rows', () => {
    const md = [
      '## ✅ Déjà livré', '',
      '| # | Feature | Endpoint(s) / Composant(s) |',
      '|---|---|---|',
      '| 1 | **First** | `a.ts` |',
      '',  // blank line within table
      '| 2 | **Second** | `b.ts` |',
      '',
    ].join('\n');
    const ghosts = parseRoadmap(md);
    expect(ghosts).toHaveLength(2);
    expect(ghosts.map(g => g.title)).toEqual(['First', 'Second']);
  });
});

describe('parseRoadmap — managed "From spec brainstorms" section', () => {
  const md = [
    '# Roadmap', '',
    '## ✅ Déjà livré', '',
    '| # | Feature | Endpoint(s) / Composant(s) |',
    '|---|---|---|',
    '| 1 | **Old feature** | `old.ts` |',
    '',
    '## 🧪 From spec brainstorms', '',
    '<!-- specs:start -->',
    '| Spec | Tier | Title | Endpoint(s) / Composant(s) |',
    '|---|---|---|---|',
    '| [2026-05-26-foo-design](path) | 2.3 | Foo planned | `services/foo.ts` |',
    '<!-- specs:end -->',
  ].join('\n');

  it('picks up rows from the managed section with status: planned', () => {
    const ghosts = parseRoadmap(md);
    const foo = ghosts.find(g => g.title === 'Foo planned');
    expect(foo).toBeDefined();
    expect(foo.status).toBe('planned');
    expect(foo.tier).toBe('2.3');
    expect(foo.expectedLinks.some(l => l.value === 'services/foo.ts')).toBe(true);
  });

  it('still picks up the Déjà livré section with status: materialized', () => {
    const ghosts = parseRoadmap(md);
    expect(ghosts.find(g => g.title === 'Old feature').status).toBe('materialized');
  });

  it('handles a missing tier as null (em-dash placeholder)', () => {
    const md2 = [
      '## 🧪 From spec brainstorms', '',
      '<!-- specs:start -->',
      '| Spec | Tier | Title | Endpoint(s) / Composant(s) |',
      '|---|---|---|---|',
      '| [2026-05-26-bar-design](path) | — | Bar | `bar.ts` |',
      '<!-- specs:end -->',
    ].join('\n');
    const ghosts = parseRoadmap(md2);
    const bar = ghosts.find(g => g.title === 'Bar');
    expect(bar.tier).toBeNull();
    expect(bar.status).toBe('planned');
  });
});

describe('parseRoadmap — Tier sections', () => {
  const md = [
    '## 🎯 Tier 1 — Prochaines briques',
    '',
    '### 1.4 — Entropie structurelle ✅',
    '**Promesse** : un seul chiffre — le **Coefficient de Cohérence Structurelle**.',
    '',
    '**Premier pas** : `GET /entropy?repo=<base>` qui calcule un score par snapshot.',
    '',
    '### 2.3 — What-if simulator',
    '**Promesse** : "Si je renomme `validateUser`...", mutations symboliques.',
    '',
    '**Premier pas** : action `rename` déjà côté MCP. UI = formulaire dans `WhatIfPanel.tsx`.',
    '',
    '### 3.4 — Auto-PR de refactoring 🗑️',
    '**Promesse** : GitNexus propose automatiquement des PRs.',
  ].join('\n');

  it('extracts a materialized Tier section (✅)', () => {
    const ghosts = parseRoadmap(md);
    const entropy = ghosts.find(g => g.tier === '1.4');
    expect(entropy).toMatchObject({
      id: 'tier-1-4-entropie-structurelle',
      tier: '1.4',
      title: 'Entropie structurelle',
      status: 'materialized',
    });
    expect(entropy.description).toContain('Coefficient de Cohérence');
    expect(entropy.expectedLinks.some(l => l.value === '/entropy?repo=<base>')).toBe(true);
  });

  it('extracts a planned Tier section (no emoji)', () => {
    const ghosts = parseRoadmap(md);
    const whatif = ghosts.find(g => g.tier === '2.3');
    expect(whatif.status).toBe('planned');
    expect(whatif.expectedLinks.some(l => l.value === 'WhatIfPanel.tsx')).toBe(true);
  });

  it('extracts a cancelled Tier section (🗑️)', () => {
    const ghosts = parseRoadmap(md);
    const autopr = ghosts.find(g => g.tier === '3.4');
    expect(autopr.status).toBe('cancelled');
  });
});

describe('warnMissingExpectedBy', () => {
  it('warns on stderr for planned ghosts without expectedBy', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);
    try {
      warnMissingExpectedBy([
        { id: 'a', status: 'planned' },
        { id: 'b', status: 'materialized' },
        { id: 'c', status: 'planned', expectedBy: '2026-Q3' },
      ]);
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.some(w => w.includes('"a"'))).toBe(true);
    expect(warnings.some(w => w.includes('"b"'))).toBe(false);
    expect(warnings.some(w => w.includes('"c"'))).toBe(false);
  });

  it('is silent when opts.silent is true', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);
    try {
      warnMissingExpectedBy([{ id: 'a', status: 'planned' }], { silent: true });
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings).toHaveLength(0);
  });
});
