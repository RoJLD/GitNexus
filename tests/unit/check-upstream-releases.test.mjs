import { describe, it, expect } from 'vitest';
import {
  parsePinnedVersion,
  parseStableTags,
  cmpSemver,
  compareToLatest,
} from '../../scripts/check-upstream-releases.mjs';

describe('parsePinnedVersion', () => {
  it('extrait la version depuis le FROM de Dockerfile.cli', () => {
    const txt = 'FROM ghcr.io/abhigyanpatwari/gitnexus:1.6.5\nRUN echo hi\n';
    expect(parsePinnedVersion(txt)).toBe('1.6.5');
  });
  it('renvoie null si aucun tag de version trouvé', () => {
    expect(parsePinnedVersion('FROM node:22\n')).toBe(null);
  });
});

describe('parseStableTags', () => {
  it('extrait les tags vX.Y.Z d\'une sortie git ls-remote (ignore rc/ et autres)', () => {
    const out = [
      'abc123\trefs/tags/v1.6.4',
      'def456\trefs/tags/v1.6.5',
      'aaa111\trefs/tags/rc/deadbeef',
      'bbb222\trefs/tags/v1.7.0',
    ].join('\n');
    expect(parseStableTags(out).sort()).toEqual(['v1.6.4', 'v1.6.5', 'v1.7.0']);
  });
  it('ignore les peeled refs `^{}` (annotated tags)', () => {
    const out = [
      'abc123\trefs/tags/v1.7.0',
      'def456\trefs/tags/v1.7.0^{}',
    ].join('\n');
    expect(parseStableTags(out)).toEqual(['v1.7.0']);
  });
});

describe('cmpSemver', () => {
  it('ordonne correctement', () => {
    expect(cmpSemver('v1.6.5', 'v1.6.4')).toBeGreaterThan(0);
    expect(cmpSemver('v1.6.5', 'v1.7.0')).toBeLessThan(0);
    expect(cmpSemver('v1.6.5', 'v1.6.5')).toBe(0);
    expect(cmpSemver('v1.10.0', 'v1.9.0')).toBeGreaterThan(0); // numérique, pas lexical
  });
});

describe('compareToLatest', () => {
  it('à jour quand le pin == la dernière release stable', () => {
    const r = compareToLatest('1.6.5', ['v1.6.4', 'v1.6.5']);
    expect(r.upToDate).toBe(true);
    expect(r.latest).toBe('v1.6.5');
    expect(r.newer).toEqual([]);
  });
  it('signale les releases plus récentes que le pin', () => {
    const r = compareToLatest('1.6.5', ['v1.6.5', 'v1.7.0', 'v1.7.1']);
    expect(r.upToDate).toBe(false);
    expect(r.latest).toBe('v1.7.1');
    expect(r.newer.sort()).toEqual(['v1.7.0', 'v1.7.1']);
  });
  it('pin absent de la liste de tags : pas à jour, newer correct', () => {
    const r = compareToLatest('1.6.5', ['v1.6.4', 'v1.7.0']);
    expect(r.upToDate).toBe(false);
    expect(r.latest).toBe('v1.7.0');
    expect(r.newer).toEqual(['v1.7.0']);
  });
  it('liste de tags vide : PAS à jour (latest null ne doit pas masquer l\'alerte)', () => {
    const r = compareToLatest('1.6.5', []);
    expect(r.latest).toBe(null);
    expect(r.upToDate).toBe(false);
  });
});
