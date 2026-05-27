import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE } from '../helpers/analyze.mjs';

// Locate the MCP sidecar relative to the repo root.
// tests/integration/mcp/ghost_audit.test.mjs → ../../../mcp-server/server.mjs
const here = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(here, '..', '..', '..', 'mcp-server', 'server.mjs');

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

let server;
let rl;
const pending = new Map();
let nextId = 1;

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout on ${method}`));
      }
    }, 35000);
  });
}

function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

describe('MCP tool gitnexus_ghost_audit', () => {
  beforeAll(async () => {
    // Pre-sync ghosts so the tool has something to audit.
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });

    server = spawn(process.execPath, [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    rl = createInterface({ input: server.stdout });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) {
          const { resolve } = pending.get(msg.id);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch {
        // Ignore non-JSON lines.
      }
    });

    const init = await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vitest-integ', version: '0.0.0' },
    });
    if (init.error) throw new Error(`initialize: ${init.error.message}`);
    notify('notifications/initialized');
  }, 45000);

  afterAll(() => {
    if (server) server.kill();
  });

  it('exposes gitnexus_ghost_audit in tools/list', async () => {
    const list = await send('tools/list');
    expect(list.error).toBeUndefined();
    const tools = list.result?.tools || [];
    expect(tools.find((t) => t.name === 'gitnexus_ghost_audit')).toBeDefined();
  });

  it('returns a non-error response with audit + summary content', async () => {
    const res = await send('tools/call', {
      name: 'gitnexus_ghost_audit',
      arguments: { repo: FIXTURE.name },
    });
    expect(res.error).toBeUndefined();
    expect(res.result?.isError).toBeFalsy();
    expect(Array.isArray(res.result?.content)).toBe(true);
    expect(res.result.content.length).toBeGreaterThanOrEqual(1);

    // Concatenate all text blocks; the wrapper emits a human summary
    // ("Roadmap audit") plus the JSON payload (containing "audit" + "summary").
    const blob = res.result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    expect(blob).toMatch(/audit/i);
    expect(blob).toMatch(/summary/i);
  });
});
