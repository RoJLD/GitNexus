# Diff pre-warming (Plan 3/3 — pièce C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Rendre la nav par-commit *fluide* (pas de génération lazy ~50s au 1er clic) en pré-générant les diffs incrémentaux en fond : **on-push** (cron watches, opt-in) **et** **on-era-entry** (à l'entrée du mode Commits).

**Architecture:** Un module `docker-server-prewarm.mjs` génère les diffs manquants pour une liste de commits en appelant `/snapshot/incremental` sur lui-même (comme le fait déjà le lazy de `/graph/at-commit`), avec un cap par passage + un garde anti-overlap. La cron `watches` appelle `maybePrewarmRepo` par repo (gated par `.gitnexus.json > incremental.preWarm`). Un endpoint `POST /snapshot/prewarm` sert le déclenchement on-era ; `GET /snapshot/prewarm` expose l'état (warm/cold). Tous alimentent le même cache `.gitnexus/incremental/<sha>.json.gz` que `/graph/at-commit` consomme.

**Tech Stack:** Node http (`docker-server-*.mjs`), React + Vitest, vérif Docker (host Node 21<22).

**Parent spec :** [2026-05-28-commit-level-time-travel-design.md](../specs/2026-05-28-commit-level-time-travel-design.md) §3.4. **Suit** : Plan 1 (A) + Plan 2 (B) livrés. **Dernière pièce du chantier.**

## Notes d'environnement (identiques Plans 1-2)
- Shell PowerShell par défaut → **outil Bash** pour `&&`.
- `upstream/` gitignore-d → jamais `git add upstream/...` ; patch régénéré en dernière tâche. Commits par-tâche = fichiers `tests/`.
- **Docker requis** (host vitest/vite bloqués Node 21). **COPY du nouveau module dans `Dockerfile.web`** obligatoire.
- Identité git `roblastar@live.fr`.

## File Structure
- **Create** `upstream/docker-server-prewarm.mjs` — `maybePrewarmRepo` (cron), `POST /snapshot/prewarm`, `GET /snapshot/prewarm`, helpers `diffExists`/`lastCommits`/`prewarmShas`.
- **Modify** `upstream/docker-server-config.mjs` — section `incremental { preWarm, preWarmCommits }`.
- **Modify** `upstream/docker-server-watches.mjs` — appeler `maybePrewarmRepo` dans la boucle cron.
- **Modify** `upstream/docker-server.mjs` — import + mount.
- **Modify** `upstream/Dockerfile.web` — COPY.
- **Modify** `upstream/gitnexus-web/src/components/Timeline.tsx` — fire-and-forget `POST /snapshot/prewarm` à l'entrée du mode Commits.
- **Create** `tests/unit/incremental-config.test.mjs`, `tests/integration/endpoints/prewarm.test.mjs`.

---

### Task 1 : Config `incremental { preWarm, preWarmCommits }`

**Files:** Modify `upstream/docker-server-config.mjs` ; Test `tests/unit/incremental-config.test.mjs`

- [ ] **Step 1 : Test qui échoue** — `tests/unit/incremental-config.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { parseIncrementalConfig } from '../../upstream/docker-server-config.mjs';

describe('parseIncrementalConfig', () => {
  it('defaults to disabled + 50 when absent', () => {
    expect(parseIncrementalConfig({})).toEqual({ preWarm: false, preWarmCommits: 50 });
    expect(parseIncrementalConfig(undefined)).toEqual({ preWarm: false, preWarmCommits: 50 });
  });
  it('reads preWarm + clamps preWarmCommits to [1,500]', () => {
    expect(parseIncrementalConfig({ incremental: { preWarm: true, preWarmCommits: 9999 } })).toEqual({ preWarm: true, preWarmCommits: 500 });
    expect(parseIncrementalConfig({ incremental: { preWarm: true, preWarmCommits: 0 } })).toEqual({ preWarm: true, preWarmCommits: 1 });
    expect(parseIncrementalConfig({ incremental: { preWarm: true, preWarmCommits: 30 } })).toEqual({ preWarm: true, preWarmCommits: 30 });
  });
});
```

- [ ] **Step 2 : Run, expect FAIL** : `cd tests && npx vitest run --config vitest.config.unit.mjs incremental-config`

- [ ] **Step 3 : Implémenter dans `docker-server-config.mjs`**

(a) Ajouter la fn exportée près de `parseAutoReindex` (~ligne 184) :
```js
// incremental section (diff pre-warming, commit-level time-travel §3.4).
// preWarm: la cron pré-génère les diffs des N derniers commits ; preWarmCommits: N.
export function parseIncrementalConfig(parsed) {
  const i = parsed?.incremental;
  const n = Number(i?.preWarmCommits);
  return {
    preWarm: !!(i && i.preWarm),
    preWarmCommits: Number.isFinite(n) ? Math.max(1, Math.min(500, n)) : 50,
  };
}
```

(b) Dans `getConfig`, le early-return sans repoPath (~ligne 205) : ajouter `incremental: { preWarm: false, preWarmCommits: 50 }` à l'objet retourné.

(c) Déclarer `let incremental = { preWarm: false, preWarmCommits: 50 };` avec les autres `let` (~ligne 222), assigner `incremental = parseIncrementalConfig(parsed);` dans le bloc `if (unified.exists)` (à côté de `autoReindex = parseAutoReindex(parsed);`), et ajouter `incremental` à l'objet de `return` final (~ligne 295).

- [ ] **Step 4 : Run, expect PASS** : `cd tests && npx vitest run --config vitest.config.unit.mjs incremental-config`

- [ ] **Step 5 : Commit** : `git add tests/unit/incremental-config.test.mjs && git commit -m "feat(prewarm): .gitnexus.json incremental{preWarm,preWarmCommits} config (Task 1)"`

---

### Task 2 : Module pre-warm + endpoints + cron hook + mount + COPY

**Files:** Create `upstream/docker-server-prewarm.mjs` ; Modify `docker-server.mjs`, `docker-server-watches.mjs`, `Dockerfile.web` ; Test `tests/integration/endpoints/prewarm.test.mjs`

- [ ] **Step 1 : Écrire `upstream/docker-server-prewarm.mjs`**

```js
/**
 * Diff pre-warming (commit-level time-travel §3.4).
 *
 * Génère en fond les diffs incrémentaux manquants pour que la nav par-commit
 * (/graph/at-commit) soit instantanée au lieu de payer ~50s de génération lazy
 * au 1er clic. Deux déclencheurs, même logique :
 *   - on-push : la cron watches appelle maybePrewarmRepo (opt-in .gitnexus.json
 *     > incremental.preWarm), pré-chauffe les N derniers commits.
 *   - on-era  : POST /snapshot/prewarm?repo=&max= (à l'entrée du mode Commits).
 *   - GET /snapshot/prewarm?repo=&max= → { total, warm, cold } (état, read-only).
 *
 * Génère via POST /snapshot/incremental sur soi-même (même chemin que le lazy
 * de /graph/at-commit). Cap par passage + garde anti-overlap par repo pour ne
 * pas lancer 10 analyses concurrentes.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { findRepoByName } from './docker-server-snapshots.mjs';

const execFileP = promisify(execFile);
const SELF = `http://127.0.0.1:${process.env.PORT || '4173'}`;
const PER_TICK_CAP = Number(process.env.PREWARM_PER_TICK) || 5;
const _inflight = new Set(); // baseRepo en cours de pré-chauffe (anti-overlap)

async function diffExists(repoPath, sha) {
  const base = join(repoPath, '.gitnexus', 'incremental', sha);
  for (const ext of ['json.gz', 'json.br', 'json']) {
    if (await stat(`${base}.${ext}`).catch(() => null)) return true;
  }
  return false;
}

async function lastCommits(repoPath, n) {
  try {
    const { stdout } = await execFileP('git', ['-C', repoPath, 'log', '--format=%H', '-n', String(n), 'HEAD'], { timeout: 10000 });
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Génère les diffs manquants pour `shas` (best-effort, séquentiel). Au plus
// `cap` générations par appel (les suivants restent "cold" pour un prochain
// passage). Skip ceux déjà présents (stat — pas de re-analyze).
async function prewarmShas(baseRepo, repoPath, shas, cap) {
  if (_inflight.has(baseRepo)) return { busy: true, warmed: 0, skipped: 0, cold: shas.length };
  _inflight.add(baseRepo);
  let warmed = 0, skipped = 0, cold = 0;
  try {
    for (const sha of shas) {
      if (await diffExists(repoPath, sha)) { skipped++; continue; }
      if (warmed >= cap) { cold++; continue; }
      try {
        const r = await fetch(`${SELF}/snapshot/incremental?repo=${encodeURIComponent(baseRepo)}&commit=${sha}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        if (r.ok) warmed++; else cold++;
      } catch { cold++; }
    }
  } finally {
    _inflight.delete(baseRepo);
  }
  return { warmed, skipped, cold };
}

// Cron tick (appelé par docker-server-watches.mjs). Opt-in par repo.
export async function maybePrewarmRepo(repo) {
  const repoPath = repo && (repo.repoPath || repo.path);
  if (!repoPath || !repo.name || repo.name.includes('@')) return;
  let cfg;
  try {
    const { getConfig } = await import('./docker-server-config.mjs');
    cfg = await getConfig(repoPath);
  } catch { return; }
  if (!cfg?.incremental?.preWarm) return;
  const shas = await lastCommits(repoPath, cfg.incremental.preWarmCommits || 50);
  if (shas.length === 0) return;
  const res = await prewarmShas(repo.name, repoPath, shas, PER_TICK_CAP);
  if (res.warmed > 0) {
    process.stderr.write(`[prewarm] ${repo.name}: warmed ${res.warmed}, skipped ${res.skipped}, cold ${res.cold}\n`);
  }
}

async function handlePost(url, res, opts) {
  const repoName = url.searchParams.get('repo');
  if (!repoName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing repo' }));
    return;
  }
  const baseRepo = repoName.split('@')[0];
  let max = Number(url.searchParams.get('max'));
  if (!Number.isFinite(max) || max <= 0) max = 200;
  max = Math.min(max, 500);
  const live = await findRepoByName(baseRepo, opts.api);
  if (!live) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `repo not found: ${baseRepo}` }));
    return;
  }
  const repoPath = live.repoPath || live.path;
  const shas = await lastCommits(repoPath, max);
  // Fire-and-forget : on chauffe en fond (cap = max pour l'on-era), le client
  // n'attend pas. Les clics qui arrivent avant la fin tombent en lazy.
  prewarmShas(baseRepo, repoPath, shas, max).catch(() => {});
  res.writeHead(202, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ queued: shas.length }));
}

async function handleGet(url, res, opts) {
  const repoName = url.searchParams.get('repo');
  if (!repoName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing repo' }));
    return;
  }
  const baseRepo = repoName.split('@')[0];
  let max = Number(url.searchParams.get('max'));
  if (!Number.isFinite(max) || max <= 0) max = 200;
  max = Math.min(max, 500);
  const live = await findRepoByName(baseRepo, opts.api);
  if (!live) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `repo not found: ${baseRepo}` }));
    return;
  }
  const repoPath = live.repoPath || live.path;
  const shas = await lastCommits(repoPath, max);
  let warm = 0;
  for (const sha of shas) if (await diffExists(repoPath, sha)) warm++;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ repo: baseRepo, total: shas.length, warm, cold: shas.length - warm }));
}

export async function handlePrewarmRoute(req, url, res, opts) {
  if (url.pathname === '/snapshot/prewarm' && req.method === 'POST') {
    await handlePost(url, res, opts);
    return true;
  }
  if (url.pathname === '/snapshot/prewarm' && req.method === 'GET') {
    await handleGet(url, res, opts);
    return true;
  }
  return false;
}
```

- [ ] **Step 2 : Mount dans `docker-server.mjs`** — import après baseline-seed :
```js
import { handlePrewarmRoute } from './docker-server-prewarm.mjs';
```
Route après baseline-seed :
```js
  // Diff pre-warming on-era (commit-level time-travel §3.4)
  if (await handlePrewarmRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;
```

- [ ] **Step 3 : Cron hook dans `docker-server-watches.mjs`** — import (à côté de `maybeReindexRepo`) :
```js
import { maybePrewarmRepo } from './docker-server-prewarm.mjs';
```
Dans la boucle de `cronTick`, après `await maybeReindexRepo(repo, apiBase).catch(() => {});` :
```js
    await maybePrewarmRepo(repo).catch(() => {});
```

- [ ] **Step 4 : COPY dans `Dockerfile.web`** — après baseline-seed :
```
COPY docker-server-prewarm.mjs ./docker-server-prewarm.mjs
```

- [ ] **Step 5 : Test d'intégration** `tests/integration/endpoints/prewarm.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('/snapshot/prewarm', () => {
  it('400 when repo missing (GET + POST)', async () => {
    expect((await fetch(`${BASE}/snapshot/prewarm`)).status).toBe(400);
    expect((await fetch(`${BASE}/snapshot/prewarm`, { method: 'POST' })).status).toBe(400);
  });

  it('404 for unknown repo', async () => {
    expect((await fetch(`${BASE}/snapshot/prewarm?repo=nope-xyz`)).status).toBe(404);
  });

  it('GET returns { total, warm, cold } over the last N commits', async () => {
    const res = await fetch(`${BASE}/snapshot/prewarm?repo=${FIXTURE.name}&max=5`);
    expect(res.ok).toBe(true);
    const d = await res.json();
    expect(d).toHaveProperty('total');
    expect(d).toHaveProperty('warm');
    expect(d).toHaveProperty('cold');
    expect(d.total).toBeGreaterThanOrEqual(1);
    expect(d.warm + d.cold).toBe(d.total);
  });

  it('POST returns 202 { queued } (fire-and-forget)', async () => {
    const res = await fetch(`${BASE}/snapshot/prewarm?repo=${FIXTURE.name}&max=2`, { method: 'POST' });
    expect(res.status).toBe(202);
    const d = await res.json();
    expect(d).toHaveProperty('queued');
  });
});
```

- [ ] **Step 6 : Commit** : `git add tests/integration/endpoints/prewarm.test.mjs && git commit -m "feat(prewarm): docker-server-prewarm.mjs (cron + POST/GET /snapshot/prewarm) + cron hook (Task 2)"`

---

### Task 3 : Frontend — pré-chauffage on-era (Timeline)

**Files:** Modify `upstream/gitnexus-web/src/components/Timeline.tsx`

- [ ] **Step 1 : Fire-and-forget à l'entrée du mode Commits** — dans le `useEffect` qui fetch `/commits` (Plan 1), après `setCommits(...)` dans le `.then`, ajouter un POST prewarm best-effort sur la même plage :

Remplacer le `.then((data) => { if (!cancelled) setCommits(...); })` par :
```tsx
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.commits) ? data.commits : [];
        setCommits(list);
        // Pré-chauffage on-era (§3.4) : chauffe les diffs de la plage chargée
        // en fond pour que les clics suivants soient instantanés. Best-effort.
        if (list.length > 0) {
          fetch(`/snapshot/prewarm?repo=${encodeURIComponent(baseRepo)}&max=${list.length}`, { method: 'POST' }).catch(() => {});
        }
      })
```

- [ ] **Step 2 : Vérifier le build** (porte de compilation) en Task 4 — pas de test composant dédié (fire-and-forget sans UI ; le fetch mock du test Plan 1 ignore /snapshot/prewarm → retour `{}` inoffensif). Confirmer juste que les tests composant existants ne régressent pas.

- [ ] **Step 3 : Commit** : `git commit --allow-empty -m "feat(prewarm): Timeline fires on-era prewarm on entering Commits mode (Task 3)"`
*(Edit upstream/ → sérialisé dans le patch en Task 4.)*

---

### Task 4 : Build, smoke, docs, spec amend, ROADMAP, patch

- [ ] **Step 1 : Build** `docker compose build gitnexus-web` → exit 0 ; `docker compose up -d gitnexus-web`.
- [ ] **Step 2 : Smoke** (ajouter au smoke loop de `CLAUDE.md` + lancer) :
```bash
curl -s -o /dev/null -w "prewarm GET: HTTP %{http_code}\n" "http://localhost:4173/snapshot/prewarm?repo=hmm_studio&max=10"
curl -s -o /dev/null -w "prewarm POST: HTTP %{http_code}\n" -X POST "http://localhost:4173/snapshot/prewarm?repo=hmm_studio&max=3"
```
Attendu : GET 200, POST 202.
- [ ] **Step 3 : INVENTORY.md** — ligne pour `POST/GET /snapshot/prewarm` + la config `incremental.preWarm`.
- [ ] **Step 4 : Spec amend** — section `## Update 2026-05-29 — Plan 3 (C) livré` dans le spec (cron on-push opt-in + on-era POST + GET status ; cap par tick `PREWARM_PER_TICK`).
- [ ] **Step 5 : ROADMAP.md** — entrée "Déjà livré" #62 (pièce C) + mettre à jour la ligne "Dernière mise à jour" (chantier commit-level time-travel A+B+C complet).
- [ ] **Step 6 : Regen patch** : `git -C upstream add -N . && git -C upstream diff HEAD > patches/upstream-all.diff && git -C upstream reset`. **Vérifier** `grep -c 'Binary files' patches/upstream-all.diff` = 0 et `grep -c '+export async function handlePrewarmRoute' patches/upstream-all.diff` ≥ 1.
- [ ] **Step 7 : Commit** : `git add CLAUDE.md INVENTORY.md ROADMAP.md docs/superpowers/specs/2026-05-28-commit-level-time-travel-design.md docs/superpowers/plans/2026-05-29-diff-prewarming.md patches/upstream-all.diff && git commit -m "docs(prewarm): smoke + INVENTORY + ROADMAP #62 + spec amend + plan + patch (Task 4)"`

---

## Self-Review

**Spec coverage (§3.4)** : on-push (Task 2 `maybePrewarmRepo` + cron hook, opt-in config Task 1) ✅ ; on-era (Task 2 `POST /snapshot/prewarm` + Task 3 trigger) ✅ ; même cache disque consommé par `/graph/at-commit` (génère via `/snapshot/incremental`) ✅ ; cap anti-storm (`PER_TICK_CAP` + `_inflight` garde) — protège contre la backfill 50×50s d'un coup.

**Placeholders** : aucun — code réel. Commits `--allow-empty` (Task 3) volontaires (code dans le patch, Task 4).

**Type/contract consistency** : `incremental.{preWarm,preWarmCommits}` cohérent config↔`maybePrewarmRepo`. `/snapshot/prewarm` GET `{total,warm,cold}` / POST `{queued}`. `diffExists` lit les mêmes chemins (`.gitnexus/incremental/<sha>.json[.gz|.br]`) que `readDiff` de `docker-server-snapshot-incremental.mjs`. La pré-chauffe POST sur `SELF` (`:4173`) = même cible que le lazy de `/graph/at-commit`.

**Risque NUL/patch (leçon Plan 2)** : vérifier explicitement `grep -c 'Binary files'` = 0 sur le patch régénéré (Task 4 Step 6) avant commit.

**Env** : tests host non-exécutables (Node 21<22) → vérif Docker build + smoke (GET 200/POST 202) + intégration différée.

**Hors scope** : pas de status temps-réel/SSE de la pré-chauffe (le GET pollable suffit) ; pas d'indicateur UI dédié (fire-and-forget, bénéfice = clics plus rapides) ; purge des vieux diffs hors scope (déjà noté Plan 2).
