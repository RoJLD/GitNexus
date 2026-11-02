/**
 * A REST read must leave the index as it found it. The read routes (/api/query, /api/graph, the web UI) open a repo's
 * index read-only and keep that one connection until a read of another repo closes it. The close ran a CHECKPOINT on
 * the read-only connection: LadybugDB wrote lbug.shadow and lbug.wal, failed to write the main file, and left both
 * behind. MCP's read-only pool then refused that index ("Couldn't replay shadow pages under read-only mode") until a
 * writable open or a fresh analyze. Runs a throwaway server from the CLI image the global setup just built, on two
 * one-file repos it analyzes itself, so the shared test stack keeps running.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const IMAGE = 'gitnexus-cli-test:local';
const NAME = 'gnx-rest-read-no-wal';
const REPOS = ['alpha', 'beta'];
// Two one-file git repos, analyzed by the CLI (registered in GITNEXUS_HOME), then the server. The mmap cap is the
// test stack's (docker-compose.test.yml): a CI runner cannot reserve the image's 16 GiB default.
const SETUP = [
  'set -e',
  `for r in ${REPOS.join(' ')}; do`,
  '  d=/tmp/src/$r; mkdir -p $d; cd $d; git init -q -b main .',
  '  printf "export function %s(x: number): number {\\n  return x + 1;\\n}\\n" "$r" > index.ts',
  '  git add . && git -c user.email=test@example.invalid -c user.name=test commit -qm init',
  '  gitnexus analyze --index-only $d',
  'done',
  'exec gitnexus serve --host 0.0.0.0 --port 4747',
].join('\n');
const FILES = 'MATCH (n:File) RETURN n.name AS name';

let api;
const removeContainer = () => { try { docker('rm', '-f', NAME); } catch { /* not there */ } };

async function query(repo, cypher) {
  const res = await fetch(`${api}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repo, cypher }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).result;
}

// One MCP tool call on the server's StreamableHTTP endpoint (/api/mcp): { text, isError }.
async function mcpTool(name, args) {
  let session = '';
  const post = async (body, method = 'POST') => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (session) headers['mcp-session-id'] = session;
    const res = await fetch(`${api}/api/mcp`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    session = res.headers.get('mcp-session-id') || session;
    let raw = (await res.text()).trim();
    if (raw && !raw.startsWith('{')) { // an event stream: the last data line holds the answer
      raw = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop() || '';
    }
    return raw ? JSON.parse(raw) : {};
  };
  try {
    await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rest-read-no-wal', version: '1' } } });
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const res = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
    const result = res.result || {};
    const text = (result.content || []).map((c) => c.text || '').join('');
    return { text: text || JSON.stringify(res.error || ''), isError: Boolean(res.error || result.isError) };
  } finally {
    if (session) await post(null, 'DELETE').catch(() => {});
  }
}

beforeAll(async () => {
  removeContainer();
  docker('run', '-d', '--name', NAME, '-p', '127.0.0.1::4747', '-e', 'GITNEXUS_LBUG_MAX_DB_SIZE=2147483648',
    '--entrypoint', 'sh', IMAGE, '-c', SETUP);
  api = `http://${docker('port', NAME, '4747/tcp').split('\n')[0]}`;
  for (let i = 0; i < 360; i++) {
    if (/GitNexus server running/.test(docker('logs', NAME))) break;
    if (docker('inspect', '-f', '{{.State.Running}}', NAME) !== 'true') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(docker('logs', NAME)).toMatch(/GitNexus server running/);
}, 240_000);

afterAll(removeContainer);

describe('a REST read leaves no WAL behind', () => {
  it('reading a second repo closes the first without writing lbug.wal or lbug.shadow', async () => {
    expect(await query('alpha', FILES)).toEqual([{ name: 'index.ts' }]);
    expect(await query('beta', FILES)).toEqual([{ name: 'index.ts' }]); // evicts alpha's read-only connection
    const files = docker('exec', NAME, 'ls', '-a', '/tmp/src/alpha/.gitnexus').split('\n');
    expect(files).toContain('lbug');
    expect(files.filter((f) => f.startsWith('lbug.'))).toEqual([]);
  });

  it('MCP still opens the index the REST server closed', async () => {
    const { text, isError } = await mcpTool('cypher', { repo: 'alpha', query: FILES });
    expect(isError, text).toBe(false);
    expect(text).toContain('index.ts');
  });
});
