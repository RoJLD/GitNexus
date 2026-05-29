import { describe, it, expect } from 'vitest';
import { parseIncrementalConfig } from '../../upstream/docker-server-config.mjs';

describe('parseIncrementalConfig', () => {
  it('defaults to disabled + 50 when absent', () => {
    expect(parseIncrementalConfig({})).toEqual({ preWarm: false, preWarmCommits: 50 });
    expect(parseIncrementalConfig(undefined)).toEqual({ preWarm: false, preWarmCommits: 50 });
  });
  it('reads preWarm + clamps preWarmCommits to [1,500]', () => {
    expect(parseIncrementalConfig({ incremental: { preWarm: true, preWarmCommits: 9999 } })).toEqual({ preWarm: true, preWarmCommits: 500 });
    expect(parseIncrementalConfig({ incremental: { preWarm: true, preWarmCommits: 0 } })).toEqual({ preWarm: true, preWarmCommits: 1 });
    expect(parseIncrementalConfig({ incremental: { preWarm: true, preWarmCommits: 30 } })).toEqual({ preWarm: true, preWarmCommits: 30 });
  });
});
