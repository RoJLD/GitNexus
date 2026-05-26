#!/usr/bin/env node
/**
 * GitNexus analytics MCP server — ROADMAP Tier 2bis.1.
 *
 * Stdio JSON-RPC 2.0 server that exposes our REST analytics
 * endpoints as MCP tools, so any MCP client (Claude Code, Cursor,
 * Windsurf, OpenCode, …) can query them in natural language without
 * curl or the web panel.
 *
 * The upstream gitnexus CLI already exposes its own MCP server
 * (`npx gitnexus mcp`) for the graph tools (search, cypher, grep,
 * read, explore, overview, impact). This sidecar adds OUR 11
 * time-travel / cross-repo analytics on top:
 *
 *   gitnexus_list_repos        — list indexed repos (API host)
 *   gitnexus_entropy           — density × modularity × communities
 *   gitnexus_churn             — per-node presence across snapshots
 *   gitnexus_coupling          — files that change together (single-repo)
 *   gitnexus_growth            — node counts per category over time
 *   gitnexus_lifespan          — foundational / recent / discontinued / ephemeral
 *   gitnexus_ownership         — bus factor + top authors per file
 *   gitnexus_dissonance        — declared domains vs detected communities
 *   gitnexus_semantic_labels   — cached LLM labels per community
 *   gitnexus_coupling_cross    — cross-repo temporal coupling
 *   gitnexus_growth_cross      — cross-repo node-count timeline
 *   gitnexus_similarity        — identity vector + cube 2×2×2 + galaxy XY
 *
 * Transport: stdio (JSON-RPC 2.0 line-delimited).
 * Protocol: MCP 2024-11-05 (matches @modelcontextprotocol/sdk@1.0.0
 * used by upstream gitnexus, so a client that talks to one talks to
 * the other).
 * Dependencies: zero. Pure Node ≥18.
 *
 * --- Configuration ---
 *
 *   GITNEXUS_API     (default: http://localhost:4747)  upstream API
 *   GITNEXUS_WEB     (default: http://localhost:4173)  our analytics
 *   GITNEXUS_TIMEOUT (default: 30000 ms)               per-tool fetch timeout
 *
 * --- Installation ---
 *
 *   Add to your MCP client config (Claude Code: `.claude/mcp.json` or
 *   `~/.claude.json > mcpServers`):
 *
 *   {
 *     "mcpServers": {
 *       "gitnexus-analytics": {
 *         "command": "node",
 *         "args": ["c:/Users/rdenis/VScode/gitnexus/mcp-server/server.mjs"]
 *       }
 *     }
 *   }
 *
 *   See ./README.md for the full setup.
 *
 * --- Why a sidecar and not a patch into upstream ---
 *
 * Upstream's MCP server is in `upstream/gitnexus/src/mcp/*.ts`. Adding
 * tools there means patching TypeScript files that change with every
 * upstream bump — high merge friction. A standalone sidecar in this
 * folder (outside `upstream/`) survives bumps with zero rebase work;
 * it's just one more entry in the user's MCP config alongside the
 * upstream `npx gitnexus mcp` entry.
 */

import { createInterface } from 'node:readline';
import process from 'node:process';

const API_URL = (process.env.GITNEXUS_API || 'http://localhost:4747').replace(/\/+$/, '');
const WEB_URL = (process.env.GITNEXUS_WEB || 'http://localhost:4173').replace(/\/+$/, '');
const FETCH_TIMEOUT_MS = Number(process.env.GITNEXUS_TIMEOUT) || 30000;
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'gitnexus-analytics';
const SERVER_VERSION = '0.1.0';

// ── Tool registry ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'gitnexus_list_repos',
    description: 'List every repository currently indexed by the local gitnexus deployment. Returns name, path, last-indexed timestamp, and stats (files, nodes, edges, communities). Use this first to discover what repos are available before calling any per-repo analytics.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => callApi('/api/repos'),
  },
  {
    name: 'gitnexus_entropy',
    description: 'Structural entropy timeline for a repo: density, modularity, and community count per snapshot (+ live). Detects "everything-touches-everything" monolithic drift. Density > 0.05 = warning; modularity trending down = consolidation pressure.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Base repo name from gitnexus_list_repos (no @snapshot suffix).' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: ({ repo }) => callWeb('/entropy', { repo }),
  },
  {
    name: 'gitnexus_churn',
    description: 'Per-node "lifecycle churn" across the snapshot timeline. Churn = 1 - (snapshots node was present in / total snapshots). High churn = ephemeral / very-new / very-old. Used by the frontend to color-overlay the graph but exposed here for an agent to find "what disappeared".',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string' } },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: ({ repo }) => callWeb('/churn', { repo }),
  },
  {
    name: 'gitnexus_coupling',
    description: 'Single-repo temporal coupling: pairs of files that tend to be modified together (high Jaccard on the snapshot-touched-by-commit timeline). Surfaces hidden coupling that import-graph analysis misses (e.g. tests + their fixtures, sibling configs).',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string' } },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: ({ repo }) => callWeb('/coupling', { repo }),
  },
  {
    name: 'gitnexus_growth',
    description: 'Node counts per category (File, Function, Class, Method, …) over the snapshot timeline. Use to detect "I added 200 Functions but no new Files" (refactoring vs feature work).',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string' } },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: ({ repo }) => callWeb('/growth', { repo }),
  },
  {
    name: 'gitnexus_lifespan',
    description: 'Bucket every node by lifecycle: foundational (in every snapshot), recent (added later, still here), discontinued (removed before live), ephemeral (appeared and disappeared). Use to find "what survived the rewrite" or "what we tried and abandoned".',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string' } },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: ({ repo }) => callWeb('/lifespan', { repo }),
  },
  {
    name: 'gitnexus_ownership',
    description: 'Bus factor per file: smallest N authors covering 80% of the file\'s commit history. Plus repo-level top authors. Files with bus factor = 1 and high commit count are the "if Marie leaves, we are stuck" risks.',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string' } },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: ({ repo }) => callWeb('/ownership', { repo }),
  },
  {
    name: 'gitnexus_dissonance',
    description: 'Compares declared domain ownership (`.gitnexus-domains.json`) with detected Leiden communities. Returns purity score (1 = each domain lives in one community) + list of "misplaced" files (their community != their domain\'s dominant). Requires the repo to have a `.gitnexus-domains.json` at its root.',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string' } },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: ({ repo }) => callWeb('/dissonance', { repo }),
  },
  {
    name: 'gitnexus_semantic_labels',
    description: 'Cached LLM-generated labels per Community (e.g. "Authentication", "Database access layer"). Populated client-side by the DissonancePanel ✨ button — this tool just reads the cache. Returns empty if no labels generated yet.',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string' } },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: ({ repo }) => callWeb('/semantic-labels', { repo }),
  },
  {
    name: 'gitnexus_coupling_cross',
    description: 'Cross-repo temporal coupling: pairs of files in *different* repos that change in the same time window. Needs ≥2 distinct repos. Window defaults to 24h (windowHours).',
    inputSchema: {
      type: 'object',
      properties: {
        repos: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 8,
          description: 'Base repo names. Max 8.',
        },
        windowHours: { type: 'number', minimum: 1, maximum: 720, default: 24 },
        top: { type: 'number', minimum: 1, maximum: 1000, default: 100, description: 'Cap on returned pairs.' },
      },
      required: ['repos'],
      additionalProperties: false,
    },
    handler: ({ repos, windowHours, top }) =>
      callWeb('/coupling/cross', { repos: repos.join(','), windowHours, top }),
  },
  {
    name: 'gitnexus_growth_cross',
    description: 'Cross-repo node-count timeline aligned on a union of snapshot dates. Use to see "while repo A grew, repo B shrank" (migration of centre of gravity).',
    inputSchema: {
      type: 'object',
      properties: {
        repos: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8 },
      },
      required: ['repos'],
      additionalProperties: false,
    },
    handler: ({ repos }) => callWeb('/growth/cross', { repos: repos.join(',') }),
  },
  {
    name: 'gitnexus_entropy_commits',
    description: 'Commit-level entropy delta (Tier 2bis.2). For each commit in the window, returns the attributed slice of the entropy delta observed between the bracketing snapshots, weighted by the commit\'s filesTouched. Use to find "which PR started the cohérence degradation" / "who introduced the modularity drop". Returns commits sorted most-recent-first; null `attributedDensityDelta` means the commit fell outside any snapshot pair (need to seed more snapshots via /snapshot/bulk). Window: pass `from` + `to` (each a SHA or ISO date), or `days=N` for "last N days". Default: 90 days.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        from: { type: 'string', description: 'Window start. SHA or ISO date. Optional.' },
        to: { type: 'string', description: 'Window end. SHA or ISO date. Optional.' },
        days: { type: 'number', minimum: 1, maximum: 3650, description: 'Window size in days from now. Used when from/to are not provided.' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: ({ repo, ...opts }) => callWeb('/entropy/commits', { repo, ...opts }),
  },
  {
    name: 'gitnexus_watches',
    description: 'List declared watches across indexed repos (Tier 2bis.3). Source = each repo\'s `.gitnexus.json > watches`. Returns the watch declaration + the last in-memory evaluation state (lastValue, lastEvaluatedAt, lastTriggeredAt, lastError). Cron interval, debounce, and supported metric list are returned alongside. Filter to a single repo with `repo`.',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string', description: 'Optional — restrict to one repo.' } },
      additionalProperties: false,
    },
    handler: ({ repo }) => callWeb('/watches', repo ? { repo } : {}),
  },
  {
    name: 'gitnexus_commit_footprint',
    description: 'Return the files touched by a single commit with their add/modify/delete status (Tier 2bis.2 follow-up). Used by the frontend to overlay-highlight on the graph, but also useful standalone: ask "what did Marie change in commit abc123?" and get a structured list. Honest framing: this is what the commit TOUCHED, not the graph reconstructed at that commit. For the latter, snapshot the commit explicitly via /snapshot/bulk.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        sha: { type: 'string', description: 'Commit SHA, 4-64 hex chars (short SHAs OK).' },
      },
      required: ['repo', 'sha'],
      additionalProperties: false,
    },
    handler: ({ repo, sha }) => callWeb('/commit/footprint', { repo, sha }),
  },
  {
    name: 'gitnexus_repo_by_id',
    description: 'Resolve a stable repoId (16 hex chars, sha256(firstCommitSha + normalizedRemote) — Tier 2bis.5) back to one or more registered `<base>` names. Useful when a repo was re-cloned with a different folder name and the cross-repo features lost the link. The repoId itself is surfaced by `gitnexus_similarity` under `response.repos[].repoId`.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', pattern: '^[a-f0-9]{16}$', description: '16 lowercase hex chars.' },
      },
      required: ['repoId'],
      additionalProperties: false,
    },
    handler: ({ repoId }) => callWeb(`/repos/by-id/${repoId}`),
  },
  {
    name: 'gitnexus_similarity',
    description: 'Cross-repo similarity: per-repo identity vector (v1=5 dims, v2=10 dims default) + per-pair cube 2×2×2 (structural × semantic × temporal). Returns quadrant + recommendation per pair, plus 2D Galaxy projection (PCA) and stable repoId per repo (Tier 2bis.5). Reads unified `.gitnexus.json > policy` (or legacy `.gitnexus-policy.json`) per repo to neutralize compliance/multi-tenant false positives.',
    inputSchema: {
      type: 'object',
      properties: {
        repos: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8 },
        windowDays: { type: 'number', minimum: 7, maximum: 3650, default: 90 },
        identityVersion: { type: 'number', enum: [1, 2], default: 2 },
        lexicalSemantic: { type: 'boolean', default: true, description: 'Set to false to force semanticScore=null and collapse to 4-quadrant plane.' },
        structuralThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.7 },
        semanticThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.7 },
        temporalThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
      },
      required: ['repos'],
      additionalProperties: false,
    },
    handler: ({ repos, ...opts }) =>
      callWeb('/similarity', { repos: repos.join(','), ...opts }),
  },
];

// ── HTTP helpers ─────────────────────────────────────────────────────

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildQs(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function callWeb(path, params) {
  return doCall(`${WEB_URL}${path}${buildQs(params)}`, path);
}

async function callApi(path, params) {
  return doCall(`${API_URL}${path}${buildQs(params)}`, path);
}

async function doCall(url, path) {
  let resp;
  try {
    resp = await fetchWithTimeout(url);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Timeout (${FETCH_TIMEOUT_MS}ms) on ${path}. Is the gitnexus stack up? Try \`docker compose up -d\`.`);
    }
    throw new Error(`Network error on ${path}: ${err.message}. Is the gitnexus stack up at ${url}?`);
  }
  let body;
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    body = await resp.json().catch(() => null);
  } else {
    body = await resp.text().catch(() => '');
  }
  if (!resp.ok) {
    const msg = body && typeof body === 'object' && body.error ? body.error : `HTTP ${resp.status}`;
    throw new Error(`${path}: ${msg}`);
  }
  return body;
}

// ── JSON-RPC 2.0 over stdio ──────────────────────────────────────────

function sendMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendResponse(id, result) {
  sendMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  sendMessage({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
}

// MCP error codes — borrowed from JSON-RPC standard + MCP additions.
const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

async function handleMessage(msg) {
  // Notifications have no `id` and never get a response.
  const isNotification = msg.id === undefined || msg.id === null;
  const { method, params, id } = msg;

  try {
    switch (method) {
      case 'initialize': {
        // Client sends its preferred protocol version; we honor it if
        // we recognize it, else fall back to ours.
        const clientVersion = params?.protocolVersion;
        const negotiated = clientVersion === PROTOCOL_VERSION ? clientVersion : PROTOCOL_VERSION;
        sendResponse(id, {
          protocolVersion: negotiated,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
        return;
      }

      case 'notifications/initialized':
      case 'initialized':
        // Client confirms handshake done. No response.
        return;

      case 'tools/list': {
        sendResponse(id, {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
        return;
      }

      case 'tools/call': {
        const toolName = params?.name;
        const args = params?.arguments || {};
        const tool = TOOLS.find((t) => t.name === toolName);
        if (!tool) {
          sendError(id, ERR_INVALID_PARAMS, `Unknown tool: ${toolName}`);
          return;
        }
        try {
          const result = await tool.handler(args);
          sendResponse(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: false,
          });
        } catch (err) {
          // Tool errors come back as content (not RPC errors) per MCP
          // convention — the agent should see the error text and adapt.
          sendResponse(id, {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
          });
        }
        return;
      }

      case 'ping':
        sendResponse(id, {});
        return;

      default:
        if (!isNotification) sendError(id, ERR_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (err) {
    if (!isNotification) {
      sendError(id, ERR_INTERNAL, `Internal error: ${err.message}`);
    }
    process.stderr.write(`[${SERVER_NAME}] handler error on ${method}: ${err.stack || err.message}\n`);
  }
}

// ── Main loop ────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    sendError(null, ERR_PARSE, `Parse error: ${err.message}`);
    return;
  }
  // We support single requests + batches (JSON-RPC 2.0).
  if (Array.isArray(msg)) {
    void Promise.all(msg.map(handleMessage));
  } else {
    void handleMessage(msg);
  }
});

rl.on('close', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Log to stderr only — stdout is the protocol channel.
process.stderr.write(`[${SERVER_NAME}] v${SERVER_VERSION} ready · WEB=${WEB_URL} · API=${API_URL}\n`);
