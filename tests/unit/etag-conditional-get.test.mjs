import { describe, it, expect } from 'vitest';
import { computeETag, withETag } from '../../upstream/docker-server-etag.mjs';

// Minimal req/res doubles. The res records the FINAL status/headers/body that
// withETag's wrappers commit via the original writeHead/end.
function makeReq(ifNoneMatch) {
  return { method: 'GET', headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {} };
}
function makeRes() {
  const rec = { status: null, headers: null, body: undefined, ended: false };
  const res = {
    writeHead(code, ...rest) {
      rec.status = code;
      rec.headers = rest.find((a) => a && typeof a === 'object') || {};
      return this;
    },
    end(body) {
      rec.body = body;
      rec.ended = true;
      return this;
    },
    rec,
  };
  return res;
}

// Simulate the way the analytics handlers write a JSON 200.
function writeJson200(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

describe('computeETag', () => {
  it('is deterministic for the same body', () => {
    expect(computeETag('{"a":1}')).toBe(computeETag('{"a":1}'));
  });
  it('differs for different bodies', () => {
    expect(computeETag('{"a":1}')).not.toBe(computeETag('{"a":2}'));
  });
  it('is a quoted 32-hex-char tag', () => {
    expect(computeETag('x')).toMatch(/^"[0-9a-f]{32}"$/);
  });
});

describe('withETag', () => {
  it('adds an ETag header to a fresh 200 JSON response and returns the body', () => {
    const res = makeRes();
    withETag(makeReq(), res);
    writeJson200(res, { total: 3 });
    expect(res.rec.status).toBe(200);
    expect(res.rec.headers.ETag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(res.rec.body).toBe(JSON.stringify({ total: 3 }));
  });

  it('returns 304 with no body when If-None-Match matches', () => {
    const body = JSON.stringify({ total: 3 });
    const etag = computeETag(body);
    const res = makeRes();
    withETag(makeReq(etag), res);
    writeJson200(res, { total: 3 });
    expect(res.rec.status).toBe(304);
    expect(res.rec.headers.ETag).toBe(etag);
    expect(res.rec.body).toBeUndefined();
  });

  it('returns 200 with the body when If-None-Match is stale', () => {
    const res = makeRes();
    withETag(makeReq('"deadbeefdeadbeefdeadbeefdeadbeef"'), res);
    writeJson200(res, { total: 4 });
    expect(res.rec.status).toBe(200);
    expect(res.rec.body).toBe(JSON.stringify({ total: 4 }));
  });

  it('passes non-200 responses through untouched (no ETag)', () => {
    const res = makeRes();
    withETag(makeReq(), res);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'repo not found' }));
    expect(res.rec.status).toBe(404);
    expect(res.rec.headers.ETag).toBeUndefined();
    expect(res.rec.body).toBe(JSON.stringify({ error: 'repo not found' }));
  });

  it('passes a non-JSON 200 through untouched', () => {
    const res = makeRes();
    withETag(makeReq(), res);
    res.writeHead(200, { 'Content-Type': 'text/csv' });
    res.end('a,b,c');
    expect(res.rec.status).toBe(200);
    expect(res.rec.headers.ETag).toBeUndefined();
    expect(res.rec.body).toBe('a,b,c');
  });

  it('flushes the deferred head when an intercepted 200 ends with a non-string body', () => {
    const res = makeRes();
    withETag(makeReq(), res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(Buffer.from('{"x":1}'));
    expect(res.rec.status).toBe(200);
    expect(res.rec.headers.ETag).toBeUndefined();
    expect(res.rec.ended).toBe(true);
  });
});
