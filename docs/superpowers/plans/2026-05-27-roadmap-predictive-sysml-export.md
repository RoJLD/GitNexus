# Roadmap Predictive — SysML export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `GET /sysml-export?repo=X&format=plantuml|mermaid&tier=N` that renders the gitnexus graph + ghosts as a PlantUML SysML 1.7 diagram (or Mermaid fallback). 100% backend, ~1.5j.

**Architecture:** Two new server modules — `docker-server-sysml-export-core.mjs` (pure fns `renderPlantUml`, `renderMermaid`, `safeId`) + `docker-server-sysml-export.mjs` (I/O + route). Wired into `docker-server.mjs`. Reuses `readLatestGhosts` from CORE. No frontend.

**Tech Stack:** Node 22 (CI), Node 21 (local — vitest blocked), zero new deps.

**Spec source:** [docs/superpowers/specs/2026-05-27-roadmap-predictive-sysml-export-design.md](../specs/2026-05-27-roadmap-predictive-sysml-export-design.md)

**Depends on:** CORE shipped — `readLatestGhosts` exported from `docker-server-ghosts.mjs`.

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branch `deployment`).

**Implementer reminders:**
1. `upstream/` is gitignored — regen `patches/upstream-all.diff` after every change. NEVER `git add upstream/...`.
2. Validate via `node --check` + smoke `node -e`. CI runs vitest.
3. `git config user.email` must print `roblastar@live.fr`.
4. Append `## Update YYYY-MM-DD — Shipped` to the spec at Task 6.

---

## File Structure

```
upstream/
├── docker-server-sysml-export-core.mjs    NEW  pure fns
├── docker-server-sysml-export.mjs         NEW  I/O + route handler
└── docker-server.mjs                       MOD  register route

tests/
├── unit/
│   ├── sysml-export-plantuml.test.mjs     NEW
│   └── sysml-export-mermaid.test.mjs      NEW
└── integration/endpoints/
    └── sysml-export.test.mjs              NEW

ROADMAP.md / INVENTORY.md / CLAUDE.md / tests/README.md  MOD
docs/superpowers/specs/2026-05-27-roadmap-predictive-sysml-export-design.md  MOD  Update — Shipped
patches/upstream-all.diff                  REGEN
```

---

## Section A — Pure renderers (Tasks 1-2)

### Task 1: `safeId` + `renderPlantUml`

**Files:**
- Create: `upstream/docker-server-sysml-export-core.mjs`
- Create: `tests/unit/sysml-export-plantuml.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { renderPlantUml, safeId } from '../../upstream/docker-server-sysml-export-core.mjs';

describe('safeId', () => {
  it('replaces non-alphanumeric chars with underscore', () => {
    expect(safeId('src/auth/login.ts')).toBe('src_auth_login_ts');
    expect(safeId('WhatIf-Panel.tsx')).toBe('WhatIf_Panel_tsx');
  });
  it('collapses runs of non-alphanumeric', () => {
    expect(safeId('a//b')).toBe('a_b');
  });
});

describe('renderPlantUml', () => {
  it('emits empty diagram when no ghosts', () => {
    const out = renderPlantUml({ ghosts: [], files: [], repoName: 'x' });
    expect(out).toContain('@startuml');
    expect(out).toContain('@enduml');
    expect(out).toContain('title gitnexus');
    expect(out).toContain('x');
  });

  it('emits requirement for each planned ghost', () => {
    const out = renderPlantUml({
      ghosts: [{
        id: 'tier-2-3-x', declared: { title: 'X' }, status: 'planned', tier: '2.3',
        links: [], plannedAt: { date: '2026-01-01' },
      }],
      files: [], repoName: 'r',
    });
    expect(out).toMatch(/requirement\s+"X"\s+as\s+R_/);
  });

  it('emits block for each file', () => {
    const out = renderPlantUml({
      ghosts: [], files: ['src/auth/login.ts'], repoName: 'r',
    });
    expect(out).toMatch(/block\s+"src\/auth\/login\.ts"\s+as\s+B_src_auth_login_ts/);
  });

  it('emits satisfy edge for matched ghost link', () => {
    const out = renderPlantUml({
      ghosts: [{
        id: 'g1', declared: { title: 'G' }, status: 'planned', tier: '1.1',
        links: [{ file: 'src/auth/login.ts' }],
      }],
      files: ['src/auth/login.ts'], repoName: 'r',
    });
    expect(out).toMatch(/R_g1\s*\.\.>\s*B_src_auth_login_ts\s*:\s*<<satisfy>>/);
  });

  it('wraps ghosts in tier packages', () => {
    const out = renderPlantUml({
      ghosts: [
        { id: 'a', declared: { title: 'A' }, status: 'planned', tier: '1.2', links: [] },
        { id: 'b', declared: { title: 'B' }, status: 'planned', tier: '2.3', links: [] },
      ],
      files: [], repoName: 'r',
    });
    expect(out).toMatch(/package\s+"Tier 1"/);
    expect(out).toMatch(/package\s+"Tier 2"/);
  });

  it('omits cancelled and materialized ghosts', () => {
    const out = renderPlantUml({
      ghosts: [
        { id: 'a', declared: { title: 'A' }, status: 'cancelled', tier: '1', links: [] },
        { id: 'b', declared: { title: 'B' }, status: 'materialized', tier: '1', links: [] },
      ],
      files: [], repoName: 'r',
    });
    expect(out).not.toContain('R_a');
    expect(out).not.toContain('R_b');
  });

  it('emits deriveReqt edge for dependsOn', () => {
    const out = renderPlantUml({
      ghosts: [
        { id: 'a', declared: { title: 'A' }, status: 'planned', tier: '1', links: [], dependsOn: ['b'] },
        { id: 'b', declared: { title: 'B' }, status: 'planned', tier: '1', links: [] },
      ],
      files: [], repoName: 'r',
    });
    expect(out).toMatch(/R_a\s*\.\.>\s*R_b\s*:\s*<<deriveReqt>>/);
  });

  it('filters by tier when tierFilter set', () => {
    const out = renderPlantUml({
      ghosts: [
        { id: 'a', declared: { title: 'A' }, status: 'planned', tier: '1.2', links: [] },
        { id: 'b', declared: { title: 'B' }, status: 'planned', tier: '2.3', links: [] },
      ],
      files: [], repoName: 'r', tierFilter: '1',
    });
    expect(out).toContain('R_a');
    expect(out).not.toContain('R_b');
  });
});
```

- [ ] **Step 2: Implement**

```js
// upstream/docker-server-sysml-export-core.mjs
//
// Pure renderers for SysML export. No I/O. Consumes runtime ghosts (from
// .gitnexus/ghosts.json) + a list of file paths.

export function safeId(s) {
  if (!s) return 'x';
  const slug = String(s).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug.length === 0 ? 'x' : slug;
}

function tierMajor(tier) {
  if (!tier) return 'none';
  const m = String(tier).match(/^(\d+)/);
  return m ? m[1] : 'none';
}

function selectRenderableGhosts(ghosts, tierFilter) {
  return (ghosts || []).filter((g) => {
    if (g.status !== 'planned' && g.status !== 'expired') return false;
    if (!tierFilter) return true;
    return tierMajor(g.tier) === String(tierFilter);
  });
}

export function renderPlantUml({ ghosts, files, repoName, tierFilter }) {
  const selected = selectRenderableGhosts(ghosts, tierFilter);
  const fileSet = new Set(files || []);
  // Auto-include any file that a selected ghost satisfies.
  for (const g of selected) for (const l of g.links || []) if (l.file) fileSet.add(l.file);

  // Group ghosts by tier major.
  const byTier = new Map();
  for (const g of selected) {
    const k = tierMajor(g.tier);
    if (!byTier.has(k)) byTier.set(k, []);
    byTier.get(k).push(g);
  }

  // Group files by tier (= tier of the ghost that satisfies them, fallback 'none').
  const fileTier = new Map();
  for (const g of selected) {
    const k = tierMajor(g.tier);
    for (const l of g.links || []) if (l.file && !fileTier.has(l.file)) fileTier.set(l.file, k);
  }
  for (const f of fileSet) if (!fileTier.has(f)) fileTier.set(f, 'none');
  const filesByTier = new Map();
  for (const [f, k] of fileTier) {
    if (!filesByTier.has(k)) filesByTier.set(k, []);
    filesByTier.get(k).push(f);
  }

  const lines = [];
  lines.push('@startuml');
  lines.push(`title gitnexus — Roadmap predictive SysML (${repoName || 'unknown'})`);
  lines.push('');

  const tiers = ['1', '2', '3', 'none'];
  for (const t of tiers) {
    const tGhosts = byTier.get(t) || [];
    const tFiles = filesByTier.get(t) || [];
    if (tGhosts.length === 0 && tFiles.length === 0) continue;
    const label = t === 'none' ? 'Sans tier' : `Tier ${t}`;
    lines.push(`package "${label}" {`);
    for (const f of tFiles.sort()) {
      lines.push(`  block "${f}" as B_${safeId(f)}`);
    }
    for (const g of tGhosts.sort((a, b) => a.id.localeCompare(b.id))) {
      const title = (g.declared?.title || g.id).replace(/"/g, '\\"');
      lines.push(`  requirement "${title}" as R_${safeId(g.id)}`);
    }
    for (const g of tGhosts.sort((a, b) => a.id.localeCompare(b.id))) {
      for (const l of g.links || []) {
        if (l.file && fileSet.has(l.file)) {
          lines.push(`  R_${safeId(g.id)} ..> B_${safeId(l.file)} : <<satisfy>>`);
        }
      }
      for (const depId of g.dependsOn || []) {
        lines.push(`  R_${safeId(g.id)} ..> R_${safeId(depId)} : <<deriveReqt>>`);
      }
    }
    lines.push('}');
    lines.push('');
  }

  lines.push('@enduml');
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 3: Validate + commit**

```bash
node --check upstream/docker-server-sysml-export-core.mjs && node --check tests/unit/sysml-export-plantuml.test.mjs
node -e "import('./upstream/docker-server-sysml-export-core.mjs').then(m => console.log(Object.keys(m).sort()))"
# expected (after Task 1): [ 'renderPlantUml', 'safeId' ]

cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/sysml-export-plantuml.test.mjs
git commit -m "feat(sysml): renderPlantUml + safeId pure fns"
```

---

### Task 2: `renderMermaid` fallback

**Files:**
- Modify: `upstream/docker-server-sysml-export-core.mjs`
- Create: `tests/unit/sysml-export-mermaid.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { renderMermaid } from '../../upstream/docker-server-sysml-export-core.mjs';

describe('renderMermaid', () => {
  it('emits graph TD header', () => {
    expect(renderMermaid({ ghosts: [], files: [], repoName: 'r' })).toMatch(/^graph TD/m);
  });

  it('emits a node per file and per ghost with stereotype', () => {
    const out = renderMermaid({
      ghosts: [{ id: 'g1', declared: { title: 'G' }, status: 'planned', tier: '1', links: [{ file: 'a.ts' }] }],
      files: ['a.ts'], repoName: 'r',
    });
    expect(out).toMatch(/B_a_ts\[/);
    expect(out).toMatch(/R_g1\[/);
    expect(out).toMatch(/R_g1\s*-->\|satisfy\|\s*B_a_ts/);
  });

  it('groups tiers in subgraphs', () => {
    const out = renderMermaid({
      ghosts: [{ id: 'a', declared: { title: 'A' }, status: 'planned', tier: '2', links: [] }],
      files: [], repoName: 'r',
    });
    expect(out).toMatch(/subgraph Tier_2/);
    expect(out).toMatch(/^end$/m);
  });
});
```

- [ ] **Step 2: Append impl**

```js
// Append to docker-server-sysml-export-core.mjs

export function renderMermaid({ ghosts, files, repoName, tierFilter }) {
  const selected = selectRenderableGhosts(ghosts, tierFilter);
  const fileSet = new Set(files || []);
  for (const g of selected) for (const l of g.links || []) if (l.file) fileSet.add(l.file);

  const byTier = new Map();
  for (const g of selected) {
    const k = tierMajor(g.tier);
    if (!byTier.has(k)) byTier.set(k, []);
    byTier.get(k).push(g);
  }
  const fileTier = new Map();
  for (const g of selected) {
    const k = tierMajor(g.tier);
    for (const l of g.links || []) if (l.file && !fileTier.has(l.file)) fileTier.set(l.file, k);
  }
  for (const f of fileSet) if (!fileTier.has(f)) fileTier.set(f, 'none');
  const filesByTier = new Map();
  for (const [f, k] of fileTier) {
    if (!filesByTier.has(k)) filesByTier.set(k, []);
    filesByTier.get(k).push(f);
  }

  const lines = [];
  lines.push('graph TD');
  lines.push(`%% gitnexus — Roadmap predictive (${repoName || 'unknown'})`);

  const tiers = ['1', '2', '3', 'none'];
  for (const t of tiers) {
    const tGhosts = byTier.get(t) || [];
    const tFiles = filesByTier.get(t) || [];
    if (tGhosts.length === 0 && tFiles.length === 0) continue;
    lines.push(`subgraph Tier_${t === 'none' ? 'none' : t}["${t === 'none' ? 'Sans tier' : `Tier ${t}`}"]`);
    for (const f of tFiles.sort()) {
      lines.push(`  B_${safeId(f)}[<<B>> ${f}]`);
    }
    for (const g of tGhosts.sort((a, b) => a.id.localeCompare(b.id))) {
      const title = (g.declared?.title || g.id);
      lines.push(`  R_${safeId(g.id)}[<<R>> ${title}]`);
    }
    lines.push('end');
  }
  for (const t of tiers) {
    for (const g of (byTier.get(t) || [])) {
      for (const l of g.links || []) {
        if (l.file && fileSet.has(l.file)) {
          lines.push(`R_${safeId(g.id)} -->|satisfy| B_${safeId(l.file)}`);
        }
      }
      for (const depId of g.dependsOn || []) {
        lines.push(`R_${safeId(g.id)} -->|deriveReqt| R_${safeId(depId)}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 3: Commit**

```bash
node --check upstream/docker-server-sysml-export-core.mjs && node --check tests/unit/sysml-export-mermaid.test.mjs
node -e "import('./upstream/docker-server-sysml-export-core.mjs').then(m => console.log(Object.keys(m).sort()))"
# expected: [ 'renderMermaid', 'renderPlantUml', 'safeId' ]

cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/sysml-export-mermaid.test.mjs
git commit -m "feat(sysml): renderMermaid fallback renderer"
```

---

## Section B — I/O wrapper + endpoint + route (Tasks 3-4)

### Task 3: `docker-server-sysml-export.mjs` + I/O wrapper

**Files:**
- Create: `upstream/docker-server-sysml-export.mjs`

```js
// upstream/docker-server-sysml-export.mjs
import { renderPlantUml, renderMermaid } from './docker-server-sysml-export-core.mjs';
import { readLatestGhosts } from './docker-server-ghosts.mjs';
import { findRepoByName } from './docker-server-snapshots.mjs';

async function buildSysmlExport(repoPath, { format = 'plantuml', tierFilter, repoName }) {
  const runtime = await readLatestGhosts(repoPath);
  if (!runtime) return null;
  const ghosts = runtime.ghosts || [];
  // Collect referenced files from ghost.links — v1 doesn't include the full
  // gitnexus graph (would explode the diagram). Files are only those that a
  // ghost satisfies.
  const files = [];
  const seen = new Set();
  for (const g of ghosts) for (const l of (g.links || [])) {
    if (l.file && !seen.has(l.file)) { seen.add(l.file); files.push(l.file); }
  }
  if (format === 'mermaid') return renderMermaid({ ghosts, files, repoName, tierFilter });
  return renderPlantUml({ ghosts, files, repoName, tierFilter });
}

export async function handleSysmlExport(url, res, opts) {
  const repoName = url.searchParams.get('repo');
  const format = url.searchParams.get('format') || 'plantuml';
  const tierFilter = url.searchParams.get('tier');
  if (!repoName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'missing repo' }));
  }
  if (format !== 'plantuml' && format !== 'mermaid') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `invalid format: ${format}` }));
  }
  const repo = await findRepoByName(repoName, opts.api);
  if (!repo) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `repo not found: ${repoName}` }));
  }
  const repoPath = repo.repoPath || repo.path;
  try {
    const out = await buildSysmlExport(repoPath, { format, tierFilter, repoName });
    if (out === null) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No ghosts.json — run POST /ghosts/sync first.' }));
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(out);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

export async function handleSysmlExportRoute(req, url, res, opts) {
  if (url.pathname === '/sysml-export' && req.method === 'GET') {
    await handleSysmlExport(url, res, opts);
    return true;
  }
  return false;
}
```

Validate + commit :
```bash
node --check upstream/docker-server-sysml-export.mjs
node -e "import('./upstream/docker-server-sysml-export.mjs').then(m => console.log(Object.keys(m).sort()))"
# expected: [ 'handleSysmlExport', 'handleSysmlExportRoute' ]

cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(sysml): GET /sysml-export route handler"
```

---

### Task 4: Register the route in `docker-server.mjs`

**Files:**
- Modify: `upstream/docker-server.mjs`

Add import + dispatch line at the end of the route chain (after the latest `handleXxxRoute`).

```js
import { handleSysmlExportRoute } from './docker-server-sysml-export.mjs';
// ...
// SysML export (Tier 3.x bonus)
if (await handleSysmlExportRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;
```

Validate + commit :
```bash
node --check upstream/docker-server.mjs
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(sysml): register /sysml-export route"
```

---

## Section C — Integration test + docs (Tasks 5-6)

### Task 5: Integration test + ROADMAP + INVENTORY + tests/README + CLAUDE smoke

**Files:**
- Create: `tests/integration/endpoints/sysml-export.test.mjs`
- Modify: `ROADMAP.md` (next row, likely 44)
- Modify: `INVENTORY.md` (new sub-section)
- Modify: `tests/README.md` (3 new rows)
- Modify: `CLAUDE.md` (smoke loop entry)

Integration test :
```js
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /sysml-export', () => {
  it('returns 400 when repo missing', async () => {
    const res = await fetch(`${BASE}/sysml-export`);
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid format', async () => {
    const res = await fetch(`${BASE}/sysml-export?repo=${FIXTURE.name}&format=xmi`);
    expect(res.status).toBe(400);
  });

  it('returns 200 text/plain PlantUML after sync', async () => {
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const res = await fetch(`${BASE}/sysml-export?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toContain('@startuml');
    expect(body).toContain('@enduml');
  });

  it('returns 200 mermaid when format=mermaid', async () => {
    const res = await fetch(`${BASE}/sysml-export?repo=${FIXTURE.name}&format=mermaid`);
    const body = await res.text();
    expect(body).toMatch(/^graph TD/m);
  });
});
```

ROADMAP row (use next available number — check `grep "^| 4" ROADMAP.md | tail -3`) :
```
| <N> | **Roadmap predictive — SysML export** (bonus) : `GET /sysml-export?repo=&format=plantuml|mermaid&tier=N` retourne le graph augmenté en PlantUML SysML 1.7 ou Mermaid (fallback). Mapping : File → block, Ghost planned/expired → requirement, ghost.links → <<satisfy>>, dependsOn → <<deriveReqt>>, Tier sections → packages. v1 ne consomme PAS le graph gitnexus complet (juste les fichiers que les ghosts satisfont) pour éviter l'explosion combinatoire. Importable dans Capella / Cameo / VSCode PlantUML extension. | `/sysml-export`, `upstream/docker-server-sysml-export-core.mjs`, `upstream/docker-server-sysml-export.mjs` |
```

Update "Dernière mise à jour" at the top of ROADMAP.

INVENTORY sub-section under Partie B :
```
#### Roadmap-predictive SysML export (Tier 3.x bonus, 2026-05-27)
- `upstream/docker-server-sysml-export-core.mjs` — pure fns `safeId`, `renderPlantUml`, `renderMermaid`. Pas de dépendance externe.
- `upstream/docker-server-sysml-export.mjs` — I/O wrapper qui lit `.gitnexus/ghosts.json` via `readLatestGhosts`, agrège les fichiers référencés par `ghost.links[]`, appelle le renderer choisi.
- Endpoint : `GET /sysml-export?repo=<name>&format=plantuml|mermaid&tier=<n>`. Renvoie `text/plain`. 200 / 400 (missing/bad params) / 404 (no sync) / 500 (errors).
- **Mapping SysML** : File → block, Ghost planned/expired → requirement, ghost.links → `<<satisfy>>`, dependsOn → `<<deriveReqt>>`, Tier major → package.
- **Out** : XMI, SysML v2, CALLS/IMPORTS edges, rendering PNG/SVG (le user rend chez lui), composant frontend.
- **Usage** : `curl :4173/sysml-export?repo=hmm_studio > diagram.puml` puis ouvrir dans PlantUML server / VSCode extension.
```

tests/README new rows (3) :
```
| SysML — PlantUML renderer | unit/sysml-export-plantuml.test.mjs | safeId + renderPlantUml + tier filter + satisfy + deriveReqt |
| SysML — Mermaid renderer | unit/sysml-export-mermaid.test.mjs | renderMermaid (graph TD + subgraphs) |
| SysML endpoint | integration/endpoints/sysml-export.test.mjs | GET 200 (text/plain), 400 missing repo, 400 invalid format |
```

CLAUDE smoke loop :
```bash
# SysML export (Tier 3.x bonus — pure read-only, no side effects)
curl -s -o /dev/null -w "sysml-export: HTTP %{http_code}\n" \
  "http://localhost:4173/sysml-export?repo=hmm_studio&format=plantuml"
```

Commit (single — all docs at once) :
```bash
git add tests/integration/endpoints/sysml-export.test.mjs ROADMAP.md INVENTORY.md tests/README.md CLAUDE.md
git commit -m "docs+test(sysml): integration test + ROADMAP + INVENTORY + tests/README + smoke loop"
```

Run `node scripts/check-test-inventory.mjs` — must exit 0.

---

### Task 6: Append Update — Shipped to the spec

```
---

## Update 2026-05-27 — Shipped

SysML export livré. Notes :

- 2 renderers livrés : PlantUML SysML 1.7 (default) + Mermaid (fallback).
- v1 ne consomme PAS le graph gitnexus complet (CALLS/IMPORTS) — juste les fichiers référencés par `ghost.links[]`. Évite l'explosion combinatoire sur les gros repos.
- Mapping appliqué tel que spec : File→block, planned/expired ghost→requirement, links→<<satisfy>>, dependsOn→<<deriveReqt>>, Tier major→package.
- Cancelled + materialized ghosts omis (v1 focus sur le futur planifié).
- Tests : 2 unit + 1 integration. Runtime local Node 21 bloqué (vitest 4.x), CI Node 22.
- 5 open questions du spec toutes résolues comme prévu.

### Limitations connues

1. Pas de graph CALLS/IMPORTS. Future option `?includeEdges=imports,calls`.
2. Pas de skin/style PlantUML par défaut. User customise.
3. > 200 ghosts peut produire un diagramme illisible — filtrer via `?tier=`.
4. Pas de rendering PNG/SVG serveur — user passe par PlantUML chez lui.
```

Commit :
```bash
git add docs/superpowers/specs/2026-05-27-roadmap-predictive-sysml-export-design.md
git commit -m "docs(spec): append Update — Shipped on roadmap-predictive SysML export"
```

---

## Final validation

- [ ] `git log --pretty=format:"%ae" --since=...` → `roblastar@live.fr` only.
- [ ] `node scripts/check-test-inventory.mjs` exits 0.
- [ ] `patches/upstream-all.diff` contains the 2 new upstream files (`sysml-export-core.mjs` + `sysml-export.mjs`) + the `docker-server.mjs` edit.
- [ ] ROADMAP new row + INVENTORY sub-section + spec Update block all present.

---

**Plan complete. Execution: subagent-driven-development.**
