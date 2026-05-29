import { describe, it, expect } from 'vitest';
import { formatBumpReport } from '../../scripts/bump-upstream.mjs';

describe('formatBumpReport', () => {
  it('résume clean / conflict / fail par catégorie', () => {
    const results = [
      { file: 'docker-server-routes.mjs', layer: 'additive', status: 'clean' },
      { file: 'App.tsx', layer: 'inplace', status: 'conflict' },
      { file: 'useAppState.tsx', layer: 'inplace', status: 'fail' },
    ];
    const md = formatBumpReport('main', results);
    expect(md).toContain('main');
    expect(md).toContain('App.tsx');
    expect(md).toContain('useAppState.tsx');
    expect(md).toMatch(/^- clean: 1$/m);
    expect(md).toMatch(/^- conflict: 1$/m);
    expect(md).toMatch(/^- fail: 1$/m);
  });

  it('signale un bump sans conflit comme trivial', () => {
    const md = formatBumpReport('v1.7.0', [
      { file: 'docker-server.mjs', layer: 'inplace', status: 'clean' },
    ]);
    expect(md).toMatch(/trivial|aucun conflit|0 conflict/i);
  });

  it('rend chaque résultat dans la section Détail avec son layer', () => {
    const md = formatBumpReport('main', [
      { file: 'docker-server-routes.mjs', layer: 'additive', status: 'clean' },
      { file: 'App.tsx', layer: 'inplace', status: 'fail' },
    ]);
    expect(md).toContain('## Détail');
    expect(md).toMatch(/docker-server-routes\.mjs/);
    expect(md).toMatch(/\(additive\)/);
    expect(md).toMatch(/\(inplace\)/);
  });
});
