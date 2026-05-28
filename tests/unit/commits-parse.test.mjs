import { describe, it, expect } from 'vitest';
import { parseCommitLines, isSafeRef } from '../../upstream/docker-server-commits.mjs';

describe('parseCommitLines', () => {
  it('parses \\0-delimited git log lines into commit objects', () => {
    const line = ['abc123full', 'abc123', 'feat: x', 'Alice', 'a@t', '2025-01-01T10:00:00+01:00', 'parentsha'].join('\0');
    const out = parseCommitLines(line + '\n');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      hash: 'abc123full', shortHash: 'abc123', message: 'feat: x',
      author: 'Alice', email: 'a@t', date: '2025-01-01T10:00:00+01:00', parent: 'parentsha',
    });
  });

  it('treats empty parent as null and skips blank lines', () => {
    const line = ['h', 's', 'm', 'a', 'e', 'd', ''].join('\0');
    const out = parseCommitLines('\n' + line + '\n\n');
    expect(out).toHaveLength(1);
    expect(out[0].parent).toBeNull();
  });
});

describe('isSafeRef', () => {
  it('accepts shas, branch names, HEAD~n', () => {
    expect(isSafeRef('HEAD')).toBe(true);
    expect(isSafeRef('a1b2c3d')).toBe(true);
    expect(isSafeRef('HEAD~3')).toBe(true);
    expect(isSafeRef('origin/main')).toBe(true);
  });
  it('rejects option-like and junk refs', () => {
    expect(isSafeRef('--all')).toBe(false);
    expect(isSafeRef('')).toBe(false);
    expect(isSafeRef('a; rm -rf /')).toBe(false);
    expect(isSafeRef(null)).toBe(false);
  });
  it('rejects range syntax (we want a single ref, not a range)', () => {
    expect(isSafeRef('HEAD~5..main')).toBe(false);
    expect(isSafeRef('main...origin/main')).toBe(false);
  });
});
