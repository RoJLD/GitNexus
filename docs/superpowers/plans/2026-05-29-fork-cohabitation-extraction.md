# Fork-Cohabitation Extraction (Phase 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer un dépôt frère `fork-cohabitation` (CLI `cohabit`) qui généralise le mécanisme de cohabitation (bump / drift / release-watch) à N repos via un registre + une config par repo, gitnexus devenant consommateur #1.

**Architecture:** Outil Node ESM config-driven. Cœurs purs **extraits verbatim** des 3 scripts gitnexus (Phases 1-2), I/O re-paramétrée par config. Un registre fin `repos.json` (nom→chemin+tier+cadence) + orchestration `watch --all`/`--due`. gitnexus garde ses scripts gelés (autonomie) + un test de parité comme oracle. JSON partout, zéro dépendance runtime.

**Tech Stack:** Node ESM (`.mjs`), Vitest, git (`git ls-remote`, `git apply`, `git diff --diff-filter`). Les fonctions pures sont sans I/O (testables) ; l'I/O vit dans des wrappers `run*` + le CLI.

**Pré-requis (lire avant de commencer) :**
- Le nouveau repo est créé À CÔTÉ de gitnexus : `C:\Users\rdenis\VScode\fork-cohabitation\` (frère, PAS un sous-dossier). Ses commits sont indépendants de la branche `deployment` de gitnexus.
- Identité git OBLIGATOIRE dans CHAQUE repo : `git config user.email` → `roblastar@live.fr`. Pour le nouveau repo, la fixer juste après `git init`. Si une commande prépare un commit avec un autre email, STOP/BLOCKED.
- Les fonctions pures à « extraire verbatim » existent dans `c:\Users\rdenis\VScode\gitnexus\scripts\{check-patch-drift,check-upstream-releases,bump-upstream}.mjs` — l'implémenteur DOIT lire le fichier source nommé et copier les fonctions à l'identique (le seul changement explicite est signalé par tâche).
- Tests : chaque repo a son propre `npm test` (Vitest). Dans `fork-cohabitation`, `npm test` lance vitest sur `tests/`.
- Ne jamais `--no-verify`/amend/force-push. Stager des chemins explicites.

---

## File Structure (fork-cohabitation)

```
fork-cohabitation/
├── package.json              {type:module, bin:{cohabit:bin/cohabit.mjs}, scripts.test:vitest, devDep vitest}
├── bin/cohabit.mjs           CLI dispatch + orchestration --all/--due (I/O ; peut utiliser Date.now())
├── src/
│   ├── config.mjs            validateConfig/normalizeConfig (purs) + loadConfig (I/O)
│   ├── registry.mjs          cadenceDays/isDue/dueRepos/resolveRepo (purs) + loadRegistry (I/O)
│   ├── drift.mjs             filesInDiff/compareDiffFileSets/normalizeDiff (purs, lift) + runDrift (I/O)
│   ├── release-watch.mjs     parsePinnedVersion/parseStableTags/cmpSemver/compareToLatest (purs) + runReleaseWatch (I/O)
│   └── bump.mjs              formatBumpReport/listDiffFiles/applyPerFile (purs/quasi) + runBump (I/O)
├── repos.json                registre : [{name,path,tier,cadence,lastWatch}]
├── tests/unit/*.test.mjs     tests des fonctions pures
├── tests/parity/*.test.mjs   parité central vs scripts gitnexus (subprocess)
├── vitest.config.mjs
├── README.md  CLAUDE.md  LICENSE  .gitignore
```
**gitnexus (consommateur #1) :** ajout `cohabitation.config.json` ; ses 3 scripts CONSERVÉS + gelés ; docs mises à jour.

---

## Task 1: Scaffold du dépôt `fork-cohabitation`

**Files (dans `c:\Users\rdenis\VScode\fork-cohabitation\`):** `package.json`, `vitest.config.mjs`, `.gitignore`, `README.md`, `CLAUDE.md`, `LICENSE`, `tests/unit/.gitkeep`.

- [ ] **Step 1: Créer le dossier + git init + identité**
```bash
cd c:/Users/rdenis/VScode
mkdir fork-cohabitation && cd fork-cohabitation
git init
git config user.email "roblastar@live.fr"
git config user.name "Robin DENIS"
git config user.email   # DOIT afficher roblastar@live.fr
```

- [ ] **Step 2: `package.json`**
```json
{
  "name": "fork-cohabitation",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "cohabit": "bin/cohabit.mjs" },
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^4.1.6" }
}
```

- [ ] **Step 3: `vitest.config.mjs`**
```js
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/**/*.test.mjs'], testTimeout: 30000 },
});
```

- [ ] **Step 4: `.gitignore`**
```
node_modules/
*.log
/tmp/
```

- [ ] **Step 5: `README.md`, `CLAUDE.md`, `LICENSE`**
- `README.md` : titre `# fork-cohabitation`, 1 paragraphe (« Outil générique pour faire cohabiter un fork avec son upstream : dry-run de bump, garde de dérive de patches, veille de release ; piloté par une config par repo + un registre multi-repo. Né de l'extraction du mécanisme gitnexus — voir gitnexus `docs/superpowers/specs/2026-05-29-*`. »). Laisser l'usage CLI détaillé pour la Task 9.
- `CLAUDE.md` : court — règle d'identité git (`roblastar@live.fr`), « JSON zéro-dep, fonctions pures + I/O séparée, TDD ».
- `LICENSE` : copier le texte MIT de `c:\Users\rdenis\VScode\repo-template\LICENSE` (lire ce fichier) en mettant `Robin DENIS` comme détenteur.

- [ ] **Step 6: `tests/unit/.gitkeep`** (fichier vide, pour que le dossier existe).

- [ ] **Step 7: Installer + vérifier que le runner tourne**
```bash
npm install
npm test   # vitest : "No test files found" est OK à ce stade (exit peut être non-zéro ; on ajoute des tests dès Task 2)
```
Note : si `npm test` exit non-zéro faute de tests, c'est attendu ici — la Task 2 ajoute le premier test.

- [ ] **Step 8: Commit**
```bash
git config user.email   # roblastar@live.fr
git add package.json vitest.config.mjs .gitignore README.md CLAUDE.md LICENSE tests/unit/.gitkeep
git commit -m "chore: scaffold fork-cohabitation (CLI cohabit, vitest, JSON zero-dep)"
```

---

## Task 2: `src/config.mjs` — chargement + validation de la config par repo

**Files:** Create `src/config.mjs`, `tests/unit/config.test.mjs`.

- [ ] **Step 1: Test (échoue)** — `tests/unit/config.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { validateConfig, normalizeConfig } from '../../src/config.mjs';

const OK = {
  upstreamUrl: 'https://github.com/x/y.git',
  additiveDiff: 'patches/additive-files.diff',
  inplaceDiff: 'patches/inplace-edits.diff',
  pinFile: 'Dockerfile.cli',
  pinPattern: 'y:(\\d+\\.\\d+\\.\\d+)',
};

describe('validateConfig', () => {
  it('aucune erreur pour une config complète', () => {
    expect(validateConfig(OK)).toEqual([]);
  });
  it('signale les champs requis manquants', () => {
    const errs = validateConfig({ upstreamUrl: 'u' });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(' ')).toContain('pinFile');
  });
  it('signale une pinPattern regex invalide', () => {
    const errs = validateConfig({ ...OK, pinPattern: '(' });
    expect(errs.join(' ')).toMatch(/pinPattern/);
  });
});

describe('normalizeConfig', () => {
  it('applique cloneDir=upstream par défaut', () => {
    expect(normalizeConfig(OK).cloneDir).toBe('upstream');
  });
  it('respecte un cloneDir fourni', () => {
    expect(normalizeConfig({ ...OK, cloneDir: 'vendor' }).cloneDir).toBe('vendor');
  });
});
```

- [ ] **Step 2: Run, FAIL** — `npm test config` → module introuvable.

- [ ] **Step 3: Implémenter `src/config.mjs`**
```js
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED = ['upstreamUrl', 'additiveDiff', 'inplaceDiff', 'pinFile', 'pinPattern'];

export function validateConfig(obj) {
  const errors = [];
  for (const k of REQUIRED) {
    if (typeof obj[k] !== 'string' || obj[k].length === 0) errors.push(`champ requis manquant ou vide : ${k}`);
  }
  if (typeof obj.pinPattern === 'string') {
    try { new RegExp(obj.pinPattern); } catch { errors.push(`pinPattern n'est pas une regex valide : ${obj.pinPattern}`); }
  }
  return errors;
}

export function normalizeConfig(obj) {
  return { cloneDir: 'upstream', ...obj };
}

export function loadConfig(repoPath) {
  const p = resolve(repoPath, 'cohabitation.config.json');
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const errors = validateConfig(raw);
  if (errors.length) throw new Error(`config invalide (${p}) :\n  ${errors.join('\n  ')}`);
  return normalizeConfig(raw);
}
```

- [ ] **Step 4: Run, PASS** — `npm test config` (5 cas).

- [ ] **Step 5: Commit**
```bash
git config user.email   # roblastar@live.fr
git add src/config.mjs tests/unit/config.test.mjs
git commit -m "feat(config): per-repo cohabitation config load + validation"
```

---

## Task 3: `src/registry.mjs` — registre fin + cadence/tier

**Files:** Create `src/registry.mjs`, `tests/unit/registry.test.mjs`.

- [ ] **Step 1: Test (échoue)** — `tests/unit/registry.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { cadenceDays, isDue, dueRepos, resolveRepo } from '../../src/registry.mjs';

const DAY = 86400000;
const REG = [
  { name: 'a', path: '../a', tier: 'normal', cadence: 'weekly', lastWatch: null },
  { name: 'b', path: '../b', tier: 'critical', cadence: 'daily', lastWatch: '2026-05-01T00:00:00.000Z' },
];

describe('cadenceDays', () => {
  it('mappe les noms connus', () => {
    expect(cadenceDays('daily')).toBe(1);
    expect(cadenceDays('weekly')).toBe(7);
    expect(cadenceDays('monthly')).toBe(30);
  });
  it('renvoie null pour une cadence inconnue', () => {
    expect(cadenceDays('hourly')).toBe(null);
  });
});

describe('isDue', () => {
  it('dû si jamais surveillé (lastWatch null)', () => {
    expect(isDue(REG[0], Date.parse('2026-05-29T00:00:00Z'))).toBe(true);
  });
  it('dû si l’intervalle de cadence est dépassé', () => {
    const now = Date.parse('2026-05-29T00:00:00Z'); // bien > 1 jour après lastWatch de b
    expect(isDue(REG[1], now)).toBe(true);
  });
  it('pas dû si dans l’intervalle', () => {
    const entry = { ...REG[1], lastWatch: '2026-05-29T00:00:00.000Z' };
    const now = Date.parse('2026-05-29T06:00:00Z'); // 6h < 1 jour
    expect(isDue(entry, now)).toBe(false);
  });
  it('dû (conservateur) si cadence inconnue', () => {
    const entry = { ...REG[1], cadence: 'hourly', lastWatch: '2026-05-29T00:00:00.000Z' };
    expect(isDue(entry, Date.parse('2026-05-29T00:30:00Z'))).toBe(true);
  });
});

describe('dueRepos', () => {
  it('filtre les entrées dues', () => {
    const now = Date.parse('2026-05-02T00:00:00Z'); // a jamais → dû ; b surveillé le 01, daily → dû le 02
    expect(dueRepos(REG, now).map((e) => e.name)).toEqual(['a', 'b']);
  });
});

describe('resolveRepo', () => {
  it('trouve par nom', () => {
    expect(resolveRepo(REG, 'b').tier).toBe('critical');
  });
  it('throw si absent', () => {
    expect(() => resolveRepo(REG, 'zzz')).toThrow(/registre/);
  });
});
```

- [ ] **Step 2: Run, FAIL** — `npm test registry`.

- [ ] **Step 3: Implémenter `src/registry.mjs`**
```js
import { readFileSync } from 'node:fs';

const CADENCE_DAYS = { daily: 1, weekly: 7, monthly: 30 };

export function cadenceDays(cadence) {
  return Object.prototype.hasOwnProperty.call(CADENCE_DAYS, cadence) ? CADENCE_DAYS[cadence] : null;
}

export function isDue(entry, nowMs) {
  if (!entry.lastWatch) return true;
  const days = cadenceDays(entry.cadence);
  if (days === null) return true; // cadence inconnue → toujours dû (conservateur)
  const last = Date.parse(entry.lastWatch);
  if (Number.isNaN(last)) return true;
  return nowMs - last >= days * 86400000;
}

export function dueRepos(registry, nowMs) {
  return registry.filter((e) => isDue(e, nowMs));
}

export function resolveRepo(registry, name) {
  const e = registry.find((r) => r.name === name);
  if (!e) throw new Error(`repo « ${name} » absent du registre`);
  return e;
}

export function loadRegistry(registryPath) {
  return JSON.parse(readFileSync(registryPath, 'utf8'));
}
```

- [ ] **Step 4: Run, PASS** — `npm test registry`.

- [ ] **Step 5: Commit**
```bash
git config user.email   # roblastar@live.fr
git add src/registry.mjs tests/unit/registry.test.mjs
git commit -m "feat(registry): thin multi-repo registry with tier + cadence/due logic"
```

---

## Task 4: `src/drift.mjs` — dérive interne config-driven (extraction)

**Files:** Create `src/drift.mjs`, `tests/unit/drift.test.mjs`.

**Extraction :** lire `c:\Users\rdenis\VScode\gitnexus\scripts\check-patch-drift.mjs` et copier VERBATIM les 3 fonctions pures `filesInDiff`, `compareDiffFileSets`, `normalizeDiff` (les ré-exporter depuis `src/drift.mjs`). Aucun changement à ces fonctions. Ajouter ensuite le wrapper I/O `runDrift` ci-dessous (config-driven, renvoie des données — c'est le CLI qui formate).

- [ ] **Step 1: Test (échoue)** — `tests/unit/drift.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { filesInDiff, compareDiffFileSets, normalizeDiff } from '../../src/drift.mjs';

const DIFF = `diff --git a/foo.mjs b/foo.mjs
new file mode 100644
--- /dev/null
+++ b/foo.mjs
@@ -0,0 +1 @@
+x
diff --git a/bar/App.tsx b/bar/App.tsx
--- a/bar/App.tsx
+++ b/bar/App.tsx
@@ -1 +1 @@
-a
+b
`;

describe('filesInDiff', () => {
  it('extrait les chemins', () => {
    expect([...filesInDiff(DIFF)].sort()).toEqual(['bar/App.tsx', 'foo.mjs']);
  });
});
describe('compareDiffFileSets', () => {
  it('missing/extra/drifted', () => {
    const r = compareDiffFileSets(new Set(['a']), new Set(['a', 'b']));
    expect(r).toEqual({ missing: ['b'], extra: [], drifted: true });
  });
});
describe('normalizeDiff', () => {
  it('CRLF→LF', () => { expect(normalizeDiff('a\r\nb')).toBe('a\nb'); });
});
```

- [ ] **Step 2: Run, FAIL** — `npm test drift`.

- [ ] **Step 3: Implémenter `src/drift.mjs`** — d'abord les 3 fonctions pures copiées verbatim depuis `gitnexus/scripts/check-patch-drift.mjs`, puis :
```js
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ... (filesInDiff, compareDiffFileSets, normalizeDiff copiées verbatim ici, avec `export`) ...

// Renvoie { drifted, reports:[{diff, missing, extra, contentDrift}] }. Ne modifie rien (git add -N + reset).
export function runDrift(repoPath, config) {
  const up = resolve(repoPath, config.cloneDir);
  const reports = [];
  let drifted = false;
  try {
    execFileSync('git', ['add', '-N', '.'], { cwd: up });
    for (const [filter, diffRel] of [['A', config.additiveDiff], ['M', config.inplaceDiff]]) {
      const liveText = execFileSync('git', ['diff', 'HEAD', `--diff-filter=${filter}`], { cwd: up, encoding: 'utf8' });
      const committedText = readFileSync(resolve(repoPath, diffRel), 'utf8');
      const setCmp = compareDiffFileSets(filesInDiff(committedText), filesInDiff(liveText));
      const contentDrift = normalizeDiff(liveText) !== normalizeDiff(committedText);
      if (setCmp.drifted || contentDrift) drifted = true;
      reports.push({ diff: diffRel, missing: setCmp.missing, extra: setCmp.extra, contentDrift });
    }
  } finally {
    execFileSync('git', ['reset'], { cwd: up });
  }
  return { drifted, reports };
}
```

- [ ] **Step 4: Run, PASS** — `npm test drift`.

- [ ] **Step 5: Commit**
```bash
git config user.email   # roblastar@live.fr
git add src/drift.mjs tests/unit/drift.test.mjs
git commit -m "feat(drift): config-driven internal-drift check (pure fns lifted from gitnexus)"
```

---

## Task 5: `src/release-watch.mjs` — veille release config-driven (extraction)

**Files:** Create `src/release-watch.mjs`, `tests/unit/release-watch.test.mjs`.

**Extraction :** lire `c:\Users\rdenis\VScode\gitnexus\scripts\check-upstream-releases.mjs`. Copier VERBATIM `parseStableTags`, `cmpSemver`, `compareToLatest`. **Une généralisation explicite** : `parsePinnedVersion` devient `parsePinnedVersion(pinFileText, pinPattern)` (la regex vient de la config au lieu d'être codée `gitnexus:`).

- [ ] **Step 1: Test (échoue)** — `tests/unit/release-watch.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { parsePinnedVersion, parseStableTags, cmpSemver, compareToLatest } from '../../src/release-watch.mjs';

describe('parsePinnedVersion (pattern depuis config)', () => {
  it('extrait via un pinPattern fourni', () => {
    expect(parsePinnedVersion('FROM ghcr.io/x/y:1.6.5\n', 'y:(\\d+\\.\\d+\\.\\d+)')).toBe('1.6.5');
  });
  it('null si pas de match', () => {
    expect(parsePinnedVersion('FROM node:22\n', 'y:(\\d+\\.\\d+\\.\\d+)')).toBe(null);
  });
});
describe('parseStableTags', () => {
  it('ignore rc/ et peeled ^{}', () => {
    const out = ['a\trefs/tags/v1.6.5', 'b\trefs/tags/v1.6.5^{}', 'c\trefs/tags/rc/x', 'd\trefs/tags/v1.7.0'].join('\n');
    expect(parseStableTags(out).sort()).toEqual(['v1.6.5', 'v1.7.0']);
  });
});
describe('cmpSemver', () => {
  it('numérique', () => { expect(cmpSemver('v1.10.0', 'v1.9.0')).toBeGreaterThan(0); });
});
describe('compareToLatest', () => {
  it('à jour', () => {
    expect(compareToLatest('1.6.5', ['v1.6.4', 'v1.6.5']).upToDate).toBe(true);
  });
  it('alerte si plus récent', () => {
    const r = compareToLatest('1.6.5', ['v1.6.5', 'v1.7.0']);
    expect(r.upToDate).toBe(false); expect(r.latest).toBe('v1.7.0');
  });
  it('liste vide : PAS à jour', () => {
    expect(compareToLatest('1.6.5', []).upToDate).toBe(false);
  });
});
```

- [ ] **Step 2: Run, FAIL** — `npm test release-watch`.

- [ ] **Step 3: Implémenter `src/release-watch.mjs`** — `parseStableTags`/`cmpSemver`/`compareToLatest` verbatim ; `parsePinnedVersion` généralisée ; puis `runReleaseWatch` :
```js
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function parsePinnedVersion(pinFileText, pinPattern) {
  const m = pinFileText.match(new RegExp(pinPattern));
  return m ? m[1] : null;
}

// ... (parseStableTags, cmpSemver, compareToLatest copiées verbatim, avec `export`) ...

// Renvoie { pinned, latest, newer, upToDate }.
export function runReleaseWatch(repoPath, config) {
  const pinned = parsePinnedVersion(readFileSync(resolve(repoPath, config.pinFile), 'utf8'), config.pinPattern);
  if (!pinned) throw new Error(`pin introuvable dans ${config.pinFile} (pattern ${config.pinPattern})`);
  const ls = execFileSync('git', ['ls-remote', '--tags', config.upstreamUrl], { encoding: 'utf8' });
  return compareToLatest(pinned, parseStableTags(ls));
}
```

- [ ] **Step 4: Run, PASS** — `npm test release-watch`.

- [ ] **Step 5: Commit**
```bash
git config user.email   # roblastar@live.fr
git add src/release-watch.mjs tests/unit/release-watch.test.mjs
git commit -m "feat(release-watch): config-driven release watch; pinPattern from config"
```

---

## Task 6: `src/bump.mjs` — dry-run de bump config-driven (extraction)

**Files:** Create `src/bump.mjs`, `tests/unit/bump.test.mjs`.

**Extraction :** lire `c:\Users\rdenis\VScode\gitnexus\scripts\bump-upstream.mjs`. Copier VERBATIM `formatBumpReport`, `listDiffFiles`, `applyPerFile`. Ajouter `runBump` config-driven (clone le tag, applique les diffs depuis la config). Le clone est COMPLET (pas `--depth 1`, requis pour `--3way`).

- [ ] **Step 1: Test (échoue)** — `tests/unit/bump.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { formatBumpReport } from '../../src/bump.mjs';

describe('formatBumpReport', () => {
  it('résume clean/conflict/fail + nomme les fichiers à reprendre', () => {
    const md = formatBumpReport('v1.7.0', [
      { file: 'a.mjs', layer: 'additive', status: 'clean' },
      { file: 'App.tsx', layer: 'inplace', status: 'fail' },
    ]);
    expect(md).toContain('v1.7.0');
    expect(md).toContain('App.tsx');
    expect(md).toMatch(/clean.*1/i);
    expect(md).toMatch(/fail.*1/i);
  });
  it('signale un bump trivial sans conflit', () => {
    const md = formatBumpReport('v1.7.0', [{ file: 'a', layer: 'inplace', status: 'clean' }]);
    expect(md).toMatch(/trivial|aucun conflit/i);
  });
});
```

- [ ] **Step 2: Run, FAIL** — `npm test bump`.

- [ ] **Step 3: Implémenter `src/bump.mjs`** — `formatBumpReport`/`listDiffFiles`/`applyPerFile` verbatim depuis `gitnexus/scripts/bump-upstream.mjs`, puis :
```js
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ... (formatBumpReport, listDiffFiles, applyPerFile copiées verbatim, avec `export`) ...

// Dry-run : clone config.upstreamUrl@target, applique additif (--check) + inplace (--3way).
// Renvoie { target, results:[{file,layer,status}] }. Répertoire de clone jetable, nettoyé.
export function runBump(repoPath, config, target) {
  const tmp = mkdtempSync(join(tmpdir(), 'cohabit-bump-'));
  try {
    execFileSync('git', ['clone', '--branch', target, config.upstreamUrl, tmp], { stdio: 'inherit' });
    const additive = applyPerFile(tmp, resolve(repoPath, config.additiveDiff), 'additive', ['--check']);
    const inplace = applyPerFile(tmp, resolve(repoPath, config.inplaceDiff), 'inplace', ['--3way']);
    return { target, results: [...additive, ...inplace] };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run, PASS** — `npm test bump`.

- [ ] **Step 5: Commit**
```bash
git config user.email   # roblastar@live.fr
git add src/bump.mjs tests/unit/bump.test.mjs
git commit -m "feat(bump): config-driven bump dry-run (pure fns lifted from gitnexus)"
```

---

## Task 7: `bin/cohabit.mjs` — CLI + orchestration `watch --all`/`--due`

**Files:** Create `bin/cohabit.mjs`, `tests/unit/orchestration.test.mjs`.

**Conception :** le CLI est l'unique couche qui FORMATE et utilise l'horloge (`Date.now()` autorisé ici — c'est la frontière I/O, pas une fonction pure). Une fonction pure `selectWatchTargets(registry, opts, nowMs)` décide quels repos surveiller ; elle est testée. Le reste de `main()` (lire registre, charger config, appeler `run*`, imprimer, écrire `lastWatch`) est de l'I/O non unit-testé (couvert par la parité Task 8 + l'usage réel).

- [ ] **Step 1: Test (échoue)** — `tests/unit/orchestration.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { selectWatchTargets } from '../../bin/cohabit.mjs';

const REG = [
  { name: 'a', cadence: 'weekly', lastWatch: null },
  { name: 'b', cadence: 'daily', lastWatch: '2026-05-29T00:00:00.000Z' },
];
const NOW = Date.parse('2026-05-29T06:00:00Z');

describe('selectWatchTargets', () => {
  it('--all renvoie tout', () => {
    expect(selectWatchTargets(REG, { all: true }, NOW).map((e) => e.name)).toEqual(['a', 'b']);
  });
  it('--due ne renvoie que les dus', () => {
    // a jamais surveillé → dû ; b surveillé il y a 6h, daily → pas dû
    expect(selectWatchTargets(REG, { due: true }, NOW).map((e) => e.name)).toEqual(['a']);
  });
  it('un nom explicite renvoie ce repo', () => {
    expect(selectWatchTargets(REG, { name: 'b' }, NOW).map((e) => e.name)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run, FAIL** — `npm test orchestration`.

- [ ] **Step 3: Implémenter `bin/cohabit.mjs`**
```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { loadRegistry, resolveRepo, dueRepos } from '../src/registry.mjs';
import { runDrift } from '../src/drift.mjs';
import { runReleaseWatch } from '../src/release-watch.mjs';
import { runBump, formatBumpReport } from '../src/bump.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = resolve(ROOT, 'repos.json');

// PURE : choisit les repos cibles selon les options.
export function selectWatchTargets(registry, opts, nowMs) {
  if (opts.all) return registry;
  if (opts.due) return dueRepos(registry, nowMs);
  if (opts.name) return registry.filter((e) => e.name === opts.name);
  return [];
}

function repoPathOf(entry) { return resolve(ROOT, entry.path); }

function cmdDrift(name) {
  const reg = loadRegistry(REGISTRY);
  const entry = resolveRepo(reg, name);
  const { drifted, reports } = runDrift(repoPathOf(entry), loadConfig(repoPathOf(entry)));
  for (const r of reports) {
    if (r.missing.length || r.extra.length || r.contentDrift) {
      console.error(`DÉRIVE — ${r.diff}:`);
      r.missing.forEach((f) => console.error(`  + ${f}`));
      r.extra.forEach((f) => console.error(`  - ${f}`));
      if (!r.missing.length && !r.extra.length && r.contentDrift) console.error('  (contenu divergent)');
    } else { console.log(`${r.diff}: OK`); }
  }
  process.exit(drifted ? 1 : 0);
}

function cmdBump(name, target) {
  const reg = loadRegistry(REGISTRY);
  const entry = resolveRepo(reg, name);
  const { results } = runBump(repoPathOf(entry), loadConfig(repoPathOf(entry)), target);
  console.log(formatBumpReport(target, results));
}

function cmdWatch(opts) {
  const reg = loadRegistry(REGISTRY);
  const targets = selectWatchTargets(reg, opts, Date.now());
  let alert = false;
  for (const entry of targets) {
    try {
      const r = runReleaseWatch(repoPathOf(entry), loadConfig(repoPathOf(entry)));
      if (r.upToDate) console.log(`${entry.name} : à jour (${r.latest}).`);
      else { alert = true; console.log(`${entry.name} : ALERTE pin ${r.pinned} → ${r.latest} (nouveaux: ${r.newer.join(', ')}).`); }
      entry.lastWatch = new Date().toISOString();
    } catch (e) { console.error(`${entry.name} : erreur — ${e.message}`); }
  }
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n');
  process.exit(alert ? 10 : 0);
}

function main(argv) {
  const [cmd, a, b] = argv;
  if (cmd === 'drift' && a) return cmdDrift(a);
  if (cmd === 'bump' && a && b) return cmdBump(a, b);
  if (cmd === 'watch') {
    if (a === '--all') return cmdWatch({ all: true });
    if (a === '--due') return cmdWatch({ due: true });
    if (a) return cmdWatch({ name: a });
  }
  console.error('usage: cohabit drift <repo> | bump <repo> <tag> | watch <repo>|--all|--due');
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
```

- [ ] **Step 4: Run, PASS** — `npm test orchestration`.

- [ ] **Step 5: Run the full suite** — `npm test` (toutes les tâches 2-7 : config, registry, drift, release-watch, bump, orchestration) → tout vert.

- [ ] **Step 6: Commit**
```bash
git config user.email   # roblastar@live.fr
git add bin/cohabit.mjs tests/unit/orchestration.test.mjs
git commit -m "feat(cli): cohabit CLI (drift/bump/watch) + multi-repo --all/--due orchestration"
```

---

## Task 8: gitnexus = consommateur #1 (config + registre + parité)

**Files:**
- Create: `c:\Users\rdenis\VScode\gitnexus\cohabitation.config.json`
- Create: `c:\Users\rdenis\VScode\fork-cohabitation\repos.json`
- Create: `c:\Users\rdenis\VScode\fork-cohabitation\tests\parity\gitnexus-drift.test.mjs`

- [ ] **Step 1: `gitnexus/cohabitation.config.json`** (committé DANS gitnexus, branche `deployment`)
```json
{
  "upstreamUrl": "https://github.com/abhigyanpatwari/gitnexus.git",
  "cloneDir": "upstream",
  "additiveDiff": "patches/additive-files.diff",
  "inplaceDiff": "patches/inplace-edits.diff",
  "pinFile": "Dockerfile.cli",
  "pinPattern": "gitnexus:(\\d+\\.\\d+\\.\\d+)"
}
```

- [ ] **Step 2: `fork-cohabitation/repos.json`**
```json
[
  { "name": "gitnexus", "path": "../gitnexus", "tier": "normal", "cadence": "weekly", "lastWatch": null }
]
```

- [ ] **Step 3: Test de parité (oracle) — `fork-cohabitation/tests/parity/gitnexus-drift.test.mjs`**
Lance le script gitnexus local ET le CLI central sur gitnexus, et assert un verdict identique (même exit code). Skip propre si le repo gitnexus frère est absent.
```js
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GITNEXUS = resolve(ROOT, '../gitnexus');

function exitCodeOf(fn) {
  try { fn(); return 0; } catch (e) { return typeof e.status === 'number' ? e.status : 1; }
}

describe.skipIf(!existsSync(GITNEXUS))('parité drift central vs script gitnexus', () => {
  it('même exit code (0 clean / 1 drift) que check-patch-drift.mjs', () => {
    const local = exitCodeOf(() =>
      execFileSync('node', [resolve(GITNEXUS, 'scripts/check-patch-drift.mjs')], { stdio: 'pipe' }));
    const central = exitCodeOf(() =>
      execFileSync('node', [resolve(ROOT, 'bin/cohabit.mjs'), 'drift', 'gitnexus'], { stdio: 'pipe' }));
    expect(central).toBe(local);
  });
});
```

- [ ] **Step 4: Lancer la parité** — depuis `fork-cohabitation` : `npm test parity`
Expected : PASS (même exit code). Si gitnexus absent → test skippé proprement. Noter le verdict (et l'exit code observé) dans le rapport.

- [ ] **Step 5: Commits (DEUX reposséparés)**
Dans `fork-cohabitation` :
```bash
git config user.email   # roblastar@live.fr
git add repos.json tests/parity/gitnexus-drift.test.mjs
git commit -m "feat(registry): onboard gitnexus as consumer #1 + drift parity oracle test"
```
Dans `gitnexus` (branche `deployment`) :
```bash
cd c:/Users/rdenis/VScode/gitnexus
git config user.email   # roblastar@live.fr
git add cohabitation.config.json
git commit -m "feat(cohabitation): add cohabitation.config.json (consumer of fork-cohabitation)"
```

---

## Task 9: Docs — gel des scripts gitnexus + contrat générique + pointeurs

**Files:**
- Modify: `c:\Users\rdenis\VScode\fork-cohabitation\README.md`
- Modify: `c:\Users\rdenis\VScode\gitnexus\patches\README.md`
- Modify: `c:\Users\rdenis\VScode\gitnexus\CLAUDE.md`
- Modify: `c:\Users\rdenis\VScode\gitnexus\INVENTORY.md`

- [ ] **Step 1: `fork-cohabitation/README.md` — le contrat générique + usage CLI**
Étendre le README avec : (a) une section « Usage » documentant `cohabit drift <repo>` / `bump <repo> <tag>` / `watch <repo>|--all|--due` et les codes de sortie (drift 0/1 ; watch 0 à jour / 10 alerte / 2 erreur) ; (b) une section « Onboarder un repo » : ajouter un `cohabitation.config.json` au repo + une entrée dans `repos.json` (champs : name, path, tier, cadence) ; (c) une section « Contrat » résumant la règle de bump conservatrice (stable seulement, jamais `main`, dry-run comme gate) — reprise générique du contrat gitnexus, avec pointeur vers `../gitnexus/docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md` comme origine.

- [ ] **Step 2: `gitnexus/patches/README.md` — pointeur + gel**
Dans la section « Cohabitation contract » (Phase 2), ajouter un paragraphe : *« L'outil générique multi-repo vit désormais dans le dépôt frère `fork-cohabitation` (CLI `cohabit`). Les 3 scripts `scripts/check-patch-drift.mjs` / `check-upstream-releases.mjs` / `bump-upstream.mjs` de gitnexus sont CONSERVÉS et GELÉS (référence autonome + oracle de parité) : toute évolution de leur logique va désormais dans `fork-cohabitation`. Consolidation (suppression au profit du seul outil central) conditionnée à l'onboarding d'un 2ᵉ repo. Voir spec Phase 3 : `docs/superpowers/specs/2026-05-29-fork-cohabitation-extraction-design.md`. »*

- [ ] **Step 3: `gitnexus/CLAUDE.md` — note de gel**
Dans « ## What lives where » sous `scripts/`, ajouter à la suite des 3 scripts une note inline : `# (gelés — outil générique dans le repo frère fork-cohabitation ; cf. spec Phase 3)`. Et dans « When you ship a feature », à côté de la ligne `check-patch-drift`, préciser qu'on peut aussi lancer `node ../fork-cohabitation/bin/cohabit.mjs drift gitnexus` (équivalent via l'outil central).

- [ ] **Step 4: `gitnexus/INVENTORY.md` — entrée Phase 3**
Dans la section des ajouts cohabitation, ajouter un paragraphe « Extraction Phase 3 (2026-05-29) » : le dépôt frère `fork-cohabitation` (CLI `cohabit`, outil config-driven + registre multi-repo), gitnexus = consommateur #1 via `cohabitation.config.json`, scripts gitnexus gelés + oracle de parité. Pointeur vers le spec Phase 3.

- [ ] **Step 5: Vérification**
```bash
grep -n "fork-cohabitation" gitnexus/patches/README.md gitnexus/CLAUDE.md gitnexus/INVENTORY.md   # >=1 hit chacun
```

- [ ] **Step 6: Commits (DEUX repos)**
Dans `fork-cohabitation` :
```bash
git config user.email   # roblastar@live.fr
git add README.md
git commit -m "docs: CLI usage, onboarding, and generic cohabitation contract"
```
Dans `gitnexus` :
```bash
cd c:/Users/rdenis/VScode/gitnexus
git config user.email   # roblastar@live.fr
git add patches/README.md CLAUDE.md INVENTORY.md
git commit -m "docs(cohabitation): point to fork-cohabitation; mark gitnexus scripts frozen (Phase 3)"
```

---

## Self-Review (auteur du plan)

- **Couverture du spec :** §3.1 dépôt → Task 1 ; §3.2 outil config-driven (config + 3 commandes) → Tasks 2,4,5,6 ; §3.3 registre → Task 3 ; §3.4 orchestration `--all`/`--due` → Task 7 ; §3.5 gitnexus consommateur (config, registre, parité, gel, pointeurs) → Tasks 8-9. Hors-scope §4 (scheduler réel, suppression des scripts gitnexus, 2ᵉ repo, dashboard) → PAS de tâche, conforme. Vérification § spec → Step de parité Task 8 + `npm test` Task 7 Step 5.
- **Placeholders :** les fonctions pures « extraites verbatim » référencent un FICHIER SOURCE EXACT existant (`gitnexus/scripts/*.mjs`) + le seul changement explicite (parsePinnedVersion gagne un paramètre `pinPattern`) — instruction précise, pas un placeholder. Tout le code neuf (config, registry, run*, CLI, tests) est complet.
- **Cohérence des signatures :** `loadConfig(repoPath)`→objet avec `cloneDir/additiveDiff/inplaceDiff/pinFile/pinPattern/upstreamUrl` ; `runDrift(repoPath, config)`→`{drifted, reports}` ; `runReleaseWatch(repoPath, config)`→`{pinned,latest,newer,upToDate}` ; `runBump(repoPath, config, target)`→`{target, results}` ; `selectWatchTargets(registry, opts, nowMs)` ; `resolveRepo/dueRepos/isDue/cadenceDays` cohérents entre registry.mjs (Task 3), son test, et le CLI (Task 7). `parsePinnedVersion(text, pattern)` cohérent entre release-watch.mjs et son test. `formatBumpReport(target, results)` avec `{file,layer,status}` cohérent bump.mjs/test/CLI.

> **Note de taille :** 9 tâches sur 2 dépôts. Tasks 1-7 = le repo `fork-cohabitation` (commits là-bas). Tasks 8-9 = double commit (fork-cohabitation + gitnexus). L'exécuteur doit faire attention au `cwd` et à l'identité git dans CHAQUE repo.
