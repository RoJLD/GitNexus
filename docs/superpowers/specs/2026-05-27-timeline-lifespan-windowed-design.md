# Lifespan Windowed (cursors A/B as bounds) — Design

**Date** : 2026-05-27
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Phase** : Phase 2 Item #3 sur 5 (Item #2 Mode union subsumed by Phase 2 Item #1 Permissive)
**Depends on** : [Phase 2 Item #1 Temporal Filter](2026-05-27-timeline-temporal-filter-design.md) — `temporalFilterMode` state + `/nodes/alive-between` endpoint (reuse for windowed ephemeral)

---

## 1. Context / problem

Le `/lifespan` actuel calcule 4 buckets sur **toute l'histoire** du repo :
- `foundational` = présent dans **1er snapshot** ET dans **live**
- `recent` = apparu après 1er snapshot, présent dans live
- `discontinued` = présent au début, disparu en live
- `ephemeral` = apparu après 1er, disparu avant live

La décision de Phase 1 Timeline était "Lifespan reste global" (pas de recalcul par fenêtre — évite le re-fetch à chaque scrub). Mais une fois qu'on a stabilisé les cursors A/B et le temporal filter (Phase 2 Item #1), il devient cohérent — voire attendu — que Lifespan reflète la **fenêtre** sélectionnée plutôt que toute l'histoire.

Cas d'usage qu'on rate :
- "Quels fichiers étaient déjà là à A ET le sont toujours à B ?" — actuellement obligé de croiser /lifespan global avec snapshot bounds manuellement
- "Quels fichiers sont apparus dans ce sprint [A, B] ?" — pas direct, /lifespan donne "recent" relatif à toute l'histoire, pas au sprint
- "Quels ephemerals (créés puis supprimés) sont morts dans cette release ?" — invisible avec /lifespan global puisque ces nodes sont déjà classés ephemeral par rapport à toute l'histoire

## 2. Goal

Quand le user a un **filtre temporel actif** (`temporalFilterMode !== 'off'`), le panneau Lifespan recompute ses 4 buckets sur la fenêtre **[cursorA, cursorB]** au lieu de toute l'histoire, avec les redéfinitions :

- `foundational` = présent dans **snapshot A** ET dans **snapshot B** (intersection — survit toute la fenêtre)
- `recent` = absent de A, présent dans B (apparu pendant la fenêtre, survit à la fin)
- `discontinued` = présent dans A, absent de B (disparu pendant la fenêtre)
- `ephemeral` = absent de A, présent dans un snapshot intermédiaire, absent de B (apparu+disparu dans la fenêtre)

UX feedback : le header du LifespanPanel passe de "Lifespan" à "Lifespan (window)" + badge daterange compact `Δ X days · Y snapshots`.

Quand `temporalFilterMode === 'off'`, comportement **strictement identique à aujourd'hui** (Phase 1 acquired).

## 3. Decisions cadres (validées en brainstorm)

| Décision | Choix retenu | Raison |
|---|---|---|
| **D1** Trigger | `temporalFilterMode !== 'off'` | Single source of truth. Si user filtre le graphe, le panneau suit. Pas de selector additionnel. |
| **D2** Endpoint shape | Extend `/lifespan?repo=&from=&to=` avec params optionnels | Backward-compatible. Cohérent avec `/nodes/alive-between` de Item #1. |
| **D3** UX feedback | Header text + badge daterange | Discret + clair, pattern cohérent avec l'indicateur de durée Timeline Phase 1. |
| **D4** (impl) Computing ephemeral fenêtré | Réutiliser `/nodes/alive-between` pour récupérer la window-union, puis croiser avec snapshots A et B | Pas de nouveau endpoint. Réutilise la machinerie Permissive existante. |
| **D5** (impl) Lifespan global vs windowed | Branchement au niveau du handler `/lifespan` : si `from`/`to` présents, mode windowed ; sinon global (current) | Same endpoint, behavior switches sur params. |

## 4. Design

### 4.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| Nouveau endpoint `/lifespan/windowed` | Plus de routing, pas de bénéfice. Backward-compat plus difficile. |
| Toggle séparé dans LifespanPanel ("Scope: Global/Window") | Multiplie les sources de vérité. User doit maintenir 2 toggles synchros. |
| Auto-activation quand cursors set (toujours windowed) | Casse l'attente "Lifespan reste global par défaut" de Phase 1. Surprise inattendue. |
| Re-utiliser la sémantique de `/nodes/alive-between` directement (no endpoint change) | Le windowed-lifespan retourne 4 buckets, pas juste un nodeIds set. Donc nécessite logique supplémentaire en backend. |
| Calcul windowed client-side via fetchGraph(A) + fetchGraph(B) + nodes-alive-between | Faisable mais le panel re-fetch à chaque cursor move = perf hit. Le backend cache est plus pragmatique. |

### 4.2 Approche retenue : extension du `/lifespan` endpoint + réutilisation `/nodes/alive-between`

#### Backend logic

Le handler `/lifespan` reçoit `?from=<shortHash|oldest>&to=<shortHash|live|newest>`. Si **les deux sont présents**, mode windowed :

1. Resolve aliases (réutilise la logique d'Item #1's `nodes-alive-between` — `oldest` → first sorted snapshot, `live`/`newest` → last)
2. Filter snapshots to window [from, to] inclusive
3. Identify `snapshotA` (first in window) et `snapshotB` (last in window)
4. Fetch graphs of A and B (via `/api/graph`)
5. Compute :
   - `idsA = Set(graphA.nodes.id)`
   - `idsB = Set(graphB.nodes.id)`
6. For ephemeral, call internal `unionSnapshotNodeIds` (réutilise pure fn de Item #1 Task 2) sur les snapshots intermédiaires (strictement entre A et B, exclusive) ; un node est ephemeral si présent dans cette union ET absent de A et de B
7. Build 4 buckets selon les nouvelles définitions
8. Return même shape que global, avec un champ supplémentaire `windowed: { from, to, snapshotCount }`

```javascript
// Pseudo-code
if (from && to) {
  const { resolvedFrom, resolvedTo, windowed } = resolveAndFilter(snapshots, from, to);
  const snapA = windowed[0];
  const snapB = windowed[windowed.length - 1];
  const graphA = await fetch('/api/graph?repo=' + snapA.name);
  const graphB = await fetch('/api/graph?repo=' + snapB.name);
  const idsA = new Set(graphA.nodes.map(n => n.id));
  const idsB = new Set(graphB.nodes.map(n => n.id));

  // Ephemeral : union des intermediates seulement
  const intermediates = windowed.slice(1, -1);
  let ephemeralIds = new Set();
  if (intermediates.length > 0) {
    const interGraphs = await Promise.all(intermediates.map(s =>
      fetch('/api/graph?repo=' + s.name).then(r => r.json())
    ));
    const interUnion = unionSnapshotNodeIds(interGraphs);
    // A node is ephemeral if in intermediates but in neither A nor B
    ephemeralIds = new Set([...interUnion].filter(id => !idsA.has(id) && !idsB.has(id)));
  }

  // Buckets
  const foundational = [...idsA].filter(id => idsB.has(id));
  const recent       = [...idsB].filter(id => !idsA.has(id));
  const discontinued = [...idsA].filter(id => !idsB.has(id));
  const ephemeral    = [...ephemeralIds];

  return {
    counts: { foundational: foundational.length, recent: recent.length, discontinued: discontinued.length, ephemeral: ephemeral.length },
    nodes: {
      foundational: foundational.map(id => enrichNode(id, graphA)),
      recent:       recent.map(id => enrichNode(id, graphB)),
      discontinued: discontinued.map(id => enrichNode(id, graphA)),
      ephemeral:    ephemeral.map(id => /* enrich from intermediate where first found */),
    },
    windowed: { from: resolvedFrom, to: resolvedTo, snapshotCount: windowed.length },
  };
}
// else : existing global logic unchanged
```

#### Caching

Cache key : `(repo, from, to, windowed.length)` dans `<repoPath>/.gitnexus/lifespan-cache.json`. Stable jusqu'à ce qu'un nouveau snapshot tombe dans la window. Pattern identique à `/nodes/alive-between`.

#### Frontend changes

**`useAppState.tsx`** : ajouter un effect watcher qui re-fetch `/lifespan` quand `temporalFilterMode !== 'off'` ET cursorA/cursorB set. Le `lifespanData` state existant reçoit la nouvelle réponse (avec champ `windowed` optionnel).

```typescript
// Effect (additif à l'existant lifespan effect)
useEffect(() => {
  if (!lifespanActive) return;
  if (!projectName) return;

  const baseRepo = projectName.split('@')[0];
  let url;

  if (temporalFilterMode === 'off' || !cursorA || !cursorB) {
    // Global mode (current behavior)
    url = `/lifespan?repo=${encodeURIComponent(baseRepo)}`;
  } else {
    // Windowed mode
    const repo = availableRepos.find(r => r.name === baseRepo);
    const refA = repo?.snapshots?.find(s => s.commit?.date === cursorA);
    const refB = repo?.snapshots?.find(s => s.commit?.date === cursorB);
    const fromHash = refA?.commit?.shortHash ?? (repo?.indexedAt === cursorA ? 'oldest' : null);
    const toHash = refB?.commit?.shortHash ?? (repo?.indexedAt === cursorB ? 'live' : null);
    if (!fromHash || !toHash) {
      // Fallback to global
      url = `/lifespan?repo=${encodeURIComponent(baseRepo)}`;
    } else {
      url = `/lifespan?repo=${encodeURIComponent(baseRepo)}&from=${fromHash}&to=${toHash}`;
    }
  }
  // fetch + setLifespanData(data) — reuses existing wiring
}, [lifespanActive, projectName, temporalFilterMode, cursorA, cursorB, availableRepos]);
```

**`LifespanPanel.tsx`** :
- Si `lifespanData.windowed` existe (cad. backend returned windowed shape), afficher dans le header :
  - Title : "Lifespan **(window)**"
  - Badge sous le title : `2026-01-15 → 2026-03-22 · Δ 67 days · 14 snapshots` (réutilise `formatWindowDuration` de Timeline si possible)
- Sinon header inchangé.

#### Architecture (files)

```
upstream/
├── docker-server-lifespan.mjs                MOD  Add windowed branch when from/to provided
└── gitnexus-web/src/
    ├── hooks/useAppState.tsx                 MOD  Effect watcher branches on temporalFilterMode
    └── components/LifespanPanel.tsx          MOD  Header text + badge when data.windowed
```

```
tests/
├── unit/lifespan-windowed-core.test.mjs      NEW  Pure fn : computeWindowedBuckets(graphA, graphB, intermediateGraphs)
├── integration/endpoints/lifespan-windowed.test.mjs  NEW  GET /lifespan?from=&to= happy + 400 invalid window
└── e2e/specs/lifespan-windowed.spec.ts       NEW  Toggle dropdown active → Lifespan panel header shows (window) badge
```

Aucun nouveau endpoint. Aucune nouvelle dep.

### 4.3 Edge cases

| Case | Behavior |
|---|---|
| `from` set but `to` missing (or vice versa) | 400 — windowed mode requires both. Fall back to global only when BOTH missing. |
| `from === to` (single-snapshot window) | windowed length = 1 → all nodes in that snapshot are `foundational` (in A AND B, since A=B). Recent/discontinued/ephemeral empty. |
| Window has only 2 snapshots (A and B, no intermediates) | Ephemeral = always empty (no intermediates to look at). |
| Window has 0 snapshots (invalid range, e.g., aliases not resolvable) | 400 with explanation. |
| `temporalFilterMode === 'off'` but lifespanActive | Existing global behavior — no change. |
| User active LifespanPanel + filter active simultaneously | Two effects fire : (1) graph reducer hides nodes outside filter, (2) Lifespan recomputes on window. Independent, no conflict. |
| User drags cursor B while LifespanPanel open + filter active | Effect re-fires on cursorB change → re-fetch windowed lifespan. Loading spinner during compute. |
| Network error during ephemeral intermediates fetch | `ephemeral` bucket falls back to empty, return partial result with `warning` field. Better than blocking response. |

## 5. Testing strategy

### Unit

`tests/unit/lifespan-windowed-core.test.mjs` :
- `computeWindowedBuckets({idsA, idsB, ephemeralIds})` correctly distributes IDs across 4 buckets
- Empty intermediates → ephemeral = empty
- Identical A and B (single-snapshot) → all foundational, others empty
- No overlap between buckets (each ID belongs to exactly one)

### Integration

`tests/integration/endpoints/lifespan-windowed.test.mjs` :
- 200 with `?from=&to=` returns `windowed` field in response
- 200 without params returns global (no `windowed` field)
- 400 on missing `to` when `from` set
- 400 on invalid range (from > to)
- Cache hit on second identical call

### E2E

`tests/e2e/specs/lifespan-windowed.spec.ts` :
- Initial : Lifespan panel header = "Lifespan"
- Set Filter dropdown to "Strict" → after fetch, header becomes "Lifespan (window)" + badge visible
- Badge format matches `YYYY-MM-DD → YYYY-MM-DD · Δ X days · N snapshots`
- Reset Filter to "Off" → header reverts to "Lifespan"

## 6. Out of scope

- **Manual scope toggle in LifespanPanel** (independent of temporalFilterMode) — D1 rejected. If user wants it later, easy add.
- **Per-bucket window override** (e.g., compute foundational over [A,B] but ephemeral over [A-3, B+3]) — too niche.
- **Animated transitions** between global and windowed counts — UX polish, defer.

## 7. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| Ephemeral intermediates fetch coûteux sur fenêtres larges | Moyen | Cache identique pattern `/nodes/alive-between`. Pour windows >50 snapshots, log warning, possibly degrade ephemeral to empty (acceptable tradeoff). |
| Effect watcher fires too often (cursor drag generates many re-fetches) | Moyen | Debounce already inherited from Phase 1 — cursors update on mouse-up snap, not during drag. |
| User confused by switching semantics ("foundational" means something different windowed vs global) | Faible | Header text + badge make it explicit. Tooltip on header could explain if feedback indicates needed. |
| Race condition : filter mode + cursors change at the same time | Faible | Standard React effect handling, latest state wins. |
| Cache invalidation when new snapshot lands | Faible | Cache key includes `windowed.length` — adding a snapshot changes count, invalidates cache for any window containing the new snapshot. |

## 8. Effort estimate

| Phase | Tasks | Effort |
|---|---|---|
| Bootstrap | Pure fn `computeWindowedBuckets` + unit tests | ~½j |
| Backend | Extend `/lifespan` handler with windowed branch + cache + integration test | ~1-2j |
| Frontend useAppState | Effect watcher branches on temporalFilterMode | ~1j |
| Frontend LifespanPanel | Header text + badge | ~½j |
| E2E test | Playwright spec | ~½j |
| Docs | ROADMAP + INVENTORY + tests/README + CLAUDE smoke | ~½j |
| **Total** | | **~3-5 days** |

## 9. Document updates checklist

- `ROADMAP.md` : add row 49+ "Lifespan windowed" + bump date header
- `INVENTORY.md` : update `/lifespan` row to mention optional `from`/`to` params + LifespanPanel mention windowed mode
- `tests/README.md` : add 3 new tests (1 unit + 1 integ + 1 e2e)
- `CLAUDE.md` : add `/lifespan?from=oldest&to=live` to smoke loop (windowed variant)
- `patches/upstream-all.diff` : regen on each task commit

## 10. Open questions

None — D1-D5 validated in brainstorm. Minor implementation choice at writing-plans time : whether to extract `computeWindowedBuckets` as a pure fn (testable in isolation) or inline in the handler. **Recommandation : pure fn**, matches the pattern of Item #1 Task 2 (filterSnapshotsInWindow + unionSnapshotNodeIds) — keeps the handler thin.
