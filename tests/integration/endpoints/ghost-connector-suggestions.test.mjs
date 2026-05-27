import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /ghosts/connector-suggestions', () => {
  it('returns empty when no connectors configured', async () => {
    const res = await fetch(`${BASE}/ghosts/connector-suggestions?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ suggestions: [] });
  });
});
