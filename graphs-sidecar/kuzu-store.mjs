/**
 * Thin Kùzu wrapper for the graphs sidecar. One Kùzu DB per template graph,
 * under GRAPHS_DIR/<name>.kuzu. Connections are opened per-call (P0 simplicity;
 * a pool is a later optimization).
 */
import kuzuPkg from 'kuzu';
import { join } from 'node:path';
import { mapRenderRows } from './render-map.mjs';

const kuzu = kuzuPkg.default || kuzuPkg;
export const GRAPHS_DIR = process.env.GRAPHS_DIR || '/data/gitnexus/graphs';

function dbPath(name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`invalid graph name: ${name}`);
  return join(GRAPHS_DIR, `${name}.kuzu`);
}

function withConn(name, fn) {
  const db = new kuzu.Database(dbPath(name));
  const conn = new kuzu.Connection(db);
  return Promise.resolve(fn(conn)).finally(() => {
    try { conn.close?.(); } catch { /* */ }
    try { db.close?.(); } catch { /* */ }
  });
}

/**
 * Run a query. Kùzu's `conn.query(str)` takes ONE arg (the 2nd is options, not
 * params); parameterized queries go through prepare()+execute(stmt, params).
 */
async function run(conn, query, params) {
  if (params && Object.keys(params).length) {
    const stmt = await conn.prepare(query);
    return conn.execute(stmt, params);
  }
  return conn.query(query);
}

/** Apply DDL statements (CREATE NODE/REL TABLE). Idempotent: "already exists" is swallowed. */
export async function createGraph(name, ddl) {
  await withConn(name, async (conn) => {
    for (const stmt of ddl) {
      try {
        const r = await run(conn, stmt);
        r.close?.();
      } catch (e) {
        if (!/already exists/i.test(String(e && e.message))) throw e;
      }
    }
  });
  return { name, created: true };
}

/** Ingest nodes + edges. Nodes: [{table, props}]; edges: [{table, from, to, props}]. */
export async function ingest(name, nodes, edges) {
  await withConn(name, async (conn) => {
    for (const n of nodes || []) {
      const keys = Object.keys(n.props).filter((k) => k !== 'id');
      const setClause = keys.length ? ` SET ${keys.map((k) => `x.${k} = $${k}`).join(', ')}` : '';
      const r = await run(conn, `MERGE (x:${n.table} {id: $id})${setClause}`, n.props);
      r.close?.();
    }
    const RESERVED = new Set(['id', 'from', 'to']);
    for (const e of edges || []) {
      const props = { ...(e.props || {}), id: e.props?.id ?? `${e.from}->${e.to}` };
      const keys = Object.keys(props).filter((k) => !RESERVED.has(k));
      const setClause = keys.length ? ` SET ${keys.map((k) => `r.${k} = $${k}`).join(', ')}` : '';
      const r = await run(
        conn,
        `MATCH (a {id: $from}), (b {id: $to}) MERGE (a)-[r:${e.table} {id: $id}]->(b)${setClause}`,
        { from: e.from, to: e.to, ...props },
      );
      r.close?.();
    }
  });
  return { nodes: (nodes || []).length, edges: (edges || []).length };
}

/** Run a read Cypher query, return rows. */
export async function cypher(name, query, params = {}) {
  return withConn(name, async (conn) => {
    const r = await run(conn, query, params);
    const rows = await r.getAll();
    r.close?.();
    return rows;
  });
}

/** Default render projection: all nodes + all edges, schema-agnostic. */
export async function render(name) {
  // label(n)/label(r) instead of n._label: kuzu 0.11.3 does not expose _label on returned rows.
  const nrows = await cypher(name, 'MATCH (n) RETURN n, label(n) AS lbl');
  const erows = await cypher(name, 'MATCH (a)-[r]->(b) RETURN a.id AS source, b.id AS target, r, label(r) AS lbl');
  return mapRenderRows(nrows, erows);
}
