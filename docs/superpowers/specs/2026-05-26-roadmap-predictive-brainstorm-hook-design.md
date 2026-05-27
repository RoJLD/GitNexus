# Roadmap Predictive — Brainstorm-hook design

**Date** : 2026-05-26
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Depends on** : [`2026-05-26-roadmap-predictive-core-design.md`](2026-05-26-roadmap-predictive-core-design.md) (extension mineure du parser pour reconnaître la section managée)
**Sibling sub-specs** : [Audit](2026-05-26-roadmap-predictive-audit-design.md), [Augmented graph](2026-05-26-roadmap-predictive-augmented-graph-design.md), Gantt

---

## 1. Context / problem

Aujourd'hui le flow brainstorming → spec → implementation est entièrement manuel : à chaque nouveau spec produit par le skill `superpowers:brainstorming`, l'utilisateur doit aussi se souvenir d'ajouter une entrée dans `ROADMAP.md` pour que la roadmap prédictive (CORE) en ait connaissance et puisse tracker sa matérialisation.

C'est une étape supplémentaire qui se fait oublier — et qui casse la promesse de la roadmap prédictive : sans ghost dans `ghosts.json`, l'Audit ne voit pas le slippage, l'Augmented graph ne montre pas le futur, le Gantt n'a rien à dessiner.

L'objectif est de fermer cette boucle : à chaque spec écrit, un ghost apparaît automatiquement dans la roadmap, sans action manuelle. Le ghost est ensuite matérialisé naturellement par le CORE quand l'implémentation arrive.

## 2. Goal

Livrer un script `scripts/ghost-from-spec.mjs` qui parse un spec markdown et écrit (ou met à jour) une entrée correspondante dans une section managée de `ROADMAP.md` (`<!-- specs:start --> ... <!-- specs:end -->`). Le CORE parser est étendu d'une regex pour reconnaître cette section comme une source supplémentaire de ghosts en statut `planned`.

Le script est invocable de **4 manières convergentes** : manuellement, via Claude Code PostToolUse hook, via git post-commit hook, via GitHub Actions. Toutes finissent par appeler le même code path. Un wizard `scripts/install-brainstorm-hooks.mjs` configure les 3 triggers automatiques (B/C/D) en un seul `npm run setup:hooks`.

## 3. Design

### 3.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| Modifier le skill `superpowers:brainstorming` lui-même | On ne contrôle pas le plugin superpowers ; un fork serait fragile au prochain bump. |
| Hook côté serveur gitnexus (post-commit du repo monitored) | Demande que le serveur gitnexus tourne, et la complexité de hooks server-side n'est pas justifiée pour ce cas. |
| Fichier side-band `roadmap-extras.yml` mergé par le CORE | Casse la promesse "ROADMAP.md = source unique pour l'humain" et complique le CORE. |
| Écrire direct dans `.gitnexus/ghosts.json` | Le prochain `POST /ghosts/sync` regénère le sidecar depuis ROADMAP.md → ghost orphelin perdu. |
| Tier auto-affecté (`spec.YYYY-MM-DD-X`) en tant que `### X.Y` heading | Le CORE parser exige des Tiers numériques. Forcer une numérotation factice pollue ROADMAP.md. |
| Format frontmatter YAML dans le spec | Plus de discipline d'auteur et le skill brainstorming ne pose pas de frontmatter par défaut. Heuristique d'extraction depuis le markdown est plus tolérante. |

### 3.2 Approche retenue : script unique + 4 triggers convergents + section managée dans ROADMAP.md

#### Architecture

```
scripts/
├── ghost-from-spec.mjs              NEW  parser + ROADMAP managed section update
└── install-brainstorm-hooks.mjs     NEW  one-shot wizard pour configurer B/C/D

.claude/settings.local.json          MOD  PostToolUse hook → ghost-from-spec.mjs
.git/hooks/post-commit               NEW  (généré, pas versionné)
.github/workflows/roadmap-sync.yml   NEW  push deployment → run script
ROADMAP.md                           MOD  section managée + markers
docs/superpowers/specs/CORE          MOD  Update — parser extension regex
```

#### Convergence des triggers

Tous les triggers finissent par invoker `node scripts/ghost-from-spec.mjs <spec-file>` :

| # | Trigger | Activation | Cible |
|---|---|---|---|
| A | Manuel | `npm run ghost:from-spec docs/superpowers/specs/X.md` | Cursor, Codex, ligne de commande |
| B | Claude PostToolUse | `.claude/settings.local.json` (Write sur `specs/*.md`) | Claude Code users |
| C | Git post-commit | `.git/hooks/post-commit` détecte un commit touchant specs/ | Tout dev qui a installé les hooks |
| D | GitHub Actions | Workflow `roadmap-sync.yml` sur push deployment | Filet de sécurité CI |

Le script est **idempotent** : N appels sur le même spec produisent la même mise à jour de ROADMAP.md (détection sur filename).

#### Algorithme du script `ghost-from-spec.mjs`

```
1. argv[2] = spec file path. Read it.
2. Extract :
   - id    ← derive from filename ("2026-05-26-X-design.md" → "spec-2026-05-26-X")
   - title ← first H1 line, stripped of "design", "spec", "implementation plan"
   - description ← first non-blank paragraph after "## 2. Goal" heading, truncated 200 chars
   - tier  ← regex search "Tier (\d+\.\d+(?:\.\d+)?)" in the body; else null
   - expectedLinks ← all backticked tokens that look like paths (contain '/' or
                     end with .ts/.tsx/.mjs/.js/.py/.css/.tsx) from the "## 3. Design"
                     section onwards
   - status ← always 'planned' from a fresh spec.

3. Find ROADMAP.md by walking up from cwd.

4. Locate the markers `<!-- specs:start -->` / `<!-- specs:end -->`.
   - If missing : append a new H2 section at the bottom of ROADMAP.md :
     ## 🧪 From spec brainstorms
     <!-- specs:start -->
     | Spec | Tier | Title | Endpoint(s) / Composant(s) |
     |---|---|---|---|
     <!-- specs:end -->

5. Inside the managed section, find/upsert the row for this id :
   | [2026-05-26-X-design](docs/superpowers/specs/2026-05-26-X-design.md) | 2.3 | X title | `path1.ts`, `path2.tsx` |
   - Same id → update in place
   - New id  → append row before `<!-- specs:end -->`

6. Write ROADMAP.md back.

7. If GITNEXUS_PORT env var is set, POST http://localhost:$GITNEXUS_PORT/ghosts/sync to refresh immediately.
   Else, the next manual sync picks up the change.
```

#### Format de la section managée

```markdown
## 🧪 From spec brainstorms

> Auto-generated by `scripts/ghost-from-spec.mjs`. Edits between the markers
> below will be overwritten. To track a ghost manually, add it in the
> "✅ Déjà livré" table or in a Tier subsection above.

<!-- specs:start -->
| Spec | Tier | Title | Endpoint(s) / Composant(s) |
|---|---|---|---|
| [2026-05-26-audit-design](docs/superpowers/specs/2026-05-26-roadmap-predictive-audit-design.md) | 2 | Roadmap predictive — Audit view | `/ghost-audit`, `AuditPanel.tsx`, `docker-server-ghost-audit-core.mjs` |
| [2026-05-26-augmented-graph-design](docs/...) | 2 | Roadmap predictive — Augmented graph | `lib/ghost-layout.ts`, `GhostTooltip.tsx`, `useSigma.ts` |
<!-- specs:end -->
```

Le CORE parser reconnaît cette section via une nouvelle regex et émet les rows comme ghosts en statut `planned`.

#### Extension du CORE parser (Update à appliquer au CORE spec)

Le CORE actuellement reconnaît `## ✅ Déjà livré` (status materialized) et les Tier subsections. On ajoute :

```js
const FROM_SPEC_SECTION_RE = /^##\s+🧪\s+From spec brainstorms\s*$/i;

// In the table-parsing loop :
if (SHIPPED_SECTION_RE.test(line)) { inGhostTableSection = true; defaultStatus = 'materialized'; continue; }
if (FROM_SPEC_SECTION_RE.test(line)) { inGhostTableSection = true; defaultStatus = 'planned'; continue; }
```

Une ligne dans le Update du CORE spec : `## Update 2026-05-26 — Generalize parser for managed spec section`.

#### Installation wizard `scripts/install-brainstorm-hooks.mjs`

```
$ npm run setup:hooks

Hi! This will configure the brainstorm-hook on this machine.
Three options (you can pick any combination) :

  [Y/n] Claude Code PostToolUse hook (auto-run on spec creation)
  [Y/n] Git post-commit hook (auto-run on commit touching specs/)
  [Y/n] GitHub Actions workflow (CI safety net)

→ Updates :
  • .claude/settings.local.json    (merged, not overwritten)
  • .git/hooks/post-commit         (created or extended)
  • .github/workflows/roadmap-sync.yml   (created)

→ Tip : just press Enter to accept defaults (all 3 = Y).
```

Le wizard est non-destructif :
- `.claude/settings.local.json` : merge avec config existante, pas d'écrasement.
- `.git/hooks/post-commit` : si déjà présent, append plutôt qu'écraser ; sinon créer.
- `.github/workflows/roadmap-sync.yml` : créer si absent.

#### Tests (intégration au pyramid)

| Test | Fichier | Couvre |
|---|---|---|
| Spec parser | `tests/unit/ghost-from-spec-parser.test.mjs` | id derivation, title, description, tier regex, expectedLinks heuristic |
| Managed section update | `tests/unit/ghost-from-spec-roadmap.test.mjs` | upsertManagedSection : create from scratch, update in place, idempotent on N runs |
| Install hooks | `tests/unit/install-brainstorm-hooks.test.mjs` | Claude config merge (preserve existing keys), git hook creation, GHA workflow creation |
| End-to-end | `tests/integration/brainstorm-hook-e2e.test.mjs` | run script sur un vrai spec → ROADMAP.md modifié → POST /ghosts/sync → ghost visible via GET /ghosts |

## 4. Scope boundaries

**In-scope** :
- `scripts/ghost-from-spec.mjs` (parser + ROADMAP.md update)
- `scripts/install-brainstorm-hooks.mjs` (3-trigger wizard)
- CORE parser extension (1 regex, documented as Update on CORE spec)
- Tests unit + integration + e2e
- ROADMAP/INVENTORY/CLAUDE/spec wiring

**Out-of-scope explicite** :
- Modification du skill `superpowers:brainstorming` (on ne contrôle pas le plugin)
- Hook côté serveur gitnexus (post-commit du repo monitored)
- Tracking "spec updated" → ghost description amendée (les Updates au spec ne déclenchent pas de re-parse pour l'instant)
- Cross-project hooks (le script fonctionne dans un seul repo à la fois ; cross-project = future)
- Detection des `## Update YYYY-MM-DD — Shipped` sections pour marquer le ghost materialized (la matérialisation continue à passer par le CORE matchExpectedLinks)
- LLM-assisted spec parsing (le parser est strictement heuristique : regex + structure)
- Frontmatter YAML dans les specs

## 5. Open questions

1. **Quel `tier` quand le spec n'en mentionne pas ?** Aujourd'hui : `null`. Conséquence : le ghost a `tier: null` ; couleur grise dans Augmented graph, pas de groupement Tier dans Audit. Acceptable. **Marqué résolu.**
2. **Que faire si ROADMAP.md a déjà un row hand-written pour le même id ?** Le script vérifie l'id dans la section managée uniquement. Un row hand-written dans `## ✅ Déjà livré` peut coexister. Le CORE merge par id (le row le plus récent en statut wins). **Marqué résolu.**
3. **Spec supprimé (le user delete le file)** → faut-il retirer le row de la section managée ? Pour MVP : non, le row reste (le ghost devient orphan). Sous-spec future : nettoyer les rows dont le file référencé n'existe plus. **Hors-scope MVP.**
4. **Conflit de PostToolUse hooks Claude Code** : si l'utilisateur a déjà des hooks dans `.claude/settings.local.json`, le wizard merge. Cas tricky : 2 hooks PostToolUse Write avec patterns overlappants. **Résolu : le wizard liste tous les hooks PostToolUse Write existants, demande confirmation avant d'ajouter le nôtre, et refuse si un avec exactement le même filePattern existe déjà.**
5. **GH Actions trigger `paths` filtering** — sur GH, le filtre `paths: ['docs/superpowers/specs/**']` peut ne pas matcher en cas de force-push. **Acceptable** : le workflow est non-bloquant (`continue-on-error: true`) et idempotent.

## 6. Effort estimé

**2.5 jours**.

| Composant | Effort |
|---|---|
| Spec parser + tests unit | 1 j |
| `ghost-from-spec.mjs` ROADMAP.md update + tests | 0.5 j |
| `install-brainstorm-hooks.mjs` + 3 hook templates + tests | 0.5 j |
| Extension CORE parser (1 regex + Update sur CORE spec) | 0.25 j |
| Tests e2e + wiring docs + spec Update | 0.25 j |

## 7. Suite

Plan d'implémentation via `superpowers:writing-plans`.

Dernier brainstorm de cette session : **Gantt opérationnel**.

---

## Update 2026-05-27 — Shipped

Brainstorm-hook livré. Notes :

- Spec parser pure fns + ROADMAP upsert (idempotent) + CLI script ; tous tracked sous `scripts/`.
- CORE parser étendu via 1 regex (`FROM_SPEC_SECTION_RE`) ; Update appliquée au CORE spec en // .
- Wizard `install-brainstorm-hooks.mjs` non-destructif : merge `.claude/settings.local.json`, append vs create pour `.git/hooks/post-commit`, create `.github/workflows/roadmap-sync.yml`.
- Root `package.json` créé (le repo n'en avait pas avant) avec scripts `ghost:from-spec` + `setup:hooks`. Zéro dépendance npm.
- 4 triggers convergents : manuel, Claude PostToolUse, git post-commit, GitHub Actions — tous appellent le même code path.
- Tests : 3 unit + 1 e2e. Runtime local Node 21 bloqué (vitest 4.x), CI Node 22.
- 5 open questions du spec toutes résolues comme prévu.

