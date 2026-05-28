import { describe, it, expect } from 'vitest';
import { METRIC_REGISTRY, rankSuspects } from '../../upstream/docker-server-regression-core.mjs';

describe('METRIC_REGISTRY Phase 2 rows', () => {
  it('has the 4 new metrics with correct directions + attribution', () => {
    expect(METRIC_REGISTRY['ownership.busFactor'].worseDirection).toBe('down');
    expect(METRIC_REGISTRY['ownership.busFactor'].attribution).toBe('window-suspects');
    expect(METRIC_REGISTRY['ownership.topAuthorShare'].worseDirection).toBe('up');
    expect(METRIC_REGISTRY['dissonance.purity'].worseDirection).toBe('down');
    expect(METRIC_REGISTRY['dissonance.purity'].attribution).toBe('window-suspects');
    expect(METRIC_REGISTRY.coupling.worseDirection).toBe('up');
    expect(METRIC_REGISTRY.coupling.attribution).toBe('window-suspects');
  });
  it('keeps entropy metrics on entropy-commits attribution', () => {
    expect(METRIC_REGISTRY.density.attribution).toBe('entropy-commits');
    expect(METRIC_REGISTRY.modularity.attribution).toBe('entropy-commits');
  });
  it('every metric declares a series tag', () => {
    for (const k of Object.keys(METRIC_REGISTRY)) {
      expect(typeof METRIC_REGISTRY[k].series).toBe('string');
    }
  });
});

describe('rankSuspects', () => {
  it('ranks by filesTouched descending', () => {
    const out = rankSuspects([
      { sha: 'a', filesTouched: 2, date: '2026-01-01T00:00:00Z' },
      { sha: 'b', filesTouched: 9, date: '2026-01-02T00:00:00Z' },
      { sha: 'c', filesTouched: 5, date: '2026-01-03T00:00:00Z' },
    ]);
    expect(out.map((c) => c.sha)).toEqual(['b', 'c', 'a']);
  });
  it('breaks ties by most recent date first', () => {
    const out = rankSuspects([
      { sha: 'old', filesTouched: 3, date: '2026-01-01T00:00:00Z' },
      { sha: 'new', filesTouched: 3, date: '2026-01-09T00:00:00Z' },
    ]);
    expect(out[0].sha).toBe('new');
  });
  it('empty array → empty', () => {
    expect(rankSuspects([])).toEqual([]);
  });
});
