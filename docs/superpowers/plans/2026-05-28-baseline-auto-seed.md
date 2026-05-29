# Baseline auto-seed (Plan 2/3 — pièce B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rendre la nav par-commit *turnkey* : quand aucun jalon n'est ancêtre du commit visé, seeder un **baseline caché** en arrière-plan (analyze complet), et permettre de le **promouvoir en jalon** plus tard.

**Architecture:** Un baseline = un snapshot normal (réutilise `createSnapshot`) marqué par un fichier sentinelle `.hidden` dans son dossier. `/snapshots` l'exclut par défaut (param `?includeHidden=true` pour le voir + champ `hidden`). `findNearestBaseline` les voit toujours (le `.hidden` ne masque que l'UI, pas la reconstruction). Le seed tourne en async, exposé via un endpoint de statut *pollable*. Promote = supprimer le `.hidden`.

**Tech Stack:** Node http (`docker-server-*.mjs`), React + Vitest, vérif via Docker (host Node 21 < 22 bloque vitest/vite — voir notes).

**Parent spec :** [2026-05-28-commit-level-time-travel-design.md](../specs/2026-05-28-commit-level-time-travel-design.md) §3.3. **Précède** : Plan 1 (commit-mode timeline) livré. **Suit** : Plan 3 (pré-chauffage C).

## Décisions de design (raffinent le spec §3.3 — à valider en revue)
1. **Flag `hidden` = fichier sentinelle `<snapshotDir>/.hidden`** (présence = caché), pas de mutation de `commit.json`. Promote = `rm .hidden`.
2. **Seed = endpoint de statut *pollable*** (`GET /snapshot/baseline-seed/:jobId` → JSON `{state,phase}`), pas SSE. Plus simple ; le chip de progression n'a besoin que de phases grossières. *(Déviation du spec qui suggérait SSE/pattern bulk → amendement spec en Task 8.)*
3. **Promote vit dans `SnapshotsPanel`** (sous-section "Internal baselines"), pas sur les dots timeline. **Seed déclenché au clic** quand la reconstruction renvoie "no baseline" (409 `needsBaseline`), pas auto à l'entrée du mode — moins agressif, conforme "background non-bloquant".

## Notes d'environnement (identiques au Plan 1)
- Shell PowerShell par défaut (pas de `&&`) → **outil Bash** pour les commandes chaînées.
- `upstream/` **gitignore-d** → jamais `git add upstream/...` ; edits sérialisés dans `patches/upstream-all.diff` (regen Task 8). Commits par-tâche = fichiers `tests/` seulement.
- **Docker requis** pour build + smoke (host vitest/vite bloqués Node 21). Le nouveau module doit avoir sa **ligne `COPY` dans `Dockerfile.web`** (sinon crash-loop).
- Identité git `roblastar@live.fr`.

## File Structure
- **Create** `upstream/docker-server-baseline-seed.mjs` — endpoints `POST /snapshot/baseline-seed`, `GET /snapshot/baseline-seed/:jobId`, `POST /snapshot/promote`. Pures : `isHiddenMarkerPath` helper trivial inline.
- **Modify** `upstream/docker-server-snapshots.mjs` — `handleListSnapshots` : champ `hidden` + filtre `?includeHidden`. Export `hiddenMarkerPath(snapshotDir)`.
- **Modify** `upstream/docker-server-snapshot-incremental.mjs` — ajouter `needsBaseline: true` à la réponse 409 "no snapshot is an ancestor".
- **Modify** `upstream/docker-server.mjs` — mount + import.
- **Modify** `upstream/Dockerfile.web` — COPY du nouveau module.
- **Modify** `upstream/gitnexus-web/src/hooks/useAppState.tsx` — `atCommitNeedsBaseline`, `seedBaseline`, `seedingBaseline`, `seedPhase`.
- **Modify** `upstream/gitnexus-web/src/components/Timeline.tsx` — bouton "Seed baseline" + chip de progression (mode Commits).
- **Modify** `upstream/gitnexus-web/src/components/SnapshotsPanel.tsx` — `?includeHidden=true` + sous-section "Internal baselines" + bouton Promote.
- **Create** `tests/unit/baseline-seed-marker.test.mjs`, `tests/integration/endpoints/baseline-seed.test.mjs`.

---

### Task 1 : `.hidden` marker — `/snapshots` exclut par défaut, champ `hidden`, `?includeHidden`

**Files:**
- Modify: `upstream/docker-server-snapshots.mjs`
- Test: `tests/unit/baseline-seed-marker.test.mjs`

- [ ] **Step 1 : Test unit qui échoue** — `tests/unit/baseline-seed-marker.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { hiddenMarkerPath } from '../../upstream/docker-server-snapshots.mjs';

describe('hiddenMarkerPath', () => {
  it('returns the .hidden sentinel path inside a snapshot dir', () => {
    expect(hiddenMarkerPath('/data/gitnexus/snapshots/demo/abc123')).toBe(
      '/data/gitnexus/snapshots/demo/abc123/.hidden',
    );
  });
});
```

- [ ] **Step 2 : Run, expect FAIL** (export absent) :
`cd tests && npx vitest run --config vitest.config.unit.mjs baseline-seed-marker`

- [ ] **Step 3 : Implémenter dans `docker-server-snapshots.mjs`**

(a) Ajouter l'import `stat` est déjà présent (`import { ..., stat, ... } from 'node:fs/promises'`). Ajouter après `export function safeSnapshotKey(...) {...}` :

```js
// Sentinelle "baseline interne caché" (commit-level time-travel §3.3) :
// la présence de <snapshotDir>/.hidden exclut le snapshot du listing UI.
// findNearestBaseline ne consulte PAS ce marqueur (la reconstruction voit
// tous les baselines) — il ne masque que l'affichage.
export function hiddenMarkerPath(snapshotDir) {
  return join(snapshotDir, '.hidden');
}
```

(b) Dans `handleListSnapshots`, lire le param + filtrer. Remplacer la boucle de construction `snapshots` : après `const repoSnapshotsDir = ...`, lire `const includeHidden = url.searchParams.get('includeHidden') === 'true';`. Dans la boucle `for (const e of entries)`, après avoir parsé `commit`, ajouter :

```js
    const snapshotDir = join(repoSnapshotsDir, e.name);
    const hidden = !!(await stat(hiddenMarkerPath(snapshotDir)).catch(() => null));
    if (hidden && !includeHidden) continue;
```

et ajouter `hidden` à l'objet poussé :

```js
    snapshots.push({
      key: e.name,
      name: `${repoName}@${e.name}`,
      path: join(snapshotDir, 'source'),
      commit,
      hidden,
    });
```

*(Note : `snapshotDir` est déjà calculé en haut de la boucle existante — réutiliser, ne pas redéclarer.)*

- [ ] **Step 4 : Run, expect PASS** :
`cd tests && npx vitest run --config vitest.config.unit.mjs baseline-seed-marker`
*(Si bloqué par Node 21 : vérifier via le build Docker en Task 8 + smoke.)*

- [ ] **Step 5 : Commit**
```bash
git add tests/unit/baseline-seed-marker.test.mjs
git commit -m "feat(baseline): .hidden marker — /snapshots excludes by default + hidden field + includeHidden (Task 1)"
```

---

### Task 2 : `POST /snapshot/promote` + `POST /snapshot/baseline-seed` + `GET /snapshot/baseline-seed/:jobId`

**Files:**
- Create: `upstream/docker-server-baseline-seed.mjs`
- Modify: `upstream/docker-server.mjs`, `upstream/Dockerfile.web`
- Test: `tests/integration/endpoints/baseline-seed.test.mjs`

- [ ] **Step 1 : Écrire le module** `upstream/docker-server-baseline-seed.mjs`

```js
/**
 * Baseline auto-seed (commit-level time-travel §3.3).
 *
 *   POST /snapshot/baseline-seed?repo=&commit=  → { jobId } (202), analyze
 *        complet en arrière-plan via createSnapshot, puis écrit le marqueur
 *        .hidden (baseline interne, exclu du listing UI).
 *   GET  /snapshot/baseline-seed/:jobId         → { state, phase, snapshot?, error? }
 *        (pollable ; pas de SSE — un chip de progression suffit).
 *   POST /snapshot/promote?repo=&commit=        → supprime .hidden (devient un jalon).
 *
 * Jobs en mémoire (low-frequency, déclenché manuellement). Si le conteneur
 * redémarre en plein seed, le snapshot partiel reste sur disque (createSnapshot
 * est idempotent) ; seul le canal de progression est perdu.
 */
import { randomUUID } from 'node:crypto';
import { rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createSnapshot,
  findRepoByName,
  getCommitInfo,
  hiddenMarkerPath,
  SNAPSHOTS_ROOT,
  safeSnapshotKey,
} from './docker-server-snapshots.mjs';

const jobs = new Map();
const FINISHED_TTL_MS = 60 * 1000;

function reap() {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (j.finishedAt && now - j.finishedAt > FINISHED_TTL_MS) jobs.delete(id);
  }
}

async function handleSeed(url, res, opts) {
  reap();
  const repoName = url.searchParams.get('repo');
  const commitRef = url.searchParams.get('commit');
  if (!repoName || !commitRef) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing repo or commit' }));
    return;
  }
  const id = randomUUID();
  const job = { id, state: 'running', phase: 'starting', snapshot: null, error: null, finishedAt: null };
  jobs.set(id, job);

  (async () => {
    try {
      const result = await createSnapshot({
        repoName,
        commitRef,
        api: opts.api,
        onPhase: (phase) => {
          job.phase = phase;
        },
      });
      // Marquer le snapshot comme baseline caché.
      const marker = hiddenMarkerPath(result.snapshot.dir);
      await writeFile(marker, 'baseline-seed\n', 'utf8');
      job.snapshot = { name: result.snapshot.name, commit: result.snapshot.commit };
      job.phase = 'done';
      job.state = 'done';
    } catch (err) {
      job.state = 'failed';
      job.error = err?.message || 'seed failed';
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  res.writeHead(202, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jobId: id }));
}

function handleSeedStatus(jobId, res) {
  reap();
  const job = jobs.get(jobId);
  if (!job) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'job not found' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ state: job.state, phase: job.phase, snapshot: job.snapshot, error: job.error }));
}

async function handlePromote(url, res, opts) {
  const repoName = url.searchParams.get('repo');
  const commitRef = url.searchParams.get('commit');
  if (!repoName || !commitRef) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing repo or commit' }));
    return;
  }
  const baseRepo = repoName.split('@')[0];
  // Résoudre le shortHash → la clé de dossier (comme createSnapshot/list).
  let key;
  try {
    const live = await findRepoByName(baseRepo, opts.api);
    if (!live) throw new Error(`repo not found: ${baseRepo}`);
    const info = await getCommitInfo(live.repoPath || live.path, commitRef);
    key = safeSnapshotKey(info.shortHash);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `commit not found: ${commitRef} (${err.message})` }));
    return;
  }
  const snapshotDir = join(SNAPSHOTS_ROOT, safeSnapshotKey(baseRepo), key);
  const marker = hiddenMarkerPath(snapshotDir);
  if (!(await stat(marker).catch(() => null))) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no hidden baseline at this commit (already a milestone or unknown)' }));
    return;
  }
  await rm(marker, { force: true });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, name: `${baseRepo}@${key}` }));
}

export async function handleBaselineSeedRoute(req, url, res, opts) {
  if (url.pathname === '/snapshot/baseline-seed' && req.method === 'POST') {
    await handleSeed(url, res, opts);
    return true;
  }
  const m = url.pathname.match(/^\/snapshot\/baseline-seed\/([A-Za-z0-9-]+)$/);
  if (m && req.method === 'GET') {
    handleSeedStatus(m[1], res);
    return true;
  }
  if (url.pathname === '/snapshot/promote' && req.method === 'POST') {
    await handlePromote(url, res, opts);
    return true;
  }
  return false;
}
```

- [ ] **Step 2 : Exporter `getCommitInfo`** depuis `docker-server-snapshots.mjs` si pas déjà exporté.

Vérifier : `getCommitInfo` est déjà `export async function getCommitInfo(...)` (ligne ~97). `SNAPSHOTS_ROOT`, `safeSnapshotKey`, `findRepoByName`, `createSnapshot` sont déjà exportés. `hiddenMarkerPath` ajouté en Task 1. Aucune action si tout est exporté.

- [ ] **Step 3 : Monter dans `docker-server.mjs`**

Import après `import { handleCommitsRoute } ...` :
```js
import { handleBaselineSeedRoute } from './docker-server-baseline-seed.mjs';
```
Route après `if (await handleCommitsRoute(...)) return;` :
```js
  // Baseline auto-seed (caché) + promote (commit-level time-travel §3.3)
  if (await handleBaselineSeedRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;
```

- [ ] **Step 4 : COPY dans `Dockerfile.web`** — après la ligne `COPY docker-server-commits.mjs ./docker-server-commits.mjs` :
```
COPY docker-server-baseline-seed.mjs ./docker-server-baseline-seed.mjs
```

- [ ] **Step 5 : Test d'intégration** `tests/integration/endpoints/baseline-seed.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('baseline-seed + promote', () => {
  it('400 when repo/commit missing', async () => {
    expect((await fetch(`${BASE}/snapshot/baseline-seed`, { method: 'POST' })).status).toBe(400);
    expect((await fetch(`${BASE}/snapshot/promote`, { method: 'POST' })).status).toBe(400);
  });

  it('seeds a hidden baseline, hides it from /snapshots, then promote reveals it', async () => {
    // oldest commit du fixture
    const commits = await (await fetch(`${BASE}/commits?repo=${FIXTURE.name}`)).json();
    const oldest = commits.commits[commits.commits.length - 1];

    const seed = await fetch(`${BASE}/snapshot/baseline-seed?repo=${FIXTURE.name}&commit=${oldest.hash}`, { method: 'POST' });
    expect(seed.status).toBe(202);
    const { jobId } = await seed.json();

    // poll jusqu'à done (analyze peut prendre ~1-2 min sur le petit fixture)
    let state = 'running';
    for (let i = 0; i < 120 && state === 'running'; i++) {
      await sleep(2000);
      const s = await (await fetch(`${BASE}/snapshot/baseline-seed/${jobId}`)).json();
      state = s.state;
    }
    expect(state).toBe('done');

    // exclu par défaut, présent avec includeHidden + hidden:true
    const def = await (await fetch(`${BASE}/snapshots?repo=${FIXTURE.name}`)).json();
    const withHidden = await (await fetch(`${BASE}/snapshots?repo=${FIXTURE.name}&includeHidden=true`)).json();
    const inDefault = def.snapshots.some((s) => s.commit.shortHash === oldest.shortHash);
    const hiddenEntry = withHidden.snapshots.find((s) => s.commit.shortHash === oldest.shortHash);
    expect(inDefault).toBe(false);
    expect(hiddenEntry?.hidden).toBe(true);

    // promote → réapparaît dans le listing par défaut
    expect((await fetch(`${BASE}/snapshot/promote?repo=${FIXTURE.name}&commit=${oldest.hash}`, { method: 'POST' })).status).toBe(200);
    const after = await (await fetch(`${BASE}/snapshots?repo=${FIXTURE.name}`)).json();
    expect(after.snapshots.some((s) => s.commit.shortHash === oldest.shortHash)).toBe(true);
  });
});
```

- [ ] **Step 6 : Commit**
```bash
git add tests/integration/endpoints/baseline-seed.test.mjs
git commit -m "feat(baseline): POST /snapshot/baseline-seed (hidden) + status poll + /snapshot/promote (Task 2)"
```

---

### Task 3 : at-commit `needsBaseline` flag

**Files:**
- Modify: `upstream/docker-server-snapshot-incremental.mjs`
- Test: assertion ajoutée dans `tests/integration/endpoints/baseline-seed.test.mjs`

- [ ] **Step 1 : Ajouter le flag** — dans `handleGraphAtCommit`, la réponse 409 "no snapshot is an ancestor" (le `if (!baseline) { ... }`). Ajouter `needsBaseline: true` à l'objet JSON :

```js
    res.end(JSON.stringify({
      error: 'no snapshot is an ancestor of this commit — seed a baseline first',
      needsBaseline: true,
      hint: 'POST /snapshot/baseline-seed?repo=<base>&commit=<sha> (or /snapshot) to create a baseline, then retry',
    }));
```

- [ ] **Step 2 : Test** — ajouter dans `baseline-seed.test.mjs` un cas qui, sur un repo SANS aucun snapshot ancêtre, attend `needsBaseline:true`. *(Note : dépend de l'état ; si le fixture a déjà des snapshots, ce cas peut être skip — l'assertion principale est le seed/promote ci-dessus. Garder simple : asserter la forme du flag via un commit orphelin si dispo, sinon documenter.)*

- [ ] **Step 3 : Commit**
```bash
git commit --allow-empty -m "feat(baseline): /graph/at-commit returns needsBaseline:true on no-baseline 409 (Task 3)"
```
*(Le code est dans upstream/ → sérialisé en Task 8 ; commit doc-only ici.)*

---

### Task 4 : useAppState — `atCommitNeedsBaseline` + `seedBaseline`

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx`

- [ ] **Step 1 : État** — près des autres `atCommit*` useState (~ligne 940) :
```tsx
  const [atCommitNeedsBaseline, setAtCommitNeedsBaseline] = useState(false);
  const [seedingBaseline, setSeedingBaseline] = useState(false);
  const [seedPhase, setSeedPhase] = useState<string | null>(null);
```

- [ ] **Step 2 : Détecter le 409 no-baseline dans `loadGraphAtCommit`** — dans le `if (resp.status === 409)`, distinguer :
```tsx
        if (resp.status === 409) {
          if (body.needsBaseline) {
            setAtCommitNeedsBaseline(true);
            throw new Error(body.error || 'no baseline ancestor — seed one first');
          }
          setAtCommitMissingDiffs(Array.isArray(body.missingDiffs) ? body.missingDiffs.length : 0);
          throw new Error(body.error || 'missing diffs in the replay chain');
        }
```
Et au début du `try` (avec les autres resets) : `setAtCommitNeedsBaseline(false);`.

- [ ] **Step 3 : Action `seedBaseline`** — après `loadGraphAtCommit` :
```tsx
  // Seed un baseline caché en arrière-plan puis retente la reconstruction.
  const seedBaseline = useCallback(
    async (sha: string) => {
      if (!projectName) return;
      const baseRepo = projectName.split('@')[0];
      setSeedingBaseline(true);
      setSeedPhase('starting');
      try {
        const resp = await fetch(
          `/snapshot/baseline-seed?repo=${encodeURIComponent(baseRepo)}&commit=${encodeURIComponent(sha)}`,
          { method: 'POST' },
        );
        if (!resp.ok) throw new Error(`seed failed: HTTP ${resp.status}`);
        const { jobId } = await resp.json();
        // Poll jusqu'à done/failed.
        for (;;) {
          await new Promise((r) => setTimeout(r, 2000));
          const s = await (await fetch(`/snapshot/baseline-seed/${jobId}`)).json();
          setSeedPhase(s.phase || s.state);
          if (s.state === 'done') break;
          if (s.state === 'failed') throw new Error(s.error || 'seed failed');
        }
        setAtCommitNeedsBaseline(false);
        await loadGraphAtCommit(sha);
      } catch (err) {
        setAtCommitError(err instanceof Error ? err.message : 'baseline seed failed');
      } finally {
        setSeedingBaseline(false);
        setSeedPhase(null);
      }
    },
    [projectName, loadGraphAtCommit],
  );
```

- [ ] **Step 4 : Exposer** dans l'interface + le `return` : `atCommitNeedsBaseline`, `seedingBaseline`, `seedPhase`, `seedBaseline`. Et reset `atCommitNeedsBaseline=false` dans `exitGraphAtCommit`.

- [ ] **Step 5 : Commit** (pas de test host runnable — composant) :
```bash
git commit --allow-empty -m "feat(baseline): useAppState atCommitNeedsBaseline + seedBaseline poll action (Task 4)"
```

---

### Task 5 : Timeline — bouton "Seed baseline" + chip de progression

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Test: `tests/unit/components/Timeline.commits.test.tsx` (ajout)

- [ ] **Step 1 : Cas de test** (ajout au fichier existant) :
```tsx
  it('shows a Seed baseline button when atCommitNeedsBaseline and triggers seedBaseline', async () => {
    currentState = { ...defaultAppState, seedBaseline: vi.fn(), atCommitSha: 'h_new', atCommitNeedsBaseline: true };
    render(<Timeline />);
    fireEvent.click(await screen.findByTestId('navmode-commits'));
    fireEvent.click(await screen.findByTestId('seed-baseline-btn'));
    expect(currentState.seedBaseline).toHaveBeenCalledWith('h_new');
  });
```
Ajouter aussi à `defaultAppState` du fichier : `seedBaseline: vi.fn(), atCommitNeedsBaseline: false, seedingBaseline: false, seedPhase: null`.

- [ ] **Step 2 : Destructurer** dans Timeline (avec les autres atCommit*) : `atCommitNeedsBaseline`, `seedingBaseline`, `seedPhase`, `seedBaseline`.

- [ ] **Step 3 : UI** — dans le bloc des strips mode Commits (à côté du strip missing-diffs ajouté au Plan 1), ajouter :
```tsx
      {navMode === 'commits' && atCommitNeedsBaseline && atCommitSha && !seedingBaseline && (
        <div className="flex items-center justify-center gap-2 border-t border-dashed border-border-subtle px-4 py-1 text-[10px] text-violet-200">
          Aucun jalon ancêtre — un baseline est nécessaire pour reconstruire ce commit.
          <button
            type="button"
            data-testid="seed-baseline-btn"
            onClick={() => atCommitSha && seedBaseline(atCommitSha)}
            className="rounded border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 font-medium text-violet-200 transition-all hover:bg-violet-500/25"
          >
            Seed baseline (~3-5 min, en fond)
          </button>
        </div>
      )}
      {navMode === 'commits' && seedingBaseline && (
        <div data-testid="seeding-baseline-chip" className="border-t border-dashed border-border-subtle px-4 py-1 text-center text-[10px] text-violet-200">
          Seeding baseline… {seedPhase || ''}
        </div>
      )}
```

- [ ] **Step 4 : Run** `cd tests && npx vitest run --config vitest.config.unit.mjs Timeline.commits` (ou Docker build si Node 21).

- [ ] **Step 5 : Commit**
```bash
git add tests/unit/components/Timeline.commits.test.tsx
git commit -m "feat(baseline): Timeline seed-baseline button + seeding chip (Task 5)"
```

---

### Task 6 : SnapshotsPanel — "Internal baselines" + Promote

**Files:**
- Modify: `upstream/gitnexus-web/src/components/SnapshotsPanel.tsx`

- [ ] **Step 1 : Fetch includeHidden** — changer le fetch `/snapshots?repo=...` en `/snapshots?repo=...&includeHidden=true`. Le type `SnapshotEntry` gagne `hidden?: boolean`.

- [ ] **Step 2 : Séparer visibles / cachés** — après le fetch, dériver `const visible = snapshots.filter((s) => !s.hidden); const baselines = snapshots.filter((s) => s.hidden);`. Le `.map` existant itère `visible`.

- [ ] **Step 3 : Sous-section + Promote** — après la liste des `visible`, si `baselines.length > 0` :
```tsx
      {baselines.length > 0 && (
        <div className="border-t border-border-subtle/50 pt-1">
          <div className="px-3 py-1 text-[10px] font-medium tracking-wider text-text-muted uppercase">
            Internal baselines (auto-seeded)
          </div>
          {baselines.map((s) => (
            <div key={s.key} className="group flex items-center gap-2 px-4 py-1.5 hover:bg-hover">
              <span className="font-mono text-[11px] text-violet-300 shrink-0">{s.commit.shortHash}</span>
              <span className="flex-1 truncate text-[11px] text-text-muted">{s.commit.message || '(no message)'}</span>
              <button
                type="button"
                onClick={async () => {
                  await fetch(`/snapshot/promote?repo=${encodeURIComponent(repoName)}&commit=${encodeURIComponent(s.commit.hash)}`, { method: 'POST' });
                  setLocalRefresh((n) => n + 1);
                  onChanged();
                }}
                className="shrink-0 rounded border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-200 hover:bg-violet-500/25"
              >
                Promouvoir en jalon
              </button>
            </div>
          ))}
        </div>
      )}
```
*(`setLocalRefresh` + `onChanged` existent déjà dans le composant.)*

- [ ] **Step 4 : Commit**
```bash
git commit --allow-empty -m "feat(baseline): SnapshotsPanel Internal-baselines section + Promote (Task 6)"
```

---

### Task 7 : Build, smoke, docs, patch

- [ ] **Step 1 : Build** `docker compose build gitnexus-web` (compile gate) → exit 0. Puis `docker compose up -d gitnexus-web`.
- [ ] **Step 2 : Smoke** (ajouter au smoke loop de `CLAUDE.md` + lancer) :
```bash
# Baseline seed/promote (commit-level time-travel B) — endpoints répondent.
curl -s -o /dev/null -w "snapshot/promote (no marker): HTTP %{http_code}\n" \
  -X POST "http://localhost:4173/snapshot/promote?repo=hmm_studio&commit=HEAD"   # 404 attendu si pas caché
curl -s -o /dev/null -w "baseline-seed (missing args): HTTP %{http_code}\n" \
  -X POST "http://localhost:4173/snapshot/baseline-seed"                          # 400 attendu
```
- [ ] **Step 3 : INVENTORY.md** — 2 lignes (`POST /snapshot/baseline-seed` + `GET .../:jobId` ; `POST /snapshot/promote`) ; mentionner le champ `hidden` + `?includeHidden` sur `/snapshots`.
- [ ] **Step 4 : Spec amendment** — dans `docs/superpowers/specs/2026-05-28-commit-level-time-travel-design.md`, section `## Update 2026-05-28 — Plan 2 (B) : poll au lieu de SSE, promote dans SnapshotsPanel` (déviations 2 & 3 ci-dessus).
- [ ] **Step 5 : ROADMAP.md** — marquer la pièce B livrée.
- [ ] **Step 6 : Regen patch** :
```bash
git -C upstream add -N . && git -C upstream diff HEAD > patches/upstream-all.diff && git -C upstream reset
```
- [ ] **Step 7 : Commit**
```bash
git add CLAUDE.md INVENTORY.md ROADMAP.md docs/superpowers/specs/2026-05-28-commit-level-time-travel-design.md patches/upstream-all.diff
git commit -m "docs(baseline): smoke loop + INVENTORY + ROADMAP + spec amendment + regen patch (Task 7)"
```

---

## Self-Review

**Spec coverage (§3.3) :** seed en fond (Task 2 async + poll) ✅ ; baseline caché (`.hidden` marker, Task 1) ✅ ; promouvable (Task 2 promote + Task 6 UI) ✅ ; déclenché quand pas de baseline (Task 3 `needsBaseline` + Task 4/5 trigger) ✅ ; `findNearestBaseline` voit les cachés (inchangé — ne consulte pas `.hidden`) ✅.

**Déviations documentées :** poll vs SSE (déc. 2) ; promote dans SnapshotsPanel vs timeline dots (déc. 3) ; seed on-click vs on-entry (déc. 3) → amendement spec Task 7.4.

**Placeholders :** aucun — code réel partout. Les commits `--allow-empty` sur les tâches upstream-only (3, 4, 6) sont volontaires : le code vit dans le patch (regen Task 7), le commit marque la progression.

**Type consistency :** `hidden` (bool) cohérent backend (`/snapshots`) ↔ `SnapshotEntry.hidden?` (front). `needsBaseline` (bool) cohérent at-commit ↔ `atCommitNeedsBaseline`. `seedBaseline(sha)` signature ↔ appel `seedBaseline(atCommitSha)`. data-testids `seed-baseline-btn`/`seeding-baseline-chip` cohérents test↔impl.

**Env :** tests host non-exécutables (Node 21<22) → vérif via Docker build + smoke + intégration quand Node 22. Tests écrits et committés.
