import { describe, it, expect } from 'vitest';
import { mapWatchToRegressionMetric, buildWebhookPayload } from '../../upstream/docker-server-watches.mjs';

describe('mapWatchToRegressionMetric', () => {
  it('strips entropy. prefix for density/modularity', () => {
    expect(mapWatchToRegressionMetric('entropy.density')).toBe('density');
    expect(mapWatchToRegressionMetric('entropy.modularity')).toBe('modularity');
  });
  it('maps ownership/dissonance metrics to themselves', () => {
    expect(mapWatchToRegressionMetric('ownership.busFactor')).toBe('ownership.busFactor');
    expect(mapWatchToRegressionMetric('ownership.topAuthorShare')).toBe('ownership.topAuthorShare');
    expect(mapWatchToRegressionMetric('dissonance.purity')).toBe('dissonance.purity');
  });
  it('maps coupling to itself (Tier 60)', () => {
    expect(mapWatchToRegressionMetric('coupling')).toBe('coupling');
  });
  it('returns null for genuinely unknown metrics', () => {
    expect(mapWatchToRegressionMetric('something.custom')).toBeNull();
  });
});

describe('buildWebhookPayload', () => {
  const watch = { metric: 'entropy.density', op: '>', threshold: 0.5 };

  it('without regression: base payload, no culprit line, no regression field', () => {
    const p = buildWebhookPayload('hmm_studio', watch, 0.6, null);
    expect(p.repoBase).toBe('hmm_studio');
    expect(p.metric).toBe('entropy.density');
    expect(p.currentValue).toBe(0.6);
    expect(typeof p.text).toBe('string');
    expect(p.text).not.toMatch(/culprit/i);
    expect('regression' in p).toBe(false);
  });

  it('with regression + worstCommit: regression field + culprit line in text', () => {
    const regression = {
      attribution: 'attributed',
      worstCommit: { sha: 'a8f3c2dXYZ', shortSha: 'a8f3c2d', author: 'Marie', filesTouched: 4 },
    };
    const p = buildWebhookPayload('hmm_studio', watch, 0.6, regression);
    expect(p.regression).toBe(regression);
    expect(p.text).toMatch(/Likely culprit: a8f3c2d by Marie \(4 files\) \[attributed\]/);
  });

  it('with regression but worstCommit null: regression field present, no culprit line', () => {
    const regression = { attribution: 'suspects', worstCommit: null };
    const p = buildWebhookPayload('hmm_studio', watch, 0.6, regression);
    expect(p.regression).toBe(regression);
    expect(p.text).not.toMatch(/culprit/i);
  });

  it('falls back to files[].length when filesTouched absent', () => {
    const regression = { attribution: 'suspects', worstCommit: { sha: 'deadbeefcafe', author: 'Bob', files: [{ path: 'a' }, { path: 'b' }] } };
    const p = buildWebhookPayload('hmm_studio', watch, 0.6, regression);
    expect(p.text).toMatch(/Likely culprit: deadbee by Bob \(2 files\) \[suspects\]/);
  });
});
