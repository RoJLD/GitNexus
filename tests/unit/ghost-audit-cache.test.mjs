import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCacheValid } from '../../upstream/docker-server-ghost-audit.mjs';

describe('isCacheValid', () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'audit-cache-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('returns false when cache does not exist', async () => {
    expect(await isCacheValid(join(dir, 'cache.json'), dir)).toBe(false);
  });

  it('returns true when cache is newer than all CORE sidecars', async () => {
    await mkdir(join(dir, '.gitnexus'), { recursive: true });
    await writeFile(join(dir, '.gitnexus', 'ghosts.json'), '{}');
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(dir, '.gitnexus', 'cache.json'), '{}');
    expect(await isCacheValid(join(dir, '.gitnexus', 'cache.json'), dir)).toBe(true);
  });

  it('returns false when a snapshot ghosts.json is newer than cache', async () => {
    await mkdir(join(dir, '.gitnexus', 'snapshots', 's1'), { recursive: true });
    await writeFile(join(dir, '.gitnexus', 'ghosts.json'), '{}');
    await writeFile(join(dir, '.gitnexus', 'cache.json'), '{}');
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(dir, '.gitnexus', 'snapshots', 's1', 'ghosts.json'), '{}');
    expect(await isCacheValid(join(dir, '.gitnexus', 'cache.json'), dir)).toBe(false);
  });
});
