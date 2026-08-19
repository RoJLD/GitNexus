import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

// End-to-end proof of the ETag / If-None-Match → 304 conditional-GET wired into
// the timeline-analytics endpoints (withETag in docker-server-etag.mjs). The 4
// handlers are deterministic (no per-request timestamp), so an unchanged repo
// yields a byte-identical body → identical ETag → 304 on re-request.
describe('conditional-GET (ETag / 304) on /churn', () => {
  const base = `http://localhost:4173/churn?repo=${encodeURIComponent(FIXTURE.name)}`;

  it('returns a strong-looking ETag header on the first 200', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it('returns 304 with an empty body when If-None-Match matches', async () => {
    const first = await fetch(base);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await fetch(base, { headers: { 'If-None-Match': etag } });
    expect(second.status).toBe(304);
    const body = await second.text();
    expect(body).toBe('');
  });

  it('returns 200 with a body when If-None-Match is stale', async () => {
    const res = await fetch(base, {
      headers: { 'If-None-Match': '"deadbeefdeadbeefdeadbeefdeadbeef"' },
    });
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });
});
