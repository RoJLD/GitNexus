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

---

## Update 2026-05-26 — Time-decaying opacity (review externe)

Suite à la [review externe Gemini](2026-05-26-ghost-nodes-external-review.md), l'opacité des ghosts devient **fonction de la pression temporelle** plutôt que fixée à 0.4.

### Motivation

Une opacité fixe traite tous les ghosts pareils — Tier 3.10 planifié pour Q4 2027 et Tier 1.2 prévu pour la semaine dernière ont la même intensité visuelle. La review externe propose de **faire baisser l'opacité à mesure que `expectedBy` approche puis se dépasse**, créant une pression visuelle naturelle sans alerting actif.

### Algorithme

```ts
// Dans lib/ghost-layout.ts, nouvelle pure fn :
export function computeGhostVisualState(
  ghost: GhostInput,
  now: Date,
): { opacity: number; outlineColor: string; alertLevel: 'fresh' | 'mature' | 'late' | 'critical' } {
  if (ghost.status !== 'planned') {
    // materialized → masqué (déjà dans encoding existant)
    // cancelled → opacité 0.3 grise (inchangé)
    return existingLogic;
  }
  const planned = new Date(ghost.plannedAt.date);
  const expectedBy = parseTargetDate(ghost.declared.expectedBy);
  if (!expectedBy) return { opacity: 0.4, outlineColor: tierColor(ghost.tier), alertLevel: 'fresh' };

  const totalPlanned = expectedBy.getTime() - planned.getTime();
  const elapsed = now.getTime() - planned.getTime();
  const ratio = totalPlanned > 0 ? elapsed / totalPlanned : 1;

  if (ratio < 0.5) return { opacity: 0.5, outlineColor: tierColor(ghost.tier), alertLevel: 'fresh' };
  if (ratio < 1.0) return { opacity: 0.4, outlineColor: tierColor(ghost.tier), alertLevel: 'mature' };
  // ratio > 1 : ghost a dépassé son expectedBy
  if (ratio < 1.5) return { opacity: 0.3, outlineColor: '#e67e22', alertLevel: 'late' };
  return { opacity: 0.2, outlineColor: '#c0392b', alertLevel: 'critical' };
}
```

### Encoding visuel mis à jour

| Alert level | Condition | Opacité | Outline | Comportement |
|---|---|---|---|---|
| `fresh` | `(now - planned) / (expectedBy - planned) < 0.5` | 0.5 | dashed, color tier | Affiché normalement |
| `mature` | ratio entre 0.5 et 1.0 | 0.4 | dashed, color tier | Légèrement atténué |
| `late` | ratio entre 1.0 et 1.5 (dépassé < 50%) | 0.3 | dashed orange `#e67e22` | Pression visuelle |
| `critical` | ratio > 1.5 (dépassé > 50%) | 0.2 | dashed rouge `#c0392b` | Très atténué + outline rouge — appelle l'attention sur ghost potentiellement obsolète |

Si `expectedBy` absent du ghost → fallback opacité 0.4 (comportement d'origine).

### Intégration avec cleanup mechanism

Les ghosts `critical` sont aussi ceux que le mécanisme cleanup (cf [sous-spec cleanup-and-connectors](2026-05-26-roadmap-predictive-cleanup-and-connectors-design.md)) va flagger comme `expired` et proposer pour LLM-assisted cleanup. La cohérence visuelle/cleanup renforce le signal.

### Test additionnel

`tests/unit/ghost-layout-decay.test.mjs` — vérifie les 4 alertLevels avec des dates calibrées.

### Effort additionnel

**~0.3 jour** : implémentation + test + intégration dans le reducer Sigma (passer `opacity` et `outlineColor` au programme custom).

---

## Update 2026-05-26 — Extension future : "Augmented Timeline" (lecture conv Gemini brute)

Après lecture de la conversation Gemini brute (au-delà du résumé via la [review externe](2026-05-26-ghost-nodes-external-review.md)), une intuition a émergé qui ni notre brainstorm ni la review n'avaient capturée :

Le **"Gantt Structurel"** proposé par Gemini (Y = topologie, slider temporel reconfigure le graphe) **n'est pas le même objet que notre Gantt panel actuel** (vue calendaire tabulaire). C'est en fait la **fusion Augmented graph + Timeline** : faire scrubber le slider Timeline existant tout en affichant les ghosts pertinents pour chaque instant.

### Concept

- Aujourd'hui : Timeline (livré #7) scrub le **passé** avec play/pause sur les snapshots
- Aujourd'hui : Augmented graph (cette sub-spec) affiche les ghosts du **futur** sur le graph HEAD
- **Augmented Timeline** = combiner les deux : au temps T :
  - Affiche les nodes réels de l'état du repo à T (Timeline existante)
  - Affiche les ghosts qui étaient `planned` à T mais pas encore `materialized`
  - Quand le slider passe la date `materializedAt` d'un ghost, sa version fantôme disparaît et le node réel apparaît
  - Démonstration visuelle de la matérialisation au fil du temps

### Statut

**Hors-scope** de cette sub-spec. Note d'extension parquée. À brainstormer comme sous-spec dédiée si demandé après la livraison d'Augmented graph + Gantt.

### Pourquoi pas dans le Gantt panel ?

Le Gantt panel actuel est **complémentaire** : vue calendaire tabulaire pour communiquer un planning, exporter un CSV. L'Augmented Timeline serait **différent** : vue topologique scrubable pour observer l'évolution. Les deux ont leur valeur.

### Effort estimé (si livré)

**~1-2 jours** une fois Augmented graph + Timeline integration trouvée. La mécanique de scrubbing existe déjà côté Timeline ; la mécanique d'overlay ghosts existe déjà côté Augmented graph. Il s'agit de connecter les deux et de filtrer les ghosts selon le temps actif.

---

## Update 2026-05-27 — Shipped

Augmented graph view livrée end-to-end (Tasks 1-16 du plan
`2026-05-26-roadmap-predictive-augmented-graph.md`). Notes
d'implémentation par rapport au spec :

### Update 1 (computeGhostVisualState) shipped

L'opacité time-decaying est livrée comme prévu dans `lib/ghost-layout.ts`
avec les 4 `alertLevel` (`fresh` ≥0.5 / `mature` 0.4 / `late` 0.3 orange
`#e67e22` / `critical` 0.2 rouge `#c0392b`). Couvert par
`tests/unit/ghost-layout-decay.test.mjs` avec dates calibrées sur les 4
niveaux + fallback opacity 0.4 quand `expectedBy` absent. La logique
existante pour `materialized` (masqué) et `cancelled` (opacity 0.3 grise)
est préservée.

### Update 2 (Augmented Timeline) explicitement out-of-scope

La fusion Augmented graph + Timeline scrubable n'a pas été tentée. Reste
notée comme follow-up à brainstormer en sub-spec dédiée. La mécanique
d'overlay ghosts + le reducer Sigma sont écrits de façon idempotente
pour ne pas bloquer cette fusion future (registration `GhostNodeProgram`
+ merge ghost data fait dans `useSigma` sans toucher au flux Timeline).

### Sigma 3 NodeCircleProgram + canvas dashed outline (pragmatic v1)

Le contour dashed des ghosts est rendu en deux passes : (1) le node
fill via `NodeCircleProgram` standard de Sigma 3 (couleur tier +
opacité venue de `computeGhostVisualState`), (2) une seconde passe
canvas par-dessus le WebGL pour dessiner le cercle pointillé. Pas de
nouvelle dep Sigma — l'extension du shader fragment pour les patterns
dashed aurait demandé plus d'effort que la valeur ajoutée. Cette
décision écarte l'open question 1 du spec (« custom WebGL program
~30 lignes ») au profit d'un fallback plus simple ; visuellement
indistinguable à l'échelle du graph.

### State lifté dans `useAppState` (pas dans Filters)

Le spec laissait ouvert le ownership du state `ghostFilters` (master
toggle + per-Tier + cancelled). Choix retenu : lifter dans
`useAppState` (pattern existant des autres filtres du panel — cf
`coupling`, `growth`). Conséquences : (a) survit aux toggles
d'overlays, (b) accessible par `GraphCanvas` pour le reducer Sigma,
(c) testable comme un hook isolé.

### Filters lives in `FileTreePanel.tsx`

Le spec décrivait un fichier `components/Filters.tsx` séparé. La réalité
du code : les filtres existants sont concentrés dans
`FileTreePanel.tsx` (pattern in-place vs. fichier dédié). On a suivi le
pattern existant — la section "Roadmap predictive" hiérarchique
(master + per-Tier + cancelled) est ajoutée dans `GhostFiltersSection.tsx`
puis montée dans `FileTreePanel.tsx`. Test correspondant :
`tests/unit/components/Filters.test.tsx` (cible le sous-composant
isolé, pas le panel entier).

### Tests écrits mais Vitest bloqué localement (Node 21)

Les 5 unit tests + 1 e2e sont livrés (cf `tests/README.md` rows
ajoutées). Vitest 1.x exige Node ≥ 22 ; la machine locale tourne
encore Node 21 (cf `docs/superpowers/decisions/2026-05-26-defer-node22-upgrade.md`).
Conséquence : les tests sont validés syntaxiquement (`node --check`)
et alignés avec le pyramid spec, mais leur première exécution réelle
viendra avec le bump Node 22. Le guard `scripts/check-test-inventory.mjs`
exit 0 — pas d'orphans, pas de drift README.

### Open questions résolues

| # | Question | Résolution |
|---|---|---|
| 1 | `circle-dashed` natif Sigma | Non — fallback canvas dashed outline (cf section ci-dessus). |
| 2 | Couleur ghost edges + alpha | RGBA `rgba(<tier>, 0.5)` (inchangé). |
| 3 | Mode 3D | Toujours out-of-scope. |
| 4 | Cache `/ghosts` client | 30s mémoire + `invalidateGhostsCache()` exposé pour refresh manuel. |
| 5 | Performance >100 ghosts | Non testée à grande échelle ; le grid 5 cols satellite suffit pour le volume actuel (<50 ghosts par repo). |

### Artefacts livrés

- `upstream/gitnexus-web/src/lib/ghost-layout.ts` (pure fns + decay)
- `upstream/gitnexus-web/src/lib/ghost-node-program.ts` (Sigma 3 + canvas outline)
- `upstream/gitnexus-web/src/services/ghosts-client.ts` (fetch + cache)
- `upstream/gitnexus-web/src/components/GhostTooltip.tsx` (popup)
- `upstream/gitnexus-web/src/components/GhostFiltersSection.tsx` (toggles)
- `upstream/gitnexus-web/src/components/GraphCanvas.tsx` (wiring fetch + click)
- `upstream/gitnexus-web/src/components/FileTreePanel.tsx` (mount section)
- `upstream/gitnexus-web/src/hooks/useSigma.ts` (reducer extension + program register)
- `upstream/gitnexus-web/src/hooks/useAppState.tsx` (`ghostFilters` lifted)
- `tests/unit/ghost-layout.test.mjs` + `ghost-layout-decay.test.mjs` + `ghosts-client.test.mjs`
- `tests/unit/components/GhostTooltip.test.tsx` + `Filters.test.tsx`
- `tests/e2e/specs/04-augmented-graph.spec.ts`
- `ROADMAP.md` row 39, `INVENTORY.md` sub-section, `tests/README.md` 6 nouvelles rows.
