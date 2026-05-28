# Commit-mode timeline (Plan 1/3 — pièce A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre la navigation commit-par-commit depuis la timeline principale (toggle Snapshots ⇄ Commits), où cliquer un commit reconstruit le graphe in-memory via `/graph/at-commit` — sans la fenêtre « Downloading graph… ».

**Architecture:** Un nouvel endpoint backend léger `GET /commits` (git log, pas d'analyze) alimente un mode "Commits" local à `Timeline.tsx`. Le clic sur un commit réutilise `loadGraphAtCommit` (déjà câblé dans `useAppState`). Aucune nouvelle action dans `useAppState` — le moteur de reconstruction (Phase C) existe déjà.

**Tech Stack:** Node http (modules `docker-server-*.mjs`), React + Vitest + @testing-library/react, tests d'intégration via fetch contre la stack docker.

**Séquencement (3 plans) :** Ce plan = **pièce A** du spec [2026-05-28-commit-level-time-travel-design.md](../specs/2026-05-28-commit-level-time-travel-design.md). Il est autonome et livrable seul (reconstruction lazy en fallback). Suivront **Plan 2 = B** (baseline auto-seed caché + promote) et **Plan 3 = C** (pré-chauffage des diffs).

---

## Notes d'environnement (à lire avant d'exécuter)

- **Shell** : PowerShell 5.1 par défaut (pas de `&&`). **Utiliser l'outil Bash** pour toute commande chaînée avec `&&` (bash est dispo). Les commandes ci-dessous sont en syntaxe bash.
- **`upstream/` est gitignore-d** dans le repo parent (c'est un clone imbriqué de gitnexus@v1.6.5). On **ne peut pas** `git add upstream/...`. Tous les edits `upstream/` sont sérialisés dans `patches/upstream-all.diff`, régénéré **une seule fois en Task 6**. Les commits par-tâche (Tasks 1-5) n'ajoutent donc que les fichiers de test (sous `tests/`, qui est tracké et référence `../../upstream/...` comme tous les tests existants).
- **Docker requis** pour Task 2 (intégration) et Task 6 (smoke) : on rebuild l'image `gitnexus-web` car on modifie `upstream/`. Tasks 1, 3, 4, 5 tournent **sans** docker (unit/composant).
- **Identité git** : vérifier `git config user.email` → `roblastar@live.fr` avant le 1er commit.

---

## File Structure

- **Create** `upstream/docker-server-commits.mjs` — endpoint `GET /commits` (git log lister). Responsabilité unique : lister les commits d'un repo (metadata git), newest-first, capé. Pures : `parseCommitLines`, `isSafeRef`.
- **Modify** `upstream/docker-server.mjs` — import + montage de `handleCommitsRoute` (1 ligne import + 1 ligne route).
- **Modify** `upstream/gitnexus-web/src/components/Timeline.tsx` — état local `navMode`, fetch `/commits`, toggle, rendu des points-commits, strip missing-diffs.
- **Create** `tests/unit/commits-parse.test.mjs` — unit des pures `parseCommitLines` / `isSafeRef`.
- **Create** `tests/integration/endpoints/commits.test.mjs` — endpoint `/commits` contre le fixture `sample-repo` (12 commits déterministes).
- **Create** `tests/unit/components/Timeline.commits.test.tsx` — toggle + rendu des commits + clic → `loadGraphAtCommit`.
- **Modify** `CLAUDE.md` (smoke loop), `INVENTORY.md` (nouvel endpoint), `patches/upstream-all.diff` (regen).

---

### Task 1 : Module backend `/commits` + pures testées

**Files:**
- Create: `upstream/docker-server-commits.mjs`
- Test: `tests/unit/commits-parse.test.mjs`

- [ ] **Step 1 : Écrire le test unit qui échoue**

Create `tests/unit/commits-parse.test.mjs` :

```js
import { describe, it, expect } from 'vitest';
import { parseCommitLines, isSafeRef } from '../../upstream/docker-server-commits.mjs';

describe('parseCommitLines', () => {
  it('parses \\0-delimited git log lines into commit objects', () => {
    const line = ['abc123full', 'abc123', 'feat: x', 'Alice', 'a@t', '2025-01-01T10:00:00+01:00', 'parentsha'].join('\0');
    const out = parseCommitLines(line + '\n');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      hash: 'abc123full', shortHash: 'abc123', message: 'feat: x',
      author: 'Alice', email: 'a@t', date: '2025-01-01T10:00:00+01:00', parent: 'parentsha',
    });
  });

  it('treats empty parent as null and skips blank lines', () => {
    const line = ['h', 's', 'm', 'a', 'e', 'd', ''].join('\0');
    const out = parseCommitLines('\n' + line + '\n\n');
    expect(out).toHaveLength(1);
    expect(out[0].parent).toBeNull();
  });
});

describe('isSafeRef', () => {
  it('accepts shas, branch names, HEAD~n', () => {
    expect(isSafeRef('HEAD')).toBe(true);
    expect(isSafeRef('a1b2c3d')).toBe(true);
    expect(isSafeRef('HEAD~3')).toBe(true);
    expect(isSafeRef('origin/main')).toBe(true);
  });
  it('rejects option-like and junk refs', () => {
    expect(isSafeRef('--all')).toBe(false);
    expect(isSafeRef('')).toBe(false);
    expect(isSafeRef('a; rm -rf /')).toBe(false);
    expect(isSafeRef(null)).toBe(false);
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs commits-parse`
Expected: FAIL — `Failed to resolve import "../../upstream/docker-server-commits.mjs"` (le module n'existe pas encore).

- [ ] **Step 3 : Écrire le module**

Create `upstream/docker-server-commits.mjs` :

```js
/**
 * Commit lister — GET /commits?repo=&from=&to=&max=
 *
 * Alimente le mode "Commits" de la timeline (spec 2026-05-28 §3.2) : un
 * `git log` léger pour que le frontend affiche un point par commit et
 * reconstruise n'importe lequel via /graph/at-commit. Pas d'analyze, pas
 * de DB — juste les metadata git. Newest-first, capé.
 */
import { runCmd, findRepoByName } from './docker-server-snapshots.mjs';

const COMMIT_FMT = ['%H', '%h', '%s', '%an', '%ae', '%aI', '%P'].join('%x00');
const DEFAULT_MAX = 200;
const MAX_CAP = 2000;

// Un ref git est sûr en argument positionnel s'il ne ressemble pas à une
// option (pas de '-' en tête) et ne contient que des caractères légaux.
// Les args passent par spawn (pas de shell) : ce garde évite juste qu'un
// ref soit interprété comme un flag.
export function isSafeRef(ref) {
  return (
    typeof ref === 'string' &&
    ref.length > 0 &&
    !ref.startsWith('-') &&
    /^[A-Za-z0-9._/~^@-]+$/.test(ref)
  );
}

// Parse la sortie `git log` (champs séparés par \0, lignes par \n) en
// objets commit de la même forme que getCommitInfo / SnapshotEntry.commit.
export function parseCommitLines(stdout) {
  return String(stdout)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, message, author, email, date, parent] = line.split('\0');
      return { hash, shortHash, message, author, email, date, parent: parent || null };
    });
}

async function handleCommits(url, res, opts) {
  const repoName = url.searchParams.get('repo');
  if (!repoName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing repo' }));
    return;
  }
  const baseRepo = repoName.split('@')[0];
  const to = url.searchParams.get('to') || 'HEAD';
  const from = url.searchParams.get('from') || null;
  let max = Number(url.searchParams.get('max'));
  if (!Number.isFinite(max) || max <= 0) max = DEFAULT_MAX;
  max = Math.min(max, MAX_CAP);

  if (!isSafeRef(to) || (from && !isSafeRef(from))) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'malformed from/to ref' }));
    return;
  }

  const live = await findRepoByName(baseRepo, opts.api);
  if (!live) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `repo not found: ${baseRepo}` }));
    return;
  }
  const repoPath = live.repoPath || live.path;

  let out;
  try {
    out = await runCmd('git', ['-C', repoPath, 'log', `--format=${COMMIT_FMT}`, '-n', String(max), to, '--']);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `git log failed: ${err.message}` }));
    return;
  }

  let commits = parseCommitLines(out);
  if (from) {
    const idx = commits.findIndex(
      (c) => c.hash === from || c.hash.startsWith(from) || c.shortHash === from,
    );
    if (idx >= 0) commits = commits.slice(0, idx + 1);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ repo: baseRepo, to, commits, truncated: commits.length >= max }));
}

export async function handleCommitsRoute(req, url, res, opts) {
  if (url.pathname === '/commits' && req.method === 'GET') {
    await handleCommits(url, res, opts);
    return true;
  }
  return false;
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs commits-parse`
Expected: PASS — 4 tests.

- [ ] **Step 5 : Commit**

```bash
# upstream/ est gitignore-d → docker-server-commits.mjs sera sérialisé dans le patch en Task 6.
git add tests/unit/commits-parse.test.mjs
git commit -m "feat(commits): GET /commits module + parseCommitLines/isSafeRef units (Task 1)"
```

---

### Task 2 : Monter la route + test d'intégration

**Files:**
- Modify: `upstream/docker-server.mjs` (import vers ~ligne 36 ; route vers ~ligne 587)
- Test: `tests/integration/endpoints/commits.test.mjs`

- [ ] **Step 1 : Monter l'import dans `docker-server.mjs`**

Après la ligne `import { handleRegressionRoute } from './docker-server-regression.mjs';` (~ligne 36), ajouter :

```js
import { handleCommitsRoute } from './docker-server-commits.mjs';
```

- [ ] **Step 2 : Monter la route dans `docker-server.mjs`**

Juste après la ligne `if (await handleRegressionRoute(req, reqUrl, res)) return;` (~ligne 587), ajouter :

```js
  // Commit lister for the timeline Commits mode (2026-05-28 commit-level time-travel spec)
  if (await handleCommitsRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;
```

- [ ] **Step 3 : Écrire le test d'intégration qui échoue**

Create `tests/integration/endpoints/commits.test.mjs` :

```js
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /commits', () => {
  it('400 when repo missing', async () => {
    const res = await fetch(`${BASE}/commits`);
    expect(res.status).toBe(400);
  });

  it('404 for an unknown repo', async () => {
    const res = await fetch(`${BASE}/commits?repo=does-not-exist-xyz`);
    expect(res.status).toBe(404);
  });

  it('200 returns commits newest-first with the expected shape', async () => {
    const res = await fetch(`${BASE}/commits?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.commits)).toBe(true);
    expect(data.commits.length).toBeGreaterThanOrEqual(12);
    const c = data.commits[0];
    expect(c).toHaveProperty('hash');
    expect(c).toHaveProperty('shortHash');
    expect(c).toHaveProperty('message');
    expect(c).toHaveProperty('date');
    // newest-first : la première date >= la dernière
    expect(data.commits[0].date >= data.commits[data.commits.length - 1].date).toBe(true);
    // le plus ancien commit du fixture est le scaffold
    expect(data.commits[data.commits.length - 1].message).toBe('feat: scaffold project');
  });

  it('max caps the result and sets truncated', async () => {
    const res = await fetch(`${BASE}/commits?repo=${FIXTURE.name}&max=3`);
    const data = await res.json();
    expect(data.commits).toHaveLength(3);
    expect(data.truncated).toBe(true);
  });

  it('from truncates the list inclusive at that commit', async () => {
    const all = await (await fetch(`${BASE}/commits?repo=${FIXTURE.name}`)).json();
    const mid = all.commits[5].hash;
    const res = await fetch(`${BASE}/commits?repo=${FIXTURE.name}&from=${mid}`);
    const data = await res.json();
    expect(data.commits[data.commits.length - 1].hash).toBe(mid);
    expect(data.commits).toHaveLength(6);
  });
});
```

- [ ] **Step 4 : Rebuild l'image web + relancer la stack de test, puis lancer l'intégration**

Run (rebuild car on a modifié des fichiers `upstream/`) :
```bash
docker compose build gitnexus-web && docker compose up -d
cd tests && npx vitest run --config vitest.config.integ.mjs commits
```
Expected: PASS — 5 tests. (Si `git log failed`, vérifier que le fixture `sample-repo` est bien un repo git monté à `/data/projects/sample-repo` — `make-fixture.mjs` l'initialise avec 12 commits.)

- [ ] **Step 5 : Commit**

```bash
# Edit de docker-server.mjs (upstream/, gitignore-d) → sérialisé dans le patch en Task 6.
git add tests/integration/endpoints/commits.test.mjs
git commit -m "feat(commits): mount GET /commits route + integration test (Task 2)"
```

---

### Task 3 : Frontend — toggle Snapshots ⇄ Commits + fetch `/commits`

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Test: `tests/unit/components/Timeline.commits.test.tsx`

- [ ] **Step 1 : Écrire le test composant qui échoue**

Create `tests/unit/components/Timeline.commits.test.tsx` :

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// fetch mock : /snapshots (≥2 points pour que la timeline rende) + /commits.
beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('/snapshots')) {
      return { ok: true, json: async () => ({ snapshots: [
        { name: 'demo@aaa', key: 'demo@aaa', commit: { shortHash: 'aaa', message: 'first', author: 'a', date: '2026-05-10T00:00:00Z' } },
        { name: 'demo@bbb', key: 'demo@bbb', commit: { shortHash: 'bbb', message: 'second', author: 'a', date: '2026-05-20T00:00:00Z' } },
      ] }) };
    }
    if (u.startsWith('/commits')) {
      return { ok: true, json: async () => ({ repo: 'demo', commits: [
        { hash: 'h_new', shortHash: 'hnew', message: 'newest', author: 'a', date: '2026-05-20T00:00:00Z' },
        { hash: 'h_old', shortHash: 'hold', message: 'oldest', author: 'a', date: '2026-05-10T00:00:00Z' },
      ], truncated: false }) };
    }
    return { ok: true, json: async () => ({}) };
  });
});

const defaultAppState = {
  projectName: 'demo',
  availableRepos: [{ name: 'demo', indexedAt: '2026-05-25T00:00:00Z' }],
  switchRepo: vi.fn(),
  exitDiffMode: vi.fn(), diffMode: null,
  churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0, enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
  couplingActive: false, couplingLoading: false, couplingError: null, enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
  growthActive: false, growthLoading: false, growthError: null, enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
  lifespanActive: false, lifespanLoading: false, lifespanError: null, enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
  ownershipActive: false, ownershipLoading: false, ownershipError: null, enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
  dissonanceActive: false, dissonanceLoading: false, dissonanceError: null, enterDissonanceMode: vi.fn(), exitDissonanceMode: vi.fn(),
  similarityActive: false, similarityLoading: false, similarityError: null, enterSimilarityMode: vi.fn(), exitSimilarityMode: vi.fn(),
  whatIfPanelOpen: false, whatIfActive: false, whatIfMutations: [], exitWhatIfMode: vi.fn(), setWhatIfMutations: vi.fn(), setWhatIfPanelOpen: vi.fn(),
  entropyCommitsActive: false, enterEntropyCommitsMode: vi.fn(), exitEntropyCommitsMode: vi.fn(),
  cachedSnapshotNames: new Set(), preloadingSnapshots: false, preloadProgress: null, preloadError: null,
  preloadAllSnapshots: vi.fn(), cancelPreload: vi.fn(), clearSnapshotCache: vi.fn(),
  cursorA: null, cursorB: null, zoomWindow: null, graphMode: 'single',
  setCursorA: vi.fn(), setCursorB: vi.fn(), enterZoom: vi.fn(), exitZoom: vi.fn(), setGraphMode: vi.fn(),
  temporalFilterMode: 'off', setTemporalFilterMode: vi.fn(), temporalFilterLoading: false,
  ghostFilters: { showGhosts: false, tiers: ['1', '2', '3'], showCancelled: false }, setGhostFilters: vi.fn(),
  lockGhostsToHead: false, setLockGhostsToHead: vi.fn(), animationActive: false, setAnimationActive: vi.fn(),
  // Commit-level time-travel wiring (this plan)
  loadGraphAtCommit: vi.fn(), exitGraphAtCommit: vi.fn(),
  atCommitActive: false, atCommitSha: null, atCommitLoading: false, atCommitMissingDiffs: 0,
};

let currentState = { ...defaultAppState };

vi.mock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({ useAppState: () => currentState }));
vi.mock('../../../upstream/gitnexus-web/src/components/EntropyBadge', () => ({ EntropyBadge: () => null }));
vi.mock('@/lib/lucide-icons', () => new Proxy({}, { get: () => () => null }));

const { Timeline } = await import('../../../upstream/gitnexus-web/src/components/Timeline');

describe('Timeline — Commits mode toggle', () => {
  beforeEach(() => {
    currentState = { ...defaultAppState, loadGraphAtCommit: vi.fn(), exitGraphAtCommit: vi.fn() };
  });

  it('renders the nav-mode toggle', async () => {
    render(<Timeline />);
    await waitFor(() => expect(screen.getByTestId('timeline-navmode-toggle')).toBeInTheDocument());
  });

  it('switching to Commits fetches /commits and renders one dot per commit', async () => {
    render(<Timeline />);
    fireEvent.click(await screen.findByTestId('navmode-commits'));
    await waitFor(() => expect(screen.getAllByTestId('commit-dot')).toHaveLength(2));
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs Timeline.commits`
Expected: FAIL — `Unable to find an element by: [data-testid="timeline-navmode-toggle"]`.

- [ ] **Step 3 : Ajouter le state + le fetch + le toggle dans `Timeline.tsx`**

(a) Dans le bloc de destructuration `useAppState()` (celui qui finit par `} = useAppState();`, ~ligne 139), ajouter avant l'accolade fermante :

```tsx
    // Commit-level time-travel (spec 2026-05-28 §3.2) — réutilise le moteur
    // de reconstruction déjà câblé ; pas de nouvel état dans useAppState.
    loadGraphAtCommit,
    exitGraphAtCommit,
    atCommitActive,
    atCommitSha,
    atCommitLoading,
    atCommitMissingDiffs,
```

(b) Après `const playingRef = useRef(false);` (~ligne 153), ajouter l'état local :

```tsx
  // Timeline "Commits" mode (spec 2026-05-28 §3.2). Local au composant :
  // 'snapshots' = comportement actuel ; 'commits' = nav par-commit.
  const [navMode, setNavMode] = useState<'snapshots' | 'commits'>('snapshots');
  const [commits, setCommits] = useState<
    Array<{ hash: string; shortHash: string; message: string; author: string; date: string }>
  >([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);
```

(c) Après le `useEffect` qui fetch `/snapshots` (celui qui se termine par `}, [baseRepo, availableRepos]);`, ~ligne 208), ajouter le fetch des commits :

```tsx
  // Fetch /commits en entrant en mode Commits (ou si le repo de base change
  // pendant qu'on y est). Capé côté serveur, newest-first.
  useEffect(() => {
    if (navMode !== 'commits' || !baseRepo) return;
    let cancelled = false;
    setCommitsLoading(true);
    setCommitsError(null);
    fetch(`/commits?repo=${encodeURIComponent(baseRepo)}&max=200`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!cancelled) setCommits(Array.isArray(data.commits) ? data.commits : []);
      })
      .catch((e) => {
        if (!cancelled) {
          setCommits([]);
          setCommitsError(e instanceof Error ? e.message : 'failed to load commits');
        }
      })
      .finally(() => {
        if (!cancelled) setCommitsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navMode, baseRepo, availableRepos]);
```

(d) Le toggle JSX. Juste après le bloc du label `Timeline` (le `<div className="flex shrink-0 items-center gap-1.5 ...">` contenant `<Clock .../> Timeline`, ~ligne 731-734), ajouter :

```tsx
      {/* Toggle de mode nav — Snapshots ⇄ Commits (spec 2026-05-28 §3.2) */}
      <div
        className="flex shrink-0 items-center overflow-hidden rounded-md border border-border-subtle text-[10px]"
        data-testid="timeline-navmode-toggle"
      >
        <button
          type="button"
          data-testid="navmode-snapshots"
          onClick={() => {
            setNavMode('snapshots');
            if (atCommitActive) exitGraphAtCommit();
          }}
          className={`px-2 py-0.5 ${navMode === 'snapshots' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}
        >
          Snapshots
        </button>
        <button
          type="button"
          data-testid="navmode-commits"
          onClick={() => setNavMode('commits')}
          className={`px-2 py-0.5 ${navMode === 'commits' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}
        >
          Commits{commitsLoading ? '…' : ''}
        </button>
      </div>
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs Timeline.commits`
Expected: le test `renders the nav-mode toggle` PASSE ; `switching to Commits ... renders one dot per commit` ÉCHOUE encore (les points-commits ne sont pas rendus — Task 4). C'est attendu.

- [ ] **Step 5 : Commit**

```bash
# Edits Timeline.tsx (upstream/, gitignore-d) → sérialisés dans le patch en Task 6.
git add tests/unit/components/Timeline.commits.test.tsx
git commit -m "feat(timeline): Snapshots/Commits nav-mode toggle + /commits fetch (Task 3)"
```

---

### Task 4 : Frontend — rendu des points-commits + clic → reconstruction

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Test: `tests/unit/components/Timeline.commits.test.tsx` (ajout d'un cas)

- [ ] **Step 1 : Ajouter le cas de test (clic → loadGraphAtCommit) qui échoue**

Dans `tests/unit/components/Timeline.commits.test.tsx`, ajouter ce `it` dans le `describe` existant :

```tsx
  it('clicking a commit dot calls loadGraphAtCommit with that commit hash', async () => {
    render(<Timeline />);
    fireEvent.click(await screen.findByTestId('navmode-commits'));
    const dots = await screen.findAllByTestId('commit-dot');
    fireEvent.click(dots[0]); // newest commit (i=0)
    expect(currentState.loadGraphAtCommit).toHaveBeenCalledWith('h_new');
  });
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs Timeline.commits`
Expected: FAIL — `commit-dot` introuvable (le rendu n'existe pas encore).

- [ ] **Step 3 : Rendre les points-commits dans la barre**

Dans la barre `<div ref={timelineBarRef} className="relative h-8 flex-1">` (~ligne 1195), il y a un bloc `{visiblePoints.map((p, i) => { ... })}` (les points-snapshots).

(a) Le rendre conditionnel au mode Snapshots : remplacer l'ouverture `{visiblePoints.map((p, i) => {` par :

```tsx
        {navMode === 'snapshots' && visiblePoints.map((p, i) => {
```

(b) Juste après le bloc `})}` qui ferme ce `.map` (avant le commentaire `{/* Right side: short summary ... */}`), ajouter le rendu des commits :

```tsx
        {navMode === 'commits' && commits.map((c, i) => {
          const isActive = atCommitActive && atCommitSha === c.hash;
          // commits newest-first → on place le plus récent à droite (100%).
          const left = commits.length === 1 ? 50 : (1 - i / (commits.length - 1)) * 100;
          return (
            <button
              key={c.hash}
              type="button"
              data-testid="commit-dot"
              onClick={() => loadGraphAtCommit(c.hash)}
              disabled={atCommitLoading}
              style={{ left: `${left}%` }}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full transition-all disabled:cursor-not-allowed ${
                isActive
                  ? 'h-3.5 w-3.5 bg-accent ring-2 ring-accent ring-offset-2 ring-offset-deep'
                  : 'h-2 w-2 bg-accent/50 hover:scale-150 hover:bg-accent'
              }`}
              title={`${c.shortHash} • ${c.message}\n${c.author} • ${new Date(c.date).toLocaleString()}`}
            />
          );
        })}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs Timeline.commits`
Expected: PASS — les 3 cas (toggle, rendu 2 dots, clic → `loadGraphAtCommit('h_new')`).

- [ ] **Step 5 : Commit**

```bash
# Edits Timeline.tsx (upstream/, gitignore-d) → sérialisés dans le patch en Task 6.
git add tests/unit/components/Timeline.commits.test.tsx
git commit -m "feat(timeline): render commit dots in Commits mode + click reconstructs (Task 4)"
```

---

### Task 5 : Frontend — strip diffs manquants (fallback lazy) + erreur

**Files:**
- Modify: `upstream/gitnexus-web/src/components/Timeline.tsx`
- Test: `tests/unit/components/Timeline.commits.test.tsx` (ajout d'un cas)

- [ ] **Step 1 : Ajouter le cas de test (strip missing-diffs) qui échoue**

Dans `tests/unit/components/Timeline.commits.test.tsx`, ajouter :

```tsx
  it('shows a missing-diffs strip with a lazy retry when atCommitMissingDiffs > 0', async () => {
    currentState = { ...defaultAppState, loadGraphAtCommit: vi.fn(), atCommitSha: 'h_new', atCommitMissingDiffs: 3 };
    render(<Timeline />);
    fireEvent.click(await screen.findByTestId('navmode-commits'));
    const retry = await screen.findByTestId('commit-generate-retry');
    fireEvent.click(retry);
    expect(currentState.loadGraphAtCommit).toHaveBeenCalledWith('h_new', { lazy: true });
  });
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs Timeline.commits`
Expected: FAIL — `commit-generate-retry` introuvable.

- [ ] **Step 3 : Ajouter le strip sous la barre**

Juste avant le bloc de l'indicateur de durée (`{cursorA && cursorB && points.length >= 2 && (`, ~ligne 1294), ajouter :

```tsx
      {/* Mode Commits : diffs manquants → retry lazy ; ou erreur de fetch. */}
      {navMode === 'commits' && atCommitMissingDiffs > 0 && atCommitSha && (
        <div
          data-testid="commit-missing-diffs"
          className="flex items-center justify-center gap-2 border-t border-dashed border-border-subtle px-4 py-1 text-[10px] text-amber-200"
        >
          {atCommitMissingDiffs} diff(s) manquant(s) pour reconstruire ce commit
          <button
            type="button"
            data-testid="commit-generate-retry"
            disabled={atCommitLoading}
            onClick={() => atCommitSha && loadGraphAtCommit(atCommitSha, { lazy: true })}
            className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-100 transition-all hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {atCommitLoading ? 'Génération…' : 'Générer & réessayer'}
          </button>
        </div>
      )}
      {navMode === 'commits' && commitsError && (
        <div className="border-t border-dashed border-border-subtle px-4 py-1 text-center text-[10px] text-red-400">
          {commitsError}
        </div>
      )}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe + non-régression**

Run: `cd tests && npx vitest run --config vitest.config.unit.mjs Timeline`
Expected: PASS — `Timeline.commits` (4 cas) et `Timeline.augmented` (les cas existants) verts.

- [ ] **Step 5 : Commit**

```bash
# Edits Timeline.tsx (upstream/, gitignore-d) → sérialisés dans le patch en Task 6.
git add tests/unit/components/Timeline.commits.test.tsx
git commit -m "feat(timeline): missing-diffs lazy-retry strip in Commits mode (Task 5)"
```

---

### Task 6 : Build, smoke loop, docs, patches

**Files:**
- Modify: `CLAUDE.md` (smoke loop)
- Modify: `INVENTORY.md` (nouvel endpoint)
- Modify: `patches/upstream-all.diff` (regen)

- [ ] **Step 1 : Vérifier le build frontend (tsc + vite) + le build image**

Run:
```bash
cd upstream/gitnexus-web && npm run build
```
Expected: exit 0 (pas d'erreur TS sur `Timeline.tsx`).
Puis :
```bash
docker compose build gitnexus-web && docker compose up -d
```
Expected: build OK, stack up.

- [ ] **Step 2 : Ajouter `/commits` au smoke loop de `CLAUDE.md`**

Dans `CLAUDE.md`, après le bloc `auto-reindex` du smoke loop, ajouter :

```bash
# Commit lister (timeline Commits mode — commit-level time-travel) — read-only git log.
curl -s -o /dev/null -w "commits: HTTP %{http_code}\n" \
  "http://localhost:4173/commits?repo=hmm_studio&max=50"
```

- [ ] **Step 3 : Lancer le smoke check pour `/commits`**

Run:
```bash
curl -s -o /dev/null -w "commits: HTTP %{http_code}\n" "http://localhost:4173/commits?repo=hmm_studio&max=50"
```
Expected: `commits: HTTP 200`.

- [ ] **Step 4 : Documenter l'endpoint dans `INVENTORY.md`**

Dans `INVENTORY.md`, dans la table des endpoints (section "Nos ajouts"), ajouter la ligne :

```
| `GET /commits` | Liste légère des commits d'un repo (`git log`, pas d'analyze) pour le mode "Commits" de la timeline. Params: `?repo=&from=&to=&max=` (max capé à 2000, défaut 200), newest-first. Pièce A de commit-level time-travel (spec 2026-05-28). |
```

- [ ] **Step 5 : Régénérer `patches/upstream-all.diff`**

Run (depuis la racine gitnexus) :
```powershell
cd upstream; git add -N .; git diff HEAD > ../patches/upstream-all.diff; git reset; cd ..
```
Expected: le diff inclut `docker-server-commits.mjs`, les edits de `docker-server.mjs` et `Timeline.tsx`.

- [ ] **Step 6 : Commit**

```bash
git add CLAUDE.md INVENTORY.md patches/upstream-all.diff
git commit -m "docs(commits): smoke loop + INVENTORY + regen upstream patch (Task 6)"
```

---

## Self-Review

**1. Spec coverage (vs §3.2 du spec) :**
- Toggle Snapshots ⇄ Commits → Task 3. ✅
- Clic commit → `loadGraphAtCommit` (pas `switchRepo`, pas d'overlay) → Task 4. ✅
- Source des commits = nouvel endpoint `/commits` (vs `/entropy/commits`) → Tasks 1-2. ✅
- Fallback diffs manquants (réutilise l'UX lazy existante) → Task 5. ✅
- Densité bornée (cap serveur `max`, défaut 200) → §4 scope "borné" respecté via le cap. ✅
- **Hors scope de ce plan (A) :** baseline auto-seed (Plan 2/B), pré-chauffage (Plan 3/C), suivi zoom-fenêtre fin du fetch commits (raffinement). Documenté ici comme non-couvert volontairement.

**2. Placeholder scan :** aucun TBD/TODO ; chaque step a son code réel et sa commande.

**3. Type consistency :** la forme commit `{ hash, shortHash, message, author, email, date, parent }` est identique entre `parseCommitLines` (Task 1), la réponse `/commits` et le state `commits` du front (qui n'utilise que `hash/shortHash/message/author/date`). Le `data-testid` `commit-dot`, `navmode-commits`, `commit-generate-retry` sont cohérents test↔impl. `loadGraphAtCommit(sha)` et `loadGraphAtCommit(sha, { lazy: true })` correspondent à la signature `useAppState` `(sha, opts?: { lazy?: boolean })`.

**Note d'exécution :** les tests d'intégration (Task 2) et le smoke (Task 6) exigent la stack docker up + l'image `gitnexus-web` rebuildée (on modifie des fichiers `upstream/`). Les tests unit/composant (Tasks 1, 3-5) tournent sans docker.
