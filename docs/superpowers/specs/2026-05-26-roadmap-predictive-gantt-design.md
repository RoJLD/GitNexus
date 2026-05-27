# Roadmap Predictive — Gantt opérationnel design

**Date** : 2026-05-26
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Depends on** : [`2026-05-26-roadmap-predictive-core-design.md`](2026-05-26-roadmap-predictive-core-design.md) (`/ghosts` endpoint)
**Sibling sub-specs** : [Audit](2026-05-26-roadmap-predictive-audit-design.md), [Augmented graph](2026-05-26-roadmap-predictive-augmented-graph-design.md), [Brainstorm-hook](2026-05-26-roadmap-predictive-brainstorm-hook-design.md)

---

## 1. Context / problem

L'Audit view donne des chiffres agrégés (lead time, slippage, velocity). L'Augmented graph montre les ghosts dans leur contexte structurel. Aucune des deux ne montre **la dimension calendaire** : à quel moment chaque ghost a-t-il été planifié, quand a-t-il été livré, quels ghosts sont prévus pour quand. Pour communiquer un planning ou décider "qu'est-ce qu'on attaque la semaine prochaine", il manque une vue Gantt classique.

## 2. Goal

Livrer un panneau `GanttPanel.tsx` qui affiche une vue calendaire des ghosts : une ligne par ghost, axe X = temps, bars encodées par status (solid pour matérialisé, dashed pour planifié futur, dot pour planifié sans deadline, grey pour annulé), couleur par Tier. Toggle swimlanes (OFF par défaut = flat list ; ON = groupé par Tier major). Filtres réutilisés depuis Augmented graph (master / per-Tier / cancelled). Aucun nouveau endpoint serveur.

## 3. Design

### 3.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| Lib externe (Vis.js Timeline, Frappe Gantt, react-gantt) | Pattern existant `GrowthChart.tsx` (SVG natif) ; ajouter une dep pour un seul panneau coûte plus qu'il ne rapporte. |
| Endpoint serveur `/gantt-data?repo=X` qui pré-calcule les rows | Les ghosts sont déjà à plat dans `/ghosts` ; le rendu est purement client-side. Ajouter un endpoint pour la même donnée n'apporte rien. |
| Swimlanes toujours actifs (groupement Tier forcé) | Quand il y a peu de ghosts par tier, c'est plus de friction visuelle que d'aide. Toggle préserve les deux modes. |
| Plages temps fixes (e.g. "12 mois") | Inflexible — un projet de 3 mois ou de 3 ans aurait la même fenêtre. Window auto basé sur les dates des ghosts est plus juste. |
| Drag-to-edit dates sur les bars | Édition des plannedFor depuis l'UI : tentant mais ROADMAP.md reste le source d'édition. Drag → backend update → re-sync = trop de plumbing pour cette release. |

### 3.2 Approche retenue : SVG natif + 4 styles de bar + toggle swimlanes

#### Architecture (pure frontend)

```
upstream/gitnexus-web/src/
├── lib/gantt-layout.ts                    NEW  Pure : computeTimeWindow, computeGanttRows, dateScale
├── components/
│   ├── GanttPanel.tsx                     NEW  Container (fetch, filters, sort, swimlanes)
│   └── gantt/
│       ├── GanttAxis.tsx                  NEW  SVG ticks + labels + today line
│       ├── GanttBar.tsx                   NEW  4 kinds de bar (solid/dashed/dot/grey)
│       └── GanttRow.tsx                   NEW  Label + bars area
└── services/ghosts-client.ts              REUSE  Déjà fourni par Augmented graph

tests/
├── unit/
│   ├── gantt-layout.test.mjs              NEW
│   └── components/{GanttPanel, gantt/*}.test.tsx   NEW  (4 fichiers)
└── e2e/specs/gantt-panel.spec.ts          NEW

ROADMAP/INVENTORY/CLAUDE/tests/README       MOD
spec brainstorm-hook                        MOD  Update — Shipped section
patches/upstream-all.diff                   REGEN
```

Aucun changement serveur. Aucune nouvelle dep.

#### Data model

```ts
// lib/gantt-layout.ts

export type GanttBar = {
  kind: 'solid' | 'dashed' | 'dot' | 'grey';
  startDate: string;       // ISO
  endDate: string | null;  // null pour 'dot'
  color: string;           // tier color
};

export type GanttRow = {
  ghostId: string;
  title: string;
  tier: string | null;
  status: 'planned' | 'materialized' | 'cancelled';
  bars: GanttBar[];        // 1-2 bars par ghost selon transitions
};
```

#### Algorithme `computeGanttRows`

Pour chaque ghost (filtré par les filters) :

| Status | Bar |
|---|---|
| `materialized` (a `materializedAt`) | 1 solid bar [`plannedAt.date`, `materializedAt.date`], color tier |
| `planned`, `declared.plannedFor` parseable | 1 dashed bar [`max(plannedAt.date, today)`, `parseTargetDate(plannedFor)`], color tier |
| `planned`, pas de `plannedFor` ou unparseable | 1 dot à `plannedAt.date`, color tier |
| `cancelled` | 1 grey bar [`plannedAt.date`, `cancelledAt.date`] |

`parseTargetDate` réutilisé depuis le CORE audit module (`docker-server-ghost-audit-core.mjs` exporte `parseTargetDate`) — on l'importe ou on duplique côté frontend si l'import inter-package est complexe.

#### Algorithme `computeTimeWindow`

```ts
function computeTimeWindow(ghosts, opts = {}): { start: Date; end: Date } {
  const now = opts.now ?? new Date();
  const dates = [];
  for (const g of ghosts) {
    if (g.plannedAt) dates.push(new Date(g.plannedAt.date));
    if (g.materializedAt) dates.push(new Date(g.materializedAt.date));
    if (g.cancelledAt) dates.push(new Date(g.cancelledAt.date));
    if (g.declared?.plannedFor) {
      const t = parseTargetDate(g.declared.plannedFor);
      if (t) dates.push(t);
    }
  }
  if (dates.length === 0) {
    // Empty roadmap → show now ± 30d as a fallback
    return { start: new Date(now.getTime() - 30 * DAY), end: new Date(now.getTime() + 30 * DAY) };
  }
  const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map(d => d.getTime()), now.getTime() + 90 * DAY));
  // Pad 7 days on the left
  return { start: new Date(minDate.getTime() - 7 * DAY), end: maxDate };
}
```

#### `dateScale`

Linear scale from `[window.start, window.end]` to `[0, width]`. SVG x position = `scale(date)`. Pas de zoom interactif en v1 — la window est déterminée par les données.

#### UI components

| Composant | Responsabilité | LOC cible |
|---|---|---|
| `GanttPanel.tsx` | Fetch ghosts, applique filters, sort, swimlanes ; rend axis + rows | ~120 |
| `GanttAxis.tsx` | Ticks mensuels, labels année, ligne verticale "today" | ~50 |
| `GanttBar.tsx` | Render `<rect>` plein, dashed (via `stroke-dasharray`), dot (`<circle>`), grey ; hover tooltip | ~40 |
| `GanttRow.tsx` | Label ghost à gauche (truncated avec ellipsis si trop long) + bars area | ~30 |

#### Interactions

| Évènement | Comportement |
|---|---|
| Hover bar | Tooltip natif : title, status, duration (`materializedAt - plannedAt` ou `now - plannedAt`), slippage si applicable |
| Click bar | Si Augmented graph panel ouvert simultanément → highlight le ghost dans Sigma (via callback prop) |
| Click bouton "today" dans l'axe | Scroll horizontal pour centrer "today" |
| Toggle swimlanes | Bascule entre flat (par plannedAt ASC) et grouped (par Tier major, headers entre groupes) |
| Sort dropdown | "Planned date ASC" (default), "Tier asc", "Status" |
| Filtre Tier/Status/Cancelled | Réutilise `DEFAULT_GHOST_FILTERS` de l'Augmented graph |

#### Swimlanes (toggle)

OFF : ghosts triés selon le sort actif, 1 row par ghost.
ON : rows regroupées par Tier major (`1`, `2`, `3`, `no-tier`). Header en gras avant chaque groupe. Inside-group ordering = sort actif.

#### CSV export

Bouton dans header du panel : génère un CSV avec colonnes `ghostId, title, tier, status, plannedAt, materializedAt, cancelledAt, plannedFor, leadTimeDays`. Réutilise le pattern `?format=csv` mais côté client (pas d'endpoint dédié).

#### Tests (pyramid)

| Test | Fichier | Couvre |
|---|---|---|
| Gantt layout pure | `tests/unit/gantt-layout.test.mjs` | computeTimeWindow (4 cas), computeGanttRows (4 statuses + plannedFor formats), dateScale linéaire |
| GanttPanel | `tests/unit/components/GanttPanel.test.tsx` | render rows, filtre apply, swimlanes toggle, sort change |
| GanttAxis | `tests/unit/components/gantt/GanttAxis.test.tsx` | ticks + today line + month labels |
| GanttBar | `tests/unit/components/gantt/GanttBar.test.tsx` | 4 kinds rendered, hover tooltip text |
| GanttRow | `tests/unit/components/gantt/GanttRow.test.tsx` | label + bars area, click propagation |
| Gantt e2e | `tests/e2e/specs/gantt-panel.spec.ts` | open panel → bars visibles → toggle swimlanes → filtre tier |

## 4. Scope boundaries

**In-scope** : `gantt-layout.ts` pure fns, 4 composants React (GanttPanel + 3 sub), tests unit + e2e, ROADMAP/INVENTORY/spec wiring.

**Out-of-scope explicite** :
- Drag-to-edit dates (édite `plannedFor` depuis l'UI) — ROADMAP.md reste source.
- Zoom interactif (pinch / wheel) — window auto suffit pour v1.
- Mode mois/semaine/jour switchable — ticks mensuels fixes en v1.
- Export PNG du Gantt — out, CSV suffit.
- Cross-repo Gantt — out.
- Dépendances entre ghosts (arrows entre bars) — `dependsOn` est dans le CORE mais le rendu des arrows = future feature.

## 5. Open questions

1. **Reuse de `parseTargetDate`** : déjà implémenté côté backend dans `docker-server-ghost-audit-core.mjs`. Côté frontend, deux choix :
   (a) Importer depuis ce fichier (le frontend Vite peut résoudre les `.mjs` upstream)
   (b) Dupliquer la fn dans `gantt-layout.ts`
   **Décision** : (a) si possible, (b) sinon. Tester en impl. **Résolu pour le plan.**
2. **Swimlanes : qu'est-ce qu'on fait des ghosts no-tier ?** Un groupe "no-tier" en bas, intitulé "Sans tier". **Résolu.**
3. **CSV export client-side** : on génère le CSV en JS (pas d'appel serveur) car les données sont déjà locales. **Résolu.**
4. **Today line — quand pas de ghosts ?** Affichée quand même, dans une window fallback `now ± 30j`. **Résolu (cf. computeTimeWindow).**
5. **Sorting stable** quand 2 ghosts ont le même `plannedAt` ? Tie-break par `id` (lexico ASC). **Résolu.**

## 6. Effort estimé

**3 jours**, comparable à Augmented graph.

| Composant | Effort |
|---|---|
| gantt-layout pure fns + tests | 0.75 j |
| GanttAxis + GanttBar + GanttRow + tests | 1 j |
| GanttPanel container + filters + sort + swimlanes + tests | 0.75 j |
| E2E + wiring (ROADMAP/INVENTORY/spec/tests/README) | 0.5 j |

## 7. Suite

Plan d'implémentation via `superpowers:writing-plans`. Dernier sub-spec de la série Roadmap Predictive.

---

## Update 2026-05-26 — Time-decaying bar color (review externe)

Suite à la [review externe Gemini](2026-05-26-ghost-nodes-external-review.md) et à l'Update similaire sur [Augmented graph](2026-05-26-roadmap-predictive-augmented-graph-design.md), les bars dashed (ghosts `planned` avec `expectedBy` parseable) ne sont plus uniformément couleur-tier mais **changent de couleur selon le slippage temporel**.

### Algorithme

Réutilise `computeGhostVisualState(ghost, now)` de `lib/ghost-layout.ts` (cf Update Augmented graph). Le Gantt remplace l'attribut `color` de la bar dashed par la couleur appropriée :

| Alert level (computed par computeGhostVisualState) | Couleur du dashed bar Gantt |
|---|---|
| `fresh` | color tier normale (bleu/ambre/violet) |
| `mature` | color tier normale |
| `late` | orange `#e67e22` |
| `critical` | rouge `#c0392b` |

### Effet visuel

Sur le Gantt, un user voit immédiatement quels ghosts sont en retard : la bar dashed devient orange puis rouge à mesure que la deadline est dépassée. Ça crée la même pression visuelle que sur le graph Sigma, avec une vue calendaire.

### Test additionnel

`tests/unit/gantt-layout-decay.test.mjs` — vérifie que la couleur du bar dashed pour un ghost `late` est `#e67e22` et pour `critical` est `#c0392b`.

### Effort additionnel

**~0.2 jour** : impl + test. Le calcul `computeGhostVisualState` est déjà spec'é dans Augmented graph et réutilisable côté Gantt.

---

## Update 2026-05-27 — Shipped

Gantt opérationnel livré. Notes :

- Pure frontend (zéro backend modifié). Consomme `/ghosts?repo=X` du CORE via `ghosts-client.ts` partagé avec Augmented graph.
- 4 styles de bar : solid (matérialisé), dashed (planifié futur via `parseTargetDate` du module shared), dot (planifié sans deadline), grey (annulé).
- Update 1 (time-decaying bar color) implémentée : `late` → orange #e67e22, `critical` → rouge #c0392b. Réutilise `computeGhostVisualState` du `ghost-layout.ts` d'Augmented graph.
- Toggle swimlanes (flat vs Tier major), sort dropdown (plannedAsc/tierAsc/status), CSV export client-side via Blob download.
- Pattern SVG natif (cohérent avec GrowthChart.tsx + Augmented graph) — aucune nouvelle dep.
- Filters : `ghostFilters?` prop ; consumer passe le state. Default panel-local (`showGhosts: true, showCancelled: true`) — pour rendre le panel utilisable standalone.
- Tests : 1 layout + 1 decay + 4 components + 1 e2e. Runtime local Node 21 bloqué (vitest 4.x), CI Node 22.
- 5 open questions du spec toutes résolues comme prévu.

