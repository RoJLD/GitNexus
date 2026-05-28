# Timeline Wheel Zoom (mousewheel) — Design

**Date** : 2026-05-28
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Phase** : Phase 2 Item #4 sur 5 — **dernier item Phase 2**
**Depends on** : Phase 1 zoom + curseurs A/B (`lib/timeline-zoom.ts`, `Timeline.tsx`, state `cursorA/B/zoomWindow/graphMode` dans `useAppState`) — voir [2026-05-27-timeline-zoom-cursors-design.md](2026-05-27-timeline-zoom-cursors-design.md)
**Adjacent** : Timeline URL Persistence (Item #5, déjà livré) — capture l'état zoomé via `tlA`/`tlB`/`tlZoom`. Ce design n'y touche pas (voir § 6).

---

## 1. Context / problem

La Phase 1 a livré un zoom **binaire** déclenché par un bouton : "Zoom to window" stretche la fenêtre `[cursorA, cursorB]` sur toute la largeur, "Zoom out" revient à la vue complète. Le zoom continu à la molette avait été explicitement **parqué** en Phase 1 (cf design Phase 1 § 4.1 et § 6 : « Sur-engineered v1 ; reconsidérer en v2 si feedback utilisateur »).

Limite du modèle actuel : pour examiner une période dense, l'utilisateur doit d'abord déplacer les deux curseurs à la main puis cliquer le bouton. Il n'y a pas de geste d'exploration rapide « rapproche-moi ici » sur l'axe temporel, contrairement à n'importe quelle carte ou éditeur de timeline.

## 2. Goal

Ajouter un **zoom continu à la molette** sur la Timeline, ancré sur la position de la souris, qui rapproche/écarte progressivement les curseurs A et B (donc la fenêtre `[A, B]`). Le geste entre et sort du zoom tout seul. Pure frontend, aucun endpoint, aucun nouvel état dans `useAppState`.

Succès = l'utilisateur scrolle vers le haut au-dessus d'un instant dense → la timeline se magnifie autour de cet instant, les curseurs convergent, et au repos le graphe se recalcule sur la fenêtre snappée aux snapshots. Scroll complet vers le bas → retour à la vue complète.

## 3. Décisions cadres (validées en brainstorm 2026-05-28)

| Décision | Choix retenu | Raison |
|---|---|---|
| Modèle de zoom | **Couplé aux curseurs** — la molette pilote la fenêtre `[cursorA, cursorB]` existante, pas un `viewWindow` indépendant | Réutilise tout l'état + le pipeline curseur→graphe de la Phase 1. Pas de nouveau concept ni de nouvelle persistance. La molette = un moyen rapide de bouger les deux curseurs d'un coup. |
| Mécanique | **Ancré sur la souris + auto enter/exit** | Le snapshot sous le curseur reste fixe ; A et B convergent autour. Scroll-in depuis la vue complète entre en zoom ; scroll-out complet sort (zoomWindow→null). Comportement « carte » standard, le plus intuitif. |
| Granularité | **Continu, snap au repos** | Facteur de zoom lisse par tick (~exp(deltaY·k)) ; les curseurs glissent entre snapshots pendant le scroll, puis snappent au snapshot le plus proche quand le scroll se stabilise (debounce ~200ms). Recompute graphe une seule fois, au repos. |
| Architecture | **Approche 1 — état transitoire dans Timeline + commit-on-settle** | La rafale d'événements wheel reste locale à `Timeline.tsx` + une pure fn. `useAppState` (fichier chaud ~2900 lignes) reçoit **une seule** modification chirurgicale rétro-compatible : `enterZoom` accepte des bornes explicites optionnelles (cf § 4.1 bis). Sinon, seuls ses setters existants sont appelés au repos. |
| Bouton + raccourci `Z` | **Conservés** | "Zoom to window" + `Z` restent le chemin un-clic. La molette est additive, pas un remplacement. |

### Alternatives écartées

| Alternative | Pourquoi écartée |
|---|---|
| `viewWindow` indépendant des curseurs (vrai pan/zoom découplé) | Plus « correct » conceptuellement mais ajoute un état séparé + sa propre persistance URL + réconcilier le bouton existant. Sur-dimensionné pour le besoin « examiner une période dense ». Couplage rejeté en faveur de la simplicité (choix utilisateur). |
| Pilotage des curseurs en direct à chaque tick + debounce du diff dans `useAppState` (Approche 2) | Spamme `setState` des curseurs et pousse un debounce dans le fichier chaud `useAppState`. Plus invasif et plus de churn de re-render. |
| Zoom snapshot-stepped (1 snapshot par tick, discret) | Rejeté au profit du continu-glide-snap-at-rest pour un feel plus fluide (choix utilisateur). |

## 4. Design

### 4.1 Fichiers

```
upstream/gitnexus-web/src/
├── lib/timeline-zoom.ts            MOD  + pure fn applyWheelZoom(...)
├── components/Timeline.tsx         MOD  wheel listener non-passif, fenêtre transitoire, settle debounce
├── hooks/useAppState.tsx           MOD  enterZoom accepte des bornes explicites optionnelles (§ 4.1 bis)
└── config/ui-constants.ts          MOD  + constantes WHEEL_ZOOM_SENSITIVITY, WHEEL_ZOOM_MIN_SPAN_MS, WHEEL_ZOOM_SETTLE_MS

tests/
├── unit/timeline-zoom.test.mjs                 MOD  cas applyWheelZoom
├── unit/components/Timeline.test.tsx           MOD  wheel → transient → settle → setters
└── e2e/specs/timeline-zoom-and-diff.spec.ts    MOD  scénario wheel up/down

ROADMAP.md / INVENTORY.md / tests/README.md     MOD
patches/upstream-all.diff                        REGEN
```

Aucun changement serveur. Aucune nouvelle dépendance.

### 4.1 bis — Extension de `enterZoom` (fix stale-closure)

`enterZoom` actuel lit `cursorA`/`cursorB` depuis sa closure :

```ts
const enterZoom = useCallback(() => {
  if (cursorA === null || cursorB === null) return;
  setZoomWindow({ a: cursorA, b: cursorB });
}, [cursorA, cursorB]);
```

Problème : au settle, on appelle `setCursorA(startSnap)` + `setCursorB(endSnap)` **puis** `enterZoom()`. Comme les `setState` ne sont pas encore flushés, `enterZoom()` lirait les **anciens** curseurs et zoomerait sur la mauvaise fenêtre (même piège que le zoom-restore du hook URL Item #5).

Fix rétro-compatible : `enterZoom` accepte des bornes explicites optionnelles.

```ts
const enterZoom = useCallback((aISO?: string, bISO?: string) => {
  const a = aISO ?? cursorA;
  const b = bISO ?? cursorB;
  if (a === null || b === null) return;
  setZoomWindow({ a, b });
}, [cursorA, cursorB]);
```

Les appelants existants (`enterZoom()` sans arg, bouton + raccourci `Z`) sont inchangés. Le settle appelle `enterZoom(startSnap, endSnap)` → pas de dépendance à l'état non-flushé.

### 4.2 Pure fn — `applyWheelZoom`

```ts
// lib/timeline-zoom.ts (DateRange déjà défini : { startISO, endISO })

export function applyWheelZoom(
  current: DateRange,        // fenêtre de vue courante
  anchorISO: string,         // date sous la souris (point fixe du zoom)
  deltaY: number,            // delta molette ; <0 = zoom in, >0 = zoom out
  fullRange: DateRange,      // oldest → live, le plafond de clamp
  opts?: { sensitivity?: number; minSpanMs?: number },
): DateRange;
```

Algorithme :
1. `startMs`, `endMs`, `anchorMs`, `fullStartMs`, `fullEndMs` via `Date.parse`.
2. `span = endMs - startMs` ; `scale = Math.exp(deltaY * sensitivity)` (deltaY>0 ⇒ scale>1 ⇒ span grandit = zoom out ; deltaY<0 ⇒ scale<1 ⇒ zoom in).
3. `anchorRatio = (anchorMs - startMs) / span` (clampé [0,1] ; si span≤0 ⇒ 0.5).
4. `newSpan = clamp(span * scale, minSpanMs, fullSpan)` où `fullSpan = fullEndMs - fullStartMs`.
5. `newStart = anchorMs - anchorRatio * newSpan` ; `newEnd = newStart + newSpan`.
6. **Shift-to-fit** : si `newStart < fullStartMs` → translater `[newStart, newEnd]` vers la droite pour que `newStart = fullStartMs` ; symétrique si `newEnd > fullEndMs`. (Garde la fenêtre dans `fullRange` sans changer `newSpan`.)
7. Retourne `{ startISO: new Date(newStart).toISOString(), endISO: new Date(newEnd).toISOString() }`.

Défauts : `sensitivity = WHEEL_ZOOM_SENSITIVITY` (≈ 0.0015), `minSpanMs = WHEEL_ZOOM_MIN_SPAN_MS` (≈ 1h = 3_600_000). Une fenêtre dont `newSpan === fullSpan` signale au caller « plus de zoom » → au settle, `exitZoom()`.

### 4.3 Interaction / data flow (dans `Timeline.tsx`)

1. **Listener non-passif** : `useEffect` attache `el.addEventListener('wheel', onWheel, { passive: false })` sur l'élément track de la timeline (React `onWheel` est passif → ne permet pas `preventDefault`). `onWheel` appelle `e.preventDefault()` pour bloquer le scroll de page.
2. **Fenêtre transitoire** : state local `wheelWindow: DateRange | null` (null = pas de wheel-zoom en cours / settlé). La vue (positions des dots + triangles curseurs) se rend contre `wheelWindow` quand non-null, sinon contre `zoomWindow` / vue complète comme aujourd'hui.
3. **Sur wheel** :
   - `viewWindow` = `wheelWindow ?? (zoomWindow ? {startISO:zoomWindow.a,endISO:zoomWindow.b} : fullRange)`.
   - `anchorISO = mapPositionToDate(mouseX - trackLeft, viewWindow, trackWidth)`.
   - `next = applyWheelZoom(viewWindow, anchorISO, e.deltaY, fullRange)`.
   - `setWheelWindow(next)` ; mise à jour visuelle throttlée par `requestAnimationFrame`.
   - **Aucun travail graphe** pendant le scroll.
   - `ctrlKey` (pinch trackpad Mac) traité par le même handler.
4. **Settle** (debounce `WHEEL_ZOOM_SETTLE_MS` ≈ 200ms après le dernier wheel) :
   - Snapper les bords : `startSnap = snapToNearestSnapshot(wheelWindow.startISO, snapshots)`, `endSnap = snapToNearestSnapshot(wheelWindow.endISO, snapshots)`.
   - Si `startSnap === endSnap` (fenêtre dégénérée) → élargir d'un voisin pour garantir ≥2 snapshots distincts.
   - Si la fenêtre snappée couvre ≈ tout (`startSnap === oldest && endSnap === live`) → `setCursorA(startSnap)` + `setCursorB(endSnap)` + `exitZoom()`.
   - Sinon → `setCursorA(startSnap)` + `setCursorB(endSnap)` + `enterZoom(startSnap, endSnap)` (bornes explicites, cf § 4.1 bis — évite la lecture des curseurs non-flushés).
   - `setWheelWindow(null)` (le rendu reprend depuis `zoomWindow` committé).
   - Le recompute diff/filtre se déclenche **une seule fois** via le pipeline curseur→graphe existant (effet déjà keyé sur cursorA/B dans `useAppState`).

### 4.4 Edge cases

| Cas | Comportement |
|---|---|
| Repo < 2 snapshots | Timeline déjà cachée (condition Phase 1) ⇒ wheel no-op |
| Zoom in jusqu'au min span | `applyWheelZoom` clampe à `minSpanMs` ; scroll-up supplémentaire = no-op visuel |
| Zoom out au-delà du full range | Clampé à `fullSpan` ; au settle → `exitZoom()`, curseurs élargis à oldest/live |
| Fenêtre snappée dégénérée (start==end) | Élargie d'un snapshot voisin avant commit |
| `graphMode='diff'` actif | Curseurs bougent au settle → diff recalculé une fois (identique au drag-release) |
| Momentum scrolling (Mac) | Absorbé par rAF (throttle visuel) + debounce settle (le commit attend la fin du momentum) |
| Play/Pause en cours | Continue d'itérer dans la nouvelle fenêtre zoomée (comportement Phase 1 inchangé) |
| Curseur de souris hors du track pendant wheel | Le listener est sur le track ⇒ l'événement n'arrive pas hors zone |
| Conflit scroll de page | `preventDefault()` (listener non-passif) bloque le scroll quand on est au-dessus du track |

## 5. Testing strategy

### Unit (Vitest, pure) — extend `tests/unit/timeline-zoom.test.mjs`
- `applyWheelZoom` zoom in : span diminue, `anchorISO` garde son ratio (le point ancré reste à la même position relative).
- `applyWheelZoom` zoom out : span augmente.
- Clamp min span : span ne descend pas sous `minSpanMs`.
- Clamp + shift-to-fit : fenêtre poussée hors `fullRange` est translatée pour rester dedans, span préservé ; zoom out maximal ⇒ `newSpan === fullSpan`.
- Anchor aux bords (ratio 0 et 1).

### Component (Vitest + jsdom + testing-library) — extend `tests/unit/components/Timeline.test.tsx`
- Dispatch d'un événement `wheel` (deltaY<0) → `wheelWindow` devient non-null (vue transitoire mise à jour).
- Après le debounce settle → `setCursorA` + `setCursorB` + `enterZoom` appelés (mock `useAppState`).
- Zoom out complet → `exitZoom` appelé, pas `enterZoom`.

### E2E (Playwright) — extend `tests/e2e/specs/timeline-zoom-and-diff.spec.ts`
- Survol de la timeline + `page.mouse.wheel(0, -120)` (zoom in) → mini-map devient visible + URL contient `tlZoom=1`.
- `page.mouse.wheel(0, 600)` (zoom out complet) → mini-map disparaît + `tlZoom` retiré de l'URL.

## 6. Interaction avec URL Persistence (Item #5, livré)

Aucune modification requise. Le modèle couplé fait que la molette ne fait que déplacer `cursorA`/`cursorB` et toggler `zoomWindow`. Or `tlA`/`tlB` sérialisent déjà les shortHash des curseurs et `tlZoom` l'état zoomé. La vue wheel-zoomée est donc **automatiquement** partageable et résistante au F5 via les 5 params existants. C'est un bénéfice direct du choix « couplé ».

## 7. Out of scope

- `viewWindow` indépendant des curseurs (pan/zoom découplé façon carte) — rejeté ci-dessus, pas de reprise prévue sauf feedback fort.
- Zoom horizontal **du graphe Sigma** à la molette (déjà géré nativement par Sigma) — hors sujet, on parle de l'axe Timeline.
- Inertie / animation d'easing du zoom — YAGNI v1 ; le rAF throttle suffit à la fluidité.
- Boutons +/- de zoom discrets — le bouton "Zoom to window" + `Z` + la molette couvrent déjà les besoins.

## 8. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| `preventDefault` sur wheel nécessite un listener non-passif | Moyen | `addEventListener('wheel', fn, {passive:false})` via `useEffect` avec cleanup, pas le `onWheel` React (passif). Documenté dans le plan. |
| Rafale d'événements wheel = churn de re-render | Moyen | Fenêtre transitoire locale + update throttlé rAF ; recompute graphe seulement au settle (Approche 1). |
| Snap dégénéré (fenêtre trop petite ⇒ A==B) | Faible | Élargissement d'un voisin avant commit (§ 4.3) |
| deltaY hétérogène selon device (souris vs trackpad) | Faible | `scale = exp(deltaY·sensitivity)` est proportionnel et robuste ; sensibilité tunable dans ui-constants |
| Sigma capte aussi le wheel si le track chevauche le canvas | Faible | Le listener est posé sur l'élément track de la Timeline (DOM distinct du canvas Sigma) ; `stopPropagation` si besoin |

## 9. Effort estimate

| Tâche | Effort |
|---|---|
| `applyWheelZoom` pure + unit tests | ~½j |
| Wheel listener + fenêtre transitoire + rAF dans Timeline | ~1-1½j |
| Settle debounce + snap + commit aux setters existants | ~1j |
| Component test + E2E | ~1j |
| Docs (ROADMAP/INVENTORY/tests) + patch regen | ~½j |
| **Total** | **~3-5 jours** |

## 10. Document updates checklist (à la livraison)

- `ROADMAP.md` : ligne #54 dans "Déjà livré" + bump date header (clôture Phase 2 — 5/5 items).
- `INVENTORY.md` : entrée Timeline.tsx — mentionner le wheel zoom (ancré souris, continu-snap, couplé curseurs).
- `tests/README.md` : nouveaux cas unit + e2e.
- `CLAUDE.md` : pas de nouvel endpoint ⇒ smoke loop inchangé.
- `patches/upstream-all.diff` : regen.
