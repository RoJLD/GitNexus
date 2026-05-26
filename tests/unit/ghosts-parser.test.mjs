import { describe, it, expect } from 'vitest';
import { parseRoadmap } from '../../upstream/docker-server-ghosts-core.mjs';

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
});
