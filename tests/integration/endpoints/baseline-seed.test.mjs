import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('baseline-seed + promote', () => {
  it('400 when repo/commit missing', async () => {
    expect((await fetch(`${BASE}/snapshot/baseline-seed`, { method: 'POST' })).status).toBe(400);
    expect((await fetch(`${BASE}/snapshot/promote`, { method: 'POST' })).status).toBe(400);
  });

  it('seeds a hidden baseline, hides it from /snapshots, then promote reveals it', async () => {
    // oldest commit du fixture
    const commits = await (await fetch(`${BASE}/commits?repo=${FIXTURE.name}`)).json();
    const oldest = commits.commits[commits.commits.length - 1];

    const seed = await fetch(
      `${BASE}/snapshot/baseline-seed?repo=${FIXTURE.name}&commit=${oldest.hash}`,
      { method: 'POST' },
    );
    expect(seed.status).toBe(202);
    const { jobId } = await seed.json();

    // poll jusqu'à done (analyze peut prendre ~1-2 min sur le petit fixture)
    let state = 'running';
    for (let i = 0; i < 120 && state === 'running'; i++) {
      await sleep(2000);
      const s = await (await fetch(`${BASE}/snapshot/baseline-seed/${jobId}`)).json();
      state = s.state;
    }
    expect(state).toBe('done');

    // exclu par défaut, présent avec includeHidden + hidden:true
    const def = await (await fetch(`${BASE}/snapshots?repo=${FIXTURE.name}`)).json();
    const withHidden = await (
      await fetch(`${BASE}/snapshots?repo=${FIXTURE.name}&includeHidden=true`)
    ).json();
    const inDefault = def.snapshots.some((s) => s.commit.shortHash === oldest.shortHash);
    const hiddenEntry = withHidden.snapshots.find((s) => s.commit.shortHash === oldest.shortHash);
    expect(inDefault).toBe(false);
    expect(hiddenEntry?.hidden).toBe(true);

    // promote → réapparaît dans le listing par défaut
    expect(
      (await fetch(`${BASE}/snapshot/promote?repo=${FIXTURE.name}&commit=${oldest.hash}`, { method: 'POST' })).status,
    ).toBe(200);
    const after = await (await fetch(`${BASE}/snapshots?repo=${FIXTURE.name}`)).json();
    expect(after.snapshots.some((s) => s.commit.shortHash === oldest.shortHash)).toBe(true);
  });
});
