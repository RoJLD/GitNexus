import { describe, it, expect } from 'vitest';
import { deriveId, extractTitle } from '../../scripts/ghost-from-spec-parser.mjs';

describe('deriveId', () => {
  it('strips the "-design" / "-spec" suffix and date prefix to make a stable id', () => {
    expect(deriveId('2026-05-26-roadmap-predictive-audit-design.md'))
      .toBe('spec-2026-05-26-roadmap-predictive-audit');
    expect(deriveId('2026-06-01-foo-spec.md'))
      .toBe('spec-2026-06-01-foo');
    expect(deriveId('docs/superpowers/specs/2026-07-15-bar-design.md'))
      .toBe('spec-2026-07-15-bar');
  });

  it('keeps non-standard filenames as-is (without -design/-spec)', () => {
    expect(deriveId('foo.md')).toBe('spec-foo');
  });
});

describe('extractTitle', () => {
  it('returns the first H1 line, stripped of trailing "design"/"spec"', () => {
    const md = '# Roadmap Predictive — Audit view design\n\nbody\n';
    expect(extractTitle(md)).toBe('Roadmap Predictive — Audit view');
  });

  it('falls back to "(untitled spec)" if no H1', () => {
    expect(extractTitle('no header here')).toBe('(untitled spec)');
  });

  it('handles H1 with trailing emojis and whitespace', () => {
    expect(extractTitle('# My feature ✅  \n')).toBe('My feature ✅');
  });
});
