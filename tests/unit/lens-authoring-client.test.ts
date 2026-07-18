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

  // Fix 1 (final review): previewLens's declared type is
  // `Promise<LensPreviewResult>` (claims to always resolve), but the
  // underlying `fetchWithTimeout` call can THROW (BackendError/TimeoutError/
  // CircuitOpenError) on a transport failure — e.g. the gateway is down.
  // Before the fix, that throw propagated out of previewLens uncaught, and
  // LensStudioModal.handlePreview has no try/catch around `onPreview`, so a
  // gateway-unreachable Preview silently showed nothing. previewLens must
  // honor its own type: resolve to {ok:false, errors:[...]} on ANY throw.
  it('previewLens resolves to {ok:false, errors} (never rejects) when fetch throws (gateway down/timeout)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const r = await previewLens({ name: 'x', source: { lens: 'sigil' } });
    expect(r.ok).toBe(false);
    expect(r.errors?.length).toBeGreaterThan(0);
  });

  // Fix 2 (final review): assertOk (used by proposeLens) only reads
  // `body.error`/`body.message`, but the bridge-api raises FastAPI
  // `HTTPException(detail=...)`, whose JSON body is `{"detail": "..."}`.
  // Without a `detail` branch, a 403 "auto_approve requires an approver
  // role" (or a 422 spec-validation reason) is swallowed and the user sees
  // only "Forbidden"/"Unprocessable Entity" instead of the real reason.
  it('proposeLens surfaces FastAPI {detail} on 403 (auto_approve requires an approver role)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResp(403, { detail: 'auto_approve requires an approver role' })),
    );
    await expect(proposeLens({ name: 'x' }, true, 'TOK')).rejects.toThrow(
      /auto_approve requires an approver role/,
    );
  });
});
