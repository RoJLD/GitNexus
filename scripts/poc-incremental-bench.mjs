#!/usr/bin/env node
/**
 * PoC benchmark for Phase C incremental snapshots.
 *
 * For a sample of N commits of a repo, runs POST /snapshot/incremental
 * under each of the 6 predefined filter combos (see docs/superpowers/
 * specs/2026-05-26-incremental-snapshots-phase-c-design.md §3.bis) and
 * reports storage size + timing distributions.
 *
 * Usage:
 *   node scripts/poc-incremental-bench.mjs <repo> [--commits N] [--combos a,b,c]
 *
 * Example:
 *   node scripts/poc-incremental-bench.mjs hmm_studio --commits 10 --combos Standard,Minimal
 *
 * Requires:
 *   - the gitnexus stack up (docker compose up -d)
 *   - the repo indexed and reachable from /api/repos
 *   - git available on the HOST to enumerate commits
 *
 * Notes:
 *   - Each combo×commit pass triggers a real `gitnexus analyze` (~25-50s).
 *     N=10 × 6 combos = 60 analyzes = ~30-50 min. Start small.
 *   - Uses `force: true` so re-running a combo on the same commit
 *     regenerates (otherwise the second combo would hit the idempotency
 *     short-circuit and skip).
 *   - Storage numbers are the persisted file size (post-filter, post-gzip).
 */

import { execSync } from 'node:child_process';
import process from 'node:process';

const WEB = process.env.GITNEXUS_WEB || 'http://localhost:4173';

const COMBOS = {
  Raw: {
    dropGlobalNodes: false, dropEmptyFields: false,
    filterRelationships: 'none', compress: 'none',
  },
  Safe: {
    dropGlobalNodes: true, dropEmptyFields: true,
    filterRelationships: 'none', compress: 'gzip',
  },
  Standard: {
    dropGlobalNodes: true, dropEmptyFields: true,
    filterRelationships: 'effectiveWriteSet', compress: 'gzip',
  },
  Minimal: {
    dropGlobalNodes: true, dropEmptyFields: true,
    filterRelationships: 'effectiveWriteSet',
    includeLabels: ['File', 'Function', 'Class', 'Method'],
    compress: 'gzip',
  },
  Lite: {
    dropGlobalNodes: true, dropEmptyFields: true,
    filterRelationships: 'effectiveWriteSet',
    includeLabels: ['File', 'Function', 'Class', 'Method'],
    includeRelationshipTypes: ['CALLS', 'IMPORTS', 'DEFINES'],
    compress: 'gzip',
  },
  'Lossless-compressed': {
    dropGlobalNodes: false, dropEmptyFields: false,
    filterRelationships: 'none', compress: 'gzip',
  },
};

function parseArgs(argv) {
  const repo = argv[2];
  if (!repo || repo.startsWith('--')) {
    console.error('Usage: node poc-incremental-bench.mjs <repo> [--commits N] [--combos A,B]');
    process.exit(1);
  }
  const opts = { repo, commits: 10, combos: Object.keys(COMBOS) };
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--commits') opts.commits = Number(argv[++i]) || 10;
    else if (argv[i] === '--combos') opts.combos = argv[++i].split(',').map((s) => s.trim());
  }
  return opts;
}

async function repoPathOf(repo) {
  const resp = await fetch(`${WEB.replace('4173', '4747')}/api/repos`);
  const data = await resp.json();
  const list = Array.isArray(data) ? data : data.repos;
  const found = list.find((r) => r.name === repo);
  if (!found) throw new Error(`repo not indexed: ${repo}`);
  return found.repoPath || found.path;
}

function pickCommits(repoHostPath, n) {
  // Enumerate the last n*2 non-merge commits, take an even spread of n.
  const out = execSync(
    `git -C "${repoHostPath}" log --no-merges --pretty=format:%H -n ${n * 3}`,
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);
  if (out.length <= n) return out;
  // Even sampling.
  const step = out.length / n;
  const picked = [];
  for (let i = 0; i < n; i++) picked.push(out[Math.floor(i * step)]);
  return picked;
}

async function runOne(repo, sha, filters, reuseDump) {
  const t0 = Date.now();
  const resp = await fetch(
    `${WEB}/snapshot/incremental?repo=${encodeURIComponent(repo)}&commit=${sha}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // First combo per commit: analyze (force regenerates). Subsequent
      // combos: reuseDump → re-filter the same dump, no analyze (6× faster).
      body: JSON.stringify({ filters, force: true, reuseDump: !!reuseDump }),
    },
  );
  const body = await resp.json().catch(() => ({}));
  const wallMs = Date.now() - t0;
  if (!resp.ok) return { ok: false, error: body?.error || `HTTP ${resp.status}`, wallMs };
  return { ok: true, stats: body.stats, timings: body.timings, wallMs };
}

function pctl(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function main() {
  const opts = parseArgs(process.argv);

  // The repoPath the gitnexus stack knows is the container path; the
  // host path (for `git log`) is the same string under PROJECTS_ROOT.
  // We derive the host path by replacing the /data/projects prefix with
  // the host PROJECTS_ROOT. Simpler: just `git log` against the known
  // local checkout via the container path mapped to host.
  const containerRepoPath = await repoPathOf(opts.repo);
  // Map /data/projects/... → host PROJECTS_ROOT/...
  const projectsRoot = process.env.PROJECTS_ROOT || 'C:/Users/rdenis/VScode';
  const hostRepoPath = containerRepoPath.replace('/data/projects', projectsRoot);

  console.log(`Repo: ${opts.repo}`);
  console.log(`  container path: ${containerRepoPath}`);
  console.log(`  host path:      ${hostRepoPath}`);
  console.log(`Commits: ${opts.commits} | Combos: ${opts.combos.join(', ')}`);
  console.log('');

  const commits = pickCommits(hostRepoPath, opts.commits);
  console.log(`Sampled ${commits.length} commits.\n`);

  const results = {}; // combo -> { sizes:[], wallMs:[], analyzeMs:[], errors:[] }
  for (const combo of opts.combos) results[combo] = { sizes: [], wallMs: [], analyzeMs: [], errors: [] };

  let pass = 0;
  const totalRuns = commits.length * opts.combos.length;
  for (const sha of commits) {
    let comboIdx = 0;
    for (const combo of opts.combos) {
      pass++;
      // First combo per commit analyzes; the rest reuse the dump.
      const reuseDump = comboIdx > 0;
      comboIdx++;
      process.stdout.write(`[${pass}/${totalRuns}] ${combo} @ ${sha.slice(0, 7)}${reuseDump ? ' (reuse)' : ' (analyze)'} ... `);
      const r = await runOne(opts.repo, sha, COMBOS[combo], reuseDump);
      if (!r.ok) {
        results[combo].errors.push({ sha: sha.slice(0, 7), error: r.error });
        console.log(`ERROR: ${r.error}`);
        continue;
      }
      results[combo].sizes.push(r.stats.finalBytes);
      results[combo].wallMs.push(r.wallMs);
      results[combo].analyzeMs.push(r.timings.analyzeMs);
      console.log(
        `${fmtBytes(r.stats.finalBytes)} ` +
        `(${r.stats.filteredNodes}/${r.stats.rawNodes} nodes, ` +
        `${r.stats.filteredRelationships}/${r.stats.rawRelationships} rels, ` +
        `${(r.wallMs / 1000).toFixed(0)}s)`,
      );
    }
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('SUMMARY (per combo)');
  console.log('══════════════════════════════════════════════════════════');
  console.log(
    'Combo'.padEnd(22) + 'p50'.padStart(10) + 'p90'.padStart(10) +
    'max'.padStart(10) + 'errors'.padStart(8),
  );
  for (const combo of opts.combos) {
    const r = results[combo];
    console.log(
      combo.padEnd(22) +
      fmtBytes(pctl(r.sizes, 50)).padStart(10) +
      fmtBytes(pctl(r.sizes, 90)).padStart(10) +
      fmtBytes(Math.max(0, ...r.sizes)).padStart(10) +
      String(r.errors.length).padStart(8),
    );
  }
  console.log('');
  // Projection to 1000 commits.
  console.log('PROJECTION → 1000 commits (using p50):');
  for (const combo of opts.combos) {
    const p50 = pctl(results[combo].sizes, 50);
    console.log(`  ${combo.padEnd(22)} ${fmtBytes(p50 * 1000)}`);
  }
  console.log('');
  const allAnalyze = opts.combos.flatMap((c) => results[c].analyzeMs);
  console.log(`Analyze wall time: p50=${(pctl(allAnalyze, 50) / 1000).toFixed(0)}s p90=${(pctl(allAnalyze, 90) / 1000).toFixed(0)}s`);
}

main().catch((e) => {
  console.error('Bench failed:', e.message);
  process.exit(1);
});
