# Upstream Cohabitation Contract (Phase 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Outiller et documenter le contrat de cohabitation upstream↔fork : deux gardes de veille (dérive interne + veille release externe) et le wiring doc.

**Architecture:** Deux scripts Node ESM autonomes dans `scripts/`, chacun avec un **cœur pur testable** (parsing/comparaison) + une fine couche I/O (git, fs, API). `check-patch-drift.mjs` régénère le split depuis `upstream/` et le compare aux diffs commités. `check-upstream-releases.mjs` compare notre pin de version à la dernière release stable upstream via `git ls-remote`. Puis le contrat est câblé dans la doc. Spec : `docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md`.

**Tech Stack:** Node ESM (`.mjs`), Vitest (`tests/vitest.config.unit.mjs`), git (`git diff --diff-filter`, `git ls-remote --tags`). Cœurs purs sans I/O pour la testabilité ; cross-platform (pas de binaire unix-only, `fileURLToPath`/`pathToFileURL`).

**Pré-requis (lire avant de commencer) :**
- `upstream/` doit exister (clone de travail patché, état actuel du poste).
- `scripts/` est à la racine du dépôt et EST git-tracké. Les unit tests vivent dans `tests/unit/` et importent depuis `../../scripts/...`. Lancer : `cd tests && npm run test:unit -- <substr1> <substr2>` (filtres = substrings de chemins, PAS regex — passer plusieurs filtres en arguments séparés).
- Identité git OBLIGATOIRE : `git config user.email` → `roblastar@live.fr`. Si autre (ex. @alten.com), STOP/BLOCKED, ne pas committer.
- Stager uniquement les fichiers de la tâche (chemins explicites). Le working tree a des changements non liés (`tests/package-lock.json`, etc.) — ne pas y toucher. Jamais `--no-verify`/amend/force-push.
- **Contexte concurrent :** une autre branche de travail (« group-graph ») a ajouté 3 fichiers `docker-server-group*.mjs` dans `upstream/` sans régénérer les diffs commités. C'est une **vraie dérive interne attendue** — la Task 1 va la détecter, c'est le comportement correct (voir Task 1 Step 5).

---

## File Structure

**Créés :**
- `scripts/check-patch-drift.mjs` — garde de dérive INTERNE. Pur : `filesInDiff(text)`, `compareDiffFileSets(committed, live)`, `normalizeDiff(text)`. I/O : régénère `git diff HEAD --diff-filter=A|M` dans `upstream/`, lit `patches/*.diff`, compare, exit≠0 + rapport si dérive.
- `scripts/check-upstream-releases.mjs` — veille de divergence EXTERNE. Pur : `parsePinnedVersion(dockerfileText)`, `parseStableTags(lsRemoteOutput)`, `cmpSemver(a, b)`, `compareToLatest(pinned, tags)`. I/O : lit `Dockerfile.cli`, `git ls-remote --tags`, compare, exit 0 (à jour) ou exit 10 (release plus récente — alerte, pas une erreur).
- `tests/unit/check-patch-drift.test.mjs` — teste les fonctions pures de la garde interne.
- `tests/unit/check-upstream-releases.test.mjs` — teste les fonctions pures de la veille externe.

**Modifiés :**
- `CLAUDE.md` (racine gitnexus) — entrée checklist « When you ship » : lancer `check-patch-drift.mjs` ; ajouter les 2 scripts à « What lives where ».
- `patches/README.md` — section « Cohabitation contract » (règle de bump conservatrice + playbook + les 2 gardes), pointeur vers le spec.
- `ROADMAP.md` + `INVENTORY.md` — ligne « déjà livré » / inventaire des 2 scripts de garde.

---

## Task 1: `check-patch-drift.mjs` — garde de dérive interne

**Files:**
- Create: `scripts/check-patch-drift.mjs`
- Create: `tests/unit/check-patch-drift.test.mjs`

- [ ] **Step 1: Écrire le test (échoue)** — Create `tests/unit/check-patch-drift.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { filesInDiff, compareDiffFileSets, normalizeDiff } from '../../scripts/check-patch-drift.mjs';

const DIFF = `diff --git a/docker-server-foo.mjs b/docker-server-foo.mjs
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/docker-server-foo.mjs
@@ -0,0 +1 @@
+export const x = 1;
diff --git a/gitnexus-web/src/App.tsx b/gitnexus-web/src/App.tsx
index 2222222..3333333 100644
--- a/gitnexus-web/src/App.tsx
+++ b/gitnexus-web/src/App.tsx
@@ -1 +1 @@
-old
+new
`;

describe('filesInDiff', () => {
  it('extrait les chemins depuis les lignes `diff --git a/.. b/..`', () => {
    const s = filesInDiff(DIFF);
    expect(s).toBeInstanceOf(Set);
    expect([...s].sort()).toEqual(['docker-server-foo.mjs', 'gitnexus-web/src/App.tsx']);
  });
  it('renvoie un set vide pour un diff vide', () => {
    expect(filesInDiff('').size).toBe(0);
  });
});

describe('compareDiffFileSets', () => {
  it('détecte un fichier présent dans le clone mais absent du diff commité (missing)', () => {
    const committed = new Set(['a.mjs']);
    const live = new Set(['a.mjs', 'b.mjs']);
    const r = compareDiffFileSets(committed, live);
    expect(r.drifted).toBe(true);
    expect(r.missing).toEqual(['b.mjs']);
    expect(r.extra).toEqual([]);
  });
  it('détecte un fichier commité mais disparu du clone (extra)', () => {
    const r = compareDiffFileSets(new Set(['a.mjs', 'c.mjs']), new Set(['a.mjs']));
    expect(r.drifted).toBe(true);
    expect(r.extra).toEqual(['c.mjs']);
    expect(r.missing).toEqual([]);
  });
  it('pas de dérive quand les ensembles sont identiques', () => {
    const r = compareDiffFileSets(new Set(['a.mjs']), new Set(['a.mjs']));
    expect(r.drifted).toBe(false);
  });
});

describe('normalizeDiff', () => {
  it('normalise les fins de ligne CRLF → LF', () => {
    expect(normalizeDiff('a\r\nb\r\n')).toBe('a\nb\n');
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `cd tests && npm run test:unit -- check-patch-drift`
Expected: FAIL — `Cannot find module '../../scripts/check-patch-drift.mjs'`.

- [ ] **Step 3: Implémenter `scripts/check-patch-drift.mjs`**

```js
#!/usr/bin/env node
// Garde de dérive INTERNE : régénère le split depuis le clone upstream/ et le
// compare aux patches/*.diff commités. exit≠0 + rapport si divergence.
// Voir docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md §3.3
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function filesInDiff(diffText) {
  const set = new Set();
  for (const line of diffText.split('\n')) {
    const m = line.match(/^diff --git a\/(.+?) b\//);
    if (m) set.add(m[1]);
  }
  return set;
}

export function compareDiffFileSets(committed, live) {
  const missing = [...live].filter((f) => !committed.has(f)).sort(); // dans le clone, pas commité
  const extra = [...committed].filter((f) => !live.has(f)).sort();   // commité, disparu du clone
  return { missing, extra, drifted: missing.length > 0 || extra.length > 0 };
}

export function normalizeDiff(text) {
  return text.replace(/\r\n/g, '\n');
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const up = resolve(repoRoot, 'upstream');
  execFileSync('git', ['add', '-N', '.'], { cwd: up });
  let drifted = false;
  try {
    for (const [filter, file] of [['A', 'additive-files.diff'], ['M', 'inplace-edits.diff']]) {
      const liveText = execFileSync('git', ['diff', 'HEAD', `--diff-filter=${filter}`], { cwd: up, encoding: 'utf8' });
      const committedText = readFileSync(resolve(repoRoot, 'patches', file), 'utf8');
      const setCmp = compareDiffFileSets(filesInDiff(committedText), filesInDiff(liveText));
      const contentDrift = normalizeDiff(liveText) !== normalizeDiff(committedText);
      if (setCmp.drifted || contentDrift) {
        drifted = true;
        console.error(`DÉRIVE — ${file}:`);
        setCmp.missing.forEach((f) => console.error(`  + ${f} (dans upstream/, absent du diff commité)`));
        setCmp.extra.forEach((f) => console.error(`  - ${f} (dans le diff commité, disparu d'upstream/)`));
        if (!setCmp.drifted && contentDrift) console.error('  (même ensemble de fichiers, mais contenu divergent)');
      } else {
        console.log(`${file}: OK (${filesInDiff(liveText).size} fichiers)`);
      }
    }
  } finally {
    execFileSync('git', ['reset'], { cwd: up });
  }
  if (drifted) {
    console.error('\nRégénérer : voir patches/README.md « Regenerate the diffs ».');
    process.exit(1);
  }
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Lancer le test unitaire, vérifier qu'il passe**

Run: `cd tests && npm run test:unit -- check-patch-drift`
Expected: PASS (6 tests).

- [ ] **Step 5: Exécuter le script en réel + interpréter**

Run (depuis la racine) : `node scripts/check-patch-drift.mjs`
**ATTENDU : exit 1**, avec un rapport listant au minimum `docker-server-group.mjs`, `docker-server-group-graph.mjs`, `docker-server-group-graph-core.mjs` comme `+` (présents dans `upstream/`, absents du `additive-files.diff` commité), et probablement une dérive de contenu sur `docker-server-routes.mjs`.

**C'est le comportement CORRECT** : le script détecte la dérive réelle laissée par le travail concurrent « group-graph ». **NE PAS régénérer les diffs** pour faire « passer » le script (ce sera le livrable du stream group-graph). La tâche est réussie si : (a) les 6 unit tests passent, (b) le run réel produit un rapport de dérive cohérent nommant ces fichiers. Noter le résultat dans le rapport de tâche.

- [ ] **Step 6: Commit**

```bash
git config user.email   # roblastar@live.fr, sinon STOP
git add scripts/check-patch-drift.mjs tests/unit/check-patch-drift.test.mjs
git commit -m "feat(cohabitation): check-patch-drift — detect committed-diff vs upstream/ clone drift"
```

---

## Task 2: `check-upstream-releases.mjs` — veille de divergence externe

**Files:**
- Create: `scripts/check-upstream-releases.mjs`
- Create: `tests/unit/check-upstream-releases.test.mjs`

- [ ] **Step 1: Écrire le test (échoue)** — Create `tests/unit/check-upstream-releases.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import {
  parsePinnedVersion,
  parseStableTags,
  cmpSemver,
  compareToLatest,
} from '../../scripts/check-upstream-releases.mjs';

describe('parsePinnedVersion', () => {
  it('extrait la version depuis le FROM de Dockerfile.cli', () => {
    const txt = 'FROM ghcr.io/abhigyanpatwari/gitnexus:1.6.5\nRUN echo hi\n';
    expect(parsePinnedVersion(txt)).toBe('1.6.5');
  });
  it('renvoie null si aucun tag de version trouvé', () => {
    expect(parsePinnedVersion('FROM node:22\n')).toBe(null);
  });
});

describe('parseStableTags', () => {
  it('extrait les tags vX.Y.Z d’une sortie git ls-remote (ignore rc/ et autres)', () => {
    const out = [
      'abc123\trefs/tags/v1.6.4',
      'def456\trefs/tags/v1.6.5',
      'aaa111\trefs/tags/rc/deadbeef',
      'bbb222\trefs/tags/v1.7.0',
    ].join('\n');
    expect(parseStableTags(out).sort()).toEqual(['v1.6.4', 'v1.6.5', 'v1.7.0']);
  });
});

describe('cmpSemver', () => {
  it('ordonne correctement', () => {
    expect(cmpSemver('v1.6.5', 'v1.6.4')).toBeGreaterThan(0);
    expect(cmpSemver('v1.6.5', 'v1.7.0')).toBeLessThan(0);
    expect(cmpSemver('v1.6.5', 'v1.6.5')).toBe(0);
    expect(cmpSemver('v1.10.0', 'v1.9.0')).toBeGreaterThan(0); // numérique, pas lexical
  });
});

describe('compareToLatest', () => {
  it('à jour quand le pin == la dernière release stable', () => {
    const r = compareToLatest('1.6.5', ['v1.6.4', 'v1.6.5']);
    expect(r.upToDate).toBe(true);
    expect(r.latest).toBe('v1.6.5');
    expect(r.newer).toEqual([]);
  });
  it('signale les releases plus récentes que le pin', () => {
    const r = compareToLatest('1.6.5', ['v1.6.5', 'v1.7.0', 'v1.7.1']);
    expect(r.upToDate).toBe(false);
    expect(r.latest).toBe('v1.7.1');
    expect(r.newer.sort()).toEqual(['v1.7.0', 'v1.7.1']);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `cd tests && npm run test:unit -- check-upstream-releases`
Expected: FAIL — `Cannot find module '../../scripts/check-upstream-releases.mjs'`.

- [ ] **Step 3: Implémenter `scripts/check-upstream-releases.mjs`**

```js
#!/usr/bin/env node
// Veille de divergence EXTERNE : compare notre pin de version à la dernière
// release stable upstream (via git ls-remote, pas d'API key requise).
// Alerte (exit 10), n'agit pas. exit 0 = à jour.
// Voir docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md §3.4
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UPSTREAM_URL = 'https://github.com/abhigyanpatwari/gitnexus.git';

export function parsePinnedVersion(dockerfileText) {
  const m = dockerfileText.match(/gitnexus:(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

export function parseStableTags(lsRemoteOutput) {
  return [...lsRemoteOutput.matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)$/gm)].map((m) => m[1]);
}

export function cmpSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function compareToLatest(pinned, tags) {
  const pin = pinned.startsWith('v') ? pinned : `v${pinned}`;
  const stable = tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).slice().sort(cmpSemver);
  const latest = stable.length ? stable[stable.length - 1] : null;
  const newer = stable.filter((t) => cmpSemver(t, pin) > 0);
  return { pinned: pin, latest, newer, upToDate: newer.length === 0 };
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pinned = parsePinnedVersion(readFileSync(resolve(repoRoot, 'Dockerfile.cli'), 'utf8'));
  if (!pinned) { console.error('check-upstream-releases: pin introuvable dans Dockerfile.cli'); process.exit(2); }
  let lsRemote;
  try {
    lsRemote = execFileSync('git', ['ls-remote', '--tags', UPSTREAM_URL], { encoding: 'utf8' });
  } catch {
    console.error('check-upstream-releases: échec de git ls-remote — réseau ?'); process.exit(2);
  }
  const r = compareToLatest(pinned, parseStableTags(lsRemote));
  if (r.upToDate) {
    console.log(`à jour : pin ${r.pinned} == dernière release stable (${r.latest}).`);
    process.exit(0);
  }
  console.log(`ALERTE : pin ${r.pinned}, dernière stable ${r.latest}. Plus récentes : ${r.newer.join(', ')}.`);
  console.log('Veille seulement — aucune action. Bump = décision conservatrice (cf. contrat §3.1).');
  process.exit(10);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Lancer le test unitaire, vérifier qu'il passe**

Run: `cd tests && npm run test:unit -- check-upstream-releases`
Expected: PASS (8 tests).

- [ ] **Step 5: Exécuter le script en réel + interpréter**

Run (depuis la racine) : `node scripts/check-upstream-releases.mjs`
Expected (réseau requis) : **exit 0** avec « à jour : pin v1.6.5 == dernière release stable (v1.6.5) » — car v1.6.5 EST la dernière release stable upstream au 2026-05-29. Si le réseau est indisponible, exit 2 avec le message ls-remote — le noter et s'appuyer sur les unit tests. Noter le résultat dans le rapport.

- [ ] **Step 6: Commit**

```bash
git config user.email   # roblastar@live.fr, sinon STOP
git add scripts/check-upstream-releases.mjs tests/unit/check-upstream-releases.test.mjs
git commit -m "feat(cohabitation): check-upstream-releases — alert when a newer stable upstream release exists"
```

---

## Task 3: Wiring du contrat dans la doc

**Files:**
- Modify: `CLAUDE.md` (racine gitnexus)
- Modify: `patches/README.md`
- Modify: `ROADMAP.md`
- Modify: `INVENTORY.md`

- [ ] **Step 1: `CLAUDE.md` — checklist + inventaire des scripts**

- Dans la section « ## When you ship a feature here », ajouter un point : *« Lancer `node scripts/check-patch-drift.mjs` avant de committer toute édition d'`upstream/` — il échoue (exit 1) si `additive-files.diff`/`inplace-edits.diff` ne reflètent plus le clone. »*
- Dans « ## What lives where », sous `scripts/`, ajouter deux lignes :
  - `check-patch-drift.mjs    Garde de dérive interne (diffs commités vs clone upstream/)`
  - `check-upstream-releases.mjs  Veille : alerte si une release stable upstream plus récente existe`

- [ ] **Step 2: `patches/README.md` — section « Cohabitation contract »**

Ajouter une nouvelle section (après la section « Bump dry-run » créée en Phase 1) :

```markdown
## Cohabitation contract

The durable contract for living alongside upstream is
`docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md`.
In short:

- **Tracking model:** flat split diffs (`additive-files.diff` + `inplace-edits.diff`),
  not a submodule/subtree (the dry-run shows the hard files fail even in `--3way`,
  so a different merge mechanism would not help).
- **Bump rule (conservative):** bump ONLY when a stable `v1.7.x+` release ships AND
  we need something from it. Never track `main`. `bump-upstream.mjs` is the go/no-go gate.
- **Bump playbook:** dry-run → clone tag → apply `additive-files.diff` (clean) →
  `git apply --3way inplace-edits.diff` → resolve the handful of fails → rebuild +
  smoke loop + tests → regenerate the two diffs → bump version pins → update docs.
- **Watch guards:**
  - `scripts/check-patch-drift.mjs` — internal drift: committed diffs vs the `upstream/`
    clone (run before committing upstream edits).
  - `scripts/check-upstream-releases.mjs` — external drift: alerts (exit 10) when a
    newer stable upstream release exists than our pin.
```

- [ ] **Step 3: `ROADMAP.md` — ligne « déjà livré »**

Ajouter une ligne à la table « Déjà livré » : *« Contrat de cohabitation upstream (Phase 2) — gardes `check-patch-drift.mjs` + `check-upstream-releases.mjs`, contrat documenté »*, pointeur vers `docs/superpowers/specs/2026-05-29-upstream-cohabitation-contract-design.md`. (Format de la table existante.)

- [ ] **Step 4: `INVENTORY.md` — inventaire**

Dans la section « Nos ajouts » (là où la Phase 1 a documenté le layout de patches), ajouter une sous-entrée : les deux scripts de garde (rôle de chacun) et un pointeur vers le contrat. Style de la section existante.

- [ ] **Step 5: Vérification**

```bash
grep -n "check-patch-drift" CLAUDE.md patches/README.md INVENTORY.md       # ≥1 hit chacun
grep -n "check-upstream-releases" CLAUDE.md patches/README.md INVENTORY.md # ≥1 hit chacun
grep -n "Cohabitation contract" patches/README.md                          # 1 hit
```
Expected: chaque grep renvoie au moins le résultat attendu.

- [ ] **Step 6: Commit**

```bash
git config user.email   # roblastar@live.fr, sinon STOP
git add CLAUDE.md patches/README.md ROADMAP.md INVENTORY.md
git commit -m "docs(cohabitation): wire the contract + two watch guards into CLAUDE/README/ROADMAP/INVENTORY"
```

---

## Self-Review (auteur du plan)

- **Couverture du spec :** §3.0 (modèle, déjà acté en Phase 1) — pas de tâche, c'est une décision documentée ; §3.1 règle de bump + §3.2 playbook → documentés en Task 3 (`patches/README.md`) ; §3.3 garde interne → Task 1 ; §3.4 veille externe (cœur réutilisable) → Task 2 ; §3.5 où vit le contrat → Task 3. Hors-scope §4 (hook A-ii, câblage `/schedule`+watches-cron B ii+iii, généralisation multi-repo) → PAS de tâche, conforme. Vérification §6 du spec → couverte par les Step 5 de Task 1/2 (run réel) + unit tests.
- **Placeholders :** aucun ; tout le code des deux scripts + tests est complet ; commandes avec sortie attendue. La Task 1 Step 5 documente explicitement le exit-1 attendu (dérive group-graph) comme un succès de détection.
- **Cohérence des signatures :** `filesInDiff`/`compareDiffFileSets`/`normalizeDiff` identiques entre `check-patch-drift.mjs` et son test ; `parsePinnedVersion`/`parseStableTags`/`cmpSemver`/`compareToLatest` (avec `{pinned, latest, newer, upToDate}`) identiques entre `check-upstream-releases.mjs` et son test. Codes de sortie cohérents : drift=1, veille à-jour=0 / plus-récent=10 / erreur=2.
