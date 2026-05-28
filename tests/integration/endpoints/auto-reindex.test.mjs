import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = 'http://localhost:4173';

describe('GET /auto-reindex', () => {
  it('returns per-repo auto-reindex state', async () => {
    const res = await fetch(`${BASE}/auto-reindex`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.reposScanned).toBe('number');
    expect(Array.isArray(body.autoReindex)).toBe(true);
    for (const entry of body.autoReindex) {
      expect(typeof entry.repo).toBe('string');
      expect(typeof entry.enabled).toBe('boolean');
      expect(typeof entry.dueNow).toBe('boolean');
      expect('headSha' in entry).toBe(true);
      expect('lastIndexedSha' in entry).toBe(true);
    }
  });

  it('supports the ?repo= filter', async () => {
    const res = await fetch(`${BASE}/auto-reindex?repo=${encodeURIComponent(FIXTURE.name)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reposScanned).toBe(1);
    // Either the fixture is present (1 entry) or absent (0) — never another repo.
    for (const entry of body.autoReindex) {
      expect(entry.repo).toBe(FIXTURE.name);
    }
  });
});
