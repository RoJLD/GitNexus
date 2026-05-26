# Décision — Reporter l'upgrade Node 21 → 22 LTS

**Date** : 2026-05-26
**Statut** : Dette technique active
**Tracking** : Task 50 (smoke run final) + tous les tests vitest restent dans Phase 1b

---

## Contexte

Le plan `2026-05-26-cicd-test-pyramid-phase1.md` spécifie `vitest@^4.1.6`. Vitest 4.x utilise rolldown comme bundler, qui exige `Node ^20.19.0 || >=22.12.0`. L'environnement courant tourne sur **Node 21.7.1**, ce qui est entre les deux LTS et donc pas supporté.

L'install npm réussit (warnings EBADENGINE) mais vitest n'exécute pas les tests (rolldown crash sur `util.styleText` argument array que Node 22 supporte et Node 21 non).

## Options considérées

| Option | Effort | Trade-off |
|---|---|---|
| Upgrader Node 21 → 22 LTS | ~5 min (installer + relancer terminal) | Path propre, plan inchangé |
| Downgrader vitest 4 → 3 dans le plan | ~1 commit | Vitest 3.x marche sur Node 21, fonctionnellement équivalent à 4 pour notre use case, "dette" purement cosmétique |
| **Reporter, accumuler dette technique** | 0 maintenant | Choix retenu — voir ci-dessous |

## Décision retenue

**Reporter l'upgrade Node 22**, livrer Phase 1a (12 tasks runnable sur Node 21 sans vitest) maintenant, marquer Phase 1b (38 tasks dépendant de vitest) comme bloquée.

## Phase 1a — Tasks runnable sur Node 21

| # | Task | Pourquoi ça marche sur Node 21 |
|---|---|---|
| 3 | docker-compose.test.yml | YAML, validé via `docker compose config` |
| 4 | make-fixture.mjs | Node pur, utilise `git` via execSync |
| 5 | Golden snapshots README | Docs |
| 6 | api-client.mjs | Code seul (pas d'exécution test) |
| 7 | wait-ready.mjs | Code seul + CLI |
| 8 | stack.mjs | Code seul + Docker helper |
| 9 | analyze.mjs + golden.mjs + global-setup.mjs | Code seul ; `golden.mjs` importe `vitest` mais l'import résout (vitest est installé), il ne s'exécute pas tant qu'on ne lance pas vitest |
| 46 | tests/README.md inventory | Docs (liste les tests qui *seront* livrés en Phase 1b) |
| 47 | check-test-inventory.mjs | Node pur |
| 48 | apply-upstream-patches.mjs | Node pur, utilise git |
| 49 | .github/workflows/test.yml | YAML ; sera exécuté par les runners Ubuntu GitHub Actions sur Node 22 — donc **la CI validera les tests même tant que local ne peut pas** |
| 50 (partiel) | README badge | Docs |

## Phase 1b — BLOCKED sur Node 22 LTS

| # | Task | Pourquoi bloqué |
|---|---|---|
| 10-13 | Pure unit tests (CSV, entropy, ownership, dissonance) | `vitest run` requis pour valider verts |
| 14-23 | Component unit tests (10 composants React) | idem |
| 24-39 | Integration tests (16 endpoints) | vitest + Docker stack |
| 40-45 | E2E Playwright specs | Playwright config + scripts dépendent de vitest |
| 50 (smoke run) | Final smoke validation | `npm run test:smoke` |

## Conditions de déblocage

1. Installer Node 22 LTS (≥ 22.12.0).
2. Redémarrer terminaux pour que PATH soit mis à jour.
3. `cd tests && rmdir /s /q node_modules && npm install`.
4. Vérifier `npx vitest --version` sort `node-v22.x.x`.
5. Reprendre l'exécution du plan Phase 1b à partir de Task 10.

## Risques pendant la dette

1. **Phase 1a livre du code non vérifié localement** : api-client, stack, analyze sont écrits sans test runner pour les exercer. Validation reportée à Phase 1b. La CI sur GitHub Actions agira comme premier vrai run (Node 22 par défaut sur ubuntu-latest).
2. **`tests/README.md` (Task 46) listera 39 tests dont 38 n'existent pas encore.** Le script orphan-check passera vide (0 test files trouvés), c'est OK mais ne valide pas que les références dans le README pointent vers des fichiers réels.
3. **Coût de friction** : à chaque commit Phase 1a, on ne peut pas faire tourner les tests pour vérifier. On commit "à l'aveugle" sur la qualité runtime du code de helpers.

## Plan d'action si la dette devient trop lourde

Si on hit un mur en Phase 1a (code des helpers qui ne semble pas correct sans pouvoir le tester), basculer vers **Path A** (downgrade vitest 3.x) — 1 commit, débloquera tout sans nécessiter upgrade Node.

---

**Reviewed:** auto (Claude Opus 4.7 + user via /brainstorming + /writing-plans).
**Next review:** quand Node 22 est installé OU quand on hit le mur évoqué ci-dessus.
