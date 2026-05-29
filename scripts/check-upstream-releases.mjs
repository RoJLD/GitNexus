#!/usr/bin/env node
// Veille de divergence EXTERNE : compare notre pin de version à la dernière
// release stable upstream (via git ls-remote, pas d'API key requise).
// Alerte (exit 10), n'agit pas. exit 0 = à jour ; exit 2 = erreur.
// Voir docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md §3.4
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UPSTREAM_URL = 'https://github.com/abhigyanpatwari/gitnexus.git';

export function parsePinnedVersion(dockerfileText) {
  const m = dockerfileText.match(/gitnexus:(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

export function parseStableTags(lsRemoteOutput) {
  return [...lsRemoteOutput.matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)$/gm)].map((m) => m[1]);
}

// Suppose des entrées validées « vX.Y.Z » (le filtre de compareToLatest le garantit) ; NaN sinon.
export function cmpSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function compareToLatest(pinned, tags) {
  const pin = pinned.startsWith('v') ? pinned : `v${pinned}`;
  const stable = tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).slice().sort(cmpSemver);
  const latest = stable.length ? stable[stable.length - 1] : null;
  const newer = stable.filter((t) => cmpSemver(t, pin) > 0);
  return { pinned: pin, latest, newer, upToDate: latest !== null && newer.length === 0 };
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pinned = parsePinnedVersion(readFileSync(resolve(repoRoot, 'Dockerfile.cli'), 'utf8'));
  if (!pinned) { console.error('check-upstream-releases: pin introuvable dans Dockerfile.cli'); process.exit(2); }
  let lsRemote;
  try {
    lsRemote = execFileSync('git', ['ls-remote', '--tags', UPSTREAM_URL], { encoding: 'utf8' });
  } catch {
    console.error('check-upstream-releases: échec de git ls-remote — réseau ?'); process.exit(2);
  }
  const r = compareToLatest(pinned, parseStableTags(lsRemote));
  if (r.upToDate) {
    console.log(`à jour : pin ${r.pinned} == dernière release stable (${r.latest}).`);
    process.exit(0);
  }
  console.log(`ALERTE : pin ${r.pinned}, dernière stable ${r.latest}. Plus récentes : ${r.newer.join(', ')}.`);
  console.log('Veille seulement — aucune action. Bump = décision conservatrice (cf. contrat §3.1).');
  process.exit(10);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
