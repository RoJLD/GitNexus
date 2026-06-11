import { describe, it, expect } from 'vitest';
import { percentile, normalizePath, makeLatencyRecorder } from '../../upstream/docker-server-metrics.mjs';
describe('percentile', () => {
  it('nearest-rank', () => { const a = [1,2,3,4,5,6,7,8,9,10]; expect(percentile(a,0.5)).toBe(5); expect(percentile(a,0.95)).toBe(10); expect(percentile(a,0.9)).toBe(9); });
  it('empty → 0', () => { expect(percentile([],0.5)).toBe(0); });
});
describe('normalizePath', () => {
  it('collapses to route family', () => {
    expect(normalizePath('/graph/metrics/foo')).toBe('/graph/metrics');
    expect(normalizePath('/graph/metrics/lens/x')).toBe('/graph/metrics');
    expect(normalizePath('/entropy')).toBe('/entropy');
    expect(normalizePath('/repos/by-id/123')).toBe('/repos/by-id');
    expect(normalizePath('/')).toBe('/');
  });
});
describe('makeLatencyRecorder', () => {
  it('records + snapshots monotone percentiles', () => {
    const r = makeLatencyRecorder();
    for (let i = 1; i <= 100; i++) r.record('/x', i);
    const s = r.snapshot();
    expect(s.routes['/x'].count).toBe(100);
    expect(s.routes['/x'].p50).toBeLessThanOrEqual(s.routes['/x'].p95);
    expect(s.routes['/x'].p95).toBeLessThanOrEqual(s.routes['/x'].p99);
    expect(s.routes['/x'].p99).toBeLessThanOrEqual(s.routes['/x'].max);
    expect(s.overall.count).toBe(100);
  });
  it('caps the ring buffer but counts all', () => {
    const r = makeLatencyRecorder({ maxSamplesPerRoute: 10 });
    for (let i = 0; i < 50; i++) r.record('/y', i);
    expect(r.snapshot().routes['/y'].count).toBe(10);
    expect(r.snapshot().overall.count).toBe(50);
  });
});
