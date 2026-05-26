/**
 * GitNexus (local) — VSCode extension MVP.
 *
 * Shows the bus factor (or commit count) of the file you're editing in
 * the status bar, fetched from a local gitnexus-web deployment. Click
 * the status bar item to open the GitNexus web UI in your browser.
 *
 * Scope (deliberate MVP):
 *   - Status bar item, updated on active editor change.
 *   - Two commands: refresh + open web UI.
 *   - Config: gitnexus.serverUrl (default http://localhost:4173)
 *             gitnexus.statusBarMetric ("busFactor" | "totalCommits")
 *
 * Out of scope for v0.1, by design:
 *   - Gutter decorations + per-line color (needs careful per-language
 *     setup; the status-bar value is the highest-signal anchor).
 *   - Hover providers (need to map editor symbols → graph nodes, which
 *     means more than just file ownership).
 *   - MCP / gitnexus_context wiring (the deployment already exposes
 *     MCP at localhost:4747/api/mcp; an extension that wraps it would
 *     duplicate Claude Code's existing integration).
 *
 * Architecture is intentionally one file: there's so little state that
 * splitting it into modules would obscure rather than clarify.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';

interface GitNexusRepo {
  name: string;
  path: string;
  repoPath?: string;
}

interface OwnershipFile {
  path: string;
  busFactor: number;
  totalCommits: number;
  authors: { name: string; commits: number; share: number }[];
}

interface OwnershipResponse {
  totalFiles: number;
  authorsCount: number;
  files: OwnershipFile[];
  repoBusFactor: number;
}

interface Cache {
  reposByPathPrefix: { name: string; absPath: string }[];
  ownership: Record<string, Map<string, OwnershipFile>>; // repoName → filePath → file
  serverUrl: string;
  reposFetchedAt: number;
}

const cache: Cache = {
  reposByPathPrefix: [],
  ownership: {},
  serverUrl: '',
  reposFetchedAt: 0,
};

// Re-fetch the repo list at most every five minutes. The user can force
// a refresh via the command. We don't watch /api/repos for changes —
// it's a small list and gets out of date slowly in practice.
const REPO_LIST_TTL_MS = 5 * 60 * 1000;

let statusBar: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'gitnexus.openWebUI';
  statusBar.tooltip = 'GitNexus (click to open the web UI). Use the command palette to refresh.';
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('gitnexus.refresh', async () => {
      // Drop the per-repo cache so the next update re-hits /ownership.
      cache.ownership = {};
      cache.reposFetchedAt = 0;
      await updateStatusBar();
      vscode.window.setStatusBarMessage('GitNexus: refreshed', 2000);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitnexus.openWebUI', async () => {
      const url = getServerUrl();
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  // Trigger updates: when the active editor changes, when the user opens
  // a different file, and when the config changes (server URL etc).
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar()),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gitnexus')) {
        cache.reposFetchedAt = 0;
        cache.ownership = {};
        updateStatusBar();
      }
    }),
  );

  // Best-effort initial paint — don't block activation on it.
  updateStatusBar().catch(() => {});
}

export function deactivate(): void {
  statusBar?.hide();
  statusBar?.dispose();
  statusBar = undefined;
}

function getServerUrl(): string {
  return (
    vscode.workspace.getConfiguration('gitnexus').get<string>('serverUrl') ||
    'http://localhost:4173'
  );
}

function getMetricChoice(): 'busFactor' | 'totalCommits' {
  return (
    (vscode.workspace.getConfiguration('gitnexus').get<string>('statusBarMetric') as
      | 'busFactor'
      | 'totalCommits') || 'busFactor'
  );
}

/**
 * Minimal JSON fetch over Node's http/https — no extra deps. Times out
 * at 5s to keep the editor responsive even when the server is offline.
 */
function fetchJson<T>(rawUrl: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      reject(new Error(`bad URL: ${rawUrl}`));
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, (res) => {
      if (!res.statusCode || res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} on ${rawUrl}`));
        res.resume();
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as T);
        } catch (err) {
          reject(new Error(`invalid JSON from ${rawUrl}: ${(err as Error).message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms on ${rawUrl}`));
    });
  });
}

async function refreshRepoList(): Promise<void> {
  const serverUrl = getServerUrl();
  const now = Date.now();
  if (
    cache.serverUrl === serverUrl &&
    cache.reposByPathPrefix.length > 0 &&
    now - cache.reposFetchedAt < REPO_LIST_TTL_MS
  ) {
    return;
  }
  const repos = await fetchJson<GitNexusRepo[] | { repos: GitNexusRepo[] }>(
    `${serverUrl}/api/repos`,
    5000,
  ).catch(() => null);
  if (!repos) {
    cache.reposByPathPrefix = [];
    cache.serverUrl = serverUrl;
    cache.reposFetchedAt = now;
    return;
  }
  const list = Array.isArray(repos) ? repos : repos.repos || [];
  // The server-side `path` is the gitnexus container view
  // (/data/projects/...). We can't match that against the user's editor
  // file path directly — but the *suffix* almost always matches: the
  // last segment of the gitnexus path == the folder name on disk. So
  // we collect both the raw path and the basename as fallback matches.
  cache.reposByPathPrefix = list
    .filter((r) => typeof r.name === 'string' && !r.name.includes('@'))
    .map((r) => ({
      name: r.name,
      absPath: (r.repoPath || r.path || '').replace(/\\/g, '/'),
    }));
  cache.serverUrl = serverUrl;
  cache.reposFetchedAt = now;
}

/**
 * Walk up from the active file to find the first ancestor folder whose
 * basename matches a registered repo name. This is fragile (relies on
 * names matching the user's local folder) but accurate enough for the
 * common case: a user who indexed `~/code/myapp` has it registered as
 * `myapp` in the server.
 */
function findRepoForFile(filePath: string): { repoName: string; relativePath: string } | null {
  if (cache.reposByPathPrefix.length === 0) return null;
  const norm = filePath.replace(/\\/g, '/');
  const parts = norm.split('/');
  // Try every prefix from deepest to root.
  for (let cut = parts.length - 1; cut >= 1; cut--) {
    const folderName = parts[cut - 1];
    const match = cache.reposByPathPrefix.find((r) => r.name === folderName);
    if (match) {
      return { repoName: match.name, relativePath: parts.slice(cut).join('/') };
    }
  }
  return null;
}

async function getOwnershipForRepo(repoName: string): Promise<Map<string, OwnershipFile>> {
  if (cache.ownership[repoName]) return cache.ownership[repoName];
  const data = await fetchJson<OwnershipResponse>(
    `${getServerUrl()}/ownership?repo=${encodeURIComponent(repoName)}`,
    15_000,
  ).catch(() => null);
  const map = new Map<string, OwnershipFile>();
  if (data?.files) {
    for (const f of data.files) map.set(f.path, f);
  }
  cache.ownership[repoName] = map;
  return map;
}

async function updateStatusBar(): Promise<void> {
  if (!statusBar) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    statusBar.hide();
    return;
  }
  await refreshRepoList();
  const match = findRepoForFile(editor.document.uri.fsPath);
  if (!match) {
    statusBar.text = '$(question) GitNexus: no repo match';
    statusBar.tooltip = `No registered repo matches a parent folder of ${editor.document.uri.fsPath}. Check gitnexus.serverUrl in settings.`;
    statusBar.show();
    return;
  }

  const ownership = await getOwnershipForRepo(match.repoName);
  const fileOwnership = ownership.get(match.relativePath);
  if (!fileOwnership) {
    statusBar.text = `$(file) GitNexus[${match.repoName}]: unknown file`;
    statusBar.tooltip = `${match.relativePath} has no git-log history in ${match.repoName}. Untracked, new, or under .gitignore.`;
    statusBar.show();
    return;
  }

  const metric = getMetricChoice();
  if (metric === 'totalCommits') {
    statusBar.text = `$(history) GitNexus: ${fileOwnership.totalCommits} commits`;
  } else {
    const bf = fileOwnership.busFactor;
    const icon = bf <= 1 ? '$(warning)' : bf === 2 ? '$(alert)' : '$(check)';
    statusBar.text = `${icon} GitNexus: BF ${bf}`;
  }
  // Always pack the top contributors into the tooltip — same data the
  // OwnershipPanel shows on hover in the web UI.
  const topAuthors = fileOwnership.authors
    .slice(0, 3)
    .map((a) => `${a.name} ${Math.round(a.share * 100)}%`)
    .join(', ');
  statusBar.tooltip = new vscode.MarkdownString(
    [
      `**${match.repoName}** · ${match.relativePath}`,
      ``,
      `Bus factor: **${fileOwnership.busFactor}**`,
      `Commits: ${fileOwnership.totalCommits}`,
      ``,
      `Top: ${topAuthors || '(no authors)'}`,
      ``,
      `_Click to open the GitNexus web UI._`,
    ].join('\n'),
  );
  statusBar.show();
}
