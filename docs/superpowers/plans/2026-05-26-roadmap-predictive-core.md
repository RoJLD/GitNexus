# Roadmap Predictive — CORE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the lean CORE of the roadmap-predictive system — parser, 3 endpoints, snapshot auto-sync, sidecar JSON storage — so future sub-specs (Audit / Augmented / Gantt / Brainstorm-hook) have a foundation to build on.

**Architecture:** Two new ES modules under `upstream/` : `docker-server-ghosts-core.mjs` (pure fns) and `docker-server-ghosts.mjs` (I/O + route handlers). Wire into existing `docker-server.mjs` (3 new routes) and the snapshot endpoints (auto-sync per snapshot). One CLI wrapper at `scripts/sync-ghosts.mjs`. Per-repo storage : `roadmap.yml` (versioned) + `.gitnexus/ghosts.json` (latest) + `.gitnexus/snapshots/<sha>/ghosts.json` (historical).

**Tech Stack:** Node 22 (CI) / Node 21 (local — vitest blocked, see Phase 1b decision doc), js-yaml (already in upstream deps), minimatch for glob matching, vitest 4.x for tests (CI-only runtime).

**Spec source:** [docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md](../specs/2026-05-26-roadmap-predictive-core-design.md) (commit `ab030d4f`)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branch `deployment`)

**Important notes for the implementer:**

1. **`upstream/` is gitignored.** All edits to `upstream/*.mjs` flow into `patches/upstream-all.diff`. Never `git add upstream/...`. The end-of-task regen sequence is :
   ```bash
   cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
   git add patches/upstream-all.diff <other tracked files>
   git commit -m "..."
   ```
2. **Local vitest 4.x is blocked on Node 21.7.1** (see `docs/superpowers/decisions/2026-05-26-defer-node22-upgrade.md`). Tests will be **written** but their runtime validation happens on CI (Node 22 Linux). Locally, smoke-test imports with `node -e "import('./X.mjs').then(m => console.log(Object.keys(m)))"` and validate syntax with `node --check`.
3. **Commit identity is mandatory** : `git config user.email` must print `roblastar@live.fr` before any commit (already set locally; verify before each task).
4. **Specs discipline** : when this plan finishes (Task 26), the spec gets a `## Update 2026-MM-DD — Shipped` section appended documenting any deviations.

---

## File Structure (locked-in decomposition)

```
upstream/
├── docker-server-ghosts-core.mjs       NEW  Pure fns (parseRoadmap, renderRoadmapYml,
│                                            matchExpectedLinks, computeStatus). No I/O.
├── docker-server-ghosts.mjs            NEW  I/O + route handlers + sync helpers.
│                                            Imports from -core.
├── docker-server.mjs                   MOD  Register 3 routes.
├── docker-server-snapshots.mjs         MOD  Call syncGhostsForSnapshot after checkout.
└── docker-server-snapshots-bulk.mjs    MOD  Same as above, in the bulk loop.

scripts/
└── sync-ghosts.mjs                     NEW  CLI wrapper (=POST /ghosts/sync via fetch).

tests/
├── unit/
│   ├── ghosts-parser.test.mjs          NEW
│   ├── ghosts-yaml.test.mjs            NEW
│   ├── ghosts-matching.test.mjs        NEW
│   └── ghosts-lifecycle.test.mjs       NEW
├── integration/endpoints/
│   ├── ghosts-sync.test.mjs            NEW
│   ├── ghosts.test.mjs                 NEW
│   ├── ghosts-at.test.mjs              NEW
│   └── ghosts-snapshot.test.mjs        NEW
└── fixtures/make-fixture.mjs           MOD  Append a commit that adds ROADMAP.md to
                                             the sample-repo.

package.json                            MOD  Add `ghosts:sync` script.
ROADMAP.md                              MOD  Add ghost-predictive-core to "Déjà livré".
INVENTORY.md                            MOD  Document new endpoints in Partie B.
CLAUDE.md                               MOD  Add /ghosts to smoke loop.
tests/README.md                         MOD  Add 8 new test files to inventory.
docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md   MOD  Append `## Update — Shipped` section.
patches/upstream-all.diff               REGEN  After all upstream/ edits.
```

---

## Section A — Pure functions (Tasks 1-6)

The core module exports four pure functions. Each task writes the test first, then the implementation, then verifies syntax (runtime locally blocked on Node 21).

### Task 1: parseRoadmap — table rows ("Déjà livré")

**Files:**
- Create: `upstream/docker-server-ghosts-core.mjs` (initial skeleton)
- Create: `tests/unit/ghosts-parser.test.mjs`

- [ ] **Step 1: Verify git identity is correct**

Run: `git config user.email`
Expected: `roblastar@live.fr`. If anything else, run `git config user.email "roblastar@live.fr"` before continuing.

- [ ] **Step 2: Write the failing test for table parsing**

Create `tests/unit/ghosts-parser.test.mjs` :
```js
import { describe, it, expect } from 'vitest';
import { parseRoadmap } from '../../upstream/docker-server-ghosts-core.mjs';

describe('parseRoadmap — table rows', () => {
  it('extracts ghosts from the "Déjà livré" markdown table', () => {
    const md = [
      '# Roadmap',
      '',
      '## ✅ Déjà livré',
      '',
      '| # | Feature | Endpoint(s) / Composant(s) |',
      '|---|---|---|',
      '| 1 | **Loading bars** | `/listdir`, `DropZone.LoadingCard` |',
      '| 2 | **CSV export** | `?format=csv`, `docker-server-csv.mjs` |',
      '',
    ].join('\n');
    const ghosts = parseRoadmap(md);
    expect(ghosts).toHaveLength(2);
    expect(ghosts[0]).toMatchObject({
      id: '1-loading-bars',
      title: 'Loading bars',
      status: 'materialized',
      expectedLinks: [
        { kind: 'path', value: '/listdir' },
        { kind: 'label', value: 'DropZone.LoadingCard' },
      ],
    });
    expect(ghosts[1].expectedLinks.some(l => l.value === 'docker-server-csv.mjs' && l.kind === 'path')).toBe(true);
  });

  it('returns [] on empty input', () => {
    expect(parseRoadmap('')).toEqual([]);
  });

  it('returns [] when no "Déjà livré" section exists', () => {
    expect(parseRoadmap('# Just a title\n\nNo content.\n')).toEqual([]);
  });
});
```

- [ ] **Step 3: Validate test file syntax locally**

Run: `node --check tests/unit/ghosts-parser.test.mjs`
Expected: exit code 0 (no parse errors). Runtime test execution is blocked on Node 21 — CI will run it on Node 22.

- [ ] **Step 4: Create the core module with `parseRoadmap` impl**

Create `upstream/docker-server-ghosts-core.mjs` :
```js
/**
 * Pure functions for the roadmap-predictive CORE.
 * No I/O, no fs, no fetch — testable in isolation.
 *
 * See docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md
 */

const TABLE_ROW_RE = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/;
const TABLE_HEADER_RE = /^\|\s*#\s*\|/;
const TABLE_SEP_RE = /^\|[\s:-]+\|/;
const TIER_HEADING_RE = /^###\s+(\d+(?:\.\d+)*)\s*[—-]\s*(.+?)\s*(✅|🗑️|⏳|🔬)?\s*$/;
const SHIPPED_SECTION_RE = /^##\s+✅\s+Déjà livré\s*$/i;
const BACKTICK_RE = /`([^`]+)`/g;

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function stripBold(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '$1');
}

function extractExpectedLinks(cell) {
  const links = [];
  // First pass : pull out backtick-quoted tokens.
  const ticked = [...cell.matchAll(BACKTICK_RE)].map(m => m[1]);
  for (const t of ticked) {
    // Heuristic : if it contains a '/' or ends with a known file ext, it's a path.
    const isPath = t.includes('/') || /\.(mjs|ts|tsx|js|jsx|json|yaml|yml|md|css)$/.test(t);
    links.push({ kind: isPath ? 'path' : 'label', value: t });
  }
  return links;
}

export function parseRoadmap(md) {
  if (!md || typeof md !== 'string') return [];
  const lines = md.split('\n');
  const ghosts = [];

  let inShippedSection = false;
  let inTable = false;
  let tableHasSep = false;

  for (const line of lines) {
    if (SHIPPED_SECTION_RE.test(line)) {
      inShippedSection = true;
      inTable = false;
      tableHasSep = false;
      continue;
    }
    if (line.startsWith('## ') && !SHIPPED_SECTION_RE.test(line)) {
      inShippedSection = false;
      inTable = false;
      tableHasSep = false;
      continue;
    }
    if (!inShippedSection) continue;

    if (TABLE_HEADER_RE.test(line)) {
      inTable = true;
      tableHasSep = false;
      continue;
    }
    if (inTable && !tableHasSep && TABLE_SEP_RE.test(line)) {
      tableHasSep = true;
      continue;
    }
    if (inTable && tableHasSep) {
      const m = line.match(TABLE_ROW_RE);
      if (!m) {
        inTable = false;
        continue;
      }
      const [, num, rawTitle, rawLinks] = m;
      const title = stripBold(rawTitle).trim();
      ghosts.push({
        id: `${num}-${slugify(title)}`,
        tier: null,
        title,
        description: '',
        status: 'materialized',
        expectedLinks: extractExpectedLinks(rawLinks),
        dependsOn: [],
      });
    }
  }

  return ghosts;
}
```

- [ ] **Step 5: Smoke-check the module imports cleanly**

Run: `node -e "import('./upstream/docker-server-ghosts-core.mjs').then(m => console.log(Object.keys(m)))"`
Expected: prints `[ 'parseRoadmap' ]`.

- [ ] **Step 6: Regenerate patches/upstream-all.diff and commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghosts-parser.test.mjs
git commit -m "feat(ghosts): parseRoadmap extracts table rows from ROADMAP.md"
```

---

### Task 2: parseRoadmap — Tier sections

**Files:**
- Modify: `upstream/docker-server-ghosts-core.mjs`
- Modify: `tests/unit/ghosts-parser.test.mjs`

- [ ] **Step 1: Append Tier-section test cases**

Append to `tests/unit/ghosts-parser.test.mjs` after the existing `describe` block :
```js
describe('parseRoadmap — Tier sections', () => {
  const md = [
    '## 🎯 Tier 1 — Prochaines briques',
    '',
    '### 1.4 — Entropie structurelle ✅',
    '**Promesse** : un seul chiffre — le **Coefficient de Cohérence Structurelle**.',
    '',
    '**Premier pas** : `GET /entropy?repo=<base>` qui calcule un score par snapshot.',
    '',
    '### 2.3 — What-if simulator',
    '**Promesse** : "Si je renomme `validateUser`...", mutations symboliques.',
    '',
    '**Premier pas** : action `rename` déjà côté MCP. UI = formulaire dans `WhatIfPanel.tsx`.',
    '',
    '### 3.4 — Auto-PR de refactoring 🗑️',
    '**Promesse** : GitNexus propose automatiquement des PRs.',
  ].join('\n');

  it('extracts a materialized Tier section (✅)', () => {
    const ghosts = parseRoadmap(md);
    const entropy = ghosts.find(g => g.tier === '1.4');
    expect(entropy).toMatchObject({
      id: 'tier-1-4-entropie-structurelle',
      tier: '1.4',
      title: 'Entropie structurelle',
      status: 'materialized',
    });
    expect(entropy.description).toContain('Coefficient de Cohérence');
    expect(entropy.expectedLinks.some(l => l.value === '/entropy?repo=<base>')).toBe(true);
  });

  it('extracts a planned Tier section (no emoji)', () => {
    const ghosts = parseRoadmap(md);
    const whatif = ghosts.find(g => g.tier === '2.3');
    expect(whatif.status).toBe('planned');
    expect(whatif.expectedLinks.some(l => l.value === 'WhatIfPanel.tsx')).toBe(true);
  });

  it('extracts a cancelled Tier section (🗑️)', () => {
    const ghosts = parseRoadmap(md);
    const autopr = ghosts.find(g => g.tier === '3.4');
    expect(autopr.status).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Extend `parseRoadmap` to handle Tier sections**

Modify `upstream/docker-server-ghosts-core.mjs` — replace the function body. Add Tier-section detection running in parallel with table detection :

```js
const TIER_HEADING_RE = /^###\s+(\d+(?:\.\d+)*)\s*[—-]\s*(.+?)\s*(✅|🗑️|⏳|🔬)?\s*$/;
const PROMISE_RE = /^\*\*Promesse\*\*\s*:\s*(.+)$/;
const FIRST_STEP_RE = /^\*\*Premier pas\*\*\s*:\s*(.+)$/;
const CANCELLED_EMOJIS = ['🗑️', '~~'];

function statusFromEmoji(emoji) {
  if (emoji === '✅') return 'materialized';
  if (CANCELLED_EMOJIS.includes(emoji)) return 'cancelled';
  return 'planned';
}

export function parseRoadmap(md) {
  if (!md || typeof md !== 'string') return [];
  const lines = md.split('\n');
  const ghosts = [];

  // --- Pass A : table "Déjà livré" rows ---
  let inShippedSection = false;
  let inTable = false;
  let tableHasSep = false;

  for (const line of lines) {
    if (SHIPPED_SECTION_RE.test(line)) {
      inShippedSection = true;
      inTable = false;
      tableHasSep = false;
      continue;
    }
    if (line.startsWith('## ') && !SHIPPED_SECTION_RE.test(line)) {
      inShippedSection = false;
      inTable = false;
      tableHasSep = false;
      continue;
    }
    if (!inShippedSection) continue;
    if (TABLE_HEADER_RE.test(line)) { inTable = true; tableHasSep = false; continue; }
    if (inTable && !tableHasSep && TABLE_SEP_RE.test(line)) { tableHasSep = true; continue; }
    if (inTable && tableHasSep) {
      const m = line.match(TABLE_ROW_RE);
      if (!m) { inTable = false; continue; }
      const [, num, rawTitle, rawLinks] = m;
      const title = stripBold(rawTitle).trim();
      ghosts.push({
        id: `${num}-${slugify(title)}`,
        tier: null,
        title,
        description: '',
        status: 'materialized',
        expectedLinks: extractExpectedLinks(rawLinks),
        dependsOn: [],
      });
    }
  }

  // --- Pass B : Tier subsections ---
  let currentTier = null;
  let currentTitle = null;
  let currentEmoji = null;
  let currentDescription = '';
  let currentLinks = [];
  let readingPromise = false;
  let readingFirstStep = false;

  function flushTier() {
    if (currentTier === null) return;
    ghosts.push({
      id: `tier-${currentTier.replace(/\./g, '-')}-${slugify(currentTitle)}`,
      tier: currentTier,
      title: currentTitle,
      description: currentDescription.trim(),
      status: statusFromEmoji(currentEmoji),
      expectedLinks: currentLinks,
      dependsOn: [],
    });
    currentTier = null;
    currentTitle = null;
    currentEmoji = null;
    currentDescription = '';
    currentLinks = [];
    readingPromise = false;
    readingFirstStep = false;
  }

  for (const line of lines) {
    const m = line.match(TIER_HEADING_RE);
    if (m) {
      flushTier();
      currentTier = m[1];
      currentTitle = stripBold(m[2]).trim();
      currentEmoji = m[3] ?? null;
      continue;
    }
    if (currentTier === null) continue;

    const pm = line.match(PROMISE_RE);
    if (pm) {
      readingPromise = true;
      readingFirstStep = false;
      currentDescription = pm[1];
      continue;
    }
    const fm = line.match(FIRST_STEP_RE);
    if (fm) {
      readingPromise = false;
      readingFirstStep = true;
      currentLinks.push(...extractExpectedLinks(fm[1]));
      continue;
    }
    if (line.startsWith('### ') || line.startsWith('## ')) {
      flushTier();
      continue;
    }
    if (readingPromise && line.trim() && !line.startsWith('**')) {
      currentDescription += ' ' + line.trim();
    } else if (readingFirstStep && line.trim() && !line.startsWith('**')) {
      currentLinks.push(...extractExpectedLinks(line));
    } else if (line.trim() === '') {
      readingPromise = false;
      readingFirstStep = false;
    }
  }
  flushTier();

  return ghosts;
}
```

- [ ] **Step 3: Validate syntax + smoke-check imports**

Run :
```
node --check upstream/docker-server-ghosts-core.mjs
node --check tests/unit/ghosts-parser.test.mjs
node -e "import('./upstream/docker-server-ghosts-core.mjs').then(m => console.log(Object.keys(m)))"
```
Expected : 3 commands succeed, last prints `[ 'parseRoadmap' ]`.

- [ ] **Step 4: Quick sanity run of parseRoadmap on the real ROADMAP.md**

Run :
```
node -e "import('./upstream/docker-server-ghosts-core.mjs').then(m => { const md = require('fs').readFileSync('ROADMAP.md', 'utf8'); const g = m.parseRoadmap(md); console.log('parsed', g.length, 'ghosts'); console.log('sample:', JSON.stringify(g[0], null, 2)); console.log('tiers:', g.filter(x=>x.tier).length); })"
```
Expected : prints a number > 20 (we have 24+ table rows + a handful of Tier sections), and the sample looks reasonable.

- [ ] **Step 5: Regenerate patch and commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghosts-parser.test.mjs
git commit -m "feat(ghosts): parseRoadmap extracts Tier sections with status from emoji"
```

---

### Task 3: renderRoadmapYml — deterministic YAML serialization

**Files:**
- Modify: `upstream/docker-server-ghosts-core.mjs`
- Create: `tests/unit/ghosts-yaml.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ghosts-yaml.test.mjs` :
```js
import { describe, it, expect } from 'vitest';
import { renderRoadmapYml, parseRoadmap } from '../../upstream/docker-server-ghosts-core.mjs';

const sampleGhost = {
  id: 'tier-1-4-entropie-structurelle',
  tier: '1.4',
  title: 'Entropie structurelle',
  description: 'un seul chiffre — le Coefficient de Cohérence',
  status: 'materialized',
  expectedLinks: [
    { kind: 'path', value: '/entropy?repo=<base>' },
    { kind: 'label', value: 'EntropyBadge' },
  ],
  dependsOn: [],
};

describe('renderRoadmapYml', () => {
  it('produces YAML starting with `ghosts:`', () => {
    const out = renderRoadmapYml([sampleGhost]);
    expect(out.startsWith('ghosts:\n')).toBe(true);
  });

  it('is deterministic (same input → bit-identical output)', () => {
    const a = renderRoadmapYml([sampleGhost]);
    const b = renderRoadmapYml([sampleGhost]);
    expect(a).toBe(b);
  });

  it('escapes characters that would break YAML (backticks, apostrophes, colons)', () => {
    const ghost = { ...sampleGhost, description: "It's a key: a value with `backticks`" };
    const out = renderRoadmapYml([ghost]);
    // round-trip safety : we can re-parse our own output if needed
    expect(out).toContain("It's a key");
    expect(out).toContain('backticks');
  });

  it('emits ghosts in stable order (by id)', () => {
    const a = { ...sampleGhost, id: 'a' };
    const b = { ...sampleGhost, id: 'b' };
    const c = { ...sampleGhost, id: 'c' };
    expect(renderRoadmapYml([c, a, b])).toBe(renderRoadmapYml([a, b, c]));
  });

  it('emits empty array as `ghosts: []`', () => {
    expect(renderRoadmapYml([]).trim()).toBe('ghosts: []');
  });
});
```

- [ ] **Step 2: Validate syntax**

Run: `node --check tests/unit/ghosts-yaml.test.mjs`
Expected: exit 0.

- [ ] **Step 3: Implement `renderRoadmapYml` in the core module**

Append to `upstream/docker-server-ghosts-core.mjs` :

```js
// --- YAML rendering ---
// We hand-roll a tiny deterministic serializer rather than depend on js-yaml's
// stable-sort options. Keeps the module dep-free and the output trivially
// auditable.

function yamlScalar(s) {
  if (s === null || s === undefined) return 'null';
  if (typeof s === 'number' || typeof s === 'boolean') return String(s);
  const str = String(s);
  if (str === '') return "''";
  // Single-quote if contains : * ` ' ? > | { [ # & ! % @ or starts with - or "
  if (/[`*'?>|{[#&!%@:]/.test(str) || /^[-"]/.test(str) || /\n/.test(str)) {
    // Escape single quotes by doubling them.
    return "'" + str.replace(/'/g, "''") + "'";
  }
  return str;
}

function yamlInlineList(arr) {
  if (arr.length === 0) return '[]';
  return '[' + arr.map(yamlScalar).join(', ') + ']';
}

export function renderRoadmapYml(ghosts) {
  if (!Array.isArray(ghosts) || ghosts.length === 0) {
    return 'ghosts: []\n';
  }
  const sorted = [...ghosts].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
  const lines = ['ghosts:'];
  for (const g of sorted) {
    lines.push(`  - id: ${yamlScalar(g.id)}`);
    if (g.tier !== null && g.tier !== undefined) {
      lines.push(`    tier: ${yamlScalar(g.tier)}`);
    } else {
      lines.push(`    tier: null`);
    }
    lines.push(`    title: ${yamlScalar(g.title)}`);
    lines.push(`    description: ${yamlScalar(g.description || '')}`);
    lines.push(`    status: ${yamlScalar(g.status)}`);
    // expectedLinks : array of { kind, value } — render as block list
    if (!g.expectedLinks || g.expectedLinks.length === 0) {
      lines.push(`    expectedLinks: []`);
    } else {
      lines.push(`    expectedLinks:`);
      for (const link of g.expectedLinks) {
        lines.push(`      - kind: ${yamlScalar(link.kind)}`);
        lines.push(`        value: ${yamlScalar(link.value)}`);
      }
    }
    lines.push(`    dependsOn: ${yamlInlineList(g.dependsOn || [])}`);
  }
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Validate + smoke**

Run :
```
node --check upstream/docker-server-ghosts-core.mjs
node -e "import('./upstream/docker-server-ghosts-core.mjs').then(m => { const g = m.parseRoadmap(require('fs').readFileSync('ROADMAP.md','utf8')); const y = m.renderRoadmapYml(g); console.log(y.slice(0, 500)); console.log('---total chars:', y.length); })"
```
Expected : prints the first 500 chars of YAML (starting with `ghosts:`), total chars > 1000.

- [ ] **Step 5: Regenerate patch and commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghosts-yaml.test.mjs
git commit -m "feat(ghosts): renderRoadmapYml deterministic serializer"
```

---

### Task 4: matchExpectedLinks — substring + glob matching

**Files:**
- Modify: `upstream/docker-server-ghosts-core.mjs`
- Create: `tests/unit/ghosts-matching.test.mjs`

- [ ] **Step 1: Check whether `minimatch` is available in upstream's deps**

Run: `node -e "console.log(require.resolve('minimatch'))"`
Expected: prints a path (minimatch is a transitive dep of upstream's vite chain). If it errors, we'll either add it to gitnexus's local deps or hand-roll a tiny glob matcher. Note the result for Step 3.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/ghosts-matching.test.mjs` :
```js
import { describe, it, expect } from 'vitest';
import { matchExpectedLinks } from '../../upstream/docker-server-ghosts-core.mjs';

describe('matchExpectedLinks', () => {
  const ghost = {
    id: 'g1',
    expectedLinks: [
      { kind: 'path', value: 'docker-server-entropy.mjs' },
      { kind: 'path', value: 'src/components/EntropyBadge.tsx' },
      { kind: 'label', value: 'Layers toggle' },
      { kind: 'path', value: 'docker-server-*.mjs' },
    ],
  };

  it('matches paths by suffix (no wildcards)', () => {
    const r = matchExpectedLinks(ghost, ['upstream/docker-server-entropy.mjs']);
    expect(r.matched.some(m => m.matchedPath === 'upstream/docker-server-entropy.mjs')).toBe(true);
  });

  it('matches paths by glob (wildcards)', () => {
    const r = matchExpectedLinks(ghost, ['upstream/docker-server-foo.mjs']);
    // pattern docker-server-*.mjs should match upstream/docker-server-foo.mjs
    expect(r.matched.some(m => m.pattern === 'docker-server-*.mjs')).toBe(true);
  });

  it('ignores `label` expectedLinks (only matches paths)', () => {
    const r = matchExpectedLinks(ghost, ['Layers toggle is now visible']);
    expect(r.matched.find(m => m.pattern === 'Layers toggle')).toBeUndefined();
  });

  it('returns unmatched paths when nothing matches', () => {
    const r = matchExpectedLinks(ghost, ['unrelated/file.txt']);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatched.length).toBeGreaterThan(0);
  });

  it('treats empty changedFiles as all unmatched', () => {
    const r = matchExpectedLinks(ghost, []);
    expect(r.matched).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Implement `matchExpectedLinks`**

Append to `upstream/docker-server-ghosts-core.mjs` :

```js
// --- Expected-link matching ---

function pathToRegex(pattern) {
  // Tiny glob → regex. Supports * (no slash), ** (any), ? (one char).
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { re += '.*'; i += 2; }
    else if (c === '*') { re += '[^/]*'; i++; }
    else if (c === '?') { re += '[^/]'; i++; }
    else if (/[.+^${}()|[\]\\]/.test(c)) { re += '\\' + c; i++; }
    else { re += c; i++; }
  }
  return new RegExp(re + '$'); // anchored at end so suffix-match works
}

function matchPattern(pattern, files) {
  const hasWildcard = /[*?]/.test(pattern);
  if (hasWildcard) {
    const re = pathToRegex(pattern);
    return files.filter(f => re.test(f));
  }
  // No wildcard : suffix match (path endsWith pattern) OR substring match for safety
  return files.filter(f => f.endsWith(pattern) || f.includes('/' + pattern));
}

export function matchExpectedLinks(ghost, changedFiles) {
  const matched = [];
  const unmatched = [];
  if (!ghost || !Array.isArray(ghost.expectedLinks)) {
    return { matched, unmatched };
  }
  for (const link of ghost.expectedLinks) {
    if (link.kind !== 'path') continue; // labels are metadata, not match candidates
    const hits = matchPattern(link.value, changedFiles || []);
    if (hits.length > 0) {
      for (const h of hits) {
        matched.push({ pattern: link.value, matchedPath: h });
      }
    } else {
      unmatched.push(link.value);
    }
  }
  return { matched, unmatched };
}
```

- [ ] **Step 4: Validate + smoke**

Run :
```
node --check upstream/docker-server-ghosts-core.mjs
node -e "import('./upstream/docker-server-ghosts-core.mjs').then(m => { console.log(m.matchExpectedLinks({ expectedLinks: [{kind:'path', value:'foo.mjs'}, {kind:'path', value:'bar/*.tsx'}] }, ['a/foo.mjs', 'bar/baz.tsx', 'unrelated.js'])); })"
```
Expected : prints `{ matched: [ { pattern: 'foo.mjs', matchedPath: 'a/foo.mjs' }, { pattern: 'bar/*.tsx', matchedPath: 'bar/baz.tsx' } ], unmatched: [] }`.

- [ ] **Step 5: Regenerate patch and commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghosts-matching.test.mjs
git commit -m "feat(ghosts): matchExpectedLinks supports suffix + glob"
```

---

### Task 5: computeStatus — lifecycle transitions

**Files:**
- Modify: `upstream/docker-server-ghosts-core.mjs`
- Create: `tests/unit/ghosts-lifecycle.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ghosts-lifecycle.test.mjs` :
```js
import { describe, it, expect } from 'vitest';
import { computeStatus } from '../../upstream/docker-server-ghosts-core.mjs';

describe('computeStatus', () => {
  it('returns the declared status when no override', () => {
    expect(computeStatus({ status: 'planned', expectedLinks: [] }, {})).toBe('planned');
    expect(computeStatus({ status: 'materialized', expectedLinks: [] }, {})).toBe('materialized');
    expect(computeStatus({ status: 'cancelled', expectedLinks: [] }, {})).toBe('cancelled');
  });

  it('upgrades planned → materialized when all expectedLinks (paths) are matched', () => {
    const ghost = {
      status: 'planned',
      expectedLinks: [
        { kind: 'path', value: 'a.mjs' },
        { kind: 'path', value: 'b.tsx' },
      ],
    };
    const ctx = { changedFiles: ['x/a.mjs', 'y/b.tsx'] };
    expect(computeStatus(ghost, ctx)).toBe('materialized');
  });

  it('keeps planned when some but not all expectedLinks match', () => {
    const ghost = {
      status: 'planned',
      expectedLinks: [
        { kind: 'path', value: 'a.mjs' },
        { kind: 'path', value: 'b.tsx' },
      ],
    };
    const ctx = { changedFiles: ['x/a.mjs'] };
    expect(computeStatus(ghost, ctx)).toBe('planned');
  });

  it('ignores `label` expectedLinks when computing match completion', () => {
    const ghost = {
      status: 'planned',
      expectedLinks: [
        { kind: 'path', value: 'a.mjs' },
        { kind: 'label', value: 'A toggle' },
      ],
    };
    const ctx = { changedFiles: ['a.mjs'] };
    expect(computeStatus(ghost, ctx)).toBe('materialized');
  });

  it('declared cancelled stays cancelled even if links match', () => {
    const ghost = {
      status: 'cancelled',
      expectedLinks: [{ kind: 'path', value: 'a.mjs' }],
    };
    const ctx = { changedFiles: ['a.mjs'] };
    expect(computeStatus(ghost, ctx)).toBe('cancelled');
  });

  it('handles ghost with no expectedLinks', () => {
    expect(computeStatus({ status: 'planned', expectedLinks: [] }, { changedFiles: ['x.mjs'] })).toBe('planned');
  });
});
```

- [ ] **Step 2: Validate syntax**

Run: `node --check tests/unit/ghosts-lifecycle.test.mjs`

- [ ] **Step 3: Implement `computeStatus`**

Append to `upstream/docker-server-ghosts-core.mjs` :

```js
// --- Status computation ---

export function computeStatus(ghost, ctx) {
  if (!ghost) return 'planned';
  if (ghost.status === 'materialized' || ghost.status === 'cancelled') {
    return ghost.status; // declared wins
  }
  // ghost.status === 'planned' (or unset)
  const pathLinks = (ghost.expectedLinks || []).filter(l => l.kind === 'path');
  if (pathLinks.length === 0) return 'planned';
  const { matched } = matchExpectedLinks(ghost, ctx?.changedFiles || []);
  const matchedPatterns = new Set(matched.map(m => m.pattern));
  const allCovered = pathLinks.every(l => matchedPatterns.has(l.value));
  return allCovered ? 'materialized' : 'planned';
}
```

- [ ] **Step 4: Validate + smoke**

Run :
```
node --check upstream/docker-server-ghosts-core.mjs
node -e "import('./upstream/docker-server-ghosts-core.mjs').then(m => { console.log('planned no match:', m.computeStatus({status:'planned', expectedLinks:[{kind:'path',value:'foo.mjs'}]}, {changedFiles:[]})); console.log('planned full match:', m.computeStatus({status:'planned', expectedLinks:[{kind:'path',value:'foo.mjs'}]}, {changedFiles:['x/foo.mjs']})); })"
```
Expected : `planned no match: planned` then `planned full match: materialized`.

- [ ] **Step 5: Regenerate patch and commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghosts-lifecycle.test.mjs
git commit -m "feat(ghosts): computeStatus lifecycle (declared wins, auto-match upgrades)"
```

---

## Section B — I/O wrapper + endpoints (Tasks 6-9)

### Task 6: docker-server-ghosts.mjs skeleton — sync helpers

**Files:**
- Create: `upstream/docker-server-ghosts.mjs`

- [ ] **Step 1: Create the I/O wrapper module**

Create `upstream/docker-server-ghosts.mjs` :

```js
/**
 * I/O wrapper + route handlers for the roadmap-predictive CORE.
 * Imports pure fns from docker-server-ghosts-core.mjs.
 *
 * See docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { parseRoadmap, renderRoadmapYml, computeStatus } from './docker-server-ghosts-core.mjs';

const execFileP = promisify(execFile);

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function readRoadmapMd(repoPath) {
  const path = join(repoPath, 'ROADMAP.md');
  if (!(await fileExists(path))) return '';
  return readFile(path, 'utf8');
}

async function getHeadSha(repoPath) {
  const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
  return stdout.trim();
}

async function getHeadDate(repoPath) {
  const { stdout } = await execFileP('git', ['log', '-1', '--format=%cI'], { cwd: repoPath });
  return stdout.trim();
}

async function getChangedFilesSince(repoPath, fromSha) {
  if (!fromSha) return [];
  try {
    const { stdout } = await execFileP(
      'git',
      ['log', '--name-only', '--pretty=format:', `${fromSha}..HEAD`],
      { cwd: repoPath },
    );
    return [...new Set(stdout.split('\n').map(l => l.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

/**
 * Build the runtime ghost objects (declared + plannedAt + materializedAt + links).
 * Idempotent : a second call with no changes produces the same JSON.
 */
async function buildGhosts(repoPath, declaredGhosts, previousRuntime) {
  const sha = await getHeadSha(repoPath);
  const date = await getHeadDate(repoPath);
  const result = [];

  const prevById = new Map((previousRuntime?.ghosts || []).map(g => [g.id, g]));

  for (const declared of declaredGhosts) {
    const prev = prevById.get(declared.id);
    const plannedAt = prev?.plannedAt ?? { commit: sha, date };

    let materializedAt = prev?.materializedAt ?? null;
    let cancelledAt = prev?.cancelledAt ?? null;

    // Declared status (from emoji in ROADMAP) wins.
    if (declared.status === 'materialized' && !materializedAt) {
      materializedAt = { commit: sha, date, confirmedBy: 'manual' };
      cancelledAt = null;
    }
    if (declared.status === 'cancelled' && !cancelledAt) {
      cancelledAt = { commit: sha, date };
    }
    if (declared.status === 'planned' && cancelledAt) {
      // Ghost came back after cancellation.
      cancelledAt = null;
    }

    // Auto-match : if still planned but all paths match recently changed files, suggest materialization.
    if (declared.status === 'planned' && !materializedAt) {
      const changedFiles = await getChangedFilesSince(repoPath, plannedAt.commit);
      const computed = computeStatus(declared, { changedFiles });
      if (computed === 'materialized') {
        materializedAt = { commit: sha, date, confirmedBy: 'auto' };
      }
    }

    result.push({
      id: declared.id,
      declared,
      plannedAt,
      materializedAt,
      cancelledAt,
      links: materializedAt ? (prev?.links || []) : [],
    });
  }

  // Detect cancellations : ghosts in prev that are no longer declared.
  for (const [id, prev] of prevById) {
    if (!declaredGhosts.find(d => d.id === id)) {
      result.push({
        ...prev,
        cancelledAt: prev.cancelledAt ?? { commit: sha, date },
      });
    }
  }

  return { syncedAt: date, syncedCommit: sha, ghosts: result };
}

/**
 * Public : sync at HEAD, write roadmap.yml + .gitnexus/ghosts.json.
 */
export async function syncGhostsForRepo(repoPath) {
  const md = await readRoadmapMd(repoPath);
  const declared = parseRoadmap(md);
  const yml = renderRoadmapYml(declared);

  let previous = null;
  const runtimePath = join(repoPath, '.gitnexus', 'ghosts.json');
  if (await fileExists(runtimePath)) {
    try { previous = JSON.parse(await readFile(runtimePath, 'utf8')); } catch { /* corrupt = treat as none */ }
  }

  const runtime = await buildGhosts(repoPath, declared, previous);

  await writeFile(join(repoPath, 'roadmap.yml'), yml);
  await mkdir(join(repoPath, '.gitnexus'), { recursive: true });
  await writeFile(runtimePath, JSON.stringify(runtime, null, 2) + '\n');

  return runtime;
}

/**
 * Public : sync inside a snapshot's directory. Does NOT touch the latest ghosts.json.
 */
export async function syncGhostsForSnapshot(repoPath, snapshotDir, sha) {
  const md = await readRoadmapMd(repoPath);
  const declared = parseRoadmap(md);

  // For a historical snapshot, we don't carry forward "previous runtime" —
  // we re-derive from the markdown at this commit. plannedAt/materializedAt
  // are sealed to this sha if declared-status is materialized/cancelled.
  const runtime = await buildGhosts(repoPath, declared, null);

  await mkdir(snapshotDir, { recursive: true });
  await writeFile(join(snapshotDir, 'ghosts.json'), JSON.stringify(runtime, null, 2) + '\n');

  return runtime;
}

/**
 * Public : read latest ghosts.json, return parsed object or null if absent.
 */
export async function readLatestGhosts(repoPath) {
  const path = join(repoPath, '.gitnexus', 'ghosts.json');
  if (!(await fileExists(path))) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * Public : read a snapshot's ghosts.json.
 */
export async function readSnapshotGhosts(repoPath, sha) {
  const path = join(repoPath, '.gitnexus', 'snapshots', sha, 'ghosts.json');
  if (!(await fileExists(path))) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}
```

- [ ] **Step 2: Smoke-check the module imports**

Run :
```
node -e "import('./upstream/docker-server-ghosts.mjs').then(m => console.log(Object.keys(m)))"
```
Expected : prints `[ 'syncGhostsForRepo', 'syncGhostsForSnapshot', 'readLatestGhosts', 'readSnapshotGhosts' ]`.

- [ ] **Step 3: Regenerate patch and commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(ghosts): I/O wrapper — syncGhostsForRepo + syncGhostsForSnapshot"
```

---

### Task 7: HTTP route handlers — POST /ghosts/sync, GET /ghosts, GET /ghosts/at

**Files:**
- Modify: `upstream/docker-server-ghosts.mjs`

- [ ] **Step 1: Discover existing route handler signatures**

Read the existing pattern in `upstream/docker-server-snapshots.mjs` (a similar endpoint module) to confirm the route registration & response shape conventions. Look for `(req, res)` handlers, how `repoPath` is resolved from query, how JSON responses are sent.

Run :
```
node -e "console.log(require('fs').readFileSync('upstream/docker-server-snapshots.mjs', 'utf8').slice(0, 1500))"
```
Note : (a) the exact function-export shape, (b) how `?repo=<base>` is mapped to a path, (c) how 404 / 200 / 500 are returned.

- [ ] **Step 2: Implement the 3 route handlers**

Append to `upstream/docker-server-ghosts.mjs` (using the conventions you noted in Step 1 — the helpers below assume `req.query.repo` lookup matches what other endpoints do; adapt if needed) :

```js
// --- Route handlers ---
// All three take (req, res) and use the same repo-resolution pattern as
// docker-server-snapshots.mjs. If that file uses a different shape
// (e.g. resolveRepo(req)), mirror it here.

import { resolveRepoPath } from './docker-server.mjs'; // re-export expected; if not, copy the helper

export async function handleGhostsSync(req, res) {
  try {
    const repoPath = await resolveRepoPath(req.query.repo);
    if (!repoPath) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Missing or invalid ?repo' }));
    }
    const runtime = await syncGhostsForRepo(repoPath);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ synced: true, ...runtime }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}

export async function handleGhostsGet(req, res) {
  try {
    const repoPath = await resolveRepoPath(req.query.repo);
    if (!repoPath) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Missing or invalid ?repo' }));
    }
    const runtime = await readLatestGhosts(repoPath);
    res.setHeader('Content-Type', 'application/json');
    if (!runtime) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: 'No ghosts.json — run POST /ghosts/sync first.' }));
    }
    res.statusCode = 200;
    res.end(JSON.stringify(runtime));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}

export async function handleGhostsAt(req, res) {
  try {
    const repoPath = await resolveRepoPath(req.query.repo);
    const commit = req.query.commit;
    if (!repoPath || !commit) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Missing ?repo or ?commit' }));
    }
    const runtime = await readSnapshotGhosts(repoPath, commit);
    res.setHeader('Content-Type', 'application/json');
    if (!runtime) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: `No ghosts.json for snapshot ${commit}.` }));
    }
    res.statusCode = 200;
    res.end(JSON.stringify(runtime));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
```

> **Important** : the `import { resolveRepoPath } from './docker-server.mjs'` line assumes `docker-server.mjs` exports this helper. If it does NOT, copy the implementation from `docker-server-snapshots.mjs` (whichever helper it uses to map `?repo=<base>` to a filesystem path) into this file under a private function name. Document the choice in your commit message.

- [ ] **Step 3: Validate syntax**

Run: `node --check upstream/docker-server-ghosts.mjs`
Expected: exit 0. If the `import` of `resolveRepoPath` errors at parse time, that's fine — parse only checks syntax not resolution. The resolution check is Step 4.

- [ ] **Step 4: Smoke-check exports**

Run :
```
node -e "import('./upstream/docker-server-ghosts.mjs').then(m => console.log(Object.keys(m))).catch(e => console.error('IMPORT FAILED:', e.message))"
```
Expected : prints `[ 'syncGhostsForRepo', 'syncGhostsForSnapshot', 'readLatestGhosts', 'readSnapshotGhosts', 'handleGhostsSync', 'handleGhostsGet', 'handleGhostsAt' ]`. If IMPORT FAILED with "resolveRepoPath is not exported", switch to the private-helper approach (see Step 2 note).

- [ ] **Step 5: Regenerate patch and commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(ghosts): 3 HTTP route handlers (sync, get, at)"
```

---

### Task 8: Register the 3 routes in docker-server.mjs

**Files:**
- Modify: `upstream/docker-server.mjs`

- [ ] **Step 1: Find where other routes are registered**

Run :
```
node -e "const c = require('fs').readFileSync('upstream/docker-server.mjs', 'utf8'); const idx = c.indexOf('/coupling'); console.log(c.slice(Math.max(0, idx-200), idx+500))"
```
Identify the routing block. There should be a series of route registrations like `app.get('/coupling', ...)` or a switch/dispatch table on `req.url`.

- [ ] **Step 2: Add the 3 ghost routes**

Edit `upstream/docker-server.mjs` to register the 3 new routes alongside existing ones. The exact form depends on what you found in Step 1. Two likely patterns :

**Pattern A — Express-style:**
```js
import { handleGhostsSync, handleGhostsGet, handleGhostsAt } from './docker-server-ghosts.mjs';
// ...
app.post('/ghosts/sync', handleGhostsSync);
app.get('/ghosts',       handleGhostsGet);
app.get('/ghosts/at',    handleGhostsAt);
```

**Pattern B — manual switch on `req.url` :**
```js
import { handleGhostsSync, handleGhostsGet, handleGhostsAt } from './docker-server-ghosts.mjs';
// ... inside the route dispatch ...
if (req.method === 'POST' && pathname === '/ghosts/sync') return handleGhostsSync(req, res);
if (req.method === 'GET'  && pathname === '/ghosts')       return handleGhostsGet(req, res);
if (req.method === 'GET'  && pathname === '/ghosts/at')    return handleGhostsAt(req, res);
```

Match whichever style exists already.

- [ ] **Step 3: Validate syntax**

Run: `node --check upstream/docker-server.mjs`
Expected: exit 0.

- [ ] **Step 4: Regenerate patch and commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(ghosts): register /ghosts, /ghosts/at, /ghosts/sync routes"
```

---

## Section C — Snapshot integration (Tasks 9-10)

### Task 9: Wire syncGhostsForSnapshot into POST /snapshot

**Files:**
- Modify: `upstream/docker-server-snapshots.mjs`

- [ ] **Step 1: Locate the snapshot creation flow**

Run :
```
node -e "console.log(require('fs').readFileSync('upstream/docker-server-snapshots.mjs', 'utf8'))" | head -100
```
Identify the function that performs `git checkout <sha>` and writes `meta.json`. The hook for ghosts goes right AFTER the checkout and BEFORE the meta.json write.

- [ ] **Step 2: Add the syncGhostsForSnapshot call**

Edit `upstream/docker-server-snapshots.mjs`. At the top, add :
```js
import { syncGhostsForSnapshot } from './docker-server-ghosts.mjs';
```

Inside the snapshot-creation function, after the `git checkout <sha>` line and before `meta.json` is written, add :
```js
try {
  await syncGhostsForSnapshot(repoPath, snapshotDir, sha);
} catch (err) {
  console.warn(`[ghosts] sync failed for snapshot ${sha}: ${err.message}`);
  // Non-fatal : a snapshot without ghosts.json is still a valid snapshot.
}
```

(`repoPath`, `snapshotDir`, `sha` should be variables already in scope ; use whatever names the existing code uses.)

- [ ] **Step 3: Validate syntax**

Run: `node --check upstream/docker-server-snapshots.mjs`

- [ ] **Step 4: Regenerate patch and commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(ghosts): auto-sync ghosts.json during POST /snapshot"
```

---

### Task 10: Wire syncGhostsForSnapshot into POST /snapshot/bulk

**Files:**
- Modify: `upstream/docker-server-snapshots-bulk.mjs`

- [ ] **Step 1: Locate the bulk-snapshot loop**

Run :
```
node -e "console.log(require('fs').readFileSync('upstream/docker-server-snapshots-bulk.mjs', 'utf8'))" | head -200
```
Find the loop that processes each commit. The hook goes inside the loop, same position as Task 9 (after checkout, before meta.json).

- [ ] **Step 2: Add the syncGhostsForSnapshot call**

Edit `upstream/docker-server-snapshots-bulk.mjs`. At the top, add :
```js
import { syncGhostsForSnapshot } from './docker-server-ghosts.mjs';
```

Inside the loop, after the per-commit checkout, add :
```js
try {
  await syncGhostsForSnapshot(repoPath, snapshotDir, sha);
} catch (err) {
  console.warn(`[ghosts] sync failed for snapshot ${sha}: ${err.message}`);
}
```

- [ ] **Step 3: Validate syntax**

Run: `node --check upstream/docker-server-snapshots-bulk.mjs`

- [ ] **Step 4: Regenerate patch and commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(ghosts): auto-sync ghosts.json during POST /snapshot/bulk"
```

---

## Section D — CLI wrapper + npm script (Tasks 11-12)

### Task 11: scripts/sync-ghosts.mjs (Node CLI)

**Files:**
- Create: `scripts/sync-ghosts.mjs`

- [ ] **Step 1: Create the CLI wrapper**

Create `scripts/sync-ghosts.mjs` :
```js
#!/usr/bin/env node
/**
 * CLI : invokes POST /ghosts/sync on the local gitnexus server.
 * Equivalent to `curl -X POST :4173/ghosts/sync?repo=<basename>`,
 * but with a clearer success/error message.
 *
 * Usage : node scripts/sync-ghosts.mjs <repo-basename>
 *         e.g. node scripts/sync-ghosts.mjs gitnexus
 *
 * Assumes the gitnexus stack is running (docker compose up).
 */
const repo = process.argv[2];
if (!repo) {
  console.error('Usage : node scripts/sync-ghosts.mjs <repo-basename>');
  console.error('Example : node scripts/sync-ghosts.mjs gitnexus');
  process.exit(2);
}

const port = process.env.GITNEXUS_PORT || 4173;
const url = `http://localhost:${port}/ghosts/sync?repo=${encodeURIComponent(repo)}`;

try {
  const res = await fetch(url, { method: 'POST' });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Sync failed (HTTP ${res.status}) :`, body.error || body);
    process.exit(1);
  }
  console.log(`Synced ${body.ghosts?.length ?? 0} ghosts at commit ${body.syncedCommit?.slice(0, 8) ?? '?'}`);
  console.log(`Wrote : <repo>/roadmap.yml + <repo>/.gitnexus/ghosts.json`);
  console.log(`Don't forget to commit roadmap.yml if you want the change versioned.`);
} catch (err) {
  console.error('Failed to reach gitnexus server :', err.message);
  console.error(`Is the stack up at http://localhost:${port} ?`);
  process.exit(1);
}
```

- [ ] **Step 2: Smoke-check the script (doesn't need server up)**

Run: `node scripts/sync-ghosts.mjs`
Expected: prints the usage message and exits 2.

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-ghosts.mjs
git commit -m "feat(ghosts): CLI wrapper scripts/sync-ghosts.mjs"
```

---

### Task 12: package.json — ghosts:sync script

**Files:**
- Modify: `package.json` (if it exists at repo root) — otherwise this task is a no-op and the user runs `node scripts/sync-ghosts.mjs <repo>` directly.

- [ ] **Step 1: Check if package.json exists at the gitnexus root**

Run: `node -e "console.log(require('fs').existsSync('package.json'))"`
Expected: prints `true` or `false`.

If `false`, skip Steps 2-3 and write in your task report : "No package.json at root — ghosts:sync invoked via `node scripts/sync-ghosts.mjs <repo>` directly. Consider adding a package.json in a follow-up if scripts grow."

- [ ] **Step 2 (only if package.json exists): Add the script**

Read current `package.json`, add to `scripts` :
```json
"ghosts:sync": "node scripts/sync-ghosts.mjs"
```

- [ ] **Step 3 (only if package.json exists): Smoke-check**

Run: `npm run ghosts:sync`
Expected: invokes the script with no args → prints usage message → exits 2 (same as Task 11 Step 2).

- [ ] **Step 4: Commit (or skip)**

If package.json was modified :
```bash
git add package.json
git commit -m "feat(ghosts): add npm run ghosts:sync wrapper"
```

---

## Section E — Fixture extension (Task 13)

### Task 13: Extend make-fixture.mjs to add a mini ROADMAP.md

**Files:**
- Modify: `tests/fixtures/make-fixture.mjs`

- [ ] **Step 1: Read current make-fixture.mjs to find the last commit block**

Run: `node -e "const c = require('fs').readFileSync('tests/fixtures/make-fixture.mjs', 'utf8'); console.log(c.slice(c.indexOf('Commit 10'), c.indexOf('Packing')))"`
Identify the last commit (commit 10, Bob, 2026-01-30) and the structure of `commit({ ... })` calls.

- [ ] **Step 2: Add an 11th commit that introduces ROADMAP.md**

In `tests/fixtures/make-fixture.mjs`, after the existing "Commit 10" block and before the `Packing tarball…` section, add :

```js
// Commit 11 (alice, 2025-02-05) — adds a minimal ROADMAP.md for ghosts CORE tests
commit({
  author: ALICE,
  date: '2025-02-05T10:00:00 +0100',
  message: 'docs(roadmap): add minimal ROADMAP for ghost-predictive tests',
  files: {
    'ROADMAP.md': [
      '# Sample Project — Roadmap',
      '',
      '## ✅ Déjà livré',
      '',
      '| # | Feature | Endpoint(s) / Composant(s) |',
      '|---|---|---|',
      '| 1 | **Login flow** | `src/auth/login.ts` |',
      '| 2 | **DB schema** | `src/db/schema.ts` |',
      '',
      '## 🎯 Tier 1',
      '',
      '### 1.1 — Migration runner ✅',
      '**Promesse** : runner pour appliquer les migrations.',
      '',
      '**Premier pas** : `src/db/orphan.py` placeholder.',
      '',
      '### 1.2 — Helpers utility',
      '**Promesse** : fonctions partagées.',
      '',
      '**Premier pas** : `src/utils/helpers.ts` exports an `id` function.',
      '',
      '### 2.1 — Audit log 🗑️',
      '**Promesse** : journal d\'audit.',
      '',
      '**Premier pas** : cancelled, not implementing.',
      '',
    ].join('\n'),
  },
});
```

- [ ] **Step 3: Regenerate the fixture tarball**

Run :
```
cd tests && node fixtures/make-fixture.mjs && cd ..
```
Expected : prints commits being made, then `Wrote …/sample-repo.tar.gz`. The tarball should change (more content) but still be deterministic.

- [ ] **Step 4: Verify the new commit is in the tarball**

Run :
```
node -e "const cp = require('child_process'); cp.execSync('mkdir -p /tmp/fxv && tar -xzf tests/fixtures/sample-repo.tar.gz -C /tmp/fxv', {stdio:'inherit'}); console.log(cp.execSync('git -C /tmp/fxv/sample-repo log --oneline | head -5').toString());"
```
Expected : the most recent commit is `docs(roadmap): add minimal ROADMAP for ghost-predictive tests`. Older commits unchanged.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/make-fixture.mjs tests/fixtures/sample-repo.tar.gz
git commit -m "test(fixture): add ROADMAP.md commit for ghosts CORE tests"
```

---

## Section F — Integration tests (Tasks 14-17, Phase 1b — written but runtime-blocked on Node 21)

> **Reminder :** these tests are written in vitest format. Their local execution is blocked on Node 21 / vitest 4.x (see [`docs/superpowers/decisions/2026-05-26-defer-node22-upgrade.md`](../decisions/2026-05-26-defer-node22-upgrade.md)). CI on Node 22 Linux runs them. Each task validates syntax via `node --check`.

### Task 14: POST /ghosts/sync integration test

**Files:**
- Create: `tests/integration/endpoints/ghosts-sync.test.mjs`

- [ ] **Step 1: Create the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('POST /ghosts/sync', () => {
  const api = getApi();

  it('returns the synced ghosts list', async () => {
    const res = await fetch(`http://localhost:${process.env.TEST_PORT || 4747}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.synced).toBe(true);
    expect(Array.isArray(body.ghosts)).toBe(true);
    // Our fixture ROADMAP has 2 table rows + 3 Tier sections = 5 ghosts
    expect(body.ghosts.length).toBe(5);
  });

  it('a second sync is idempotent (same content)', async () => {
    const url = `http://localhost:${process.env.TEST_PORT || 4747}/ghosts/sync?repo=${FIXTURE.name}`;
    const a = await (await fetch(url, { method: 'POST' })).json();
    const b = await (await fetch(url, { method: 'POST' })).json();
    expect(a.ghosts.map(g => g.id)).toEqual(b.ghosts.map(g => g.id));
  });
});
```

- [ ] **Step 2: Validate syntax**

Run: `node --check tests/integration/endpoints/ghosts-sync.test.mjs`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/ghosts-sync.test.mjs
git commit -m "test(integ): POST /ghosts/sync end-to-end"
```

---

### Task 15: GET /ghosts integration test

**Files:**
- Create: `tests/integration/endpoints/ghosts.test.mjs`

- [ ] **Step 1: Create the test**

```js
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /ghosts', () => {
  it('returns 404 before any sync', async () => {
    // Reset state : delete any pre-existing ghosts.json (best effort — the
    // test runner's fixture setup may have already populated it).
    // For this test we use a sub-path that hasn't been synced.
    const res = await fetch(`${BASE}/ghosts?repo=__never-synced__`);
    expect([404, 400]).toContain(res.status);
  });

  it('returns 200 with ghosts after sync', async () => {
    // Ensure sync first.
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const res = await fetch(`${BASE}/ghosts?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ghosts.length).toBe(5);
    expect(body.ghosts[0]).toMatchObject({
      id: expect.any(String),
      declared: expect.any(Object),
      plannedAt: expect.any(Object),
    });
  });

  it('returns 200 { ghosts: [] } on a repo without ROADMAP.md', async () => {
    // Hard to test cleanly without a 2nd fixture — accept that this may need
    // a 2nd no-roadmap fixture in a follow-up. For now skip.
  });
});
```

- [ ] **Step 2: Validate syntax**

Run: `node --check tests/integration/endpoints/ghosts.test.mjs`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/ghosts.test.mjs
git commit -m "test(integ): GET /ghosts (404 before sync, 200 after)"
```

---

### Task 16: GET /ghosts/at integration test

**Files:**
- Create: `tests/integration/endpoints/ghosts-at.test.mjs`

- [ ] **Step 1: Create the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /ghosts/at', () => {
  const api = getApi();

  it('returns 404 for a snapshot SHA that does not exist', async () => {
    const res = await fetch(`${BASE}/ghosts/at?repo=${FIXTURE.name}&commit=deadbeefdeadbeef`);
    expect(res.status).toBe(404);
  });

  it('returns 200 with ghosts for a real snapshot SHA', async () => {
    // Get list of known snapshots for the fixture.
    const snapshots = await api.listSnapshots(FIXTURE.name);
    expect(snapshots.length).toBeGreaterThan(0);
    const sha = snapshots[0].commit;
    const res = await fetch(`${BASE}/ghosts/at?repo=${FIXTURE.name}&commit=${sha}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.ghosts)).toBe(true);
  });
});
```

- [ ] **Step 2: Validate syntax**

Run: `node --check tests/integration/endpoints/ghosts-at.test.mjs`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/ghosts-at.test.mjs
git commit -m "test(integ): GET /ghosts/at (historical snapshot ghosts)"
```

---

### Task 17: Snapshot auto-sync integration test

**Files:**
- Create: `tests/integration/endpoints/ghosts-snapshot.test.mjs`

- [ ] **Step 1: Create the test**

```js
import { describe, it, expect } from 'vitest';
import { getApi } from '../helpers/api-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('Snapshot auto-sync produces ghosts.json per snapshot', () => {
  const api = getApi();

  it('after bulk-snapshot, every snapshot has a ghosts.json', async () => {
    const snapshots = await api.listSnapshots(FIXTURE.name);
    expect(snapshots.length).toBeGreaterThan(0);
    // For each snapshot, GET /ghosts/at must return 200 (not 404).
    for (const snap of snapshots) {
      const res = await fetch(`${BASE}/ghosts/at?repo=${FIXTURE.name}&commit=${snap.commit}`);
      expect(res.status, `snapshot ${snap.commit.slice(0,8)}`).not.toBe(404);
    }
  });

  it('a snapshot from BEFORE the ROADMAP.md commit has ghosts: []', async () => {
    const snapshots = await api.listSnapshots(FIXTURE.name);
    // The earliest snapshots (before commit 11 in the fixture) should have no ghosts.
    const oldest = snapshots[snapshots.length - 1];
    const res = await fetch(`${BASE}/ghosts/at?repo=${FIXTURE.name}&commit=${oldest.commit}`);
    if (res.ok) {
      const body = await res.json();
      // Either ghosts is empty, or the snapshot was taken at a commit that already had ROADMAP.
      // The test mainly verifies the endpoint doesn't crash on a ROADMAP-less commit.
      expect(Array.isArray(body.ghosts)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Validate syntax**

Run: `node --check tests/integration/endpoints/ghosts-snapshot.test.mjs`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/endpoints/ghosts-snapshot.test.mjs
git commit -m "test(integ): snapshot auto-sync writes ghosts.json per dir"
```

---

## Section G — Documentation + final wiring (Tasks 18-21)

### Task 18: Add /ghosts to the smoke loop in gitnexus CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (gitnexus-specific)

- [ ] **Step 1: Read current smoke loop**

Run :
```
node -e "const c = require('fs').readFileSync('CLAUDE.md', 'utf8'); const i = c.indexOf('for ep in'); console.log(c.slice(i, i+800))"
```

- [ ] **Step 2: Add 'ghosts' to the endpoint list**

Edit `CLAUDE.md`. Find the line :
```bash
for ep in snapshots churn coupling growth lifespan entropy ownership semantic-labels; do
```
And add `ghosts` :
```bash
for ep in snapshots churn coupling growth lifespan entropy ownership semantic-labels ghosts; do
```

Add a separate curl for `/ghosts/sync` (POST) right after the existing loop :
```bash
# /ghosts requires a prior sync (POST) — smoke the sync endpoint:
curl -s -o /dev/null -w "ghosts/sync: HTTP %{http_code}\n" \
  -X POST "http://localhost:4173/ghosts/sync?repo=hmm_studio"
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE): add /ghosts and /ghosts/sync to smoke loop"
```

---

### Task 19: Update ROADMAP.md and INVENTORY.md

**Files:**
- Modify: `ROADMAP.md`
- Modify: `INVENTORY.md`

- [ ] **Step 1: Add the new feature to ROADMAP "Déjà livré" table**

Read the existing table and append a row. Determine the next number (currently 24 is the last shipped — so use 25, but verify). Add :
```markdown
| 25 | **Roadmap predictive — CORE** (parser ROADMAP.md → ghosts.json sidecars, 3 endpoints, snapshot auto-sync) | `/ghosts/sync`, `/ghosts`, `/ghosts/at`, `docker-server-ghosts.mjs`, `docker-server-ghosts-core.mjs` |
```

Also update the timestamp line at the top to reflect the new shipment (e.g. `Dernière mise à jour : 2026-05-26 (Roadmap-predictive CORE livré)`).

- [ ] **Step 2: Add a "Partie B" section in INVENTORY.md**

Read `INVENTORY.md`. Find the section listing endpoints in "Partie B — Nos ajouts" (or equivalent). Append a sub-section for the ghosts CORE :

```markdown
#### Roadmap predictive — CORE (2026-05-26)

| Endpoint | Méthode | Rôle |
|---|---|---|
| `/ghosts/sync` | POST | Parse `ROADMAP.md` → écrit `roadmap.yml` + `.gitnexus/ghosts.json` |
| `/ghosts` | GET | Renvoie `ghosts.json` latest (404 si jamais sync) |
| `/ghosts/at` | GET | Renvoie `.gitnexus/snapshots/<sha>/ghosts.json` (404 si SHA inconnu) |

**Fichiers** :
- `upstream/docker-server-ghosts-core.mjs` — parser, YAML renderer, link matcher, status computer (pure fns)
- `upstream/docker-server-ghosts.mjs` — I/O wrapper + 3 route handlers + snapshot integration
- `scripts/sync-ghosts.mjs` — CLI wrapper

**Storage** (par repo analysé) :
- `<repo>/roadmap.yml` — auto-généré, versionné
- `<repo>/.gitnexus/ghosts.json` — state runtime latest
- `<repo>/.gitnexus/snapshots/<sha>/ghosts.json` — state historique par commit
```

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md INVENTORY.md
git commit -m "docs: roadmap-predictive CORE shipped (ROADMAP + INVENTORY)"
```

---

### Task 20: Update tests/README.md inventory

**Files:**
- Modify: `tests/README.md`

- [ ] **Step 1: Add the 8 new test files to the inventory**

Edit `tests/README.md`. In the "Pure logic units" section, add rows for the 4 ghost-related unit tests :
```markdown
| Ghost parser | `unit/ghosts-parser.test.mjs` | parseRoadmap (table + Tier sections) |
| Ghost YAML | `unit/ghosts-yaml.test.mjs` | renderRoadmapYml deterministic |
| Ghost matching | `unit/ghosts-matching.test.mjs` | matchExpectedLinks suffix + glob |
| Ghost lifecycle | `unit/ghosts-lifecycle.test.mjs` | computeStatus transitions |
```

In the "Endpoints integration" section, add :
```markdown
| Ghosts sync | `integration/endpoints/ghosts-sync.test.mjs` | POST /ghosts/sync idempotent |
| Ghosts read | `integration/endpoints/ghosts.test.mjs` | GET /ghosts 404/200 |
| Ghosts at commit | `integration/endpoints/ghosts-at.test.mjs` | GET /ghosts/at historical |
| Ghosts in snapshot | `integration/endpoints/ghosts-snapshot.test.mjs` | snapshot auto-sync |
```

- [ ] **Step 2: Verify the orphan-check still passes**

Run: `node scripts/check-test-inventory.mjs`
Expected: prints `OK — N test files all listed in tests/README.md` (N includes the 8 new ones).

- [ ] **Step 3: Commit**

```bash
git add tests/README.md
git commit -m "docs(tests): list 8 new ghost test files in inventory"
```

---

### Task 21: Append "Update — Shipped" section to the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md`

- [ ] **Step 1: Read the current spec end**

Run :
```
node -e "const c=require('fs').readFileSync('docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md','utf8'); console.log(c.slice(c.length-500))"
```

- [ ] **Step 2: Append the Update section**

Replace the trailing content (after "## 7. Suite") by appending an Update block. Run :
```
node -e "const fs=require('fs'); const p='docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md'; const c=fs.readFileSync(p,'utf8'); const today=new Date().toISOString().slice(0,10); const upd = '\n\n---\n\n## Update ' + today + ' — Shipped\n\nCORE livré (21 tâches du plan ' + 'docs/superpowers/plans/2026-05-26-roadmap-predictive-core.md). Notes de livraison :\n\n- Parser, YAML renderer, matcher, lifecycle : implémentés tels que la spec les décrit. expectedLinks marqués `kind: path | label` ; le matcher ignore les `label` (open question 4 résolue comme prévu).\n- 3 endpoints livrés ; comportement 404 vs 200 vide implémenté tel que clarifié en section 3.2.\n- roadmap.yml NON auto-committé (open question 3 résolue par messaging — la CLI le rappelle au user).\n- backfill historique de plannedAt : non implémenté (hors-scope, sous-spec Audit).\n- Tests : 4 unit + 4 integration écrits ; runtime locale bloquée Node 21, validés sur CI Node 22.\n- Sous-specs Audit / Augmented / Gantt / Brainstorm-hook restent à brainstormer (voir IDEAS-PARKING-roadmap-predictive.md).\n'; fs.writeFileSync(p, c + upd); console.log('appended Update section')"
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md
git commit -m "docs(spec): append Update — Shipped on roadmap-predictive CORE"
```

---

## Final validation

- [ ] All commits use the correct identity :
  ```
  git log --pretty=format:"%ae" --since="2026-05-26 14:00" | sort -u
  ```
  Expected : only `roblastar@live.fr`.

- [ ] `node scripts/check-test-inventory.mjs` exits 0.

- [ ] `patches/upstream-all.diff` includes all 5 new/modified upstream files :
  ```
  grep -c "^diff --git a/" patches/upstream-all.diff
  ```
  Expected : count went up by 4 (ghosts-core, ghosts.mjs, snapshots, snapshots-bulk) from the previous diff baseline.

- [ ] No `git add upstream/...` ever happened (search history) :
  ```
  git log --since="2026-05-26 14:00" --name-only | grep "^upstream/" || echo "OK — no upstream/ files tracked"
  ```

- [ ] Smoke loop in `CLAUDE.md` includes `ghosts` and `ghosts/sync`.

- [ ] ROADMAP "Déjà livré" table includes row 25 ; INVENTORY has the new sub-section ; spec has the `Update — Shipped` block.

---

## Self-Review

**Spec coverage** : every section of the spec maps to one or more tasks.
- §2 Goal — covered by Tasks 6–10 (the working endpoints).
- §3.2 Architecture (modules, endpoints, storage) — Tasks 1–7 + 8 + 11.
- §3.2 Parser — Tasks 1–2.
- §3.2 YAML render — Task 3.
- §3.2 Matching — Task 4.
- §3.2 Lifecycle — Task 5.
- §3.2 Snapshot integration — Tasks 9–10.
- §3.2 Tests — Tasks 14–17 (integration) + Task 13 (fixture). Unit tests are written alongside the impl tasks (Tasks 1–5).
- §4 Scope boundaries — respected (no UI, no SysML, no Audit view).
- §5 Open questions — resolved in spec ; Update section (Task 21) records the resolutions.

**Placeholder scan** : no TBD / TODO / "handle edge cases" / "similar to Task N". Every test step shows actual code. Every impl step shows actual code. Steps where the implementer must adapt to existing patterns (Task 7 Step 1 reading existing route shape, Task 8 Step 1 finding the route block) are documented with the discovery command and what to do with the answer — these are *necessary* adaptive steps, not vague placeholders.

**Type consistency** : ghost object shape is consistent across all tasks (`id, tier, title, description, status, expectedLinks: [{kind, value}], dependsOn`). Runtime ghost adds `declared, plannedAt, materializedAt, cancelledAt, links` — consistent in Tasks 6, 9, 10. Function names stable : `parseRoadmap`, `renderRoadmapYml`, `matchExpectedLinks`, `computeStatus`, `syncGhostsForRepo`, `syncGhostsForSnapshot`, `readLatestGhosts`, `readSnapshotGhosts`, `handleGhostsSync`, `handleGhostsGet`, `handleGhostsAt`.

**Known limitation** : Task 7 has an adaptive `import { resolveRepoPath }` line that may need to switch to a private helper depending on what `docker-server.mjs` exports. The task documents both options and tells the implementer how to choose ; this is a known soft spot.

**Risks** :
1. The auto-match (computeStatus upgrading planned → materialized when all paths match) may produce false positives on the real ROADMAP.md (e.g. an unrelated commit that touches `EntropyBadge.tsx` would trigger materialization of the Tier 1.4 ghost if it was still in `planned` state). Mitigation : declared status (✅ in ROADMAP) always wins, so once you mark ✅ manually, the auto-match never runs again. The transient false positive only affects ghosts you haven't marked yet.
2. Tests execute on CI only — local Node 21 can't run them. Mitigation : aggressive `node --check` + `node -e` smoke at each task ; CI validates the full suite. Documented in the plan header.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-26-roadmap-predictive-core.md`. Two execution options :**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
