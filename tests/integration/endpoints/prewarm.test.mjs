import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('/snapshot/prewarm', () => {
  it('400 when repo missing (GET + POST)', async () => {
    expect((await fetch(`${BASE}/snapshot/prewarm`)).status).toBe(400);
    expect((await fetch(`${BASE}/snapshot/prewarm`, { method: 'POST' })).status).toBe(400);
  });

  it('404 for unknown repo', async () => {
    expect((await fetch(`${BASE}/snapshot/prewarm?repo=nope-xyz`)).status).toBe(404);
  });

  it('GET returns { total, warm, cold } over the last N commits', async () => {
    const res = await fetch(`${BASE}/snapshot/prewarm?repo=${FIXTURE.name}&max=5`);
    expect(res.ok).toBe(true);
    const d = await res.json();
    expect(d).toHaveProperty('total');
    expect(d).toHaveProperty('warm');
    expect(d).toHaveProperty('cold');
    expect(d.total).toBeGreaterThanOrEqual(1);
    expect(d.warm + d.cold).toBe(d.total);
  });

  it('POST returns 202 { queued } (fire-and-forget)', async () => {
    const res = await fetch(`${BASE}/snapshot/prewarm?repo=${FIXTURE.name}&max=2`, { method: 'POST' });
    expect(res.status).toBe(202);
    const d = await res.json();
    expect(d).toHaveProperty('queued');
  });
});
