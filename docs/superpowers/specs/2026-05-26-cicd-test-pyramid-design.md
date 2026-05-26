# Design — Pyramide de tests CI/CD pour `deployment` + bump v1.6.5

**Date** : 2026-05-26
**Auteur** : Robin DENIS (avec Claude Opus 4.7)
**Statut** : Design approuvé, prêt pour writing-plans
**Branche cible** : `deployment` (fork interne `RoJLD/GitNexus`)
**Base upstream actuelle** : `v1.6.3` — bump vers `v1.6.5` planifié en Phase 2

---

## 1. Contexte et objectif

Notre fork `deployment` empile sur upstream `gitnexus@v1.6.3` :
- Une dérive Docker (Dockerfile.cli, compose, scripts launcher Windows/Rancher).
- **16 features livrées** ajoutées à upstream (Tier 1 complet + Tier 1.2/1.3
  cross-repo + Tier 2.1 semantic labels + Tier 2.2 dissonance), exposées via
  ~20 endpoints HTTP et autant de composants React/TS, le tout sérialisé dans
  `patches/upstream-all.diff` (~8.5k lignes).
- Zéro test, zéro CI : si quelque chose casse après un bump upstream, on le
  découvre à l'œil ou en production.

**Objectif** : construire une suite de tests pyramidale (unit + integration +
e2e) qui sert de **filet de régression** pour chaque bump upstream futur,
et qui agit comme **inventaire vivant** de notre périmètre fonctionnel
ajouté.

---

## 2. Décisions cadres (issues du brainstorm)

| Décision | Choix | Raison |
|---|---|---|
| Profondeur | Pyramide complète (unit + integ + e2e) | Coverage max ; user assume le coût d'entretien |
| Exécution | Local Windows/Rancher + GitHub Actions Linux | Détecte les régressions cross-OS tôt |
| Source de données | Fixture embarquée + auto-référence (gitnexus indexe gitnexus) | Reproductible (fixture) + réaliste (self) |
| Frontend | Vitest unit + Playwright smoke 3-5 specs | Bon ratio coverage/coût |
| Politique CI | Push + manuel, jamais bloquant (`continue-on-error: true`) | Signal sans friction, solo/duo dev |
| Séquencement | Tests d'abord sur v1.6.3, bump après | Baseline vert obligatoire avant régression test |
| Stack technique | Vitest-centrique + Playwright runner séparé | Aligné avec upstream, écosystème connu |

---

## 3. Architecture

### 3.1 Layout du repo après livraison

```
gitnexus/
├── tests/                              ← TOUT le harness ici
│   ├── README.md                       ← inventaire (le fichier demandé)
│   ├── package.json                    ← deps test (vitest, supertest, playwright, etc.)
│   ├── vitest.config.unit.mjs
│   ├── vitest.config.integ.mjs
│   ├── fixtures/
│   │   ├── make-fixture.mjs            ← script Node reconstruit le mini-repo
│   │   ├── sample-repo.tar.gz          ← repo pré-construit (~10 files, ~10 commits)
│   │   └── expected/
│   │       ├── churn.json
│   │       ├── coupling.json
│   │       ├── growth.json
│   │       ├── lifespan.json
│   │       ├── entropy.json
│   │       ├── ownership.json
│   │       └── dissonance.json
│   ├── unit/
│   │   ├── csv-serializer.test.mjs
│   │   ├── entropy-math.test.mjs
│   │   ├── ownership-bus-factor.test.mjs
│   │   ├── dissonance-overlap.test.mjs
│   │   └── components/
│   │       ├── EntropyBadge.test.tsx
│   │       ├── OwnershipPanel.test.tsx
│   │       ├── CouplingPanel.test.tsx
│   │       ├── GrowthChart.test.tsx
│   │       ├── LifespanPanel.test.tsx
│   │       ├── DissonancePanel.test.tsx
│   │       ├── DiffBanner.test.tsx
│   │       ├── Timeline.test.tsx
│   │       ├── SnapshotsPanel.test.tsx
│   │       └── BulkSnapshotModal.test.tsx
│   ├── integration/
│   │   ├── helpers/
│   │   │   ├── stack.mjs
│   │   │   ├── analyze.mjs
│   │   │   └── wait-ready.mjs
│   │   ├── stack-health.test.mjs
│   │   └── endpoints/
│   │       ├── snapshot.test.mjs
│   │       ├── snapshot-bulk.test.mjs
│   │       ├── diff.test.mjs
│   │       ├── churn.test.mjs
│   │       ├── coupling.test.mjs
│   │       ├── coupling-cross.test.mjs
│   │       ├── growth.test.mjs
│   │       ├── growth-cross.test.mjs
│   │       ├── lifespan.test.mjs
│   │       ├── entropy.test.mjs
│   │       ├── ownership.test.mjs
│   │       ├── dissonance.test.mjs
│   │       ├── semantic-labels.test.mjs
│   │       ├── csv-format.test.mjs
│   │       └── export-import.test.mjs
│   └── e2e/
│       ├── playwright.config.ts
│       └── specs/
│           ├── 01-analyze-and-snapshot.spec.ts
│           ├── 02-timeline-navigation.spec.ts
│           ├── 03-analytics-panels.spec.ts
│           ├── 04-csv-download.spec.ts
│           └── 05-diff-view.spec.ts
├── docker-compose.test.yml             ← stack dédiée tests (volumes test-*)
├── scripts/
│   └── ci-apply-patches.sh             ← clone upstream@tag + git apply
└── .github/workflows/
    └── test.yml
```

### 3.2 Commandes top-level (`tests/package.json`)

| Command | Tourne | Durée cible |
|---|---|---|
| `npm run test:smoke` | health + 1 endpoint par famille | ~30s |
| `npm run test:unit` | unit (pures + composants React) | ~30s |
| `npm run test:integ` | docker stack + tous les endpoints | ~5min |
| `npm run test:e2e` | Playwright sur UI live | ~5min |
| `npm test` | tout sauf e2e | ~6min |
| `npm run test:all` | tout y compris e2e | ~11min |

---

## 4. Composants

### 4.1 Fixture (`tests/fixtures/`)

**Contenu du `sample-repo/` reconstruit par `make-fixture.mjs`** :
- 3 dossiers : `src/auth/`, `src/db/`, `src/utils/`
- 10 fichiers source : 4 TS, 3 JS, 2 Python, 1 Markdown
- 10 commits étalés sur 30 jours simulés (timestamps fixes : `2025-01-01` à `2025-01-30`)
- 2 auteurs : `alice@test.local` (8 commits), `bob@test.local` (2 commits)
- Distribution de churn voulue (déterminée par make-fixture) :
  - `src/auth/login.ts` modifié 6 fois (hot file)
  - `src/db/schema.ts` modifié 4 fois (medium churn)
  - `src/utils/helpers.ts` 1 commit (foundational)
  - `src/auth/legacy.js` créé puis supprimé (discontinued)
  - `src/db/orphan.py` créé au dernier commit (recent)
- Un `gitnexus-domains.json` pour `/dissonance` :
  ```json
  { "domains": { "auth": ["src/auth/**"], "data": ["src/db/**"] } }
  ```

**Format de stockage** : `sample-repo.tar.gz` commité dans git. Décompressé
dans un tmp dir par les helpers integration. Évite l'imbrication `.git/`
dans le repo principal.

**Reproductibilité** :
- `--skip-embeddings` par défaut (embeddings non-déterministes selon modèle HF)
- Si Leiden a un seed configurable, on le pin ; sinon on assert sur la
  **structure** (nombre de communautés) plutôt que les IDs.

**Golden snapshots** dans `expected/*.json` : valeurs attendues issues d'un
run sain. Le test compare avec tolérance numérique (`expect.closeTo(…, 1e-6)`
pour les floats).

### 4.2 Helpers integration (`tests/integration/helpers/`)

**`stack.mjs`** — cycle Docker :
```js
export async function startStack({ projectsRoot, port = 4747 }) { … }
export async function stopStack() { … }
export async function waitForReady({ timeoutMs = 60000 }) { … }
export function getApi() { return new ApiClient('http://localhost:4747'); }
```

Notes :
- Compose dédié `docker-compose.test.yml` (volumes nommés `gitnexus-test-*`)
  pour ne pas perturber le stack de dev.
- `waitForReady` poll `GET /health` toutes 500ms, dump des logs containers en
  cas de timeout.
- `getApi()` retourne un client typé éliminant les `fetch('http://localhost…')`
  répétés.

**`analyze.mjs`** — orchestration de l'indexation :
```js
export async function analyzeFixture({ withEmbeddings = false }) { … }
export async function snapshotFixtureAtCommit(sha) { … }
export async function snapshotFixtureFullHistory() { … }
```

Notes :
- `analyzeFixture` : extrait le tarball, register, analyze, attend completion.
- `snapshotFixtureFullHistory` : `POST /snapshot/bulk` window=30 days,
  count=10, suit SSE jusqu'à completion. Nécessaire pour `/churn`, `/coupling`,
  `/growth`, `/lifespan`, `/entropy` qui exigent ≥2 snapshots.

**Setup partagé via `globalSetup` Vitest** : un seul lancement Docker pour
tous les fichiers integration. Sinon ~30s × 15 fichiers = inacceptable.

### 4.3 Pattern test d'endpoint

```js
import { startStack, stopStack, getApi } from '../helpers/stack.mjs';
import { snapshotFixtureFullHistory } from '../helpers/analyze.mjs';
import expected from '../../fixtures/expected/entropy.json' assert { type: 'json' };

describe('GET /entropy', () => {
  beforeAll(async () => {
    await startStack({ projectsRoot: '…' });
    await snapshotFixtureFullHistory();
  }, 90_000);
  afterAll(stopStack);

  it('returns density+modularity per snapshot', async () => {
    const res = await getApi().entropy('sample-repo');
    expect(res).toHaveLength(10);
    expect(res[0]).toMatchObject({
      commit: expect.any(String),
      density: expect.any(Number),
      modularity: expect.any(Number),
    });
  });

  it('matches golden snapshot', () => {
    expect(res).toMatchObject(expected);
  });

  it('CSV format works', async () => {
    const csv = await getApi().entropy('sample-repo', { format: 'csv' });
    expect(csv).toMatch(/^commit,density,modularity/);
  });
});
```

### 4.4 Tests unit composants React

Setup : `@testing-library/react` + `jsdom` environment dans
`vitest.config.unit.mjs`. Mocks de `fetch` via `vi.fn()`. Pas de Docker, pas
de backend.

Cible : chaque composant qu'on a ajouté à `gitnexus-web/src/components/`.
Test minimum par composant : `render` sans crash + un cas représentatif (filtre,
slider, toggle).

### 4.5 Tests e2e Playwright

5 specs ciblés sur les **flux utilisateur**, pas sur les pixels :

1. **`01-analyze-and-snapshot`** — add repo via UI → analyze → bulk snapshot
   → Timeline visible.
2. **`02-timeline-navigation`** — play/pause, slider drag, EntropyBadge apparaît.
3. **`03-analytics-panels`** — ouvre chaque panneau (coupling/growth/lifespan/
   ownership/dissonance), assert qu'il rend du contenu.
4. **`04-csv-download`** — clic icône download → vérif Content-Disposition.
5. **`05-diff-view`** — sélection de 2 repos → bouton diff → vérif que le
   canvas Sigma a des couleurs (via DOM, pas pixel).

Headless en CI, headed en local pour debug.

### 4.6 Inventaire `tests/README.md`

Maintenu à la main. Tableaux par feature avec colonnes : *Test* / *Fichier* /
*Couvre*. Mapping endpoint → test rend l'audit triviale.

**Garde-fou** : check CI dédié (job léger `inventory-check` dans le workflow)
qui vérifie que chaque `.test.mjs|tsx` du repo apparaît au moins une fois
dans `tests/README.md`. Erreur lisible : "test orphelin :
`tests/foo/bar.test.mjs`". Choix CI plutôt que pre-commit hook : pas de
husky à installer côté contributeur, fail seulement quand on push.

### 4.7 CI workflow (`.github/workflows/test.yml`)

4 jobs (lint-and-type, unit, integration, e2e), tous `continue-on-error: true`,
déclenchés sur `push: deployment` ou `workflow_dispatch`. Variable de repo
`GITNEXUS_VERSION` permet de bumper en un click depuis l'UI GitHub. Artifacts
(docker logs, playwright report) remontés sur failure.

Cache : `actions/setup-node@v4` avec `cache: npm` + `docker pull` séparé pour
préchauffer l'image upstream.

Badge dans le README principal pour signal visuel.

---

## 5. Séquencement

### Phase 1 — Test infra sur v1.6.3 (la base actuelle qui marche)
1. Fixture : `make-fixture.mjs` + `sample-repo.tar.gz`
2. Unit tests (CSV, entropy math, ownership math, dissonance)
3. Unit tests composants React
4. Helpers integration (`stack.mjs`, `analyze.mjs`)
5. Integration tests endpoint par endpoint (~16 endpoints)
6. Playwright config + 5 specs e2e
7. `tests/README.md` (inventaire)
8. GitHub Actions workflow
9. Run full suite localement → **baseline vert obligatoire localement** (la
   CI elle-même reste non-bloquante par politique, mais on ne commit pas si
   le local est rouge)
10. Push + vérifier que CI tourne (vert ou jaune, jamais rouge)
11. Commit `test: full pyramid baseline on v1.6.3`

### Phase 2 — Bump v1.6.3 → v1.6.5
1. Clone upstream propre à `v1.6.5`
2. `git apply --3way patches/upstream-all.diff`
3. Résoudre 4 conflits attendus :
   - `Dockerfile.web` (1 bloc)
   - `docker-server.mjs` (2 blocs)
   - `gitnexus-web/package.json` (1 bloc)
   - `gitnexus-web/package-lock.json` (regen via `npm install`)
4. Simplifier `Dockerfile.cli` : drop `scripts/install-duckdb-extension.mjs`
   (fix upstream #1502), conserver `scripts/patch-lbug-staleness.mjs` (bug REST
   adapter toujours présent).
5. Bump tag dans `docker-compose.yml` + `Dockerfile.cli`
6. Régénérer `patches/upstream-all.diff` propre
7. `npm run test:smoke` localement
8. `npm test` (full pyramid) — si rouge, on identifie le endpoint cassé sans
   ambiguïté
9. Fix les régressions révélées
10. Mettre à jour `INVENTORY.md` (nouvelle base = v1.6.5)
11. Commit `bump: upstream v1.6.3 → v1.6.5`

### Phase 3 — Maintenance continue
- Pour tout futur bump : changer `GITNEXUS_VERSION` dans `.env` + repo var,
  run `test:smoke`, run `test:integ`. Si vert → commit. Si rouge → diff vs
  baseline pour identifier la régression.

---

## 6. Effort estimé

| Phase | Effort | Détail |
|---|---|---|
| Phase 1 — test infra | **2-3 jours** | ~50 fichiers à écrire mais très répétitifs (les test d'endpoint suivent un template) |
| Phase 2 — bump | **2-3 heures** | Validé par dry-run précédent : 4 conflits, fichiers ciblés |
| Phase 3 — bump suivant | **30 min** | Une fois la machine en place |

---

## 7. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| GH Actions Docker (Linux) vs Rancher (Windows) divergence | Moyen | Tester local + CI dès Phase 1, identifier les diff tôt |
| Embeddings/Leiden non-déterministes | Moyen | `--skip-embeddings`, seed Leiden si dispo, sinon assert structure |
| Volumes Docker pollués entre runs | Faible | `down -v` systématique en `afterAll` + `volume prune --filter` en CI |
| `patch-lbug-staleness.mjs` qui saute lors d'un build | Moyen | Test dédié dans `stack-health.test.mjs` : réanalyser et vérifier données fraîches |
| Sensibilité aux dates dans churn/coupling/growth | Moyen | Timestamps figés dans la fixture (commits avec `--date=`) |
| Quota GH Actions sur fork privé | Faible | 2000 min/mois ; estimation ~240 min/mois |
| Rendu Canvas Sigma flaky en e2e headless | Moyen | Specs testent flux (clic, navigation), pas pixels |
| Tests orphelins (créés mais oubliés dans inventaire) | Faible | Pre-commit hook ou check CI dédié |

---

## 8. Critères de succès

Phase 1 terminée quand :
- `npm run test:all` passe localement sur Windows/Rancher (vert sur les 4 suites)
- `npm run test:all` passe sur GH Actions (vert ou jaune, mais sans erreurs
  structurelles)
- `tests/README.md` liste tous les tests créés
- Le badge `tests` apparaît dans le README principal

Phase 2 terminée quand :
- Compose pointe sur `ghcr.io/abhigyanpatwari/gitnexus:1.6.5`
- `patches/upstream-all.diff` regénéré et commit
- `npm run test:all` reste vert sur la nouvelle base
- `INVENTORY.md` mis à jour avec la nouvelle base et les éventuelles
  features upstream gagnées

Phase 3 (validation par usage réel) :
- Au prochain bump (v1.6.6 ou plus tard), le cycle prend bien <1h grâce à
  l'automatisation existante.

---

## 9. Hors scope (explicite)

- **Visual regression** (screenshots pixel-perfect) : trop fragile vu le rendu
  Canvas. Possible plus tard via `@playwright/test --screenshot` si besoin.
- **Tests de charge** : on est un déploiement interne, pas un SaaS multi-tenant.
- **Mutation testing** : pas le bon moment. À reconsidérer si on stabilise.
- **Couverture de l'upstream lui-même** : c'est leur responsabilité, leurs
  tests, on ne refait pas.
- **Tests Windows-only en CI** : `windows-latest` runner GH disponible mais
  coûteux (10x billing) ; on garde Linux + local Windows manuel.

---

*Spec finalisée 2026-05-26. Validation utilisateur en cours avant écriture du
plan d'implémentation détaillé via le skill `writing-plans`.*
