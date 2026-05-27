import { describe, it, expect } from 'vitest';
import { parseClusters } from '../../upstream/docker-server-ghosts-core.mjs';

describe('parseClusters', () => {
  const md = [
    '## 🔗 Clusters',
    '',
    '### Auth overhaul',
    '**ExpectedBy** : 2026-Q3',
    '**Members** : tier-1-1-login, tier-1-2-session, tier-2-3-mfa',
    '**Status** : planned',
    '',
    '### DB migration',
    '**Members** : tier-1-1-orphan, tier-2-2-rollback',
    '',
  ].join('\n');

  it('extracts declared clusters with all fields', () => {
    const out = parseClusters(md);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: 'auth-overhaul',
      source: 'declared',
      title: 'Auth overhaul',
      expectedBy: '2026-Q3',
      memberIds: ['tier-1-1-login', 'tier-1-2-session', 'tier-2-3-mfa'],
      declaredStatus: 'planned',
    });
    expect(out[1]).toMatchObject({
      id: 'db-migration',
      title: 'DB migration',
      memberIds: ['tier-1-1-orphan', 'tier-2-2-rollback'],
      expectedBy: null,
      declaredStatus: null,
    });
  });

  it('returns [] when no section', () => {
    expect(parseClusters('# foo\n')).toEqual([]);
  });

  it('returns [] when section empty', () => {
    expect(parseClusters('## 🔗 Clusters\n\n## other\n')).toEqual([]);
  });

  it('handles missing Members line as 0 members', () => {
    const md = '## 🔗 Clusters\n\n### empty\n**ExpectedBy** : 2026-Q1\n';
    const out = parseClusters(md);
    expect(out[0].memberIds).toEqual([]);
  });
});
