# Roadmap Predictive — Augmented Timeline design

**Date** : 2026-05-27
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Depends on** :
- [`2026-05-26-roadmap-predictive-core-design.md`](2026-05-26-roadmap-predictive-core-design.md) (per-snapshot `ghosts.json` sidecars + `/ghosts/at` endpoint)
- [`2026-05-26-roadmap-predictive-augmented-graph-design.md`](2026-05-26-roadmap-predictive-augmented-graph-design.md) (Show ghosts toggle, useSigma ghost layer)
- Timeline.tsx existant (snapshot scrubbing + Play + Preload snapshotCacheRef)

**Trigger** : [`IDEAS-PARKING-roadmap-predictive.md`](IDEAS-PARKING-roadmap-predictive.md) + Update 2 du spec Augmented graph ("Augmented Timeline" parking note). Dernier item parking de la série.

---

## 1. Context / problem

Aujourd'hui :
- **Timeline** (livré #7) permet de scrubber le PASSÉ via les snapshots (slider + Play). Affiche les nodes réels à chaque commit.
- **Augmented graph** (livré #39) affiche les ghosts du FUTUR sur le graph HEAD (current state).

Les deux sont **temporellement déconnectés** : impossible de voir "à T = il y a 2 mois, quels ghosts étaient planifiés ?" ou de regarder un ghost se matérialiser en temps réel pendant un Play d'animation.

L'Augmented Timeline ferme cette boucle : **scrubber le passé + afficher les ghosts qui étaient planned à ce moment-là**. Effet : voir la matérialisation graduelle de la roadmap en regardant l'historique.

## 2. Goal

Étendre la Timeline existante pour qu'elle soit **time-aware sur les ghosts** :
- Quand le cursor pointe sur un snapshot passé, l'overlay ghost (toggle `showGhosts` déjà existant) affiche les ghosts planifiés à ce moment-là, pas ceux d'aujourd'hui.
- Quand un ghost se matérialise pendant un Play scrub (cursor passe `materializedAt`), animation cross-fade : le ghost fade out, le real node fade in.

**3 activation triggers** (Q3 brainstorm = "tous, fais le mieux") :
1. **Auto-detect** (default) : cursor < HEAD ⇒ ghosts time-aware automatiquement
2. **Override toggle** (Filters) : "Lock ghosts to today's view" pour figer le mode sur HEAD
3. **Demo button** (Timeline) : "Animate roadmap" = auto-cursor earliest snapshot + auto-play + time-aware

Aucun nouveau endpoint serveur — tout consomme les sidecars existants livrés par CORE.

## 3. Design

### 3.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| Nouveau panel dédié `AugmentedTimelinePanel.tsx` | Doublonne la Timeline. Étendre l'existante = cohérent avec le pattern Sigma reducer (Augmented graph étend useSigma au lieu de doublonner). |
| Filter latest ghosts.json client-side (Q2 option B) | Perd les changements de description/scope entre snapshots (plan churn invisible). Per-snapshot sidecars sont déjà écrits par CORE, autant les utiliser. |
| Nouveau endpoint serveur `/ghosts/timeline` (Q2 option D) | Plus de code serveur pour rien — les sidecars per-snapshot existent déjà, le compute est O(events) client-side. Évite d'ajouter un endpoint. |
| Hard swap au runtime de matérialization (no animation) | Visuellement brut. Cross-fade 200ms est assez court pour ne pas ralentir Play tout en marquant clairement la transition. |
| Morph ghost → real node (transformation animée) | Beau mais complexe : positions différentes (ghost positionné par computeGhostLayout vs real node par layout Sigma). Cross-fade suffit pour v1. |
| Snapshot picker dropdown séparé (Q1 option C seul) | Existe déjà via `SnapshotsPanel`. La Timeline gère le scrub continu, ce qui est l'apport principal. |

### 3.2 Approche retenue : extension Timeline + cache snapshot ghosts.json

#### Architecture (pure frontend, zéro backend)

```
upstream/gitnexus-web/src/
├── lib/
│   ├── augmented-timeline.ts            NEW  pure : selectGhostsAt, computeTransition, lockMode
│   └── ghost-layout.ts                  MOD  small extension for time-aware filter chain
├── services/
│   └── snapshot-ghosts-cache.ts         NEW  pre-fetch all <repo>/snapshot/<sha>/ghosts.json
│                                              parallel pool, Map<sha, ghosts[]>
├── hooks/
│   ├── useAppState.tsx                  MOD  +lockGhostsToHead state, +animationActive
│   └── useSigma.ts                      MOD  ghost-layer reducer accepts opacity-by-id
├── components/
│   ├── Timeline.tsx                     MOD  +button "Animate roadmap", listens to ghost-mode
│   ├── GraphCanvas.tsx                  MOD  picks ghosts via selectGhostsAt when scrubbing
│   └── GhostFiltersSection.tsx          MOD  ajoute le toggle "Lock ghosts to today's view"

tests/
├── unit/
│   ├── augmented-timeline.test.mjs              NEW  selectGhostsAt + computeTransition
│   ├── snapshot-ghosts-cache.test.mjs           NEW  cache miss/hit, parallel pool
│   └── components/Timeline.augmented.test.tsx   NEW  Animate roadmap button + lock toggle
└── e2e/specs/07-augmented-timeline.spec.ts      NEW  scrub timeline → ghosts change

ROADMAP.md / INVENTORY.md / CLAUDE.md (no smoke entry — pure frontend) / tests/README.md
docs/superpowers/specs/2026-05-27-roadmap-predictive-augmented-timeline-design.md  MOD  Update — Shipped
patches/upstream-all.diff                REGEN
```

#### Pure fns clés

```ts
// lib/augmented-timeline.ts

export type SnapshotGhosts = { sha: string; date: string; ghosts: GhostInput[] };

// Returns ghosts that were "alive" (planned, not yet materialized/cancelled) at time T,
// derived from the snapshot whose syncedAt <= T (closest-prior). Empty if no snapshot before T.
export function selectGhostsAt(
  cache: Map<string, SnapshotGhosts>,
  cursorTime: Date,
  mode: 'time-aware' | 'lock-to-head',
  liveGhosts: GhostInput[],
): GhostInput[];

// For Play animation: given (prevTime, nextTime), returns ghosts crossing thresholds:
//  - materializing: ghost.materializedAt in (prevTime, nextTime]
//  - cancelling   : ghost.cancelledAt    in (prevTime, nextTime]
// Used by GraphCanvas to trigger 200ms cross-fade per transition.
export function computeTransitions(
  cache: Map<string, SnapshotGhosts>,
  prevTime: Date,
  nextTime: Date,
): { materializing: string[]; cancelling: string[] };
```

#### Snapshot ghosts cache

```ts
// services/snapshot-ghosts-cache.ts

// On panel mount or repo switch :
//   1. fetch /snapshots?repo=X to list all sha+date
//   2. parallel pool (n=3) of fetch /ghosts/at?repo=X&commit=<sha> for each
//   3. populate Map<sha, { sha, date, ghosts }>
//
// Same pattern as snapshotCacheRef in useAppState.tsx (graph snapshot pre-load).
// 30s TTL, repopulate on repo switch.

export async function prefetchSnapshotGhosts(repo: string, signal?: AbortSignal):
  Promise<Map<string, SnapshotGhosts>>;
```

Cost analysis : a repo with 50 snapshots ≈ 50 small JSON fetches (<2KB each), pool=3 → 17 batches × ~100ms = ~2s. Acceptable as one-time cost on mount.

#### Mode resolution (3 triggers)

```ts
// In GraphCanvas useEffect that decides which ghosts to render :

function resolveAugmentedTimelineMode(opts: {
  cursor: Date;              // Timeline cursor
  head: Date;                // HEAD date
  lockGhostsToHead: boolean; // user toggle
}): 'live' | 'time-aware' {
  if (opts.lockGhostsToHead) return 'live';
  // Tolerate 1 min skew for "current"
  if (Math.abs(opts.cursor.getTime() - opts.head.getTime()) < 60_000) return 'live';
  return 'time-aware';
}
```

#### Visual transitions (cross-fade 200ms)

Pendant un Play, à chaque tick:
1. `prevTime = lastCursor; nextTime = currentCursor`
2. `transitions = computeTransitions(cache, prevTime, nextTime)`
3. Pour chaque `id` in `transitions.materializing` :
   - Démarrer un cross-fade : ghost node opacity 0.5 → 0 sur 200ms
   - Le real node (déjà dans le graph) opacity 0 → 1 sur 200ms
4. Pour `transitions.cancelling` : ghost opacity → 0 (pas de real node à fade-in)

Cross-fade implémenté via `requestAnimationFrame` loop tracker dans `useSigma` (étendu) qui interpole les opacités au reducer level.

Hard swap (sans animation) au render initial = quand cursor jump explicite (drag scrub release, snapshot picker click). On évite l'overhead de N transitions si l'écart est > 1 snapshot.

#### Animate roadmap button (Timeline UI)

Nouveau bouton dans la Timeline (à côté de Play / Preload existants) :
- Label : "Animate roadmap"
- Icon : 🎬 ou History+Play
- Click :
  1. Active `showGhosts` si OFF
  2. Désactive `lockGhostsToHead` si ON
  3. Set cursor sur earliest snapshot (oldest)
  4. Trigger Play (réutilise mécanique existante)
  5. UI banner "Animating roadmap from <date> to <date>"
- Pendant l'animation, le user peut cliquer "Stop" pour figer le cursor à l'instant courant

#### Lock toggle (Filters)

Dans la section "Roadmap predictive" de `GhostFiltersSection` :
- ☐ Show ghosts (existant)
- ☐ ... (existants : tier toggles, cancelled)
- ☐ **Lock ghosts to today's view** (NEW, default OFF, hidden si `showGhosts` OFF)

Quand ON : `lockGhostsToHead = true` ⇒ même comportement qu'aujourd'hui (ghosts d'aujourd'hui sur tout snapshot).

#### Réutilisation maximale

- `Timeline.tsx` Play loop : aucun changement, juste un listener pour push cursor à `GraphCanvas`.
- `useSigma.applyGhostLayer` : existant, accepte maintenant un `opacityOverride: Map<id, number>` pour le cross-fade.
- `ghosts-client.ts` : pas modifié. La cache des snapshot ghosts vit dans un fichier séparé pour ne pas polluer l'usage simple.
- `snapshotCacheRef` (graph snapshots) : pattern utilisé comme template ; le code partagé est extrait si possible.

#### Tests (pyramid)

| Test | Fichier | Couvre |
|---|---|---|
| selectGhostsAt | `tests/unit/augmented-timeline.test.mjs` | closest-prior lookup, empty before earliest, lock-to-head bypass |
| computeTransitions | (same file) | materializing window, cancelling window, no false positives |
| Snapshot ghosts cache | `tests/unit/snapshot-ghosts-cache.test.mjs` | parallel pool, repo switch invalidates, abort signal |
| Timeline Animate button | `tests/unit/components/Timeline.augmented.test.tsx` | click resets cursor + plays, banner shows dates |
| Lock toggle | `tests/unit/components/Filters.test.tsx` (extend) | new toggle, hidden when showGhosts OFF |
| E2E | `tests/e2e/specs/07-augmented-timeline.spec.ts` | scrub timeline → ghosts change visibly |

## 4. Scope boundaries

**In-scope** :
- Pure fns `selectGhostsAt`, `computeTransitions`
- `snapshot-ghosts-cache.ts` service
- 3 activation triggers (auto-detect default, lock toggle, Animate button)
- Cross-fade 200ms pendant Play
- Tests + wiring docs

**Out-of-scope explicite** :
- Server-side endpoint dédié (le client compute via sidecars existants)
- Morph animation (transformation d'un ghost en real node) — cross-fade suffit
- Augmented Gantt time-aware (le Gantt montre déjà toute la timeline en vue calendaire — non pertinent)
- Augmented Audit time-aware (l'Audit est par définition cumulatif, pas time-aware)
- Cluster halos time-aware (cluster est de "snapshot latest" only en v1 — future si demandé)
- Pre-fetch incremental (recharge tous les snapshots) — fine v1 vu le coût acceptable
- Persistance "animation playback position" entre sessions

## 5. Open questions

1. **Skew de "current" pour auto-detect** : 60 secondes par défaut. Si HEAD a été advancé en background pendant que le user regarde, le cursor pourrait être "<= HEAD - 60s" et déclencher time-aware par erreur. Sub-1-minute snapshots sont rares ; tolérance raisonnable. **Résolu.**
2. **Cache invalidation au new snapshot** : si l'user sync pendant qu'il regarde le panel, le cache se désynchronise. Solution : `prefetchSnapshotGhosts` re-fire sur `/ghosts/sync` POST (subscribed via custom event ou simple TTL 30s avec refresh manuel). **Résolu : TTL 30s + bouton "Refresh" dans Timeline.**
3. **Performance avec >100 snapshots** : ~10s de pre-fetch initial. Hors limites raisonnables. Solution : limiter à 50 derniers + warning banner. **Résolu.**
4. **Cross-fade pendant scrub manuel (drag)** : pas pertinent — le drag est rapide, on hard-swap. Cross-fade UNIQUEMENT pendant Play (qui a un tick contrôlé). **Résolu.**
5. **Cluster halos pendant scrub** : v1 = halos sur clusters latest seulement (pas time-aware). Future si demandé. Documenté en out-of-scope §4.

## 6. Effort estimé

**~2.5 jours** :

| Composant | Effort |
|---|---|
| `selectGhostsAt` + `computeTransitions` pure fns + tests | 0.5 j |
| `snapshot-ghosts-cache.ts` (parallel pool, TTL) + tests | 0.5 j |
| `useSigma` opacityOverride extension + cross-fade rAF loop | 0.5 j |
| `Timeline.tsx` Animate button + state plumbing | 0.5 j |
| `GhostFiltersSection.tsx` Lock toggle + `useAppState` lockGhostsToHead | 0.25 j |
| E2E + wiring docs (ROADMAP + INVENTORY + tests/README + spec Update) | 0.25 j |

## 7. Suite

Plan d'implémentation via `superpowers:writing-plans`. **Dernier item de l'IDEAS-PARKING** — clôt la série Roadmap Predictive (8 sous-specs + 1 CORE = 9 livraisons).
