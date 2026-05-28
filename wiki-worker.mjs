#!/usr/bin/env node
/**
 * Code Wiki generation worker — runs in the gitnexus server container next to
 * the API server. Exposes a tiny HTTP trigger that spawns the public
 * `gitnexus wiki <repoPath>` CLI headlessly (non-TTY → LLM config from env:
 * GITNEXUS_API_KEY / GITNEXUS_MODEL / GITNEXUS_LLM_BASE_URL). Generation is
 * async (minutes); the trigger returns 202 immediately. Status is reported via
 * an in-memory map + the mtime of <repoPath>/.gitnexus/wiki/meta.json.
 *
 * Zero-dep (Node http + child_process + fs). See spec § 4.2.
 * Internal port 4748 (compose-internal, not host-exposed).
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.WIKI_WORKER_PORT) || 4748;
const API = process.env.GITNEXUS_API || 'http://localhost:4747';
const GITNEXUS_BIN = process.env.GITNEXUS_BIN || 'gitnexus';

// repoName -> { generating: bool, error: string|null, finishedAt: number|null }
const state = new Map();

async function resolveRepoPath(name) {
  try {
    const res = await fetch(`${API}/api/repos`);
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.repos;
    const repo = Array.isArray(list) ? list.find((r) => r.name === name) : null;
    return repo ? repo.repoPath || repo.path || null : null;
  } catch {
    return null;
  }
}

function lastGeneratedAt(repoPath) {
  try {
    return statSync(join(repoPath, '.gitnexus', 'wiki', 'meta.json')).mtimeMs;
  } catch {
    return null;
  }
}

function startGeneration(name, repoPath) {
  state.set(name, { generating: true, error: null, finishedAt: null });
  // Non-interactive: CLI reads LLM config from env. Inherit container env.
  const child = spawn(GITNEXUS_BIN, ['wiki', repoPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });
  child.on('error', (err) => {
    state.set(name, { generating: false, error: String(err && err.message || err), finishedAt: Date.now() });
  });
  child.on('close', (code) => {
    state.set(name, {
      generating: false,
      error: code === 0 ? null : `gitnexus wiki exited ${code}: ${stderr.trim().slice(-500)}`,
      finishedAt: Date.now(),
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const repo = url.searchParams.get('repo');
  const json = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/generate' && req.method === 'POST') {
    if (!repo) return json(400, { error: 'missing repo' });
    const cur = state.get(repo);
    if (cur && cur.generating) return json(409, { generating: true });
    const repoPath = await resolveRepoPath(repo);
    if (!repoPath) return json(404, { error: 'repo not found' });
    startGeneration(repo, repoPath);
    return json(202, { started: true });
  }

  if (url.pathname === '/status' && req.method === 'GET') {
    if (!repo) return json(400, { error: 'missing repo' });
    const repoPath = await resolveRepoPath(repo);
    const cur = state.get(repo) || { generating: false, error: null };
    const lga = repoPath ? lastGeneratedAt(repoPath) : null;
    return json(200, {
      generating: !!cur.generating,
      lastGeneratedAt: lga ? new Date(lga).toISOString() : null,
      error: cur.error || null,
    });
  }

  if (url.pathname === '/health') return json(200, { ok: true });
  json(404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`[wiki-worker] listening on :${PORT} · bin=${GITNEXUS_BIN} · api=${API}\n`);
});
