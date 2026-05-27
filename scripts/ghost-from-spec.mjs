#!/usr/bin/env node
/**
 * CLI : parses a spec markdown and upserts its row in ROADMAP.md.
 * Optionally posts /ghosts/sync if GITNEXUS_PORT is set.
 *
 * Usage: node scripts/ghost-from-spec.mjs <path-to-spec.md>
 *
 * See docs/superpowers/specs/2026-05-26-roadmap-predictive-brainstorm-hook-design.md
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { parseSpec } from './ghost-from-spec-parser.mjs';
import { upsertManagedSection } from './ghost-from-spec-roadmap.mjs';

function findRoadmapMd(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 20; i++) {
    const candidate = join(dir, 'ROADMAP.md');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function main(argv) {
  const specPath = argv[2];
  if (!specPath) {
    console.error('Usage: node scripts/ghost-from-spec.mjs <path-to-spec.md>');
    process.exit(2);
  }
  const resolved = resolve(specPath);
  if (!existsSync(resolved)) {
    console.error(`Spec file not found: ${resolved}`);
    process.exit(1);
  }
  const md = await readFile(resolved, 'utf8');
  const ghost = parseSpec(resolved, md);

  const roadmapPath = findRoadmapMd(dirname(resolved));
  if (!roadmapPath) {
    console.error('Could not find ROADMAP.md walking up from the spec file.');
    process.exit(1);
  }
  const roadmapMd = await readFile(roadmapPath, 'utf8');
  // Make the spec link repo-relative + POSIX-style so the markdown link
  // works on GitHub and any markdown viewer regardless of where the repo
  // is cloned. `path.relative` yields a path with the host OS separator,
  // which on Windows is '\' — normalize to '/'.
  const roadmapDir = dirname(roadmapPath);
  const specPathForLink = relative(roadmapDir, resolved).replaceAll('\\', '/');
  const updated = upsertManagedSection(roadmapMd, ghost, specPathForLink);

  if (updated === roadmapMd) {
    console.log(`No change to ROADMAP.md (ghost ${ghost.id} already up-to-date).`);
  } else {
    await writeFile(roadmapPath, updated);
    console.log(`Updated ROADMAP.md with ghost ${ghost.id} (${ghost.title}).`);
  }

  // Optional : POST /ghosts/sync if a port is configured.
  const port = process.env.GITNEXUS_PORT;
  if (port) {
    try {
      const repoBase = roadmapPath.split(/[\\/]/).slice(-2, -1)[0]; // crude: parent dir name
      const res = await fetch(`http://localhost:${port}/ghosts/sync?repo=${encodeURIComponent(repoBase)}`, { method: 'POST' });
      if (res.ok) console.log(`POST /ghosts/sync OK (repo=${repoBase}).`);
      else console.warn(`POST /ghosts/sync failed: HTTP ${res.status}`);
    } catch (err) {
      console.warn(`Could not POST /ghosts/sync: ${err.message}`);
    }
  }
}

main(process.argv).catch(err => { console.error(err.message); process.exit(1); });
