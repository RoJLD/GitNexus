# Observability — /metrics perf endpoint + smoke harness

**Date**: 2026-06-11
**Status**: current
**Roadmap**: "Optimisations d'existant" → **Perf instrumentation** (`/metrics`: latences
p50/p95/p99 par endpoint + cache hits) + **Smoke tests** (harness `curl + assert`). The
project's CLAUDE.md notes "no test suite, manual curl"; a `boot-smoke` CI job exists
(`.github/workflows/test.yml`) but only curls `/graph/templates`.

## 1. Context / problem

There is **no product observability**: no per-endpoint latency, no SLO signal, no
cache-hit visibility, and no runnable smoke check (only the CI boot job). When an endpoint
regresses or slows, there's nothing to diagnose with. Two pieces close this: a `/metrics`
endpoint exposing per-route latency percentiles + cache stats, and a standalone
`curl+assert` smoke harness runnable locally + in CI.

## 2. Goal

`GET /metrics` returns, per route family, `{count, p50, p95, p99, max}` latencies (ms) +
overall + cache hit/miss/hitRate; a `scripts/smoke.mjs` boots-agnostic harness curls a list
of key endpoints against a base URL and asserts HTTP 200 + minimal structure (exit ≠ 0 on
any failure). Success: after a stack boots, `curl /metrics` shows accumulating per-route
latencies + the graph-metrics cache hit rate; `node scripts/smoke.mjs` exits 0 green.

## 3. Design

### 3.1 Pure recorder + helpers — `docker-server-metrics.mjs` (new, zero-dep, host-testable)

A single new route module (so one Dockerfile.web COPY line + one registration). Exports
pure, host-testable building blocks + the route handler + a module singleton:

- `percentile(sortedAsc: number[], p: number): number` — nearest-rank on a pre-sorted array
  (empty → 0; clamps p to [0,1]).
- `normalizePath(pathname: string): string` — collapse a request path to its **route
  family** so cardinality stays bounded: keep the first two segments, drop the rest
  (`/graph/metrics/foo` → `/graph/metrics`, `/graph/metrics/lens/x` → `/graph/metrics`,
  `/entropy` → `/entropy`, `/repos/by-id/123` → `/repos/by-id`). `/` → `/`.
- `makeLatencyRecorder({ maxSamplesPerRoute = 500 } = {})` → `{ record(routeKey, ms),
  snapshot() }`. `record` pushes `ms` into a bounded ring buffer per `routeKey` (drop oldest
  past `maxSamplesPerRoute`) + bumps a per-route count + total count. `snapshot()` returns
  `{ routes: { [key]: { count, p50, p95, p99, max } }, overall: { count, p50, p95, p99 },
  uptimeMs? }` (percentiles computed from a sorted copy of each buffer; overall from the
  merged buffers or a separate overall buffer). Pure (no IO); `record` is O(1) amortized.
- A module **singleton** `recorder = makeLatencyRecorder()` exported for the dispatch
  instrumentation to call.
- `handleMetricsRoute(req, url, res)` — `GET /metrics` → `sendJson(200, { latency:
  recorder.snapshot(), caches: { graphMetrics: metricsCacheStats() } })`. Returns `false`
  for non-matching (so the dispatch chain continues).

Because timestamps would break determinism only if persisted, `record` takes the elapsed
`ms` (computed by the caller via `performance.now()`), not a clock — the recorder is pure.

### 3.2 Cache stats — `docker-server-graph-theory.mjs`

`makeMetricsCache` gains internal `hits`/`misses` counters (bumped in `get`) + a
`stats()` method `{ hits, misses, hitRate }` (hitRate = hits/(hits+misses) or 0). Export a
`metricsCacheStats()` that returns the singleton `metricsCache.stats()`. Additive — the
cache's get/set behavior is otherwise unchanged (the existing cache tests still pass; add a
hits/misses assertion).

### 3.3 Dispatch instrumentation — `docker-server.mjs`

At the `registerGitnexusRoutes` call site: time it and record when a route is claimed:
```js
const _t0 = performance.now();
const claimed = await registerGitnexusRoutes(req, reqUrl, res, ctx);
if (claimed) { try { recorder.record(normalizePath(reqUrl.pathname), performance.now() - _t0); } catch {} return; }
```
(`recorder`/`normalizePath` imported from `./docker-server-metrics.mjs`; `performance` is a
Node global.) The `try/catch` guarantees instrumentation never breaks a request. `/metrics`
is itself a claimed route → it self-reports (fine; trivial latency).

### 3.4 Registration + Dockerfile

- `docker-server-routes.mjs`: `import { handleMetricsRoute } from './docker-server-metrics.mjs';`
  and dispatch it **first** in `registerGitnexusRoutes` (cheap, no body).
- `upstream/Dockerfile.web`: add `COPY docker-server-metrics.mjs ./docker-server-metrics.mjs`
  to the per-file COPY list (**boot-crash discipline** — a missing COPY crash-loops the web
  container; the `boot-smoke` CI guard catches it). One file → one COPY line.

### 3.5 Smoke harness — `scripts/smoke.mjs` (standalone, zero-dep)

A Node script (uses global `fetch`): `node scripts/smoke.mjs [baseUrl]` (default
`http://localhost:4173`). A checklist of `{ path, expectStatus = 200, assert?(body) }` for
key endpoints (`/graph/templates` → contains `imports-deps`; `/metrics` → has
`latency`+`caches`; `/graph/list`; a couple of analytics that don't need a repo, or are
skipped gracefully on 404). Prints a ✓/✗ table; **exits 1** if any check fails. Runnable
locally against a booted stack + reusable from CI. It does NOT boot the stack (the caller
does) — pure curl+assert.

### 3.6 CI — extend boot-smoke

`.github/workflows/test.yml` boot-smoke: after the `/graph/templates` assertions, add a
`/metrics` curl asserting the JSON has `latency` + `caches` keys (proves the new module
loaded). Optionally invoke `node scripts/smoke.mjs http://localhost:4173` as the assert step
(DRY — the harness replaces the inline asserts).

## 4. Verification

- **Unit (host-native vitest)** — `metrics-recorder.test.mjs` importing from
  `docker-server-metrics.mjs`: `percentile` (nearest-rank on a known array; empty → 0);
  `normalizePath` (the family-collapsing cases above); `makeLatencyRecorder` (record N
  samples → snapshot counts + monotonic p50≤p95≤p99≤max; ring buffer caps at
  maxSamplesPerRoute; overall aggregates). Cache `stats()` test in the existing cache test
  file (hits/misses/hitRate after get hit + miss).
- **Module-import check** (boot-crash partial): `node -e "import('…/docker-server-metrics.mjs').then(m=>…)"`
  confirms the new module imports cleanly (no syntax/dep error).
- **Smoke harness self-test**: the harness is the verification *tool*; running it requires a
  booted stack — the dev stack holds the ports, so a full live run is **best-effort/deferred**
  (the CI boot-smoke exercises it). Confirm the script parses + a dry structure check.
- **Patch regen + drift** for the `upstream/` changes (docker-server.mjs, -routes.mjs,
  -graph-theory.mjs are inplace; -metrics.mjs additive; Dockerfile.web inplace). No web build
  (backend .mjs, not tsc).

## 5. Scope boundaries

**In scope**: the `/metrics` endpoint (per-route latency percentiles + graph-metrics cache
stats), the pure recorder + helpers, the dispatch instrumentation, the standalone smoke
harness, the boot-smoke CI extension.

**Out of scope (deferred)**:
- **More cache stats** (only the graph-metrics cache exposes stats in v1; other caches/
  fetchers can register later — the snapshot shape allows adding keys under `caches`).
- **Persistent / time-series metrics** (Prometheus exposition format, scraping) — v1 is an
  in-memory JSON snapshot since process start.
- **Per-handler attribution** (the recorder keys by normalized path, not by which handler
  claimed it — sufficient for route-family latency).
- **Request counts by status / error rates** — latency + cache only for v1.
- **ETag/HTTP cache** (a separate roadmap "Optimisations" item).

## 6. Open questions

- **maxSamplesPerRoute (500).** Bounds memory + keeps percentiles representative of recent
  traffic; a sliding window vs reservoir is a refinement if memory/accuracy matters.
- **normalizePath cardinality.** Two-segment collapse is a heuristic; a path with a high-
  cardinality 2nd segment would still explode — none of the current routes do. Revisit if a
  route embeds an id in segment 2 without a stable prefix.
