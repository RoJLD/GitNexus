/**
 * Thin LadybugDB wrapper for the graphs sidecar. One DB per template graph, under
 * GRAPHS_DIR/<name>.lbug. Connections are opened per-call (P0 simplicity; a pool is
 * a later optimization). LadybugDB is the maintained fork of Kùzu (archived
 * 2025-10-10) that upstream GitNexus moved to; same Cypher dialect and JS API.
 */
import lbug from '@ladybugdb/core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mapRenderRows } from './render-map.mjs';
import { safeName, nodeMergeQuery, edgeMergeQuery } from './ingest-cypher.mjs';

export const GRAPHS_DIR = process.env.GRAPHS_DIR || '/data/gitnexus/graphs';
export const DB_EXT = '.lbug';

function dbPath(name) {
  return join(GRAPHS_DIR, `${safeName(name, 'graph name')}${DB_EXT}`);
}

/**
 * Only `create` brings a graph into being. Opening a DB creates its file, so reading or
 * ingesting an unknown name used to leave an empty <name>.lbug behind (listed by GET /g
 * from then on): refuse it with 404 instead. A graph built before the migration sits in
 * <name>.kuzu, a file LadybugDB cannot open ("not a valid Lbug database file"): refuse it
 * with 409 until it is re-created and re-imported.
 */
function assertExists(name) {
  if (existsSync(dbPath(name))) return;
  const legacy = existsSync(join(GRAPHS_DIR, `${name}.kuzu`));
  const err = new Error(legacy
    ? `graph ${name} was built by Kùzu (${name}.kuzu), which LadybugDB cannot open: re-create and re-import it`
    : `graph ${name} not found`);
  err.status = legacy ? 409 : 404;
  throw err;
}

/**
 * Every call opens the graph's DB file, and a second open of the same file cannot take
 * its lock ("Could not set lock on file"), so operations on one graph run one at a time:
 * each waits for the previous one to settle. Different graphs still run in parallel.
 */
const tails = new Map();
function exclusive(name, fn) {
  const run = (tails.get(name) || Promise.resolve()).then(fn);
  const tail = run.then(() => {}, () => {});
  tails.set(name, tail);
  tail.then(() => { if (tails.get(name) === tail) tails.delete(name); });
  return run;
}

// The existence check runs inside the per-graph queue, so a read sent after a create
// sees the graph that create made.
function withConn(name, fn, { mustExist = true } = {}) {
  const path = dbPath(name);
  return exclusive(name, async () => {
    if (mustExist) assertExists(name);
    const db = new lbug.Database(path);
    const conn = new lbug.Connection(db);
    try {
      return await fn(conn);
    } finally {
      try { await conn.close(); } catch { /* */ }
      try { await db.close(); } catch { /* */ }
    }
  });
}

/**
 * Run a query. `conn.query(str)` takes ONE arg (the 2nd is a progress callback, not
 * params); parameterized queries go through prepare()+execute(stmt, params).
 */
async function run(conn, query, params) {
  if (params && Object.keys(params).length) {
    const stmt = await conn.prepare(query);
    return conn.execute(stmt, params);
  }
  return conn.query(query);
}

async function closeResult(r) {
  try { await r?.close?.(); } catch { /* best-effort */ }
}

/** Apply DDL statements (CREATE NODE/REL TABLE). Idempotent: "already exists" is swallowed. */
export async function createGraph(name, ddl) {
  await withConn(name, async (conn) => {
    for (const stmt of ddl) {
      try {
        await closeResult(await run(conn, stmt));
      } catch (e) {
        if (!/already exists/i.test(String(e && e.message))) throw e;
      }
    }
  }, { mustExist: false });
  return { name, created: true };
}

/**
 * Ingest nodes + edges. Nodes: [{table, props}]; edges: [{table, from, to, props,
 * from_table?, to_table?}] — the endpoint tables are needed once a REL table spans
 * several FROM/TO pairs (see edgeMergeQuery). Every query is built before the DB is
 * opened, so an invalid table name rejects the whole payload (400) without a partial write.
 */
export async function ingest(name, nodes, edges) {
  const queries = [...(nodes || []).map(nodeMergeQuery), ...(edges || []).map(edgeMergeQuery)];
  await withConn(name, async (conn) => {
    for (const { query, params } of queries) await closeResult(await run(conn, query, params));
  });
  return { nodes: (nodes || []).length, edges: (edges || []).length };
}

/** Run a read Cypher query, return rows. */
export async function cypher(name, query, params = {}) {
  return withConn(name, async (conn) => {
    const r = await run(conn, query, params);
    const rows = await r.getAll();
    await closeResult(r);
    return rows;
  });
}

/** Default render projection: all nodes + all edges, schema-agnostic. */
export async function render(name) {
  // label(n)/label(r) rather than n._label, which Kùzu 0.11.3 did not expose on returned rows.
  const nrows = await cypher(name, 'MATCH (n) RETURN n, label(n) AS lbl');
  const erows = await cypher(name, 'MATCH (a)-[r]->(b) RETURN a.id AS source, b.id AS target, r, label(r) AS lbl');
  return mapRenderRows(nrows, erows);
}
