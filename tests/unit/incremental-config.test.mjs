import { describe, it, expect } from 'vitest';
import { parseIncrementalConfig } from '../../upstream/docker-server-config.mjs';

describe('parseIncrementalConfig', () => {
  it('defaults to disabled + 50 + perTick 10 when absent', () => {
    expect(parseIncrementalConfig({})).toEqual({ preWarm: false, preWarmCommits: 50, preWarmPerTick: 10 });
    expect(parseIncrementalConfig(undefined)).toEqual({ preWarm: false, preWarmCommits: 50, preWarmPerTick: 10 });
  });
  it('reads preWarm + clamps preWarmCommits to [1,500]', () => {
    expect(parseIncrementalConfig({ incremental: { preWarm: true, preWarmCommits: 9999 } })).toMatchObject({ preWarm: true, preWarmCommits: 500 });
    expect(parseIncrementalConfig({ incremental: { preWarm: true, preWarmCommits: 0 } })).toMatchObject({ preWarm: true, preWarmCommits: 1 });
    expect(parseIncrementalConfig({ incremental: { preWarm: true, preWarmCommits: 30 } })).toMatchObject({ preWarm: true, preWarmCommits: 30 });
  });
  it('clamps preWarmPerTick to [1,100], default 10', () => {
    expect(parseIncrementalConfig({ incremental: { preWarmPerTick: 999 } }).preWarmPerTick).toBe(100);
    expect(parseIncrementalConfig({ incremental: { preWarmPerTick: 0 } }).preWarmPerTick).toBe(1);
    expect(parseIncrementalConfig({ incremental: { preWarmPerTick: 25 } }).preWarmPerTick).toBe(25);
  });
});
