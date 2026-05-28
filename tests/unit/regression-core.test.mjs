import { describe, it, expect } from 'vitest';
import { METRIC_REGISTRY, locateRegression, rankCulprits } from '../../upstream/docker-server-regression-core.mjs';

describe('METRIC_REGISTRY', () => {
  it('density worsens upward, modularity downward', () => {
    expect(METRIC_REGISTRY.density.worseDirection).toBe('up');
    expect(METRIC_REGISTRY.density.series).toBe('entropy:density');
    expect(METRIC_REGISTRY.density.attrField).toBe('attributedDensityDelta');
    expect(METRIC_REGISTRY.modularity.worseDirection).toBe('down');
    expect(METRIC_REGISTRY.modularity.series).toBe('entropy:modularity');
    expect(METRIC_REGISTRY.modularity.attrField).toBe('attributedModularityDelta');
  });
});

describe('locateRegression', () => {
  const s = (vals) => vals.map((v, i) => ({ name: `s${i}`, date: `2026-01-0${i + 1}T00:00:00Z`, value: v }));

  it('density worsening (rising) → regressed, worstPair = steepest rise', () => {
    const r = locateRegression(s([0.10, 0.12, 0.30, 0.31]), 'up');
    expect(r.regressed).toBe(true);
    expect(r.netDelta).toBeCloseTo(0.21, 6);
    expect(r.stepDelta).toBeCloseTo(0.18, 6);
    expect(r.worstPair[0].value).toBeCloseTo(0.12, 6);
    expect(r.worstPair[1].value).toBeCloseTo(0.30, 6);
  });

  it('density improving (falling) → not regressed', () => {
    const r = locateRegression(s([0.30, 0.20, 0.10]), 'up');
    expect(r.regressed).toBe(false);
  });

  it('modularity worsening (falling) → regressed (worseDirection down)', () => {
    const r = locateRegression(s([0.80, 0.79, 0.50]), 'down');
    expect(r.regressed).toBe(true);
    expect(r.stepDelta).toBeCloseTo(0.29, 6);
  });

  it('flat series → not regressed', () => {
    expect(locateRegression(s([0.5, 0.5, 0.5]), 'up').regressed).toBe(false);
  });

  it('skips null/NaN values', () => {
    const series = [{ value: 0.1 }, { value: null }, { value: 0.4 }];
    const r = locateRegression(series, 'up');
    expect(r.regressed).toBe(true);
    expect(r.netDelta).toBeCloseTo(0.3, 6);
  });

  it('fewer than 2 valid points → not regressed, worstPair null', () => {
    const r = locateRegression([{ value: 0.5 }], 'up');
    expect(r.regressed).toBe(false);
    expect(r.worstPair).toBeNull();
  });
});

describe('rankCulprits', () => {
  const commits = [
    { sha: 'a', attributedDensityDelta: 0.05 },
    { sha: 'b', attributedDensityDelta: 0.20 },
    { sha: 'c', attributedDensityDelta: -0.10 },
  ];
  it('density (up): worst = biggest positive delta first', () => {
    const ranked = rankCulprits(commits, 'attributedDensityDelta', 'up');
    expect(ranked.map((c) => c.sha)).toEqual(['b', 'a', 'c']);
  });
  it('modularity (down): worst = most negative delta first', () => {
    const mc = [
      { sha: 'a', attributedModularityDelta: 0.05 },
      { sha: 'b', attributedModularityDelta: -0.20 },
      { sha: 'c', attributedModularityDelta: -0.01 },
    ];
    const ranked = rankCulprits(mc, 'attributedModularityDelta', 'down');
    expect(ranked.map((c) => c.sha)).toEqual(['b', 'c', 'a']);
  });
  it('empty array → empty', () => {
    expect(rankCulprits([], 'attributedDensityDelta', 'up')).toEqual([]);
  });
});
