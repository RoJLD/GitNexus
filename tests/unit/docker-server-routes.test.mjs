import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import {
  registerGitnexusRoutes,
  startGitnexusCron,
  exitOnStopSignals,
} from '../../upstream/docker-server-routes.mjs';

function mockRes() {
  const res = { statusCode: null, ended: false, body: null, headers: {} };
  res.writeHead = (code, hdrs) => { res.statusCode = code; if (hdrs) Object.assign(res.headers, hdrs); };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = (b) => { res.ended = true; res.body = b ?? null; };
  return res;
}

describe('docker-server-routes shim', () => {
  it('exporte registerGitnexusRoutes et startGitnexusCron comme fonctions', () => {
    expect(typeof registerGitnexusRoutes).toBe('function');
    expect(typeof startGitnexusCron).toBe('function');
  });

  it('retourne false et n\'écrit pas de réponse pour un chemin non géré', async () => {
    const req = { method: 'GET', url: '/definitely-not-a-gitnexus-route' };
    const reqUrl = new URL('http://localhost:4747/definitely-not-a-gitnexus-route');
    const res = mockRes();
    const handled = await registerGitnexusRoutes(req, reqUrl, res, { api: null });
    expect(handled).toBe(false);
    expect(res.ended).toBe(false);
  });
});

// `docker compose stop` sends SIGTERM to node running as PID 1, which has no default
// handler there: unhandled, the container was killed at the stop timeout (exit 137).
// process.emit() runs the handlers without sending a real signal (portable to Windows).
describe('exitOnStopSignals', () => {
  const listening = () => new Promise((resolve) => {
    const server = createServer((_req, res) => res.end('ok'));
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

  for (const signal of ['SIGTERM', 'SIGINT']) {
    it(`closes the server and exits 0 on ${signal}`, async () => {
      const server = await listening();
      const exited = new Promise((resolve) => {
        const remove = exitOnStopSignals(server, { exit: (code) => { remove(); resolve(code); } });
      });
      process.emit(signal, signal);
      expect(await exited).toBe(0);
      expect(server.listening).toBe(false);
    });
  }

  it('cuts a request still open after the grace period, then exits 0', async () => {
    const server = createServer(() => { /* never answers, like an SSE stream */ });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const pending = fetch(`http://127.0.0.1:${port}/`).catch((e) => e);
    await new Promise((resolve) => server.once('connection', () => setImmediate(resolve)));
    const exited = new Promise((resolve) => {
      const remove = exitOnStopSignals(server, { graceMs: 50, exit: (code) => { remove(); resolve(code); } });
    });
    process.emit('SIGTERM', 'SIGTERM');
    expect(await exited).toBe(0);
    expect(await pending).toBeInstanceOf(Error);
  });
});
