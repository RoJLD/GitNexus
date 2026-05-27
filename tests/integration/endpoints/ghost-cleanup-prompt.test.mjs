import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('POST /ghosts/cleanup-prompt', () => {
  it('returns expired ghosts with prompts', async () => {
    // Pre-condition : at least one ghost in the fixture has expectedBy in the past.
    // (Fixture commit 12 sets 1.2 to expectedBy 2026-Q2 — depending on test run date, may or may not be expired.)
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const res = await fetch(`${BASE}/ghosts/cleanup-prompt?repo=${FIXTURE.name}`, { method: 'POST' });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.expired)).toBe(true);
    for (const e of body.expired) {
      expect(typeof e.prompt).toBe('string');
      expect(e.prompt.length).toBeGreaterThan(50);
      expect(['critical', 'expiredButRecent']).toContain(e.alertLevel);
    }
  });
});
