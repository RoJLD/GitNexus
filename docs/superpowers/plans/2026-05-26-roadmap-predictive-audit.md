# Roadmap Predictive — Audit view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Audit view (regard arrière) — 5 metrics aggregated through `GET /ghost-audit` + cache disk + MCP tool + `AuditPanel.tsx` — on top of the already-shipped CORE.

**Architecture:** Two new server modules (`docker-server-ghost-audit-core.mjs` pure fns + `docker-server-ghost-audit.mjs` I/O+cache+route), one new MCP tool, one React panel with 6 sub-components. Reuses CORE sidecars (`.gitnexus/ghosts.json`, `.gitnexus/snapshots/*/ghosts.json`) as inputs. Cache invalidation via mtime check, no event hooks.

**Tech Stack:** Node 22 (CI), Node 21 (local — vitest blocked), pure-JS percentile/grouping (no stats lib), SVG-native charts (pattern `GrowthChart.tsx`), Zod for MCP schema.

**Spec source:** [docs/superpowers/specs/2026-05-26-roadmap-predictive-audit-design.md](../specs/2026-05-26-roadmap-predictive-audit-design.md) (commit `2c104b05`).

**Depends on:** CORE plan (`2026-05-26-roadmap-predictive-core.md`) must ship first — this plan reads CORE sidecars.

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branch `deployment`).

**Implementer reminders (same as CORE plan):**
1. `upstream/` is gitignored — regen `patches/upstream-all.diff` instead of `git add upstream/...`.
2. Vitest local runtime blocked on Node 21 — validate via `node --check` + `node -e` smoke, CI runs the suite.
3. `git config user.email` must print `roblastar@live.fr`.
4. Append `## Update YYYY-MM-DD — Shipped` to the spec when done (Task 27).

**Updates to inject ad-hoc** (not in numbered sections — from the spec's 2 Update sections; same pattern as the CORE plan's Task 6.5 injection) :

- **Update 1 (`computeExpired`)** — 6th metric. Inject as **Task 6.5** between Section A and Section B. New pure fn `computeExpired(ghosts, { gracePeriodDays = 30, now })` returning `{ total, critical, expiredButRecent, list }`. Endpoint payload in Section B grows by an `expired:` field. `AuditSummary` (Task 14) test + impl gain a 6th card. New unit test `tests/unit/ghost-audit-expired.test.mjs`. Effort ~0.3 j.

- **Update 2 (`computePlacementAccuracy`)** — 7th metric. **MARKED AS DEFERABLE.** Inject as **Task 6.7** between 6.5 and Section B, but the first step is a **dependency check** : determine whether per-snapshot Leiden community lookups are available from the backend. If not reachable within ~half a day of investigation, mark BLOCKED and ship the 6-metric Audit; the placementAccuracy gets a follow-up sub-spec. Reason : `clusterPurity` is referenced in the spec but is not actually exported from `docker-server-dissonance.mjs` today, and Leiden communities are computed client-side (frontend `vendor/leiden/`). The accuracy of the +0.4 j estimate is uncertain; better to ship 6 metrics solidly than 7 shakily. Implementer should escalate after the dependency check.

---

## File Structure

```
upstream/
├── docker-server-ghost-audit-core.mjs       NEW  Pure fns (5 compute fns + parseTargetDate)
├── docker-server-ghost-audit.mjs            NEW  I/O + cache + route handler
├── docker-server.mjs                        MOD  Register /ghost-audit route

mcp-server/
├── server.mjs                               MOD  Register gitnexus_ghost_audit (19th tool)
└── smoke.mjs                                MOD  Add ghost_audit to the smoke loop

upstream/gitnexus-web/src/components/
├── AuditPanel.tsx                           NEW  Container, 2 fetches, states
└── audit/
    ├── AuditSummary.tsx                     NEW  5 cards
    ├── LeadTimeHistogram.tsx                NEW  SVG 4 buckets
    ├── SlippageBar.tsx                      NEW  Stacked bar
    ├── VelocitySparkline.tsx                NEW  SVG 26-week line
    ├── PlanChurnList.tsx                    NEW  Top 10 churners
    └── GhostTable.tsx                       NEW  Sortable detail table

tests/
├── unit/
│   ├── ghost-audit-summary.test.mjs         NEW
│   ├── ghost-audit-lead-time.test.mjs       NEW
│   ├── ghost-audit-slippage.test.mjs        NEW
│   ├── ghost-audit-churn.test.mjs           NEW
│   ├── ghost-audit-velocity.test.mjs        NEW
│   ├── ghost-audit-cache.test.mjs           NEW
│   └── components/{AuditPanel,audit/*}.test.tsx   NEW  (7 files)
├── integration/endpoints/
│   ├── ghost-audit.test.mjs                 NEW
│   └── ghost-audit-cache.test.mjs           NEW
├── integration/mcp/
│   └── ghost_audit.test.mjs                 NEW
├── e2e/specs/
│   └── audit-panel.spec.ts                  NEW
└── fixtures/make-fixture.mjs                MOD  Add commit 12 that marks a ghost ✅

ROADMAP.md                                   MOD  Add row to "Déjà livré"
INVENTORY.md                                 MOD  Document new endpoint + MCP tool
CLAUDE.md                                    MOD  Add /ghost-audit to smoke loop
tests/README.md                              MOD  List 17 new test files
docs/superpowers/specs/2026-05-26-roadmap-predictive-audit-design.md   MOD  Append Update section
patches/upstream-all.diff                    REGEN  After each upstream/ edit
```

---

## Preconditions

- [ ] **Step 0: Verify CORE is shipped**

Run: `node -e "console.log(require('fs').existsSync('upstream/docker-server-ghosts-core.mjs'))"`
Expected: `true`. If `false`, execute `docs/superpowers/plans/2026-05-26-roadmap-predictive-core.md` first.

- [ ] **Step 0b: Verify git identity**

Run: `git config user.email`
Expected: `roblastar@live.fr`. If not, `git config user.email "roblastar@live.fr"` first.

---

## Section A — Pure functions (Tasks 1-6, ~1 day)

### Task 1: computeSummary

**Files:**
- Create: `upstream/docker-server-ghost-audit-core.mjs` (initial skeleton)
- Create: `tests/unit/ghost-audit-summary.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { computeSummary } from '../../upstream/docker-server-ghost-audit-core.mjs';

const fixture = (overrides = []) => [
  { id: 'a', materializedAt: { date: '2026-01-01' }, cancelledAt: null },
  { id: 'b', materializedAt: { date: '2026-01-02' }, cancelledAt: null },
  { id: 'c', materializedAt: null, cancelledAt: null },
  { id: 'd', materializedAt: null, cancelledAt: { date: '2026-01-03' } },
  ...overrides,
];

describe('computeSummary', () => {
  it('counts ghosts by derived status', () => {
    const out = computeSummary(fixture());
    expect(out).toMatchObject({
      total: 4, materialized: 2, planned: 1, cancelled: 1, cancellationRate: 0.25,
    });
  });

  it('returns zeros for an empty array', () => {
    expect(computeSummary([])).toMatchObject({
      total: 0, materialized: 0, planned: 0, cancelled: 0, cancellationRate: 0,
    });
  });
});
```

- [ ] **Step 2: Validate test syntax**

Run: `node --check tests/unit/ghost-audit-summary.test.mjs`

- [ ] **Step 3: Create the core module with `computeSummary`**

Create `upstream/docker-server-ghost-audit-core.mjs`:
```js
/**
 * Pure functions for the roadmap-predictive Audit view.
 * No I/O. Imports from docker-server-ghosts-core.mjs only if needed.
 *
 * See docs/superpowers/specs/2026-05-26-roadmap-predictive-audit-design.md
 */

function derivedStatus(g) {
  if (g.cancelledAt) return 'cancelled';
  if (g.materializedAt) return 'materialized';
  return 'planned';
}

export function computeSummary(ghosts) {
  const counts = { total: 0, materialized: 0, planned: 0, cancelled: 0 };
  for (const g of ghosts) {
    counts.total += 1;
    counts[derivedStatus(g)] += 1;
  }
  const cancellationRate = counts.total === 0 ? 0 : counts.cancelled / counts.total;
  return { ...counts, cancellationRate };
}
```

- [ ] **Step 4: Smoke-check + commit**

Run: `node -e "import('./upstream/docker-server-ghost-audit-core.mjs').then(m => console.log(m.computeSummary([{id:'a',materializedAt:{date:'2026-01-01'},cancelledAt:null}])))"`
Expected: prints `{ total: 1, materialized: 1, planned: 0, cancelled: 0, cancellationRate: 0 }`.

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghost-audit-summary.test.mjs
git commit -m "feat(ghost-audit): computeSummary counts ghosts by status"
```

---

### Task 2: parseTargetDate

**Files:**
- Modify: `upstream/docker-server-ghost-audit-core.mjs`
- Create: `tests/unit/ghost-audit-slippage.test.mjs` (will hold both parseTargetDate and computeSlippage)

- [ ] **Step 1: Write the parseTargetDate test**

Create `tests/unit/ghost-audit-slippage.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { parseTargetDate, computeSlippage } from '../../upstream/docker-server-ghost-audit-core.mjs';

describe('parseTargetDate', () => {
  it('parses ISO datetimes', () => {
    expect(parseTargetDate('2026-09-30T12:00:00Z')).toBeInstanceOf(Date);
  });
  it('parses YYYY-QX as the last day of the quarter (UTC end of day)', () => {
    const d = parseTargetDate('2026-Q3');
    expect(d.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(parseTargetDate('2026-Q1').toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(parseTargetDate('2026-Q4').toISOString().slice(0, 10)).toBe('2026-12-31');
  });
  it('parses YYYY-MM as the last day of the month', () => {
    expect(parseTargetDate('2026-02').toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(parseTargetDate('2024-02').toISOString().slice(0, 10)).toBe('2024-02-29'); // leap
  });
  it('returns null on invalid input', () => {
    expect(parseTargetDate('not a date')).toBeNull();
    expect(parseTargetDate(null)).toBeNull();
    expect(parseTargetDate('')).toBeNull();
  });
});
```

- [ ] **Step 2: Validate syntax**

Run: `node --check tests/unit/ghost-audit-slippage.test.mjs`

- [ ] **Step 3: Append parseTargetDate to the core module**

Append to `upstream/docker-server-ghost-audit-core.mjs`:
```js
// --- Target date parsing ---

const ISO_RE = /^\d{4}-\d{2}-\d{2}/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function parseTargetDate(s) {
  if (!s || typeof s !== 'string') return null;
  const q = s.match(QUARTER_RE);
  if (q) {
    const year = Number(q[1]);
    const lastMonthOfQuarter = Number(q[2]) * 3; // 3, 6, 9, 12
    return new Date(Date.UTC(year, lastMonthOfQuarter, 0)); // day 0 of next month = last of this
  }
  const m = s.match(MONTH_RE);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  }
  if (ISO_RE.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
```

- [ ] **Step 4: Smoke + commit**

Run: `node -e "import('./upstream/docker-server-ghost-audit-core.mjs').then(m => console.log(m.parseTargetDate('2026-Q3').toISOString(), m.parseTargetDate('2026-02').toISOString(), m.parseTargetDate('bad')))"`
Expected: prints `2026-09-30T00:00:00.000Z 2026-02-28T00:00:00.000Z null`.

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghost-audit-slippage.test.mjs
git commit -m "feat(ghost-audit): parseTargetDate (ISO, YYYY-QX, YYYY-MM)"
```

---

### Task 3: computeSlippage

**Files:**
- Modify: `upstream/docker-server-ghost-audit-core.mjs`
- Modify: `tests/unit/ghost-audit-slippage.test.mjs`

- [ ] **Step 1: Append the computeSlippage tests**

```js
describe('computeSlippage', () => {
  const ghost = (id, plannedFor, matDate) => ({
    id,
    declared: { plannedFor },
    materializedAt: matDate ? { date: matDate } : null,
  });

  it('classifies ghosts into 4 buckets', () => {
    const out = computeSlippage([
      ghost('a', '2026-06-30', '2026-06-15'), // early (15d before)
      ghost('b', '2026-06-30', '2026-06-30'), // on time
      ghost('c', '2026-06-30', '2026-07-15'), // late
      ghost('d', null,         '2026-06-30'), // no target
    ]);
    expect(out).toMatchObject({ early: 1, onTime: 1, late: 1, noTarget: 1 });
  });

  it('excludes noTarget from onTimePct', () => {
    const out = computeSlippage([
      ghost('a', '2026-06-30', '2026-06-15'),
      ghost('b', '2026-06-30', '2026-06-30'),
      ghost('c', null,         '2026-06-30'),
    ]);
    // early=1, onTime=1, late=0, total non-null = 2, onTimePct = 1/2
    expect(out.onTimePct).toBeCloseTo(0.5, 6);
  });

  it('returns 0/0 when no materialized ghosts', () => {
    const out = computeSlippage([{ id: 'x', materializedAt: null, declared: {} }]);
    expect(out).toMatchObject({ early: 0, onTime: 0, late: 0, noTarget: 0 });
    expect(out.onTimePct).toBeNull();
  });

  it('treats bucket-granularity targets as on-time anywhere within the bucket', () => {
    // plannedFor = "2026-Q3" → bucket ends 2026-09-30 ; matDate 2026-08-15 is well before
    // but still "in the bucket" if we relax bucket semantics. The spec says:
    // for Q/M granularity, anywhere within the bucket = onTime.
    const out = computeSlippage([
      ghost('a', '2026-Q3', '2026-08-15'), // within Q3 → onTime
      ghost('b', '2026-Q3', '2026-10-15'), // after Q3 end → late
      ghost('c', '2026-Q3', '2026-06-30'), // before Q3 start → early
    ]);
    expect(out).toMatchObject({ early: 1, onTime: 1, late: 1 });
  });
});
```

- [ ] **Step 2: Validate syntax**

Run: `node --check tests/unit/ghost-audit-slippage.test.mjs`

- [ ] **Step 3: Append computeSlippage to the core module**

```js
// --- Slippage ---

function bucketStart(s) {
  const q = s?.match?.(QUARTER_RE);
  if (q) {
    const year = Number(q[1]);
    const firstMonthOfQuarter = (Number(q[2]) - 1) * 3; // 0, 3, 6, 9
    return new Date(Date.UTC(year, firstMonthOfQuarter, 1));
  }
  const m = s?.match?.(MONTH_RE);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  }
  return null; // for ISO, start === end
}

export function computeSlippage(ghosts) {
  const out = { early: 0, onTime: 0, late: 0, noTarget: 0, onTimePct: null };
  for (const g of ghosts) {
    if (!g.materializedAt) continue;
    const target = parseTargetDate(g.declared?.plannedFor);
    if (!target) { out.noTarget += 1; continue; }
    const matDate = new Date(g.materializedAt.date);
    const start = bucketStart(g.declared.plannedFor) ?? target;
    if (matDate < start) out.early += 1;
    else if (matDate <= target) out.onTime += 1;
    else out.late += 1;
  }
  const denom = out.early + out.onTime + out.late;
  out.onTimePct = denom === 0 ? null : out.onTime / denom;
  return out;
}
```

- [ ] **Step 4: Smoke + commit**

Run: `node -e "import('./upstream/docker-server-ghost-audit-core.mjs').then(m => console.log(m.computeSlippage([{id:'a',declared:{plannedFor:'2026-Q3'},materializedAt:{date:'2026-08-15'}}])))"`
Expected: `{ early: 0, onTime: 1, late: 0, noTarget: 0, onTimePct: 1 }`.

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghost-audit-slippage.test.mjs
git commit -m "feat(ghost-audit): computeSlippage with bucket-aware tolerance"
```

---

### Task 4: computeLeadTime

**Files:**
- Modify: `upstream/docker-server-ghost-audit-core.mjs`
- Create: `tests/unit/ghost-audit-lead-time.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { computeLeadTime } from '../../upstream/docker-server-ghost-audit-core.mjs';

const ghost = (planned, mat) => ({
  plannedAt: { date: planned },
  materializedAt: mat ? { date: mat } : null,
});

describe('computeLeadTime', () => {
  it('computes median + percentiles from materialized ghosts', () => {
    // lead times: 1, 2, 3, 5, 10 days → median=3, p25=2, p75=5, max=10
    const ghosts = [
      ghost('2026-01-01', '2026-01-02'),
      ghost('2026-01-01', '2026-01-03'),
      ghost('2026-01-01', '2026-01-04'),
      ghost('2026-01-01', '2026-01-06'),
      ghost('2026-01-01', '2026-01-11'),
    ];
    const out = computeLeadTime(ghosts);
    expect(out.medianDays).toBeCloseTo(3, 1);
    expect(out.p25Days).toBeCloseTo(2, 1);
    expect(out.p75Days).toBeCloseTo(5, 1);
    expect(out.maxDays).toBeCloseTo(10, 1);
  });

  it('buckets into 4 ranges', () => {
    const ghosts = [
      ghost('2026-01-01', '2026-01-03'),   // 2 d  → 0-7d
      ghost('2026-01-01', '2026-01-10'),   // 9 d  → 7-14d
      ghost('2026-01-01', '2026-01-25'),   // 24 d → 14-30d
      ghost('2026-01-01', '2026-02-15'),   // 45 d → 30d+
    ];
    const dist = computeLeadTime(ghosts).distribution;
    expect(dist.find(b => b.bucket === '0-7d').count).toBe(1);
    expect(dist.find(b => b.bucket === '7-14d').count).toBe(1);
    expect(dist.find(b => b.bucket === '14-30d').count).toBe(1);
    expect(dist.find(b => b.bucket === '30d+').count).toBe(1);
  });

  it('returns empty distribution when no materialized ghosts', () => {
    const out = computeLeadTime([ghost('2026-01-01', null)]);
    expect(out.medianDays).toBeNull();
    expect(out.distribution).toEqual([]);
  });
});
```

- [ ] **Step 2: Validate syntax + impl**

Run: `node --check tests/unit/ghost-audit-lead-time.test.mjs`

Append to `upstream/docker-server-ghost-audit-core.mjs`:
```js
// --- Lead time ---

const DAY = 86_400_000;

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

export function computeLeadTime(ghosts) {
  const leadTimes = [];
  for (const g of ghosts) {
    if (!g.materializedAt || !g.plannedAt) continue;
    const dt = (new Date(g.materializedAt.date) - new Date(g.plannedAt.date)) / DAY;
    if (dt >= 0) leadTimes.push(dt);
  }
  if (leadTimes.length === 0) {
    return { medianDays: null, p25Days: null, p75Days: null, maxDays: null, distribution: [] };
  }
  leadTimes.sort((a, b) => a - b);
  const dist = [
    { bucket: '0-7d',   count: 0 },
    { bucket: '7-14d',  count: 0 },
    { bucket: '14-30d', count: 0 },
    { bucket: '30d+',   count: 0 },
  ];
  for (const lt of leadTimes) {
    if (lt < 7) dist[0].count += 1;
    else if (lt < 14) dist[1].count += 1;
    else if (lt < 30) dist[2].count += 1;
    else dist[3].count += 1;
  }
  return {
    medianDays: percentile(leadTimes, 0.5),
    p25Days: percentile(leadTimes, 0.25),
    p75Days: percentile(leadTimes, 0.75),
    maxDays: leadTimes[leadTimes.length - 1],
    distribution: dist,
  };
}
```

- [ ] **Step 3: Smoke + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghost-audit-lead-time.test.mjs
git commit -m "feat(ghost-audit): computeLeadTime with percentiles + buckets"
```

---

### Task 5: computePlanChurn

**Files:**
- Modify: `upstream/docker-server-ghost-audit-core.mjs`
- Create: `tests/unit/ghost-audit-churn.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { computePlanChurn } from '../../upstream/docker-server-ghost-audit-core.mjs';

const snap = (sha, date, ghosts) => ({ sha, date, ghosts });
const g = (id, description, links) => ({
  id,
  declared: { description, expectedLinks: links.map(v => ({ kind: 'path', value: v })) },
});

describe('computePlanChurn', () => {
  it('counts description changes across snapshots', () => {
    const snapshots = [
      snap('s1', '2026-01-01', [g('a', 'first version', ['x.mjs'])]),
      snap('s2', '2026-01-02', [g('a', 'second version', ['x.mjs'])]),
      snap('s3', '2026-01-03', [g('a', 'third version', ['x.mjs'])]),
    ];
    const out = computePlanChurn(snapshots);
    expect(out.totalGhostsWithChurn).toBe(1);
    expect(out.topChurners[0]).toMatchObject({ id: 'a', churn: 2 });
  });

  it('counts expectedLinks changes', () => {
    const snapshots = [
      snap('s1', '2026-01-01', [g('a', 'same', ['x.mjs'])]),
      snap('s2', '2026-01-02', [g('a', 'same', ['x.mjs', 'y.mjs'])]),
    ];
    const out = computePlanChurn(snapshots);
    expect(out.topChurners[0].churn).toBe(1);
    expect(out.topChurners[0].deltas).toContain('expectedLinks');
  });

  it('ignores newly-added ghosts (not churn)', () => {
    const snapshots = [
      snap('s1', '2026-01-01', [g('a', 'x', ['x.mjs'])]),
      snap('s2', '2026-01-02', [g('a', 'x', ['x.mjs']), g('b', 'new', ['y.mjs'])]),
    ];
    expect(computePlanChurn(snapshots).totalGhostsWithChurn).toBe(0);
  });

  it('sorts topChurners DESC and caps at 10', () => {
    const snapshots = [snap('s1', '2026-01-01', []), snap('s2', '2026-01-02', [])];
    // Generate 15 ghosts with varying churn
    for (let i = 0; i < 15; i++) {
      snapshots[0].ghosts.push(g(`g${i}`, 'a', ['x.mjs']));
      snapshots[1].ghosts.push(g(`g${i}`, `b${i % 4}`, ['x.mjs'])); // some unchanged, some changed
    }
    const out = computePlanChurn(snapshots);
    expect(out.topChurners.length).toBeLessThanOrEqual(10);
  });

  it('returns zeros for ≤1 snapshot', () => {
    expect(computePlanChurn([])).toMatchObject({ totalGhostsWithChurn: 0, avgChurnPerGhost: 0, topChurners: [] });
    expect(computePlanChurn([snap('s1', '2026-01-01', [g('a', 'x', ['x.mjs'])])])).toMatchObject({ totalGhostsWithChurn: 0 });
  });
});
```

- [ ] **Step 2: Validate + impl**

```js
// --- Plan churn ---

function sameLinks(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].kind !== b[i].kind || a[i].value !== b[i].value) return false;
  }
  return true;
}

export function computePlanChurn(snapshots) {
  const empty = { totalGhostsWithChurn: 0, avgChurnPerGhost: 0, topChurners: [] };
  if (!Array.isArray(snapshots) || snapshots.length < 2) return empty;

  // Sort by date ASC so consecutive comparison is chronological.
  const sorted = [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date));
  const churnById = new Map();

  for (let i = 1; i < sorted.length; i++) {
    const prevById = new Map(sorted[i - 1].ghosts.map(g => [g.id, g]));
    for (const curr of sorted[i].ghosts) {
      const prev = prevById.get(curr.id);
      if (!prev) continue;
      const deltas = [];
      if (prev.declared.description !== curr.declared.description) deltas.push('description');
      if (!sameLinks(prev.declared.expectedLinks ?? [], curr.declared.expectedLinks ?? [])) deltas.push('expectedLinks');
      if (deltas.length > 0) {
        const entry = churnById.get(curr.id) ?? { churn: 0, deltas: [] };
        entry.churn += 1;
        entry.deltas.push(...deltas);
        churnById.set(curr.id, entry);
      }
    }
  }

  const all = [...churnById.entries()].map(([id, x]) => ({ id, ...x }));
  const topChurners = all.sort((a, b) => b.churn - a.churn).slice(0, 10);
  const totalChurn = all.reduce((sum, x) => sum + x.churn, 0);
  return {
    totalGhostsWithChurn: all.length,
    avgChurnPerGhost: all.length === 0 ? 0 : totalChurn / all.length,
    topChurners,
  };
}
```

- [ ] **Step 3: Smoke + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghost-audit-churn.test.mjs
git commit -m "feat(ghost-audit): computePlanChurn cross-snapshot delta detection"
```

---

### Task 6: computeVelocity

**Files:**
- Modify: `upstream/docker-server-ghost-audit-core.mjs`
- Create: `tests/unit/ghost-audit-velocity.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { computeVelocity } from '../../upstream/docker-server-ghost-audit-core.mjs';

const matGhost = (date) => ({ materializedAt: { date } });

describe('computeVelocity', () => {
  it('counts ghosts materialized within the window', () => {
    const now = new Date('2026-05-26T00:00:00Z');
    const out = computeVelocity([
      matGhost('2026-05-20'),  // 6 days ago → in 28d window
      matGhost('2026-05-01'),  // 25 days ago → in 28d window
      matGhost('2026-04-20'),  // 36 days ago → NOT in 28d window
      matGhost('2026-05-25'),  // 1 day ago → in 28d window
    ], { windowDays: 28, now });
    expect(out.currentCount).toBe(3);
    expect(out.windowDays).toBe(28);
  });

  it('builds weekly history (last 26 weeks)', () => {
    const now = new Date('2026-05-26T00:00:00Z');
    const out = computeVelocity([
      matGhost('2026-05-20'),
      matGhost('2026-05-21'),
      matGhost('2026-05-10'),
    ], { windowDays: 28, now });
    expect(out.history.length).toBeLessThanOrEqual(26);
    expect(out.history.every(h => 'weekStarting' in h && 'count' in h)).toBe(true);
    // Sorted ASC by date
    const dates = out.history.map(h => h.weekStarting);
    expect([...dates].sort()).toEqual(dates);
  });

  it('returns zeros when no materialized ghosts', () => {
    const out = computeVelocity([{ materializedAt: null }], { now: new Date('2026-05-26') });
    expect(out.currentCount).toBe(0);
    expect(out.history.length).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Validate + impl**

```js
// --- Velocity ---

function isoWeekStart(date) {
  const d = new Date(date);
  const day = d.getUTCDay() || 7; // Monday=1, Sunday=7
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function computeVelocity(ghosts, opts = {}) {
  const windowDays = opts.windowDays ?? 28;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - windowDays * DAY);

  let currentCount = 0;
  const weekly = new Map();

  for (const g of ghosts) {
    if (!g.materializedAt) continue;
    const matDate = new Date(g.materializedAt.date);
    if (isNaN(matDate.getTime())) continue;
    if (matDate >= cutoff && matDate <= now) currentCount += 1;
    const wk = isoWeekStart(matDate);
    weekly.set(wk, (weekly.get(wk) ?? 0) + 1);
  }

  const allWeeks = [...weekly.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const history = allWeeks.slice(-26).map(([weekStarting, count]) => ({ weekStarting, count }));

  return { windowDays, currentCount, history };
}
```

- [ ] **Step 3: Smoke + commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghost-audit-velocity.test.mjs
git commit -m "feat(ghost-audit): computeVelocity rolling window + 26w history"
```

---

## Section B — I/O wrapper + cache + endpoint (Tasks 7-10, ~0.5 day)

### Task 7: docker-server-ghost-audit.mjs — load CORE sidecars

**Files:**
- Create: `upstream/docker-server-ghost-audit.mjs`

- [ ] **Step 1: Create the I/O wrapper skeleton**

```js
/**
 * I/O wrapper for the roadmap-predictive Audit view.
 * Reads CORE sidecars (.gitnexus/ghosts.json and snapshots/*/ghosts.json),
 * computes metrics via pure fns, optionally caches.
 *
 * See docs/superpowers/specs/2026-05-26-roadmap-predictive-audit-design.md
 */
import { readFile, writeFile, stat, readdir, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  computeSummary, computeLeadTime, computeSlippage,
  computePlanChurn, computeVelocity,
} from './docker-server-ghost-audit-core.mjs';

async function fileExists(p) { try { await access(p); return true; } catch { return false; } }

async function readJsonOrNull(p) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}

async function loadLatestGhosts(repoPath) {
  return readJsonOrNull(join(repoPath, '.gitnexus', 'ghosts.json'));
}

async function loadAllSnapshots(repoPath) {
  const snapshotsDir = join(repoPath, '.gitnexus', 'snapshots');
  if (!(await fileExists(snapshotsDir))) return [];
  const entries = await readdir(snapshotsDir);
  const out = [];
  for (const sha of entries) {
    const ghostsPath = join(snapshotsDir, sha, 'ghosts.json');
    if (!(await fileExists(ghostsPath))) continue;
    const data = await readJsonOrNull(ghostsPath);
    if (data) out.push({ sha, date: data.syncedAt ?? null, ghosts: data.ghosts ?? [] });
  }
  return out;
}

export async function buildAudit(repoPath, opts = {}) {
  const latest = await loadLatestGhosts(repoPath);
  if (!latest) return null; // signals 404 to the route handler
  const ghosts = latest.ghosts ?? [];
  const snapshots = await loadAllSnapshots(repoPath);
  return {
    computedAt: new Date().toISOString(),
    cached: false,
    summary: computeSummary(ghosts),
    leadTime: computeLeadTime(ghosts),
    slippage: computeSlippage(ghosts),
    planChurn: computePlanChurn(snapshots),
    velocity: computeVelocity(ghosts, { windowDays: opts.windowDays ?? 28 }),
  };
}
```

- [ ] **Step 2: Smoke**

Run: `node -e "import('./upstream/docker-server-ghost-audit.mjs').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'buildAudit' ]`.

- [ ] **Step 3: Commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(ghost-audit): I/O wrapper buildAudit (reads CORE sidecars)"
```

---

### Task 8: isCacheValid + caching logic

**Files:**
- Modify: `upstream/docker-server-ghost-audit.mjs`
- Create: `tests/unit/ghost-audit-cache.test.mjs`

- [ ] **Step 1: Write the cache test (Note: tests fs.stat — use a tmp dir)**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCacheValid } from '../../upstream/docker-server-ghost-audit.mjs';

describe('isCacheValid', () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'audit-cache-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('returns false when cache does not exist', async () => {
    expect(await isCacheValid(join(dir, 'cache.json'), dir)).toBe(false);
  });

  it('returns true when cache is newer than all CORE sidecars', async () => {
    await mkdir(join(dir, '.gitnexus'), { recursive: true });
    await writeFile(join(dir, '.gitnexus', 'ghosts.json'), '{}');
    await new Promise(r => setTimeout(r, 10));
    await writeFile(join(dir, '.gitnexus', 'cache.json'), '{}');
    expect(await isCacheValid(join(dir, '.gitnexus', 'cache.json'), dir)).toBe(true);
  });

  it('returns false when a snapshot ghosts.json is newer than cache', async () => {
    await mkdir(join(dir, '.gitnexus', 'snapshots', 's1'), { recursive: true });
    await writeFile(join(dir, '.gitnexus', 'ghosts.json'), '{}');
    await writeFile(join(dir, '.gitnexus', 'cache.json'), '{}');
    await new Promise(r => setTimeout(r, 10));
    await writeFile(join(dir, '.gitnexus', 'snapshots', 's1', 'ghosts.json'), '{}');
    expect(await isCacheValid(join(dir, '.gitnexus', 'cache.json'), dir)).toBe(false);
  });
});
```

- [ ] **Step 2: Append isCacheValid + computeAudit-with-cache**

Append to `upstream/docker-server-ghost-audit.mjs`:
```js
// --- Cache invalidation ---

export async function isCacheValid(cachePath, repoPath) {
  const cs = await stat(cachePath).catch(() => null);
  if (!cs) return false;
  const cacheMtime = cs.mtime.getTime();
  const latest = await stat(join(repoPath, '.gitnexus', 'ghosts.json')).catch(() => null);
  if (latest && latest.mtime.getTime() > cacheMtime) return false;
  const snapshotsDir = join(repoPath, '.gitnexus', 'snapshots');
  if (await fileExists(snapshotsDir)) {
    const entries = await readdir(snapshotsDir);
    for (const sha of entries) {
      const p = join(snapshotsDir, sha, 'ghosts.json');
      const s = await stat(p).catch(() => null);
      if (s && s.mtime.getTime() > cacheMtime) return false;
    }
  }
  return true;
}

export async function computeAudit(repoPath, opts = {}) {
  const cachePath = join(repoPath, '.gitnexus', 'ghost-audit-cache.json');
  if (await isCacheValid(cachePath, repoPath)) {
    const cached = await readJsonOrNull(cachePath);
    if (cached) return { ...cached, cached: true };
  }
  const fresh = await buildAudit(repoPath, opts);
  if (fresh === null) return null;
  await mkdir(join(repoPath, '.gitnexus'), { recursive: true });
  await writeFile(cachePath, JSON.stringify(fresh, null, 2) + '\n');
  return { ...fresh, cached: false };
}
```

- [ ] **Step 3: Smoke + commit**

```bash
node --check upstream/docker-server-ghost-audit.mjs
node --check tests/unit/ghost-audit-cache.test.mjs
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/ghost-audit-cache.test.mjs
git commit -m "feat(ghost-audit): mtime-based cache invalidation + computeAudit"
```

---

### Task 9: HTTP route handler

**Files:**
- Modify: `upstream/docker-server-ghost-audit.mjs`

- [ ] **Step 1: Append the route handler**

```js
// --- HTTP route handler ---
// Pattern : resolves repo from ?repo (same shape as other endpoints — uses
// resolveRepoPath if exported, else copy from docker-server-snapshots.mjs).
import { resolveRepoPath } from './docker-server.mjs'; // adapt if not exported

export async function handleGhostAudit(req, res) {
  try {
    const repoPath = await resolveRepoPath(req.query.repo);
    if (!repoPath) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Missing or invalid ?repo' }));
    }
    const windowDays = req.query.windowDays ? Number(req.query.windowDays) : undefined;
    const audit = await computeAudit(repoPath, { windowDays });
    res.setHeader('Content-Type', 'application/json');
    if (!audit) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: 'Run POST /ghosts/sync first.' }));
    }
    res.statusCode = 200;
    res.end(JSON.stringify(audit));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
```

- [ ] **Step 2: Smoke + commit**

```bash
node --check upstream/docker-server-ghost-audit.mjs
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(ghost-audit): handleGhostAudit HTTP route handler"
```

---

### Task 10: Register /ghost-audit in docker-server.mjs

**Files:**
- Modify: `upstream/docker-server.mjs`

- [ ] **Step 1: Add route registration**

Edit `upstream/docker-server.mjs`. Follow the existing pattern from the CORE plan Task 8 (Pattern A or B depending on what's there).

```js
import { handleGhostAudit } from './docker-server-ghost-audit.mjs';
// ...
app.get('/ghost-audit', handleGhostAudit);
// OR
if (req.method === 'GET' && pathname === '/ghost-audit') return handleGhostAudit(req, res);
```

- [ ] **Step 2: Smoke + commit**

```bash
node --check upstream/docker-server.mjs
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(ghost-audit): register GET /ghost-audit route"
```

---

## Section C — MCP tool (Task 11, ~0.5 day)

> The MCP sidecar at `mcp-server/server.mjs` (NOT `upstream/`) is a tracked file —
> edit and `git add mcp-server/server.mjs` directly. It's a single-file Node ES module
> using a JSON-schema-based `{ name, description, inputSchema, handler }` tool registry
> and a `callWeb(path, query)` helper. There is no Zod, no TypeScript, no separate
> per-tool files. Pattern reference : the 18 existing tools in the same file.

### Task 11: Register `gitnexus_ghost_audit` as the 19th MCP tool

**Files:**
- Modify: `mcp-server/server.mjs` — add tool entry to the tools array + summary-formatting helper
- Modify: `mcp-server/smoke.mjs` — exercise the new tool against the live stack

- [ ] **Step 1: Inspect the tool-array pattern in `server.mjs`**

Run :
```
node -e "const c = require('fs').readFileSync('mcp-server/server.mjs','utf8'); const i = c.indexOf('gitnexus_entropy_commits'); console.log(c.slice(Math.max(0,i-200), i+800))"
```
Note the shape : each entry has `name`, `description`, `inputSchema` (JSON Schema, NOT Zod), and `handler: ({ repo, ... }) => callWeb('/path', { repo, ... })`. The tool array is iterated by `tools/list`; `tools/call` dispatches by `name` to the matching `handler`.

- [ ] **Step 2: Add `gitnexus_ghost_audit` to the tool array**

Find the last `,` before the closing `]` of the tools array. Insert :

```js
  {
    name: 'gitnexus_ghost_audit',
    description: 'Roadmap audit metrics (lead time, slippage vs plannedFor, cancellation rate, plan churn, 28-day velocity, expired ghosts past their expectedBy + grace_period). Reads CORE sidecars (.gitnexus/ghosts.json + .gitnexus/snapshots/*/ghosts.json) and caches the result on disk (mtime-invalidated). Use after gitnexus_ghosts_sync; returns 404-equivalent text if no ghosts have been synced yet.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Base repo name as known by gitnexus.' },
        windowDays: { type: 'number', minimum: 7, maximum: 365, default: 28, description: 'Velocity window in days. Default 28.' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    handler: async ({ repo, windowDays }) => {
      const params = { repo };
      if (windowDays !== undefined) params.windowDays = windowDays;
      const audit = await callWeb('/ghost-audit', params);
      // Surface a human-readable summary plus the raw JSON for drill-down.
      // Keep the summary tight so Claude can quote it verbatim without
      // burning tokens.
      const s = formatGhostAuditSummary(audit);
      return { ok: true, summary: s, audit };
    },
  },
```

- [ ] **Step 3: Add the `formatGhostAuditSummary` helper**

Just below the tools-array constant, add :

```js
function formatGhostAuditSummary(audit) {
  if (!audit || audit.error) return audit?.error || 'no audit available';
  const s = audit.summary || {};
  const lt = audit.leadTime || {};
  const sl = audit.slippage || {};
  const pc = audit.planChurn || {};
  const v = audit.velocity || {};
  const x = audit.expired || { total: 0 };
  const pct = (n) => (typeof n === 'number' ? `${(n * 100).toFixed(1)}%` : '—');
  const day = (n) => (typeof n === 'number' ? `${n.toFixed(1)}d` : '—');
  return [
    `Roadmap audit (${audit.cached ? 'cached' : 'fresh'}, computed ${audit.computedAt}):`,
    `  Summary: ${s.total ?? '?'} ghosts → ${s.materialized ?? '?'} shipped, ${s.planned ?? '?'} pending, ${s.cancelled ?? '?'} cancelled (cancellation rate ${pct(s.cancellationRate)}).`,
    `  Lead time: median ${day(lt.medianDays)} (p25=${day(lt.p25Days)}, p75=${day(lt.p75Days)}).`,
    `  Slippage: ${sl.onTimePct !== null && sl.onTimePct !== undefined ? `${pct(sl.onTimePct)} on time` : 'no targets'} (${sl.early ?? 0} early / ${sl.onTime ?? 0} on time / ${sl.late ?? 0} late / ${sl.noTarget ?? 0} untargeted).`,
    `  Plan churn: ${pc.totalGhostsWithChurn ?? 0} ghosts revisited (avg ${(pc.avgChurnPerGhost ?? 0).toFixed(1)}/ghost).`,
    `  Velocity (${v.windowDays ?? 28}d): ${v.currentCount ?? 0} materializations.`,
    `  Expired: ${x.total ?? 0}${x.critical ? ` (${x.critical} critical)` : ''}.`,
  ].join('\n');
}
```

- [ ] **Step 4: Validate syntax**

Run: `node --check mcp-server/server.mjs`
Expected : exit 0.

- [ ] **Step 5: Extend the smoke harness**

Open `mcp-server/smoke.mjs` and find the block that iterates over a list of `tools/call` requests (one per tool). Add a request for `gitnexus_ghost_audit` :

```js
{ name: 'gitnexus_ghost_audit', arguments: { repo: SMOKE_REPO } },
```

where `SMOKE_REPO` is whatever existing constant the file uses (usually `'hmm_studio'`).

- [ ] **Step 6: Validate the smoke file**

Run: `node --check mcp-server/smoke.mjs`
Expected : exit 0.

- [ ] **Step 7: Commit**

```bash
git add mcp-server/server.mjs mcp-server/smoke.mjs
git commit -m "feat(ghost-audit): gitnexus_ghost_audit MCP tool (19th tool) + smoke"
```

---

## Section D — Frontend (Tasks 13-19, ~1.5 days)

### Task 13: AuditPanel.tsx container

**Files:**
- Create: `upstream/gitnexus-web/src/components/AuditPanel.tsx`
- Create: `tests/unit/components/AuditPanel.test.tsx`

- [ ] **Step 1: Write the component test (renders 3 states)**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AuditPanel from '../../../upstream/gitnexus-web/src/components/AuditPanel';

describe('AuditPanel', () => {
  it('renders the loading skeleton initially', () => {
    global.fetch = vi.fn(() => new Promise(() => {})); // never resolves
    render(<AuditPanel repo="sample-repo" />);
    expect(screen.getByText(/loading audit/i)).toBeInTheDocument();
  });

  it('renders error banner on 404', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'not synced' }) } as any));
    render(<AuditPanel repo="sample-repo" />);
    await waitFor(() => expect(screen.getByText(/run sync/i)).toBeInTheDocument());
  });

  it('renders summary + sub-components after successful fetch', async () => {
    const audit = {
      computedAt: '2026-05-26T00:00:00Z', cached: false,
      summary: { total: 5, materialized: 3, planned: 1, cancelled: 1, cancellationRate: 0.2 },
      leadTime: { medianDays: 5, p25Days: 3, p75Days: 8, maxDays: 10, distribution: [] },
      slippage: { early: 1, onTime: 1, late: 1, noTarget: 0, onTimePct: 0.33 },
      planChurn: { totalGhostsWithChurn: 0, avgChurnPerGhost: 0, topChurners: [] },
      velocity: { windowDays: 28, currentCount: 2, history: [] },
    };
    const ghosts = { ghosts: [] };
    global.fetch = vi.fn((url) =>
      Promise.resolve({ ok: true, json: async () => (url.includes('audit') ? audit : ghosts) } as any),
    );
    render(<AuditPanel repo="sample-repo" />);
    await waitFor(() => expect(screen.getByText(/5 ghosts/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Implement the container**

Create `upstream/gitnexus-web/src/components/AuditPanel.tsx`:
```tsx
import { useEffect, useState } from 'react';
import AuditSummary from './audit/AuditSummary';
import LeadTimeHistogram from './audit/LeadTimeHistogram';
import SlippageBar from './audit/SlippageBar';
import VelocitySparkline from './audit/VelocitySparkline';
import PlanChurnList from './audit/PlanChurnList';
import GhostTable from './audit/GhostTable';

export interface AuditData {
  computedAt: string; cached: boolean;
  summary: { total: number; materialized: number; planned: number; cancelled: number; cancellationRate: number };
  leadTime: { medianDays: number | null; p25Days: number | null; p75Days: number | null; maxDays: number | null; distribution: { bucket: string; count: number }[] };
  slippage: { early: number; onTime: number; late: number; noTarget: number; onTimePct: number | null };
  planChurn: { totalGhostsWithChurn: number; avgChurnPerGhost: number; topChurners: { id: string; churn: number; deltas: string[] }[] };
  velocity: { windowDays: number; currentCount: number; history: { weekStarting: string; count: number }[] };
}

export default function AuditPanel({ repo, onGhostSelect }: { repo: string; onGhostSelect?: (id: string) => void }) {
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [ghosts, setGhosts] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  async function loadAll() {
    setError(null);
    const [auditRes, ghostsRes] = await Promise.all([
      fetch(`/ghost-audit?repo=${encodeURIComponent(repo)}`),
      fetch(`/ghosts?repo=${encodeURIComponent(repo)}`),
    ]);
    if (auditRes.status === 404 || ghostsRes.status === 404) {
      setError('not-synced');
      return;
    }
    if (!auditRes.ok || !ghostsRes.ok) {
      setError('Failed to load audit data');
      return;
    }
    setAudit(await auditRes.json());
    setGhosts((await ghostsRes.json()).ghosts ?? []);
  }

  useEffect(() => { loadAll(); }, [repo]);

  async function handleSync() {
    await fetch(`/ghosts/sync?repo=${encodeURIComponent(repo)}`, { method: 'POST' });
    await loadAll();
  }

  if (error === 'not-synced') {
    return (
      <div className="audit-panel" data-testid="audit-panel">
        <p>Roadmap not synced yet.</p>
        <button onClick={handleSync}>Run sync now</button>
      </div>
    );
  }
  if (error) return <div className="audit-panel"><p>Error: {error}</p></div>;
  if (!audit || !ghosts) return <div className="audit-panel">Loading audit…</div>;

  return (
    <div className="audit-panel" data-testid="audit-panel">
      <header>
        <h3>Audit roadmap</h3>
        {audit.cached && <span className="badge" title={`Computed at ${audit.computedAt}`}>cached</span>}
      </header>
      <AuditSummary data={audit.summary} />
      <SlippageBar data={audit.slippage} />
      <LeadTimeHistogram data={audit.leadTime} />
      <VelocitySparkline data={audit.velocity} />
      <PlanChurnList
        topChurners={audit.planChurn.topChurners}
        onSelectChurner={(id) => setHighlightedId(id)}
      />
      <GhostTable
        ghosts={ghosts}
        highlightedId={highlightedId}
        onGhostSelect={(id) => { setHighlightedId(id); onGhostSelect?.(id); }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Smoke + commit**

```bash
node --check tests/unit/components/AuditPanel.test.tsx 2>&1 || echo "(TSX check skipped — vitest will compile)"
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/AuditPanel.test.tsx
git commit -m "feat(ghost-audit): AuditPanel.tsx container with 3 states"
```

---

### Task 14: audit/AuditSummary.tsx

**Files:**
- Create: `upstream/gitnexus-web/src/components/audit/AuditSummary.tsx`
- Create: `tests/unit/components/audit/AuditSummary.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuditSummary from '../../../../upstream/gitnexus-web/src/components/audit/AuditSummary';

describe('AuditSummary', () => {
  it('renders 5 stats', () => {
    render(<AuditSummary data={{ total: 27, materialized: 24, planned: 2, cancelled: 1, cancellationRate: 0.037 }} />);
    expect(screen.getByText('27')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText(/3.7%|3\.7\s?%/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
type Props = { data: { total: number; materialized: number; planned: number; cancelled: number; cancellationRate: number } };

export default function AuditSummary({ data }: Props) {
  return (
    <div className="audit-summary" data-testid="audit-summary">
      <div className="stat"><div className="value">{data.total}</div><div className="label">Total</div></div>
      <div className="stat status-mat"><div className="value">{data.materialized}</div><div className="label">Materialized</div></div>
      <div className="stat status-planned"><div className="value">{data.planned}</div><div className="label">Planned</div></div>
      <div className="stat status-cancelled"><div className="value">{data.cancelled}</div><div className="label">Cancelled</div></div>
      <div className="stat"><div className="value">{(data.cancellationRate * 100).toFixed(1)}%</div><div className="label">Cancel rate</div></div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/audit/AuditSummary.test.tsx
git commit -m "feat(ghost-audit): AuditSummary 5 cards"
```

---

### Tasks 15-19: Remaining sub-components

Tasks 15-19 follow the **same pattern** as Task 14 : write a small test asserting the visible elements + a small implementation. Each is one file under `audit/` + its corresponding test file.

For each task : write the test (5-15 lines), implement the component (20-60 lines), commit. Same `cd upstream && regen patch && git add … && commit` flow.

- [ ] **Task 15: `audit/LeadTimeHistogram.tsx`** — SVG 4 bars, pattern `GrowthChart.tsx`. Hide if `distribution.length === 0`. Test: render bars + labels.
- [ ] **Task 16: `audit/SlippageBar.tsx`** — Stacked horizontal bar with 4 segments (early/onTime/late/noTarget), widths proportional to counts. Test: 4 segments + onTimePct displayed.
- [ ] **Task 17: `audit/VelocitySparkline.tsx`** — SVG line over `history`, big number for `currentCount`. Test: `currentCount` text + at least 1 svg path.
- [ ] **Task 18: `audit/PlanChurnList.tsx`** — Top 10 list ; each row clickable, calls `onSelectChurner(id)`. Test: render + click → mock called.
- [ ] **Task 19: `audit/GhostTable.tsx`** — Sortable table : Tier / Title / Status / Lead time / Slippage / Churn count. Filters by tier (dropdown) + status (toggle). Click row → `onGhostSelect(id)`. Highlights row when `highlightedId === ghost.id`. Test: render + sort by column + filter by status.

Each task ends with `regen patch + git add + commit "feat(ghost-audit): <ComponentName>"`.

---

## Section E — Integration + e2e tests (Tasks 20-22, ~1 day)

### Task 20: ghost-audit.test.mjs (integration — endpoint shape)

**Files:**
- Create: `tests/integration/endpoints/ghost-audit.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /ghost-audit', () => {
  it('returns 404 before sync', async () => {
    const res = await fetch(`${BASE}/ghost-audit?repo=__never-synced__`);
    expect([404, 400]).toContain(res.status);
  });

  it('returns the full audit shape after sync', async () => {
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const res = await fetch(`${BASE}/ghost-audit?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const audit = await res.json();
    expect(audit).toMatchObject({
      computedAt: expect.any(String),
      cached: expect.any(Boolean),
      summary: expect.any(Object),
      leadTime: expect.any(Object),
      slippage: expect.any(Object),
      planChurn: expect.any(Object),
      velocity: expect.any(Object),
    });
  });
});
```

```bash
node --check tests/integration/endpoints/ghost-audit.test.mjs
git add tests/integration/endpoints/ghost-audit.test.mjs
git commit -m "test(integ): GET /ghost-audit shape + 404 before sync"
```

---

### Task 21: ghost-audit-cache.test.mjs

**Files:**
- Create: `tests/integration/endpoints/ghost-audit-cache.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /ghost-audit caching', () => {
  it('first call after sync is fresh (cached:false), second is cached (cached:true)', async () => {
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const a = await (await fetch(`${BASE}/ghost-audit?repo=${FIXTURE.name}`)).json();
    const b = await (await fetch(`${BASE}/ghost-audit?repo=${FIXTURE.name}`)).json();
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
  });

  it('a new sync invalidates the cache', async () => {
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    await fetch(`${BASE}/ghost-audit?repo=${FIXTURE.name}`); // warm cache
    // sleep enough for mtime tick (file system may have ~1s resolution)
    await new Promise(r => setTimeout(r, 1100));
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const out = await (await fetch(`${BASE}/ghost-audit?repo=${FIXTURE.name}`)).json();
    expect(out.cached).toBe(false);
  });
});
```

```bash
node --check tests/integration/endpoints/ghost-audit-cache.test.mjs
git add tests/integration/endpoints/ghost-audit-cache.test.mjs
git commit -m "test(integ): ghost-audit cache invalidation on sync"
```

---

### Task 22: MCP integration test + e2e Playwright

**Files:**
- Create: `tests/integration/mcp/ghost_audit.test.mjs`
- Create: `tests/e2e/specs/audit-panel.spec.ts`

- [ ] **Step 1: MCP test** — follow pattern of existing 12 MCP tests in `tests/integration/mcp/` (created when Tier 2bis.1 shipped). Stub : call tool over stdio, assert response shape.

```js
import { describe, it, expect } from 'vitest';
// Adapt this import to whatever helper the existing Tier 2bis.1 MCP tests use.
import { invokeMcpTool } from '../helpers/mcp-client.mjs';
import { FIXTURE } from '../helpers/analyze.mjs';

describe('MCP tool ghost_audit', () => {
  it('returns 2 content blocks (text summary + JSON)', async () => {
    const result = await invokeMcpTool('ghost_audit', { repo: FIXTURE.name });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toMatch(/Roadmap audit/);
    expect(result.content[1].text).toMatch(/```json/);
  });
});
```

If `helpers/mcp-client.mjs` doesn't exist yet (i.e. Tier 2bis.1 didn't add it), skip this test and note in the commit. The pattern will be set up later.

- [ ] **Step 2: E2E Playwright spec**

```ts
import { test, expect } from '@playwright/test';

test('Audit panel renders + click churner highlights row', async ({ page }) => {
  await page.goto('/');
  await page.getByText('sample-repo').click();
  await page.getByRole('button', { name: /audit/i }).click();
  const panel = page.locator('[data-testid="audit-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByTestId('audit-summary')).toBeVisible();
});
```

- [ ] **Step 3: Commit**

```bash
node --check tests/integration/mcp/ghost_audit.test.mjs
git add tests/integration/mcp/ghost_audit.test.mjs tests/e2e/specs/audit-panel.spec.ts
git commit -m "test: MCP ghost_audit + e2e audit-panel"
```

---

## Section F — Fixture extension + final wiring (Tasks 23-27, ~0.5 day)

### Task 23: Extend make-fixture.mjs (commit 12)

**Files:**
- Modify: `tests/fixtures/make-fixture.mjs`

Add a 12th commit (Alice, 2025-02-15) that marks the "Migration runner" ghost ✅ in the fixture's ROADMAP.md. This gives planChurn / slippage real data to work with.

```js
// Commit 12 (alice, 2025-02-15) — marks Migration runner ✅
commit({
  author: ALICE,
  date: '2025-02-15T10:00:00 +0100',
  message: 'feat(db): migration runner shipped',
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
      '| 3 | **Migration runner** | `src/db/orphan.py` |',  // ← newly shipped
      '',
      '## 🎯 Tier 1',
      '',
      '### 1.1 — Migration runner ✅',  // ← now marked ✅
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
    ].join('\n'),
  },
});
```

```bash
cd tests && node fixtures/make-fixture.mjs && cd ..
git add tests/fixtures/make-fixture.mjs tests/fixtures/sample-repo.tar.gz
git commit -m "test(fixture): commit 12 marks Migration runner ghost ✅"
```

---

### Task 24: Wire AuditPanel into the host panel slot

**Files:**
- Modify: existing `App.tsx` or wherever panels are toggled (find via `node -e "console.log(require('fs').readFileSync('upstream/gitnexus-web/src/App.tsx','utf8').slice(0, 2500))"`)

Add `<AuditPanel>` to the panel registry / toggle bar following the existing pattern (look at how `OwnershipPanel`, `DissonancePanel` are wired).

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(ghost-audit): wire AuditPanel into the panel toggle bar"
```

---

### Task 25: Add /ghost-audit to smoke loop in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

Append to the smoke loop block :
```bash
curl -s -o /dev/null -w "ghost-audit: HTTP %{http_code}\n" \
  "http://localhost:4173/ghost-audit?repo=hmm_studio"
```

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE): add /ghost-audit to smoke loop"
```

---

### Task 26: ROADMAP + INVENTORY + tests/README.md updates

**Files:**
- Modify: `ROADMAP.md` (add row 26 to "Déjà livré")
- Modify: `INVENTORY.md` (extend the "Roadmap predictive" sub-section with Audit endpoint + MCP tool)
- Modify: `tests/README.md` (list 17 new test files)

```markdown
# ROADMAP "Déjà livré" row
| 26 | **Roadmap predictive — Audit view** (5 metrics, cache, AuditPanel, MCP tool ghost_audit) | `/ghost-audit`, `AuditPanel.tsx`, `audit/*`, `docker-server-ghost-audit*.mjs`, MCP `ghost_audit` |
```

```bash
git add ROADMAP.md INVENTORY.md tests/README.md
node scripts/check-test-inventory.mjs  # must exit 0
git commit -m "docs: roadmap-predictive Audit view shipped (ROADMAP + INVENTORY + tests inventory)"
```

---

### Task 27: Append Update — Shipped to the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-26-roadmap-predictive-audit-design.md`

```
node -e "const fs=require('fs'); const p='docs/superpowers/specs/2026-05-26-roadmap-predictive-audit-design.md'; const c=fs.readFileSync(p,'utf8'); const today=new Date().toISOString().slice(0,10); const upd='\n\n---\n\n## Update '+today+' — Shipped\n\nAudit view livrée. Notes :\n\n- 5 métriques implantées comme spécifié. parseTargetDate gère ISO + YYYY-QX + YYYY-MM ; tolérance \"bucket-aware\" pour les granularités Q/M.\n- Cache mtime-based fonctionne ; invalidation auto sur /ghosts/sync et /snapshot[/bulk].\n- AuditPanel + 6 sous-composants livrés. Pattern SVG natif (GrowthChart-like) respecté.\n- MCP tool ghost_audit livré ; 13ème tool dans gitnexus-claude-plugin.\n- Tests : 6 unit + 7 components + 2 integration + 1 MCP + 1 e2e écrits ; runtime CI Node 22.\n- Open question 1 (tolérance bucket-aware) confirmée en impl. Open question 2 (?windowDays override) livrée.\n'; fs.writeFileSync(p, c + upd);"

git add docs/superpowers/specs/2026-05-26-roadmap-predictive-audit-design.md
git commit -m "docs(spec): append Update — Shipped on roadmap-predictive Audit view"
```

---

## Final validation

- [ ] `git log --pretty=format:"%ae" --since="<start of this work>" | sort -u` → only `roblastar@live.fr`
- [ ] `node scripts/check-test-inventory.mjs` exits 0
- [ ] `patches/upstream-all.diff` includes the 3 new/modified upstream files
- [ ] Smoke loop in `CLAUDE.md` includes `ghost-audit`
- [ ] ROADMAP, INVENTORY, spec all have the new feature row / section / Update block

---

## Self-Review

**Spec coverage** :
- §3.2 Architecture (modules + endpoints + storage) — Tasks 7-10 + 13-19.
- §3.2 Algorithms — Tasks 1-6.
- §3.2 Cache — Task 8.
- §3.2 Frontend (AuditPanel + 6 sub-components) — Tasks 13-19.
- §3.2 MCP tool — Task 11 (single task — patches `mcp-server/server.mjs` + `smoke.mjs`).
- §3.2 Tests — Tasks 20-22 (integration + e2e) + unit tests woven into 1-6 + 13-19.
- §3.2 Fixture extension — Task 23.
- §4 Out-of-scope respected (no cross-repo audit, no PDF export, no projection).
- §5 Open questions — all 5 resolved by design ; Task 27 documents in Update.

**Placeholder scan** : Task 15-19 use a "same pattern as Task 14" shorthand but each lists what to write (file path + acceptance bullet). For an autonomous executor, that's borderline — the executor should be able to write each sub-component from the spec's section 3.2 frontend description + Task 14's pattern. If the executor needs more, the spec section 3.2 has the data flow + edge cases.

**Type consistency** : `AuditData` shape consistent between AuditPanel (Task 13) and the endpoint response shape (Section A). MCP tool consumes the same JSON. All metric function names match between core and i/o : `computeSummary`, `computeLeadTime`, `computeSlippage`, `computePlanChurn`, `computeVelocity`.

**Known risks** :
- Task 15-19 condensed format may not give an autonomous subagent enough to write good tests. If used with subagent-driven-development, expand each task in-flight from the pattern of Task 14.
- Task 11 (MCP) patches `mcp-server/server.mjs` directly — the JSON-schema tools array pattern is verified against the 18 existing tools.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-26-roadmap-predictive-audit.md`. Two execution options :**

**1. Subagent-Driven (recommended)** — fresh subagent per task with 2 reviewers.

**2. Inline Execution** — same session, batch with checkpoints.

**Reminder** : the user asked to chain 3 more sub-spec brainstorms (Augmented graph, Brainstorm-hook, Gantt) **before** executing. So the next move is most likely "brainstorm next sub-spec" rather than "execute this plan now".
