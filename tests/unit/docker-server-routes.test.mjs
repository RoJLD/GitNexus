import { describe, it, expect } from 'vitest';
import {
  registerGitnexusRoutes,
  startGitnexusCron,
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
