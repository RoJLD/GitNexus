# Timeline Temporal Filter (3 modes : strict / normal / permissive) — Design

**Date** : 2026-05-27
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Phase** : Phase 2 Item #1 sur 5 du out-of-scope du spec Timeline zoom + 2 cursors (path B "item par item dans l'ordre d'impact" choisi)
**Depends on** : [Timeline zoom + 2 cursors Phase 1](2026-05-27-timeline-zoom-cursors-design.md) — cursorA/B/zoomWindow state + enterCursorDiff pipeline + diffBetweenSnapshots helper
**Sibling Phase 2 items** (livrés après celui-ci dans l'ordre 2→3→5→4) :
- #2 Mode `union` panel + endpoint dedié
- #3 Lifespan fenêtré
- #5 URL persistence (`?cursorA=&cursorB=&zoom=`)
- #4 Zoom continu mousewheel

---

## 1. Context / problem

La Timeline zoom + cursors Phase 1 livre la **navigation** (drag cursors A/B, zoom on [A,B], compare A↔B avec diff visuel). Mais le graphe affiché reste indépendant du contexte temporel — quand l'utilisateur explore une fenêtre, il voit toujours soit le snapshot au cursor B, soit l'union diff A∪B. Il n'y a pas de moyen de dire "filtre le graphe aux nodes qui ont vraiment vécu dans cette fenêtre [A, B]".

Cas d'usage qu'on rate aujourd'hui :
- "Quels fichiers ont **survécu** durant tout ce sprint ?" → intersection A ∩ B (le "stable core")
- "Quels fichiers ont **existé à un moment** durant ce sprint ?" → union A ∪ B (vue normale du delta de la fenêtre)
- "Quels fichiers ont **vécu, même brièvement**, durant ce sprint ?" → union des snapshots intermédiaires (capture les éphémères : créés puis supprimés dans la fenêtre)

## 2. Goal

Ajouter un **mode selector temporal filter** à 4 options (`off` / `strict` / `normal` / `permissive`) sur la Timeline, qui contrôle l'ensemble des nodes affichés sur le graphe, **orthogonalement au graphMode existant** (`single` / `diff`). Les 2 dimensions composent :

| temporalFilterMode | + graphMode='single' | + graphMode='diff' |
|---|---|---|
| `off` (default) | snapshot at cursorB (current) | union A∪B avec coloring (current) |
| `strict` (A ∩ B) | nodes intersection visibles | intersection avec diff coloring (que des gray) |
| `normal` (A ∪ B) | union sans coloring | identique à diff seul |
| `permissive` (window union) | window union sans coloring | window union avec diff coloring sur A/B (intermédiaires en neutre) |

## 3. Decisions cadres (validées en brainstorm)

| Décision | Choix retenu | Raison |
|---|---|---|
| **D1** : Backend vs client pour permissive | **Backend** `/nodes/alive-between?repo=&from=&to=` | Client-side (fetch N snapshots) prohibitif sur fenêtres larges. Endpoint backend coûte 2-3j one-time, débloque d'autres futures features. |
| **D2** : UI placement du selector | **Dropdown** `<select>` "Filter: [Off/Strict/Normal/Permissive]" à côté de "Compare A↔B" | Compact + lisible + permet de désactiver via "Off". |
| **D3** : Default behavior | **Off par défaut**, persisté en localStorage (`timelineTemporalFilterMode`) comme la mini-map | Pas d'auto-activation surprise. User opt-in explicit. |
| **D4** : Composition avec graphMode='diff' | **Cumulable** — filter contrôle quels nodes sont dans le graphe, diff colore ces nodes | Sémantique propre : filter = quel set, diff = coloring de ce set. |
| **D5** (impl) : Modes off/strict/normal | **Client-side** via diffBetweenSnapshots + filtrage de unionNodes | Aucun nouveau endpoint nécessaire — on a déjà les 2 snapshots via le pipeline Task 11. |
| **D6** (impl) : Mode permissive | **Backend uniquement** | C'est la seule qui requiert les snapshots intermédiaires. |

## 4. Design

### 4.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| Filter et graphMode fusionnés en une seule enum à 8+ valeurs (`single`, `diff`, `strict-diff`, `permissive-diff`, etc.) | Combine 2 dimensions orthogonales en un état plat → croissance exponentielle des cas. 2 enums orthogonales (filter + graphMode) restent à 4×2=8 combinations mais le state space est composable. |
| Cycle button (1 bouton qui cycle off→strict→normal→permissive→off) | Compact mais cache le mode actuel. User doit lire le label à chaque fois. |
| Auto-activate filter quand on zoom | Surprenant. User n'a pas demandé. Reste opt-in. |
| Filter ON par défaut quand cursors set | Idem — change la sémantique existante de Phase 1, casse les attentes. |
| Endpoint `/api/graph/window?repo=&from=&to=` qui retourne directement le graph complet de la fenêtre | Coûteux serveur ; pour strict/normal on a déjà les graphs A et B côté client. |
| Endpoint per-mode (`/nodes/alive-between-strict`, `/nodes/alive-between-permissive`) | Redondant — un seul endpoint avec un paramètre `mode` est suffisant et plus DRY. |

### 4.2 Approche retenue : dropdown + dual-pipeline (client-side pour 2 modes, backend pour 1)

#### Architecture

```
upstream/
├── docker-server-nodes-alive-between.mjs  NEW  Backend endpoint pure module
├── docker-server.mjs                       MOD  Register the new route
└── gitnexus-web/src/
    ├── hooks/useAppState.tsx               MOD  + temporalFilterMode state
                                                 + applyTemporalFilter useCallback
                                                 + useEffect watcher
    ├── components/Timeline.tsx             MOD  + dropdown selector next to Compare A↔B
    ├── services/backend-client.ts          MOD  + fetchNodesAliveBetween
    └── hooks/useSigma.ts                   MOD  Apply node-id filter on the displayed graph
```

```
tests/
├── unit/
│   ├── nodes-alive-between-core.test.mjs              NEW  Pure backend logic (snapshot iteration + union)
│   ├── temporal-filter-modes.test.mjs                 NEW  Pure client compute fns
│   └── use-app-state-temporal-filter.test.tsx         NEW  state + setter + auto-swap behavior
├── integration/endpoints/nodes-alive-between.test.mjs NEW  GET endpoint
└── e2e/specs/timeline-temporal-filter.spec.ts         NEW  3-mode toggle + composition with Compare
```

#### Backend endpoint `/nodes/alive-between`

```http
GET /nodes/alive-between?repo=<base>&from=<shortHash|"oldest">&to=<shortHash|"live"|"newest">
```

**Response (200 JSON)** :
```json
{
  "nodeIds": ["src/auth/login.ts", "src/auth/legacy.js", ...],
  "snapshotCount": 12,
  "fromSnapshot": "a8f3c2d",
  "toSnapshot": "live",
  "computedAt": "2026-05-27T15:00:00Z"
}
```

**Response 404** : repo not indexed
**Response 400** : invalid from/to or from > to

**Algorithm** :
1. Resolve `from` and `to` to snapshot names (shortHash or `<repo>` for live)
2. List all snapshots of `repo` ordered by commit date
3. Filter to those in window [from, to] inclusive
4. For each snapshot, read its `.gitnexus/nodes.json` (or equivalent), extract node IDs
5. Union all sets
6. Return deduped list

**Performance considerations** :
- Caching key : `(repo, fromShortHash, toShortHash)` — windowed results stable until new snapshot in range
- Cache stored in `<repoPath>/.gitnexus/alive-between-cache.json` (per-repo, invalidated on `/snapshot` ou `/snapshot/bulk`)
- 50 snapshots × ~10k nodes each = ~500k IDs to union, ~50MB transient memory, < 2s wall-clock on a SSD repo

#### Frontend state (`useAppState`)

```ts
// Type additions to AppState interface
interface AppState {
  // ... existing fields
  temporalFilterMode: 'off' | 'strict' | 'normal' | 'permissive';
  setTemporalFilterMode: (mode: 'off' | 'strict' | 'normal' | 'permissive') => void;
  temporalFilterLoading: boolean;
  temporalFilterError: string | null;
  temporalFilteredNodeIds: Set<string> | null;  // null when filter='off', non-null otherwise
}
```

**Setter** :
```ts
const setTemporalFilterMode = useCallback((mode) => {
  setTemporalFilterModeState(mode);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('timelineTemporalFilterMode', mode);
  }
}, []);
```

**Effect** :
```ts
useEffect(() => {
  if (temporalFilterMode === 'off' || !cursorA || !cursorB || !projectName) {
    setTemporalFilteredNodeIds(null);
    return;
  }

  const baseRepo = projectName.split('@')[0];
  const repo = availableRepos.find(r => r.name === baseRepo);
  if (!repo) return;
  const snapA = repo.snapshots?.find(s => s.commit.date === cursorA);
  const snapB = repo.snapshots?.find(s => s.commit.date === cursorB);
  const nameA = snapA?.name ?? (repo.indexedAt === cursorA ? baseRepo : null);
  const nameB = snapB?.name ?? (repo.indexedAt === cursorB ? baseRepo : null);
  if (!nameA || !nameB) return;

  let cancelled = false;
  setTemporalFilterLoading(true);
  setTemporalFilterError(null);

  (async () => {
    try {
      let nodeIds: Set<string>;
      if (temporalFilterMode === 'permissive') {
        const result = await fetchNodesAliveBetween(baseRepo, nameA, nameB);
        nodeIds = new Set(result.nodeIds);
      } else {
        // 'strict' or 'normal' — client-side via existing diff pipeline
        const [graphA, graphB] = await Promise.all([
          fetchGraph(nameA),
          fetchGraph(nameB),
        ]);
        const idsA = new Set(graphA.nodes.map(n => n.id));
        const idsB = new Set(graphB.nodes.map(n => n.id));
        if (temporalFilterMode === 'strict') {
          // Intersection : id in both A and B
          nodeIds = new Set([...idsA].filter(id => idsB.has(id)));
        } else {
          // 'normal' — union
          nodeIds = new Set([...idsA, ...idsB]);
        }
      }
      if (!cancelled) setTemporalFilteredNodeIds(nodeIds);
    } catch (err) {
      if (!cancelled) {
        setTemporalFilterError(err instanceof Error ? err.message : 'Failed to compute temporal filter');
      }
    } finally {
      if (!cancelled) setTemporalFilterLoading(false);
    }
  })();

  return () => { cancelled = true; };
}, [temporalFilterMode, cursorA, cursorB, projectName, availableRepos]);
```

#### Filter application in `useSigma`

The Sigma reducer already has per-node visibility hooks. Add a new precondition:

```ts
const nodeReducer = (node, attrs) => {
  // Existing logic: churn coloring, diff coloring, search highlight, etc.
  let { color, hidden, ...rest } = baseLogic(node, attrs);

  // NEW : temporal filter mask
  if (temporalFilteredNodeIds !== null && !temporalFilteredNodeIds.has(node)) {
    hidden = true;  // node not in filter window → hide
  }

  return { color, hidden, ...rest };
};
```

The filter is **additive to existing reducers** — it never colors a node, only potentially hides it. Diff coloring + filter compose naturally : diff sets colors on all union nodes ; filter hides the ones not in the temporal set.

#### UI dropdown in `Timeline.tsx`

```tsx
{/* Temporal filter dropdown — Phase 2 Item #1 */}
<label className="flex shrink-0 items-center gap-1 text-[10px] text-text-secondary">
  Filter:
  <select
    value={temporalFilterMode}
    onChange={(e) => setTemporalFilterMode(e.target.value as TemporalFilterMode)}
    disabled={!cursorA || !cursorB}
    className="rounded-md border border-border-subtle bg-elevated px-1.5 py-0.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-40"
    title={
      !cursorA || !cursorB
        ? 'Set both cursors A and B to enable filter'
        : 'Filter the graph to nodes alive in [A, B]'
    }
  >
    <option value="off">Off</option>
    <option value="strict">Strict (A ∩ B)</option>
    <option value="normal">Normal (A ∪ B)</option>
    <option value="permissive">Permissive (window)</option>
  </select>
  {temporalFilterLoading && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
</label>
```

Placement : entre le bouton "Compare A↔B" et la timeline bar.

#### Composition matrix (concrete behavior)

| temporalFilterMode | graphMode='single' | graphMode='diff' |
|---|---|---|
| `off` | Snapshot at cursorB displayed | Union A∪B with red/green/gray coloring |
| `strict` | Snapshot at cursorB **with nodes not in A hidden** | Union A∪B colored, **only inBoth nodes (gray) visible** |
| `normal` | Union A∪B displayed (loaded via same path as diff) **without coloring** | Equivalent to `off+diff` — filter is a no-op since diff already shows union |
| `permissive` | Union of all snapshots in [A,B] **without coloring** — needs broader graph load | Window union with diff coloring on A/B nodes ; intermediate-only nodes in neutral (blue) |

#### Edge cases

| Case | Behavior |
|---|---|
| Repo with < 2 snapshots | Dropdown disabled (`disabled` attribute), tooltip explains |
| Cursors not set | Dropdown disabled |
| Filter mode = 'off' | `temporalFilteredNodeIds` = null, no reducer effect, no fetch |
| Filter mode toggled mid-drag of cursor | Effect re-runs at cursor release (snap behavior from Task 4), re-computes filter |
| Mode = 'permissive' but backend 404 (repo gone) | `temporalFilterError` set, mode auto-reverts to 'off' with toast |
| Mode = 'permissive' fetch timeout | Same as 404 |
| Mode persisted in localStorage but cursors stale | On mount, restore the mode but effect will not fire until cursors initialized |
| Lifespan panel active simultaneously | Lifespan reads global state (Phase 1 decision : "Lifespan stays global") → no interaction. Filter only affects the **graph canvas**, not Lifespan panel data. |

## 5. Testing strategy

### Unit (Vitest)

- `tests/unit/nodes-alive-between-core.test.mjs` :
  - Iterate snapshots in window, union node IDs
  - Resolve "oldest" / "live" aliases
  - Cache invalidation on new snapshot added

- `tests/unit/temporal-filter-modes.test.mjs` :
  - `computeStrictFilter(graphA, graphB)` → intersection
  - `computeNormalFilter(graphA, graphB)` → union
  - Edge cases : empty graphs, identical graphs, no overlap

- `tests/unit/use-app-state-temporal-filter.test.tsx` :
  - Default mode = 'off'
  - localStorage restoration on mount
  - setTemporalFilterMode persists to localStorage
  - Effect fires on mode change + cursors change

### Integration (Vitest)

- `tests/integration/endpoints/nodes-alive-between.test.mjs` :
  - 200 with valid window
  - 400 on invalid from > to
  - 404 on unknown repo
  - Cache hit on second call with same params

### E2E (Playwright)

- `tests/e2e/specs/timeline-temporal-filter.spec.ts` :
  - Dropdown renders with 4 options
  - Disabled when cursors not set
  - Select "Strict" → graph node count decreases
  - Select "Normal" → graph shows union
  - Select "Permissive" → loading spinner → graph shows more nodes (window-wide)
  - Composition : Filter + Compare A↔B → diff colors visible only on filtered subset

## 6. Out of scope (deferred to Phase 3 or later)

- **Per-language filter** (e.g., "hide all .test.ts files in window") — useful but unrelated to temporal axis
- **Author filter combined with temporal** ("alive in window AND committed by Alice") — composable but heavy state
- **Animation when mode changes** (fade-out hidden nodes vs. instant hide) — UX polish, defer
- **Persist mode in URL** (Item #5 of Phase 2 — separate item)
- **Filter applied to per-node analytics panels** (e.g., Ownership panel respects filter) — extension that touches many panels, deferred until feedback

## 7. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| Permissive endpoint slow on long windows (1 year+ of snapshots) | Moyen | Cache the result keyed on (repo, from, to). Lazy compute incrementally if snapshots grow during the request. |
| Sigma reducer perf with large hidden node sets | Faible | Sigma already handles per-node hidden flag efficiently. Test with 5000-node graph. |
| Race condition : filter computing while user toggles graphMode='diff' | Moyen | `cancelled` flag in useEffect cleanup function (already in design). Latest mode wins. |
| Permissive + diff coloring : how do we color intermediate-only nodes ? | Moyen | Use a neutral color (e.g., `bg-blue-400/40`) distinct from red/green/gray. Document in DiffBanner legend. |
| User confused between modes (semantically subtle) | Moyen | Tooltips on dropdown options explain each mode. Example : "Strict = lived continuously through the window". |
| Mode toggled rapidly → wasted fetches | Faible | Debounce 200ms on mode change before triggering fetch. |
| Permissive endpoint backward-compat when bumping upstream | Faible | New file `docker-server-nodes-alive-between.mjs` (no merge with existing) — bump-safe. |

## 8. Effort estimate

| Phase | Tasks | Effort |
|---|---|---|
| Bootstrap | Pure fns `computeStrictFilter`, `computeNormalFilter` + unit tests | ~1j |
| Backend endpoint | `docker-server-nodes-alive-between.mjs` + integration test + register route | ~2-3j |
| State + setter | Extend `useAppState` with mode + loading + error + filteredNodeIds | ~1j |
| Effect logic | Watcher that dispatches client vs. backend based on mode | ~1-2j |
| Sigma reducer integration | Apply filter mask in node reducer + test composition with diff | ~1-2j |
| UI dropdown | `<select>` in Timeline.tsx + localStorage persist | ~½j |
| E2E test | Playwright spec covering 4 modes + composition | ~1j |
| Docs | ROADMAP + INVENTORY + tests/README + CLAUDE.md smoke loop | ~½j |
| **Total** | | **~8-12 days (~1.5-2 weeks)** |

## 9. Document updates checklist

- `ROADMAP.md` : add row 48+ in "Déjà livré" + bump date header
- `INVENTORY.md` : Partie B.2 endpoints (`/nodes/alive-between`) + composants frontend (mention dropdown in Timeline.tsx)
- `tests/README.md` : 4 new tests (3 unit + 1 integ + 1 e2e)
- `CLAUDE.md` : add `/nodes/alive-between` to smoke loop
- `patches/upstream-all.diff` : regen on each task commit (PowerShell Out-File -Encoding Unicode workflow)

## 10. Open questions for review

Aucune — toutes les décisions cadres (D1-D6) ont été validées en brainstorm. Si quelque chose mérite challenge au moment de l'implém :
- Faut-il un toast "Temporal filter active" en permanence quand mode ≠ 'off' ? (UX feedback)
- Faut-il un keyboard shortcut pour cycler les modes (e.g., `F` ou `Shift+F`) ?
- Pour `permissive` + `diff`, la couleur des intermédiaires (proposed bleu/40%) doit-elle être configurable ?

Ces 3 questions peuvent être tranchées à l'implém ou différées à v1.1.
