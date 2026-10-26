# Graphs sidecar — Kùzu 0.11.3 → LadybugDB

**Date**: 2026-10-18
**Status**: current
**Depends on**: [typed ingest](2026-10-18-graphs-sidecar-typed-ingest-design.md) (same branch stack)

## 1. Context

The graphs sidecar (`graphs-sidecar/`, image `gitnexus-graphs`) has run on the `kuzu`
npm package, pinned at 0.11.3, since P0 (2026-06-03). KùzuDB was archived on 2025-10-10
(`kuzudb/kuzu` is read-only): no fixes, no new platform builds. Upstream GitNexus moved its
own code-graph store to **LadybugDB** (`@ladybugdb/core`, the maintained Kùzu fork:
`gitnexus/src/core/lbug/`; v1.6.9, our pin, locks 0.18.0; upstream `main` pins 0.21.1).
The sidecar was the platform's last Kùzu dependency.

## 2. Assessment — the API is close enough to migrate

| Need of the sidecar | Kùzu 0.11.3 | LadybugDB 0.21.2 |
|---|---|---|
| Import | `import kuzu from 'kuzu'` (default export) | `import lbug from '@ladybugdb/core'` (default export, also named ESM exports) |
| Open | `new Database(path)`, `new Connection(db)` (lazy init) | identical signatures (Database adds trailing options) |
| Query | `conn.query(str)`; params via `prepare` + `execute(stmt, params)` | identical |
| Rows | `result.getAll()`, `result.close()` | identical |
| Close | `async close()` on Connection and Database | identical |
| Cypher used (`MERGE … SET`, `MATCH (n) RETURN n, label(n)`, `label(r)`, multi-pair REL DDL) | yes | yes, same results |
| Binder rule on unlabeled multi-pair rel MERGE | rejected | rejected the same way (typed ingest still needed) |
| Storage file | `<name>.kuzu`, `STORAGE_VERSION` 39 | `STORAGE_VERSION` 47; a 0.11.3 file is **not readable**: "not a valid Lbug database file" |
| Packaging | prebuilt binaries inside the package | `install` script copies `lbugjs.node` from an optional per-platform package (`@ladybugdb/core-linux-x64`, …), all of which the lockfile records |
| Linux binary vs `node:22-bookworm-slim` | — | needs GLIBC ≤ 2.34 (bookworm ships 2.36), libstdc++ linked statically |

Measured on the host (Windows, Node 22.4) on 2026-10-18, by ingesting the same payloads
through both stores and comparing the `render` output field by field (including the engine's
internal `_id` / `_label` / `_src` / `_dst` passthrough fields) plus three Cypher reads
(counts, count by label, a parameterized lookup):

- Quant-lab's real export, `typed` (717 nodes, 570 edges, 33 node tables) and `single`:
  **identical**; ingest 8.3 s vs 11.4 s (typed) and 7.8 s vs 10.0 s (single) — about 25 % faster.
- The four web templates' DDL (`research-artifacts`, `academic-literature`,
  `research-graph`, `model-graph` with `year INT64` and `weight DOUBLE`), with
  importer-shaped payloads: **identical**.

So the migration is a dependency swap plus storage handling; no endpoint changes.

## 3. Design

- `graphs-sidecar/package.json`: `kuzu` 0.11.3 → `@ladybugdb/core` **0.21.2** (exact pin,
  latest stable, 2026-10-01; one patch over upstream `main`'s 0.21.1). Lockfile regenerated;
  it lists the five platform packages, so `npm install --omit=dev` in `Dockerfile.graphs`
  picks the linux-x64 one.
- `graphs-sidecar/kuzu-store.mjs` → **`lbug-store.mjs`** (renamed, same exports + `DB_EXT`):
  - DB files are `<name>.lbug` (was `<name>.kuzu`): a new engine must never try to open, or
    be confused with, a file it cannot read. `GET /g` lists `.lbug` files only.
  - **Legacy guard**: if `<name>.lbug` is absent but `<name>.kuzu` exists, `ingest`,
    `cypher` and `render` throw status **409** ("built by Kùzu … re-create and re-import
    it") instead of silently opening an empty `<name>.lbug`. `create` is exempt: it is how
    the graph gets rebuilt. Old `.kuzu` files are left on the volume, never deleted.
  - Connections and DBs are closed with `await` (the Kùzu store fired `close()` without
    awaiting it: a rejected close was an unhandled rejection, which kills a Node ≥ 15
    process — reproduced with two concurrent reads of one graph, see §5).
- `server.mjs`: imports `lbug-store.mjs`; error mapping 400 / **409** / 500.
- `Dockerfile.graphs`, both compose files: comments only (engine name, `<name>.lbug`).
  Service, image and volume names are unchanged.

### Contract

Unchanged for every existing caller: same routes, bodies, responses (render output is
byte-identical on the payloads above). Additions: `409 {error}` for a graph still in the
Kùzu format; `GET /g` names come from `.lbug` files. The web container (`graphsFetch`) and
Quant-lab (`push`) only test `res.ok`.

### 3.1 Concurrent requests on one graph

Each call opens the graph's DB file, and a second open of the same file cannot take its
lock: two requests on one graph at once failed with "Could not set lock on file" on both
engines (on Kùzu the unawaited close could then crash the process). The web container can
issue such pairs: `/graph/research/:name` and `/graph/metrics/:name` both render the graph.
`lbug-store.mjs` now chains the operations of each graph (`exclusive(name, fn)`: each one
starts when the previous one has settled, failure included); different graphs still run in
parallel. Measured: 5 parallel renders + an ingest on one graph went from `[200, 500×5]` to
all 200; 45 mixed operations over two graphs, none rejected.

## 4. Deploying (not done here — needs Robin's go-ahead)

1. Rebuild and restart only the sidecar: `docker compose build gitnexus-graphs` then
   `docker compose up -d gitnexus-graphs`. Nothing else changes (web, API, volume names).
2. Every graph scaffolded before is now `<name>.kuzu` on `gitnexus-data` and answers 409.
   Rebuild each one — the graphs are derived views, their sources are untouched:
   - web templates: for each record in `GET /graph/list`, re-`POST /graph/scaffold`
     `{templateId, name, source}` (idempotent: DDL "already exists" is swallowed, the index
     record is rewritten) then `POST /graph/import {name}`;
   - Quant-lab: `python -m quant_lab.research_graph --overlay ../hedge-fund/ops/graph
     export-gitnexus --mode typed --push <sidecar-url> --name quant-lab`.
3. Optional cleanup once rebuilt: delete `/data/gitnexus/graphs/*.kuzu*` on the volume.
4. Rollback: re-deploy the previous image; it reads the untouched `.kuzu` files again
   (graphs built meanwhile in `.lbug` are invisible to it).

## 5. Verification (2026-10-18)

- Comparison runs of §2 (Kùzu store from the typed-ingest branch vs this store).
- `tests/unit/sidecar-*.test.mjs` (render-map + ingest-cypher, kuzu-free): 13/13.
- `tests/integration/sidecar/graphs-sidecar.test.mjs` with a new legacy case (plants
  `legacy.kuzu` via `docker exec`, expects 409, `create` → 201, empty render, listed in
  `GET /g`) and a concurrency case (§3.1): run on the host against `node server.mjs` on
  LadybugDB, with the Docker `beforeAll` stripped and the plant done by a file write:
  **7/7** (the concurrency case fails without §3.1).
- Quant-lab's own `export-gitnexus --push` (typed and single) against that server:
  722 nodes / 583 edges ingested and rendered (the graph had grown since §2's export).
- Not verified: the Docker image build (Docker was not running; the glibc check above is
  the static substitute), the integration suite in its Docker form, the web container
  against the new sidecar.

## 6. Out of scope / follow-ups

- Following upstream's version: when the fork bumps upstream to a release on a newer
  `@ladybugdb/core`, align the sidecar pin in the same pass (separate DB files, so no
  storage coupling forces it).

## Update 2026-10-19 — Docker image fixed (libssl3) and verified in Docker

The first Docker build (2026-10-19, deploy go-ahead from Robin) produced an image whose sidecar died at
startup: `@ladybugdb/core`'s `lbugjs.node` links `libssl.so.3` and `libcrypto.so.3`, which
`node:22-bookworm-slim` does not ship (`ERR_DLOPEN_FAILED`). The static check of §2 covered glibc only.
`Dockerfile.graphs` now installs `libssl3`; `ldd` on the binding then resolves every library.

Verified in Docker: `docker compose build gitnexus-graphs` succeeds, and
`tests/integration/sidecar/graphs-sidecar.test.mjs` passes **7/7** against the real container
(`INTEG_SKIP_SETUP=1`: this file builds and runs its own sidecar container, so it does not need the full
test stack). Still not verified: the full integration tier and the web container against the new
sidecar, because `upstream/` is not cloned on this machine (the web and API images build from it).

## Update 2026-10-26 — the sidecar exits on SIGTERM

Node running as PID 1 has no default signal handling, so `docker compose stop` waited out the stop
timeout and killed the sidecar (exit 137), possibly in the middle of an ingest. `server.mjs` now closes
the HTTP server on SIGTERM/SIGINT and exits 0 once the in-flight requests (and so their database
operations) are done, or after 2 s. Covered by `tests/integration/stack-stop-signal.test.mjs`, which
also covers `gitnexus-web` (same defect, fixed in `docker-server-routes.mjs` → `exitOnStopSignals`).
