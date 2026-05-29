# Upstream Divergence Paydown (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réduire et isoler la surface de conflit du fork gitnexus pour que tout futur bump d'upstream soit une opération à coût connu et borné.

**Architecture:** Quatre chantiers indépendants exécutés dans l'ordre : (1) extraire le câblage de routes de `docker-server.mjs` dans un fichier neuf qu'on possède ; (2) scinder le diff monolithique en additif/in-place via `git diff --diff-filter` ; (3) outiller le bump avec un script de dry-run produisant un rapport de conflit, lancé immédiatement contre `main` ; (4) réparer les docs périmées. Spec : `docs/superpowers/specs/2026-05-29-upstream-divergence-paydown-design.md`.

**Tech Stack:** Node ESM (`.mjs`), Vitest (configs `tests/vitest.config.unit.mjs` + `.integ.mjs`), git (`git apply --3way`, `git diff --diff-filter`), Docker Compose. L'upstream est un clone de travail dans `upstream/` (gitignoré) sur lequel nos patches sont déjà appliqués ; les unit tests importent directement depuis `../../upstream/...`.

**Pré-requis d'environnement (lire avant de commencer):**
- `upstream/` doit exister et contenir nos patches appliqués (état actuel du poste).
- Vérifier l'identité git AVANT tout commit (règle CLAUDE.md) :
  ```bash
  git config user.email   # DOIT afficher roblastar@live.fr
  ```
  Si ce n'est pas le cas, STOP — corriger `.git/config` avant de committer.
- Les tests d'intégration et la smoke loop exigent la stack démarrée (`docker compose up`, ports 4173/4747). Si Docker n'est pas disponible dans l'environnement d'exécution, exécuter au minimum les unit tests et **noter explicitement** dans le résumé de tâche que la vérification d'intégration reste à faire sur une machine avec Docker.

---

## File Structure

**Créés:**
- `upstream/docker-server-routes.mjs` — registre de routes additif : importe les 32 handlers `handleXRoute` + ré-exporte le démarrage du cron, expose `registerGitnexusRoutes(req, reqUrl, res, ctx)` et `startGitnexusCron(api)`. (Vit dans `upstream/`, gitignoré, mais capturé dans `additive-files.diff`.)
- `patches/additive-files.diff` — sortie du split : les ~98 fichiers neufs (dont le nouveau `docker-server-routes.mjs`).
- `patches/inplace-edits.diff` — sortie du split : les 16 fichiers upstream édités en place.
- `patches/bump-dry-run-main.md` — rapport horodaté du dry-run de bump contre `main` (artefact alimentant la phase 2).
- `scripts/bump-upstream.mjs` — outil de dry-run de bump + formateur de rapport pur (`formatBumpReport`).
- `tests/unit/docker-server-routes.test.mjs` — unit test du dispatcher de routes.
- `tests/unit/bump-report.test.mjs` — unit test du formateur de rapport.

**Modifiés:**
- `upstream/docker-server.mjs` — retire les 32 imports + la chaîne de dispatch + le câblage du cron ; les remplace par 3 lignes appelant le shim.
- `upstream/Dockerfile.web` — s'assure que `docker-server-routes.mjs` est copié dans l'image (ajoute une ligne `COPY` si la copie est explicite et non globbée).
- `patches/README.md` — `v1.6.3`→`v1.6.5`, corrige le compte de lignes, documente les deux nouveaux diffs + le script de bump, remplace la commande de régénération.
- `patches/upstream-all.diff` — **supprimé** et remplacé par les deux fichiers split (références mises à jour partout).
- `CLAUDE.md` (racine gitnexus) — section « Regenerate the diff » → nouvelle procédure split ; mentionne `docker-server-routes.mjs` et `scripts/bump-upstream.mjs`.
- `ROADMAP.md` — ligne « déjà livré » pour le paydown.
- `INVENTORY.md` — documente le nouveau layout de patches + l'outil de bump.

---

## Task 1: Extraire le câblage de routes de `docker-server.mjs` vers un shim

**Files:**
- Create: `upstream/docker-server-routes.mjs`
- Create: `tests/unit/docker-server-routes.test.mjs`
- Modify: `upstream/docker-server.mjs` (imports lignes 7-38 ; dispatch ~528-600 ; cron ligne 674)
- Modify: `upstream/Dockerfile.web` (bloc COPY des `docker-server-*.mjs`)

**Contexte:** aujourd'hui `docker-server.mjs` importe 32 handlers et les câble dans une longue chaîne `if (await handleXRoute(req, reqUrl, res, { api: GITNEXUS_API })) return;`. **Attention aux signatures non uniformes** : `handleRegressionRoute(req, reqUrl, res)` est appelé SANS ctx — il faut préserver chaque signature à l'identique. On NE déplace PAS les handlers inline `handleExport`/`handleImport`/`/listdir` (routes utilitaires couplées au module) : ils restent en place par design.

- [ ] **Step 1: Écrire le test unitaire d'abord (échoue)**

Create `tests/unit/docker-server-routes.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import {
  registerGitnexusRoutes,
  startGitnexusCron,
} from '../../upstream/docker-server-routes.mjs';

function mockRes() {
  const res = { statusCode: null, ended: false, body: null, headers: {} };
  res.writeHead = (code, hdrs) => { res.statusCode = code; if (hdrs) Object.assign(res.headers, hdrs); };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = (b) => { res.ended = true; res.body = b ?? null; };
  return res;
}

describe('docker-server-routes shim', () => {
  it('exporte registerGitnexusRoutes et startGitnexusCron comme fonctions', () => {
    expect(typeof registerGitnexusRoutes).toBe('function');
    expect(typeof startGitnexusCron).toBe('function');
  });

  it('retourne false et n’écrit pas de réponse pour un chemin non géré', async () => {
    const req = { method: 'GET', url: '/definitely-not-a-gitnexus-route' };
    const reqUrl = new URL('http://localhost:4747/definitely-not-a-gitnexus-route');
    const res = mockRes();
    const handled = await registerGitnexusRoutes(req, reqUrl, res, { api: null });
    expect(handled).toBe(false);
    expect(res.ended).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `cd tests && npm run test:unit -- docker-server-routes`
Expected: FAIL — `Cannot find module '../../upstream/docker-server-routes.mjs'`.

- [ ] **Step 3: Créer le shim `upstream/docker-server-routes.mjs`**

Copier les 32 lignes d'import (actuellement `docker-server.mjs:7-38`) en tête du nouveau fichier, puis exposer le dispatcher et le cron. Préserver EXACTEMENT les signatures d'appel observées dans la chaîne actuelle (la plupart `{ api: GITNEXUS_API }` passé comme `ctx`, sauf `handleRegressionRoute(req, reqUrl, res)` sans ctx) :

```js
import { handleSnapshotRoute } from './docker-server-snapshots.mjs';
import { handleSnapshotBulkRoute } from './docker-server-snapshots-bulk.mjs';
import { handleChurnRoute } from './docker-server-churn.mjs';
import { handleCouplingRoute } from './docker-server-coupling.mjs';
import { handleGrowthRoute } from './docker-server-growth.mjs';
import { handleLifespanRoute } from './docker-server-lifespan.mjs';
import { handleEntropyRoute } from './docker-server-entropy.mjs';
import { handleOwnershipRoute } from './docker-server-ownership.mjs';
import { handleDissonanceRoute } from './docker-server-dissonance.mjs';
import { handleSemanticLabelsRoute } from './docker-server-semantic-labels.mjs';
import { handleCouplingCrossRoute } from './docker-server-coupling-cross.mjs';
import { handleGrowthCrossRoute } from './docker-server-growth-cross.mjs';
import { handleSimilarityRoute } from './docker-server-similarity.mjs';
import { handleNodesAliveBetweenRoute } from './docker-server-nodes-alive-between.mjs';
import { handleRepoByIdRoute } from './docker-server-repo-id.mjs';
import { handleEntropyCommitsRoute } from './docker-server-entropy-commits.mjs';
import { handleWatchesRoute, startWatchesCron } from './docker-server-watches.mjs';
import { handleCommitFootprintRoute } from './docker-server-commit-footprint.mjs';
import { handleSnapshotAutoRoute } from './docker-server-snapshot-auto.mjs';
import { handleSnapshotFromPrRoute } from './docker-server-snapshot-from-pr.mjs';
import { handleSnapshotIncrementalRoute, handleGraphAtCommitRoute } from './docker-server-snapshot-incremental.mjs';
import { handleGhostsRoute } from './docker-server-ghosts.mjs';
import { handleGhostAuditRoute } from './docker-server-ghost-audit.mjs';
import { handleGhostsCleanupRoute } from './docker-server-ghost-cleanup.mjs';
import { handleConnectorsRoute } from './docker-server-connectors.mjs';
import { handleSysmlExportRoute } from './docker-server-sysml-export.mjs';
import { handleClustersRoute } from './docker-server-cluster-audit.mjs';
import { handleWikiRoute } from './docker-server-wiki.mjs';
import { handleAutoReindexRoute } from './docker-server-auto-reindex.mjs';
import { handleRegressionRoute } from './docker-server-regression.mjs';
import { handleCommitsRoute } from './docker-server-commits.mjs';
import { handleBaselineSeedRoute } from './docker-server-baseline-seed.mjs';

// Renvoie true dès qu'un handler a pris la requête (sémantique identique à
// l'ancienne chaîne `if (await handleX(...)) return;` de docker-server.mjs).
export async function registerGitnexusRoutes(req, reqUrl, res, ctx) {
  if (await handleSnapshotRoute(req, reqUrl, res, ctx)) return true;
  if (await handleSnapshotBulkRoute(req, reqUrl, res, ctx)) return true;
  if (await handleChurnRoute(req, reqUrl, res, ctx)) return true;
  if (await handleCouplingRoute(req, reqUrl, res, ctx)) return true;
  if (await handleGrowthRoute(req, reqUrl, res, ctx)) return true;
  if (await handleLifespanRoute(req, reqUrl, res, ctx)) return true;
  if (await handleEntropyRoute(req, reqUrl, res, ctx)) return true;
  if (await handleOwnershipRoute(req, reqUrl, res, ctx)) return true;
  if (await handleDissonanceRoute(req, reqUrl, res, ctx)) return true;
  if (await handleSemanticLabelsRoute(req, reqUrl, res, ctx)) return true;
  if (await handleCouplingCrossRoute(req, reqUrl, res, ctx)) return true;
  if (await handleGrowthCrossRoute(req, reqUrl, res, ctx)) return true;
  if (await handleSimilarityRoute(req, reqUrl, res, ctx)) return true;
  if (await handleNodesAliveBetweenRoute(req, reqUrl, res, ctx)) return true;
  if (await handleRepoByIdRoute(req, reqUrl, res, ctx)) return true;
  if (await handleEntropyCommitsRoute(req, reqUrl, res, ctx)) return true;
  if (await handleWatchesRoute(req, reqUrl, res, ctx)) return true;
  if (await handleCommitFootprintRoute(req, reqUrl, res, ctx)) return true;
  if (await handleSnapshotAutoRoute(req, reqUrl, res, ctx)) return true;
  if (await handleSnapshotFromPrRoute(req, reqUrl, res, ctx)) return true;
  if (await handleSnapshotIncrementalRoute(req, reqUrl, res, ctx)) return true;
  if (await handleGraphAtCommitRoute(req, reqUrl, res, ctx)) return true;
  if (await handleGhostsRoute(req, reqUrl, res, ctx)) return true;
  if (await handleGhostAuditRoute(req, reqUrl, res, ctx)) return true;
  if (await handleGhostsCleanupRoute(req, reqUrl, res, ctx)) return true;
  if (await handleConnectorsRoute(req, reqUrl, res, ctx)) return true;
  if (await handleSysmlExportRoute(req, reqUrl, res, ctx)) return true;
  if (await handleClustersRoute(req, reqUrl, res, ctx)) return true;
  if (await handleWikiRoute(req, reqUrl, res, ctx)) return true;
  if (await handleAutoReindexRoute(req, reqUrl, res, ctx)) return true;
  if (await handleRegressionRoute(req, reqUrl, res)) return true; // NB: pas de ctx
  if (await handleCommitsRoute(req, reqUrl, res, ctx)) return true;
  if (await handleBaselineSeedRoute(req, reqUrl, res, ctx)) return true;
  return false;
}

export function startGitnexusCron(api) {
  startWatchesCron(api);
}
```

- [ ] **Step 4: Lancer le test unitaire, vérifier qu'il passe**

Run: `cd tests && npm run test:unit -- docker-server-routes`
Expected: PASS (2 tests).

- [ ] **Step 5: Câbler le shim dans `docker-server.mjs` et retirer l'ancien câblage**

Dans `upstream/docker-server.mjs` :
1. Supprimer les 32 lignes d'import `handleXRoute` (lignes 7-38) y compris `startWatchesCron`. Ajouter à la place une seule ligne d'import près des autres imports :
   ```js
   import { registerGitnexusRoutes, startGitnexusCron } from './docker-server-routes.mjs';
   ```
2. Remplacer toute la chaîne de dispatch (`// Snapshot endpoints …` jusqu'à `… handleBaselineSeedRoute(...) return;`, ~lignes 528-600) par une seule ligne, placée AU MÊME ENDROIT (juste après le bloc `/import`, avant le `// ── Static asset serving`) :
   ```js
   // GitNexus analytics + time-travel routes — voir docker-server-routes.mjs
   if (await registerGitnexusRoutes(req, reqUrl, res, { api: GITNEXUS_API })) return;
   ```
3. La ligne du cron (`startWatchesCron(GITNEXUS_API);`, ~ligne 674, dans le callback `server.listen`) devient :
   ```js
   startGitnexusCron(GITNEXUS_API);
   ```

- [ ] **Step 6: S'assurer que le Dockerfile copie le nouveau module**

Run: `grep -n "docker-server" upstream/Dockerfile.web`
- Si la copie utilise un glob (`COPY docker-server-*.mjs ...`) → `docker-server-routes.mjs` est déjà inclus, ne rien faire.
- Si chaque fichier est listé explicitement → ajouter une ligne `COPY` pour `docker-server-routes.mjs` à côté des autres, en respectant le format exact des lignes voisines.

- [ ] **Step 7: Vérification d'intégration (smoke loop)**

Démarrer la stack si nécessaire (`docker compose up -d --build`), puis lancer la boucle de smoke du `CLAUDE.md` (toutes les routes analytics doivent répondre à l'identique) :
```bash
for ep in churn coupling growth lifespan entropy ownership semantic-labels; do
  curl -s -o /dev/null -w "$ep: HTTP %{http_code}\n" "http://localhost:4173/$ep?repo=hmm_studio"
done
curl -s -o /dev/null -w "regression: HTTP %{http_code}\n" "http://localhost:4173/regression?repo=hmm_studio&metric=density"
curl -s -o /dev/null -w "watches: HTTP %{http_code}\n" "http://localhost:4173/watches"
```
Expected: codes HTTP identiques à avant le refactor (200 sur stack chaude ; jamais 404 sur une route qui répondait avant). Si la stack n'est pas dispo, exécuter `cd tests && npm run test:integ` sur une machine Docker et noter le report.

- [ ] **Step 8: Commit**

```bash
git config user.email   # doit afficher roblastar@live.fr
# régénérer la vue monolithique pour ce commit transitoire (sera remplacée en Task 2)
cd upstream && git add -N . && git diff HEAD > ../patches/upstream-all.diff && git reset && cd ..
git add upstream/docker-server-routes.mjs upstream/docker-server.mjs upstream/Dockerfile.web tests/unit/docker-server-routes.test.mjs patches/upstream-all.diff
git commit -m "refactor(docker-server): extract analytics route wiring into docker-server-routes.mjs shim"
```

---

## Task 2: Scinder le diff monolithique en additif + in-place

**Files:**
- Create: `patches/additive-files.diff`
- Create: `patches/inplace-edits.diff`
- Delete: `patches/upstream-all.diff`

**Contexte:** notre diff ne contient AUCUNE suppression (vérifié : `--diff-filter=D` = 0). Le split est donc exactement Added (98 après Task 1) + Modified (16). `git diff --diff-filter` est la méthode robuste et auto-maintenable.

- [ ] **Step 1: Générer les deux diffs depuis le clone upstream patché**

```bash
cd upstream
git add -N .                                   # intent-to-add pour inclure les fichiers neufs
git diff HEAD --diff-filter=A > ../patches/additive-files.diff
git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff
git reset
cd ..
```

- [ ] **Step 2: Vérifier les comptes**

```bash
grep -c '^diff --git' patches/additive-files.diff   # attendu ~98 (97 + docker-server-routes.mjs)
grep -c '^diff --git' patches/inplace-edits.diff    # attendu 16
```
Expected: additive ≈ 98, in-place = 16. Si les comptes diffèrent fortement, STOP et investiguer (un fichier neuf mal classé, ou un édit in-place inattendu).

- [ ] **Step 3: Test d'acceptation — réappliquer les deux diffs sur un clone v1.6.5 propre**

```bash
REPO=c:/Users/rdenis/VScode/gitnexus          # racine du dépôt (chemin absolu)
rm -rf /tmp/upstream-verify
git clone --depth 1 --branch v1.6.5 https://github.com/abhigyanpatwari/gitnexus.git /tmp/upstream-verify
cd /tmp/upstream-verify
git apply --check "$REPO/patches/additive-files.diff" && echo "ADDITIVE: applies clean"
git apply --check "$REPO/patches/inplace-edits.diff" && echo "INPLACE: applies clean"
# Application réelle :
git apply "$REPO/patches/additive-files.diff"
git apply "$REPO/patches/inplace-edits.diff"
cd "$REPO"
rm -rf /tmp/upstream-verify
```
Expected: les deux `--check` impriment « applies clean ». L'application réelle aboutit sans rejet.

- [ ] **Step 4: Supprimer le monolithe**

```bash
git rm patches/upstream-all.diff
```

- [ ] **Step 5: Commit**

```bash
git config user.email   # roblastar@live.fr
git add patches/additive-files.diff patches/inplace-edits.diff
git commit -m "build(patches): split upstream-all.diff into additive-files.diff + inplace-edits.diff"
```

---

## Task 3: Outil de bump (`scripts/bump-upstream.mjs`) + dry-run contre `main`

**Files:**
- Create: `scripts/bump-upstream.mjs`
- Create: `tests/unit/bump-report.test.mjs`
- Create: `patches/bump-dry-run-main.md`

**Contexte:** le script clone l'upstream à une cible (tag ou branche), applique `additive-files.diff` (doit être clean), tente `inplace-edits.diff` avec `git apply --3way`, et émet un rapport fichier-par-fichier. Read-only vis-à-vis de notre dépôt (travaille dans un répertoire jetable). On unit-teste la partie pure : le formateur de rapport.

- [ ] **Step 1: Écrire le test du formateur d'abord (échoue)**

Create `tests/unit/bump-report.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { formatBumpReport } from '../../scripts/bump-upstream.mjs';

describe('formatBumpReport', () => {
  it('résume clean / conflict / fail par catégorie', () => {
    const results = [
      { file: 'docker-server-routes.mjs', layer: 'additive', status: 'clean' },
      { file: 'App.tsx', layer: 'inplace', status: 'conflict' },
      { file: 'useAppState.tsx', layer: 'inplace', status: 'fail' },
    ];
    const md = formatBumpReport('main', results);
    expect(md).toContain('main');
    expect(md).toContain('App.tsx');
    expect(md).toContain('useAppState.tsx');
    // un compte de synthèse exploitable
    expect(md).toMatch(/clean.*1/i);
    expect(md).toMatch(/conflict.*1/i);
    expect(md).toMatch(/fail.*1/i);
  });

  it('signale un bump sans conflit comme trivial', () => {
    const md = formatBumpReport('v1.7.0', [
      { file: 'docker-server.mjs', layer: 'inplace', status: 'clean' },
    ]);
    expect(md).toMatch(/trivial|aucun conflit|0 conflict/i);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `cd tests && npm run test:unit -- bump-report`
Expected: FAIL — `Cannot find module '../../scripts/bump-upstream.mjs'`.

- [ ] **Step 3: Implémenter `scripts/bump-upstream.mjs`**

```js
#!/usr/bin/env node
// Dry-run d'un bump upstream : clone une cible, applique additive-files.diff
// (doit être clean) puis inplace-edits.diff en --3way, et imprime un rapport
// fichier-par-fichier. N'écrit jamais dans le dépôt courant.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const UPSTREAM_URL = 'https://github.com/abhigyanpatwari/gitnexus.git';

export function formatBumpReport(target, results) {
  const by = (s) => results.filter((r) => r.status === s);
  const clean = by('clean');
  const conflict = by('conflict');
  const fail = by('fail');
  const lines = [];
  lines.push(`# Bump dry-run report — cible \`${target}\``);
  lines.push('');
  lines.push(`- clean: ${clean.length}`);
  lines.push(`- conflict: ${conflict.length}`);
  lines.push(`- fail: ${fail.length}`);
  lines.push('');
  if (conflict.length === 0 && fail.length === 0) {
    lines.push('**Bump trivial — aucun conflit détecté.**');
  } else {
    lines.push('## Fichiers à reprendre à la main');
    for (const r of [...conflict, ...fail]) {
      lines.push(`- [${r.status}] (${r.layer}) ${r.file}`);
    }
  }
  lines.push('');
  lines.push('## Détail');
  for (const r of results) {
    lines.push(`- [${r.status}] (${r.layer}) ${r.file}`);
  }
  return lines.join('\n');
}

function gitApplyPerFile(cwd, diffPath, layer, mode) {
  // Liste les fichiers du diff, tente l'application fichier par fichier.
  const names = execFileSync('git', ['apply', '--numstat', diffPath], { cwd, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
    .map((l) => l.split('\t').pop());
  const results = [];
  for (const file of names) {
    const args = ['apply', mode, '--include', file, diffPath];
    try {
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
      // En --3way, un succès avec marqueurs de conflit = conflict ; sinon clean.
      const hasMarkers = mode.includes('3way') &&
        /^<<<<<<< /m.test(safeRead(cwd, file));
      results.push({ file, layer, status: hasMarkers ? 'conflict' : 'clean' });
    } catch {
      results.push({ file, layer, status: 'fail' });
    }
  }
  return results;
}

function safeRead(cwd, file) {
  try { return execFileSync('cat', [file], { cwd, encoding: 'utf8' }); }
  catch { return ''; }
}

function main() {
  const target = process.argv[2];
  if (!target) { console.error('usage: bump-upstream.mjs <tag-or-branch>'); process.exit(2); }
  const repoRoot = resolve(import.meta.dirname, '..');
  const tmp = mkdtempSync(join(tmpdir(), 'gnx-bump-'));
  try {
    execFileSync('git', ['clone', '--depth', '1', '--branch', target, UPSTREAM_URL, tmp], { stdio: 'inherit' });
    const additive = gitApplyPerFile(tmp, join(repoRoot, 'patches/additive-files.diff'), 'additive', '--check');
    const inplace = gitApplyPerFile(tmp, join(repoRoot, 'patches/inplace-edits.diff'), 'inplace', '--3way');
    const report = formatBumpReport(target, [...additive, ...inplace]);
    const out = join(repoRoot, `patches/bump-dry-run-${target.replace(/[^a-z0-9.-]/gi, '-')}.md`);
    writeFileSync(out, report + '\n');
    console.log(report);
    console.log(`\nRapport écrit dans ${out}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Lancer le test unitaire, vérifier qu'il passe**

Run: `cd tests && npm run test:unit -- bump-report`
Expected: PASS (2 tests).

- [ ] **Step 5: Exécuter le dry-run réel contre `main`**

Run (depuis la racine du dépôt) : `node scripts/bump-upstream.mjs main`
Expected: le script clone `main`, imprime un rapport, et écrit `patches/bump-dry-run-main.md`. Renommer/copier en `patches/bump-dry-run-main.md` si le nom généré diffère. Le rapport doit lister les fichiers in-place en conflit (on s'attend à ce que `App.tsx`, `useAppState.tsx`, `docker-server.mjs` et `Dockerfile.web` apparaissent, vu Express 5 + refactor JS côté upstream).

- [ ] **Step 6: Commit**

```bash
git config user.email   # roblastar@live.fr
git add scripts/bump-upstream.mjs tests/unit/bump-report.test.mjs patches/bump-dry-run-main.md
git commit -m "feat(tooling): bump-upstream dry-run script + first report against main"
```

---

## Task 4: Réparer les docs périmées + tracking (README / CLAUDE / ROADMAP / INVENTORY)

**Files:**
- Modify: `patches/README.md`
- Modify: `CLAUDE.md` (racine gitnexus — section « Regenerate the diff » / « When you ship a feature »)
- Modify: `ROADMAP.md`
- Modify: `INVENTORY.md`

**Contexte:** `patches/README.md` dit encore `v1.6.3` à l'étape clone et « ~7k lignes » ; il référence `upstream-all.diff` qui n'existe plus. CLAUDE.md décrit l'ancienne régénération mono-fichier.

- [ ] **Step 1: Mettre à jour `patches/README.md`**

Remplacements concrets :
- Ligne « tag `v1.6.3` » → « tag `v1.6.5` ».
- Bloc « Apply on a fresh clone » : `--branch v1.6.3` → `--branch v1.6.5`, et remplacer `git apply ../patches/upstream-all.diff` par :
  ```powershell
  git apply ../patches/additive-files.diff
  git apply ../patches/inplace-edits.diff
  ```
- Bloc « Regenerate the diff » : remplacer le `git diff HEAD > ../patches/upstream-all.diff` par la procédure split :
  ```powershell
  cd upstream
  git add -N .
  git diff HEAD --diff-filter=A > ../patches/additive-files.diff
  git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff
  git reset
  ```
- Section « What's inside » : remplacer « ~7k lines » par la réalité (« ~98 fichiers additifs + 16 édits in-place ; voir `additive-files.diff` / `inplace-edits.diff` »).
- Section « Why not a git submodule? » : ajouter un paragraphe actant que le seuil de complexité est franchi et que la décision de format de cohabitation (rester en diff plat scindé vs submodule/subtree) est différée à la phase 2 — lien vers `docs/superpowers/specs/2026-05-29-upstream-divergence-paydown-design.md`.
- Ajouter une section « Bump dry-run » documentant `node scripts/bump-upstream.mjs <tag-or-branch>`.

- [ ] **Step 2: Mettre à jour `CLAUDE.md` (racine gitnexus)**

- Section « When you ship a feature » → point 1 « Regenerate the diff » : remplacer la commande mono-fichier par la procédure split (diff-filter A/M ci-dessus).
- Table « What lives where » : remplacer la ligne `upstream-all.diff` par `additive-files.diff` + `inplace-edits.diff`, et ajouter `scripts/bump-upstream.mjs`.
- Ajouter une note dans le bloc `upstream/` mentionnant `docker-server-routes.mjs` (registre de routes) à côté de `docker-server.mjs`.

- [ ] **Step 3: Mettre à jour `ROADMAP.md`**

Ajouter une ligne à la table « Déjà livré » : *« Paydown dette de divergence upstream (Phase 1) — shim de routes `docker-server-routes.mjs`, split `additive-files.diff`/`inplace-edits.diff`, `scripts/bump-upstream.mjs` »*, avec pointeur vers le spec. Si une ligne de tier correspond à la maintenance/fork, la marquer ✅.

- [ ] **Step 4: Mettre à jour `INVENTORY.md`**

Dans la section « Nos ajouts » (ou équivalent) : documenter le nouveau layout de patches (additif vs in-place), le registre de routes `docker-server-routes.mjs`, et l'outil `scripts/bump-upstream.mjs`. Le point : quelqu'un lisant INVENTORY seul comprend la nouvelle organisation.

- [ ] **Step 5: Vérification — plus aucune référence périmée**

```bash
grep -rn "upstream-all.diff" patches/README.md CLAUDE.md INVENTORY.md ROADMAP.md   # attendu: 0 résultat
grep -rn "v1.6.3" patches/README.md                                                # attendu: 0 résultat
grep -rn "7k lines\|~7k" patches/README.md                                         # attendu: 0 résultat
```
Expected: les trois greps ne renvoient rien.

- [ ] **Step 6: Commit**

```bash
git config user.email   # roblastar@live.fr
git add patches/README.md CLAUDE.md ROADMAP.md INVENTORY.md
git commit -m "docs(patches): document split layout + bump tool; fix stale v1.6.3/7k references"
```

---

## Self-Review (rempli par l'auteur du plan)

- **Couverture du spec :** §3.1 (split) → Task 2 ; §3.2 (réduction docker-server.mjs) → Task 1 ; §3.3 (script + dry-run main) → Task 3 ; §3.4 (docs) → Task 4. La réduction de « la queue » frontend du §3.2 est volontairement HORS de ce plan (les édits React ne deviennent pas additifs sans éditer un site d'import upstream) — à acter en mise à jour du spec lors de l'exécution, et renvoyée à la phase 2 (open question §5).
- **Placeholders :** aucun TODO/TBD ; tout code montré en entier ; commandes avec sortie attendue.
- **Cohérence des types/signatures :** `registerGitnexusRoutes(req, reqUrl, res, ctx)` et `startGitnexusCron(api)` utilisés à l'identique en Task 1 (shim) et dans le test ; `formatBumpReport(target, results)` avec `results: {file, layer, status}` cohérent entre `bump-upstream.mjs` et `bump-report.test.mjs` ; signature spéciale `handleRegressionRoute(req, reqUrl, res)` (sans ctx) préservée explicitement.

> **Note de divergence spec :** ce plan réduit `docker-server.mjs` en sortant uniquement le *câblage de routes* (chaîne de dispatch + imports + cron). Les handlers inline `handleExport`/`handleImport`/`/listdir` restent en place par design (routes utilitaires couplées au module). La réduction réelle de la surface in-place de `docker-server.mjs` est donc partielle (≈ dispatch chain + imports + cron retirés), pas « 563→1 ». Mettre à jour le spec §3.2 en conséquence pendant l'exécution.
