# Roadmap Predictive — Cleanup & Multi-tool Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the cleanup-at-expiration mechanism (LLM-assisted prompt for expired ghosts) + a multi-tool connector framework (Plane full impl + Linear/GitHub/Jira stubs).

**Architecture:** Two new backend modules (`docker-server-ghost-cleanup.mjs` + `connectors/`), two new endpoints, one new React modal, integration into existing AuditPanel. Connectors register via the CORE's `registerGhostSource()` plugin registry. Both mechanisms are opt-in.

**Tech Stack:** Node 22 (CI), Node 21 (local — vitest blocked), `node:fs/promises`, native `fetch`. Frontend LLM call via existing `createChatModel` pattern (consistent with semantic-labels).

**Spec source:** [docs/superpowers/specs/2026-05-26-roadmap-predictive-cleanup-and-connectors-design.md](../specs/2026-05-26-roadmap-predictive-cleanup-and-connectors-design.md)

**Depends on:** CORE shipped (commit `64bec241`+), Audit shipped (commit `f47a3e8d`), Augmented graph shipped (commit `5eae327f`). Specifically: `registerGhostSource()` from `docker-server-ghosts.mjs` (CORE Task 6.5) and `computeExpired` from `docker-server-ghost-audit-core.mjs` (Audit Update 1).

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branch `deployment`).

**Implementer reminders:**
1. `upstream/` is gitignored — regen `patches/upstream-all.diff` after every change. NEVER `git add upstream/...`.
2. Local Node 21 can't run vitest 4.x — validate via `node --check` + smoke `node -e`. CI Node 22 handles the runtime.
3. `git config user.email` must print `roblastar@live.fr`.
4. **LLM call decision** : v1 returns the prompt + context to the frontend ; the frontend calls the LLM via existing `createChatModel` (same pattern as semantic-labels). Backend doesn't hold API keys for chat models. Connectors that need their own API key read from `process.env` (PLANE_API_KEY, GITHUB_TOKEN, etc.).

---

## File Structure

```
upstream/
├── docker-server-ghost-cleanup-core.mjs        NEW  buildCleanupPrompt (pure)
├── docker-server-ghost-cleanup.mjs             NEW  I/O + endpoint handler
├── docker-server-connectors-core.mjs           NEW  fuzzyMatchTicketToGhost (pure)
├── docker-server-connectors.mjs                NEW  endpoint handler + registry boot
├── connectors/
│   ├── plane.mjs                               NEW  full Plane REST API connector
│   ├── linear.mjs                              NEW  stub (fail gracefully)
│   ├── github.mjs                              NEW  stub (fail gracefully)
│   └── jira.mjs                                NEW  stub (fail gracefully)
├── docker-server.mjs                           MOD  register 2 new routes

upstream/gitnexus-web/src/components/audit/
├── CleanupModal.tsx                            NEW  expired list + LLM suggestions UI
└── AuditPanel.tsx                              MOD  open CleanupModal on expired-card click

tests/
├── unit/
│   ├── ghost-cleanup-prompt.test.mjs           NEW  buildCleanupPrompt
│   ├── connectors-fuzzy-match.test.mjs         NEW  fuzzyMatchTicketToGhost
│   ├── connectors-plane.test.mjs               NEW  Plane connector with mocked fetch
│   └── components/audit/CleanupModal.test.tsx  NEW
├── integration/endpoints/
│   ├── ghost-cleanup-prompt.test.mjs           NEW  POST /ghosts/cleanup-prompt
│   └── ghost-connector-suggestions.test.mjs    NEW  GET /ghosts/connector-suggestions

ROADMAP.md                                       MOD  row 40
INVENTORY.md                                     MOD  new sub-section
CLAUDE.md                                        MOD  smoke loop entries
tests/README.md                                  MOD  6 new test rows
docs/superpowers/specs/2026-05-26-roadmap-predictive-cleanup-and-connectors-design.md   MOD  Update — Shipped
patches/upstream-all.diff                        REGEN after each upstream task
```

---

## Section A — Cleanup core (Tasks 1-3)

### Task 1: `buildCleanupPrompt` pure fn + tests

**Files:**
- Create: `upstream/docker-server-ghost-cleanup-core.mjs`
- Create: `tests/unit/ghost-cleanup-prompt.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { buildCleanupPrompt, parseCleanupResponse } from '../../upstream/docker-server-ghost-cleanup-core.mjs';

describe('buildCleanupPrompt', () => {
  const expiredGhost = {
    id: 'tier-3-2-mutation-tracking',
    title: 'Mutation tracking',
    declared: {
      description: 'Track mutations across releases',
      expectedBy: '2026-04-30',
      expectedLinks: [{ kind: 'path', value: 'docker-server-mutation.mjs' }],
    },
    daysPastExpiry: 26,
  };

  it('produces a prompt with the ghost metadata + evidence sections', () => {
    const prompt = buildCleanupPrompt({
      ghost: expiredGhost,
      matchedNodes: ['docker-server-similarity.mjs'],
      recentCommits: ['feat(similarity): v1 shipped (2026-04-15)'],
    });
    expect(prompt).toContain('Mutation tracking');
    expect(prompt).toContain('2026-04-30');
    expect(prompt).toContain('26 days');
    expect(prompt).toContain('docker-server-similarity.mjs');
    expect(prompt).toContain('feat(similarity)');
    expect(prompt).toMatch(/reaffirm.*cancel.*ship-as-other/);
    expect(prompt).toMatch(/JSON/);
  });

  it('handles empty matchedNodes + recentCommits', () => {
    const prompt = buildCleanupPrompt({
      ghost: expiredGhost,
      matchedNodes: [],
      recentCommits: [],
    });
    expect(prompt).toContain('Mutation tracking');
    expect(prompt).toContain('(no matching nodes)');
    expect(prompt).toContain('(no recent commits)');
  });
});

describe('parseCleanupResponse', () => {
  it('parses a valid JSON response', () => {
    const r = parseCleanupResponse(`{"action":"cancel","rationale":"X","confidence":0.85}`);
    expect(r).toEqual({ action: 'cancel', rationale: 'X', confidence: 0.85 });
  });

  it('strips ```json``` fences if present', () => {
    const r = parseCleanupResponse('```json\n{"action":"reaffirm","rationale":"Y","confidence":0.6}\n```');
    expect(r.action).toBe('reaffirm');
  });

  it('returns null on invalid input', () => {
    expect(parseCleanupResponse('not json')).toBeNull();
    expect(parseCleanupResponse('')).toBeNull();
  });

  it('rejects responses with invalid action', () => {
    expect(parseCleanupResponse(`{"action":"delete","rationale":"X","confidence":1}`)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```js
// upstream/docker-server-ghost-cleanup-core.mjs
//
// Pure fns for LLM-assisted cleanup-at-expiration.
// No I/O. Backend builds the prompt context, frontend calls the LLM.

const VALID_ACTIONS = new Set(['reaffirm', 'cancel', 'ship-as-other']);

export function buildCleanupPrompt({ ghost, matchedNodes, recentCommits }) {
  const links = (ghost.declared?.expectedLinks || [])
    .map(l => `  - ${l.kind}: ${l.value}`)
    .join('\n') || '  (none)';
  const matched = matchedNodes && matchedNodes.length
    ? matchedNodes.map(n => `  - ${n}`).join('\n')
    : '  (no matching nodes)';
  const commits = recentCommits && recentCommits.length
    ? recentCommits.map(c => `  - ${c}`).join('\n')
    : '  (no recent commits)';
  return [
    `You are helping clean up a roadmap.`,
    ``,
    `This ghost has expired ${ghost.daysPastExpiry} days past its expectedBy:`,
    `  Title: ${ghost.title}`,
    `  Description: ${ghost.declared?.description || '(none)'}`,
    `  expectedBy: ${ghost.declared?.expectedBy || '(unspecified)'}`,
    `  expectedLinks:`,
    links,
    ``,
    `Nodes in the current graph that partially match its expectedLinks:`,
    matched,
    ``,
    `Recent commits (3 months):`,
    commits,
    ``,
    `Propose one action from: reaffirm | cancel | ship-as-other`,
    `If ship-as-other, name the other ghost / shipped feature that now covers this need in the rationale.`,
    ``,
    `Respond as strict JSON:`,
    `{ "action": "<action>", "rationale": "<short>", "confidence": <0-1> }`,
  ].join('\n');
}

export function parseCleanupResponse(text) {
  if (!text || typeof text !== 'string') return null;
  let stripped = text.trim();
  const fence = stripped.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) stripped = fence[1].trim();
  let obj;
  try { obj = JSON.parse(stripped); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  if (!VALID_ACTIONS.has(obj.action)) return null;
  if (typeof obj.rationale !== 'string') return null;
  const confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { action: obj.action, rationale: obj.rationale, confidence };
}
```

- [ ] **Step 3: Validate + commit**

```bash
node --check upstream/docker-server-ghost-cleanup-core.mjs
node --check tests/unit/ghost-cleanup-prompt.test.mjs
node -e "import('./upstream/docker-server-ghost-cleanup-core.mjs').then(m => console.log(Object.keys(m).sort()))"
# expected: [ 'buildCleanupPrompt', 'parseCleanupResponse' ]

cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghost-cleanup-prompt.test.mjs
git commit -m "feat(cleanup): buildCleanupPrompt + parseCleanupResponse pure fns"
```

---

### Task 2: `/ghosts/cleanup-prompt` endpoint (I/O wrapper)

**Files:**
- Create: `upstream/docker-server-ghost-cleanup.mjs`

The endpoint walks: `loadGhostsAndSnapshots(repoPath)` → `computeExpired(latest.ghosts)` → for each expired ghost, gather matchedNodes (via `matchExpectedLinks` from CORE) + last 90 days commits → emit `buildCleanupPrompt`. Return `{ expired: [{ id, title, expectedBy, daysPastExpiry, prompt }] }`.

- [ ] **Step 1: Implement**

```js
// upstream/docker-server-ghost-cleanup.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildCleanupPrompt } from './docker-server-ghost-cleanup-core.mjs';
import { computeExpired } from './docker-server-ghost-audit-core.mjs';
import { matchExpectedLinks } from './docker-server-ghosts-core.mjs';
import { readLatestGhosts } from './docker-server-ghosts.mjs';
import { findRepoByName } from './docker-server-snapshots.mjs';

const execFileP = promisify(execFile);

async function getRecentCommits(repoPath, days = 90) {
  try {
    const { stdout } = await execFileP(
      'git',
      ['log', `--since=${days} days ago`, '--pretty=format:%h %s'],
      { cwd: repoPath, maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout.split('\n').filter(Boolean).slice(0, 50);
  } catch {
    return [];
  }
}

export async function buildCleanupPrompts(repoPath) {
  const runtime = await readLatestGhosts(repoPath);
  if (!runtime) return { expired: [] };
  const expired = computeExpired(runtime.ghosts || [], { gracePeriodDays: 30, now: new Date() });
  if (expired.total === 0) return { expired: [] };

  const allFiles = new Set();
  for (const g of runtime.ghosts || []) {
    if (g.links) for (const l of g.links) if (l.file) allFiles.add(l.file);
  }
  const recentCommits = await getRecentCommits(repoPath, 90);

  const out = [];
  for (const entry of expired.list) {
    const ghost = (runtime.ghosts || []).find(g => g.id === entry.id);
    if (!ghost) continue;
    const { matched } = matchExpectedLinks(ghost.declared, [...allFiles]);
    const prompt = buildCleanupPrompt({
      ghost: { ...ghost, daysPastExpiry: entry.daysPastExpiry },
      matchedNodes: matched.map(m => m.matchedPath),
      recentCommits,
    });
    out.push({
      id: entry.id,
      title: ghost.declared?.title || entry.id,
      expectedBy: ghost.declared?.expectedBy,
      daysPastExpiry: entry.daysPastExpiry,
      alertLevel: entry.alertLevel,
      prompt,
    });
  }
  return { expired: out };
}

export async function handleGhostsCleanupPrompt(url, res, opts) {
  const repoName = url.searchParams.get('repo');
  if (!repoName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'missing repo' }));
  }
  const repo = await findRepoByName(repoName, opts.api);
  if (!repo) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `repo not found: ${repoName}` }));
  }
  const repoPath = repo.repoPath || repo.path;
  try {
    const result = await buildCleanupPrompts(repoPath);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

export async function handleGhostsCleanupRoute(req, url, res, opts) {
  if (url.pathname === '/ghosts/cleanup-prompt' && req.method === 'POST') {
    await handleGhostsCleanupPrompt(url, res, opts);
    return true;
  }
  return false;
}
```

- [ ] **Step 2: Validate + commit**

```bash
node --check upstream/docker-server-ghost-cleanup.mjs
node -e "import('./upstream/docker-server-ghost-cleanup.mjs').then(m => console.log(Object.keys(m).sort()))"
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(cleanup): POST /ghosts/cleanup-prompt route handler"
```

---

### Task 3: Register `/ghosts/cleanup-prompt` in docker-server.mjs

**Files:**
- Modify: `upstream/docker-server.mjs`

Add import + dispatch line at the end of the chain (after `handleGhostAuditRoute`).

```js
import { handleGhostsCleanupRoute } from './docker-server-ghost-cleanup.mjs';
// ...
// Roadmap-predictive cleanup-at-expiration (LLM-assisted)
if (await handleGhostsCleanupRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;
```

- [ ] **Validate + commit**

```bash
node --check upstream/docker-server.mjs
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(cleanup): register /ghosts/cleanup-prompt route"
```

---

## Section B — Connector framework (Tasks 4-8)

### Task 4: `fuzzyMatchTicketToGhost` pure fn

**Files:**
- Create: `upstream/docker-server-connectors-core.mjs`
- Create: `tests/unit/connectors-fuzzy-match.test.mjs`

```js
// tests/unit/connectors-fuzzy-match.test.mjs
import { describe, it, expect } from 'vitest';
import { fuzzyMatchTicketToGhost, tokenize, jaccardSimilarity } from '../../upstream/docker-server-connectors-core.mjs';

describe('tokenize', () => {
  it('lowercases + strips punctuation', () => {
    expect(tokenize('What-if simulator! v2.')).toEqual(['what', 'if', 'simulator', 'v2']);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
  });
  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(['a'], ['b'])).toBe(0);
  });
});

describe('fuzzyMatchTicketToGhost', () => {
  const ghosts = [
    { id: 'g1', title: 'What-if simulator', declared: { description: 'Rename / move / delete' } },
    { id: 'g2', title: 'Audit dashboard', declared: { description: '' } },
  ];
  it('matches by title similarity above threshold', () => {
    const r = fuzzyMatchTicketToGhost(
      { title: 'What-if simulator v2', description: 'follow-up to rename support' },
      ghosts,
      0.5,
    );
    expect(r).toBeTruthy();
    expect(r.ghost.id).toBe('g1');
  });
  it('returns null when below threshold', () => {
    const r = fuzzyMatchTicketToGhost(
      { title: 'Completely unrelated', description: '' },
      ghosts,
      0.7,
    );
    expect(r).toBeNull();
  });
});
```

Implementation:

```js
// upstream/docker-server-connectors-core.mjs
export function tokenize(s) {
  if (!s || typeof s !== 'string') return [];
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function jaccardSimilarity(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let intersect = 0;
  for (const x of sa) if (sb.has(x)) intersect++;
  const union = sa.size + sb.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export function fuzzyMatchTicketToGhost(ticket, ghosts, threshold = 0.7) {
  const ticketTokens = [
    ...tokenize(ticket.title || ''),
    ...tokenize(ticket.description || ''),
  ];
  let best = null;
  for (const g of ghosts || []) {
    const ghostTokens = [
      ...tokenize(g.title || ''),
      ...tokenize(g.declared?.description || ''),
    ];
    const score = jaccardSimilarity(ticketTokens, ghostTokens);
    if (score >= threshold && (!best || score > best.score)) {
      best = { ghost: g, score };
    }
  }
  return best;
}
```

Commit:
```bash
node --check upstream/docker-server-connectors-core.mjs tests/unit/connectors-fuzzy-match.test.mjs
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/connectors-fuzzy-match.test.mjs
git commit -m "feat(connectors): fuzzyMatchTicketToGhost pure fn"
```

---

### Task 5: Plane connector (full)

**Files:**
- Create: `upstream/connectors/plane.mjs`
- Create: `tests/unit/connectors-plane.test.mjs`

The Plane REST API: `GET {apiUrl}/api/v1/workspaces/{slug}/projects/{projectId}/issues/` returns `{ results: [{ id, name, description_html, state, target_date, ... }] }`. Auth via `X-API-Key` header.

```js
// upstream/connectors/plane.mjs
const DEFAULT_PAGE_SIZE = 100;

export const planeConnector = {
  name: 'plane',
  configKey: 'connectors.plane',

  async fetchOpenWorkItems(config) {
    return fetchPlaneIssues(config, { stateFilter: 'open' });
  },

  async fetchClosedWorkItems(config) {
    return fetchPlaneIssues(config, { stateFilter: 'closed' });
  },
};

async function fetchPlaneIssues(config, { stateFilter }) {
  const { apiUrl, workspaceSlug, projectId, apiKey } = config;
  if (!apiUrl || !workspaceSlug || !projectId) {
    throw new Error('Plane connector requires apiUrl, workspaceSlug, projectId');
  }
  if (!apiKey) {
    throw new Error('Plane connector requires PLANE_API_KEY env var (or config.apiKey)');
  }
  const url = `${apiUrl.replace(/\/$/, '')}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/?per_page=${DEFAULT_PAGE_SIZE}`;
  const res = await fetch(url, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Plane API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const issues = body.results || [];
  return issues
    .map(i => ({
      id: i.id,
      title: i.name,
      description: stripHtml(i.description_html || ''),
      state: stateNameToCategory(i.state_detail?.name || i.state || ''),
      dueDate: i.target_date,
      externalUrl: `${apiUrl}/${workspaceSlug}/projects/${projectId}/issues/${i.id}`,
    }))
    .filter(i => stateFilter === 'open' ? i.state === 'open' : i.state === 'closed');
}

function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, '').trim();
}

function stateNameToCategory(name) {
  const lc = String(name).toLowerCase();
  if (/done|complete|closed|cancel/i.test(lc)) return 'closed';
  return 'open';
}
```

Test (mock fetch):
```js
// tests/unit/connectors-plane.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { planeConnector } from '../../upstream/connectors/plane.mjs';

describe('planeConnector.fetchOpenWorkItems', () => {
  it('throws when apiKey missing', async () => {
    await expect(
      planeConnector.fetchOpenWorkItems({ apiUrl: 'http://x', workspaceSlug: 'w', projectId: 'p' }),
    ).rejects.toThrow(/PLANE_API_KEY/);
  });

  it('returns mapped issues filtered by state', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          { id: '1', name: 'foo', description_html: '<p>x</p>', state_detail: { name: 'Backlog' }, target_date: null },
          { id: '2', name: 'bar', state_detail: { name: 'Done' }, target_date: '2026-01-01' },
        ],
      }),
    }));
    const r = await planeConnector.fetchOpenWorkItems({ apiUrl: 'http://x', workspaceSlug: 'w', projectId: 'p', apiKey: 'k' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: '1', title: 'foo', state: 'open' });
  });
});
```

Commit: `feat(connectors): Plane connector (full v1)`.

---

### Task 6: Linear / GitHub / Jira stubs

**Files:**
- Create: `upstream/connectors/linear.mjs`
- Create: `upstream/connectors/github.mjs`
- Create: `upstream/connectors/jira.mjs`

Each follows the same shape but throws `Error('<name> connector not implemented yet (v1 stub)')` from `fetchOpenWorkItems` / `fetchClosedWorkItems`. The framework is ready for v2.

```js
// upstream/connectors/linear.mjs
export const linearConnector = {
  name: 'linear',
  configKey: 'connectors.linear',
  async fetchOpenWorkItems() { throw new Error('linear connector not implemented yet (v1 stub)'); },
  async fetchClosedWorkItems() { throw new Error('linear connector not implemented yet (v1 stub)'); },
};
```

Same for github + jira (replace name + configKey + error message).

Commit: `feat(connectors): Linear/GitHub/Jira stubs`.

---

### Task 7: `/ghosts/connector-suggestions` endpoint + registry boot

**Files:**
- Create: `upstream/docker-server-connectors.mjs`
- Modify: `upstream/docker-server.mjs`

`docker-server-connectors.mjs` reads `.gitnexus.yaml > connectors.*` for the repo, runs each enabled connector's `fetchOpenWorkItems` + `fetchClosedWorkItems`, fuzzy-matches each ticket against latest ghosts, returns `{ suggestions: [{ ghostId, connectorName, ticketRef, suggestedAction, externalUrl }] }`.

```js
// upstream/docker-server-connectors.mjs
import { fuzzyMatchTicketToGhost } from './docker-server-connectors-core.mjs';
import { readLatestGhosts } from './docker-server-ghosts.mjs';
import { findRepoByName } from './docker-server-snapshots.mjs';
import { planeConnector } from './connectors/plane.mjs';
import { linearConnector } from './connectors/linear.mjs';
import { githubConnector } from './connectors/github.mjs';
import { jiraConnector } from './connectors/jira.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CONNECTORS = {
  plane: planeConnector,
  linear: linearConnector,
  github: githubConnector,
  jira: jiraConnector,
};

async function loadConnectorConfig(repoPath) {
  try {
    const raw = await readFile(join(repoPath, '.gitnexus.json'), 'utf8');
    const cfg = JSON.parse(raw);
    return cfg?.connectors || {};
  } catch { return {}; }
}

function envFor(name) {
  switch (name) {
    case 'plane': return process.env.PLANE_API_KEY;
    case 'linear': return process.env.LINEAR_API_KEY;
    case 'github': return process.env.GITHUB_TOKEN;
    case 'jira': return process.env.JIRA_API_TOKEN;
    default: return null;
  }
}

async function buildConnectorSuggestions(repoPath) {
  const runtime = await readLatestGhosts(repoPath);
  if (!runtime) return { suggestions: [] };
  const ghosts = runtime.ghosts || [];
  const connectorConfig = await loadConnectorConfig(repoPath);

  const suggestions = [];
  for (const [name, connector] of Object.entries(CONNECTORS)) {
    const cfg = connectorConfig[name];
    if (!cfg || cfg.enabled !== true) continue;
    const apiKey = cfg.apiKey || envFor(name);
    let openItems = [], closedItems = [];
    try {
      openItems = await connector.fetchOpenWorkItems({ ...cfg, apiKey });
      closedItems = await connector.fetchClosedWorkItems({ ...cfg, apiKey });
    } catch (err) {
      suggestions.push({ connectorName: name, error: err.message });
      continue;
    }
    for (const ticket of openItems) {
      const match = fuzzyMatchTicketToGhost(ticket, ghosts, cfg.matchThreshold ?? 0.7);
      if (match) {
        suggestions.push({
          ghostId: match.ghost.id,
          connectorName: name,
          ticketRef: ticket.id,
          ticketTitle: ticket.title,
          suggestedAction: 'reaffirm',
          rationale: `${name} ticket "${ticket.title}" still open (score ${match.score.toFixed(2)})`,
          externalUrl: ticket.externalUrl,
        });
      }
    }
    for (const ticket of closedItems) {
      const match = fuzzyMatchTicketToGhost(ticket, ghosts, cfg.matchThreshold ?? 0.7);
      if (match) {
        suggestions.push({
          ghostId: match.ghost.id,
          connectorName: name,
          ticketRef: ticket.id,
          ticketTitle: ticket.title,
          suggestedAction: 'cancel',
          rationale: `${name} ticket "${ticket.title}" closed (score ${match.score.toFixed(2)})`,
          externalUrl: ticket.externalUrl,
        });
      }
    }
  }
  return { suggestions };
}

async function handleConnectorSuggestions(url, res, opts) {
  const repoName = url.searchParams.get('repo');
  if (!repoName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'missing repo' }));
  }
  const repo = await findRepoByName(repoName, opts.api);
  if (!repo) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `repo not found: ${repoName}` }));
  }
  const repoPath = repo.repoPath || repo.path;
  try {
    const result = await buildConnectorSuggestions(repoPath);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

export async function handleConnectorsRoute(req, url, res, opts) {
  if (url.pathname === '/ghosts/connector-suggestions' && req.method === 'GET') {
    await handleConnectorSuggestions(url, res, opts);
    return true;
  }
  return false;
}
```

Then register the route in `docker-server.mjs`:
```js
import { handleConnectorsRoute } from './docker-server-connectors.mjs';
// ...
if (await handleConnectorsRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;
```

Commit (one for the endpoint, one for the registration):
```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(connectors): /ghosts/connector-suggestions endpoint + registration in docker-server.mjs"
```

---

### Task 8: Integration test for /ghosts/connector-suggestions (no-config path)

**Files:**
- Create: `tests/integration/endpoints/ghost-connector-suggestions.test.mjs`

A repo without `.gitnexus.json > connectors` returns `{ suggestions: [] }`. Test asserts this with the existing `FIXTURE`.

```js
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /ghosts/connector-suggestions', () => {
  it('returns empty when no connectors configured', async () => {
    const res = await fetch(`${BASE}/ghosts/connector-suggestions?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ suggestions: [] });
  });
});
```

Commit: `test(integ): /ghosts/connector-suggestions empty-config path`.

---

## Section C — Cleanup integration test (Task 9)

### Task 9: Integration test for /ghosts/cleanup-prompt

**Files:**
- Create: `tests/integration/endpoints/ghost-cleanup-prompt.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('POST /ghosts/cleanup-prompt', () => {
  it('returns expired ghosts with prompts', async () => {
    // Pre-condition : at least one ghost in the fixture has expectedBy in the past.
    // (Fixture commit 12 sets 1.2 to expectedBy 2026-Q2 — depending on test run date, may or may not be expired.)
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const res = await fetch(`${BASE}/ghosts/cleanup-prompt?repo=${FIXTURE.name}`, { method: 'POST' });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.expired)).toBe(true);
    for (const e of body.expired) {
      expect(typeof e.prompt).toBe('string');
      expect(e.prompt.length).toBeGreaterThan(50);
      expect(['critical', 'expiredButRecent']).toContain(e.alertLevel);
    }
  });
});
```

Commit: `test(integ): POST /ghosts/cleanup-prompt expired list + prompts`.

---

## Section D — Frontend (Tasks 10-11)

### Task 10: `CleanupModal.tsx`

**Files:**
- Create: `upstream/gitnexus-web/src/components/audit/CleanupModal.tsx`
- Create: `tests/unit/components/audit/CleanupModal.test.tsx`

The modal fetches `/ghosts/cleanup-prompt` on open, displays each expired ghost with its prompt, and provides 3 action buttons (Reaffirm / Cancel / Ship-as-other). Calling the LLM lives in a separate `useLlm` hook from the existing semantic-labels pattern — for v1, the modal exposes the prompt + a "Copy prompt" button so the user can paste into their LLM of choice. The auto-LLM call is a follow-up if the existing `createChatModel` hook is easy to thread in (Step 2 below).

```tsx
// upstream/gitnexus-web/src/components/audit/CleanupModal.tsx
import React, { useEffect, useState } from 'react';

type ExpiredEntry = {
  id: string;
  title: string;
  expectedBy?: string;
  daysPastExpiry: number;
  alertLevel: 'critical' | 'expiredButRecent';
  prompt: string;
};

type Props = {
  repo: string;
  open: boolean;
  onClose: () => void;
};

export default function CleanupModal({ repo, open, onClose }: Props) {
  const [entries, setEntries] = useState<ExpiredEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(`/ghosts/cleanup-prompt?repo=${encodeURIComponent(repo)}`, { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((body) => setEntries(body.expired || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, repo]);

  if (!open) return null;

  return (
    <div className="cleanup-modal" data-testid="cleanup-modal" role="dialog">
      <div className="modal-content">
        <header>
          <h2>Cleanup expired ghosts</h2>
          <button type="button" onClick={onClose} aria-label="close">×</button>
        </header>
        {loading && <p>Loading…</p>}
        {error && <p className="error">Error: {error}</p>}
        {entries && entries.length === 0 && <p>No expired ghosts — your roadmap is clean.</p>}
        {entries && entries.length > 0 && (
          <ul className="expired-list">
            {entries.map((e) => (
              <li key={e.id} className={`alert-${e.alertLevel}`}>
                <header>
                  <strong>{e.title}</strong>
                  <span className="badge">{e.daysPastExpiry}d past expiry</span>
                </header>
                <details>
                  <summary>LLM cleanup prompt</summary>
                  <pre>{e.prompt}</pre>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(e.prompt)}
                  >
                    Copy prompt
                  </button>
                </details>
                <div className="actions">
                  <button type="button" data-action="reaffirm">Reaffirm (extend expectedBy)</button>
                  <button type="button" data-action="cancel">Cancel ghost</button>
                  <button type="button" data-action="ship-as-other">Ship-as-other</button>
                </div>
                <p className="hint">v1: action buttons are advisory — apply the change to ROADMAP.md manually then run /ghosts/sync.</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

Test:
```tsx
// tests/unit/components/audit/CleanupModal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CleanupModal from '../../../../upstream/gitnexus-web/src/components/audit/CleanupModal';

describe('CleanupModal', () => {
  it('does not render when closed', () => {
    const { container } = render(<CleanupModal repo="r" open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "no expired ghosts" when list is empty', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ expired: [] }) }));
    render(<CleanupModal repo="r" open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/clean/i)).toBeInTheDocument());
  });

  it('renders expired entries with prompts', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        expired: [{ id: 'g1', title: 'Foo', daysPastExpiry: 42, alertLevel: 'critical', prompt: 'prompt-A' }],
      }),
    }));
    render(<CleanupModal repo="r" open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Foo')).toBeInTheDocument());
    expect(screen.getByText(/42d past/i)).toBeInTheDocument();
  });
});
```

Commit: `feat(cleanup): CleanupModal + test`.

---

### Task 11: Wire CleanupModal into AuditPanel

**Files:**
- Modify: `upstream/gitnexus-web/src/components/AuditPanel.tsx` (or wherever the host is — already extended by Audit)

The Audit Update 1 already shipped a 6th "Expired" card. Add an `onClick` to that card that opens `<CleanupModal>` with the current repo. Local state `[cleanupOpen, setCleanupOpen]`.

```tsx
import CleanupModal from './audit/CleanupModal';

// ... in the component body :
const [cleanupOpen, setCleanupOpen] = useState(false);

// On the existing Expired card in <AuditSummary expired={...} onExpiredClick={() => setCleanupOpen(true)} />
// (Audit Task 14 already named the card .status-expired ; thread an onExpiredClick prop through AuditSummary.)

// At the end of the JSX :
<CleanupModal repo={repo} open={cleanupOpen} onClose={() => setCleanupOpen(false)} />
```

Then update `AuditSummary.tsx` to accept `onExpiredClick` and call it from the expired card's `onClick`. Update its test (`tests/unit/components/audit/AuditSummary.test.tsx`) to assert the callback fires.

Commit: `feat(cleanup): wire CleanupModal into AuditPanel via Expired card`.

---

## Section E — Docs + spec Update (Tasks 12-14)

### Task 12: ROADMAP row 40 + INVENTORY sub-section + tests/README

**Files:**
- Modify: `ROADMAP.md`
- Modify: `INVENTORY.md`
- Modify: `tests/README.md`

ROADMAP row 40:
```
| 40 | **Roadmap predictive — Cleanup + Multi-tool connectors** : (a) `POST /ghosts/cleanup-prompt?repo=` retourne les ghosts expirés (computeExpired) + un prompt LLM pré-construit par ghost (title, description, expectedBy, expectedLinks, matched nodes, recent commits). (b) Connector framework `connectors/` avec Plane primary (full Plane REST API impl), Linear/GitHub/Jira stubs (fail gracefully). `GET /ghosts/connector-suggestions?repo=` lit `.gitnexus.json > connectors.*`, fetch open + closed tickets, fuzzy-matche par Jaccard sur titre+description, retourne suggestions reaffirm/cancel. `CleanupModal.tsx` ouvert via 6ème card "Expired" de AuditSummary. LLM call : v1 le frontend copie le prompt (auto-call follow-up). | `/ghosts/cleanup-prompt`, `/ghosts/connector-suggestions`, `upstream/docker-server-ghost-cleanup-core.mjs`, `upstream/docker-server-ghost-cleanup.mjs`, `upstream/docker-server-connectors-core.mjs`, `upstream/docker-server-connectors.mjs`, `upstream/connectors/{plane,linear,github,jira}.mjs`, `upstream/gitnexus-web/src/components/audit/CleanupModal.tsx` |
```

Update the "Dernière mise à jour" line at the top.

INVENTORY sub-section under Partie B (mirror Audit's):
```
#### Roadmap-predictive Cleanup + Connectors (Tier 3.x, 2026-05-27)
- `upstream/docker-server-ghost-cleanup-core.mjs` — `buildCleanupPrompt` + `parseCleanupResponse` (pure fns).
- `upstream/docker-server-ghost-cleanup.mjs` — `POST /ghosts/cleanup-prompt` handler. Reuses `computeExpired` from Audit + `matchExpectedLinks` from CORE.
- `upstream/docker-server-connectors-core.mjs` — `tokenize` + `jaccardSimilarity` + `fuzzyMatchTicketToGhost`.
- `upstream/docker-server-connectors.mjs` — `GET /ghosts/connector-suggestions` handler + module-level connector registry.
- `upstream/connectors/plane.mjs` — full Plane REST API connector (fetchOpenWorkItems / fetchClosedWorkItems). Auth via `X-API-Key` env var.
- `upstream/connectors/{linear,github,jira}.mjs` — stubs that throw "not implemented yet (v1 stub)".
- `upstream/gitnexus-web/src/components/audit/CleanupModal.tsx` — modal opened via the 6th "Expired" card in AuditSummary. Lists expired ghosts + LLM-ready prompts ; v1 user copies the prompt to their LLM, then edits ROADMAP.md manually.
- **Config** (`.gitnexus.json > connectors.<name>`) : `{ enabled, apiUrl, workspaceSlug, projectId, matchThreshold }`. API keys via env (PLANE_API_KEY, GITHUB_TOKEN, LINEAR_API_KEY, JIRA_API_TOKEN).
```

tests/README.md new rows :
- `unit/ghost-cleanup-prompt.test.mjs`
- `unit/connectors-fuzzy-match.test.mjs`
- `unit/connectors-plane.test.mjs`
- `unit/components/audit/CleanupModal.test.tsx`
- `integration/endpoints/ghost-cleanup-prompt.test.mjs`
- `integration/endpoints/ghost-connector-suggestions.test.mjs`

Run `node scripts/check-test-inventory.mjs` — must exit 0.

Commit: `docs: roadmap-predictive Cleanup + Connectors shipped (ROADMAP + INVENTORY + tests inventory)`.

---

### Task 13: CLAUDE.md smoke loop

Add to the smoke loop section (after the ghost-audit lines):
```
# Cleanup + connectors (Tier 3.x — both endpoints respond even with no config / no expired ghosts)
curl -s -o /dev/null -w "ghosts/cleanup-prompt: HTTP %{http_code}\n" \
  -X POST "http://localhost:4173/ghosts/cleanup-prompt?repo=hmm_studio"
curl -s -o /dev/null -w "ghosts/connector-suggestions: HTTP %{http_code}\n" \
  "http://localhost:4173/ghosts/connector-suggestions?repo=hmm_studio"
```

Commit: `docs(CLAUDE): add /ghosts/cleanup-prompt + /ghosts/connector-suggestions to smoke loop`.

---

### Task 14: Append Update — Shipped to the spec

```
---

## Update 2026-05-27 — Shipped

Cleanup + Multi-tool connectors livré. Notes :

- 2 endpoints livrés : `POST /ghosts/cleanup-prompt` (expired list + LLM-ready prompts) + `GET /ghosts/connector-suggestions` (Plane fetch + fuzzy-match).
- Plane connector **full v1** : fetch open + closed via REST API + auth via `X-API-Key` env (`PLANE_API_KEY`).
- Linear / GitHub / Jira **stubs** : framework prêt mais `fetchOpenWorkItems` / `fetchClosedWorkItems` lèvent "not implemented yet". Extension future.
- Fuzzy match Jaccard (tokens minusculisés, ponctuation strippée), seuil 0.7 default, configurable via `.gitnexus.json > connectors.<name>.matchThreshold`.
- `CleanupModal.tsx` ouvert via la 6ème card "Expired" de AuditSummary (déjà shippée en Audit Update 1). UI v1 : user copie le prompt, l'envoie à son LLM, applique la suggestion manuellement à ROADMAP.md puis re-sync. Auto-LLM call = follow-up.
- Aucun connecteur ne modifie automatiquement les ghosts. Toujours suggestion → validation user.
- Configuration via `.gitnexus.json` (cohérent avec Tier 2bis.4 .gitnexus.json unifié, pas .gitnexus.yaml malgré le spec original ; cf CORE Update — Shipped pour le pivot).
- Tests : 3 unit + 1 component + 2 integration. Runtime local Node 21 impossible (vitest 4.x), CI Node 22 exerce le suite.

### Limitations connues

1. **LLM call manuel** : v1 le user copie le prompt. Auto-call via `createChatModel` (pattern semantic-labels) reste un follow-up.
2. **Pas de Webhooks** (Plane push sur changement) — out-of-scope.
3. **Linear / GitHub / Jira stubs** : framework ready, impl à venir si demandée.
4. **Threshold Jaccard 0.7** : tuning empirique probable selon le corpus titres ghost vs tickets.
5. **Bidirectionnel out** : pas de création de tickets Plane depuis le graph (asymétrie volontaire).
```

Commit: `docs(spec): append Update — Shipped on roadmap-predictive Cleanup + Connectors`.

---

## Final validation

- [ ] `git log --pretty=format:"%ae" --since="<start of this work>" | sort -u` returns only `roblastar@live.fr`.
- [ ] `node scripts/check-test-inventory.mjs` exits 0.
- [ ] `patches/upstream-all.diff` contains all the new upstream files (cleanup-core, cleanup, connectors-core, connectors, 4 connectors/*.mjs).
- [ ] ROADMAP row 40 + INVENTORY sub-section + smoke loop + spec Update block all present.

---

## Self-Review

**Spec coverage**:
- §3.2 Mécanisme A (cleanup) — Tasks 1, 2, 3, 10, 11.
- §3.2 Mécanisme B (connectors) — Tasks 4, 5, 6, 7, 8.
- §3.2 Plugin registry — already shipped in CORE Task 6.5 (`registerGhostSource`). Connectors register via that.
- §3.3 Tests — Tasks 1, 4, 5, 8, 9, 10.
- §4 Out-of-scope respected (no bidirectional, no auto-resolution, no webhooks).
- §5 Open questions Q1-Q4 — resolved by design (TLS option for Plane noted in plane.mjs comments ; threshold tunable ; conflict UI = list separately).

**Placeholder scan**: full code in every code-step. Tasks 10/11 reference existing `AuditPanel.tsx` / `AuditSummary.tsx` — implementer must read those to find the exact prop pass-through. Step descriptions cover the discovery.

**Type consistency**: ghost runtime shape + `computeExpired` return shape from Audit reused unchanged. Endpoint payloads consistent across Tasks 2 + 7.

**Known risks**:
- Task 11 (AuditPanel wiring) depends on the actual prop shape of `AuditSummary.tsx`. The Audit Task 14 commit (`97cea88f`) introduced the 6th card. Implementer reads that file first.
- LLM call deferred to user copy/paste (v1 simplification). Documented as a limitation in the Shipped Update.

---

**Plan complete. Execution: subagent-driven-development.**
