#!/usr/bin/env node
// Garde de dérive INTERNE : régénère le split depuis le clone upstream/ et le
// compare aux patches/*.diff commités. exit≠0 + rapport si divergence.
// Voir docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md §3.3
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function filesInDiff(diffText) {
  const set = new Set();
  for (const line of diffText.split('\n')) {
    const m = line.match(/^diff --git a\/(.+?) b\//);
    if (m) set.add(m[1]);
  }
  return set;
}

export function compareDiffFileSets(committed, live) {
  const missing = [...live].filter((f) => !committed.has(f)).sort(); // dans le clone, pas commité
  const extra = [...committed].filter((f) => !live.has(f)).sort();   // commité, disparu du clone
  return { missing, extra, drifted: missing.length > 0 || extra.length > 0 };
}

// git diff émet du LF ; on neutralise un .diff sauvé en CRLF. BOM non géré (les patches/ sont LF sans BOM).
export function normalizeDiff(text) {
  return text.replace(/\r\n/g, '\n');
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const up = resolve(repoRoot, 'upstream');
  let drifted = false;
  try {
    execFileSync('git', ['add', '-N', '.'], { cwd: up });
    for (const [filter, file] of [['A', 'additive-files.diff'], ['M', 'inplace-edits.diff']]) {
      const liveText = execFileSync('git', ['diff', 'HEAD', `--diff-filter=${filter}`], { cwd: up, encoding: 'utf8' });
      let committedText;
      try {
        committedText = readFileSync(resolve(repoRoot, 'patches', file), 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') {
          console.error(`patches/${file} introuvable — régénérer depuis upstream/.`);
          drifted = true;
          continue;
        }
        throw e;
      }
      const liveFiles = filesInDiff(liveText);
      const committedFiles = filesInDiff(committedText);
      const setCmp = compareDiffFileSets(committedFiles, liveFiles);
      const contentDrift = normalizeDiff(liveText) !== normalizeDiff(committedText);
      if (setCmp.drifted || contentDrift) {
        drifted = true;
        console.error(`DÉRIVE — ${file}:`);
        setCmp.missing.forEach((f) => console.error(`  + ${f} (dans upstream/, absent du diff commité)`));
        setCmp.extra.forEach((f) => console.error(`  - ${f} (dans le diff commité, disparu d'upstream/)`));
        if (!setCmp.drifted && contentDrift) console.error('  (même ensemble de fichiers, mais contenu divergent)');
      } else {
        console.log(`${file}: OK (${liveFiles.size} fichiers)`);
      }
    }
  } finally {
    execFileSync('git', ['reset'], { cwd: up });
  }
  if (drifted) {
    console.error('\nRégénérer : voir patches/README.md « Regenerate the diffs ».');
    process.exit(1);
  }
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
