# Roadmap Predictive — Ghost Cluster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the Ghost Cluster concept — granularité intermédiaire entre node et tier — avec 4 surfaces UI (Augmented halo, Gantt swimlanes, Audit ClustersCard, Filters toggles) + endpoint + MCP tool.

**Architecture:** Hybride : convention markdown `## 🔗 Clusters` dans `ROADMAP.md` (declared) + auto-derivation via connected components du graphe `dependsOn[]` (auto). Sidecar `.gitnexus/clusters.json`. `roadmap.yml` reflète. Endpoint `GET /clusters`. MCP tool `gitnexus_clusters` (20ème). 4 nouveaux composants UI réutilisant les fns/services existants (`tierColor`, `passesFilter`, `parseTargetDate`, etc.).

**Tech Stack:** Node 22 (CI) / Node 21 (local — vitest 4.x bloqué), zero new deps.

**Spec source:** [docs/superpowers/specs/2026-05-27-roadmap-predictive-ghost-cluster-design.md](../specs/2026-05-27-roadmap-predictive-ghost-cluster-design.md) (commit `dca9e021`)

**Depends on:** CORE + Audit + Augmented graph + Gantt + Brainstorm-hook + SysML export — tous shippés.

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branch `deployment`).

**Implementer reminders:**
1. `upstream/` is gitignored — regen `patches/upstream-all.diff` après chaque modification. NEVER `git add upstream/...`.
2. Local Node 21 ne peut pas runner vitest 4.x — valider via `node --check` + smoke `node -e`. CI Node 22 fait le runtime.
3. `git config user.email` doit être `roblastar@live.fr`. Verify once.
4. Append `## Update YYYY-MM-DD — Shipped` au spec à la dernière tâche (17).

---

## File Structure

```
upstream/
├── docker-server-ghosts-core.mjs            MOD  +parseClusters, +deriveAutoClusters, +computeClusterStatus, +renderClustersYml
├── docker-server-ghosts.mjs                 MOD  syncGhostsForRepo écrit aussi clusters.json
├── docker-server-cluster-audit.mjs          NEW  GET /clusters handler
└── docker-server.mjs                         MOD  register /clusters route

upstream/gitnexus-web/src/
├── lib/
│   ├── cluster-layout.ts                    NEW  convex hull + swimlane assignment
│   └── ghost-layout.ts                      MOD  extends filters with showClusterHalos / clusterSourceFilter
├── services/clusters-client.ts              NEW  fetch + 30s cache
├── hooks/
│   ├── useAppState.tsx                      MOD  +showClusterHalos, +includeAutoClusters state
│   └── useSigma.ts                          MOD  +applyClusterHalos / removeClusterHalos
├── components/
│   ├── ClusterTooltip.tsx                   NEW  popup au click sur halo
│   ├── GraphCanvas.tsx                      MOD  inject cluster halos
│   ├── GhostFiltersSection.tsx              MOD  ajoute 3 toggles cluster
│   ├── GanttPanel.tsx                       MOD  3-state swimlanes (flat | tier | cluster)
│   └── audit/
│       ├── ClustersCard.tsx                 NEW  card 7ème dans AuditSummary
│       ├── ClusterDrillModal.tsx            NEW  modal drill-down
│       └── AuditSummary.tsx                 MOD  passe clusters prop + onClustersClick

mcp-server/
├── server.mjs                               MOD  ajoute gitnexus_clusters (20ème)
└── smoke.mjs                                MOD  smoke entry

tests/
├── unit/
│   ├── ghosts-clusters-parser.test.mjs              NEW
│   ├── ghosts-clusters-auto-derive.test.mjs         NEW
│   ├── ghosts-clusters-status.test.mjs              NEW
│   ├── cluster-layout.test.mjs                      NEW
│   └── components/
│       ├── ClusterTooltip.test.tsx                  NEW
│       └── audit/ClustersCard.test.tsx              NEW
├── integration/endpoints/clusters.test.mjs          NEW
└── e2e/specs/06-cluster-halos.spec.ts               NEW

ROADMAP.md                                   MOD  row 47 + initial `## 🔗 Clusters` section
INVENTORY.md                                 MOD  nouvelle sous-section
CLAUDE.md                                    MOD  smoke loop entry
tests/README.md                              MOD  ~8 new rows
docs/superpowers/specs/2026-05-27-roadmap-predictive-ghost-cluster-design.md  MOD  Update — Shipped
patches/upstream-all.diff                    REGEN
```

---

## Section A — CORE parser extension (Tasks 1-3)

### Task 1: `parseClusters` — extract declared clusters from markdown

**Files:**
- Modify: `upstream/docker-server-ghosts-core.mjs`
- Create: `tests/unit/ghosts-clusters-parser.test.mjs`

- [ ] **Step 1: Test**

```js
import { describe, it, expect } from 'vitest';
import { parseClusters } from '../../upstream/docker-server-ghosts-core.mjs';

describe('parseClusters', () => {
  const md = [
    '## 🔗 Clusters',
    '',
    '### Auth overhaul',
    '**ExpectedBy** : 2026-Q3',
    '**Members** : tier-1-1-login, tier-1-2-session, tier-2-3-mfa',
    '**Status** : planned',
    '',
    '### DB migration',
    '**Members** : tier-1-1-orphan, tier-2-2-rollback',
    '',
  ].join('\n');

  it('extracts declared clusters with all fields', () => {
    const out = parseClusters(md);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: 'auth-overhaul',
      source: 'declared',
      title: 'Auth overhaul',
      expectedBy: '2026-Q3',
      memberIds: ['tier-1-1-login', 'tier-1-2-session', 'tier-2-3-mfa'],
      declaredStatus: 'planned',
    });
    expect(out[1]).toMatchObject({
      id: 'db-migration',
      title: 'DB migration',
      memberIds: ['tier-1-1-orphan', 'tier-2-2-rollback'],
      expectedBy: null,
      declaredStatus: null,
    });
  });

  it('returns [] when no section', () => {
    expect(parseClusters('# foo\n')).toEqual([]);
  });

  it('returns [] when section empty', () => {
    expect(parseClusters('## 🔗 Clusters\n\n## other\n')).toEqual([]);
  });

  it('handles missing Members line as 0 members', () => {
    const md = '## 🔗 Clusters\n\n### empty\n**ExpectedBy** : 2026-Q1\n';
    const out = parseClusters(md);
    expect(out[0].memberIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement (append to `docker-server-ghosts-core.mjs`)**

```js
// --- Clusters parser ---

const CLUSTERS_SECTION_RE = /^##\s+🔗\s+Clusters\s*$/i;
const CLUSTER_HEADING_RE = /^###\s+(.+?)\s*$/;
const CLUSTER_EXPECTEDBY_RE = /^\*\*ExpectedBy\*\*\s*:\s*(.+)$/i;
const CLUSTER_MEMBERS_RE = /^\*\*Members\*\*\s*:\s*(.+)$/i;
const CLUSTER_STATUS_RE = /^\*\*Status\*\*\s*:\s*(.+)$/i;

export function parseClusters(md) {
  if (!md || typeof md !== 'string') return [];
  const lines = md.split('\n');
  const out = [];
  let inSection = false;
  let current = null;

  function flush() {
    if (current) out.push(current);
    current = null;
  }

  for (const line of lines) {
    if (CLUSTERS_SECTION_RE.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith('## ') && !CLUSTERS_SECTION_RE.test(line)) {
      flush();
      inSection = false;
      continue;
    }
    if (!inSection) continue;

    const heading = line.match(CLUSTER_HEADING_RE);
    if (heading) {
      flush();
      const title = heading[1].trim();
      current = {
        id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60),
        source: 'declared',
        title,
        expectedBy: null,
        memberIds: [],
        declaredStatus: null,
      };
      continue;
    }
    if (!current) continue;

    const eb = line.match(CLUSTER_EXPECTEDBY_RE);
    if (eb) { current.expectedBy = eb[1].trim(); continue; }
    const mem = line.match(CLUSTER_MEMBERS_RE);
    if (mem) { current.memberIds = mem[1].split(',').map(s => s.trim()).filter(Boolean); continue; }
    const st = line.match(CLUSTER_STATUS_RE);
    if (st) { current.declaredStatus = st[1].trim().toLowerCase(); continue; }
  }
  flush();
  return out;
}
```

- [ ] **Step 3: Validate + commit**

```bash
node --check upstream/docker-server-ghosts-core.mjs && node --check tests/unit/ghosts-clusters-parser.test.mjs
node -e "import('./upstream/docker-server-ghosts-core.mjs').then(m => console.log('parseClusters in exports:', 'parseClusters' in m))"
# expected: parseClusters in exports: true

cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghosts-clusters-parser.test.mjs
git commit -m "feat(clusters): parseClusters — extract declared clusters from ROADMAP.md"
```

---

### Task 2: `deriveAutoClusters` — connected components on dependsOn

**Files:**
- Modify: `upstream/docker-server-ghosts-core.mjs`
- Create: `tests/unit/ghosts-clusters-auto-derive.test.mjs`

- [ ] **Step 1: Test**

```js
import { describe, it, expect } from 'vitest';
import { deriveAutoClusters } from '../../upstream/docker-server-ghosts-core.mjs';
import { createHash } from 'node:crypto';

function expectedAutoId(memberIds) {
  const sorted = [...memberIds].sort();
  const sha = createHash('sha256').update(sorted.join(',')).digest('hex');
  return `auto-cluster-${sha.slice(0, 8)}`;
}

describe('deriveAutoClusters', () => {
  it('groups ghosts connected via dependsOn (undirected)', () => {
    const ghosts = [
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: [] },
      { id: 'c', dependsOn: ['d'] },
      { id: 'd', dependsOn: [] },
      { id: 'e', dependsOn: [] }, // isolated, ignored
    ];
    const out = deriveAutoClusters(ghosts, new Set());
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ source: 'auto', memberIds: ['a', 'b'] });
    expect(out[1].memberIds.sort()).toEqual(['c', 'd']);
  });

  it('excludes ghosts in claimedIds (already in declared cluster)', () => {
    const ghosts = [
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: [] },
    ];
    const claimed = new Set(['a']); // 'a' already declared elsewhere
    const out = deriveAutoClusters(ghosts, claimed);
    expect(out).toHaveLength(0); // 'b' alone is not a cluster
  });

  it('id is deterministic sha256(sorted memberIds)[:8]', () => {
    const ghosts = [
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: [] },
    ];
    const out = deriveAutoClusters(ghosts, new Set());
    expect(out[0].id).toBe(expectedAutoId(['a', 'b']));
  });

  it('skips singletons (composant connecté = 1)', () => {
    const ghosts = [{ id: 'a', dependsOn: [] }];
    expect(deriveAutoClusters(ghosts, new Set())).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement (append)**

```js
import { createHash as _createHash } from 'node:crypto';

export function deriveAutoClusters(ghosts, claimedIds) {
  if (!Array.isArray(ghosts) || ghosts.length === 0) return [];

  // Union-Find over the undirected dependsOn edges.
  const parent = new Map();
  const find = (x) => {
    if (parent.get(x) === x) return x;
    const root = find(parent.get(x));
    parent.set(x, root);
    return root;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const g of ghosts) parent.set(g.id, g.id);
  for (const g of ghosts) {
    for (const dep of g.dependsOn || []) {
      if (parent.has(dep)) union(g.id, dep);
    }
  }

  // Group by root.
  const groups = new Map();
  for (const g of ghosts) {
    if (claimedIds.has(g.id)) continue;
    const root = find(g.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(g.id);
  }

  const out = [];
  for (const memberIds of groups.values()) {
    if (memberIds.length < 2) continue; // singletons not a cluster
    const sorted = [...memberIds].sort();
    const sha = _createHash('sha256').update(sorted.join(',')).digest('hex');
    out.push({
      id: `auto-cluster-${sha.slice(0, 8)}`,
      source: 'auto',
      title: `Auto cluster ${sha.slice(0, 8)}`,
      expectedBy: null,
      memberIds: sorted,
      declaredStatus: null,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
```

- [ ] **Step 3: Validate + commit**

```bash
node --check upstream/docker-server-ghosts-core.mjs && node --check tests/unit/ghosts-clusters-auto-derive.test.mjs

cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghosts-clusters-auto-derive.test.mjs
git commit -m "feat(clusters): deriveAutoClusters — Union-Find on dependsOn graph"
```

---

### Task 3: `computeClusterStatus` — aggregate + synthesis + expired

**Files:**
- Modify: `upstream/docker-server-ghosts-core.mjs`
- Create: `tests/unit/ghosts-clusters-status.test.mjs`

- [ ] **Step 1: Test**

```js
import { describe, it, expect } from 'vitest';
import { computeClusterStatus } from '../../upstream/docker-server-ghosts-core.mjs';

const NOW = new Date('2026-05-27T00:00:00Z');

describe('computeClusterStatus', () => {
  const cluster = { id: 'c', memberIds: ['a', 'b', 'c'], expectedBy: null, declaredStatus: null };

  it('synthesizes "planned" when ≥1 member planned', () => {
    const members = [
      { id: 'a', status: 'planned' },
      { id: 'b', status: 'materialized' },
      { id: 'c', status: 'materialized' },
    ];
    const r = computeClusterStatus(cluster, members, { now: NOW });
    expect(r.aggregate).toMatchObject({ total: 3, materialized: 2, planned: 1, expired: 0, cancelled: 0 });
    expect(r.aggregate.completionPct).toBeCloseTo(66.7, 1);
    expect(r.synthesizedStatus).toBe('planned');
  });

  it('synthesizes "shipped" when all-terminal AND ≥1 materialized', () => {
    const members = [
      { id: 'a', status: 'materialized' },
      { id: 'b', status: 'cancelled' },
      { id: 'c', status: 'materialized' },
    ];
    const r = computeClusterStatus(cluster, members, { now: NOW });
    expect(r.synthesizedStatus).toBe('shipped');
  });

  it('synthesizes "cancelled" when all cancelled', () => {
    const members = cluster.memberIds.map(id => ({ id, status: 'cancelled' }));
    const r = computeClusterStatus(cluster, members, { now: NOW });
    expect(r.synthesizedStatus).toBe('cancelled');
  });

  it('synthesizes "expired" when not shipped AND expectedBy + grace passed', () => {
    const c = { ...cluster, expectedBy: '2025-12-01' }; // grace 30j → expired since 2025-12-31
    const members = cluster.memberIds.map(id => ({ id, status: 'planned' }));
    const r = computeClusterStatus(c, members, { now: NOW, gracePeriodDays: 30 });
    expect(r.synthesizedStatus).toBe('expired');
  });

  it('declaredStatus wins over synthesis', () => {
    const c = { ...cluster, declaredStatus: 'shipped' };
    const members = cluster.memberIds.map(id => ({ id, status: 'planned' }));
    const r = computeClusterStatus(c, members, { now: NOW });
    expect(r.synthesizedStatus).toBe('shipped');
  });

  it('plannedAt = min member plannedAt; materializedAt = max when all-terminal-with-mat', () => {
    const members = [
      { id: 'a', status: 'materialized', plannedAt: { date: '2026-01-01' }, materializedAt: { date: '2026-02-01' } },
      { id: 'b', status: 'materialized', plannedAt: { date: '2026-01-15' }, materializedAt: { date: '2026-03-01' } },
      { id: 'c', status: 'cancelled', plannedAt: { date: '2026-01-10' }, cancelledAt: { date: '2026-02-15' } },
    ];
    const r = computeClusterStatus({ ...cluster, memberIds: ['a', 'b', 'c'] }, members, { now: NOW });
    expect(r.plannedAt?.date).toBe('2026-01-01');
    expect(r.materializedAt?.date).toBe('2026-03-01');
  });
});
```

- [ ] **Step 2: Implement (append)**

```js
export function computeClusterStatus(cluster, members, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const gracePeriodDays = opts.gracePeriodDays ?? 30;

  const total = members.length;
  let materialized = 0, planned = 0, expired = 0, cancelled = 0;
  let minPlannedAt = null;
  let maxMaterializedAt = null;
  let maxCancelledAt = null;

  for (const m of members) {
    if (m.status === 'materialized') materialized++;
    else if (m.status === 'cancelled') cancelled++;
    else if (m.status === 'expired') expired++;
    else planned++;

    if (m.plannedAt?.date) {
      if (!minPlannedAt || new Date(m.plannedAt.date) < new Date(minPlannedAt.date)) minPlannedAt = m.plannedAt;
    }
    if (m.materializedAt?.date) {
      if (!maxMaterializedAt || new Date(m.materializedAt.date) > new Date(maxMaterializedAt.date)) maxMaterializedAt = m.materializedAt;
    }
    if (m.cancelledAt?.date) {
      if (!maxCancelledAt || new Date(m.cancelledAt.date) > new Date(maxCancelledAt.date)) maxCancelledAt = m.cancelledAt;
    }
  }

  const completionPct = total > 0 ? (materialized / total) * 100 : 0;
  const allTerminal = (materialized + cancelled) === total;
  const allCancelled = cancelled === total && total > 0;

  let synthesizedStatus;
  if (allCancelled) synthesizedStatus = 'cancelled';
  else if (allTerminal && materialized > 0) synthesizedStatus = 'shipped';
  else {
    // check expired
    if (cluster.expectedBy) {
      const eb = parseTargetDate(cluster.expectedBy);
      if (eb) {
        const expiry = new Date(eb.getTime() + gracePeriodDays * 86_400_000);
        if (now > expiry) synthesizedStatus = 'expired';
      }
    }
    if (!synthesizedStatus) synthesizedStatus = 'planned';
  }

  // declaredStatus wins (override)
  if (cluster.declaredStatus) synthesizedStatus = cluster.declaredStatus;

  return {
    aggregate: { total, materialized, planned, expired, cancelled, completionPct },
    synthesizedStatus,
    plannedAt: minPlannedAt,
    materializedAt: (allTerminal && materialized > 0) ? maxMaterializedAt : null,
    cancelledAt: allCancelled ? maxCancelledAt : null,
  };
}
```

(Reuses `parseTargetDate` already exported by the module — Task 5 of CORE plan.)

- [ ] **Step 3: Validate + commit**

```bash
node --check upstream/docker-server-ghosts-core.mjs && node --check tests/unit/ghosts-clusters-status.test.mjs

cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghosts-clusters-status.test.mjs
git commit -m "feat(clusters): computeClusterStatus (aggregate + synthesis + expired + declaredStatus override)"
```

---

## Section B — Sidecar I/O + roadmap.yml reflection (Tasks 4-5)

### Task 4: Extend `syncGhostsForRepo` to write `clusters.json`

**Files:**
- Modify: `upstream/docker-server-ghosts.mjs`

- [ ] **Step 1: Implementation**

After the existing `await writeFile(runtimePath, ...)` for ghosts.json, add :

```js
import { parseClusters, deriveAutoClusters, computeClusterStatus } from './docker-server-ghosts-core.mjs';

// inside syncGhostsForRepo, after writing ghosts.json :
const declaredClusters = parseClusters(md);
const claimedIds = new Set(declaredClusters.flatMap(c => c.memberIds));
const autoClusters = deriveAutoClusters(runtime.ghosts, claimedIds);
const allClusters = [...declaredClusters, ...autoClusters];

// Map ghosts by id for fast lookup.
const ghostsById = new Map(runtime.ghosts.map(g => [g.id, g]));

const clustersRuntime = allClusters.map(c => {
  const members = c.memberIds.map(mid => {
    const g = ghostsById.get(mid);
    if (!g) return { id: mid, status: 'planned' }; // missing member
    return {
      id: g.id,
      status: g.declared.status,
      plannedAt: g.plannedAt,
      materializedAt: g.materializedAt,
      cancelledAt: g.cancelledAt,
    };
  });
  const computed = computeClusterStatus(c, members);
  return { ...c, ...computed };
});

const clustersJson = {
  syncedAt: runtime.syncedAt,
  syncedCommit: runtime.syncedCommit,
  clusters: clustersRuntime,
};
const clustersPath = join(repoPath, '.gitnexus', 'clusters.json');
await writeFile(clustersPath, JSON.stringify(clustersJson, null, 2) + '\n');
```

- [ ] **Step 2: Same for `syncGhostsForSnapshot`** (write `<snapshotDir>/clusters.json` alongside `ghosts.json`).

- [ ] **Step 3: Add `readLatestClusters` + `readSnapshotClusters` exports.**

```js
export async function readLatestClusters(repoPath) {
  const path = join(repoPath, '.gitnexus', 'clusters.json');
  if (!(await fileExists(path))) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function readSnapshotClusters(snapshotDir) {
  const path = join(snapshotDir, 'clusters.json');
  if (!(await fileExists(path))) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}
```

- [ ] **Step 4: Validate + commit**

```bash
node --check upstream/docker-server-ghosts.mjs
node -e "import('./upstream/docker-server-ghosts.mjs').then(m => console.log('readLatestClusters' in m))"

cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(clusters): sync writes clusters.json sidecar + readLatest/SnapshotClusters"
```

---

### Task 5: Extend `renderRoadmapYml` to emit `clusters:` section

**Files:**
- Modify: `upstream/docker-server-ghosts-core.mjs`

- [ ] **Step 1: Extend the function signature**

`renderRoadmapYml(ghosts, opts)` — opts.clusters = array of declared clusters (auto-clusters NOT included in YAML, only in runtime).

```js
export function renderRoadmapYml(ghosts, opts = {}) {
  // existing ghost rendering...
  let yml = renderGhostsSection(ghosts);
  if (opts.clusters && opts.clusters.length > 0) {
    yml += '\nclusters:\n';
    for (const c of opts.clusters) {
      yml += `  - id: ${c.id}\n`;
      yml += `    title: ${yamlString(c.title)}\n`;
      if (c.expectedBy) yml += `    expectedBy: ${yamlString(c.expectedBy)}\n`;
      yml += `    members:\n`;
      for (const m of c.memberIds) yml += `      - ${m}\n`;
      if (c.declaredStatus) yml += `    status: ${c.declaredStatus}\n`;
    }
  }
  return yml;
}
```

- [ ] **Step 2: Update caller in `syncGhostsForRepo`** : `renderRoadmapYml(ghosts, { clusters: declaredClusters })`.

- [ ] **Step 3: Extend the existing `tests/unit/ghosts-yaml.test.mjs` with a "renders clusters section" case** (parseable YAML, deterministic order).

- [ ] **Step 4: Commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghosts-yaml.test.mjs
git commit -m "feat(clusters): renderRoadmapYml emits clusters: section (declared only)"
```

---

## Section C — Endpoint + route registration (Tasks 6-7)

### Task 6: Create `docker-server-cluster-audit.mjs` + handler

**Files:**
- Create: `upstream/docker-server-cluster-audit.mjs`

```js
import { readLatestClusters } from './docker-server-ghosts.mjs';
import { findRepoByName } from './docker-server-snapshots.mjs';

export async function handleClusters(url, res, opts) {
  const repoName = url.searchParams.get('repo');
  const sourceFilter = url.searchParams.get('source'); // 'declared' | 'auto' | undefined
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
  const runtime = await readLatestClusters(repoPath);
  if (!runtime) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No clusters.json — run POST /ghosts/sync first.' }));
  }
  let clusters = runtime.clusters || [];
  if (sourceFilter === 'declared' || sourceFilter === 'auto') {
    clusters = clusters.filter(c => c.source === sourceFilter);
  } else if (sourceFilter) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `invalid source: ${sourceFilter}` }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ...runtime, clusters }));
}

export async function handleClustersRoute(req, url, res, opts) {
  if (url.pathname === '/clusters' && req.method === 'GET') {
    await handleClusters(url, res, opts);
    return true;
  }
  return false;
}
```

Commit : `feat(clusters): GET /clusters route handler`.

---

### Task 7: Register `/clusters` route + integration test

**Files:**
- Modify: `upstream/docker-server.mjs` (add import + dispatch)
- Create: `tests/integration/endpoints/clusters.test.mjs`

Integration test:
```js
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /clusters', () => {
  it('returns 400 when repo missing', async () => {
    const res = await fetch(`${BASE}/clusters`);
    expect(res.status).toBe(400);
  });
  it('returns 200 after sync', async () => {
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const res = await fetch(`${BASE}/clusters?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.clusters)).toBe(true);
  });
  it('filters by source', async () => {
    const res = await fetch(`${BASE}/clusters?repo=${FIXTURE.name}&source=declared`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.clusters.every(c => c.source === 'declared')).toBe(true);
  });
  it('400 on invalid source', async () => {
    const res = await fetch(`${BASE}/clusters?repo=${FIXTURE.name}&source=xmi`);
    expect(res.status).toBe(400);
  });
});
```

Commit : `feat+test(clusters): register /clusters route + integration test`.

---

## Section D — MCP tool (Task 8)

### Task 8: `gitnexus_clusters` MCP tool (20th)

**Files:**
- Modify: `mcp-server/server.mjs` (add tool + summary helper)
- Modify: `mcp-server/smoke.mjs` (add smoke entry)

Add to tools array (after `gitnexus_ghost_audit`) :
```js
{
  name: 'gitnexus_clusters',
  description: 'Returns the ghost clusters for a repo. A cluster groups 2+ related ghosts. Two sources: "declared" (from `## 🔗 Clusters` section in ROADMAP.md) or "auto" (connected components of the dependsOn graph). Each cluster carries aggregate counts + synthesizedStatus ({shipped|planned|cancelled|expired}). Use after gitnexus_ghosts_sync.',
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string' },
      source: { type: 'string', enum: ['declared', 'auto'], description: 'Optional filter by source.' },
    },
    required: ['repo'],
    additionalProperties: false,
  },
  handler: async ({ repo, source }) => {
    const params = { repo };
    if (source) params.source = source;
    const data = await callWeb('/clusters', params);
    const summary = formatClustersSummary(data);
    return { ok: true, summary, data };
  },
},
```

Plus helper :
```js
function formatClustersSummary(data) {
  if (!data || data.error) return data?.error || 'no clusters';
  const cs = data.clusters || [];
  if (cs.length === 0) return 'No clusters declared or auto-derived for this repo.';
  return [
    `${cs.length} cluster(s) (synced ${data.syncedAt}):`,
    ...cs.slice(0, 8).map(c =>
      `  - [${c.synthesizedStatus}] ${c.title} (${c.aggregate.completionPct.toFixed(0)}% · ${c.aggregate.materialized}/${c.aggregate.total} matérialisés${c.expectedBy ? ` · expectedBy=${c.expectedBy}` : ''}) [source=${c.source}]`
    ),
    cs.length > 8 ? `  ... +${cs.length - 8} more` : '',
  ].filter(Boolean).join('\n');
}
```

Smoke: ajouter `{ name: 'gitnexus_clusters', arguments: { repo: SMOKE_REPO } }` à la liste d'appels.

Commit : `feat(clusters): gitnexus_clusters MCP tool (20th) + smoke`.

---

## Section E — Pure cluster-layout fns (Task 9)

### Task 9: `cluster-layout.ts` — convex hull + swimlane assignment

**Files:**
- Create: `upstream/gitnexus-web/src/lib/cluster-layout.ts`
- Create: `tests/unit/cluster-layout.test.mjs`

Pure fns:
```ts
export type Point = { x: number; y: number };

// Andrew's monotone chain convex hull (O(n log n))
export function convexHull(points: Point[]): Point[];

// For a cluster, return the polygon vertices in canvas space.
// Singleton (1 point) → circle representation (returns null).
export function clusterHullPolygon(memberPositions: Point[]): Point[] | null;

// Centroid of polygon for label placement.
export function polygonCentroid(polygon: Point[]): Point;

// Gantt swimlane assignment: order clusters by min(plannedAt) ASC, then unclustered last.
export function assignSwimlanes(rows: any[], clusters: any[]): { lane: string; rows: any[] }[];
```

Tests (4-5 cases) per fn.

Commit : `feat(clusters): cluster-layout pure fns (convex hull + swimlane assignment)`.

---

## Section F — Augmented graph halos (Tasks 10-11)

### Task 10: `ClusterTooltip.tsx` popup

Create `upstream/gitnexus-web/src/components/ClusterTooltip.tsx` + test. Popup au click sur halo, affiche : title, source badge (declared/auto), expectedBy, synthesizedStatus badge, members list (cliquable → ghost-tooltip si possible), completionPct.

Commit : `feat(clusters): ClusterTooltip popup`.

---

### Task 11: `useSigma` + GraphCanvas — halos rendering

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useSigma.ts` : `applyClusterHalos(graph, clusters)` + `removeClusterHalos(graph)`.
- Modify: `upstream/gitnexus-web/src/components/GraphCanvas.tsx` : fetch via `clusters-client`, useEffect that applies/removes layer when toggle changes, click handler on halo polygon → set tooltip state.

Halos rendered as Sigma "ground layer" : draw polygons via a Sigma overlay (`<svg>` overlay on top of canvas, positioned with sigma camera transforms) — Sigma 3 doesn't have native polygon support so SVG overlay is the pragmatic choice.

Click detection : point-in-polygon test in canvas coords. (Helper `pointInPolygon(p, poly)` in cluster-layout.ts.)

Commit : `feat(clusters): useSigma applyClusterHalos + GraphCanvas integration`.

---

## Section G — Gantt cluster swimlanes (Task 12)

### Task 12: Extend GanttPanel with `swimlanes: 'cluster'` mode

**Files:**
- Modify: `upstream/gitnexus-web/src/components/GanttPanel.tsx`

Radio buttons (existing): flat / tier / **cluster** (new). When `cluster` selected:
- Fetch clusters via `clusters-client`
- Use `assignSwimlanes` from `cluster-layout.ts`
- Render 1 lane header per cluster (with synthesized status badge + completion %)
- Ghosts not in any cluster go to "Unclustered" lane at the bottom
- A ghost in multiple clusters is duplicated visually (one bar per cluster lane)

Bonus: option `showOnlyClusterBars: boolean` — collapse members into 1 synthetic bar per cluster (start = min(plannedAt), end = max(materializedAt or parseTargetDate(expectedBy))).

Test extension : `tests/unit/components/GanttPanel.test.tsx` gains 2 new cases (swimlanes=cluster renders headers, showOnlyClusterBars collapses).

Commit : `feat(gantt): cluster swimlanes mode + showOnlyClusterBars`.

---

## Section H — Audit ClustersCard (Task 13)

### Task 13: `ClustersCard.tsx` + `ClusterDrillModal.tsx`

**Files:**
- Create: `upstream/gitnexus-web/src/components/audit/ClustersCard.tsx`
- Create: `upstream/gitnexus-web/src/components/audit/ClusterDrillModal.tsx`
- Modify: `upstream/gitnexus-web/src/components/audit/AuditSummary.tsx` (accept `clusters` prop + `onClustersClick`)
- Modify: `upstream/gitnexus-web/src/components/AuditPanel.tsx` (fetch clusters + thread state for modal)

ClustersCard : 7th card next to Expired. Shows "N clusters · X% complete in median". Click → opens ClusterDrillModal.

ClusterDrillModal : list top 5-10 clusters sorted by completionPct ASC, each row expandable to show members + their individual status.

Tests : 2 component files + AuditSummary.test.tsx extension (7th card present when clusters prop given).

Commit : `feat(clusters): Audit ClustersCard + ClusterDrillModal`.

---

## Section I — Filters wiring (Task 14)

### Task 14: 3 new toggles in `GhostFiltersSection`

**Files:**
- Modify: `upstream/gitnexus-web/src/components/GhostFiltersSection.tsx`
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx` (add `showClusterHalos`, `includeAutoClusters`, `clusterSourceFilter` to AppState + setters)

3 new entries in the "Roadmap predictive" section:
- ☐ Show cluster halos (master)
- (when above ON) sub : `[ ] include auto-clusters` (default OFF)
- (when above ON) sub-radio : `[*] both [ ] declared only [ ] auto only`

Test : extend `tests/unit/components/Filters.test.tsx` with 3 new cases (master toggle, auto-toggle visibility, radio mutex).

Commit : `feat(clusters): Filters 3 toggles + useAppState fields`.

---

## Section J — E2E + docs (Tasks 15-17)

### Task 15: E2E test

**Files:**
- Create: `tests/e2e/specs/06-cluster-halos.spec.ts`

```ts
import { test, expect } from '@playwright/test';

test.describe('Cluster halos', () => {
  test('toggle Show cluster halos → halos visible → click → tooltip', async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.locator('[data-testid="graph-canvas"]').waitFor();
    const toggle = page.locator('text=Show cluster halos').first();
    await toggle.click();
    const halo = page.locator('[data-testid^="cluster-halo-"]').first();
    if (await halo.count() === 0) test.skip(true, 'No clusters — fixture must declare some');
    await halo.click();
    await expect(page.locator('[data-testid="cluster-tooltip"]')).toBeVisible();
  });
});
```

Commit : `test(e2e): cluster halos toggle + tooltip`.

---

### Task 16: ROADMAP + INVENTORY + tests/README + CLAUDE smoke + initial ROADMAP section

Add to ROADMAP.md :
- Row 47 (Ghost Cluster description — copy from spec section 2)
- New section `## 🔗 Clusters` at the bottom of ROADMAP.md (empty for now ; user fills in declared clusters over time)

INVENTORY new sub-section, tests/README new rows (~8), CLAUDE smoke entry :
```
curl -s -o /dev/null -w "clusters: HTTP %{http_code}\n" "http://localhost:4173/clusters?repo=hmm_studio"
```

Run `node scripts/check-test-inventory.mjs` — exits 0.

Commit : `docs: roadmap-predictive Ghost Cluster shipped (ROADMAP + INVENTORY + tests inventory + initial section)`.

---

### Task 17: Append Update — Shipped to the spec

```
---

## Update 2026-05-27 — Shipped

Ghost Cluster livré. Notes :
- Hybride : convention markdown `## 🔗 Clusters` + auto-derivation via Union-Find sur dependsOn[] connected components.
- 4 surfaces UI : Augmented halo (convex hull SVG overlay) + Gantt swimlanes mode (3-state radio) + Audit ClustersCard 7ème + Filters toggles hiérarchiques.
- Sidecar `.gitnexus/clusters.json` + roadmap.yml clusters section reflection.
- Endpoint `GET /clusters?repo=&source=` + MCP tool `gitnexus_clusters` (20th).
- 4 pure fns (parseClusters, deriveAutoClusters, computeClusterStatus, cluster-layout) + 9 tests unit/integration/e2e.
- Open question 4 (auto-cluster id stability) : limitation acceptée, user promote en declared pour stabilité.
- Open question 5 (cluster expired propagation) : non — chaque ghost garde son propre status.
- Runtime local Node 21 bloqué (vitest 4.x), CI Node 22 exerce le suite.
```

Commit : `docs(spec): append Update — Shipped on roadmap-predictive Ghost Cluster`.

---

## Final validation

- [ ] `git log --pretty=format:"%ae" --since=...` → `roblastar@live.fr` only.
- [ ] `node scripts/check-test-inventory.mjs` exits 0.
- [ ] `patches/upstream-all.diff` contains the new + modified upstream files.
- [ ] All 4 surfaces visible : Augmented halo toggle in Filters, Gantt cluster radio, Audit 7th card, endpoint responds.

---

## Self-Review

**Spec coverage**: §3.2 Architecture, §3.2 Convention markdown, §3.2 Auto-derivation, §3.2 Runtime shape, §3.2 Endpoint, §3.2 MCP tool, §3.2 4 UI surfaces, §3.2 Filters, §3.2 roadmap.yml reflection, §3.2 Tests — tous couverts par les 17 tasks.

**Placeholder scan**: Sections F-I sont condensées (1 task chacune au lieu de 3-4) car les patterns sont déjà établis par Augmented graph + Gantt + Audit (vu en Brainstorm-hook précédent). L'implémenteur a la spec + 7 sous-specs précédentes comme références concrètes.

**Type consistency**: cluster shape `{ id, source, title, expectedBy, memberIds, declaredStatus, aggregate, synthesizedStatus, plannedAt, materializedAt, cancelledAt }` consistent entre Tasks 1, 3, 4, 6, 8, 10, 12, 13.

**Known risks**:
- Task 11 (Sigma SVG overlay) est nouveau pattern (les autres sub-specs utilisaient le node renderer Sigma). L'implémenteur doit décider si convex hull se calcule à chaque camera move (cher) ou si on bake les positions et n'invalide qu'au sync (acceptable).
- Tasks 12 + 13 + 14 dépendent du shape `clusters` consommé partout — si Task 4 dévie, les UI cassent.
- Task 8 MCP tool : 20th tool — vérifier que le format `tools/list` MCP est OK avec ce volume (devrait l'être, pas de limite spec).

---

**Plan complete. Execution: subagent-driven-development.**
