#!/usr/bin/env node
// Dry-run d'un bump upstream : clone une cible, applique additive-files.diff
// (doit être clean) puis inplace-edits.diff en --3way, et imprime un rapport
// fichier-par-fichier. N'écrit jamais dans le dépôt courant.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UPSTREAM_URL = 'https://github.com/abhigyanpatwari/gitnexus.git';

export function formatBumpReport(target, results) {
  const by = (s) => results.filter((r) => r.status === s);
  const clean = by('clean');
  const conflict = by('conflict');
  const fail = by('fail');
  const lines = [];
  lines.push(`# Bump dry-run report — cible \`${target}\``);
  lines.push('');
  lines.push(`- clean: ${clean.length}`);
  lines.push(`- conflict: ${conflict.length}`);
  lines.push(`- fail: ${fail.length}`);
  lines.push('');
  if (conflict.length === 0 && fail.length === 0) {
    lines.push('**Bump trivial — aucun conflit détecté.**');
  } else {
    lines.push('## Fichiers à reprendre à la main');
    for (const r of [...conflict, ...fail]) {
      lines.push(`- [${r.status}] (${r.layer}) ${r.file}`);
    }
  }
  lines.push('');
  lines.push('## Détail');
  for (const r of results) {
    lines.push(`- [${r.status}] (${r.layer}) ${r.file}`);
  }
  return lines.join('\n');
}

function listDiffFiles(cwd, diffPath) {
  // `git apply --numstat` lists "added\tdeleted\tpath" per file in the diff.
  return execFileSync('git', ['apply', '--numstat', diffPath], { cwd, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
    .map((l) => l.split('\t').pop());
}

function applyPerFile(cwd, diffPath, layer, mode) {
  const files = listDiffFiles(cwd, diffPath);
  const results = [];
  for (const file of files) {
    try {
      execFileSync('git', ['apply', ...mode, '--include', file, diffPath], { cwd, stdio: 'pipe' });
      // In --3way mode, a "successful" apply can still leave conflict markers.
      let hasMarkers = false;
      if (mode.includes('--3way')) {
        try { hasMarkers = /^<{7} /m.test(readFileSync(join(cwd, file), 'utf8')); }
        catch { hasMarkers = false; }
      }
      results.push({ file, layer, status: hasMarkers ? 'conflict' : 'clean' });
    } catch {
      results.push({ file, layer, status: 'fail' });
    }
  }
  return results;
}

function main() {
  const target = process.argv[2];
  if (!target) { console.error('usage: bump-upstream.mjs <tag-or-branch>'); process.exit(2); }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const tmp = mkdtempSync(join(tmpdir(), 'gnx-bump-'));
  try {
    execFileSync('git', ['clone', '--depth', '1', '--branch', target, UPSTREAM_URL, tmp], { stdio: 'inherit' });
    const additive = applyPerFile(tmp, join(repoRoot, 'patches/additive-files.diff'), 'additive', ['--check']);
    const inplace = applyPerFile(tmp, join(repoRoot, 'patches/inplace-edits.diff'), 'inplace', ['--3way']);
    const report = formatBumpReport(target, [...additive, ...inplace]);
    const safe = target.replace(/[^a-z0-9.-]/gi, '-');
    const out = join(repoRoot, `patches/bump-dry-run-${safe}.md`);
    writeFileSync(out, report + '\n');
    console.log(report);
    console.log(`\nRapport écrit dans ${out}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
