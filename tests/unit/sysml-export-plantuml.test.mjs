import { describe, it, expect } from 'vitest';
import { renderPlantUml, safeId } from '../../upstream/docker-server-sysml-export-core.mjs';

describe('safeId', () => {
  it('replaces non-alphanumeric chars with underscore', () => {
    expect(safeId('src/auth/login.ts')).toBe('src_auth_login_ts');
    expect(safeId('WhatIf-Panel.tsx')).toBe('WhatIf_Panel_tsx');
  });
  it('collapses runs of non-alphanumeric', () => {
    expect(safeId('a//b')).toBe('a_b');
  });
});

describe('renderPlantUml', () => {
  it('emits empty diagram when no ghosts', () => {
    const out = renderPlantUml({ ghosts: [], files: [], repoName: 'x' });
    expect(out).toContain('@startuml');
    expect(out).toContain('@enduml');
    expect(out).toContain('title gitnexus');
    expect(out).toContain('x');
  });

  it('emits requirement for each planned ghost', () => {
    const out = renderPlantUml({
      ghosts: [{
        id: 'tier-2-3-x', declared: { title: 'X' }, status: 'planned', tier: '2.3',
        links: [], plannedAt: { date: '2026-01-01' },
      }],
      files: [], repoName: 'r',
    });
    expect(out).toMatch(/requirement\s+"X"\s+as\s+R_/);
  });

  it('emits block for each file', () => {
    const out = renderPlantUml({
      ghosts: [], files: ['src/auth/login.ts'], repoName: 'r',
    });
    expect(out).toMatch(/block\s+"src\/auth\/login\.ts"\s+as\s+B_src_auth_login_ts/);
  });

  it('emits satisfy edge for matched ghost link', () => {
    const out = renderPlantUml({
      ghosts: [{
        id: 'g1', declared: { title: 'G' }, status: 'planned', tier: '1.1',
        links: [{ file: 'src/auth/login.ts' }],
      }],
      files: ['src/auth/login.ts'], repoName: 'r',
    });
    expect(out).toMatch(/R_g1\s*\.\.>\s*B_src_auth_login_ts\s*:\s*<<satisfy>>/);
  });

  it('wraps ghosts in tier packages', () => {
    const out = renderPlantUml({
      ghosts: [
        { id: 'a', declared: { title: 'A' }, status: 'planned', tier: '1.2', links: [] },
        { id: 'b', declared: { title: 'B' }, status: 'planned', tier: '2.3', links: [] },
      ],
      files: [], repoName: 'r',
    });
    expect(out).toMatch(/package\s+"Tier 1"/);
    expect(out).toMatch(/package\s+"Tier 2"/);
  });

  it('omits cancelled and materialized ghosts', () => {
    const out = renderPlantUml({
      ghosts: [
        { id: 'a', declared: { title: 'A' }, status: 'cancelled', tier: '1', links: [] },
        { id: 'b', declared: { title: 'B' }, status: 'materialized', tier: '1', links: [] },
      ],
      files: [], repoName: 'r',
    });
    expect(out).not.toContain('R_a');
    expect(out).not.toContain('R_b');
  });

  it('emits deriveReqt edge for dependsOn', () => {
    const out = renderPlantUml({
      ghosts: [
        { id: 'a', declared: { title: 'A' }, status: 'planned', tier: '1', links: [], dependsOn: ['b'] },
        { id: 'b', declared: { title: 'B' }, status: 'planned', tier: '1', links: [] },
      ],
      files: [], repoName: 'r',
    });
    expect(out).toMatch(/R_a\s*\.\.>\s*R_b\s*:\s*<<deriveReqt>>/);
  });

  it('filters by tier when tierFilter set', () => {
    const out = renderPlantUml({
      ghosts: [
        { id: 'a', declared: { title: 'A' }, status: 'planned', tier: '1.2', links: [] },
        { id: 'b', declared: { title: 'B' }, status: 'planned', tier: '2.3', links: [] },
      ],
      files: [], repoName: 'r', tierFilter: '1',
    });
    expect(out).toContain('R_a');
    expect(out).not.toContain('R_b');
  });
});
