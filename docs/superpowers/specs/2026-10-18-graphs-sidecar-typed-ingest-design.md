# Graphs sidecar — typed ingest (`from_table` / `to_table`)

**Date**: 2026-10-18
**Status**: current
**Context**: Quant-lab's research graph (YAML source of truth, ~700 nodes, seven layers
plus a read-only overlay of hedge-fund's operations graph) is exported to the graphs
sidecar as a derived, disposable view (`python -m quant_lab.research_graph export-gitnexus`).
Its `single` mode (one `Node` table, `type` as a property) works with the sidecar as it is.
Its `typed` mode (one node table per type, a REL table per edge type spanning several
`FROM … TO …` pairs) did not.

## 1. Problem

`ingest` matched edge endpoints without a label:

```cypher
MATCH (a {id: $from}), (b {id: $to}) MERGE (a)-[r:<table> {id: $id}]->(b)
```

Kùzu 0.11.3 binds that only when the REL table has a single `FROM … TO …` pair: the pair
then fixes both endpoint labels. With several node tables and a multi-pair REL table, the
binder rejects it: `Binder exception: Create rel r bound by multiple node labels is not
supported.` (probed on 2026-10-18: two node tables, `R(FROM A TO B)` → unlabeled OK;
`R(FROM A TO B, FROM A TO A)` or `R(FROM A TO B, FROM B TO B)` → binder error; labeled
endpoints OK in all three). That is why the academic-literature integration test (two
node tables, `AUTHORED(FROM Author TO Paper)`) never caught it. Quant-lab's typed export
declares a REL table per edge type spanning every pair of node types it links, so the
replay of the real payload (717 nodes, 570 edges, 33 node tables, 65 DDL statements)
against `graphs-sidecar/kuzu-store.mjs` fails on the first such edge after `create`
succeeds.

## 2. Design

The exporter already sends, in typed mode, the endpoint tables on each edge:

```json
{"table": "relies_on", "from": "wi-a", "to": "spec-b",
 "from_table": "WorkItem", "to_table": "Spec", "props": {"id": "wi-a->relies_on->spec-b"}}
```

- When an edge carries `from_table` / `to_table`, the endpoints are matched with labels:
  `MATCH (a:<from_table> {id: $from}), (b:<to_table> {id: $to})`. Each one is optional on
  its own (a missing one keeps its endpoint unlabeled).
- When both are absent, the query text is exactly today's: single-table graphs and every
  existing template (`research-artifacts`, `academic-literature`, `research-graph`,
  `model-graph`) are unaffected.
- Labels also make a typed graph correct where ids repeat across tables (a `WorkItem x`
  and a `Spec x`), and turn each endpoint lookup into a primary-key lookup on one table.

### 2.1 Identifier safety

Table names are spliced into the query text (Cypher has no parameter for a label), so
every identifier — graph name, node table, rel table, `from_table`, `to_table` — must
match the graph-name pattern `^[A-Za-z0-9._-]+$`. Values still travel as `$params`.
`nodes[].table` and `edges[].table` were spliced unchecked before; any name Kùzu accepts
unquoted already matches the pattern, so validating them breaks no working caller.

A name that fails the pattern throws an error carrying `status: 400`; `server.mjs` answers
`400 {error}` for it (500 for everything else, as before). All queries of a payload are
built before the database is opened, so a bad name anywhere rejects the whole payload
without a partial write. Callers that only test `res.ok` (the web container's
`graphsFetch`, Quant-lab's `push`) see an error either way.

### 2.2 Code layout

The query builders move to a new kuzu-free module, `graphs-sidecar/ingest-cypher.mjs`
(`safeName`, `nodeMergeQuery`, `edgeMergeQuery`), host-testable like `render-map.mjs`.
`kuzu-store.mjs` keeps the connection handling and runs the built queries; `dbPath`
validates the graph name through `safeName` (same message, now with status 400).

## 3. Contract

`POST /g/:name/ingest {nodes, edges}` — unchanged for existing payloads; edges gain two
optional fields, `from_table` and `to_table`. Response unchanged (`{nodes, edges}` counts).
New: `400 {error: "invalid <what>: <name>"}` for an unsafe graph or table name.

## 4. Verification (2026-10-18)

- Unit (`tests/unit/sidecar-ingest-cypher.test.mjs`, 10 tests): unlabeled query
  byte-identical to the old one when the tables are absent; labeled query with both or
  one table; injection attempts in each identifier rejected with status 400.
- Integration (`tests/integration/sidecar/graphs-sidecar.test.mjs`, two new cases): a
  typed graph with a two-pair rel table and an id shared by two tables round-trips to the
  right endpoints; an unsafe `to_table` returns 400 and writes nothing. The file builds the
  sidecar image with Docker; it was run on the host against `node server.mjs` (same file
  with the Docker `beforeAll` stripped, `INTEG_SKIP_SETUP=1`), 5/5 green.
- Real payload: Quant-lab's typed export replayed through `kuzu-store.mjs` (717 nodes,
  570 edges, every edge found with the right endpoints and REL table, re-ingest
  idempotent); the single export still round-trips; Quant-lab's own
  `export-gitnexus --mode typed --push` against the patched local server ingests
  717/570 and the render reports 33 node types.

## 5. Out of scope

- Prop keys are still spliced into `SET x.<key> = $<key>` unchecked (pre-existing).
- Batching (`UNWIND`) and a connection pool: ~11 s for 1 287 statements is fine for a
  derived view rebuilt on demand.
- Deploying: the `gitnexus-graphs` image must be rebuilt for the running stack to get it.
