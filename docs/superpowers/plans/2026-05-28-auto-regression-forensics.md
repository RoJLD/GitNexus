# Auto Regression Forensics (watch → culprit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand un watch franchit son seuil et fire un webhook, l'enrichir avec le verdict `/regression` complet (commit coupable + fichiers) + une ligne coupable dans le texte Slack, et exposer `lastCulprit` via `GET /watches` — best-effort.

**Architecture:** Tout dans `docker-server-watches.mjs`. Deux pure fns exportées (`mapWatchToRegressionMetric`, `buildWebhookPayload`) pour la testabilité. Au fire (seuil franchi + debounce passé), `fetchRegressionVerdict` appelle notre `/regression`, le résultat est passé à `fireWebhook` (refactoré pour utiliser `buildWebhookPayload`) et stocké en `state.lastCulprit`, surfacé par `GET /watches`.

**Tech Stack:** Node zéro-dep (docker-server pattern), Vitest 4 (unit). Réutilise `/regression` (Tiers 57-58).

**Spec source:** [`docs/superpowers/specs/2026-05-28-auto-regression-forensics-design.md`](../specs/2026-05-28-auto-regression-forensics-design.md)

**Working directory:** `c:\Users\rdenis\VScode\gitnexus` (branche `deployment`)

---

## Environment notes

**Node 21** : vitest crashe (rolldown). Tests committés "blind", CI Node 22 valide. `npm run test:unit` peut crasher → ATTENDU.

**Patches/upstream-all.diff** : UTF-16 LE + CRLF via PowerShell `Out-File -Encoding Unicode`. Regen à chaque tâche touchant `upstream/` :

```
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
```

**Parallel session** : `docker-server-watches.mjs` peut être chaud. Committer vite. Avant chaque commit : `git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null`. Ne JAMAIS committer : `.claude/`, `AGENTS.md`, `roadmap.yml`, `tests/package-lock.json`.

**Git identity** : déjà `roblastar@live.fr`.

**Verified anchors (controller) — current `docker-server-watches.mjs`:**
- `fireWebhook(repoBase, watch, currentValue)` (≈lines 162-190) builds an inline payload literal `{ repoBase, metric, threshold, op, currentValue, triggeredAt, source, text }` (text = `🚨 GitNexus: \`${repoBase}\` ${watch.metric} = ${currentValue.toFixed(4)} ${watch.op} ${watch.threshold} (threshold)`) and POSTs it with a `WATCH_TIMEOUT_MS` AbortController.
- `evaluateRepoWatches` fire site (≈lines 229-233): inside `if (evalResult.ok && evaluateOp(...))` then `if (elapsedSinceLastTrigger >= WATCH_DEBOUNCE_MS) { webhookOutcome = await fireWebhook(repo, w, evalResult.value); webhookFired = true; state.lastTriggeredAt = now; }`.
- `fetchJson(url)` helper (≈lines 95-107) already exists (AbortController + `WATCH_TIMEOUT_MS`, returns `{ ok, body }|{ ok:false, error }`).
- `handleGetWatches` (≈lines 313-356) emits per-watch `state: { lastEvaluatedAt, lastValue, lastError, lastTriggeredAt }`.
- `maybeRegenWiki` + `maybeReindexRepo` are called in the cron loop already (do not disturb).

---

## File Structure

| Path | Rôle | Tâche |
|---|---|---|
| `upstream/docker-server-watches.mjs` | MOD — pure helpers + fetchRegressionVerdict + fireWebhook refactor + fire-time enrichment + /watches lastCulprit | T1, T2, T3 |
| `tests/unit/auto-regression-forensics.test.mjs` | NEW — unit for the 2 pure helpers | T1 |
| `ROADMAP.md` / `INVENTORY.md` / `tests/README.md` / `CLAUDE.md` | docs | T4 |

---

## Task 1: Pure helpers + unit tests

**Files:**
- Modify: `upstream/docker-server-watches.mjs`
- Create: `tests/unit/auto-regression-forensics.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auto-regression-forensics.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { mapWatchToRegressionMetric, buildWebhookPayload } from '../../upstream/docker-server-watches.mjs';

describe('mapWatchToRegressionMetric', () => {
  it('strips entropy. prefix for density/modularity', () => {
    expect(mapWatchToRegressionMetric('entropy.density')).toBe('density');
    expect(mapWatchToRegressionMetric('entropy.modularity')).toBe('modularity');
  });
  it('maps ownership/dissonance metrics to themselves', () => {
    expect(mapWatchToRegressionMetric('ownership.busFactor')).toBe('ownership.busFactor');
    expect(mapWatchToRegressionMetric('ownership.topAuthorShare')).toBe('ownership.topAuthorShare');
    expect(mapWatchToRegressionMetric('dissonance.purity')).toBe('dissonance.purity');
  });
  it('returns null for unmapped metrics (coupling, custom)', () => {
    expect(mapWatchToRegressionMetric('coupling')).toBeNull();
    expect(mapWatchToRegressionMetric('something.custom')).toBeNull();
  });
});

describe('buildWebhookPayload', () => {
  const watch = { metric: 'entropy.density', op: '>', threshold: 0.5 };

  it('without regression: base payload, no culprit line, no regression field', () => {
    const p = buildWebhookPayload('hmm_studio', watch, 0.6, null);
    expect(p.repoBase).toBe('hmm_studio');
    expect(p.metric).toBe('entropy.density');
    expect(p.currentValue).toBe(0.6);
    expect(typeof p.text).toBe('string');
    expect(p.text).not.toMatch(/culprit/i);
    expect('regression' in p).toBe(false);
  });

  it('with regression + worstCommit: regression field + culprit line in text', () => {
    const regression = {
      attribution: 'attributed',
      worstCommit: { sha: 'a8f3c2dXYZ', shortSha: 'a8f3c2d', author: 'Marie', filesTouched: 4 },
    };
    const p = buildWebhookPayload('hmm_studio', watch, 0.6, regression);
    expect(p.regression).toBe(regression);
    expect(p.text).toMatch(/Likely culprit: a8f3c2d by Marie \(4 files\) \[attributed\]/);
  });

  it('with regression but worstCommit null: regression field present, no culprit line', () => {
    const regression = { attribution: 'suspects', worstCommit: null };
    const p = buildWebhookPayload('hmm_studio', watch, 0.6, regression);
    expect(p.regression).toBe(regression);
    expect(p.text).not.toMatch(/culprit/i);
  });

  it('falls back to files[].length when filesTouched absent', () => {
    const regression = { attribution: 'suspects', worstCommit: { sha: 'deadbeefcafe', author: 'Bob', files: [{ path: 'a' }, { path: 'b' }] } };
    const p = buildWebhookPayload('hmm_studio', watch, 0.6, regression);
    expect(p.text).toMatch(/Likely culprit: deadbee by Bob \(2 files\) \[suspects\]/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests; npm run test:unit -- auto-regression-forensics`
Expected: FAIL (imports undefined) or Node 21 crash — proceed.

- [ ] **Step 3: Add the two exported pure helpers**

In `upstream/docker-server-watches.mjs`, add these two exported functions (near the top, after the constants / `metricKey`, BEFORE `fireWebhook`):

```javascript
// Map a watch metric key to the /regression metric param. Returns null for
// metrics /regression doesn't cover (→ no enrichment). See spec § 4.2.
export function mapWatchToRegressionMetric(watchMetric) {
  const MAP = {
    'entropy.density': 'density',
    'entropy.modularity': 'modularity',
    'ownership.busFactor': 'ownership.busFactor',
    'ownership.topAuthorShare': 'ownership.topAuthorShare',
    'dissonance.purity': 'dissonance.purity',
  };
  return MAP[watchMetric] || null;
}

// Build the watch webhook payload. `regression` is the /regression verdict or
// null. Pure (except the triggeredAt timestamp). See spec § 4.2.
export function buildWebhookPayload(repoBase, watch, currentValue, regression) {
  let text = `🚨 GitNexus: \`${repoBase}\` ${watch.metric} = ${currentValue.toFixed(4)} ${watch.op} ${watch.threshold} (threshold)`;
  const wc = regression && regression.worstCommit;
  if (wc && wc.sha) {
    const files = typeof wc.filesTouched === 'number'
      ? wc.filesTouched
      : (Array.isArray(wc.files) ? wc.files.length : null);
    const filesStr = files !== null ? ` (${files} files)` : '';
    const mode = regression.attribution ? ` [${regression.attribution}]` : '';
    text += ` · Likely culprit: ${wc.shortSha || wc.sha.slice(0, 7)} by ${wc.author || 'unknown'}${filesStr}${mode}`;
  }
  const payload = {
    repoBase, metric: watch.metric, threshold: watch.threshold, op: watch.op,
    currentValue, triggeredAt: new Date().toISOString(),
    source: 'gitnexus-watches/2bis.3', text,
  };
  if (regression) payload.regression = regression;
  return payload;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd tests; npm run test:unit -- auto-regression-forensics`
Expected: PASS (7 cases) or Node 21 crash — proceed.

- [ ] **Step 5: Syntax-check + regen + commit**

```
node --check upstream/docker-server-watches.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff tests/unit/auto-regression-forensics.test.mjs
git commit -m "feat(auto-forensics): mapWatchToRegressionMetric + buildWebhookPayload pure helpers + 7 unit cases (Task 1)"
```

---

## Task 2: fetchRegressionVerdict + fireWebhook refactor + fire-time enrichment

**Files:**
- Modify: `upstream/docker-server-watches.mjs`

- [ ] **Step 1: Add `fetchRegressionVerdict`**

In `docker-server-watches.mjs`, add (after the pure helpers from Task 1, before `fireWebhook`):

```javascript
// Fetch the /regression verdict for a watch metric (best-effort). Returns the
// verdict body, or null if the metric isn't covered or the call fails/timeouts.
async function fetchRegressionVerdict(repoBase, watchMetric, webBase) {
  const m = mapWatchToRegressionMetric(watchMetric);
  if (!m) return null;
  const r = await fetchJson(`${webBase}/regression?repo=${encodeURIComponent(repoBase)}&metric=${encodeURIComponent(m)}`);
  return r.ok ? r.body : null;
}
```

(`fetchJson` already exists with the `WATCH_TIMEOUT_MS` abort, so the regression call is bounded.)

- [ ] **Step 2: Refactor `fireWebhook` to take a `regression` arg + use `buildWebhookPayload`**

Find `fireWebhook` (≈line 162). Change its signature to `async function fireWebhook(repoBase, watch, currentValue, regression)` and REPLACE the inline `const text = ...` + `const payload = { ... }` block with:

```javascript
  const payload = buildWebhookPayload(repoBase, watch, currentValue, regression);
```

Keep everything else (the `if (!watch.webhook) return ...` guard, the AbortController POST, the return) EXACTLY as-is. The `text` is now inside `payload.text` (built by the helper) — remove the now-dead standalone `text` const.

- [ ] **Step 3: Enrich at the fire site in `evaluateRepoWatches`**

Find the fire site (≈line 229-233):

```javascript
      const elapsedSinceLastTrigger = now - (prior.lastTriggeredAt || 0);
      if (elapsedSinceLastTrigger >= WATCH_DEBOUNCE_MS) {
        webhookOutcome = await fireWebhook(repo, w, evalResult.value);
        webhookFired = true;
        state.lastTriggeredAt = now;
      } else {
```

Replace the inner block (inside `if (elapsedSinceLastTrigger >= WATCH_DEBOUNCE_MS)`) with:

```javascript
      if (elapsedSinceLastTrigger >= WATCH_DEBOUNCE_MS) {
        // "Auto" regression forensics: fetch the culprit before firing (best-
        // effort — webhook fires even if /regression fails). See spec § 4.3.
        const regression = await fetchRegressionVerdict(repo, w.metric, webBase);
        webhookOutcome = await fireWebhook(repo, w, evalResult.value, regression);
        webhookFired = true;
        state.lastTriggeredAt = now;
        state.lastCulprit = regression && regression.worstCommit
          ? {
              sha: regression.worstCommit.sha,
              shortSha: regression.worstCommit.shortSha || (regression.worstCommit.sha ? regression.worstCommit.sha.slice(0, 7) : null),
              author: regression.worstCommit.author || null,
              attribution: regression.attribution || null,
              filesTouched: typeof regression.worstCommit.filesTouched === 'number' ? regression.worstCommit.filesTouched : (Array.isArray(regression.worstCommit.files) ? regression.worstCommit.files.length : null),
              at: new Date(now).toISOString(),
            }
          : null;
      } else {
```

(`webBase` is in scope in `evaluateRepoWatches` — it's a parameter. `state` is the object being assembled. Confirm by reading the function: `state` already holds `lastEvaluatedAt`/`lastValue`/`lastError`; we add `lastCulprit`. Note: `_evalState.set(k, state)` happens after this block, so the new field persists.)

- [ ] **Step 4: Syntax-check + regen + commit**

```
node --check upstream/docker-server-watches.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(auto-forensics): fetch /regression at fire-time + enrich webhook + state.lastCulprit (Task 2)"
```

---

## Task 3: Expose `lastCulprit` via `GET /watches`

**Files:**
- Modify: `upstream/docker-server-watches.mjs`

- [ ] **Step 1: Add `lastCulprit` to the /watches state object**

In `handleGetWatches` (≈lines 313-356), find where it builds the per-watch `state` object for the response (≈lines 337-342):

```javascript
        state: state ? {
          lastEvaluatedAt: state.lastEvaluatedAt ? new Date(state.lastEvaluatedAt).toISOString() : null,
          lastValue: state.lastValue,
          lastError: state.lastError,
          lastTriggeredAt: state.lastTriggeredAt ? new Date(state.lastTriggeredAt).toISOString() : null,
        } : null,
```

Add `lastCulprit` to that object (the stored value is already an object with an ISO `at` field, or null):

```javascript
        state: state ? {
          lastEvaluatedAt: state.lastEvaluatedAt ? new Date(state.lastEvaluatedAt).toISOString() : null,
          lastValue: state.lastValue,
          lastError: state.lastError,
          lastTriggeredAt: state.lastTriggeredAt ? new Date(state.lastTriggeredAt).toISOString() : null,
          lastCulprit: state.lastCulprit || null,
        } : null,
```

(Read the function first to match the exact current shape; add only the one line. If the `state` literal differs slightly, mirror its style.)

- [ ] **Step 2: Syntax-check + regen + commit**

```
node --check upstream/docker-server-watches.mjs
powershell -NoProfile -Command "Set-Location 'c:\Users\rdenis\VScode\gitnexus\upstream'; & git add -N . ; \$diff = & git diff HEAD ; \$diff | Out-File -FilePath '..\patches\upstream-all.diff' -Encoding Unicode ; & git reset *> \$null"
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add patches/upstream-all.diff
git commit -m "feat(auto-forensics): expose lastCulprit in GET /watches state (Task 3)"
```

---

## Task 4: Docs + build validation + final commit

**Files:**
- Modify: `ROADMAP.md`, `INVENTORY.md`, `tests/README.md`, `CLAUDE.md`

- [ ] **Step 1: Build + smoke**

```
docker compose build gitnexus-web
docker compose up -d gitnexus gitnexus-web
```

Wait for the web server, then confirm `/watches` still 200 + carries the new field shape (will be `lastCulprit: null` until a watch fires):

```
curl -s -o /dev/null -w "watches: HTTP %{http_code}\n" "http://localhost:4173/watches"
curl -s "http://localhost:4173/watches" | head -c 300
```

Expected: 200. (A real fire needs a configured watch + webhook + threshold crossing — manual verification, documented in the spec § 6; not part of the smoke.) Also confirm `/regression` still 200 (the dependency): `curl -s -o /dev/null -w "regression: %{http_code}\n" "http://localhost:4173/regression?repo=hmm_studio&metric=density"`.

- [ ] **Step 2: CLAUDE.md note**

The `/watches` endpoint is already in the smoke loop. Near it, add a one-line comment that watch webhooks are now auto-enriched with the regression culprit (no new endpoint). Find the `watches: HTTP` curl line (grep `watches: HTTP`) and add above it:

```bash
# Watch webhooks are auto-enriched with the /regression culprit (Tier 59);
# GET /watches state now carries lastCulprit (null until a watch fires).
```

- [ ] **Step 3: ROADMAP.md**

Add a "Déjà livré" row (`grep "^| 58 " ROADMAP.md` → next number):

```markdown
| 59 | **"Auto" regression forensics (watch → culprit)** : quand un watch (Tier 2bis.3) franchit son seuil et fire, le webhook est enrichi avec le verdict `/regression` complet (commit coupable + fichiers) + une ligne coupable dans le texte Slack ; `GET /watches` expose `state.lastCulprit`. Best-effort (le webhook fire même si `/regression` échoue). Mapping `entropy.density→density` etc. Complète l'item enterprise "Auto regression forensics". Coupling non couvert (pas d'évaluateur watch). | `docker-server-watches.mjs` (`mapWatchToRegressionMetric`, `buildWebhookPayload`, `fetchRegressionVerdict`, fire-time enrichment, `lastCulprit`) |
```

In the enterprise table, "Auto regression forensics" → ✅ (auto livré ; reste l'UI highlight optionnel). Bump date header.

- [ ] **Step 4: INVENTORY.md**

In the `/watches` / watches-engine entry, note: webhook payloads now carry the full `/regression` verdict + a Slack culprit line; `GET /watches` state carries `lastCulprit`. Mapping + best-effort. Coupling gap noted.

- [ ] **Step 5: tests/README.md**

Add: unit `auto-regression-forensics.test.mjs` (mapWatchToRegressionMetric + buildWebhookPayload, 7 cases).

- [ ] **Step 6: Final commit**

```
git reset HEAD tests/unit/cluster-layout.test.mjs 2>$null
git add ROADMAP.md INVENTORY.md tests/README.md CLAUDE.md
git commit -m "Auto regression forensics livré: ROADMAP #59/INVENTORY/CLAUDE/tests (Task 4)"
```

(No patch regen — Task 4 touches only top-level docs.)

---

## Self-Review

**Spec coverage:**
- ✅ Spec § 4.2 pure helpers (`mapWatchToRegressionMetric` + `buildWebhookPayload`) → Task 1 with full code + 7 unit cases.
- ✅ Spec § 4.3 fire-time enrichment (`fetchRegressionVerdict`, fireWebhook arg, fire-site call, `state.lastCulprit`) → Task 2.
- ✅ Spec § 4.4 `/watches` exposure of `lastCulprit` → Task 3.
- ✅ Spec § 3 mapping (entropy.* stripped, others identity) → Task 1 MAP.
- ✅ Spec § 3 best-effort (webhook fires even if /regression fails) → Task 2 (`fetchRegressionVerdict` returns null on failure; fireWebhook builds payload without `regression`).
- ✅ Spec § 5 edge cases (unmapped→null, /regression fail→plain, regressed:false→verdict attached/no culprit line, worstCommit null→no line) → Tasks 1+2 code + Task 1 tests.
- ✅ Spec § 5 perf (fetch only at fire, after debounce) → Task 2 places the fetch inside the `>= WATCH_DEBOUNCE_MS` branch.
- ✅ Spec § 6 testing (unit pure helpers + /watches smoke) → Task 1 + Task 4.
- ✅ Spec § 10 docs → Task 4.
- ✅ Spec § 7 coupling gap → documented in ROADMAP row (Task 3 Step 3... Task 4 Step 3).

**Placeholder scan:**
- ✅ Full code for the helpers, the refactor, the fire-site block, the /watches line, the tests.
- ⚠️ Tasks 2/3 use grep-anchored edits to existing `fireWebhook` / `evaluateRepoWatches` / `handleGetWatches` (the surrounding code is quoted from the verified anchors; the precise replacement is given). Intentional.

**Type/contract consistency:**
- ✅ `mapWatchToRegressionMetric(watchMetric)` → string|null — Task 1 def + tests, used by `fetchRegressionVerdict` (Task 2).
- ✅ `buildWebhookPayload(repoBase, watch, currentValue, regression)` → payload object — Task 1 def + tests, called by `fireWebhook` (Task 2).
- ✅ `fetchRegressionVerdict(repoBase, watchMetric, webBase)` → verdict|null — Task 2 def, called at fire site (Task 2) with `(repo, w.metric, webBase)`.
- ✅ `state.lastCulprit` shape `{ sha, shortSha, author, attribution, filesTouched, at }|null` — set in Task 2, surfaced in Task 3.
- ✅ `fireWebhook` 4-arg signature — Task 2 def + the single call site updated in the same task.

**Scope:** tiny, one module + one test, 4 tasks, ~2 days. Fits one plan.

Plan ready for execution.

---

## Effort summary

| Task | Estimate |
|---|---|
| 1. Pure helpers + 7 unit cases | ~½j |
| 2. fetchRegressionVerdict + fireWebhook refactor + fire-site enrichment | ~½j |
| 3. /watches lastCulprit | ~¼j |
| 4. Docs + build + smoke | ~½j |
| **Total** | **~2 jours** |
