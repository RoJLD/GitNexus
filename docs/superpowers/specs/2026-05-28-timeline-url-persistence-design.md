# Timeline URL Persistence (shareable view links) — Design

**Date** : 2026-05-28
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Phase** : Phase 2 Item #5 sur 5 (Item #2 subsumed ; reste #4 Zoom mousewheel après celui-ci)
**Depends on** :
- [Phase 1 Timeline zoom + cursors](2026-05-27-timeline-zoom-cursors-design.md) — cursorA/B/zoomWindow/graphMode state
- [Phase 2 Item #1 Temporal Filter](2026-05-27-timeline-temporal-filter-design.md) — temporalFilterMode state

---

## 1. Context / problem

L'app persiste déjà `?project=<name>` dans l'URL via `URLSearchParams` + `window.history.replaceState`, avec un effect auto-connect au mount (App.tsx ~ligne 130) qui lit `?server` + `?project`. Mais **l'état de la Timeline** (position des cursors, zoom, mode diff, filtre temporel) est éphémère : un refresh F5 ou un partage de lien perd toute la navigation.

Cas d'usage qu'on rate :
- "Regarde gitnexus à cette fenêtre [janvier-mars] avec le diff A↔B activé" → impossible à partager par lien
- Refresh F5 pendant une investigation → on repart de zéro (cursors réinitialisés)
- Bookmark d'une vue diagnostique précise → perdu

## 2. Goal

Persister tout l'état Timeline dans l'URL via 5 query params préfixés `tl` (pour éviter collision avec `project`/`server`), et restaurer cet état au load une fois les snapshots disponibles :

| Param | Encode | Valeurs |
|---|---|---|
| `tlA` | cursor A | shortHash du snapshot (`a8f3c2d`), ou `live` pour le head |
| `tlB` | cursor B | idem |
| `tlZoom` | zoom actif | `1` si zoomWindow set, absent sinon |
| `tlMode` | graphMode | `diff` si mode diff actif, absent (= `single`) sinon |
| `tlFilter` | temporalFilterMode | `strict` / `normal` / `permissive`, absent (= `off`) sinon |

**Write** : `replaceState` (pas `pushState` — évite de polluer l'historique back/forward) sur chaque changement de l'un des 5 états.

**Read** : effect one-shot guardé (ref) qui attend que `availableRepos[].snapshots` soient chargés, puis résout shortHash → date et applique aux cursors/zoom/mode/filter.

Sémantique d'identifiant : **shortHash** (stable à travers re-index, court, lisible). Au write, on résout cursor ISO date → shortHash via `availableRepos[].snapshots`. Au read, l'inverse.

## 3. Decisions cadres (validées en brainstorm)

| Décision | Choix retenu | Raison |
|---|---|---|
| **D1** State persisté | Tout (5 params : tlA, tlB, tlZoom, tlMode, tlFilter) | Full shareability — un lien reproduit exactement la vue. |
| **D2** Format identifiant | shortHash (`live` pour le head) | Stable à travers re-index, court, lisible. ISO date trop long + encoding ; index fragile. |
| **D3** Read timing | Effect one-shot guardé attendant snapshots chargés | Les cursors mappent aux snapshots → on ne peut résoudre qu'après chargement. Ref guard (pattern `autoConnectRan` de App.tsx). À ajuster selon comportement réel observé en commits. |
| **D4** Write trigger | `replaceState` (pas pushState) sur changement, params préfixés `tl` | Évite de polluer back/forward. Préfixe `tl` évite collision avec `project`/`server`. |
| **D5** (impl) Pure fns extraites | `serializeTimelineToParams` + `parseTimelineParams` | Testables en isolation sans React. Le hook orchestre. |

## 4. Design

### 4.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| react-router + useSearchParams | L'app n'utilise PAS react-router — c'est du `URLSearchParams` manuel. Introduire router juste pour ça = surdimensionné. |
| Hash fragment (`#tlA=...`) au lieu de query params | Le pattern existant (`?project=`) utilise des query params. Cohérence. |
| Persist en localStorage au lieu de l'URL | localStorage ne se partage pas par lien. L'URL est le bon véhicule pour le share-link. (NB : `temporalFilterMode` est DÉJÀ en localStorage de Item #1 — l'URL prend priorité au load si présente.) |
| pushState (nouvelle entrée d'historique par changement) | Pollue back/forward — chaque drag de cursor créerait une entrée. replaceState est le bon choix. |
| Inline les 2 effects dans useAppState | useAppState est déjà énorme (2900+ lignes). Un hook dédié `useTimelineUrlSync` isole la responsabilité. |
| Index au lieu de shortHash | Fragile — ajouter un snapshot décale les index, casse les vieux liens. |

### 4.2 Approche retenue : hook dédié `useTimelineUrlSync` + 2 pure fns

#### Architecture (pure frontend)

```
upstream/gitnexus-web/src/
├── lib/timeline-url.ts                       NEW  Pure fns : serializeTimelineToParams, parseTimelineParams
├── hooks/useTimelineUrlSync.ts               NEW  Hook orchestrant read (one-shot) + write (replaceState) effects
└── App.tsx                                   MOD  Mount useTimelineUrlSync() once (it self-subscribes to useAppState)
```

```
tests/
├── unit/timeline-url.test.mjs                NEW  Pure fns (serialize + parse round-trip + edge cases)
└── e2e/specs/timeline-url-persistence.spec.ts  NEW  Set cursors+filter → URL updates → reload → state restored
```

Aucun changement backend. Aucune nouvelle dep.

#### Pure fns (`lib/timeline-url.ts`)

```typescript
/**
 * Pure serialization of the Timeline state to / from URL query params.
 * shortHash-based identifiers (stable across re-index). See spec :
 * docs/superpowers/specs/2026-05-28-timeline-url-persistence-design.md
 */

export interface TimelineUrlState {
  cursorAShortHash: string | null;   // shortHash or 'live' or null
  cursorBShortHash: string | null;
  zoom: boolean;
  graphMode: 'single' | 'diff';
  filterMode: 'off' | 'strict' | 'normal' | 'permissive';
}

/**
 * Serialize Timeline state into a URLSearchParams patch. Only sets params
 * that carry non-default information (so the URL stays clean). Mutates a
 * COPY conceptually — caller applies onto the live URL.
 *
 * Returns a Map of param→value to SET, plus a list of param keys to DELETE
 * (when reverting to default, e.g. filter back to 'off').
 */
export function serializeTimelineToParams(state: TimelineUrlState): {
  set: Record<string, string>;
  remove: string[];
} {
  const set: Record<string, string> = {};
  const remove: string[] = [];

  if (state.cursorAShortHash) set.tlA = state.cursorAShortHash;
  else remove.push('tlA');

  if (state.cursorBShortHash) set.tlB = state.cursorBShortHash;
  else remove.push('tlB');

  if (state.zoom) set.tlZoom = '1';
  else remove.push('tlZoom');

  if (state.graphMode === 'diff') set.tlMode = 'diff';
  else remove.push('tlMode');

  if (state.filterMode !== 'off') set.tlFilter = state.filterMode;
  else remove.push('tlFilter');

  return { set, remove };
}

/**
 * Parse Timeline params out of a URLSearchParams. Returns the raw values
 * (shortHashes still need resolution to dates by the caller via the
 * snapshot list). Invalid / missing params return null / defaults.
 */
export function parseTimelineParams(params: URLSearchParams): TimelineUrlState {
  const filterRaw = params.get('tlFilter');
  const validFilter = filterRaw === 'strict' || filterRaw === 'normal' || filterRaw === 'permissive'
    ? filterRaw
    : 'off';
  return {
    cursorAShortHash: params.get('tlA'),
    cursorBShortHash: params.get('tlB'),
    zoom: params.get('tlZoom') === '1',
    graphMode: params.get('tlMode') === 'diff' ? 'diff' : 'single',
    filterMode: validFilter,
  };
}
```

#### Hook (`hooks/useTimelineUrlSync.ts`)

```typescript
import { useEffect, useRef } from 'react';
import { useAppState } from './useAppState';
import { serializeTimelineToParams, parseTimelineParams } from '../lib/timeline-url';

/**
 * Two-way sync between Timeline state and the URL query string :
 *   - WRITE : on any change to cursorA/B/zoomWindow/graphMode/temporalFilterMode,
 *     replaceState the 5 tl* params (resolving cursor dates → shortHash).
 *   - READ : one-shot on mount once snapshots are available, parse the URL
 *     params (resolving shortHash → date) and apply to state.
 *
 * Mounted once in App.tsx. Self-subscribes to useAppState.
 */
export function useTimelineUrlSync() {
  const {
    projectName, availableRepos,
    cursorA, cursorB, zoomWindow, graphMode, temporalFilterMode,
    setCursorA, setCursorB, enterZoom, setGraphMode, setTemporalFilterMode,
  } = useAppState();

  const baseRepo = projectName ? projectName.split('@')[0] : '';
  const readDone = useRef(false);

  // Helpers to resolve between cursor ISO date <-> snapshot shortHash.
  const dateToShortHash = (date: string | null): string | null => {
    if (!date) return null;
    const repo = availableRepos.find((r) => r.name === baseRepo);
    const snap = repo?.snapshots?.find((s) => s.commit?.date === date);
    if (snap) return snap.commit?.shortHash || null;
    if (repo?.indexedAt === date) return 'live';
    return null;
  };
  const shortHashToDate = (sh: string | null): string | null => {
    if (!sh) return null;
    const repo = availableRepos.find((r) => r.name === baseRepo);
    if (sh === 'live') return repo?.indexedAt || null;
    const snap = repo?.snapshots?.find((s) => s.commit?.shortHash === sh);
    return snap?.commit?.date || null;
  };

  // READ (one-shot, after snapshots load)
  useEffect(() => {
    if (readDone.current) return;
    const repo = availableRepos.find((r) => r.name === baseRepo);
    if (!repo || !(repo.snapshots?.length)) return; // wait for snapshots
    const params = new URLSearchParams(window.location.search);
    const parsed = parseTimelineParams(params);
    // Only act if at least one tl param is present (don't override defaults otherwise)
    if (!params.has('tlA') && !params.has('tlB') && !params.has('tlZoom') && !params.has('tlMode') && !params.has('tlFilter')) {
      readDone.current = true;
      return;
    }
    const dateA = shortHashToDate(parsed.cursorAShortHash);
    const dateB = shortHashToDate(parsed.cursorBShortHash);
    if (dateA) setCursorA(dateA);
    if (dateB) setCursorB(dateB);
    if (parsed.filterMode !== 'off') setTemporalFilterMode(parsed.filterMode);
    if (parsed.graphMode === 'diff') setGraphMode('diff');
    if (parsed.zoom && dateA && dateB) enterZoom();
    readDone.current = true;
  }, [availableRepos, baseRepo, setCursorA, setCursorB, enterZoom, setGraphMode, setTemporalFilterMode]);

  // WRITE (on any state change, after read is done)
  useEffect(() => {
    if (!readDone.current) return; // don't overwrite URL before we've read it
    const { set, remove } = serializeTimelineToParams({
      cursorAShortHash: dateToShortHash(cursorA),
      cursorBShortHash: dateToShortHash(cursorB),
      zoom: zoomWindow !== null,
      graphMode,
      filterMode: temporalFilterMode,
    });
    const urlObj = new URL(window.location.href);
    for (const [k, v] of Object.entries(set)) urlObj.searchParams.set(k, v);
    for (const k of remove) urlObj.searchParams.delete(k);
    window.history.replaceState(null, '', urlObj.toString());
  }, [cursorA, cursorB, zoomWindow, graphMode, temporalFilterMode, availableRepos, baseRepo]);
}
```

#### App.tsx integration

Mount the hook once near the top of the App component (after useAppState is available). Since the hook self-subscribes to useAppState, it just needs to be called :

```typescript
// Near other hook calls in App component body
useTimelineUrlSync();
```

The hook does nothing visible — it's a pure side-effect coordinator.

### 4.3 Edge cases

| Case | Behavior |
|---|---|
| No `tl*` params in URL | Read effect no-ops (guard checks `params.has(...)`), state stays default. readDone set true so write can start. |
| `tlA` shortHash not found in snapshots (deleted/re-indexed) | `shortHashToDate` returns null → cursor not set, falls back to default init. No crash. |
| `tlZoom=1` but cursors couldn't resolve | `enterZoom` is a no-op when cursors not both set (Phase 1 guarantee). Safe. |
| `tlFilter=garbage` | `parseTimelineParams` validates against the 4 known values, defaults to 'off'. |
| URL written before read completes (race) | Write effect guards on `readDone.current` — won't fire until read is done. Prevents clobbering URL with default state before restoration. |
| Repo switch (project changes) | `baseRepo` changes → effects re-run. Read is one-shot (readDone stays true) so it won't re-read on repo switch — only the write keeps the URL fresh. **Note** : switching repos keeps stale tl* params until the next cursor change writes fresh ones. Acceptable for v1 ; could reset on project change in v1.1. |
| `tlMode=diff` but filter also active | Both applied — they compose (Item #1 design). Order : setCursorA/B first, then filter, then diff. |
| Server-side render (no window) | Hook only runs in effects (client-side) — `window` always defined there. No SSR concern. |

## 5. Testing strategy

### Unit (`tests/unit/timeline-url.test.mjs`)

- `serializeTimelineToParams` :
  - Full state → all 5 params set
  - Default state (no cursors, off filter, single mode, no zoom) → all in `remove` list
  - filter='off' → tlFilter in remove ; filter='strict' → tlFilter='strict' in set
  - graphMode='single' → tlMode in remove ; 'diff' → tlMode='diff'
- `parseTimelineParams` :
  - All params present → correct parse
  - Missing params → defaults (null cursors, off filter, single mode, zoom false)
  - Invalid tlFilter → defaults to 'off'
  - tlZoom='1' → true ; absent → false ; tlZoom='0' → false
- Round-trip : serialize then parse → same logical state (modulo date↔shortHash which is caller's job)

### E2E (`tests/e2e/specs/timeline-url-persistence.spec.ts`)

- Load app, set cursors + filter=strict + compare A↔B → URL contains `tlA`, `tlB`, `tlFilter=strict`, `tlMode=diff`
- Reload page → cursors restored, filter dropdown shows "strict", compare button shows "Exit compare"
- Reset filter to off → `tlFilter` param removed from URL
- Set zoom → `tlZoom=1` in URL ; zoom out → `tlZoom` removed

## 6. Out of scope

- **Reset tl* params on project switch** — v1 keeps stale params until next write. v1.1 candidate.
- **pushState for back/forward navigation through timeline states** — explicitly rejected (D4). Would pollute history.
- **Compressed/encoded state blob** (single `?tl=<base64>`) — premature optimization, 5 readable params are fine.
- **Sharing the LLM chat state or panel-open state** — out of timeline scope.

## 7. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| Write effect fires before read → clobbers shared link with default state | **Élevé** | `readDone.current` guard on write effect — write blocked until read completes. Core of the design. |
| shortHash collisions (2 snapshots same short hash) | Faible | Git shortHashes are unique within a repo in practice. If collision, first match wins — acceptable. |
| Read effect never fires (snapshots never load) | Faible | If snapshots never load, readDone stays false, write never fires — URL stays as-is (the shared link). No data loss. |
| Repo switch leaves stale tl* params | Faible | Documented edge case. Next cursor change rewrites. v1.1 can reset on project change. |
| Infinite loop : read sets state → write fires → read re-fires | Moyen | Read is one-shot (readDone guard). Write doesn't trigger read. No loop. |
| temporalFilterMode in BOTH localStorage (Item #1) and URL | Moyen | URL takes priority at load (read effect calls setTemporalFilterMode which also updates localStorage). Consistent — URL is the source of truth for a shared link. |

## 8. Effort estimate

| Phase | Tasks | Effort |
|---|---|---|
| Pure fns `lib/timeline-url.ts` + unit tests | ~½j |
| Hook `useTimelineUrlSync` (read + write effects) | ~1j |
| App.tsx integration (mount the hook) | ~¼j |
| E2E spec | ~½j |
| Docs (ROADMAP + INVENTORY + tests/README) | ~½j |
| **Total** | | **~2-3 days** |

## 9. Document updates checklist

- `ROADMAP.md` : add row + bump date header
- `INVENTORY.md` : mention URL persistence in frontend components section (`useTimelineUrlSync` hook + `lib/timeline-url.ts`)
- `tests/README.md` : add 2 tests (1 unit + 1 e2e)
- `CLAUDE.md` : no smoke loop change (pure frontend, no endpoint)
- `patches/upstream-all.diff` : regen on each task commit

## 10. Open questions

- **Read timing** (D3) flagged by user to refine based on observed commit behavior. The one-shot ref-guard + "wait for snapshots" approach is the starting point ; if the timing turns out flaky (e.g., snapshots load in stages), the writing-plans / implementation phase will adjust (e.g., wait for a specific "snapshots ready" signal instead of just `snapshots.length > 0`).
- Minor : whether to also encode `tlA`/`tlB` as ISO dates as a fallback when shortHash resolution fails — deferred, shortHash-only for v1.
