# Shared per-snapshot node-id cache — design

**Date:** 2026-07-15
**Status:** ✅ Livré
**Author:** Robin DENIS (fork RoJLD/GitNexus)

## Problem (measured, not assumed)

The four time-travel analytics endpoints — `/churn`, `/growth`, `/lifespan`,
`/coupling` — all walk a repo's snapshot timeline and, **per timeline point**,
POST a Cypher query `MATCH (n) RETURN n.id AS id` to the API's `/api/query`.

Measured on the live stack (repo `HMMstudio`, 2 snapshots + live):

| Endpoint | Latency |
|---|---|
| `/churn` | ~33 s |
| `/growth` | ~21 s |
| `/lifespan` | ~15 s |
| single `MATCH (n) RETURN n.id` (live) | **25.8 s** |

Root cause: the API holds a **single-entry lbug REST cache**, so each query
against a *different* snapshot path cold-opens that path's lbug DB (mmap +
load). Sequential iteration across N points = N cold opens. The endpoints
each carry their own **duplicated** `fetchNodeIds` copy and cache nothing.

## Key insight — snapshots are immutable

A snapshot point (`<repo>@<shortHash>`) is a frozen commit — its node-id list
**never changes**. Only the **live** point moves, and only when the repo is
re-indexed. So per-point node-id lists are cacheable:

- **snapshot points** → cache **forever**, content-addressed by point name;
- **live point** → cache keyed by the live entry's `indexedAt` (a reindex
  changes it → natural invalidation).

## Design — one shared cached helper

New owned module `upstream/docker-server-snapshot-nodeids.mjs`:

```
getSnapshotNodeIds(pointName, { api, isLive, liveKey, cacheDir, fetchImpl }) -> string[]
```

- **In-memory Map** keyed `snap:<pointName>` (immutable) or
  `live:<pointName>:<liveKey>` (reindex-invalidated). Serves repeat calls —
  the dominant win: opening `/churn` warms the cache, then
  `/growth`/`/lifespan`/`/coupling` for the same repo are **instant**.
- **On-disk persistence** for snapshot points only, at
  `<cacheDir>/.gitnexus/snapshot-nodeids-cache.json` (mirrors the existing
  `alive-between-cache.json` pattern) — survives a container rebuild/restart.
  The live point is **never** persisted (it changes; in-memory only).
- `fetchNodeIds(repoName, api, { fetchImpl })` is the single canonical copy
  of the Cypher call (was duplicated across the 4 handlers).
- `fetchImpl` injection + `__clearCache()` make the module unit-testable
  without a live stack.

The four handlers replace their local `fetchNodeIds(point.name, opts.api)`
call with
`getSnapshotNodeIds(point.name, { api: opts.api, isLive: point.isLive, liveKey: liveEntry.indexedAt, cacheDir: liveEntry.path })`
and drop their duplicated `fetchNodeIds`. `listSnapshotNamesAndDates` stays
local (orthogonal to perf; touching it would widen the blast radius).

## Invalidation correctness

- New snapshot lands → new point name → miss → fetch once (incremental: only
  the new point + live are re-queried, not the whole timeline).
- Repo reindexed → `indexedAt` changes → live key changes → live re-fetched;
  snapshot points untouched (correct — they didn't change).
- Cache read/write is **best-effort** (corruption/absence → treated as empty →
  refetch). A cache miss only costs a refetch; never wrong data.

## Non-goals

- Making the *first-ever* cold call fast (that's the lbug cold-open, upstream).
  The cache amortizes it across the 4 endpoints and all repeat calls.
- Caching `/api/graph` or edges — only the id list the 4 endpoints need.
- ETag/If-None-Match (client-side 304) — a possible follow-up; the server-side
  recompute was the bottleneck, which this removes.

## Tests

`tests/unit/snapshot-nodeids-cache.test.mjs` (vitest, injected `fetchImpl` +
temp dir): miss→fetch→memory-hit; snapshot persisted + survives clear without
refetch; live not persisted + refetched after clear; live invalidated on
`liveKey` change; `fetchNodeIds` shape tolerance.
