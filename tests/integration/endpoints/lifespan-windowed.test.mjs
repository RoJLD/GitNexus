import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

describe('GET /lifespan windowed mode', () => {
  const fetchLifespan = async (repo, params = '') => {
    const url = `http://localhost:4173/lifespan?repo=${encodeURIComponent(repo)}${params}`;
    const res = await fetch(url);
    return { status: res.status, body: res.ok ? await res.json() : await res.text() };
  };

  it('returns global response (no windowed field) when no from/to', async () => {
    const { status, body } = await fetchLifespan(FIXTURE.name);
    expect(status).toBe(200);
    expect(body.windowed).toBeUndefined();
    expect(body.counts).toBeDefined();
    expect(body.nodes).toBeDefined();
  });

  it('returns windowed response with windowed field when from/to set', async () => {
    const api = getApi();
    const snapshots = (await api.listSnapshots(FIXTURE.name)).snapshots || [];
    expect(snapshots.length).toBeGreaterThan(1);
    const sorted = snapshots
      .slice()
      .sort((a, b) => (a.commit?.date || '').localeCompare(b.commit?.date || ''));
    const from = sorted[0].commit.shortHash;
    const to = sorted[sorted.length - 1].commit.shortHash;

    const { status, body } = await fetchLifespan(FIXTURE.name, `&from=${from}&to=${to}`);
    expect(status).toBe(200);
    expect(body.windowed).toBeDefined();
    expect(body.windowed.from).toBe(from);
    expect(body.windowed.to).toBe(to);
    expect(body.windowed.snapshotCount).toBe(sorted.length);
    expect(body.counts.foundational + body.counts.recent + body.counts.discontinued + body.counts.ephemeral).toBeGreaterThanOrEqual(0);
  });

  it('returns 400 when only from is set (windowed needs both)', async () => {
    const api = getApi();
    const snapshots = (await api.listSnapshots(FIXTURE.name)).snapshots || [];
    const sorted = snapshots
      .slice()
      .sort((a, b) => (a.commit?.date || '').localeCompare(b.commit?.date || ''));
    const { status } = await fetchLifespan(FIXTURE.name, `&from=${sorted[0].commit.shortHash}`);
    expect(status).toBe(400);
  });

  it('returns 400 on invalid range (from > to)', async () => {
    const api = getApi();
    const snapshots = (await api.listSnapshots(FIXTURE.name)).snapshots || [];
    const sorted = snapshots
      .slice()
      .sort((a, b) => (a.commit?.date || '').localeCompare(b.commit?.date || ''));
    expect(sorted.length).toBeGreaterThan(1);
    const reversedFrom = sorted[sorted.length - 1].commit.shortHash;
    const reversedTo = sorted[0].commit.shortHash;
    const { status } = await fetchLifespan(FIXTURE.name, `&from=${reversedFrom}&to=${reversedTo}`);
    expect(status).toBe(400);
  });

  it('resolves "oldest"/"live" aliases like /nodes/alive-between', async () => {
    const { status, body } = await fetchLifespan(FIXTURE.name, `&from=oldest&to=live`);
    expect(status).toBe(200);
    expect(body.windowed).toBeDefined();
    expect(body.windowed.from).not.toBe('oldest');
    expect(body.windowed.to).not.toBe('live');
  });
});
