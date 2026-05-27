# Timeline Zoom + 2 Cursors A/B (with Diff Mode) — Design

**Date** : 2026-05-27
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Phase** : 1 sur 2 (Phase 2 = filtre du graphe à la fenêtre temporelle, parquée)
**Depends on** : Timeline.tsx existant (slider + play/pause), `lib/graph-diff.ts` (déjà livré pour cross-repo)
**Adjacent** : [Gantt opérationnel](2026-05-26-roadmap-predictive-gantt-design.md) — partage le concept d'axe temporel mais sur les ghosts (planned tasks) plutôt que sur les snapshots ; aucune collision de fichier.

---

## 1. Context / problem

La `Timeline.tsx` actuelle affiche tous les snapshots du repo actif sur un axe horizontal à espacement linéaire par date, avec un slider unique (clic = "load this snapshot") et un bouton Play/Pause qui anime à 2s/frame.

Limites du modèle actuel :
- **Résolution dans une période dense** : sur un repo de 2 ans avec un sprint d'1 semaine où tout s'est passé, les snapshots de ce sprint sont visuellement compressés. L'utilisateur ne peut pas zoomer pour examiner ce moment précis.
- **Comparaison A↔B** : actuellement, comparer deux snapshots du même repo demande d'utiliser le panneau "Diff visuel" qui prend deux *repos* (cross-repo). Il n'existe pas de chemin direct "diff entre ce snapshot et celui-là" intra-repo.
- **Pas de contrôle de fenêtre** : impossible de dire "concentre-toi sur janvier-mars" sans cliquer snapshot par snapshot.

## 2. Goal

Étendre la Timeline avec :
1. **Deux curseurs A et B** drag-and-droppables, définissant une fenêtre [A, B] sur la chronologie.
2. **Zoom** : un bouton "Zoom to window" stretche le rendu de la timeline pour que la fenêtre [A, B] occupe toute la largeur ; "Zoom out" revient à la vue complète. Une mini-map collapsible reste visible pour préserver le contexte global pendant le zoom.
3. **Mode `diff`** : un toggle "Compare A↔B" qui déclenche le rendu diff rouge/vert/gris entre les snapshots aux curseurs A et B, en réutilisant le pipeline `lib/graph-diff.ts` qui sert déjà le mode cross-repo.

Le panneau Lifespan reste **global** (acquis du brainstorm) — il continue à classifier sur toute l'histoire, indépendamment de la fenêtre [A, B].

## 3. Decisions cadres (validées en brainstorm)

| Décision | Choix retenu | Raison |
|---|---|---|
| Scope Phase 1 | A (zoom) + B (compare 2 curseurs) | Garde la scope manageable à ~2 semaines. C (filtre graphe à la fenêtre) parqué en Phase 2. |
| Mode du graphe | Toggle `graphMode: 'single' \| 'diff'` | En `single`, le graphe suit B (curseur de droite). En `diff`, le graphe = diff visuel A→B. Évite l'ambiguïté "le graphe affiche A ou B ?". |
| Lifespan | Reste global | Pas de recalcul à chaque scrub. Simplifie la coordination panneau↔graphe. |
| Mini-map | Visible par défaut, collapsible | Préserve le contexte global pendant le zoom sans surcharger. |
| Cursor swap | Auto-swap si A > B | Sémantique stable : A toujours ≤ B. |

## 4. Design

### 4.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| Brush selection D3-style (drag pour définir [A,B] en un geste) | Plus joli mais cache la sémantique : on perd la notion de "curseur A indépendant du curseur B" qu'on veut pour ergonomie drag-individuel + auto-swap |
| Zoom continu via mousewheel (pinch-zoom-style) | Sur-engineered v1 ; le bouton "Zoom to window" déclenchable est plus prévisible et discoverable. Reconsidérer en v2 si feedback utilisateur. |
| Mode `union` (afficher tous les nodes nés ou vivants dans [A,B]) | C'est la Phase 2 (C dans le brainstorm). Demande un endpoint backend pour calcul lifespan-window-aware. |
| Réutiliser le slider unique en mode "shift+click pour ajouter cursor B" | Moins discoverable. 2 curseurs visibles par défaut est plus clair. |
| Endpoint serveur `/diff-snapshots?repo=X&a=sha&b=sha` | Pas nécessaire — `lib/graph-diff.ts` calcule déjà le diff client-side à partir des nodes des 2 snapshots fetchés via `/api/graph`. Réutilisable tel quel. |

### 4.2 Approche retenue : 2 curseurs SVG + zoom logique + graphMode toggle

#### Architecture

```
upstream/gitnexus-web/src/
├── lib/
│   ├── timeline-zoom.ts                  NEW  Pure fns : computeZoomWindow, mapDateToPosition, mapPositionToDate, snapToNearestSnapshot
│   └── graph-diff.ts                     MOD  Helper `diffBetweenSnapshots(snapA, snapB)` qui wrap la logique cross-repo existante sur 2 snapshots du même repo
├── components/
│   └── Timeline.tsx                      MOD  Render 2 curseurs SVG (triangles A bleu / B orange), drag handlers, zoom buttons, "Compare A↔B" toggle, mini-map collapsible quand zoomed
└── hooks/
    └── useAppState.tsx                   MOD  Ajout state { cursorA: string|null, cursorB: string|null, zoomWindow: {a, b}|null, graphMode: 'single' | 'diff' } + actions setCursorA (auto-swap A≤B), setCursorB (idem), enterZoom, exitZoom, setGraphMode. NOTE : ne pas confondre `graphMode='diff'` (intra-repo cursor diff, ce design) avec `diffMode` boolean existant (cross-repo diff, item #3 du ROADMAP — coexiste, voir Data model § Relation).
```

```
tests/
├── unit/
│   ├── timeline-zoom.test.mjs                       NEW  computeZoomWindow + map fns + edge cases
│   └── components/Timeline.test.tsx                 MOD  Extend pour 2 curseurs, drag, zoom toggle, diff toggle
└── e2e/specs/timeline-zoom-and-diff.spec.ts         NEW  Scénario complet hmm_studio

ROADMAP.md / INVENTORY.md / CLAUDE.md / tests/README.md   MOD
patches/upstream-all.diff                                  REGEN
```

Aucun changement serveur. Aucune nouvelle dep.

#### Data model

```ts
// hooks/useAppState.tsx — additions
interface TimelineZoomState {
  cursorA: string | null;        // shortHash du snapshot, null = "start of timeline"
  cursorB: string | null;        // shortHash du snapshot, null = "live"
  zoomWindow: { a: string; b: string } | null;  // null = zoom out (vue complète)
  graphMode: 'single' | 'diff';  // 'single' : graphe = snapshot at cursorB ; 'diff' : graphe = diff(snapA, snapB)
}
```

**Relation avec le `diffMode` existant** (cross-repo, item #3 du ROADMAP) :
- `diffMode` (boolean, déjà présent) reste réservé au diff **cross-repo** (deux repos différents).
- `graphMode === 'diff'` (nouveau, ce design) déclenche un diff **intra-repo** entre 2 snapshots du même repo aux curseurs A et B.
- Ils sont **mutuellement exclusifs** : entrer dans l'un sort de l'autre :
  - `setGraphMode('diff')` appelle `exitDiffMode()` si `diffMode === true` avant d'activer le nouveau mode
  - `enterDiffMode()` (le cross-repo existant) appelle `setGraphMode('single')` avant d'activer le mode cross-repo
- Le pipeline de coloring rouge/vert/gris dans `useSigma.ts` est partagé (les deux modes alimentent le même reducer), mais la **source des données** diffère (2 repos vs 2 snapshots du même repo).

```ts
// lib/timeline-zoom.ts
export type DateRange = { startISO: string; endISO: string };

export function computeZoomWindow(
  cursorADate: string,
  cursorBDate: string
): DateRange;
// Retourne { startISO: min(A,B), endISO: max(A,B) } — auto-swap si inversé

export function mapDateToPosition(
  date: string,
  window: DateRange,
  pixelWidth: number
): number;
// Position pixel dans [0, pixelWidth] pour une date donnée

export function mapPositionToDate(
  position: number,
  window: DateRange,
  pixelWidth: number
): string;
// ISO date à partir d'une position pixel (drag handler)

export function snapToNearestSnapshot(
  date: string,
  snapshots: { date: string }[]
): string;
// Le drag continue mais on snap au snapshot le plus proche au release
```

#### Interaction model

**État initial** (load du repo) :
- `cursorA` = snapshot le plus ancien (ou `null` = start of timeline)
- `cursorB` = `'live'` (head index)
- `zoomWindow` = `null` (vue complète)
- `graphMode` = `'single'` (graphe affiche `cursorB`, comportement actuel inchangé)

**User drag cursor B** (mode `single`) :
1. Drag déclenche `setCursorB(positionToDate(x))` à chaque mousemove
2. Au mouseup, `snapToNearestSnapshot` ajuste à la date du snapshot le plus proche
3. `App.tsx` réagit au changement de `cursorB` → switche au snapshot correspondant via la logique existante (`switchToSnapshot`)
4. Le graphe re-fetch normalement

**User clique "Zoom to window"** :
1. `setZoomWindow({ a: cursorA, b: cursorB })`
2. Timeline re-render avec `pixelWidth` mappant exclusivement la fenêtre [A, B] — les snapshots hors fenêtre disparaissent de la rangée principale
3. Mini-map (barre fine de 12-16px de haut, au-dessus de la timeline principale) reste affichée avec tous les snapshots, et une zone surlignée représentant la fenêtre zoomée
4. Bouton "Zoom out" devient visible et restaure `zoomWindow = null`

**User clique "Compare A↔B"** :
1. `setGraphMode('diff')`
2. `App.tsx` détecte le changement → fetch les nodes des snapshots A et B en parallèle
3. `lib/graph-diff.ts::diffBetweenSnapshots(snapA, snapB)` produit `{ added: [...], removed: [...], unchanged: [...] }`
4. Le reducer Sigma applique le coloring rouge/vert/gris (même chemin que cross-repo aujourd'hui)
5. Cliquer "Exit compare" → `setGraphMode('single')` revient au snapshot `cursorB`

#### UI / SVG layout

```
┌─ Mini-map (visible only when zoomed) ─────────────────────────────┐
│ ━━●━━━━●━━━━●━●●━━━━━━●━━━━●━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━●━━━━ │
│         └─── zoom window highlight ───┘                            │
└────────────────────────────────────────────────────────────────────┘
┌─ Timeline ─────────────────────────────────────────────────────────┐
│            ▼ A                                              ▼ B    │
│ ━━━━━━━━━━━━━━━━━━━●━━━━━━━●━━━━━━━●━━━━━━━●━━━━━━━●━━━━━━━●━━━━━ │
│            └ a8f3                                          live ┘  │
└────────────────────────────────────────────────────────────────────┘
[Play] [Pause] [Zoom to window] [Compare A↔B]
```

- **Curseur A** : triangle bleu (▼ pointe vers le bas), positionné au-dessus de la rangée de dots
- **Curseur B** : triangle orange, idem côté droit
- **Drag** : mousedown sur le triangle, mousemove pour faire glisser, mouseup pour snap au snapshot le plus proche
- **Mini-map** : barre fine SVG au-dessus, snapshots à pleine résolution chronologique, fenêtre zoomée en highlight (overlay semi-transparent)
- **Boutons** : à côté des contrôles play/pause existants. "Zoom to window" devient "Zoom out" quand zoom actif. "Compare A↔B" devient "Exit compare" quand mode diff actif.

### 4.3 Edge cases

| Cas | Comportement |
|---|---|
| Repo avec 0 ou 1 snapshot | Feature désactivée silencieusement (même condition que play/pause actuel : la timeline est cachée si pas d'historique navigable) |
| Cursors A > B après drag | Auto-swap dans le setter (`setCursorA` et `setCursorB` enforcent A ≤ B avant commit du state) |
| Cursor B == cursor A en mode diff | Diff vide (rien d'added/removed) — UI affiche un message "Cursors are at the same snapshot" |
| Fenêtre zoomée avec < 2 snapshots dedans | Le bouton "Zoom to window" affiche un toast "Sélectionne au moins 2 snapshots" et ne déclenche pas le zoom |
| Snapshot manquant entre A et B en mode diff | Pas un cas — diff prend directement les nodes des snapshots aux curseurs, indépendamment de ce qu'il y a entre |
| Mode diff activé puis user drag cursor B | Le diff se recalcule **au release du drag (mouseup)**, pas en continu pendant le mousemove. Indicateur de loading visible pendant le re-fetch + re-color. Performance : OK tant que les snapshots font < 5k nodes (cf scope Web UI dans INVENTORY) |
| Cross-repo `diffMode` actif puis user clique "Compare A↔B" | `setGraphMode('diff')` appelle automatiquement `exitDiffMode()` avant d'activer le mode cursor-diff. Réciproquement : entrer dans cross-repo diff via Header force `setGraphMode('single')`. Évite l'état double-diff incohérent. |
| Repo switch pendant zoom actif | `zoomWindow` reset à `null`, `graphMode` reset à `'single'`, curseurs réinitialisés au défaut |

## 5. Testing strategy

### Unit (Vitest, pure)

`tests/unit/timeline-zoom.test.mjs` :
- `computeZoomWindow` : 2 dates normales, dates inversées (auto-swap), dates égales
- `mapDateToPosition` : début/milieu/fin de la fenêtre, hors fenêtre (saturate au bord)
- `mapPositionToDate` : inverse du précédent, vérifier round-trip
- `snapToNearestSnapshot` : snapshot exact, entre deux snapshots, hors range

### Component (Vitest + jsdom + @testing-library/react)

`tests/unit/components/Timeline.test.tsx` (étendu) :
- 2 curseurs rendus quand snapshots présents
- Drag cursor B met à jour le state (via mock useAppState)
- Click "Zoom to window" met `zoomWindow` à `{a, b}` et affiche la mini-map
- Click "Compare A↔B" met `graphMode='diff'` et change le label du bouton
- Click "Exit compare" revert à `graphMode='single'`
- Hidden quand `snapshots.length < 2`

### E2E (Playwright)

`tests/e2e/specs/timeline-zoom-and-diff.spec.ts` :
1. Load `hmm_studio` (auto-référence ou fixture)
2. Attendre que la timeline soit visible avec au moins 5 snapshots
3. Drag cursor A vers le 2e snapshot
4. Drag cursor B vers l'avant-dernier snapshot
5. Click "Zoom to window" → vérifier que la mini-map devient visible (DOM-based)
6. Click "Compare A↔B" → vérifier que le graph contient des couleurs added (vert) / removed (rouge) via inspection du DOM Sigma reducer state
7. Click "Exit compare" → vérifier le retour au mode single
8. Click "Zoom out" → vérifier que la mini-map disparaît

## 6. Out of scope (Phase 2)

Ces items sont reportés à une future itération une fois Phase 1 livrée et validée :

- **Filtre temporel sur le graphe** : cacher les nodes nés avant `cursorA` ou supprimés après `cursorB`.
- **Mode `union`** : afficher tous les nodes qui ont vécu à un moment dans [A, B] (demande un endpoint backend `/nodes/alive-between?a=&b=` ou un calcul client lourd).
- **Lifespan fenêtré** : recalculer les buckets `foundational/recent/discontinued/ephemeral` sur la fenêtre [A, B] au lieu de toute l'histoire.
- **Zoom continu via mousewheel** : envisageable si feedback utilisateur indique que le bouton est insuffisant.
- **Sauvegarde de la fenêtre dans l'URL** : permet de partager un lien "regarde gitnexus à cette fenêtre temporelle".

Ces extensions ne demandent **pas** de refacto rétrograde de la Phase 1 si la séparation `lib/timeline-zoom.ts` pure / `useAppState` state est respectée.

## 7. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| Drag cursor lag sur grosse timeline (1000+ snapshots) | Moyen | Throttle du `mousemove` à 16ms (60fps) ; snap au release (pas en continu) |
| Mode diff re-fetch coûteux à chaque drag de B | Moyen | Le diff ne se déclenche qu'**au release** du drag (mouseup), pas en continu. Indicateur de loading visible pendant le diff. |
| Conflit avec le bouton Play/Pause actuel quand cursor B bouge | Faible | Play/Pause continue à itérer sur les snapshots **dans la fenêtre zoomée** quand `zoomWindow !== null`, sinon comportement actuel. Documenté en UI hint. |
| Compatibilité avec les autres modes (churn, coupling, growth, lifespan, ownership) | Moyen | Le mode `diff` est exclusif (mêmes patterns que les autres modes existants — voir le `exitXxxMode` qu'on appelle déjà). `setGraphMode('diff')` désactive automatiquement les autres modes actifs. |
| Mini-map qui prend de l'espace vertical permanent | Faible | Collapsible avec une chevron + state persisté en localStorage |
| Tests E2E flaky sur la couleur diff (rendu Canvas/Sigma) | Moyen | Tester via DOM/reducer state expose, pas via screenshot pixel (pattern déjà utilisé pour le diff cross-repo) |

## 8. Effort estimate

| Phase | Tâches | Effort |
|---|---|---|
| Bootstrap | Créer `lib/timeline-zoom.ts` (pure) + unit tests | ~1-2j |
| State | Ajouter `cursorA/B/zoomWindow/graphMode` dans `useAppState` + setters avec auto-swap | ~1j |
| UI Timeline | Render 2 curseurs SVG + drag handlers + boutons Zoom / Compare | ~3-4j |
| Mini-map | Render barre fine + highlight de la fenêtre | ~1-2j |
| Diff intra-repo | `diffBetweenSnapshots` helper + wire dans `graphMode='diff'` | ~2-3j |
| Component tests | Extend `Timeline.test.tsx` | ~1j |
| E2E test | Nouveau spec Playwright | ~1j |
| Doc | ROADMAP, INVENTORY, tests/README, CLAUDE.md smoke loop | ~½j |
| **Total** | | **~10-14 jours** (≈ 2 semaines selon focus) |

## 9. Document updates checklist

À effectuer lors de la livraison :
- `ROADMAP.md` : ajouter ligne dans "Déjà livré" + bump date header
- `INVENTORY.md` : Partie B.2 (composants frontend) — mentionner les 2 curseurs, mode diff intra-repo
- `tests/README.md` : ajouter les nouveaux tests à l'inventaire
- `CLAUDE.md` : pas de nouveau endpoint backend, donc smoke loop inchangé
- `patches/upstream-all.diff` : regenerate

---

## 10. Open questions for review

Aucune — toutes les décisions cadres ont été validées en brainstorm. Si quelque chose mérite challenge :
- Positionnement des couleurs des curseurs (bleu/orange) — UX preference
- Faut-il un raccourci clavier pour "Compare A↔B" (e.g., `Shift+D`) ?
- Faut-il afficher la durée de la fenêtre [A, B] sous la timeline ("2 weeks, 14 snapshots") ?

Ces 3 questions peuvent être tranchées au moment de l'implem ou différées à v1.1.
