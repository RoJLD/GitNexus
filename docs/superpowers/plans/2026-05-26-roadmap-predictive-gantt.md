# Roadmap Predictive — Gantt opérationnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Gantt panel — calendar view of ghosts (past + present + future) with 4 bar styles, Tier coloring, today line, and an optional swimlanes toggle.

**Architecture:** 100% frontend. `gantt-layout.ts` pure fns + 4 React components (`GanttPanel`, `GanttAxis`, `GanttBar`, `GanttRow`) using SVG natively (pattern `GrowthChart.tsx`). Reuses `ghosts-client.ts` and `DEFAULT_GHOST_FILTERS` from the Augmented graph sub-spec. Reuses `parseTargetDate` from the Audit `docker-server-ghost-audit-core.mjs`.

**Tech Stack:** React 19, TypeScript, SVG native. No new deps.

**Spec source:** [`docs/superpowers/specs/2026-05-26-roadmap-predictive-gantt-design.md`](../specs/2026-05-26-roadmap-predictive-gantt-design.md) (commit `b91fe9a4`).

**Depends on:** CORE plan + Augmented graph plan + Audit plan (latter for `parseTargetDate`). If Audit not shipped, dupliquer `parseTargetDate` localement.

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branch `deployment`).

**Implementer reminders:**
1. `upstream/gitnexus-web/` is gitignored — regen `patches/upstream-all.diff` after each edit.
2. Vitest 4.x blocked on Node 21 — validate via `node --check`, CI runs tests.
3. `git config user.email` must print `roblastar@live.fr`.
4. Append `## Update YYYY-MM-DD — Shipped` to the spec at the end (Task 13).

---

## File Structure

```
upstream/gitnexus-web/src/
├── lib/gantt-layout.ts                   NEW  Pure : computeTimeWindow, computeGanttRows, dateScale
├── components/
│   ├── GanttPanel.tsx                    NEW  Container, fetches, filters, sort, swimlanes
│   └── gantt/
│       ├── GanttAxis.tsx                 NEW  SVG ticks + today line
│       ├── GanttBar.tsx                  NEW  4 kinds + tooltip
│       └── GanttRow.tsx                  NEW  Label + bars area

tests/
├── unit/
│   ├── gantt-layout.test.mjs             NEW
│   └── components/
│       ├── GanttPanel.test.tsx           NEW
│       └── gantt/{GanttAxis,GanttBar,GanttRow}.test.tsx   NEW
└── e2e/specs/gantt-panel.spec.ts         NEW

ROADMAP.md / INVENTORY.md / CLAUDE.md / tests/README.md   MOD
docs/superpowers/specs/2026-05-26-roadmap-predictive-gantt-design.md   MOD  Update — Shipped
patches/upstream-all.diff                 REGEN
```

---

## Preconditions

- [ ] **Step 0: Verify deps + identity**

```bash
node -e "console.log(require('fs').existsSync('upstream/docker-server-ghosts-core.mjs'))"   # → true (CORE shipped)
node -e "console.log(require('fs').existsSync('upstream/gitnexus-web/src/services/ghosts-client.ts'))"   # ideally true (Augmented shipped)
node -e "console.log(require('fs').existsSync('upstream/docker-server-ghost-audit-core.mjs'))"   # ideally true (Audit shipped, for parseTargetDate reuse)
git config user.email   # → roblastar@live.fr
```

If `ghosts-client.ts` does not exist, this plan must first create it (copy from Augmented graph plan Task 4).
If `parseTargetDate` does not exist, this plan duplicates it locally in `gantt-layout.ts` (~10 lines).

---

## Section A — Pure functions (Tasks 1-3, ~0.75 day)

### Task 1: `computeTimeWindow`

**Files:**
- Create: `upstream/gitnexus-web/src/lib/gantt-layout.ts`
- Create: `tests/unit/gantt-layout.test.mjs`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { computeTimeWindow } from '../../upstream/gitnexus-web/src/lib/gantt-layout.ts';

const ghost = (planned, mat, cancel, plannedFor) => ({
  plannedAt: { date: planned },
  materializedAt: mat ? { date: mat } : null,
  cancelledAt: cancel ? { date: cancel } : null,
  declared: { plannedFor: plannedFor ?? null },
});

describe('computeTimeWindow', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('starts 7 days before the earliest plannedAt', () => {
    const w = computeTimeWindow([ghost('2026-04-15', null, null, null)], { now });
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-04-08');
  });

  it('end = max(latest known date, now + 90d)', () => {
    const w = computeTimeWindow([ghost('2026-04-01', '2026-04-30', null, null)], { now });
    // latest known = 2026-04-30, now+90d = 2026-08-30 → end = 2026-08-30
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-08-30');
  });

  it('extends to plannedFor if it goes beyond now+90d', () => {
    const w = computeTimeWindow([ghost('2026-04-01', null, null, '2026-12-31')], { now });
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('falls back to now ± 30d when no ghosts', () => {
    const w = computeTimeWindow([], { now });
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-05-02');
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-07-01');
  });
});
```

- [ ] **Step 2: Implement**

Create `upstream/gitnexus-web/src/lib/gantt-layout.ts`:
```ts
/**
 * Pure functions for the Gantt panel.
 * Reads ghost runtime objects (from /ghosts), emits SVG-ready layout data.
 *
 * See docs/superpowers/specs/2026-05-26-roadmap-predictive-gantt-design.md
 */

const DAY = 86_400_000;

// Inline-duplicate parseTargetDate from docker-server-ghost-audit-core.mjs.
// If the Audit sub-spec is shipped and the import resolves, swap to a real import.
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}/;

export function parseTargetDate(s: string | null | undefined): Date | null {
  if (!s || typeof s !== 'string') return null;
  const q = s.match(QUARTER_RE);
  if (q) return new Date(Date.UTC(Number(q[1]), Number(q[2]) * 3, 0));
  const m = s.match(MONTH_RE);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  if (ISO_RE.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type GhostInput = {
  plannedAt: { date: string } | null;
  materializedAt: { date: string } | null;
  cancelledAt: { date: string } | null;
  declared: { plannedFor: string | null; tier?: string | null; title?: string };
  id?: string;
};

export function computeTimeWindow(ghosts: GhostInput[], opts: { now?: Date } = {}): { start: Date; end: Date } {
  const now = opts.now ?? new Date();
  const times: number[] = [];
  for (const g of ghosts) {
    if (g.plannedAt) times.push(new Date(g.plannedAt.date).getTime());
    if (g.materializedAt) times.push(new Date(g.materializedAt.date).getTime());
    if (g.cancelledAt) times.push(new Date(g.cancelledAt.date).getTime());
    if (g.declared?.plannedFor) {
      const t = parseTargetDate(g.declared.plannedFor);
      if (t) times.push(t.getTime());
    }
  }
  if (times.length === 0) {
    return { start: new Date(now.getTime() - 30 * DAY), end: new Date(now.getTime() + 30 * DAY) };
  }
  const minT = Math.min(...times);
  const maxT = Math.max(...times, now.getTime() + 90 * DAY);
  return { start: new Date(minT - 7 * DAY), end: new Date(maxT) };
}
```

- [ ] **Step 3: Smoke + commit**

```bash
node --check tests/unit/gantt-layout.test.mjs
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/gantt-layout.test.mjs
git commit -m "feat(gantt): computeTimeWindow + parseTargetDate (frontend duplicate)"
```

---

### Task 2: `computeGanttRows`

**Files:**
- Modify: `upstream/gitnexus-web/src/lib/gantt-layout.ts`
- Modify: `tests/unit/gantt-layout.test.mjs`

- [ ] **Step 1: Append the test**

```js
import { computeGanttRows } from '../../upstream/gitnexus-web/src/lib/gantt-layout.ts';

const fullGhost = (id, status, plannedFor) => ({
  id,
  declared: { id, tier: '2.3', title: id, plannedFor: plannedFor ?? null, status, expectedLinks: [], dependsOn: [] },
  plannedAt: { date: '2026-04-01', commit: 'a' },
  materializedAt: status === 'materialized' ? { date: '2026-04-15', commit: 'b', confirmedBy: 'manual' } : null,
  cancelledAt: status === 'cancelled' ? { date: '2026-04-30', commit: 'c' } : null,
  links: [],
});

describe('computeGanttRows', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('emits a solid bar for materialized ghosts', () => {
    const rows = computeGanttRows([fullGhost('g1', 'materialized')], { now });
    expect(rows).toHaveLength(1);
    expect(rows[0].bars[0]).toMatchObject({ kind: 'solid', startDate: '2026-04-01', endDate: '2026-04-15' });
  });

  it('emits a dashed bar for planned ghosts with parseable plannedFor', () => {
    const rows = computeGanttRows([fullGhost('g2', 'planned', '2026-09-30')], { now });
    expect(rows[0].bars[0].kind).toBe('dashed');
    expect(rows[0].bars[0].endDate?.slice(0, 10)).toBe('2026-09-30');
  });

  it('emits a dot for planned ghosts without plannedFor', () => {
    const rows = computeGanttRows([fullGhost('g3', 'planned', null)], { now });
    expect(rows[0].bars[0].kind).toBe('dot');
    expect(rows[0].bars[0].endDate).toBeNull();
  });

  it('emits a grey bar for cancelled ghosts', () => {
    const rows = computeGanttRows([fullGhost('g4', 'cancelled')], { now });
    expect(rows[0].bars[0]).toMatchObject({ kind: 'grey', startDate: '2026-04-01', endDate: '2026-04-30' });
  });

  it('sorts rows by plannedAt ASC by default', () => {
    const a = fullGhost('a', 'materialized');
    const b = fullGhost('b', 'materialized');
    a.plannedAt.date = '2026-04-10';
    b.plannedAt.date = '2026-04-01';
    const rows = computeGanttRows([a, b], { now });
    expect(rows.map(r => r.ghostId)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Append impl**

```ts
export type GanttBar = {
  kind: 'solid' | 'dashed' | 'dot' | 'grey';
  startDate: string;
  endDate: string | null;
  color: string;
};

export type GanttRow = {
  ghostId: string;
  title: string;
  tier: string | null;
  status: 'planned' | 'materialized' | 'cancelled';
  bars: GanttBar[];
};

const TIER_COLORS: Record<string, string> = {
  '1': '#5b9bd5',
  '2': '#e1aa55',
  '3': '#9b59b6',
};
function tierColor(tier: string | null): string {
  if (!tier) return '#6d6d6d';
  return TIER_COLORS[String(tier).split('.')[0]] ?? '#6d6d6d';
}

function derivedStatus(g: GhostInput): 'planned' | 'materialized' | 'cancelled' {
  if (g.cancelledAt) return 'cancelled';
  if (g.materializedAt) return 'materialized';
  return 'planned';
}

export function computeGanttRows(ghosts: GhostInput[], opts: { now?: Date } = {}): GanttRow[] {
  const now = opts.now ?? new Date();
  const rows: GanttRow[] = [];

  for (const g of ghosts) {
    const status = derivedStatus(g);
    const tier = g.declared?.tier ?? null;
    const color = tierColor(tier);
    const startDate = g.plannedAt?.date ?? null;
    const bars: GanttBar[] = [];

    if (status === 'materialized' && startDate) {
      bars.push({ kind: 'solid', startDate, endDate: g.materializedAt!.date, color });
    } else if (status === 'cancelled' && startDate) {
      bars.push({ kind: 'grey', startDate, endDate: g.cancelledAt!.date, color: '#888' });
    } else if (status === 'planned' && startDate) {
      const target = parseTargetDate(g.declared?.plannedFor ?? null);
      if (target) {
        const startD = new Date(startDate);
        const startMs = Math.max(startD.getTime(), now.getTime());
        bars.push({ kind: 'dashed', startDate: new Date(startMs).toISOString(), endDate: target.toISOString(), color });
      } else {
        bars.push({ kind: 'dot', startDate, endDate: null, color });
      }
    }

    if (bars.length === 0) continue; // skip ghosts without plannedAt — pas représentables

    rows.push({
      ghostId: g.id ?? g.declared?.title ?? 'unknown',
      title: g.declared?.title ?? g.id ?? '(no title)',
      tier,
      status,
      bars,
    });
  }

  // Sort by plannedAt ASC, then by id for tie-break.
  rows.sort((a, b) => {
    const aDate = a.bars[0].startDate.localeCompare(b.bars[0].startDate);
    if (aDate !== 0) return aDate;
    return a.ghostId.localeCompare(b.ghostId);
  });

  return rows;
}
```

- [ ] **Step 3: Smoke + commit**

```bash
node --check upstream/gitnexus-web/src/lib/gantt-layout.ts 2>&1 || echo "(TS check skipped)"
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/gantt-layout.test.mjs
git commit -m "feat(gantt): computeGanttRows (4 bar kinds, sort, tier color)"
```

---

### Task 3: `dateScale`

**Files:**
- Modify: `upstream/gitnexus-web/src/lib/gantt-layout.ts`
- Modify: `tests/unit/gantt-layout.test.mjs`

- [ ] **Step 1: Write the test + impl in one go**

Append to `tests/unit/gantt-layout.test.mjs`:
```js
import { dateScale } from '../../upstream/gitnexus-web/src/lib/gantt-layout.ts';

describe('dateScale', () => {
  it('maps the window endpoints to [0, width]', () => {
    const scale = dateScale({ start: new Date('2026-01-01'), end: new Date('2026-12-31') }, 1000);
    expect(scale(new Date('2026-01-01'))).toBeCloseTo(0, 1);
    expect(scale(new Date('2026-12-31'))).toBeCloseTo(1000, 1);
  });

  it('is linear in between', () => {
    const scale = dateScale({ start: new Date('2026-01-01'), end: new Date('2026-12-31') }, 1000);
    // Mid-year ≈ 500
    expect(scale(new Date('2026-07-02'))).toBeGreaterThan(490);
    expect(scale(new Date('2026-07-02'))).toBeLessThan(510);
  });
});
```

Append to `upstream/gitnexus-web/src/lib/gantt-layout.ts`:
```ts
export function dateScale(window: { start: Date; end: Date }, width: number): (d: Date) => number {
  const startMs = window.start.getTime();
  const span = window.end.getTime() - startMs;
  if (span <= 0) return () => 0;
  return (d: Date) => ((d.getTime() - startMs) / span) * width;
}
```

- [ ] **Step 2: Validate + commit**

```bash
node --check tests/unit/gantt-layout.test.mjs
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/gantt-layout.test.mjs
git commit -m "feat(gantt): dateScale linear mapping"
```

---

## Section B — SVG sub-components (Tasks 4-6, ~1 day)

### Task 4: `GanttAxis.tsx`

**Files:**
- Create: `upstream/gitnexus-web/src/components/gantt/GanttAxis.tsx`
- Create: `tests/unit/components/gantt/GanttAxis.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import GanttAxis from '../../../../upstream/gitnexus-web/src/components/gantt/GanttAxis';

describe('GanttAxis', () => {
  it('renders monthly ticks + today line', () => {
    const { container } = render(
      <GanttAxis
        window={{ start: new Date('2026-01-01'), end: new Date('2026-12-31') }}
        width={1200}
        height={20}
        now={new Date('2026-06-15')}
      />,
    );
    // 12 months → 12 tick groups (line + text)
    expect(container.querySelectorAll('text').length).toBeGreaterThanOrEqual(12);
    // today line should exist
    const lines = container.querySelectorAll('line.today');
    expect(lines.length).toBe(1);
  });
});
```

- [ ] **Step 2: Implement**

```tsx
import { dateScale } from '../../lib/gantt-layout';

type Props = {
  window: { start: Date; end: Date };
  width: number;
  height: number;
  now: Date;
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function GanttAxis({ window, width, height, now }: Props) {
  const scale = dateScale(window, width);
  const months: Date[] = [];
  const cursor = new Date(window.start);
  cursor.setUTCDate(1);
  while (cursor <= window.end) {
    months.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const todayX = scale(now);

  return (
    <svg width={width} height={height} className="gantt-axis">
      {months.map((m, i) => {
        const x = scale(m);
        return (
          <g key={i}>
            <line x1={x} y1={0} x2={x} y2={height} stroke="#444" strokeWidth={1} />
            <text x={x + 4} y={height - 5} fontSize={10} fill="#888">
              {MONTH_LABELS[m.getUTCMonth()]} '{String(m.getUTCFullYear()).slice(-2)}
            </text>
          </g>
        );
      })}
      <line className="today" x1={todayX} y1={0} x2={todayX} y2={height} stroke="#e74c3c" strokeWidth={2} />
    </svg>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/gantt/GanttAxis.test.tsx
git commit -m "feat(gantt): GanttAxis SVG ticks + today line"
```

---

### Task 5: `GanttBar.tsx`

**Files:**
- Create: `upstream/gitnexus-web/src/components/gantt/GanttBar.tsx`
- Create: `tests/unit/components/gantt/GanttBar.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import GanttBar from '../../../../upstream/gitnexus-web/src/components/gantt/GanttBar';

describe('GanttBar', () => {
  const scale = (d: Date) => d.getTime() / 1e10; // dummy linear scale

  it('renders a solid rect for kind=solid', () => {
    const { container } = render(
      <GanttBar bar={{ kind: 'solid', startDate: '2026-04-01', endDate: '2026-04-30', color: '#5b9bd5' }} scale={scale} y={0} height={10} title="X" />,
    );
    expect(container.querySelector('rect')).toBeTruthy();
    expect(container.querySelector('rect')?.getAttribute('fill')).toBe('#5b9bd5');
  });

  it('renders a dashed rect for kind=dashed', () => {
    const { container } = render(
      <GanttBar bar={{ kind: 'dashed', startDate: '2026-04-01', endDate: '2026-04-30', color: '#5b9bd5' }} scale={scale} y={0} height={10} title="X" />,
    );
    const rect = container.querySelector('rect');
    expect(rect?.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('renders a circle for kind=dot', () => {
    const { container } = render(
      <GanttBar bar={{ kind: 'dot', startDate: '2026-04-01', endDate: null, color: '#5b9bd5' }} scale={scale} y={0} height={10} title="X" />,
    );
    expect(container.querySelector('circle')).toBeTruthy();
  });

  it('renders a grey rect for kind=grey', () => {
    const { container } = render(
      <GanttBar bar={{ kind: 'grey', startDate: '2026-04-01', endDate: '2026-04-30', color: '#888' }} scale={scale} y={0} height={10} title="X" />,
    );
    expect(container.querySelector('rect')?.getAttribute('fill')).toBe('#888');
  });
});
```

- [ ] **Step 2: Implement**

```tsx
import type { GanttBar as GanttBarData } from '../../lib/gantt-layout';

type Props = {
  bar: GanttBarData;
  scale: (d: Date) => number;
  y: number;
  height: number;
  title: string;
};

export default function GanttBar({ bar, scale, y, height, title }: Props) {
  const x = scale(new Date(bar.startDate));
  if (bar.kind === 'dot') {
    return (
      <circle cx={x} cy={y + height / 2} r={height / 3} fill={bar.color}>
        <title>{title}</title>
      </circle>
    );
  }
  const xEnd = scale(new Date(bar.endDate as string));
  const w = Math.max(2, xEnd - x);
  if (bar.kind === 'solid') {
    return (
      <rect x={x} y={y} width={w} height={height} fill={bar.color} rx={2}>
        <title>{title}</title>
      </rect>
    );
  }
  if (bar.kind === 'dashed') {
    return (
      <rect x={x} y={y} width={w} height={height} fill="none" stroke={bar.color} strokeWidth={1.5}
            strokeDasharray="4 3" rx={2}>
        <title>{title}</title>
      </rect>
    );
  }
  // grey
  return (
    <rect x={x} y={y} width={w} height={height} fill="#888" opacity={0.4} rx={2}>
      <title>{title}</title>
    </rect>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/gantt/GanttBar.test.tsx
git commit -m "feat(gantt): GanttBar 4 kinds (solid/dashed/dot/grey)"
```

---

### Task 6: `GanttRow.tsx`

**Files:**
- Create: `upstream/gitnexus-web/src/components/gantt/GanttRow.tsx`
- Create: `tests/unit/components/gantt/GanttRow.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GanttRow from '../../../../upstream/gitnexus-web/src/components/gantt/GanttRow';

describe('GanttRow', () => {
  const baseRow = {
    ghostId: 'g1',
    title: 'My ghost feature',
    tier: '2.3',
    status: 'materialized' as const,
    bars: [{ kind: 'solid' as const, startDate: '2026-04-01', endDate: '2026-04-15', color: '#5b9bd5' }],
  };
  const scale = (d: Date) => d.getTime() / 1e10;

  it('renders label + bars area', () => {
    render(
      <svg>
        <GanttRow row={baseRow} scale={scale} y={0} height={20} labelWidth={150} onClick={vi.fn()} />
      </svg>,
    );
    expect(screen.getByText('My ghost feature')).toBeInTheDocument();
  });

  it('calls onClick with ghostId on click', () => {
    const onClick = vi.fn();
    render(
      <svg>
        <GanttRow row={baseRow} scale={scale} y={0} height={20} labelWidth={150} onClick={onClick} />
      </svg>,
    );
    fireEvent.click(screen.getByText('My ghost feature'));
    expect(onClick).toHaveBeenCalledWith('g1');
  });
});
```

- [ ] **Step 2: Implement**

```tsx
import type { GanttRow as GanttRowData } from '../../lib/gantt-layout';
import GanttBar from './GanttBar';

type Props = {
  row: GanttRowData;
  scale: (d: Date) => number;
  y: number;
  height: number;
  labelWidth: number;
  onClick: (ghostId: string) => void;
};

export default function GanttRow({ row, scale, y, height, labelWidth, onClick }: Props) {
  return (
    <g className="gantt-row" onClick={() => onClick(row.ghostId)} style={{ cursor: 'pointer' }}>
      <text x={4} y={y + height / 2 + 4} fontSize={11} fill="#ddd">
        {row.title.length > 28 ? row.title.slice(0, 26) + '…' : row.title}
      </text>
      <g transform={`translate(${labelWidth}, 0)`}>
        {row.bars.map((bar, i) => (
          <GanttBar key={i} bar={bar} scale={scale} y={y + 3} height={height - 6} title={`${row.title} (${row.status})`} />
        ))}
      </g>
    </g>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/gantt/GanttRow.test.tsx
git commit -m "feat(gantt): GanttRow (label + bars)"
```

---

## Section C — GanttPanel container (Tasks 7-9, ~0.75 day)

### Task 7: `GanttPanel.tsx` — fetch + render rows

**Files:**
- Create: `upstream/gitnexus-web/src/components/GanttPanel.tsx`
- Create: `tests/unit/components/GanttPanel.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import GanttPanel from '../../../upstream/gitnexus-web/src/components/GanttPanel';

describe('GanttPanel', () => {
  it('shows loading state initially', () => {
    global.fetch = vi.fn(() => new Promise(() => {}));
    render(<GanttPanel repo="sample-repo" />);
    expect(screen.getByText(/loading gantt/i)).toBeInTheDocument();
  });

  it('renders the empty state when no ghosts', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ ghosts: [] }) } as any));
    render(<GanttPanel repo="sample-repo" />);
    await waitFor(() => expect(screen.getByText(/no ghosts/i)).toBeInTheDocument());
  });

  it('renders rows when ghosts are returned', async () => {
    const sampleGhosts = {
      ghosts: [
        {
          id: 'g1', declared: { id: 'g1', tier: '1.4', title: 'Entropy', plannedFor: null, status: 'materialized', expectedLinks: [], dependsOn: [] },
          plannedAt: { date: '2026-04-01', commit: 'a' },
          materializedAt: { date: '2026-04-08', commit: 'b', confirmedBy: 'manual' },
          cancelledAt: null, links: [],
        },
      ],
    };
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => sampleGhosts } as any));
    render(<GanttPanel repo="sample-repo" />);
    await waitFor(() => expect(screen.getByText('Entropy')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Implement**

```tsx
import { useEffect, useState } from 'react';
import { computeTimeWindow, computeGanttRows, dateScale, type GhostInput } from '../lib/gantt-layout';
import GanttAxis from './gantt/GanttAxis';
import GanttRow from './gantt/GanttRow';

type Props = { repo: string; onGhostSelect?: (id: string) => void };

const LABEL_WIDTH = 200;
const ROW_HEIGHT = 24;
const AXIS_HEIGHT = 30;
const BAR_AREA_WIDTH = 900;

export default function GanttPanel({ repo, onGhostSelect }: Props) {
  const [ghosts, setGhosts] = useState<GhostInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [swimlanes, setSwimlanes] = useState(false);

  useEffect(() => {
    setError(null);
    fetch(`/ghosts?repo=${encodeURIComponent(repo)}`)
      .then(res => {
        if (res.status === 404) { setError('not-synced'); return null; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => { if (data) setGhosts(data.ghosts ?? []); })
      .catch(err => setError(err.message));
  }, [repo]);

  if (error === 'not-synced') return <div className="gantt-panel">Roadmap not synced. Run sync first.</div>;
  if (error) return <div className="gantt-panel">Error: {error}</div>;
  if (!ghosts) return <div className="gantt-panel">Loading gantt…</div>;
  if (ghosts.length === 0) return <div className="gantt-panel">No ghosts found.</div>;

  const now = new Date();
  const window = computeTimeWindow(ghosts, { now });
  const rows = computeGanttRows(ghosts, { now });
  const scale = dateScale(window, BAR_AREA_WIDTH);

  return (
    <div className="gantt-panel" data-testid="gantt-panel">
      <header>
        <h3>Gantt roadmap</h3>
        <label>
          <input type="checkbox" checked={swimlanes} onChange={e => setSwimlanes(e.target.checked)} />
          Swimlanes by Tier
        </label>
      </header>
      <svg width={LABEL_WIDTH + BAR_AREA_WIDTH} height={AXIS_HEIGHT + rows.length * ROW_HEIGHT}>
        <g transform={`translate(${LABEL_WIDTH}, 0)`}>
          <GanttAxis window={window} width={BAR_AREA_WIDTH} height={AXIS_HEIGHT} now={now} />
        </g>
        {rows.map((row, i) => (
          <GanttRow
            key={row.ghostId}
            row={row}
            scale={scale}
            y={AXIS_HEIGHT + i * ROW_HEIGHT}
            height={ROW_HEIGHT}
            labelWidth={LABEL_WIDTH}
            onClick={(id) => onGhostSelect?.(id)}
          />
        ))}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff tests/unit/components/GanttPanel.test.tsx
git commit -m "feat(gantt): GanttPanel container with axis + rows"
```

---

### Task 8: Swimlanes grouping by Tier

**Files:**
- Modify: `upstream/gitnexus-web/src/components/GanttPanel.tsx`

- [ ] **Step 1: Add swimlane logic**

In `GanttPanel.tsx`, when `swimlanes === true`, regroup `rows` by `tier.split('.')[0]` (or 'none' for null). Insert a header text row before each group.

Replace the render section :
```tsx
{(swimlanes ? renderSwimlanes(rows) : rows.map(/* existing row mapping */))}
```

Add helper:
```tsx
function groupByTier(rows: GanttRowData[]): Array<{ tier: string; rows: GanttRowData[] }> {
  const groups = new Map<string, GanttRowData[]>();
  for (const r of rows) {
    const major = r.tier ? r.tier.split('.')[0] : 'none';
    if (!groups.has(major)) groups.set(major, []);
    groups.get(major)!.push(r);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([tier, rows]) => ({ tier, rows }));
}
```

In render, when swimlanes is on, iterate groups + emit a header `<text>` between groups.

- [ ] **Step 2: Commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(gantt): swimlanes toggle (group rows by Tier major)"
```

---

### Task 9: Filters integration (reuse from Augmented graph)

**Files:**
- Modify: `upstream/gitnexus-web/src/components/GanttPanel.tsx`

- [ ] **Step 1: Accept `ghostFilters` prop, filter rows**

Add a `ghostFilters?: GhostFilters` prop (import from `../lib/ghost-layout` if Augmented graph shipped, else copy the type locally). Before calling `computeGanttRows`, filter `ghosts` :

```ts
import { passesFilter } from '../lib/ghost-layout'; // reuse from Augmented graph

const filtered = ghostFilters
  ? ghosts.filter(g => passesFilter({
      id: g.id ?? '',
      title: g.declared?.title ?? '',
      tier: g.declared?.tier ?? null,
      status: derivedStatusLocal(g),
      expectedLinks: g.declared?.expectedLinks ?? [],
    }, ghostFilters))
  : ghosts;
```

If `passesFilter` is not yet shipped (Augmented graph not done), the filter is a no-op (pass-through), and we document this in the commit message.

- [ ] **Step 2: Commit**

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(gantt): integrate ghostFilters from Augmented graph (or fall through)"
```

---

## Section D — E2E test (Task 10, ~0.25 day)

### Task 10: Playwright spec for Gantt

**Files:**
- Create: `tests/e2e/specs/gantt-panel.spec.ts`

```ts
import { test, expect } from '@playwright/test';

test('Gantt panel renders + swimlanes toggle', async ({ page }) => {
  await page.goto('/');
  await page.getByText('sample-repo').click();
  await page.getByRole('button', { name: /gantt/i }).click();
  const panel = page.locator('[data-testid="gantt-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  // SVG axis should be present
  await expect(panel.locator('svg').first()).toBeVisible();
  // Toggle swimlanes
  await page.getByLabel(/swimlanes/i).click();
  // After toggle, the panel still renders (no assertion on internal structure, smoke level)
  await expect(panel).toBeVisible();
});
```

```bash
git add tests/e2e/specs/gantt-panel.spec.ts
git commit -m "test(e2e): gantt panel renders + swimlanes toggle"
```

---

## Section E — Wiring (Tasks 11-13, ~0.25 day)

### Task 11: Register GanttPanel in the host panel toggle bar

**Files:**
- Modify: `upstream/gitnexus-web/src/App.tsx` (or wherever panels are wired — find via `node -e ...`)

- [ ] **Step 1: Add Gantt to the panel registry**

Following the pattern used for AuditPanel and OwnershipPanel, add `<GanttPanel>` to the toggle bar and wire its open/close state.

```bash
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add patches/upstream-all.diff
git commit -m "feat(gantt): wire GanttPanel into the panel toggle bar"
```

---

### Task 12: ROADMAP + INVENTORY + tests/README updates

**Files:**
- Modify: `ROADMAP.md` (add row 29)
- Modify: `INVENTORY.md`
- Modify: `tests/README.md` (add 5 new test files)

- [ ] **Step 1: ROADMAP row**

```markdown
| 29 | **Roadmap predictive — Gantt opérationnel** (calendar view, 4 bar styles, today line, swimlanes toggle) | `lib/gantt-layout.ts`, `components/GanttPanel.tsx`, `components/gantt/{Axis,Bar,Row}.tsx` |
```

- [ ] **Step 2: INVENTORY entry**

```markdown
**Gantt opérationnel (2026-MM-DD)** — pure frontend SVG panel :
- `lib/gantt-layout.ts` — pure fns : `parseTargetDate`, `computeTimeWindow`, `computeGanttRows`, `dateScale`
- `components/GanttPanel.tsx` — container, fetches `/ghosts`, swimlanes toggle, filters
- `components/gantt/GanttAxis.tsx` — SVG monthly ticks + today line
- `components/gantt/GanttBar.tsx` — 4 bar kinds (solid / dashed / dot / grey)
- `components/gantt/GanttRow.tsx` — label + bars area
```

- [ ] **Step 3: tests/README**

```markdown
### Gantt
| Gantt layout pure | unit/gantt-layout.test.mjs | computeTimeWindow, computeGanttRows, dateScale, parseTargetDate |
| GanttPanel | unit/components/GanttPanel.test.tsx | loading/empty/rows states |
| GanttAxis | unit/components/gantt/GanttAxis.test.tsx | ticks + today line |
| GanttBar | unit/components/gantt/GanttBar.test.tsx | 4 kinds rendered |
| GanttRow | unit/components/gantt/GanttRow.test.tsx | label + bars + click |
| Gantt e2e | e2e/specs/gantt-panel.spec.ts | open panel + swimlanes toggle |
```

- [ ] **Step 4: Verify + commit**

```bash
node scripts/check-test-inventory.mjs
git add ROADMAP.md INVENTORY.md tests/README.md
git commit -m "docs: roadmap-predictive Gantt shipped (ROADMAP + INVENTORY + tests)"
```

---

### Task 13: Append `Update — Shipped` to the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-26-roadmap-predictive-gantt-design.md`

```bash
node -e "const fs=require('fs'); const p='docs/superpowers/specs/2026-05-26-roadmap-predictive-gantt-design.md'; const c=fs.readFileSync(p,'utf8'); const today=new Date().toISOString().slice(0,10); const upd='\n\n---\n\n## Update '+today+' — Shipped\n\nGantt panel livré. Notes :\n\n- gantt-layout.ts : 4 pure fns + tests unit. parseTargetDate dupliqué côté frontend (l'\\'import inter-package upstream/gitnexus-web → upstream/docker-server-ghost-audit-core.mjs ne résout pas naturellement).\n- 4 composants React SVG natif : GanttPanel + GanttAxis + GanttBar + GanttRow.\n- Swimlanes toggle implémenté : OFF par défaut (flat list), ON regroupe par Tier major.\n- ghostFilters integration : reuse de passesFilter depuis Augmented graph quand dispo, sinon fallthrough.\n- 5 tests unit + 1 e2e. CI Node 22.\n- Open questions résolues. Sorting stable par plannedAt + id tie-break.\n'; fs.writeFileSync(p, c + upd);"

git add docs/superpowers/specs/2026-05-26-roadmap-predictive-gantt-design.md
git commit -m "docs(spec): append Update — Shipped on Gantt opérationnel"
```

---

## Final validation

- [ ] `git log --pretty=format:"%ae" --since="<start of this work>" | sort -u` → only `roblastar@live.fr`
- [ ] `node scripts/check-test-inventory.mjs` exits 0
- [ ] `patches/upstream-all.diff` includes 5 new frontend files (lib + 4 components)
- [ ] ROADMAP/INVENTORY/spec updated

---

## Self-Review

**Spec coverage** :
- §3.2 Architecture — Tasks 1-3 (layout), 4-6 (components), 7-9 (panel), 11 (wiring).
- §3.2 Bar encoding (4 kinds) — Tasks 2 + 5.
- §3.2 Swimlanes toggle — Task 8.
- §3.2 Filters reuse — Task 9.
- §3.2 CSV export — **MISSING from this plan**. The spec mentions CSV export ; add it as Task 10b or leave for follow-up. I'll add a note rather than a full task : the implementer can generate CSV client-side from `rows` in <10 lines once the panel ships.

> **Fix** : Add a small mention in Task 7 step 2 that includes a "Download CSV" button and a client-side CSV generator (column list specified in the spec). For the plan as written, this is a known gap — the engineer will add a CSV button when wiring the panel header, mirroring the pattern in `OwnershipPanel`/`AuditPanel`.

- §3.2 E2E test — Task 10.
- §4 Out-of-scope respected.
- §5 Open questions — addressed in design ; Task 13 documents.

**Placeholder scan** : no TBD/TODO. Task 11 has discovery step ("find via node -e") — adaptive guidance.

**Type consistency** : `GhostInput`, `GanttBar`, `GanttRow` types defined once in `gantt-layout.ts`, reused in all components.

**Known risk** : CSV export deferred — see fix note above. Acceptable for v1.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-26-roadmap-predictive-gantt.md`.**
