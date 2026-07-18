import { describe, it, expect, vi, beforeEach } from 'vitest';
import { previewLens, proposeLens, setBridgeUrl, getBridgeUrl } from '@/services/backend-client';

const okResp = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

describe('lens authoring client', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('previewLens returns {ok:true, braingraph} on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResp(200, { lens: { name: 'x' }, nodes: [], relationships: [] })));
    const r = await previewLens({ name: 'x', source: { lens: 'sigil' } });
    expect(r.ok).toBe(true);
    expect(r.braingraph).toBeTruthy();
  });

  it('previewLens returns {ok:false, errors} on 422', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResp(422, { ok: false, errors: ['invalid color.scale'] })));
    const r = await previewLens({ name: 'x', color: { scale: 'NOPE' } });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toContain('color.scale');
  });

  it('proposeLens sends Bearer token and a body WITHOUT author', async () => {
    const fetchMock = vi.fn(async () => okResp(200, { id: 'abc123', status: 'approved' }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await proposeLens({ name: 'x', source: { lens: 'sigil' } }, true, 'TOK');
    expect(r.id).toBe('abc123');
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOK');
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({ spec: { name: 'x', source: { lens: 'sigil' } }, auto_approve: true });
    expect('author' in sent).toBe(false);
  });

  it('setBridgeUrl rejects a dangerous scheme (SSRF guard)', () => {
    expect(() => setBridgeUrl('javascript:alert(1)')).toThrow();
    // and a valid URL is accepted + trailing slash stripped:
    setBridgeUrl('http://bridge.local/');
    expect(getBridgeUrl()).toBe('http://bridge.local');
  });
});
