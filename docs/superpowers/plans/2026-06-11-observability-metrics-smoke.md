# Observability — /metrics + smoke harness — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-11-observability-metrics-smoke-design.md`.

**Goal:** a `/metrics` endpoint (per-route latency p50/p95/p99 + cache stats) + a standalone `scripts/smoke.mjs` harness. Boot-crash discipline: the new `docker-server-metrics.mjs` needs a Dockerfile.web COPY + registration.

**Verification:** `cd tests && npx vitest run --config vitest.config.unit.mjs metrics-recorder graph-theory-cache`; module-import check; patch regen + drift. No web build (backend .mjs).

### Task 1: `docker-server-metrics.mjs` (recorder + route) + cache stats + tests
**Files:** create `upstream/docker-server-metrics.mjs`; modify `upstream/docker-server-graph-theory.mjs` (cache stats); create `tests/unit/metrics-recorder.test.mjs`; extend `tests/unit/graph-theory-cache.test.mjs`.

`docker-server-metrics.mjs` (zero-dep):
```js
export function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const q = Math.max(0, Math.min(1, p));
  const idx = Math.min(sortedAsc.length - 1, Math.ceil(q * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, idx)];
}
export function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  const segs = pathname.split('/').filter(Boolean);
  return '/' + segs.slice(0, 2).join('/');
}
export function makeLatencyRecorder({ maxSamplesPerRoute = 500 } = {}) {
  const buf = new Map();   // routeKey -> number[]
  let total = 0;
  return {
    record(routeKey, ms) {
      let a = buf.get(routeKey); if (!a) { a = []; buf.set(routeKey, a); }
      a.push(ms); if (a.length > maxSamplesPerRoute) a.shift();
      total++;
    },
    snapshot() {
      const routes = {}; const all = [];
      for (const [k, a] of buf) {
        const s = [...a].sort((x, y) => x - y); all.push(...s);
        routes[k] = { count: a.length, p50: percentile(s, 0.5), p95: percentile(s, 0.95), p99: percentile(s, 0.99), max: s.length ? s[s.length - 1] : 0 };
      }
      const sa = all.sort((x, y) => x - y);
      return { routes, overall: { count: total, p50: percentile(sa, 0.5), p95: percentile(sa, 0.95), p99: percentile(sa, 0.99) } };
    },
  };
}
export const recorder = makeLatencyRecorder();

import { metricsCacheStats } from './docker-server-graph-theory.mjs';
function sendJson(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
export async function handleMetricsRoute(req, url, res) {
  if (url.pathname !== '/metrics' || req.method !== 'GET') return false;
  let caches = {}; try { caches = { graphMetrics: metricsCacheStats() }; } catch {}
  sendJson(res, 200, { latency: recorder.snapshot(), caches });
  return true;
}
```
(If importing `metricsCacheStats` from graph-theory.mjs creates a cycle with the recorder, import lazily inside the handler via `await import('./docker-server-graph-theory.mjs')`. Verify no cycle.)

`docker-server-graph-theory.mjs`: in `makeMetricsCache`, add `let hits = 0, misses = 0;`, bump `misses++` on the two miss/expire returns + `hits++` on the hit return, add `stats() { return { hits, misses, hitRate: hits + misses ? hits / (hits + misses) : 0 }; }` to the returned object. Add `export function metricsCacheStats() { return metricsCache.stats(); }`.

- [ ] **Step 1: tests first.** `tests/unit/metrics-recorder.test.mjs`:
```js
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
  it('caps the ring buffer', () => {
    const r = makeLatencyRecorder({ maxSamplesPerRoute: 10 });
    for (let i = 0; i < 50; i++) r.record('/y', i);
    expect(r.snapshot().routes['/y'].count).toBe(10);
    expect(r.snapshot().overall.count).toBe(50);   // total counts all
  });
});
```
Extend `graph-theory-cache.test.mjs` with a `stats()` case (set+get hit → hits 1; get missing → misses 1; hitRate 0.5).
- [ ] **Step 2: run, FAIL.** **Step 3: implement** the module + cache stats. **Step 4: run, PASS** (`metrics-recorder graph-theory-cache`). Verify no import cycle (`node -e "import('./upstream/docker-server-metrics.mjs').then(m=>console.log(Object.keys(m)))"` from repo root → prints exports, no error). **Step 5:** report.

### Task 2: wiring + smoke harness + CI
**Files:** modify `upstream/docker-server.mjs` (instrument dispatch), `upstream/docker-server-routes.mjs` (register handleMetricsRoute first), `upstream/Dockerfile.web` (COPY), create `scripts/smoke.mjs`, modify `.github/workflows/test.yml` (boot-smoke /metrics assert).
- **docker-server.mjs**: import `{ recorder, normalizePath }` from `./docker-server-metrics.mjs`; wrap the `registerGitnexusRoutes` call per spec §3.3 (time + record on claimed, `try/catch`).
- **docker-server-routes.mjs**: `import { handleMetricsRoute }` + dispatch it FIRST in `registerGitnexusRoutes`.
- **Dockerfile.web**: add `COPY docker-server-metrics.mjs ./docker-server-metrics.mjs` near the other docker-server-*.mjs COPYs.
- **scripts/smoke.mjs**: `node scripts/smoke.mjs [baseUrl=http://localhost:4173]` — a checklist of `{path, assert?}` (`/graph/templates`→body includes 'imports-deps'; `/metrics`→body has `latency`&`caches`; `/graph/list`→200). Uses global `fetch`; prints ✓/✗ per check; `process.exit(failures ? 1 : 0)`. Zero-dep, ESM.
- **test.yml boot-smoke**: after the existing asserts, `curl -fsS http://localhost:4173/metrics | grep -q '"latency"'` (or invoke `node scripts/smoke.mjs http://localhost:4173`).
- [ ] **Step 1: implement** all wiring + the harness. **Step 2: self-review** (instrumentation try/catch; route registered first; COPY added; harness exits non-zero on failure). **Step 3:** report. (Boot verification is the controller's: patch regen + drift; the boot-smoke CI guard catches a missing COPY; a live boot is deferred — dev stack holds the ports.)

### Post-build (controller)
1. `metrics-recorder` + `graph-theory-cache` unit green; module-import check clean.
2. Regen patches + drift → exit 0.
3. Commit + push `deployment`; update ROADMAP ("Optimisations": Perf instrumentation + Smoke ✅) + INVENTORY + memory.
