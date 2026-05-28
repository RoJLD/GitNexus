import { describe, it, expect } from 'vitest';
import { shouldReindex } from '../../upstream/docker-server-auto-reindex.mjs';

describe('shouldReindex', () => {
  it('false when disabled', () => {
    expect(shouldReindex({ enabled: false, currentSha: 'abc', lastSha: 'def' })).toBe(false);
  });
  it('false when currentSha is null (not a git repo / rev-parse failed)', () => {
    expect(shouldReindex({ enabled: true, currentSha: null, lastSha: 'def' })).toBe(false);
  });
  it('false on first sight (lastSha null) — record baseline, do not trigger', () => {
    expect(shouldReindex({ enabled: true, currentSha: 'abc', lastSha: null })).toBe(false);
    expect(shouldReindex({ enabled: true, currentSha: 'abc', lastSha: undefined })).toBe(false);
  });
  it('false when sha unchanged', () => {
    expect(shouldReindex({ enabled: true, currentSha: 'abc', lastSha: 'abc' })).toBe(false);
  });
  it('true when enabled and sha changed', () => {
    expect(shouldReindex({ enabled: true, currentSha: 'abc', lastSha: 'def' })).toBe(true);
  });
});
