# Roadmap Predictive — Brainstorm-hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the brainstorm-hook — a script that parses a spec markdown and upserts a row in a managed section of `ROADMAP.md`, plus a wizard that wires this script into 4 convergent triggers (manual, Claude PostToolUse, git post-commit, GH Actions).

**Architecture:** Three Node modules under `scripts/` : `ghost-from-spec-parser.mjs` (pure fns), `ghost-from-spec-roadmap.mjs` (managed section upsert, pure), `ghost-from-spec.mjs` (CLI wrapper). A 4th `install-brainstorm-hooks.mjs` wires the 3 auto-triggers. One regex added to the CORE parser to recognize the managed section.

**Tech Stack:** Node 21 (cross-platform via `node:fs/promises`), no new deps. CORE parser is `upstream/docker-server-ghosts-core.mjs` (gitignored — patches/upstream-all.diff regen).

**Spec source:** [`docs/superpowers/specs/2026-05-26-roadmap-predictive-brainstorm-hook-design.md`](../specs/2026-05-26-roadmap-predictive-brainstorm-hook-design.md) (commit `fe780d75`).

**Depends on:** CORE plan (must ship first — provides `parseRoadmap` to extend with the new regex).

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branch `deployment`).

**Implementer reminders:**
1. `upstream/` is gitignored — regen `patches/upstream-all.diff` after the CORE parser regex edit.
2. Vitest 4.x blocked on Node 21 — `node --check` for syntax, CI runs tests.
3. `git config user.email` must print `roblastar@live.fr`.
4. Append `## Update YYYY-MM-DD — Shipped` to the brainstorm-hook spec at the end (Task 13).
5. Append `## Update YYYY-MM-DD — Brainstorm-hook integration` to the CORE spec (Task 11).

---

## File Structure

```
scripts/
├── ghost-from-spec-parser.mjs          NEW  Pure fns : parseSpec, deriveId, extractTitle,
│                                            extractDescription, extractTier, extractExpectedLinks
├── ghost-from-spec-roadmap.mjs         NEW  Pure fns : upsertManagedSection, renderRow,
│                                            findOrCreateMarkers
├── ghost-from-spec.mjs                 NEW  CLI wrapper : main(specPath) → parse → upsert → optional POST sync
└── install-brainstorm-hooks.mjs        NEW  Wizard : merge Claude config, write git hook,
                                              write GHA workflow

upstream/
└── docker-server-ghosts-core.mjs       MOD  Add FROM_SPEC_SECTION_RE + status branching

.github/workflows/
└── roadmap-sync.yml                    NEW  (template installed by wizard)

tests/
├── unit/
│   ├── ghost-from-spec-parser.test.mjs           NEW
│   ├── ghost-from-spec-roadmap.test.mjs          NEW
│   └── install-brainstorm-hooks.test.mjs         NEW
└── integration/
    └── brainstorm-hook-e2e.test.mjs              NEW

ROADMAP.md                              MOD  Initialize the `## 🧪 From spec brainstorms`
                                              section with markers (so the script has anchors).
INVENTORY.md                            MOD  Document new scripts + 4 trigger options.
CLAUDE.md (gitnexus)                    MOD  Add `npm run ghost:from-spec` to "What lives where".
tests/README.md                         MOD  4 new test files.
package.json (gitnexus root, if it exists ; else skip) MOD  Add ghost:from-spec, setup:hooks scripts.
docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md   MOD  Append Update.
docs/superpowers/specs/2026-05-26-roadmap-predictive-brainstorm-hook-design.md   MOD  Append Update — Shipped.
patches/upstream-all.diff               REGEN  After the CORE parser regex edit.
```

---

## Preconditions

- [ ] **Step 0: Verify CORE is shipped + git identity**

```bash
node -e "console.log(require('fs').existsSync('upstream/docker-server-ghosts-core.mjs'))"   # → true
git config user.email   # → roblastar@live.fr
```

---

## Section A — Spec parser pure fns (Tasks 1-3, ~1 day)

### Task 1: parseSpec — id, title

**Files:**
- Create: `scripts/ghost-from-spec-parser.mjs`
- Create: `tests/unit/ghost-from-spec-parser.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { deriveId, extractTitle } from '../../scripts/ghost-from-spec-parser.mjs';

describe('deriveId', () => {
  it('strips the "-design" / "-spec" suffix and date prefix to make a stable id', () => {
    expect(deriveId('2026-05-26-roadmap-predictive-audit-design.md'))
      .toBe('spec-2026-05-26-roadmap-predictive-audit');
    expect(deriveId('2026-06-01-foo-spec.md'))
      .toBe('spec-2026-06-01-foo');
    expect(deriveId('docs/superpowers/specs/2026-07-15-bar-design.md'))
      .toBe('spec-2026-07-15-bar');
  });

  it('keeps non-standard filenames as-is (without -design/-spec)', () => {
    expect(deriveId('foo.md')).toBe('spec-foo');
  });
});

describe('extractTitle', () => {
  it('returns the first H1 line, stripped of trailing "design"/"spec"', () => {
    const md = '# Roadmap Predictive — Audit view design\n\nbody\n';
    expect(extractTitle(md)).toBe('Roadmap Predictive — Audit view');
  });

  it('falls back to "(untitled spec)" if no H1', () => {
    expect(extractTitle('no header here')).toBe('(untitled spec)');
  });

  it('handles H1 with trailing emojis and whitespace', () => {
    expect(extractTitle('# My feature ✅  \n')).toBe('My feature ✅');
  });
});
```

- [ ] **Step 2: Validate test syntax + implement**

Run: `node --check tests/unit/ghost-from-spec-parser.test.mjs`

Create `scripts/ghost-from-spec-parser.mjs`:
```js
/**
 * Pure fns to parse a spec markdown into ghost fields.
 * No I/O. Consumed by scripts/ghost-from-spec.mjs.
 *
 * See docs/superpowers/specs/2026-05-26-roadmap-predictive-brainstorm-hook-design.md
 */
import { basename } from 'node:path';

const DESIGN_SUFFIX_RE = /-(design|spec)$/i;
const TRAILING_DESIGN_RE = /\b(design|spec|implementation plan)\s*$/i;

export function deriveId(filePath) {
  const name = basename(filePath).replace(/\.md$/i, '');
  const stripped = name.replace(DESIGN_SUFFIX_RE, '');
  return `spec-${stripped}`;
}

export function extractTitle(md) {
  if (!md) return '(untitled spec)';
  const line = md.split('\n').find(l => /^#\s/.test(l));
  if (!line) return '(untitled spec)';
  const title = line.replace(/^#\s+/, '').replace(TRAILING_DESIGN_RE, '').trim();
  return title || '(untitled spec)';
}
```

- [ ] **Step 3: Smoke + commit**

```bash
node -e "import('./scripts/ghost-from-spec-parser.mjs').then(m => console.log(m.deriveId('2026-05-26-foo-design.md'), '|', m.extractTitle('# Foo design\n\n')))"
# Expected: spec-2026-05-26-foo | Foo

git add scripts/ghost-from-spec-parser.mjs tests/unit/ghost-from-spec-parser.test.mjs
git commit -m "feat(brainstorm-hook): deriveId + extractTitle pure fns"
```

---

### Task 2: extractDescription + extractTier

**Files:**
- Modify: `scripts/ghost-from-spec-parser.mjs`
- Modify: `tests/unit/ghost-from-spec-parser.test.mjs`

- [ ] **Step 1: Append tests**

```js
import { extractDescription, extractTier } from '../../scripts/ghost-from-spec-parser.mjs';

describe('extractDescription', () => {
  const sample = [
    '# Title', '', '## 1. Context', 'before goal', '',
    '## 2. Goal', '', 'This is the goal paragraph that explains what we build.',
    'It can span multiple lines but only the first non-blank paragraph counts.', '',
    '## 3. Design', 'rest...',
  ].join('\n');

  it('extracts the first paragraph after "## 2. Goal"', () => {
    const out = extractDescription(sample);
    expect(out).toContain('the goal paragraph');
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it('truncates long descriptions to 200 chars', () => {
    const long = '# T\n## 2. Goal\n\n' + 'x'.repeat(500);
    expect(extractDescription(long).length).toBeLessThanOrEqual(200);
  });

  it('returns empty string when there is no Goal section', () => {
    expect(extractDescription('# T\n\nbody\n')).toBe('');
  });
});

describe('extractTier', () => {
  it('finds the first Tier X.Y mention in the body', () => {
    expect(extractTier('# T\n\nThis is Tier 2.3 stuff.')).toBe('2.3');
    expect(extractTier('# T\n\nrelated to tier 1 (Tier 1.4)')).toBe('1.4');
  });

  it('returns null if no Tier mention', () => {
    expect(extractTier('# T\n\nNo tier here.')).toBeNull();
  });

  it('matches multi-segment tiers', () => {
    expect(extractTier('# T\n\nTier 2.5.b stuff')).toBe('2.5'); // major.minor only
  });
});
```

- [ ] **Step 2: Validate + append impl**

```js
// Append to scripts/ghost-from-spec-parser.mjs

const GOAL_SECTION_RE = /^##\s+2\.\s+Goal\s*$/i;
const NEXT_H2_RE = /^##\s+/;
const TIER_RE = /Tier\s+(\d+(?:\.\d+)?)/i;

export function extractDescription(md) {
  if (!md) return '';
  const lines = md.split('\n');
  let inGoal = false;
  let started = false;
  const buf = [];
  for (const line of lines) {
    if (!inGoal) {
      if (GOAL_SECTION_RE.test(line)) inGoal = true;
      continue;
    }
    if (NEXT_H2_RE.test(line)) break;
    const trimmed = line.trim();
    if (!started && trimmed === '') continue;       // skip leading blanks
    if (started && trimmed === '') break;            // first blank after content ends the paragraph
    if (trimmed) { buf.push(trimmed); started = true; }
  }
  const joined = buf.join(' ').replace(/\s+/g, ' ').trim();
  return joined.length > 200 ? joined.slice(0, 197) + '...' : joined;
}

export function extractTier(md) {
  if (!md) return null;
  const m = md.match(TIER_RE);
  return m ? m[1] : null;
}
```

- [ ] **Step 3: Smoke + commit**

```bash
node --check scripts/ghost-from-spec-parser.mjs
git add scripts/ghost-from-spec-parser.mjs tests/unit/ghost-from-spec-parser.test.mjs
git commit -m "feat(brainstorm-hook): extractDescription + extractTier"
```

---

### Task 3: extractExpectedLinks + top-level parseSpec

**Files:**
- Modify: `scripts/ghost-from-spec-parser.mjs`
- Modify: `tests/unit/ghost-from-spec-parser.test.mjs`

- [ ] **Step 1: Append tests**

```js
import { extractExpectedLinks, parseSpec } from '../../scripts/ghost-from-spec-parser.mjs';

describe('extractExpectedLinks', () => {
  it('extracts backticked tokens that look like paths from the Design section', () => {
    const md = '# T\n\n## 3. Design\n\nUses `services/foo.ts` and `Button.tsx` and `docker-server-bar.mjs`.';
    const out = extractExpectedLinks(md);
    expect(out).toContainEqual({ kind: 'path', value: 'services/foo.ts' });
    expect(out).toContainEqual({ kind: 'path', value: 'Button.tsx' });
    expect(out).toContainEqual({ kind: 'path', value: 'docker-server-bar.mjs' });
  });

  it('marks non-path backticked tokens as label kind', () => {
    const md = '# T\n\n## 3. Design\n\n`some label` is interesting.';
    const out = extractExpectedLinks(md);
    expect(out).toContainEqual({ kind: 'label', value: 'some label' });
  });

  it('returns empty array if no Design section', () => {
    expect(extractExpectedLinks('# T\n\nbody')).toEqual([]);
  });
});

describe('parseSpec (integration)', () => {
  const md = [
    '# Roadmap Predictive — Audit view design',
    '## 1. Context', 'before',
    '## 2. Goal',
    '',
    'Build the audit view to track Tier 2.3 ghosts.',
    '',
    '## 3. Design',
    '',
    'Uses `services/foo.ts` and `Button.tsx`.',
  ].join('\n');

  it('returns a fully-populated ghost object', () => {
    const ghost = parseSpec('docs/superpowers/specs/2026-05-26-audit-design.md', md);
    expect(ghost).toMatchObject({
      id: 'spec-2026-05-26-audit',
      title: 'Roadmap Predictive — Audit view',
      description: expect.stringContaining('Build the audit view'),
      tier: '2.3',
      status: 'planned',
      expectedLinks: expect.arrayContaining([
        { kind: 'path', value: 'services/foo.ts' },
        { kind: 'path', value: 'Button.tsx' },
      ]),
    });
  });
});
```

- [ ] **Step 2: Append impl**

```js
const DESIGN_SECTION_RE = /^##\s+3\.\s+Design\s*$/i;
const BACKTICK_RE = /`([^`]+)`/g;
const PATH_HINT_RE = /\/|\.(?:mjs|ts|tsx|js|jsx|py|css|scss|json|yaml|yml|md|sh|sql|rs|go|java|kt|swift)$/;

export function extractExpectedLinks(md) {
  if (!md) return [];
  const lines = md.split('\n');
  let inDesign = false;
  const tokens = new Set();
  for (const line of lines) {
    if (DESIGN_SECTION_RE.test(line)) { inDesign = true; continue; }
    if (!inDesign) continue;
    for (const m of line.matchAll(BACKTICK_RE)) {
      tokens.add(m[1]);
    }
  }
  return [...tokens].map(t => ({
    kind: PATH_HINT_RE.test(t) ? 'path' : 'label',
    value: t,
  }));
}

export function parseSpec(filePath, md) {
  return {
    id: deriveId(filePath),
    title: extractTitle(md),
    description: extractDescription(md),
    tier: extractTier(md),
    status: 'planned',
    expectedLinks: extractExpectedLinks(md),
  };
}
```

- [ ] **Step 3: Smoke + commit**

```bash
node -e "import('./scripts/ghost-from-spec-parser.mjs').then(m => console.log(JSON.stringify(m.parseSpec('foo-design.md', '# F\n\n## 2. Goal\n\nDoes Tier 1.4 stuff.\n\n## 3. Design\n\n\`foo.ts\` is used.'), null, 2)))"
# Expected: prints { id: 'spec-foo', title: 'F', tier: '1.4', expectedLinks: [{kind:'path',value:'foo.ts'}], … }

git add scripts/ghost-from-spec-parser.mjs tests/unit/ghost-from-spec-parser.test.mjs
git commit -m "feat(brainstorm-hook): extractExpectedLinks + parseSpec top-level"
```

---

## Section B — ROADMAP managed section upsert (Tasks 4-5, ~0.5 day)

### Task 4: upsertManagedSection — create when missing, idempotent

**Files:**
- Create: `scripts/ghost-from-spec-roadmap.mjs`
- Create: `tests/unit/ghost-from-spec-roadmap.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { upsertManagedSection } from '../../scripts/ghost-from-spec-roadmap.mjs';

const ghost = {
  id: 'spec-2026-05-26-foo',
  title: 'Foo feature',
  tier: '2.3',
  expectedLinks: [
    { kind: 'path', value: 'services/foo.ts' },
    { kind: 'path', value: 'FooPanel.tsx' },
  ],
  description: '',
  status: 'planned',
};

describe('upsertManagedSection', () => {
  it('appends a new section when no markers exist', () => {
    const input = '# Roadmap\n\nbody\n';
    const out = upsertManagedSection(input, ghost, 'docs/superpowers/specs/2026-05-26-foo-design.md');
    expect(out).toContain('## 🧪 From spec brainstorms');
    expect(out).toContain('<!-- specs:start -->');
    expect(out).toContain('<!-- specs:end -->');
    expect(out).toContain('| [2026-05-26-foo-design]');
    expect(out).toContain('Foo feature');
    expect(out).toContain('`services/foo.ts`');
  });

  it('upserts in place when the section already exists', () => {
    const input = [
      '# R', '',
      '## 🧪 From spec brainstorms', '',
      '<!-- specs:start -->',
      '| Spec | Tier | Title | Endpoint(s) / Composant(s) |',
      '|---|---|---|---|',
      '| [2026-05-26-foo-design](path) | 2.3 | OLD TITLE | `old.ts` |',
      '<!-- specs:end -->',
    ].join('\n');
    const out = upsertManagedSection(input, ghost, 'docs/superpowers/specs/2026-05-26-foo-design.md');
    expect(out).not.toContain('OLD TITLE');
    expect(out).not.toContain('`old.ts`');
    expect(out).toContain('Foo feature');
    expect(out).toContain('`services/foo.ts`');
    // Should still contain the markers exactly once
    expect(out.match(/<!-- specs:start -->/g)).toHaveLength(1);
  });

  it('appends a new row when id is new', () => {
    const input = [
      '# R', '',
      '## 🧪 From spec brainstorms', '',
      '<!-- specs:start -->',
      '| Spec | Tier | Title | Endpoint(s) / Composant(s) |',
      '|---|---|---|---|',
      '| [other](path) | 1.1 | Other | `other.ts` |',
      '<!-- specs:end -->',
    ].join('\n');
    const out = upsertManagedSection(input, ghost, 'docs/superpowers/specs/2026-05-26-foo-design.md');
    expect(out).toContain('Other');
    expect(out).toContain('Foo feature');
  });

  it('is idempotent on identical re-runs', () => {
    let buf = '# R\n';
    buf = upsertManagedSection(buf, ghost, 'docs/superpowers/specs/2026-05-26-foo-design.md');
    const once = buf;
    buf = upsertManagedSection(buf, ghost, 'docs/superpowers/specs/2026-05-26-foo-design.md');
    expect(buf).toBe(once);
  });
});
```

- [ ] **Step 2: Implement**

Create `scripts/ghost-from-spec-roadmap.mjs`:
```js
/**
 * Pure fns to upsert a row in the managed section of ROADMAP.md.
 * No I/O.
 */
import { basename } from 'node:path';

const START_MARKER = '<!-- specs:start -->';
const END_MARKER = '<!-- specs:end -->';
const SECTION_HEADER = '## 🧪 From spec brainstorms';
const TABLE_HEADER = '| Spec | Tier | Title | Endpoint(s) / Composant(s) |';
const TABLE_SEP = '|---|---|---|---|';

function renderLinkCell(expectedLinks) {
  if (!expectedLinks || expectedLinks.length === 0) return '';
  return expectedLinks.slice(0, 5).map(l => `\`${l.value}\``).join(', ');
}

function renderRow(ghost, specPath) {
  const specName = basename(specPath).replace(/\.md$/i, '');
  const tier = ghost.tier ?? '—';
  const title = ghost.title.replace(/\|/g, '\\|');
  const links = renderLinkCell(ghost.expectedLinks);
  return `| [${specName}](${specPath}) | ${tier} | ${title} | ${links} |`;
}

function rowMatchesId(line, specName) {
  return line.includes(`[${specName}]`);
}

export function upsertManagedSection(md, ghost, specPath) {
  const specName = basename(specPath).replace(/\.md$/i, '');
  const newRow = renderRow(ghost, specPath);

  const startIdx = md.indexOf(START_MARKER);
  const endIdx = md.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    // Append a fresh section.
    const block = [
      '',
      '',
      SECTION_HEADER,
      '',
      '> Auto-generated by `scripts/ghost-from-spec.mjs`. Edits between the markers',
      '> below will be overwritten. Manage ghosts manually in the `## ✅ Déjà livré`',
      '> table or in a Tier subsection above.',
      '',
      START_MARKER,
      TABLE_HEADER,
      TABLE_SEP,
      newRow,
      END_MARKER,
      '',
    ].join('\n');
    return md.replace(/\s*$/, '') + block;
  }

  // Section exists — update or append the row.
  const before = md.slice(0, startIdx);
  const inside = md.slice(startIdx + START_MARKER.length, endIdx);
  const after = md.slice(endIdx);

  const lines = inside.split('\n');
  let foundExisting = false;
  const updatedLines = lines.map(line => {
    if (rowMatchesId(line, specName)) { foundExisting = true; return newRow; }
    return line;
  });

  if (!foundExisting) {
    // Insert before the final blank line (right before END_MARKER).
    // Trim trailing empties, append new row, restore one blank.
    while (updatedLines.length > 0 && updatedLines[updatedLines.length - 1].trim() === '') {
      updatedLines.pop();
    }
    updatedLines.push(newRow, '');
  }

  return before + START_MARKER + updatedLines.join('\n') + after;
}
```

- [ ] **Step 3: Smoke + commit**

```bash
node --check scripts/ghost-from-spec-roadmap.mjs
node -e "import('./scripts/ghost-from-spec-roadmap.mjs').then(m => { const out = m.upsertManagedSection('# R\n', {id:'spec-foo', title:'Foo', tier:'2.3', expectedLinks:[{kind:'path',value:'a.ts'}]}, 'docs/specs/2026-05-26-foo-design.md'); console.log(out); })"

git add scripts/ghost-from-spec-roadmap.mjs tests/unit/ghost-from-spec-roadmap.test.mjs
git commit -m "feat(brainstorm-hook): upsertManagedSection idempotent ROADMAP edit"
```

---

### Task 5: Initialize the managed section in the project's ROADMAP.md

**Files:**
- Modify: `ROADMAP.md` (gitnexus root)

- [ ] **Step 1: Add the empty managed section**

This is a one-time setup so future script invocations have a target. Append at the end of `ROADMAP.md` :

```markdown

## 🧪 From spec brainstorms

> Auto-generated by `scripts/ghost-from-spec.mjs`. Edits between the markers
> below will be overwritten. Manage ghosts manually in the `## ✅ Déjà livré`
> table or in a Tier subsection above.

<!-- specs:start -->
| Spec | Tier | Title | Endpoint(s) / Composant(s) |
|---|---|---|---|
<!-- specs:end -->
```

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): initialize managed section for brainstorm-hook"
```

---

## Section C — Main CLI script (Task 6, ~0.25 day)

### Task 6: `scripts/ghost-from-spec.mjs`

**Files:**
- Create: `scripts/ghost-from-spec.mjs`

- [ ] **Step 1: Create the CLI**

```js
#!/usr/bin/env node
/**
 * CLI : parses a spec markdown and upserts its row in ROADMAP.md.
 * Optionally posts /ghosts/sync if GITNEXUS_PORT is set.
 *
 * Usage: node scripts/ghost-from-spec.mjs <path-to-spec.md>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseSpec } from './ghost-from-spec-parser.mjs';
import { upsertManagedSection } from './ghost-from-spec-roadmap.mjs';

function findRoadmapMd(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 20; i++) {
    const candidate = join(dir, 'ROADMAP.md');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function main(argv) {
  const specPath = argv[2];
  if (!specPath) {
    console.error('Usage: node scripts/ghost-from-spec.mjs <path-to-spec.md>');
    process.exit(2);
  }
  const resolved = resolve(specPath);
  if (!existsSync(resolved)) {
    console.error(`Spec file not found: ${resolved}`);
    process.exit(1);
  }
  const md = await readFile(resolved, 'utf8');
  const ghost = parseSpec(resolved, md);

  const roadmapPath = findRoadmapMd(dirname(resolved));
  if (!roadmapPath) {
    console.error('Could not find ROADMAP.md walking up from the spec file.');
    process.exit(1);
  }
  const roadmapMd = await readFile(roadmapPath, 'utf8');
  const updated = upsertManagedSection(roadmapMd, ghost, resolved.replace(/\\/g, '/'));

  if (updated === roadmapMd) {
    console.log(`No change to ROADMAP.md (ghost ${ghost.id} already up-to-date).`);
  } else {
    await writeFile(roadmapPath, updated);
    console.log(`Updated ROADMAP.md with ghost ${ghost.id} (${ghost.title}).`);
  }

  // Optional : POST /ghosts/sync if a port is configured.
  const port = process.env.GITNEXUS_PORT;
  if (port) {
    try {
      const repoBase = roadmapPath.split(/[\\/]/).slice(-2, -1)[0]; // crude: parent dir name
      const res = await fetch(`http://localhost:${port}/ghosts/sync?repo=${encodeURIComponent(repoBase)}`, { method: 'POST' });
      if (res.ok) console.log(`POST /ghosts/sync OK (repo=${repoBase}).`);
      else console.warn(`POST /ghosts/sync failed: HTTP ${res.status}`);
    } catch (err) {
      console.warn(`Could not POST /ghosts/sync: ${err.message}`);
    }
  }
}

main(process.argv).catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 2: Smoke (dry-run against a fake spec)**

```bash
node scripts/ghost-from-spec.mjs   # → usage + exit 2
echo "# Smoke test\n\n## 2. Goal\n\nTier 9.9 smoke.\n\n## 3. Design\n\nUses \`/tmp/foo.ts\`." > /tmp/smoke-spec.md
node scripts/ghost-from-spec.mjs /tmp/smoke-spec.md
# Reads ROADMAP.md, adds row, writes back. Inspect with: grep "smoke-spec" ROADMAP.md
git checkout -- ROADMAP.md   # revert the smoke test row before committing
```

- [ ] **Step 3: Commit**

```bash
git add scripts/ghost-from-spec.mjs
git commit -m "feat(brainstorm-hook): ghost-from-spec.mjs CLI wrapper"
```

---

## Section D — Install hooks wizard (Tasks 7-9, ~0.5 day)

### Task 7: `install-brainstorm-hooks.mjs` skeleton + Claude hook merge

**Files:**
- Create: `scripts/install-brainstorm-hooks.mjs`
- Create: `tests/unit/install-brainstorm-hooks.test.mjs`

- [ ] **Step 1: Write tests for the Claude config merge**

```js
import { describe, it, expect } from 'vitest';
import { mergeClaudeHook } from '../../scripts/install-brainstorm-hooks.mjs';

describe('mergeClaudeHook', () => {
  it('adds the hook to an empty settings file', () => {
    const out = mergeClaudeHook({});
    expect(out.hooks.PostToolUse).toContainEqual({
      matcher: 'Write',
      filePattern: 'docs/superpowers/specs/*.md',
      command: 'node scripts/ghost-from-spec.mjs $CLAUDE_TOOL_FILE_PATH',
    });
  });

  it('appends without overwriting existing PostToolUse hooks', () => {
    const existing = {
      hooks: { PostToolUse: [{ matcher: 'Edit', filePattern: '*.ts', command: 'echo edited' }] },
    };
    const out = mergeClaudeHook(existing);
    expect(out.hooks.PostToolUse).toHaveLength(2);
    expect(out.hooks.PostToolUse[0]).toMatchObject({ matcher: 'Edit' });
  });

  it('refuses to add a duplicate hook (same matcher + filePattern)', () => {
    const existing = {
      hooks: { PostToolUse: [{
        matcher: 'Write', filePattern: 'docs/superpowers/specs/*.md',
        command: 'node scripts/ghost-from-spec.mjs $CLAUDE_TOOL_FILE_PATH',
      }] },
    };
    const out = mergeClaudeHook(existing);
    expect(out.hooks.PostToolUse).toHaveLength(1); // unchanged
  });
});
```

- [ ] **Step 2: Implement**

Create `scripts/install-brainstorm-hooks.mjs`:
```js
#!/usr/bin/env node
/**
 * One-shot wizard : configures the brainstorm-hook in 3 ways
 * (Claude PostToolUse, git post-commit, GH Actions workflow).
 *
 * Usage: node scripts/install-brainstorm-hooks.mjs
 */
import { readFile, writeFile, mkdir, chmod, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const HOOK_DEF = {
  matcher: 'Write',
  filePattern: 'docs/superpowers/specs/*.md',
  command: 'node scripts/ghost-from-spec.mjs $CLAUDE_TOOL_FILE_PATH',
};

export function mergeClaudeHook(settings) {
  const out = { ...(settings ?? {}) };
  out.hooks = { ...(out.hooks ?? {}) };
  const list = [...(out.hooks.PostToolUse ?? [])];
  const dup = list.some(h => h?.matcher === HOOK_DEF.matcher && h?.filePattern === HOOK_DEF.filePattern);
  if (!dup) list.push(HOOK_DEF);
  out.hooks.PostToolUse = list;
  return out;
}

async function fileExists(p) { try { await access(p); return true; } catch { return false; } }

async function readJsonOr(p, fallback) {
  if (!(await fileExists(p))) return fallback;
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}

const GIT_HOOK = `#!/bin/sh
# Auto-installed by scripts/install-brainstorm-hooks.mjs
git diff-tree --no-commit-id --name-only HEAD | grep -E '^docs/superpowers/specs/.*\\.md$' | while read spec; do
  node scripts/ghost-from-spec.mjs "$spec"
done
`;

const GHA_WORKFLOW = `name: roadmap-sync
on:
  push:
    branches: [deployment]
    paths: ['docs/superpowers/specs/**']
jobs:
  sync-ghosts-from-specs:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 2 }
      - uses: actions/setup-node@v4
        with: { node-version: '22.11.0' }
      - name: Find newly-changed specs and update ROADMAP
        run: |
          for spec in $(git diff --name-only HEAD~1 HEAD | grep '^docs/superpowers/specs/'); do
            node scripts/ghost-from-spec.mjs "$spec"
          done
      - name: Commit ROADMAP changes back
        run: |
          if ! git diff --quiet ROADMAP.md; then
            git config user.email "roblastar@live.fr"
            git config user.name "Robin DENIS"
            git add ROADMAP.md
            git commit -m "chore(roadmap): sync ghosts from specs (auto)"
            git push
          fi
`;

async function installClaudeHook() {
  const p = join(ROOT, '.claude', 'settings.local.json');
  const cur = await readJsonOr(p, {});
  const merged = mergeClaudeHook(cur);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(merged, null, 2) + '\n');
  console.log(`✓ Claude hook merged into ${p}`);
}

async function installGitHook() {
  const p = join(ROOT, '.git', 'hooks', 'post-commit');
  await writeFile(p, GIT_HOOK);
  await chmod(p, 0o755).catch(() => {}); // Windows ignores chmod
  console.log(`✓ Git post-commit hook installed at ${p}`);
}

async function installGhaWorkflow() {
  const p = join(ROOT, '.github', 'workflows', 'roadmap-sync.yml');
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, GHA_WORKFLOW);
  console.log(`✓ GHA workflow installed at ${p}`);
}

async function main() {
  console.log('Installing brainstorm-hook in 3 modes...');
  await installClaudeHook();
  await installGitHook();
  await installGhaWorkflow();
  console.log('\nDone. The hook is now active on this machine.');
  console.log('Test it : touch a spec under docs/superpowers/specs/ and commit.');
}

// Only run main if this is the entrypoint (cross-platform check)
const isMain = process.argv[1] && (
  process.argv[1].endsWith('install-brainstorm-hooks.mjs') ||
  process.argv[1] === fileURLToPath(import.meta.url)
);
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Smoke + commit**

```bash
node --check scripts/install-brainstorm-hooks.mjs
node -e "import('./scripts/install-brainstorm-hooks.mjs').then(m => console.log(JSON.stringify(m.mergeClaudeHook({}), null, 2)))"

git add scripts/install-brainstorm-hooks.mjs tests/unit/install-brainstorm-hooks.test.mjs
git commit -m "feat(brainstorm-hook): install-brainstorm-hooks.mjs (Claude + git + GHA)"
```

---

### Task 8: Test the git-hook + GHA-workflow output strings

**Files:**
- Modify: `tests/unit/install-brainstorm-hooks.test.mjs`

- [ ] **Step 1: Export the templates from the module to make them testable**

In `scripts/install-brainstorm-hooks.mjs`, add `export { GIT_HOOK, GHA_WORKFLOW };` near the constant declarations.

- [ ] **Step 2: Append tests**

```js
import { GIT_HOOK, GHA_WORKFLOW } from '../../scripts/install-brainstorm-hooks.mjs';

describe('GIT_HOOK template', () => {
  it('is a POSIX shell script with the right diff-tree command', () => {
    expect(GIT_HOOK.startsWith('#!/bin/sh')).toBe(true);
    expect(GIT_HOOK).toContain('git diff-tree --no-commit-id');
    expect(GIT_HOOK).toContain('docs/superpowers/specs/');
    expect(GIT_HOOK).toContain('ghost-from-spec.mjs');
  });
});

describe('GHA_WORKFLOW template', () => {
  it('matches branches [deployment] and paths specs/', () => {
    expect(GHA_WORKFLOW).toContain('branches: [deployment]');
    expect(GHA_WORKFLOW).toContain("paths: ['docs/superpowers/specs/**']");
  });
  it('uses Node 22.11.0 and is non-blocking', () => {
    expect(GHA_WORKFLOW).toContain("node-version: '22.11.0'");
    expect(GHA_WORKFLOW).toContain('continue-on-error: true');
  });
  it('commits with the roblastar identity', () => {
    expect(GHA_WORKFLOW).toContain('roblastar@live.fr');
    expect(GHA_WORKFLOW).toContain('Robin DENIS');
  });
});
```

- [ ] **Step 3: Commit**

```bash
node --check scripts/install-brainstorm-hooks.mjs
git add scripts/install-brainstorm-hooks.mjs tests/unit/install-brainstorm-hooks.test.mjs
git commit -m "test(brainstorm-hook): templates for git hook + GHA workflow"
```

---

### Task 9: Add `setup:hooks` and `ghost:from-spec` npm scripts

**Files:**
- Modify: `package.json` (at gitnexus root, if it exists)

- [ ] **Step 1: Check whether `package.json` exists at the root**

Run: `node -e "console.log(require('fs').existsSync('package.json'))"`

If `false`, skip Step 2 and document in the task report : "no package.json at root — invoke via `node scripts/...mjs` directly".

- [ ] **Step 2: Add the scripts**

```json
{
  "scripts": {
    "ghost:from-spec": "node scripts/ghost-from-spec.mjs",
    "setup:hooks": "node scripts/install-brainstorm-hooks.mjs"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json   # if exists
git commit -m "chore: add ghost:from-spec + setup:hooks npm scripts"
```

---

## Section E — CORE parser extension (Task 10, ~0.25 day)

### Task 10: Extend `parseRoadmap` in CORE to read the managed section

**Files:**
- Modify: `upstream/docker-server-ghosts-core.mjs`
- Modify: `tests/unit/ghosts-parser.test.mjs`

- [ ] **Step 1: Write the test**

Append to `tests/unit/ghosts-parser.test.mjs`:
```js
describe('parseRoadmap — managed "From spec brainstorms" section', () => {
  const md = [
    '# Roadmap', '',
    '## ✅ Déjà livré', '',
    '| # | Feature | Endpoint(s) / Composant(s) |',
    '|---|---|---|',
    '| 1 | **Old feature** | `old.ts` |',
    '',
    '## 🧪 From spec brainstorms', '',
    '<!-- specs:start -->',
    '| Spec | Tier | Title | Endpoint(s) / Composant(s) |',
    '|---|---|---|---|',
    '| [2026-05-26-foo-design](path) | 2.3 | Foo planned | `services/foo.ts` |',
    '<!-- specs:end -->',
  ].join('\n');

  it('picks up rows from the managed section with status: planned', () => {
    const ghosts = parseRoadmap(md);
    const foo = ghosts.find(g => g.title === 'Foo planned');
    expect(foo).toBeDefined();
    expect(foo.status).toBe('planned');
    expect(foo.expectedLinks.some(l => l.value === 'services/foo.ts')).toBe(true);
  });

  it('still picks up the Déjà livré section with status: materialized', () => {
    const ghosts = parseRoadmap(md);
    expect(ghosts.find(g => g.title === 'Old feature').status).toBe('materialized');
  });
});
```

- [ ] **Step 2: Extend `parseRoadmap` in the CORE**

Edit `upstream/docker-server-ghosts-core.mjs`. The existing code has a regex `SHIPPED_SECTION_RE`. Add a sibling :

```js
const FROM_SPEC_SECTION_RE = /^##\s+🧪\s+From spec brainstorms\s*$/i;
```

In the table-parsing loop where `inShippedSection` is set, branch on which marker section the table belongs to and set a `defaultStatus` accordingly. Pseudo-code (adapt to actual structure of CORE) :

```js
// Replace
if (SHIPPED_SECTION_RE.test(line)) { inShippedSection = true; ... }
// By
if (SHIPPED_SECTION_RE.test(line)) { inGhostTableSection = true; defaultStatus = 'materialized'; ... }
if (FROM_SPEC_SECTION_RE.test(line)) { inGhostTableSection = true; defaultStatus = 'planned'; ... }
// ... and use `defaultStatus` in the ghost emission where 'materialized' was hardcoded.
```

- [ ] **Step 3: Smoke + commit**

```bash
node --check upstream/docker-server-ghosts-core.mjs

cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghosts-parser.test.mjs
git commit -m "feat(ghosts-core): parse '🧪 From spec brainstorms' managed section"
```

---

## Section F — Integration test (Task 11, ~0.25 day)

### Task 11: End-to-end integration test

**Files:**
- Create: `tests/integration/brainstorm-hook-e2e.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('brainstorm-hook end-to-end', () => {
  it('script + ROADMAP update + CORE parser pick up the new ghost', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bh-e2e-'));
    try {
      // 1. Init a fake repo with a minimal ROADMAP and a spec
      mkdirSync(join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(join(dir, 'ROADMAP.md'), '# Roadmap\n\n## ✅ Déjà livré\n\n| # | Feature | Endpoint(s) / Composant(s) |\n|---|---|---|\n');
      writeFileSync(join(dir, 'docs', 'superpowers', 'specs', '2026-05-26-foo-design.md'),
        '# Foo design\n\n## 2. Goal\n\nBuild Tier 2.3 foo.\n\n## 3. Design\n\nUses `services/foo.ts`.\n');

      // 2. Copy the scripts into the temp repo (resolve from this test's cwd)
      const scriptsDir = join(process.cwd(), 'scripts');
      for (const f of ['ghost-from-spec.mjs', 'ghost-from-spec-parser.mjs', 'ghost-from-spec-roadmap.mjs']) {
        writeFileSync(join(dir, 'scripts', f), readFileSync(join(scriptsDir, f), 'utf8'));
      }

      // 3. Run the script
      execFileSync(process.execPath, [
        join(dir, 'scripts', 'ghost-from-spec.mjs'),
        join(dir, 'docs', 'superpowers', 'specs', '2026-05-26-foo-design.md'),
      ], { cwd: dir, stdio: 'pipe' });

      // 4. Assert ROADMAP.md now contains the managed section + the row
      const updated = readFileSync(join(dir, 'ROADMAP.md'), 'utf8');
      expect(updated).toContain('## 🧪 From spec brainstorms');
      expect(updated).toContain('2026-05-26-foo-design');
      expect(updated).toContain('services/foo.ts');

      // 5. parseRoadmap of the CORE should pick it up
      import('../../upstream/docker-server-ghosts-core.mjs').then(m => {
        const ghosts = m.parseRoadmap(updated);
        expect(ghosts.some(g => g.title === 'Foo' && g.status === 'planned')).toBe(true);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Validate + commit**

```bash
node --check tests/integration/brainstorm-hook-e2e.test.mjs
git add tests/integration/brainstorm-hook-e2e.test.mjs
git commit -m "test(integ): brainstorm-hook end-to-end (script → ROADMAP → CORE parser)"
```

---

## Section G — Wiring docs + Update sections (Tasks 12-14, ~0.25 day)

### Task 12: ROADMAP + INVENTORY + tests/README updates

**Files:**
- Modify: `ROADMAP.md` (add row 28 to "Déjà livré")
- Modify: `INVENTORY.md`
- Modify: `tests/README.md`

- [ ] **Step 1: ROADMAP row**

Append a new row to the "Déjà livré" table :
```markdown
| 28 | **Roadmap predictive — Brainstorm-hook** (spec parser, ROADMAP managed section upsert, 4 convergent triggers + install wizard) | `scripts/ghost-from-spec.mjs`, `scripts/install-brainstorm-hooks.mjs`, `<!-- specs:start -->` section dans ROADMAP |
```

- [ ] **Step 2: INVENTORY sub-section**

Add under the "Roadmap predictive" sub-section :
```markdown
**Brainstorm-hook (2026-MM-DD)** — script + wizard :
- `scripts/ghost-from-spec.mjs` — CLI : parse spec markdown → upsert dans ROADMAP.md
- `scripts/ghost-from-spec-parser.mjs` — pure fns : deriveId, extractTitle, extractDescription, extractTier, extractExpectedLinks, parseSpec
- `scripts/ghost-from-spec-roadmap.mjs` — pure fns : upsertManagedSection
- `scripts/install-brainstorm-hooks.mjs` — wizard 3 triggers (Claude + git + GHA)
- 4 triggers convergents : manual, Claude PostToolUse, git post-commit, GitHub Actions
- CORE parser étendu pour reconnaître la section managée `<!-- specs:start -->`
```

- [ ] **Step 3: tests/README.md — 4 new tests**

```markdown
### Brainstorm-hook
| Spec parser pure | unit/ghost-from-spec-parser.test.mjs | parseSpec + 5 helpers |
| ROADMAP upsert pure | unit/ghost-from-spec-roadmap.test.mjs | upsertManagedSection idempotent |
| Install wizard | unit/install-brainstorm-hooks.test.mjs | Claude merge + template strings |
| E2E hook | integration/brainstorm-hook-e2e.test.mjs | script → ROADMAP → CORE parser |
```

- [ ] **Step 4: Verify + commit**

```bash
node scripts/check-test-inventory.mjs
git add ROADMAP.md INVENTORY.md tests/README.md
git commit -m "docs: roadmap-predictive Brainstorm-hook shipped (ROADMAP + INVENTORY + tests)"
```

---

### Task 13: Append `Update — Shipped` to the brainstorm-hook spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-26-roadmap-predictive-brainstorm-hook-design.md`

- [ ] **Step 1: Append the update block**

```bash
node -e "const fs=require('fs'); const p='docs/superpowers/specs/2026-05-26-roadmap-predictive-brainstorm-hook-design.md'; const c=fs.readFileSync(p,'utf8'); const today=new Date().toISOString().slice(0,10); const upd='\n\n---\n\n## Update '+today+' — Shipped\n\nBrainstorm-hook livré. Notes :\n\n- ghost-from-spec.mjs + 2 modules pure (parser, roadmap) livrés. parseSpec gère id/title/description/tier/expectedLinks par heuristique markdown.\n- upsertManagedSection idempotent : N appels produisent le même ROADMAP.md.\n- install-brainstorm-hooks.mjs configure les 3 triggers automatiques. Merge non-destructif pour .claude/settings.local.json.\n- CORE parser étendu (1 regex FROM_SPEC_SECTION_RE) ; Update appliqué sur le CORE spec.\n- 4 tests (3 unit + 1 integration e2e).\n- Open questions résolues comme prévu. La détection des Update — Shipped sections sur les specs reste hors-scope (matérialisation via CORE).\n'; fs.writeFileSync(p, c + upd);"

git add docs/superpowers/specs/2026-05-26-roadmap-predictive-brainstorm-hook-design.md
git commit -m "docs(spec): append Update — Shipped on Brainstorm-hook"
```

---

### Task 14: Append `Update — Brainstorm-hook integration` to the CORE spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md`

- [ ] **Step 1: Append the update block to the CORE spec**

```bash
node -e "const fs=require('fs'); const p='docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md'; const c=fs.readFileSync(p,'utf8'); const today=new Date().toISOString().slice(0,10); const upd='\n\n---\n\n## Update '+today+' — Brainstorm-hook parser integration\n\nLe sub-spec brainstorm-hook a nécessité une extension mineure du parser CORE : reconnaître une nouvelle H2 section managée `## 🧪 From spec brainstorms` délimitée par les markers `<!-- specs:start -->` / `<!-- specs:end -->`. Les rows de cette table émettent des ghosts en statut `planned` (vs `materialized` pour la table `## ✅ Déjà livré`).\n\nImpl : ajout d\\'une regex FROM_SPEC_SECTION_RE + branchement sur un default-status local. Aucun changement du data flow général.\n'; fs.writeFileSync(p, c + upd);"

git add docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md
git commit -m "docs(spec): Update on CORE — Brainstorm-hook parser integration"
```

---

## Final validation

- [ ] `git log --pretty=format:"%ae" --since="<start of this work>" | sort -u` → only `roblastar@live.fr`
- [ ] `node scripts/check-test-inventory.mjs` exits 0
- [ ] `patches/upstream-all.diff` includes the CORE parser regex extension
- [ ] `scripts/ghost-from-spec.mjs <some-spec>` on a real spec adds a row idempotently
- [ ] `scripts/install-brainstorm-hooks.mjs` runs end-to-end and creates `.claude/settings.local.json` + `.git/hooks/post-commit` + `.github/workflows/roadmap-sync.yml`
- [ ] ROADMAP, INVENTORY, both specs updated

---

## Self-Review

**Spec coverage** :
- §3.2 Architecture (4 modules under scripts/) — Tasks 1-3 (parser), 4-5 (roadmap), 6 (CLI), 7-9 (wizard).
- §3.2 4 triggers convergents — Task 6 (CLI = the single code path) + Task 7 (Claude hook) + Task 7 (git hook template) + Task 7 (GHA template).
- §3.2 Algorithme du script — Tasks 1-3 + 6.
- §3.2 Format de la section managée — Tasks 4-5.
- §3.2 CORE parser extension — Task 10 + Update sur CORE spec (Task 14).
- §3.2 Installation wizard non-destructif — Tasks 7-8.
- §3.2 Tests — Tasks 1-3 + 4 + 7-8 + 10 + 11.
- §4 Out-of-scope respecté (pas de modif skill superpowers, pas de server-side hook, pas de spec frontmatter).
- §5 Open questions — addressées en design + Update sur Task 13.

**Placeholder scan** : Task 10 Step 2 has a "pseudo-code (adapt to actual structure)" qualifier — this is **adaptive guidance** (the implementer must read the existing CORE structure first) rather than a placeholder. The spec discovery step is explicit. No TBD/TODO elsewhere.

**Type consistency** : `Ghost` shape (id, title, tier, description, status, expectedLinks: [{kind, value}]) consistent between parseSpec (Task 3) and upsertManagedSection (Task 4) and the CORE consumer (Task 10). HOOK_DEF constant exported and reused in tests. Function names stable : `deriveId`, `extractTitle`, `extractDescription`, `extractTier`, `extractExpectedLinks`, `parseSpec`, `upsertManagedSection`, `mergeClaudeHook`.

**Known risks** :
- Task 10 depends on the actual structure of `parseRoadmap` post-CORE-ship. The pattern in step 2 is correct conceptually but the implementer must adapt to the real control flow.
- Task 11 e2e copies the 3 scripts into a temp repo to test in isolation — assumes the scripts are runnable standalone (no relative imports outside `scripts/`).

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-26-roadmap-predictive-brainstorm-hook.md`. Two execution options :**

**1. Subagent-Driven (recommended)** — fresh subagent per task with 2 reviewers.

**2. Inline Execution** — same session, batch with checkpoints.

**Reminder** : 1 brainstorm queued (Gantt). Next step is most likely "brainstorm Gantt" rather than "execute this plan now".
