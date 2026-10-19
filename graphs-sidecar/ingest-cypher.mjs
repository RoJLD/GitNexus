/**
 * Pure Cypher builders for the sidecar's ingest (kuzu-free so they're host-testable).
 * Every identifier spliced into a query text (graph name, node/rel table, endpoint
 * labels) must match SAFE_NAME; values always travel as $params.
 */
export const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/** Return `name` if it matches SAFE_NAME, else throw an Error carrying status 400. */
export function safeName(name, what) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name)) {
    const err = new Error(`invalid ${what}: ${name}`);
    err.status = 400;
    throw err;
  }
  return name;
}

/** Node: {table, props} -> MERGE on the primary key `id`, SET every other prop. */
export function nodeMergeQuery(n) {
  const table = safeName(n.table, 'node table');
  const keys = Object.keys(n.props).filter((k) => k !== 'id');
  const setClause = keys.length ? ` SET ${keys.map((k) => `x.${k} = $${k}`).join(', ')}` : '';
  return { query: `MERGE (x:${table} {id: $id})${setClause}`, params: n.props };
}

const RESERVED = new Set(['id', 'from', 'to']);

/** `:<table>` when the endpoint table is given, '' (unlabeled match) when absent. */
function endpointLabel(table, what) {
  return table == null ? '' : `:${safeName(table, what)}`;
}

/**
 * Edge: {table, from, to, props, from_table?, to_table?} -> MATCH both endpoints by id,
 * MERGE the relationship on its `id`. With `from_table`/`to_table` the endpoints are
 * matched with labels, which Kùzu requires once a REL table spans several FROM/TO pairs
 * ("Create rel bound by multiple node labels is not supported"); without them the
 * match stays unlabeled, as before.
 */
export function edgeMergeQuery(e) {
  const table = safeName(e.table, 'rel table');
  const from = endpointLabel(e.from_table, 'from_table');
  const to = endpointLabel(e.to_table, 'to_table');
  const props = { ...(e.props || {}), id: e.props?.id ?? `${e.from}->${e.to}` };
  const keys = Object.keys(props).filter((k) => !RESERVED.has(k));
  const setClause = keys.length ? ` SET ${keys.map((k) => `r.${k} = $${k}`).join(', ')}` : '';
  return {
    query: `MATCH (a${from} {id: $from}), (b${to} {id: $to}) MERGE (a)-[r:${table} {id: $id}]->(b)${setClause}`,
    params: { from: e.from, to: e.to, ...props },
  };
}
