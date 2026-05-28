import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

describe('Wiki endpoints', () => {
  const fetchWiki = async (path, options = {}) => {
    const url = `http://localhost:4173${path}`;
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    let body;
    if (contentType.includes('application/json')) {
      body = await res.json();
    } else {
      body = await res.text();
    }
    return { status: res.status, body, contentType };
  };

  it('GET /wiki?repo= returns 200 (text/html) or 404 with {error} JSON', async () => {
    const { status, body, contentType } = await fetchWiki(
      `/wiki?repo=${encodeURIComponent(FIXTURE.name)}`
    );
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(contentType).toMatch(/text\/html/);
      expect(typeof body).toBe('string');
    } else {
      expect(typeof body.error).toBe('string');
    }
  });

  it('GET /wiki without repo param returns 400 with {error} JSON', async () => {
    const { status, body } = await fetchWiki('/wiki');
    expect(status).toBe(400);
    expect(typeof body.error).toBe('string');
  });

  it('GET /wiki/status?repo= returns 200 (with shape) or 502 (worker down)', async () => {
    const { status, body } = await fetchWiki(
      `/wiki/status?repo=${encodeURIComponent(FIXTURE.name)}`
    );
    expect([200, 502]).toContain(status);
    if (status === 200) {
      expect(typeof body.generating).toBe('boolean');
      // lastGeneratedAt may be null or a string
      expect(body).toHaveProperty('lastGeneratedAt');
      // error field present (may be null)
      expect(body).toHaveProperty('error');
    }
  });

  it('POST /wiki/generate?repo= returns 202/409/404/502 with JSON body', async () => {
    const { status, body } = await fetchWiki(
      `/wiki/generate?repo=${encodeURIComponent(FIXTURE.name)}`,
      { method: 'POST' }
    );
    expect([202, 409, 404, 502]).toContain(status);
    // Response must be JSON-shaped (body is an object, not raw text)
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });
});
