/**
 * Graphs sidecar HTTP API. Owns template graphs as Kùzu DBs under GRAPHS_DIR.
 * Internal-only (compose network); the gitnexus-web container proxies to it.
 *   POST /g/:name/create   {ddl:[...]}            -> {name, created}
 *   POST /g/:name/ingest   {nodes:[...], edges:[...]} -> {nodes, edges}
 *        node {table, props}; edge {table, from, to, props, from_table?, to_table?}
 *        (endpoint tables required once a REL table spans several FROM/TO pairs)
 *   POST /g/:name/cypher   {query, params?}       -> {rows}
 *   GET  /g/:name/render                          -> {nodes, edges}
 *   GET  /g                                        -> {graphs:[name,...]}
 *   GET  /health                                   -> {ok:true}
 * Errors: {error} with 400 for an invalid graph/table name, 500 otherwise.
 */
import { createServer } from 'node:http';
import { mkdir, readdir } from 'node:fs/promises';
import { createGraph, ingest, cypher, render, GRAPHS_DIR } from './kuzu-store.mjs';

const PORT = Number(process.env.GRAPHS_PORT) || 4749;

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  let b = '';
  for await (const chunk of req) b += chunk;
  return b ? JSON.parse(b) : {};
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === '/health' && req.method === 'GET') return send(res, 200, { ok: true });

    if (path === '/g' && req.method === 'GET') {
      let files = [];
      try { files = await readdir(GRAPHS_DIR); } catch { /* none yet */ }
      return send(res, 200, { graphs: files.filter((f) => f.endsWith('.kuzu')).map((f) => f.replace(/\.kuzu$/, '')) });
    }

    const m = path.match(/^\/g\/([^/]+)\/(create|ingest|cypher|render)$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      const action = m[2];
      if (action === 'render' && req.method === 'GET') return send(res, 200, await render(name));
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (action === 'create') return send(res, 201, await createGraph(name, body.ddl || []));
        if (action === 'ingest') return send(res, 200, await ingest(name, body.nodes, body.edges));
        if (action === 'cypher') return send(res, 200, { rows: await cypher(name, body.query, body.params || {}) });
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, e?.status === 400 ? 400 : 500, { error: String((e && e.message) || e) });
  }
});

await mkdir(GRAPHS_DIR, { recursive: true }).catch(() => {});
server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`[graphs-sidecar] listening on :${PORT} · dir=${GRAPHS_DIR}\n`);
});
