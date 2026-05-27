import { describe, it, expect } from 'vitest';
import {
  deriveId,
  extractTitle,
  extractDescription,
  extractTier,
  extractExpectedLinks,
  parseSpec,
} from '../../scripts/ghost-from-spec-parser.mjs';

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

describe('extractDescription', () => {
  const sample = [
    '# Title', '', '## 1. Context', 'before goal', '',
    '## 2. Goal', '', 'This is the goal paragraph that explains what we build.',
    'It can span multiple lines but only the first non-blank paragraph counts.', '',
    '## 3. Design', 'rest...',
  ].join('\n');

  it('extracts the first paragraph after "## 2. Goal"', () => {
    const out = extractDescription(sample);
    expect(out).toContain('the goal paragraph');
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it('truncates long descriptions to 200 chars', () => {
    const long = '# T\n## 2. Goal\n\n' + 'x'.repeat(500);
    expect(extractDescription(long).length).toBeLessThanOrEqual(200);
  });

  it('returns empty string when there is no Goal section', () => {
    expect(extractDescription('# T\n\nbody\n')).toBe('');
  });
});

describe('extractTier', () => {
  it('finds the first Tier X.Y mention in the body', () => {
    expect(extractTier('# T\n\nThis is Tier 2.3 stuff.')).toBe('2.3');
    expect(extractTier('# T\n\nrelated to tier 1 (Tier 1.4)')).toBe('1.4');
  });

  it('returns null if no Tier mention', () => {
    expect(extractTier('# T\n\nNo tier here.')).toBeNull();
  });

  it('matches multi-segment tiers', () => {
    expect(extractTier('# T\n\nTier 2.5.b stuff')).toBe('2.5'); // major.minor only
  });
});

describe('extractExpectedLinks', () => {
  it('extracts backticked tokens that look like paths from the Design section', () => {
    const md = '# T\n\n## 3. Design\n\nUses `services/foo.ts` and `Button.tsx` and `docker-server-bar.mjs`.';
    const out = extractExpectedLinks(md);
    expect(out).toContainEqual({ kind: 'path', value: 'services/foo.ts' });
    expect(out).toContainEqual({ kind: 'path', value: 'Button.tsx' });
    expect(out).toContainEqual({ kind: 'path', value: 'docker-server-bar.mjs' });
  });

  it('marks single-word backticked tokens (no slash, no extension) as label kind', () => {
    const md = '# T\n\n## 3. Design\n\n`repoId` is interesting and so is `WatchSpec`.';
    const out = extractExpectedLinks(md);
    expect(out).toContainEqual({ kind: 'label', value: 'repoId' });
    expect(out).toContainEqual({ kind: 'label', value: 'WatchSpec' });
  });

  it('returns empty array if no Design section', () => {
    expect(extractExpectedLinks('# T\n\nbody')).toEqual([]);
  });

  // --- Negative tests for the tightened heuristic (2026-05-27) ---

  it('rejects query-string fragments starting with ?', () => {
    const md = '# T\n\n## 3. Design\n\nCall it with `?format=mermaid` or `?includeEdges=imports,calls`.';
    const out = extractExpectedLinks(md);
    expect(out.map(o => o.value)).not.toContain('?format=mermaid');
    expect(out.map(o => o.value)).not.toContain('?includeEdges=imports,calls');
  });

  it('rejects endpoint paths (leading / with no file extension)', () => {
    const md = '# T\n\n## 3. Design\n\nHit `/ghosts` then `/ghosts/sync`. But `/scripts/foo.mjs` is a real file.';
    const out = extractExpectedLinks(md);
    const values = out.map(o => o.value);
    expect(values).not.toContain('/ghosts');
    expect(values).not.toContain('/ghosts/sync');
    expect(values).toContain('/scripts/foo.mjs');
  });

  it('rejects tokens with whitespace or shell metacharacters', () => {
    const md = '# T\n\n## 3. Design\n\nRun `curl > out.puml` and `cat foo | jq` and `$VAR`.';
    const out = extractExpectedLinks(md);
    const values = out.map(o => o.value);
    expect(values).not.toContain('curl > out.puml');
    expect(values).not.toContain('cat foo | jq');
    expect(values).not.toContain('$VAR');
  });

  it('rejects pure punctuation / single-char tokens', () => {
    const md = '# T\n\n## 3. Design\n\nSee `-` and `/` and `.`.';
    const out = extractExpectedLinks(md);
    expect(out).toEqual([]);
  });
});

describe('parseSpec (integration)', () => {
  const md = [
    '# Roadmap Predictive — Audit view design',
    '## 1. Context', 'before',
    '## 2. Goal',
    '',
    'Build the audit view to track Tier 2.3 ghosts.',
    '',
    '## 3. Design',
    '',
    'Uses `services/foo.ts` and `Button.tsx`.',
  ].join('\n');

  it('returns a fully-populated ghost object', () => {
    const ghost = parseSpec('docs/superpowers/specs/2026-05-26-audit-design.md', md);
    expect(ghost).toMatchObject({
      id: 'spec-2026-05-26-audit',
      title: 'Roadmap Predictive — Audit view',
      description: expect.stringContaining('Build the audit view'),
      tier: '2.3',
      status: 'planned',
      expectedLinks: expect.arrayContaining([
        { kind: 'path', value: 'services/foo.ts' },
        { kind: 'path', value: 'Button.tsx' },
      ]),
    });
  });
});
