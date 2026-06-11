# UI consolidation — grouped toolbar sections (Health / Social / Cross-repo)

**Date**: 2026-06-11
**Status**: current
**Roadmap**: "Refactos structurels à surveiller" → **Croissance UI horizontale** (~10→15+
panels = inflation cognitive) → consolidation Health/Social/Cross-repo. **UX pattern chosen
by the user**: grouped sections in the Timeline toolbar (reuse the tab pattern).

## 1. Context / problem

`Timeline.tsx` (1622 lines) renders ~9 analytics-mode toggle buttons (churn, coupling,
growth, lifespan, ownership, dissonance, similarity, what-if, entropy-commits) as a **flat
row** of bespoke `<button>` blocks (each with its own active legend / error display),
interleaved with the other toolbar controls (play, animate, nav-mode…). No grouping → the
user must scan a long flat row + know which button does what. As panels grow (15+), the
flat row becomes cognitive overload.

## 2. Goal

The analytics-mode buttons are grouped under **Health / Social / Cross-repo**; a small
3-segment selector picks the active group; only the active group's mode-buttons render
(the rest collapse). Default group = Health. Behavior of each button is **unchanged**
(same enter/exit, same active overlays on the canvas) — purely a presentation regrouping.

## 3. Design

### 3.1 Pure grouping config — `gitnexus-web/src/lib/panel-groups.ts` (host-testable)

```ts
export type PanelGroup = 'health' | 'social' | 'cross-repo';
export type AnalyticsMode = 'churn' | 'coupling' | 'growth' | 'dissonance' | 'whatif' | 'entropyCommits' | 'ownership' | 'lifespan' | 'similarity';
export const PANEL_GROUP_OF: Record<AnalyticsMode, PanelGroup> = {
  churn: 'health', coupling: 'health', growth: 'health', dissonance: 'health', whatif: 'health', entropyCommits: 'health',
  ownership: 'social', lifespan: 'social',
  similarity: 'cross-repo',
};
export const PANEL_GROUPS: { id: PanelGroup; label: string }[] = [
  { id: 'health', label: 'Health' }, { id: 'social', label: 'Social' }, { id: 'cross-repo', label: 'Cross-repo' },
];
export function modesInGroup(g: PanelGroup): AnalyticsMode[];   // keys of PANEL_GROUP_OF where value === g
```
Pure (no imports) → host-testable. The grouping rationale: Health = structural/quality
(churn/coupling/growth/dissonance/what-if/entropy); Social = people (ownership/lifespan);
Cross-repo = comparative (similarity). (Audit/Gantt floating buttons + the modals
Settings/Wiki/GroupGraph are structural, out of scope — this slice groups the Timeline
analytics buttons only.)

### 3.2 Timeline.tsx — group selector + gate the existing buttons

- Add local state `const [analyticsGroup, setAnalyticsGroup] = useState<PanelGroup>('health');`
- Render a **3-segment selector** (reusing the existing small toolbar-button styling; the
  RightPanel tab idiom) just before the analytics-mode buttons: one segment per
  `PANEL_GROUPS` entry; the active one highlighted. Clicking sets `analyticsGroup`.
- **Gate each existing analytics-button block** (the `<button>` + its associated active
  legend/error sibling divs) in `{analyticsGroup === PANEL_GROUP_OF['<mode>'] && (<> … </>)}`.
  The block internals (onClick enter/exit, active styling, legends, errors) are **moved
  verbatim** inside the conditional — zero behavior change.
- Non-analytics toolbar controls (play, animate, roadmap-animate, nav-mode, mini-map,
  EntropyBadge, commit nav…) stay **outside** any group (always visible).
- An active mode whose group is not currently selected: its overlay/panel on the canvas
  **persists** (state unchanged); only its toolbar button/legend is hidden until its group
  is re-selected. v1 accepts this (documented); a future nicety could auto-select the active
  mode's group.

### 3.3 No state/behavior change beyond the local `analyticsGroup`

The `useAppState` mode flags + enter/exit setters + the mutex logic are untouched. This is
a pure presentation reorganization of `Timeline.tsx` + one new pure config file.

## 4. Verification

- **Unit (host-native vitest)** — `panel-groups.test.mjs`: every `AnalyticsMode` maps to a
  group; `modesInGroup('social')` === `['ownership','lifespan']`; `PANEL_GROUPS` has the 3
  groups; the union of `modesInGroup` over the 3 groups === all modes (no orphan/dup).
- **Web image build (tsc)** gates the `Timeline.tsx` + `panel-groups.ts` changes (JSX +
  types). The binding correctness gate for the refactor.
- **Browser-QA** (best-effort): a UX change ideally wants visual QA — attempted on the test
  stack (alt ports 4847/4273, as the prior Playwright QA did) to confirm the selector
  renders + switching groups shows/hides the right buttons + the canvas overlays still work.
  If the test stack can't boot without disrupting the dev stack (which holds 4747/4173), QA
  is **deferred + flagged** (tsc + the unchanged-button-internals argument stand as the
  evidence; not silently claimed).
- Patch regen + drift (`gitnexus-web/src` is in the patch surface).

## 5. Scope boundaries

**In scope**: the pure `panel-groups` config + the Timeline 3-segment selector + gating the
9 analytics-mode buttons by group. Default Health.

**Out of scope (deferred)**:
- **Floating Audit/Gantt buttons** (App.tsx) + the **modals** (Settings/Wiki/GroupGraph) —
  structural, not part of the analytics flat-row clutter.
- **Auto-select the active mode's group** — v1 is user-driven; the overlay persists.
- **Dropdown popovers** (vs the segmented selector) — the segmented tabs reuse the existing
  pattern + avoid popover/click-outside complexity; a dropdown variant is a later polish.
- **Reorganizing the App.tsx panel mount slots** — unchanged; only the Timeline entry points
  are grouped.

## 6. Open questions

- **Health is heavy (6 of 9).** Reflects reality (most analytics are structural). If it
  feels crowded, a sub-split (Structural vs Quality) is a later refinement.
- **Default group.** Health by default (the most-used structural views); revisit if Social/
  Cross-repo turn out more common in practice.
