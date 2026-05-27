# Roadmap Predictive — Ghost Cluster design

**Date** : 2026-05-27
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Depends on** :
- [`2026-05-26-roadmap-predictive-core-design.md`](2026-05-26-roadmap-predictive-core-design.md) (CORE — parser + ghosts.json)
- [`2026-05-26-roadmap-predictive-audit-design.md`](2026-05-26-roadmap-predictive-audit-design.md) (Audit panel)
- [`2026-05-26-roadmap-predictive-augmented-graph-design.md`](2026-05-26-roadmap-predictive-augmented-graph-design.md) (Sigma reducer)
- [`2026-05-26-roadmap-predictive-gantt-design.md`](2026-05-26-roadmap-predictive-gantt-design.md) (Gantt panel)

**Trigger** : [`IDEAS-PARKING-roadmap-predictive.md`](IDEAS-PARKING-roadmap-predictive.md) sub-spec "Ghost Cluster granularité intermédiaire" — non débattu jusqu'ici, débloqué après livraison des 7 sub-specs précédentes.

---

## 1. Context / problem

Aujourd'hui la roadmap-prédictive a deux granularités :
- **Node** (un ghost = un endpoint / fichier / composant)
- **Tier** (un macro-regroupement éditorial, e.g. "Tier 2 — Plus ambitieux")

Manque une **granularité intermédiaire** : un module fonctionnel qui regroupe 2-5 ghosts liés mais qui n'est pas un Tier entier. Ex : "Auth overhaul" = `login.ts` + `session.ts` + `auth.test.ts` + `migrations/2026-add-session.sql`. Ces 4 ghosts forment une unité conceptuelle pour le user mais le CORE ne le sait pas — donc :
- L'Audit ne peut pas dire "Auth overhaul = 75% complet, 1 ghost expired"
- L'Augmented graph ne peut pas grouper visuellement
- Le Gantt ne peut pas montrer "tout Auth overhaul livré entre T1 et T2"
- Le user doit faire ces agrégations à la main

## 2. Goal

Livrer le **concept Ghost Cluster** = granularité intermédiaire node ← cluster ← tier.

Deux modes de définition (Q1 brainstorm = hybride) :
1. **Déclaratif** : section `## 🔗 Clusters` dans `ROADMAP.md`, parsée par le CORE
2. **Auto-dérivé** : connected components du graphe `dependsOn[]` pour les ghosts non-déclarés

Surface sur les 4 vues UI existantes (Q3 brainstorm) :
1. Augmented graph (halo coloré sur les membres)
2. Gantt panel (mode "Cluster swimlanes")
3. Audit panel (card Clusters + drill-down)
4. Endpoint API + MCP tool

Lifecycle (Q2 brainstorm) : statut **computed par défaut** (agrégat membres), override `status:` explicite optionnel pour les cas où l'user déclare qu'un cluster est ship malgré N membres planned (scope creep ignoré).

## 3. Design

### 3.1 Alternatives considérées (au-delà des questions brainstorm)

| Alternative | Pourquoi écartée |
|---|---|
| Cluster persistant dans LBugDB | Couple le CORE à un schéma DB upstream. Sidecar JSON cohérent avec ghosts.json. |
| Auto-cluster = K-means / clustering sémantique LLM | Trop magique, non-déterministe, coût tokens. Connected components du graphe `dependsOn` = source de vérité déterministe. |
| Status cluster boolean (`shipped: true/false`) | Trop pauvre — un cluster avec 4 membres dont 1 cancelled, 1 expired, 2 materialized n'est ni "shipped" ni "planned". L'agrégat `{ total, materialized, planned, expired, cancelled }` est plus riche. |
| Quorum status (80% materialized = shipped) | Seuil arbitraire. Sur 3 ghosts = 2.4 → rounding. La synthèse explicite "all-terminal AND ≥1 materialized" est plus claire. |
| Drag-to-cluster côté UI (Sigma) | Modifie ROADMAP.md depuis l'UI = trop de plumbing pour v1. User édite le markdown. |
| Cluster cross-repo | Out-of-scope. Un cluster vit dans un repo. |
| Cluster nesting (sub-clusters) | Out-of-scope v1 — flat clusters suffisent. Cluster de clusters = future si demandé. |

### 3.2 Approche retenue : convention markdown + sidecar + 4 surfaces UI

#### Architecture

```
upstream/
├── docker-server-ghosts-core.mjs        MOD  parser étend `parseClusters` + auto-derive helpers
├── docker-server-ghosts.mjs             MOD  sync écrit clusters.json sidecar
├── docker-server-cluster-audit.mjs      NEW  endpoint GET /clusters?repo=X
└── docker-server.mjs                    MOD  register /clusters route

upstream/gitnexus-web/src/
├── lib/cluster-layout.ts                NEW  pure fns : convex hull halo, swimlanes assignment
├── services/clusters-client.ts          NEW  fetch + 30s cache (pattern ghosts-client)
├── hooks/useSigma.ts                    MOD  applyClusterHalos / removeClusterHalos
├── components/
│   ├── ClusterTooltip.tsx               NEW  popup au click sur halo
│   ├── audit/ClustersCard.tsx           NEW  card "Clusters" dans AuditPanel
│   ├── GanttPanel.tsx                   MOD  toggle "Cluster swimlanes"
│   └── GraphCanvas.tsx                  MOD  inject cluster halos quand toggle ON
└── components/Filters.tsx               MOD  toggle "Show cluster halos"

mcp-server/
├── server.mjs                           MOD  20ème tool gitnexus_clusters
└── smoke.mjs                            MOD  smoke entry

tests/
├── unit/
│   ├── ghosts-clusters-parser.test.mjs            NEW  parseClusters from markdown
│   ├── ghosts-clusters-auto-derive.test.mjs       NEW  connected components on dependsOn
│   ├── ghosts-clusters-status.test.mjs            NEW  computeClusterStatus aggregate + synthesis
│   ├── cluster-layout.test.mjs                    NEW  convex hull + swimlane assignment
│   └── components/{ClusterTooltip,ClustersCard}.test.tsx   NEW
├── integration/endpoints/clusters.test.mjs        NEW
└── e2e/specs/06-cluster-halos.spec.ts             NEW

ROADMAP.md                               MOD  nouvelle row + section `## 🔗 Clusters`
INVENTORY.md                             MOD  nouvelle sub-section
CLAUDE.md                                MOD  smoke loop entry
tests/README.md                          MOD  ~9 nouvelles rows
patches/upstream-all.diff                REGEN
```

#### Convention markdown dans ROADMAP.md

```markdown
## 🔗 Clusters

### Auth overhaul
**ExpectedBy** : 2026-Q3
**Members** : tier-1-1-login, tier-1-2-session, tier-2-3-mfa
**Status** : planned   ← optional ; sinon synthétisé depuis members

### DB migration runner
**ExpectedBy** : 2026-09-30
**Members** : tier-1-1-orphan, tier-1-1-migration-cli, tier-2-2-rollback
```

Parser extrait :
- `id` = slug du title (`auth-overhaul`)
- `title` = brut
- `expectedBy` = string (parsed par `parseTargetDate` au runtime)
- `memberIds` = liste après split
- `status` = optionnel (sinon `null` = computed)
- `source: 'declared'`

#### Auto-derivation des clusters

Pour les ghosts **non-déclarés** dans aucun cluster :
1. Construire le graphe `dependsOn[]` (orienté).
2. Connected components ignorant la direction (Union-Find sur les arêtes).
3. Pour chaque composant ≥ 2 ghosts, créer un cluster :
   - `id` = `auto-cluster-<sha256(sorted-member-ids)[:8]>` (instable mais déterministe)
   - `title` = `Auto cluster <id-suffix>` (le user peut promouvoir en declared en éditant ROADMAP.md)
   - `expectedBy` = `null`
   - `source: 'auto'`
   - `status` = `null` (toujours computed)

**Limitation documentée** : ajouter/retirer un membre d'un auto-cluster crée un nouvel id, donc l'historique audit dangle. Si l'user veut un suivi stable, il doit déclarer manuellement.

#### Cluster runtime shape (clusters.json)

```json
{
  "syncedAt": "2026-05-27T...",
  "syncedCommit": "<sha>",
  "clusters": [
    {
      "id": "auth-overhaul",
      "source": "declared",
      "title": "Auth overhaul",
      "expectedBy": "2026-Q3",
      "memberIds": ["tier-1-1-login", "tier-1-2-session", "tier-2-3-mfa"],
      "declaredStatus": null,
      "aggregate": {
        "total": 3,
        "materialized": 1,
        "planned": 1,
        "expired": 1,
        "cancelled": 0,
        "completionPct": 33.3
      },
      "synthesizedStatus": "planned",
      "plannedAt": { "commit": "abc123", "date": "2026-02-01T..." },
      "materializedAt": null,
      "cancelledAt": null
    }
  ]
}
```

Règles de synthèse pour `synthesizedStatus` :
- `cancelled` : tous les membres `cancelled` (no materializations).
- `shipped` : tous les membres en terminal état (materialized OR cancelled) AND ≥ 1 materialized.
- `expired` : `synthesizedStatus !== shipped` AND cluster a `expectedBy` AND now > parseTargetDate(expectedBy) + grace.
- `planned` : sinon (≥ 1 member en planned/expired ET pas encore expired-au-niveau-cluster).

`declaredStatus` wins si défini (cohérent avec ghost lifecycle).

`plannedAt` = min(membres.plannedAt). `materializedAt` = max(membres.materializedAt) si all-terminal. `cancelledAt` = max si all cancelled.

#### Endpoint

`GET /clusters?repo=<base>` retourne le contenu de `.gitnexus/clusters.json` :
- 200 + body si sidecar existe
- 404 si pas de sync
- 400 sur repo manquant/inconnu

Optionnel : `?source=declared|auto` filtre.

#### MCP tool `gitnexus_clusters` (20ème)

```js
{
  name: 'gitnexus_clusters',
  description: 'Returns the ghost clusters for a repo. A cluster is a thematic group of ghosts (e.g. "Auth overhaul" containing login.ts + session.ts + mfa.ts). Two sources: declared in ROADMAP.md "🔗 Clusters" section, or auto-derived from dependsOn[] connected components. Each cluster carries an aggregate (counts by status) + a synthesizedStatus ({shipped|planned|cancelled|expired}). Use after gitnexus_ghosts_sync.',
  inputSchema: { type: 'object', properties: { repo: { type: 'string' }, source: { type: 'string', enum: ['declared', 'auto'] } }, required: ['repo'] },
  handler: ({ repo, source }) => callWeb('/clusters', { repo, ...(source ? { source } : {}) }),
}
```

Plus un summary formatter `formatClustersSummary` (pattern du `ghost_audit` MCP tool).

#### UI — Augmented graph (halo cluster)

Toggle dans Filters panel : **☐ Show cluster halos** (default OFF).

Quand ON, pour chaque cluster :
- Calculer le convex hull 2D des positions Sigma des membres (ghosts + ghost-nodes existants).
- Rendre un polygone semi-transparent (opacity 0.15, fill = couleur tier dominant, stroke 1px dashed).
- Labelliser au centroïde : `<cluster.title> (N/M)` avec count.
- Click sur halo → `ClusterTooltip` popup (titre, expectedBy, members, synthesizedStatus, % completion).
- Hover halo → highlighter les membres (opacity 1, autres 0.3).

Edge case : cluster d'un seul membre = pas de hull (point) → afficher un cercle de rayon 20px au lieu de polygone.

Edge case : cluster avec membres non-rendus (pas dans le graph courant) → halo dégradé (dashed plus large, label `(?/M shown)`).

#### UI — Gantt (cluster swimlanes)

Mode swimlanes Gantt étendu :
- État existant : `swimlanes: 'flat' | 'tier'`
- Nouveau : `swimlanes: 'flat' | 'tier' | 'cluster'` (radio buttons)
- Quand `cluster` : 1 swimlane par cluster, headers en gras avec count + completionPct. Ghosts sans cluster groupés en swimlane "Unclustered" en bas.

Bonus : option d'affichage agrégé "Show only cluster bars" — collapse les membres en 1 bar synthétique par cluster (start = min(plannedAt), end = max(materializedAt or expectedBy)).

#### UI — Audit (ClustersCard)

Nouvelle card dans AuditPanel à côté de "Expired" (7ème card) :
- Header : "Clusters" + count total.
- Body : top 5 clusters par `completionPct` ascendant (les moins complets en premier — actionnable).
- Chaque ligne : `<title>` (synthesizedStatus badge) — `M/N matérialisés` — `expectedBy` (avec strip late/critical si applicable).
- Drill-down click → modale `ClusterDrillModal` listant les membres avec leur status individuel, lien vers AuditPanel ghost row.

#### Filters panel (Augmented + Gantt + Audit)

3 nouvelles entrées dans la section "Roadmap predictive" :
- ☐ Show cluster halos (master toggle Augmented)
- ☐ Include auto-clusters (default OFF — auto-clusters sont bruyants)
- Sub-radio (quand "Show cluster halos" ON) : show declared / auto / both

#### `roadmap.yml` reflection

Le sidecar machine-readable gagne une section `clusters: [...]` rendue par `renderRoadmapYml` (CORE déjà). Pure fn, déterministe.

#### Tests (pyramid)

| Test | Fichier | Couvre |
|---|---|---|
| Parser clusters | `unit/ghosts-clusters-parser.test.mjs` | Section `## 🔗 Clusters` parsée, edge cases (no members, no expectedBy, malformed line) |
| Auto-derive | `unit/ghosts-clusters-auto-derive.test.mjs` | Connected components, exclusion des ghosts déjà declared, id stability |
| Cluster status | `unit/ghosts-clusters-status.test.mjs` | computeClusterStatus (4 synthèses + declaredStatus wins + expired logic) |
| Cluster layout | `unit/cluster-layout.test.mjs` | Convex hull, swimlane assignment |
| ClusterTooltip | `unit/components/ClusterTooltip.test.tsx` | Render + click member → propagation |
| ClustersCard | `unit/components/audit/ClustersCard.test.tsx` | Render top 5, drill-down |
| Endpoint | `integration/endpoints/clusters.test.mjs` | GET 200 / 404 / 400, filter `?source=` |
| E2E halos | `e2e/specs/06-cluster-halos.spec.ts` | Toggle ON → halos visibles → click → tooltip → drill member |

## 4. Scope boundaries

**In-scope** :
- Convention markdown ROADMAP.md `## 🔗 Clusters`
- CORE parser extension (`parseClusters` + helpers)
- Auto-derivation via connected components (`dependsOn`)
- Runtime sidecar `.gitnexus/clusters.json`
- `roadmap.yml` reflection
- Endpoint `GET /clusters`
- MCP tool `gitnexus_clusters` (20ème)
- 4 UI surfaces (Augmented halo, Gantt swimlanes, Audit ClustersCard, Filters toggles)
- Tests + wiring docs

**Out-of-scope explicite** :
- Cluster nesting (sub-clusters)
- Cross-repo clusters
- LLM-assisted auto-clustering thématique
- Drag-to-cluster côté UI (rename / move members)
- Stable id auto-clusters via fingerprint sémantique (membership-invariant)
- Cluster dependencies (`clusterDependsOn: [otherClusterId]`)
- Per-snapshot cluster history (clusters.json reste latest-only ; future si demandé)

## 5. Open questions

1. **Auto-cluster d'un seul ghost ?** Non — composant connecté minimum = 2 ghosts. Singleton = pas un cluster. **Résolu.**
2. **Cluster d'un ghost cancelled uniquement ?** Si tous les membres sont cancelled, `synthesizedStatus = cancelled`. Le cluster reste affiché (l'historique compte). **Résolu.**
3. **Ghost dans 2 clusters declared ?** Le parser autorise. Le ghost apparaît dans les 2 halos sur le graph (multi-belonging). Le Gantt swimlane mode = le ghost est dupliqué en visuel (1 fois par cluster). **Résolu.**
4. **Stable id auto-cluster — fingerprint membership-invariant ?** Hors v1. Limitation documentée : ajout d'un ghost à un auto-cluster casse l'historique d'audit. User a la solution : déclarer manuellement le cluster dans ROADMAP.md. **Résolu.**
5. **Cluster expired propagation à ses membres ?** Non — un cluster expired n'expire pas ses membres individuels. Chaque ghost garde son propre `expectedBy` et `expired` status. Cluster expired = signal global complémentaire. **Résolu.**

## 6. Effort estimé

**~5 jours** (au-dessus du budget initial "1-2j" du parking-list parce que le user a choisi les 4 surfaces UI au lieu d'une seule).

| Composant | Effort |
|---|---|
| CORE parser : `parseClusters` + auto-derive + tests unit | 0.75 j |
| `computeClusterStatus` (aggregate + synthesis + expired) + tests | 0.5 j |
| `roadmap.yml` rendering extension + tests | 0.25 j |
| Sidecar I/O + endpoint `GET /clusters` + route registration + integration test | 0.5 j |
| MCP tool `gitnexus_clusters` + smoke | 0.25 j |
| `cluster-layout.ts` (convex hull + swimlanes) + tests | 0.5 j |
| Augmented graph halo (useSigma extension + ClusterTooltip) | 0.75 j |
| Gantt cluster swimlanes mode | 0.5 j |
| Audit ClustersCard + drill modal | 0.5 j |
| Filters toggles + plumbing | 0.25 j |
| E2E + wiring docs (ROADMAP + INVENTORY + CLAUDE smoke + tests/README + spec Update) | 0.25 j |

## 7. Suite

Plan d'implémentation via `superpowers:writing-plans`. Dernière sub-spec parking de la série Roadmap Predictive (avant Augmented Timeline qui reste à brainstormer).
