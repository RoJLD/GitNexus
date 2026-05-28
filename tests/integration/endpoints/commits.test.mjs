import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /commits', () => {
  it('400 when repo missing', async () => {
    const res = await fetch(`${BASE}/commits`);
    expect(res.status).toBe(400);
  });

  it('404 for an unknown repo', async () => {
    const res = await fetch(`${BASE}/commits?repo=does-not-exist-xyz`);
    expect(res.status).toBe(404);
  });

  it('200 returns commits newest-first with the expected shape', async () => {
    const res = await fetch(`${BASE}/commits?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.commits)).toBe(true);
    expect(data.commits.length).toBeGreaterThanOrEqual(12);
    const c = data.commits[0];
    expect(c).toHaveProperty('hash');
    expect(c).toHaveProperty('shortHash');
    expect(c).toHaveProperty('message');
    expect(c).toHaveProperty('date');
    // newest-first : la première date >= la dernière
    expect(data.commits[0].date >= data.commits[data.commits.length - 1].date).toBe(true);
    // le plus ancien commit du fixture est le scaffold
    expect(data.commits[data.commits.length - 1].message).toBe('feat: scaffold project');
  });

  it('max caps the result and sets truncated', async () => {
    const res = await fetch(`${BASE}/commits?repo=${FIXTURE.name}&max=3`);
    const data = await res.json();
    expect(data.commits).toHaveLength(3);
    expect(data.truncated).toBe(true);
  });

  it('from truncates the list inclusive at that commit', async () => {
    const all = await (await fetch(`${BASE}/commits?repo=${FIXTURE.name}`)).json();
    const mid = all.commits[5].hash;
    const res = await fetch(`${BASE}/commits?repo=${FIXTURE.name}&from=${mid}`);
    const data = await res.json();
    expect(data.commits[data.commits.length - 1].hash).toBe(mid);
    expect(data.commits).toHaveLength(6);
  });
});
