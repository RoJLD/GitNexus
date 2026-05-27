# Layout Persistence + Background Pre-compute design

**Date** : 2026-05-27
**Status** : current
**Auteur** : Robin DENIS (post-Augmented-Timeline UX test)
**Trigger** : Augmented Timeline self-test révèle 2 bugs UX :
1. **Animate roadmap** = "grand reload" entre chaque snapshot step (camera + layout from scratch, 3-5s/step)
2. **Layout FA2 toujours from scratch** à chaque ouverture / repo switch — positions jamais persistées

---

## 1. Context / problem

`useSigma.setGraph(newGraph)` appelle systématiquement `runLayout(newGraph)` qui lance FA2 from scratch (graphology-layout-forceatlas2 sync, blocking). Conséquences :
- **Play roadmap loop** : Timeline → `handlePlay` → `switchRepo` → `setGraph` → `runLayout` à chaque tick. User voit le graph "exploser" puis se réorganiser entre chaque snapshot.
- **Repo switch / reload** : même comportement.
- **`snapshotCacheRef`** cache déjà le résultat analyze (nodes + edges), mais **pas** les positions FA2 — donc chaque revisite paie le coût layout complet.

## 2. Goal

Trois mécanismes complémentaires :

1. **Layout cache localStorage** : sauvegarder les positions FA2 après convergence, restaurer instantanément au prochain `setGraph` avec le même cacheKey. Évite le `runLayout` répétitif.
2. **Pre-compute worker** : pendant `Preload all snapshots` (feature existante), lancer aussi FA2 en Web Worker pour chaque snapshot pré-fetché. Premier Play roadmap = instant.
3. **Recompute layout button** : bouton dans Header pour forcer un re-run FA2 manuel (si l'user trouve le layout cached sous-optimal après modifications).

## 3. Design

### 3.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| IndexedDB au lieu de localStorage | Plus de plumbing pour pour ~50KB par snapshot. Une vingtaine de snapshots × 50KB = 1MB ; localStorage holds 5-10MB sans souci. |
| Sidecar serveur `.gitnexus/layout.json` | Couple le frontend au backend. Layout = pure visualisation client, n'a aucune raison d'être persisté côté serveur. |
| Compute FA2 main thread mais avec setTimeout chunks | Bloque quand même l'UI pendant 3-5s. Worker = vraie parallélisation. |
| Pas de cache, juste skip si nodes identiques | Snapshots ont nodes différents par définition. Skip impossible. |
| Cache positions PAR NODE ID seulement (pas par snapshot) | Faux positifs : un node `src/auth/login.ts` a une position différente selon le contexte (autres nodes du snapshot). Cache par snapshot = positions cohérentes avec le voisinage. |

### 3.2 Approche retenue

#### Architecture

```
upstream/gitnexus-web/src/
├── lib/
│   ├── layout-cache.ts                  NEW  localStorage Map<cacheKey, positions>
│   └── layout-worker.ts                 NEW  Worker source : FA2 in background
├── hooks/
│   ├── useSigma.ts                      MOD  setGraph(graph, cacheKey?), persist on convergence, recompute button helper
│   └── useAppState.tsx                  MOD  pass cacheKey through switchRepo, Preload spawns workers

components/
├── Header.tsx                           MOD  +button "Recompute layout"
└── Timeline.tsx                         MOD  +banner during initial cache fill (optional)

tests/
└── unit/
    └── layout-cache.test.mjs            NEW  save/restore + version invalidation + cap
```

#### `layout-cache.ts` shape

```ts
const STORAGE_PREFIX = 'gitnexus:layout:v1:';

export type CachedLayout = {
  version: 1;
  cacheKey: string;        // e.g. "hmm_studio@c2ac699"
  computedAt: string;      // ISO
  nodeCount: number;
  positions: Record<string, { x: number; y: number }>;
};

export function saveLayout(cacheKey: string, graph: Graph): void;       // reads graph.x/y per node, writes to localStorage
export function loadLayout(cacheKey: string): CachedLayout | null;       // returns null if absent or corrupt
export function applyLayoutToGraph(cached: CachedLayout, graph: Graph): { applied: number; missing: number };
export function clearLayout(cacheKey: string): void;
export function clearAllLayouts(): void;                                 // user "wipe" hatch
```

**Threshold** : `applyLayoutToGraph` retourne `{applied, missing}`. Si `missing / nodeCount > 20%`, le caller décide de re-run layout (graph trop différent du cache).

#### `useSigma.setGraph` modification

```ts
setGraph(newGraph, { cacheKey }: { cacheKey?: string } = {}) {
  graphRef.current = newGraph;
  sigma.setGraph(newGraph);
  setSelectedNode(null);

  if (cacheKey) {
    const cached = loadLayout(cacheKey);
    if (cached) {
      const { applied, missing } = applyLayoutToGraph(cached, newGraph);
      const coverage = applied / newGraph.order;
      if (coverage >= 0.8) {
        sigma.refresh();
        sigma.getCamera().animatedReset({ duration: 200 });
        return; // SKIP layout entirely
      }
    }
  }

  // Cache miss or low coverage → run layout, save on convergence
  runLayout(newGraph, { cacheKey });
  sigma.getCamera().animatedReset({ duration: 500 });
}
```

`runLayout` accepts an optional `cacheKey` and calls `saveLayout(cacheKey, graph)` inside the `setTimeout(...)` after FA2 converges.

#### Worker pre-compute

`lib/layout-worker.ts` est un Worker source (Vite-supported via `?worker` import) :

```ts
// layout-worker.ts (runs in worker context)
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

self.onmessage = (e) => {
  const { graphData, settings, cacheKey } = e.data;
  const graph = Graph.from(graphData); // serialized graph
  forceAtlas2.assign(graph, { iterations: 200, settings });
  const positions: Record<string, {x: number; y: number}> = {};
  graph.forEachNode((id, attrs) => { positions[id] = { x: attrs.x, y: attrs.y }; });
  self.postMessage({ cacheKey, positions, nodeCount: graph.order });
};
```

Triggered from `useAppState.preloadAllSnapshots` after each snapshot is added to `snapshotCacheRef` :
- If `loadLayout(repoName)` returns null, spawn worker with `graphData = graph.export()` + `cacheKey = repoName`.
- Worker computes FA2 (200 iterations, ~1-2s in worker), posts positions back.
- Main thread receives positions, writes to localStorage via `saveLayout`.

Worker pool of 2 (parallèle bounded — sinon CPU thrash). Cancellable on repo switch.

#### Header "Recompute layout" button

In `Header.tsx`, near the graph controls (zoom, etc.) :
```tsx
<button title="Force re-run layout (current graph)" onClick={() => {
  const graph = sigmaRef.current?.getGraph();
  if (!graph || !projectName) return;
  clearLayout(projectName); // wipe cache
  runLayout(graph, { cacheKey: projectName }); // re-run
}}>
  Recompute layout
</button>
```

#### Tests

| Test | Fichier | Couvre |
|---|---|---|
| Layout cache | `tests/unit/layout-cache.test.mjs` | saveLayout / loadLayout / applyLayoutToGraph (coverage threshold) / version invalidation |

(Worker harness needs jsdom + a worker mock — out of scope for v1 ; CI integration test verifies the live flow.)

## 4. Scope boundaries

**In-scope** :
- `layout-cache.ts` (localStorage)
- `layout-worker.ts` (worker source + invocation)
- `useSigma.setGraph(graph, {cacheKey})` extension
- `useAppState.preloadAllSnapshots` worker spawn
- Header "Recompute layout" button
- 1 unit test (cache)
- Wiring docs

**Out-of-scope** :
- IndexedDB migration
- Server-side layout persistence
- Per-node position diffing for graph transitions (cross-snapshot interpolation)
- Layout algorithm choice UI (FA2 only for v1)
- Cache eviction policy (localStorage budget 5MB — let browser handle)
- Layout shared across repos (per repo+sha only)

## 5. Open questions

1. **localStorage cap** : 5MB browser default. 20 snapshots × 50KB = 1MB, fine. Si user a 100 snapshots × 100KB = 10MB → écrasement silencieux par le browser. Solution : LRU eviction si total > 4MB (basique : tri par computedAt, drop oldest). **Out-of-scope MVP**, sera ajouté si user observe le pattern.
2. **Worker spawn count** : 2 parallèle. Si machine moderne (4+ cores), 3 serait OK ; sur machine plus modeste, 1 suffit. Hard-coded 2 v1, future config.
3. **Cancel worker on repo switch** : oui — abortController équivalent via `worker.terminate()`. 
4. **What if user edits ROADMAP.md after layout cached** : layout positions inchangées (les nodes existants n'ont pas bougé). Nouveaux nodes (ajoutés depuis le cache) déclencheront re-run via coverage threshold < 80%.
5. **Version field** : cache schema versioned (`version: 1`). Future bumps invalidate l'ancien cache. **Résolu.**

## 6. Effort estimé

**~1.5 jour** total :

| Composant | Effort |
|---|---|
| `layout-cache.ts` (localStorage + tests) | 0.25 j |
| `useSigma.setGraph` cache restore + skip layout | 0.25 j |
| `runLayout` save on convergence | 0.1 j |
| `layout-worker.ts` + worker pool spawn | 0.5 j |
| Header "Recompute layout" button + Timeline banner | 0.25 j |
| Wiring docs + spec Update — Shipped | 0.15 j |

## 7. Suite

Plan d'implémentation via `superpowers:writing-plans`. Spec rédigé hors-cadre IDEAS-PARKING (bug-fix UX).

---

## Update 2026-05-27 — Shipped

Layout persistence + worker livré. Notes :

- `lib/layout-cache.ts` (localStorage `gitnexus:layout:v1:<cacheKey>` + version field + `applyLayoutToGraph` coverage threshold 80%). 5 pure fns exportées : `saveLayoutPositions`, `saveLayoutFromGraph`, `loadLayout`, `applyLayoutToGraph`, `clearLayout`, `clearAllLayouts`.
- `useSigma.setGraph(g, { cacheKey })` restore positions si hit AND ≥80% coverage, else fallback to FA2 (qui sauvegarde sur convergence dans le `setTimeout` callback existant). `useSigma.recomputeLayout(cacheKey)` exposé pour le bouton manuel.
- `lib/layout-worker.ts` Vite Worker (Graph.from + FA2 + noverlap) + `lib/layout-worker-pool.ts` (pool size 2) spawned during `preloadAllSnapshots`. Pool terminé sur switch de base repo (`switchRepo`) et sur `clearSnapshotCache`.
- Header `Recompute layout` button (icône Network) → `useAppState.recomputeLayout` → bridge ref `recomputeLayoutRef` ↔ `useSigma.recomputeLayout` (registered par GraphCanvas via `registerRecomputeLayout` useEffect).
- `GraphCanvas.tsx` useEffect : `setSigmaGraph(graph, { cacheKey: projectName })` — `projectName` contient déjà `@<sha>` pour les snapshots (cache key naturel).
- 1 test unitaire `tests/unit/layout-cache.test.mjs` (5 cas : round-trip, version guard, apply coverage, clear single, clear all). Tests worker différés (jsdom + worker mock).
- Open question 1 du spec (localStorage cap, ~5 MB) : LRU eviction non implémenté MVP — sera ajouté si user observe quota errors (le `try/catch` autour de `setItem` empêche déjà le crash).

Déviation mineure vs plan : Task 4 modifie `GraphCanvas.tsx` (point d'appel réel de `useSigma.setGraph`) plutôt que `useAppState.switchRepo` (qui n'invoque que le React state setter `setGraph: KnowledgeGraph → void`). Le cacheKey transite via `projectName` lu sur appState, ce qui couvre les deux call-sites de switchRepo (fast path cache + slow path fetch) automatiquement.
