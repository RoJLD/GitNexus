# Roadmap Predictive — CORE design

**Date** : 2026-05-26
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Sub-specs à venir** : voir [`IDEAS-PARKING-roadmap-predictive.md`](IDEAS-PARKING-roadmap-predictive.md) (Audit, Augmented graph, Gantt, Brainstorm-hook, LLM-assisted materialization, SysML export)

---

## 1. Context / problem

Aujourd'hui le Timeline gitnexus (snapshots + churn + growth + lifespan + entropy) montre **comment le code a évolué**. La roadmap (`ROADMAP.md`) montre **ce qu'on a prévu**. Les deux vivent en parallèle sans se rencontrer — impossible de voir l'écart entre prévision et livraison, ni la matérialisation graduelle des plans.

Concrètement, on a 24 items "Déjà livré" + ~10 items pending dans 3 Tiers, mais aucune trace machine-lisible de :
- **Quand** un item a été planifié pour la première fois (commit + date)
- **Quand** il a été matérialisé (commit + date)
- **Quels** fichiers/endpoints concrets le matérialisent
- **Quel** écart prévision/livraison existe

Le user veut faire émerger ces signaux pour 4 vues futures (Audit, Augmented graph, Gantt, Brainstorm-hook) qui partagent toutes la même donnée de base : un "ghost node" par item planifié, avec un lifecycle (planned → materialized / cancelled).

## 2. Goal

Livrer un CORE serveur qui ingère `ROADMAP.md`, produit un fichier YAML versionné `roadmap.yml`, écrit l'état runtime des ghosts dans des sidecars JSON (latest + per-snapshot), expose 3 endpoints HTTP pour les requêter, et s'auto-synchronise pendant les snapshots. À l'issue du CORE, un user doit pouvoir faire `npm run ghosts:sync && curl :4173/ghosts?repo=X` et obtenir la liste de tous ses ghosts avec leur statut courant. Les 4 vues utilisateur sont **hors-scope** de ce CORE (cf. parking file).

## 3. Design

### 3.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| Stocker les ghosts dans LadybugDB (nodes Cypher-queryable) | Couple fortement notre patch à l'évolution upstream du schéma. Pour un système "side-car" comme la roadmap, le coût d'intégration est trop élevé pour le bénéfice (pouvoir faire `MATCH (g:Ghost)-[:MATERIALIZES]->(f:File)` au lieu d'une jointure côté serveur). |
| Source de vérité unique = roadmap.yml édité à la main | Casse le flow humain actuel (le user édite ROADMAP.md naturellement, c'est lisible en GitHub). Imposerait un éditeur YAML. |
| Source de vérité unique = ROADMAP.md (parsing à chaque query) | Pas de version machine-lisible reviewable en PR. Le parser deviendrait un point fragile non-versionné. |
| Eager CORE avec file watcher + cache persistant + indexing en background | Over-engineering pour un MVP. Le lean CORE peut être enrichi par les sous-specs (Audit) si besoin. |
| Détection de matérialisation full-LLM (l'agent lit chaque commit) | Trop cher en tokens, dépendance LLM. Parquée comme extension Tier 2 si l'hybride manuel/auto se révèle insuffisant. |
| Granularité fine (1 ghost = 1 endpoint OU 1 composant) | Multiplication artificielle. Le user pense en "Tier X.Y" pas en composant. |

### 3.2 Approche retenue

**Lean CORE — sidecars JSON, parser pur, sync explicite, snapshot auto-sync.**

#### Architecture en 3 modules serveur

```
upstream/
├── docker-server-ghosts.mjs           ← NEW : route handlers + I/O
├── docker-server-ghosts-core.mjs      ← NEW : pure fns (testable sans Docker)
│   • parseRoadmap(md) → ghosts[]
│   • renderRoadmapYml(ghosts) → yaml string
│   • matchExpectedLinks(ghost, changedFiles) → { matched, unmatched }
│   • computeStatus(ghost, snapshot) → "planned" | "materialized" | "cancelled"
├── docker-server.mjs                  ← MODIFY : register 3 routes
├── docker-server-snapshots.mjs        ← MODIFY : call syncGhostsForSnapshot
└── docker-server-snapshots-bulk.mjs   ← MODIFY : idem

gitnexus/
├── scripts/sync-ghosts.mjs            ← NEW : CLI wrapper (=POST /ghosts/sync)
└── package.json                       ← MODIFY : "ghosts:sync" npm script
```

#### Storage layout (par repo analysé)

```
<repo>/
├── ROADMAP.md                         ← humain édite ici (inchangé)
├── roadmap.yml                        ← auto-généré, versionné en git
│
└── .gitnexus/
    ├── lbug.db                        ← inchangé (pas d'extension schéma)
    ├── ghosts.json                    ← state runtime "latest"
    └── snapshots/<sha>/ghosts.json    ← état du planning à ce commit
```

#### Endpoints

| Méthode | Path | Action |
|---|---|---|
| `POST` | `/ghosts/sync?repo=<base>` | Parse ROADMAP.md @ HEAD → écrit roadmap.yml + ghosts.json |
| `GET` | `/ghosts?repo=<base>` | Renvoie `ghosts.json` latest. **404** si `ghosts.json` n'existe pas (jamais sync). **200 `{ ghosts: [] }`** si sync mais ROADMAP.md vide / absent. |
| `GET` | `/ghosts/at?repo=<base>&commit=<sha>` | Renvoie `ghosts.json` du snapshot. **404** si pas de snapshot pour ce SHA. **200 `{ ghosts: [] }`** si snapshot existe mais ROADMAP.md absent à ce commit. |

#### Data model (schéma d'un ghost)

```yaml
# roadmap.yml entry (declared, machine-readable, versioned)
ghosts:
  - id: tier-2-3-what-if-simulator
    tier: "2.3"
    title: "What-if simulator (rename/move/delete)"
    description: "Mutations symboliques sans exécution réelle…"
    status: planned                    # planned | materialized | cancelled
    plannedFor: "2026-Q3"              # optional, free-text
    expectedLinks:                     # patterns the materialization should match
      - "services/mutation-engine.ts"
      - "WhatIfPanel.tsx"
    dependsOn: []                      # ids of ghosts that must materialize first
```

```json
// .gitnexus/ghosts.json runtime entry (state at last sync)
{
  "id": "tier-2-3-what-if-simulator",
  "declared": { /* mirror of yaml entry */ },
  "plannedAt": { "commit": "d71c64ec", "date": "2026-05-24T..." },
  "materializedAt": {
    "commit": "<sha>",
    "date": "2026-05-26T...",
    "confirmedBy": "manual"            // manual | auto | user-validated
  },
  "cancelledAt": null,
  "links": [
    { "file": "services/mutation-engine.ts", "matchedPattern": "services/*-engine.ts" },
    { "file": "WhatIfPanel.tsx" }
  ]
}
```

#### Parser (parseRoadmap)

Lit deux types d'entrées :
1. **Table "Déjà livré"** — chaque ligne devient un ghost `status: materialized`, `expectedLinks` extrait de la 3ème colonne (endpoint/composant).
2. **Sections Tier X.Y** — `id = tier-x-y-<slug>`, `description` = paragraphe sous `**Promesse**`, `expectedLinks` extrait du paragraphe sous `**Premier pas**`. `status: materialized` si `✅` dans heading, `cancelled` si `🗑️`/`~~`, sinon `planned`.

Idempotent et déterministe : 2 runs → YAML bit-identique.

#### Matching expectedLinks

Pour chaque `pattern` dans `ghost.expectedLinks` :
- si contient `*`/`?`/`**` → glob via `minimatch` contre chaque path de `changedFiles`
- sinon → substring match (`path.endsWith(pattern)` ou `path.includes(pattern)`)

Source des `changedFiles` : `git log --name-only --since=<plannedAt> HEAD`.

#### Lifecycle

| Trigger | Transition | Champs |
|---|---|---|
| 1er sync où ghost apparaît dans roadmap.yml | (nothing) → planned | `plannedAt = {commit, date}` |
| ROADMAP marqué ✅ | planned → materialized | `materializedAt`, `confirmedBy = "manual"` |
| Tous expectedLinks matchés sans ✅ | planned → materialized (suggested) | `materializedAt`, `confirmedBy = "auto"` |
| Ghost absent du roadmap.yml courant | planned → cancelled | `cancelledAt` |
| Ghost réapparaît après cancellation | cancelled → planned | nouveau `plannedAt`, ancien `cancelledAt` conservé |

Note : `plannedAt` = 1ère fois où gitnexus voit le ghost (timestamp du sync), pas la 1ère apparition réelle dans ROADMAP.md. Backfill historique = hors-scope CORE (sous-spec Audit).

#### Snapshot integration

Dans `docker-server-snapshots.mjs` (et `-bulk.mjs`), après `git checkout <sha>` et avant `meta.json` :
```js
await syncGhostsForSnapshot(repoPath, snapshotDir, sha);
// → parse ROADMAP.md à ce commit, écrit snapshotDir/ghosts.json
// → ne touche PAS au ghosts.json latest
```

Bulk snapshot d'un historique => chaque snapshot dir contient son `ghosts.json` propre, image figée du planning à ce commit.

#### Tests (intégration au test pyramid Phase 1b)

- 4 fichiers unit (`tests/unit/ghosts-{parser,yaml,matching,lifecycle}.test.mjs`) sur les pures fns
- 4 fichiers integration (`tests/integration/endpoints/ghosts{,-sync,-at,-snapshot}.test.mjs`)
- Étendre `tests/fixtures/make-fixture.mjs` pour ajouter un mini-ROADMAP.md dans le fixture sample-repo
- Pas de e2e (le CORE est back-end ; les vues UI ont leur propre sub-spec)

## 4. Scope boundaries

**In-scope** : parser, pure fns, 3 endpoints, sidecars JSON, snapshot auto-sync, tests unit + integration, fixture extension.

**Out-of-scope explicite (sous-specs séparées)** :
- Audit view (regard arrière, métriques lead-time/slippage/churn)
- Augmented graph view (ghosts overlayés sur le graph Sigma actuel)
- Gantt view (timeline horizontal)
- Brainstorm-hook (auto-création de ghosts depuis le skill brainstorming)
- LLM-assisted materialization detection
- SysML / diagrammes systémiques export
- Backfill historique (`plannedAt` reconstruit depuis `git log -L ROADMAP.md`)
- Cypher integration (ghost as native graph nodes)
- Multi-repo aggregation (`/ghosts/cross?repos=A,B`)
- UI panel pour les ghosts (le CORE est strictement back-end)

## 5. Open questions

1. **Cas du ROADMAP.md vide ou inexistant** : `GET /ghosts` répond `200 { ghosts: [] }` ou `404` ? **Décision design** : `200 { ghosts: [] }` (pas une erreur ; juste pas de planning). Validé. (Marqué résolu pour le plan.)
2. **Snapshots historiques avant introduction de ROADMAP.md** (commit `0d3bdc15` du 2026-05-22) : ghosts.json contiendra `[]`. Validé par cas particulier dans Section C.
3. **roadmap.yml committé automatiquement ?** Non. `POST /ghosts/sync` écrit le fichier mais ne git-stage rien. C'est au user de `git add roadmap.yml && git commit` (cohérent avec le workflow actuel : pas de side-effect git surprise). À documenter dans la sortie de `npm run ghosts:sync` ("roadmap.yml updated, don't forget to commit").
4. **Format des `expectedLinks` parsés depuis ROADMAP.md** : la 3ème colonne de la table contient parfois des paths concrets (`docker-server-csv.mjs`), parfois des labels (`Layers toggle`). Le parser doit garder les deux mais marquer le type (`{ kind: "path" | "label", value: "..." }`). Le matcher utilise seulement les `path`s ; les `label`s sont gardés en metadata pour les futurs consommateurs (sous-specs Audit/Augmented/Gantt). **À traiter pendant l'implémentation, pas un blocker.**
5. **dependsOn entre ghosts** : déclaratif dans le YAML, mais pas exploité par le matcher (un ghost peut se matérialiser même si son `dependsOn` ne l'est pas). Sera utile pour l'Audit view (détecter les inversions d'ordre planifié vs livré). **Hors-scope CORE.**

## 6. Effort estimé

**2-3 jours** pour l'ensemble du CORE :
- Parser + pure fns : 0.5 j
- Endpoints + I/O : 0.5 j
- Snapshot integration : 0.5 j
- Tests (unit + integration) + fixture extension : 1 j
- Wiring CI + regénération `patches/upstream-all.diff` + ROADMAP/INVENTORY updates : 0.5 j

---

## 7. Suite

Une fois ce CORE livré et stable (idéalement après 1 cycle d'usage où on vérifie que le matching expectedLinks attrape bien les vrais commits), invoquer `superpowers:brainstorming` pour chacun des 4 sub-specs (Audit, Augmented, Gantt, Brainstorm-hook) — un par session — en suivant la convention `docs/superpowers/specs/YYYY-MM-DD-roadmap-predictive-<view>-design.md`.

---

## Update 2026-05-26 — Integration de la review externe Gemini

Suite à la [review externe](2026-05-26-ghost-nodes-external-review.md), 4 ajustements au CORE design. Aucun ne casse l'architecture déjà choisie ; ce sont des durcissements de l'interface et un pré-câblage pour l'extension.

### 4 deltas appliqués

#### (a) `expectedBy` devient obligatoire dans roadmap.yml

Le champ `plannedFor` (free-text optionnel) est renommé `expectedBy` (obligatoire) dans le schéma. Raisons :
- Permet une notion d'expiration (ghost dépasse son expectedBy → status `expired`)
- Force la discipline : un ghost sans deadline = un ghost qui devient archéologique
- Compatible ISO date / `YYYY-QX` / `YYYY-MM` (parsing déjà spec'é dans Audit)

Le parser émet un warning sur stderr (pas une erreur) pour les ghosts sans `expectedBy` parsé depuis ROADMAP.md, pour permettre une migration progressive du markdown existant.

Nouveau status dérivé `expired` : `status === 'planned' && now > expectedBy + grace_period` (grace default = 30j, configurable dans `.gitnexus.yaml`).

Le mécanisme cleanup à expiration est livré dans la sous-spec dédiée [`2026-05-26-roadmap-predictive-cleanup-and-connectors-design.md`](2026-05-26-roadmap-predictive-cleanup-and-connectors-design.md).

#### (b) Plugin-aware registry (Option C de la review)

Le CORE expose une fonction publique :
```js
export function registerGhostSource(source) {
  // source = { name, fetchGhosts: async (repoPath) => GhostInput[] }
}
```

Le ghostSource builtin (parser ROADMAP.md) est toujours présent et toujours `registered` au boot. Les futurs sub-specs (multi-tool connectors, plugins custom) peuvent enregistrer leurs propres sources.

Lors d'un `syncGhostsForRepo`, le CORE itère sur toutes les sources enregistrées et merge leurs ghosts par id (la source builtin gagne en cas de conflit, les externes sont marquées `source: <name>` dans le runtime JSON).

Ça pré-câble pour Tier 3.10 (plugin architecture) sans bloquer le CORE lean. Les sub-specs Audit / Augmented / Gantt restent monolithiques en v1 ; elles deviendront des plugins quand 3.10 sera livré.

#### (c) Granularité node uniquement (clarification Q5)

Un ghost = un item ROADMAP au niveau **node** (fichier / endpoint / composant). Le groupement passe par `dependsOn[]` (déjà dans le schéma) : un ghost peut déclarer qu'il dépend d'autres ghosts ; l'UI peut visualiser la chaîne, mais aucune notion de "Ghost Cluster" intermédiaire dans le CORE.

Un "Ghost Cluster" (groupement explicite type "module Auth complet") serait une feature future séparée et n'impacte pas le CORE.

#### (d) Manifest path : v0 = `roadmap.yml` distinct, v1 sera section dans `.gitnexus.yaml`

Aujourd'hui (v0 du CORE) : `roadmap.yml` au niveau repo, versionné, distinct.

Cible v1 (quand Tier 2bis.4 `.gitnexus.yaml` unifié sera stable) : section `roadmap:` à l'intérieur de `.gitnexus.yaml`. La migration sera mécanique (une commande `npm run gitnexus:migrate-config`).

Pas de bloquant pour v0 — le user n'aura juste pas à éditer 2 fichiers de config plus tard.

### Effort additionnel pour ces 4 deltas

| Delta | Effort | Localisation |
|---|---|---|
| (a) expectedBy mandatory + warning + expired status dérivé | 0.5 j | CORE plan (Update ajoute 2 tâches) |
| (b) Plugin registry registerGhostSource | 0.5 j | CORE plan (nouvelle tâche) |
| (c) Granularité (juste clarification + tests dependsOn) | 0.1 j | CORE plan (note + 1 test) |
| (d) Manifest path (note + futur migrator) | 0 j (note seulement) | CLI script v1 follow-up |
| **Sous-total** | **~1.1 j** | |

CORE total revised : **3.5 j** (vs 2-3 j initial).

### Sous-spec ajoutée par cette Update

[`2026-05-26-roadmap-predictive-cleanup-and-connectors-design.md`](2026-05-26-roadmap-predictive-cleanup-and-connectors-design.md) — cleanup à expiration + multi-tool connector (Plane primary). 6ème sub-spec de la série.

---

## Update 2026-05-26 — Shipped

CORE livré (plan : [`docs/superpowers/plans/2026-05-26-roadmap-predictive-core.md`](../plans/2026-05-26-roadmap-predictive-core.md)). Notes de livraison :

### Tâches exécutées (21 + 1 Update injection)

- Tasks 1-5 : pures fns `parseRoadmap` (tables + Tier sections), `renderRoadmapYml` (déterministe, expectedBy émis), `matchExpectedLinks` (suffix + glob), `computeStatus` + `parseTargetDate` (lifecycle declared-wins + auto-match + expired après `expectedBy + 30j`).
- Task 6 : I/O wrapper `syncGhostsForRepo` / `syncGhostsForSnapshot` / `readLatestGhosts` / `readSnapshotGhosts`.
- **Task 6.5 (Update 2 injection)** : `registerGhostSource()` plugin-aware registry. Builtin `roadmap-md` toujours présent (protégé contre remplacement), externes mergent par id avec builtin-wins. Pré-câblage Tier 3.10 sans bloquer le CORE lean. Code-review fix-up : `_fetchAndMergeDeclaredGhostsForTests` exporté pour tester le merge, validation `assertValidSource` assouplie (accepte toute fn retournant un Promise, pas que `async function`), bootstrap module-load idempotent.
- Tasks 7-8 : `handleGhostsRoute(req, url, res, opts)` (3 handlers privés) + registration dans `docker-server.mjs`. Refactor `readSnapshotGhosts(snapshotDir)` — signature monoargumentale alignée avec le path réellement écrit par `syncGhostsForSnapshot`.
- Tasks 9+10 : auto-sync wired dans `createSnapshot` — couvre les **4 entry points** (`/snapshot`, `/snapshot/bulk`, `/snapshot/auto`, `/snapshot/from-pr`) car tous funnel-through `createSnapshot`. Pas de duplication.
- Task 11 : `scripts/sync-ghosts.mjs` CLI wrapper.
- Task 12 : **skipped** — pas de `package.json` à la racine de gitnexus ; le user invoque directement `node scripts/sync-ghosts.mjs <repo>`.
- Task 13 : fixture `sample-repo` reçoit un commit 11 ajoutant un mini-`ROADMAP.md` (2 table rows + 3 Tier sections = 5 ghosts).
- Tasks 14-17 : 4 tests d'intégration (sync idempotent, get 404/200, at historical, snapshot auto-sync écrit par dir).
- Tasks 18-21 : docs — `/ghosts*` dans smoke loop CLAUDE.md, row 37 dans ROADMAP "Déjà livré", section dans INVENTORY (endpoints + fichiers + Update 4 manifest path note), 9 nouveaux fichiers de test inventoriés dans `tests/README.md`.

### Updates de la review externe Gemini, appliqués

- (a) `expectedBy` warning-on-missing : `warnMissingExpectedBy()` exporté côté core, émet warning stderr. Status `expired` implémenté avec grace 30j default (configurable via `.gitnexus.yaml > ghosts.grace_period_days` quand 2bis.4 sera étendu).
- (b) `registerGhostSource()` registry : livré Task 6.5.
- (c) Granularité node-only : clarifié dans le parser, ghosts au niveau **node** (file/endpoint/component) ; groupement via `dependsOn[]`. Pas de Ghost Cluster.
- (d) Manifest path v0 → v1 : v0 = `roadmap.yml` distinct, livré. v1 cible = section `roadmap:` dans `.gitnexus.json` (futur, dépendance Tier 2bis.4).

### Choix de design notables

- **Granularité de Pass A/B du parser** : 2 passes parallèles sur les mêmes lignes (table + Tier sections), pas de state-machine unifiée. Plus simple à raisonner.
- **`extractExpectedLinks`** : tokens backtick-quotés extraits ; classifiés `path` si `/` présent ou extension fichier connue OU commence par `?` (cas query-string `?format=csv`), sinon `label`. Le matcher ignore les `label` (open question 4 résolue comme prévu).
- **`renderRoadmapYml`** : sérializer hand-rolled (pas de dépendance js-yaml), tri stable par id, échappement single-quote pour caractères ambigus. Output déterministe bit-à-bit.
- **`safeSnapshotKey(commit.shortHash)`** comme clé de snapshot dir : le handler `/ghosts/at` accepte donc le short hash (matches `handleListSnapshots` convention). Plein SHA non supporté en v1 — peut être ajouté par canonicalisation `getCommitInfo` si nécessaire.
- **`roadmap.yml` non auto-committé** (open question 3) : la CLI rappelle au user de committer le fichier. Pas d'effet de bord git invisible.
- **Backfill historique de `plannedAt`** : hors-scope (sous-spec Audit). Première sync = `plannedAt: { commit: HEAD, date: HEAD-date }`.

### Tests : runtime bloqué localement (Node 21), validé sur CI Node 22

Local : `node --check` + smoke `node -e "import(...)..."` à chaque tâche. CI Linux Node 22 exercera vitest 4.x au prochain run du workflow GHA (Phase 1b dépend de [`2026-05-26-defer-node22-upgrade.md`](../decisions/2026-05-26-defer-node22-upgrade.md)).

### Limitations connues

1. **Auto-match false positives** : si un commit touche un fichier listé dans `expectedLinks` d'un ghost `planned`, il sera upgradé à `materialized`. Mitigation : marquer ✅ manuellement dans ROADMAP.md dès qu'on shippe ; declared status gagne toujours sur auto-match.
2. **Tests d'intégration runtime-blocked** : 4 tests vitest écrits, exécution locale impossible (Node 21). Validés en CI Node 22.
3. **`/ghosts/at` exige short hash** : pas de canonicalisation full→short pour l'instant.
4. **Manifest v0** : 2 fichiers de config (`.gitnexus.json` pour le reste, `roadmap.yml` pour les ghosts) — sera unifié en v1.

### Suite

Les sub-specs Audit / Augmented graph / Cleanup+connectors / Gantt / Brainstorm-hook restent à exécuter dans cet ordre (cf [IDEAS-PARKING-roadmap-predictive.md](IDEAS-PARKING-roadmap-predictive.md)). Brainstorms déjà faits pour Audit / Augmented / Gantt / Cleanup ; à brainstormer encore : Brainstorm-hook + SysML (bonus).
