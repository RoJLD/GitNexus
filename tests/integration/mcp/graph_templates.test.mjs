import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(here, '..', '..', '..', 'mcp-server', 'server.mjs');

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

describe('MCP graph-template tools', () => {
  beforeAll(async () => {
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

  it('exposes the three new tools', async () => {
    const list = await send('tools/list');
    expect(list.error).toBeUndefined();
    const names = (list.result?.tools || []).map((t) => t.name);
    expect(names).toContain('gitnexus_list_graph_templates');
    expect(names).toContain('gitnexus_create_graph_from_template');
    expect(names).toContain('gitnexus_import_into_graph');
  });

  it('list_graph_templates returns research-artifacts', async () => {
    const r = await send('tools/call', { name: 'gitnexus_list_graph_templates', arguments: {} });
    expect(r.error).toBeUndefined();
    expect(r.result?.isError).toBeFalsy();
    expect(r.result.content[0].text).toContain('research-artifacts');
  });
});
