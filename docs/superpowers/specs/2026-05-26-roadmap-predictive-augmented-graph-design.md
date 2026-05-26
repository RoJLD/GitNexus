# Roadmap Predictive — Augmented graph view design

**Date** : 2026-05-26
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Depends on** : [`2026-05-26-roadmap-predictive-core-design.md`](2026-05-26-roadmap-predictive-core-design.md) (CORE — fournit `/ghosts?repo=X`)
**Sibling sub-specs** : [Audit](2026-05-26-roadmap-predictive-audit-design.md), Brainstorm-hook, Gantt

---

## 1. Context / problem

Le graph Sigma de gitnexus-web montre l'état réel du code (nodes File / Function / Class, edges CALLS / IMPORTS). Mais quand un dev regarde ce graph aujourd'hui, il ne voit pas ce qui est planifié pour demain — les ghosts vivent dans une autre vue (Audit) ou dans `ROADMAP.md`. Conséquence : les décisions structurelles ("où devrais-je ajouter ce nouveau module ?") se prennent sans visibilité sur le futur prévu.

L'objectif est de superposer les ghosts non matérialisés sur le graph Sigma, anchored à leurs `expectedLinks` réels quand ils en ont, pour qu'un dev voie au premier coup d'œil **où le futur va s'intégrer**.

## 2. Goal

Livrer une **augmentation du graph Sigma existant** : un toggle "Show ghosts" dans le panneau Filters fait apparaître les ghosts planifiés en transparence, connectés via des edges dashed à leurs `expectedLinks` matchés. Ghosts sans match vont dans un cluster satellite "Future" au top-right du canvas. Encodage couleur par Tier. Click sur un ghost ouvre une popup avec sa description et la liste de ses expectedLinks (matched/unmatched).

Aucune nouvelle route serveur. Tout consomme `/ghosts?repo=X` du CORE.

## 3. Design

### 3.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| Nouvel endpoint serveur `/ghosts/augmented` qui pré-calcule les positions | Inutile — le client a déjà la liste des nodes Sigma. La compute des positions doit vivre côté frontend pour rester réactive aux drag-layout / filtres. |
| Affichage permanent (pas de toggle) | Augmente la densité visuelle même quand le dev veut juste comprendre le code existant. Toggle est plus respectueux. |
| Ghosts materialized affichés aussi (avec couleur différente) | Doublon visuel — le node réel matérialisateur est déjà là. Ajoute de la confusion. Materialized ghosts sont masqués par défaut. |
| Tous les ghosts dans un cluster satellite (séparation nette) | Perd l'effet "voir où le ghost s'intégrera" qui est la valeur principale. |
| Tous anchored, ghosts sans match cachés | Perd la visibilité sur les ghosts Tier 3 (modules qui n'existent pas encore). Le satellite cluster les rend visibles. |

### 3.2 Approche retenue : hybride anchored + satellite

#### Architecture (pure frontend)

```
upstream/gitnexus-web/src/
├── hooks/useSigma.ts                  MOD  Étendre le reducer pour ghost layer
├── lib/ghost-layout.ts                NEW  Pure : computeGhostPositions + computeGhostEdges
├── components/
│   ├── GraphCanvas.tsx                MOD  Inject ghost data si toggle ON
│   ├── Filters.tsx                    MOD  Toggle hiérarchique "Show ghosts"
│   └── GhostTooltip.tsx               NEW  Popup click sur un ghost
└── services/
    └── ghosts-client.ts               NEW  fetch + cache local de /ghosts
```

Aucun changement serveur. Aucune nouvelle dep (Sigma + React déjà présents).

#### Data flow

```
Repo selection (event existant)
    │
    ▼
useEffect → fetchGhosts(repoBase) → /ghosts?repo=X
    │
    ▼
ghosts.json → computeGhostLayout(ghosts, existingSigmaNodes)
    │
    │   Pour chaque ghost :
    │     1. filtrer expectedLinks{kind:'path'}
    │     2. match contre les IDs des nodes Sigma existants (suffix + glob)
    │     3. si ≥ 1 match → ANCHORED : edges dashed vers chaque matched node
    │     4. si 0 match    → SATELLITE : position grid top-right (5 cols, wrap)
    │
    ▼
Sigma reducer (extension useSigma) :
    • merge ghost nodes + ghost edges dans graph data
    • node reducer : if isGhost → { color: tierColor, opacity: 0.4, type: 'circle-dashed', label: ghost.title }
    • edge reducer : if isGhostEdge → { color: tierColor + 0.5 alpha, dashed: true, weight: 0.5 }
    ▼
Sigma renders
```

#### Encodage visuel

| Ghost status | Fill | Outline | Edge | Affiché par défaut |
|---|---|---|---|---|
| planned | semi-transp 40% | dashed | dashed | OUI |
| materialized | masqué | — | — | NON (doublon avec real node) |
| cancelled | gris 30% | dashed | dashed gris | NON (toggle dédié) |

Couleurs par Tier :
- Tier 1 → bleu `#5b9bd5`
- Tier 2 → ambre `#e1aa55`
- Tier 3 → violet `#9b59b6`
- no-tier → gris `#6d6d6d`

#### UI Filters (extension)

```
Filters panel (existant)
└── Section "Roadmap predictive" (NEW)
    ☐ Show ghosts                  ← master toggle, OFF par défaut
       ☐ Tier 1
       ☐ Tier 2
       ☐ Tier 3
       ☐ Show cancelled ghosts
```

Logique : si master OFF, tout caché ; si master ON, par défaut tous les tiers ON sauf cancelled. Toggle individuel possible.

#### Interaction

| Évènement | Comportement |
|---|---|
| Hover ghost | Tooltip natif Sigma : `ghost.title` + badge tier |
| Click ghost | Ouvre `GhostTooltip` (popup) : titre, description, expectedLinks avec statut matched (✓ + chemin réel) / unmatched (✗), bouton "Open in ROADMAP.md" |
| Hover real node | Si node matche `expectedLinks` d'un ghost, ce ghost passe à opacity 0.7 (highlight reciproque) |
| Drag ghost | Disabled (positions sont computed) |

#### Pure fns clés

```typescript
// lib/ghost-layout.ts
export function matchExistingNodes(
  ghostExpectedLinks: { kind: string; value: string }[],
  existingNodeIds: string[],
): string[];          // returns IDs of nodes that match (suffix + glob)

export function computeGhostLayout(
  ghosts: Ghost[],
  existingNodes: { id: string; x: number; y: number }[],
  options?: { satelliteCols?: number; canvasBounds?: { xMax: number; yMin: number } },
): {
  ghostNodes: { id: string; x: number; y: number; tier: string; status: string; title: string }[];
  ghostEdges: { source: string; target: string; tier: string }[];
};
```

`matchExistingNodes` réutilise la logique de `matchExpectedLinks` du CORE (pure fn déjà testée). On peut l'importer directement de `docker-server-ghosts-core.mjs` ou la dupliquer (le CORE module est `.mjs` côté serveur ; côté frontend on a Vite + TypeScript donc on peut import direct si le module est compatible — il l'est, c'est pure JS).

#### Tests (intégration au pyramid)

| Test | Fichier | Couvre |
|---|---|---|
| ghost-layout pure fns | `tests/unit/ghost-layout.test.mjs` | matchExistingNodes (suffix, glob), computeGhostLayout (anchored vs satellite, grid placement) |
| GhostTooltip | `tests/unit/components/GhostTooltip.test.tsx` | render description, list expectedLinks matched/unmatched, click "Open ROADMAP" |
| Filters ghost toggles | `tests/unit/components/Filters.test.tsx` (extend) | master toggle, per-Tier, cancelled toggle |
| Augmented e2e | `tests/e2e/specs/augmented-graph.spec.ts` | toggle ON → ghosts visibles ; click → tooltip ; toggle OFF → hidden ; click tier off → tier filter applied |

Pas de test integration backend — aucun nouvel endpoint.

## 4. Scope boundaries

**In-scope** : Sigma reducer extension, ghost-layout pure fns, GhostTooltip popup, Filters extension, tests unit + e2e, ROADMAP/INVENTORY/spec updates.

**Out-of-scope explicite** :
- Edition d'un ghost depuis le graph (rename, retag tier, mark ✅) — out, ROADMAP.md reste le source d'édition.
- Drag-pin manuel d'un ghost — out, positions sont computed.
- Animation entre snapshots ("watch ghosts materialize as you scrub the Timeline") — out, c'est une feature distincte (à brainstormer comme follow-up si demandé).
- Affichage des ghosts dans le mode 3D (`Graph3DCanvas.tsx`) — out, sous-spec future si nécessaire.
- Filtre par owner / contributor du ghost — out (les ghosts n'ont pas encore de notion d'owner dans le CORE).

## 5. Open questions

1. **Composant `circle-dashed` natif Sigma** — Sigma a-t-il un node renderer "dashed circle" out-of-the-box ? Si non, on enregistre un custom renderer (~30 lignes). **Décision design** : Sigma n'a pas de dashed circle natif ; on enregistre un programme custom dans `setSetting('nodeProgramClasses', ...)`. Pattern déjà vu dans le codebase (ex: 3D mode). **Résolu, dans le plan.**
2. **Couleur ghost edges + alpha** — Sigma accepte la couleur RGBA ; les ghosts edges seront `rgba(<tier>, 0.5)`. **Résolu.**
3. **Mode 3D** — out-of-scope. Si demandé plus tard, le `Graph3DCanvas.tsx` aura sa propre couche d'overlay.
4. **Cache `/ghosts` côté client** — service `ghosts-client.ts` cache la dernière réponse 30 secondes. Re-fetch sur changement de repo ou bouton refresh. **Résolu.**
5. **Performance avec >100 ghosts** — Sigma gère ~10k nodes sans souci ; +100 ghosts négligeable. Pas de pagination nécessaire. **Résolu.**

## 6. Effort estimé

**3 jours**. Moins que Audit (pas de backend, pas de MCP).

| Composant | Effort |
|---|---|
| ghost-layout pure fns + tests | 0.5 j |
| ghosts-client.ts (fetch + cache) | 0.25 j |
| Sigma reducer extension + node program | 1 j |
| GhostTooltip popup | 0.5 j |
| Filters toggle hiérarchique + plumbing | 0.5 j |
| Tests e2e + wiring CI + ROADMAP/INVENTORY/spec | 0.25 j |

## 7. Suite

Plan d'implémentation via `superpowers:writing-plans` une fois ce spec validé.

Reste à brainstormer : **Brainstorm-hook**, **Gantt**.
