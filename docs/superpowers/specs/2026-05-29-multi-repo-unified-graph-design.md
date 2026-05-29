# Multi-Repo Unified Graph — Design

**Date** : 2026-05-29
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Origine** : Item enterprise "Multi-repo support — unified graph across repositories" (ROADMAP § Enterprise, verdict 🟡 → analytics cross-repo livrées mais pas de graphe fusionné).
**Depends on** : upstream `gitnexus group` (CLI, `src/cli/group*.ts` + `src/core/group/`), `GET /api/graph` (single-repo), le volume partagé `gitnexus-data` (`/data/gitnexus`, monté dans les 2 conteneurs), le pattern wiki-worker (2e process dans le conteneur gitnexus), le Sigma canvas web.

---

## 1. Context / problem

On a des **analytics** cross-repo (`/coupling/cross`, `/growth/cross`, `/similarity`, galaxy view) mais **aucun graphe fusionné** : impossible de voir, dans un seul canvas, les nodes de repo A + repo B avec les arêtes entre eux. L'item enterprise upstream vend "unified graph across repositories".

Exploration (2026-05-29) — verdict :
- Le graphe fusionné **n'existe pas** à surfacer. L'upstream `group` construit un *registre de contrats* (HTTP routes / gRPC / Thrift / topics / shared-libs matchés cross-repo → `contracts.json` + `bridge.lbug`), garde les graphes per-repo **séparés**, et est **CLI-only** (zéro endpoint API, zéro UI).
- Mais les briques existent : `GET /api/graph?repo=X` (graphe per-repo), la clé de jointure cross-repo = `symbolUid` (les `CrossLink.from/to` mappent sur les `n.id` de chaque lbug), et `~/.gitnexus/groups/<name>/` vit sur le volume `gitnexus-data` **partagé** (le conteneur web lit `contracts.json` directement).
- Scale : le canvas Sigma est fluide à ~5k nodes, jouable à ~20k, 50k+ techniquement. Fusionner 2 vrais repos au niveau symbole peut dépasser le plafond fluide.

## 2. Goal

Un **graphe multi-repo unifié** dans le canvas web : un *groupe nommé* de repos, des nodes **au niveau fichier** colorés par repo, et des **arêtes cross-repo sémantiques** (contrats upstream `group`) entre fichiers. Géré de bout en bout : créer/synchroniser un groupe (trigger CLI dans le conteneur gitnexus), endpoint merged-graph (conteneur web), rendu + drill-in (frontend). File-level pour la scalabilité, drill-in symbole pour le détail.

Succès = je crée un groupe `{A,B}`, je le synchronise, j'ouvre le "Group graph" : je vois les fichiers de A et B colorés par repo + les arêtes contrat (A appelle une route HTTP servie par B, etc.), et je peux drill-in un fichier pour ses symboles.

## 3. Décisions cadres (validées en brainstorm 2026-05-29)

| Décision | Choix | Raison |
|---|---|---|
| Scope | **Full en un spec** : groupe + sync + merged-graph + arêtes sémantiques + UI | Choix utilisateur. 4 sous-systèmes bornés. |
| Modèle de groupe | **Groupe nommé via le registre `group` upstream** (`?group=<name>`) | Modèle natif ; les arêtes sémantiques (`group sync`) opèrent sur un groupe nommé dans `~/.gitnexus/groups/<name>/`. |
| Granularité | **File-level par défaut + drill-in symbole** | Scalabilité ; le bon niveau pour la structure cross-repo ; les contrats (symbolUid) roll-up vers fichiers. |
| Trigger sync | **Étendre le worker existant du conteneur gitnexus** (wiki-worker → endpoints group) | Pas de 3e process ; réutilise l'infra wiki (CMD wrapper + 2e process). |
| Lecture contrats | **Le conteneur web lit `/data/gitnexus/groups/<name>/contracts.json` directement** (volume partagé) | Pas besoin du worker pour LIRE ; seulement pour SYNCER (lancer la CLI). |
| Arêtes cross-repo | **CrossLinks des contrats `group`** (HTTP/gRPC/Thrift/topics/shared-libs) roll-up symbolUid→fichier | Sémantique réel ; clé `symbolUid`. |

### Alternatives écartées

| Alternative | Pourquoi écartée |
|---|---|
| Surfacer un graphe fusionné upstream existant | N'existe pas (group = registre de contrats, pas de graphe fusionné ; CLI-only). |
| Ad-hoc `?repos=A,B` + sync à la volée | Sync coûteux par vue ; état/cache murky. Le groupe nommé est persistant. |
| Symbol-level merged graph | Dépasse le plafond fluide sur 2 vrais repos ; le file-level est le bon niveau + drill-in pour le détail. |
| Dériver nos propres arêtes (shared symbol names / coupling-cross) | Les contrats `group` donnent des liens *sémantiques* (route/gRPC/topic), plus justes que des heuristiques de noms. |
| Ajouter les endpoints group au serveur API upstream (`api.ts`) | Patch core fragile aux bumps ; on reste dans nos modules + le worker. |

## 4. Design

### 4.1 Fichiers

```
upstream/wiki-worker.mjs (racine repo)   MOD  + endpoints group (POST /group/sync, GET /group/status) ; spawn `gitnexus group create/add/sync`
upstream/docker-server-group.mjs          NEW  conteneur web : POST /group/sync (proxy), GET /group/status (proxy), GET /groups (lecture volume)
upstream/docker-server-group-graph-core.mjs NEW  pur : collapseToFileLevel + mergeRepoGraphs (+ crossLink stitching)
upstream/docker-server-group-graph.mjs    NEW  conteneur web : GET /graph/merged?group= (union /api/graph per repo + contracts crossLinks)
upstream/docker-server.mjs                MOD  monte handleGroupRoute + handleGroupGraphRoute
upstream/Dockerfile.web                   MOD  COPY des 3 nouveaux docker-server-group*.mjs
upstream/gitnexus-web/src/components/GroupGraphPanel.tsx  NEW  group selector + create/sync form + status
upstream/gitnexus-web/src/hooks/useAppState.tsx           MOD  group-graph mode state (selectedGroup, mergedGraph load, back-to-single)
upstream/gitnexus-web/src/components/GraphCanvas.tsx (+ useSigma) MOD  repo-color reducer + cross-repo edge styling quand en mode merged
mcp-server/server.mjs                     MOD (option)  tool gitnexus_group_graph (read-only) — peut être Phase 2

tests/unit/group-graph-core.test.mjs               NEW  collapseToFileLevel + mergeRepoGraphs
tests/integration/endpoints/group-graph.test.mjs   NEW  /groups + /group/status + /graph/merged shape
tests/e2e/specs/group-graph.spec.ts                NEW  open group-graph mode → render

ROADMAP.md / INVENTORY.md / tests/README.md / CLAUDE.md   MOD
patches/upstream-all.diff                                 REGEN
docker-compose.yml / Dockerfile.cli — pas de changement (le worker + volume existent déjà)
```

### 4.2 Subsystem 1 — Group-sync trigger (conteneur gitnexus, extend `wiki-worker.mjs`)

The wiki-worker is the 2nd process already running in the gitnexus container (CMD wrapper, port 4748), spawning the `gitnexus` CLI. Add group endpoints (it becomes the general "gitnexus CLI task" worker):

- `POST /group/sync?name=<g>&repos=<repo1,repo2,...>` :
  1. Resolve each repo name → path (via `GET http://localhost:4747/api/repos`).
  2. `gitnexus group create <g>` (ignore "already exists"), then `gitnexus group add <g> <repoPath>` per member, then `gitnexus group sync <g>` — spawned (async, like wiki). In-progress map per group; 409 if already syncing.
  3. Returns `202 { started: true }`. `group sync` writes `~/.gitnexus/groups/<g>/{group.yaml,contracts.json,bridge.lbug,meta.json}`.
- `GET /group/status?name=<g>` → `{ syncing: bool, lastSyncedAt: ISO|null, error: string|null, contractCount: number|null }` (lastSyncedAt via mtime of `contracts.json`; contractCount via a quick read).
- Reuse the worker's existing spawn/in-progress/non-fatal patterns. Verify `gitnexus group` subcommands exist in the container (same binary as `gitnexus wiki`).

### 4.3 Subsystem 2 — Group management (conteneur web, `docker-server-group.mjs`)

`GITNEXUS_GROUPS_DIR = process.env.GITNEXUS_HOME ? join(GITNEXUS_HOME,'groups') : '/data/gitnexus/groups'`.

- `POST /group/sync?name=&repos=` → proxy to worker `http://gitnexus:4748/group/sync`.
- `GET /group/status?name=` → proxy worker status.
- `GET /groups` → list subdirs of `GITNEXUS_GROUPS_DIR`, each with `{ name, repos: <from group.yaml>, lastSyncedAt: <contracts.json mtime>, contractCount }`. Reads the shared volume directly (no worker).

### 4.4 Subsystem 3 — Merged graph (conteneur web)

**Pure core (`docker-server-group-graph-core.mjs`):**

```js
// Collapse a single-repo /api/graph result to file-level. Returns
// { nodes: [{ id:'<repo>::<filePath>', label, repo, kind:'file', filePath }],
//   edges: [{ source, target }] } — symbol nodes folded into their file,
//   symbol→symbol edges rolled up to file→file (dedup, drop self-loops).
export function collapseToFileLevel(graph, repo) { ... }

// Merge N collapsed repo graphs + add cross-repo edges from group crossLinks.
//   collapsed: CollapsedGraph[]   (one per repo)
//   crossLinks: [{ from:{repo,symbolUid}, to:{repo,symbolUid}, matchType }]
//   symbolToFile: Map<`${repo}::${symbolUid}`, filePath>  (built from /api/graph)
// Returns { nodes, edges } where cross-repo edges carry { crossRepo:true, matchType }.
export function mergeRepoGraphs(collapsed, crossLinks, symbolToFile) { ... }
```

Node id namespacing: `"<repo>::<filePath>"` (so same-named files in different repos don't collide). `symbolToFile` is built while reading each repo's `/api/graph` (each symbol node carries its file).

**I/O (`docker-server-group-graph.mjs`):** `GET /graph/merged?group=<name>` :
1. Read `~/.gitnexus/groups/<name>/group.yaml` → member repos. 404 if group not found/synced.
2. Per repo (parallel): `GET ${GITNEXUS_API}/api/graph?repo=<repo>` where `GITNEXUS_API = http://gitnexus:4747` (the upstream API server — `/api/graph` lives there, NOT on the web server) → `collapseToFileLevel` + build the `symbolToFile` map.
3. Read `contracts.json` → `crossLinks`.
4. `mergeRepoGraphs(collapsed, crossLinks, symbolToFile)`; apply `GROUP_GRAPH_NODE_CAP` (env, default 8000 — prioritize files touched by cross-repo edges + their neighbors).
5. Respond `{ group, repos: [{ name, color }], nodes, edges, crossRepoEdgeCount, capped: bool }`.

(`/api/graph` is the upstream API server route on :4747 — reachable from the web container as `http://gitnexus:4747/api/graph`. Use that base for step 2, NOT the loopback, since `/api/graph` lives on the API server, not the web server.)

### 4.5 Subsystem 4 — Frontend

- **`GroupGraphPanel.tsx`** : lists groups (`GET /groups`); a create/sync form (name + repo multi-select from `availableRepos` → `POST /group/sync`, poll `GET /group/status`); a "View" action per synced group.
- **useAppState** : `groupGraphMode` state — `selectedGroup`, `mergedGraph` (loaded from `/graph/merged?group=`), `enterGroupGraph(name)` / `exitGroupGraph()`. When active, the main canvas renders `mergedGraph` instead of the single-repo graph; a "← Back to single repo" control exits.
- **GraphCanvas / useSigma** : when in merged mode, a node-color reducer colors by `node.repo` (per-repo palette + a legend overlay), and cross-repo edges (`edge.crossRepo`) get a distinct style (thicker + amber). File-level nodes; clicking a file → drill-in to its symbols (reuse the existing node-click/right-panel; v1 may just show the file's metadata + a "open in single-repo view" link if full symbol drill-in is heavy).
- Entry point: a "Group graph" button (Header or a toolbar control) opening `GroupGraphPanel`.

## 5. Edge cases

| Cas | Comportement |
|---|---|
| Groupe non synchronisé / inexistant | `/graph/merged` 404 `{ error:'group not synced' }` ; le panel propose Sync |
| `group sync` échoue (repo non analysé, etc.) | worker capture l'erreur ; `/group/status.error` ; le panel l'affiche ; pas de merged graph |
| 2 repos sans contrats partagés | merged graph = 2 clusters colorés, **0 arête cross-repo** (correct, pas un bug) ; banner "no cross-repo links found" |
| Graphe fusionné > cap | tronqué à `GROUP_GRAPH_NODE_CAP` (priorité aux fichiers cross-repo-liés + voisins) ; `capped:true` ; banner |
| `crossLink` symbolUid absent du graphe collapsé (symbole filtré) | arête droppée silencieusement (pas de node fantôme) |
| Drill-in symbole lourd | v1 : clic fichier → métadonnées + lien "ouvrir en vue single-repo" ; symbol drill-in complet = amélioration |
| `gitnexus group` indisponible dans le conteneur | Task 1 du plan vérifie `gitnexus group --help` ; sinon STOP |

## 6. Testing strategy

- **Unit** (`tests/unit/group-graph-core.test.mjs`) : `collapseToFileLevel` (symboles repliés sur fichiers, edges roll-up + dedup + self-loops droppés, id namespacé `<repo>::<file>`) ; `mergeRepoGraphs` (union N repos, crossLinks → file→file edges via symbolToFile, crossLink orphelin droppé, crossRepo flag).
- **Integration** (`tests/integration/endpoints/group-graph.test.mjs`) : `GET /groups` (200, array shape) ; `GET /group/status?name=x` (200/502 shape) ; `GET /graph/merged?group=x` → 404 si non synchronisé, ou 200 `{ nodes, edges, repos, crossRepoEdgeCount }` shape. Sync mocké/optionnel (pas de vrai group sync en CI).
- **E2E** (`tests/e2e/specs/group-graph.spec.ts`) : ouvrir le Group graph panel, (si un groupe synchronisé existe) cliquer View → le canvas rend des nodes ; sinon asserter le panel + le formulaire create/sync. Best-effort (un vrai group sync n'est pas garanti en e2e).
- **Smoke** (CLAUDE.md) : `GET /groups` → 200 ; `GET /graph/merged?group=<probably-absent>` → 404 (routing OK).
- **Build** : `docker compose build gitnexus gitnexus-web` (les 2 — le worker change dans gitnexus, les modules + frontend dans web). Manual : créer un vrai groupe de 2 repos analysés partageant un contrat, sync, view.

## 7. Out of scope (futurs)

- **MCP tool** `gitnexus_group_graph` — read-only wrapper sur `/graph/merged` ; trivial à ajouter, peut être un follow-up.
- **Symbol-level merged graph** (vs file-level) — drill-in complet ou toggle.
- **Cross-repo edges dérivées** (au-delà des contrats : shared symbol names, coupling-cross) — enrichissement.
- **Layout pré-calculé** pour les très gros groupes (le layout-worker-pool existe) — si on dépasse le cap régulièrement.
- **Group management dynamique** (remove repo, delete group) — v1 = create + add + sync + view.

## 8. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| `gitnexus group` absent/différent dans le conteneur | **Moyen** | Task 1 vérifie `gitnexus group --help` ; même binaire que `gitnexus wiki` (qui marche). |
| `group sync` lent (scan lbugs + extracteurs) + nécessite repos analysés | Moyen | Async + status (pattern wiki) ; le panel montre un spinner ; doc "analyze repos first". |
| Fidélité du collapse file-level (roll-up des edges) | Moyen | Pure fn + golden unit tests ; edges dédupliqués, self-loops droppés. |
| Scale même en file-level (gros monorepo) | Moyen | `GROUP_GRAPH_NODE_CAP` (8000) + priorité cross-repo ; `capped` banner. |
| `/api/graph?repo=` lourd × N repos | Moyen | Parallèle ; file-collapse réduit la charge frontend ; cap. |
| Arêtes contrats éparses (repos non couplés) | Faible | Documenté : 2 clusters sans arête = correct ; banner explicatif. |
| Étendre wiki-worker brouille son nom | Faible | Commenter qu'il est désormais le worker "gitnexus CLI tasks" (wiki + group) ; pas de 3e process. |
| `/api/graph` base = API server (4747) pas web (4173) | Faible | Documenté en § 4.4 : step 2 utilise `http://gitnexus:4747/api/graph`. |

## 9. Effort estimate

| Sous-système / tâche | Effort |
|---|---|
| 1. Group-sync endpoints dans wiki-worker | ~1-1.5j |
| 2. docker-server-group.mjs (sync proxy + status + /groups) | ~1j |
| 3a. Core pur (collapseToFileLevel + mergeRepoGraphs) + unit | ~2j |
| 3b. docker-server-group-graph.mjs (union + crossLinks + cap) | ~1.5j |
| 4a. GroupGraphPanel + group state + sync flow | ~2j |
| 4b. Canvas repo-coloring + cross-repo edge styling + legend + back-toggle | ~2-3j |
| Mount + Dockerfile.web + integration + e2e | ~1.5j |
| Docs + build + smoke | ~1j |
| **Total** | **~12-15 jours (~15-18 tasks)** |

## 10. Document updates checklist (à la livraison)

- `ROADMAP.md` : nouvelle ligne "Déjà livré" + dans la table enterprise, "Multi-repo support" 🟡 → ✅ (graphe unifié livré). Bump date header.
- `INVENTORY.md` : endpoints `/groups`, `/group/sync`, `/group/status`, `/graph/merged` ; modules group ; worker étendu ; GroupGraphPanel + canvas merged mode.
- `CLAUDE.md` : smoke `/groups` + `/graph/merged` ; note le worker étendu (group sync) + le merged mode.
- `tests/README.md` : unit group-graph-core + integration group-graph + e2e group-graph.
- `patches/upstream-all.diff` : regen.
