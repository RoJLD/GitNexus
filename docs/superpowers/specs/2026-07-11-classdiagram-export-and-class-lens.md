# Class-diagram export / class-lens — Spec + DoD (Tier 3, fork phase ii item 2)

> **Statut** : SPEC (design gelé, prêt à builder). Verdict du gate = **BUILD** (pas d'abandon).
> **Date** : 2026-07-11. **Branche** : `feat/classdiagram-export-and-class-lens`.
> **Discipline** : spec-first (roadmap phase ii item 2 : « spec + DoD d'abord → build »).

## 0. TL;DR

Ajouter une **lens dérivée niveau-classe** (`projectClassDiagram` dans `docker-server-graph-lens-core.mjs`)
+ un **renderer mermaid `classDiagram`** (`renderMermaidClass` dans `docker-server-sysml-export-core.mjs`)
exposé via `GET /sysml-export?repo=X&format=mermaid-class`. **v1 = classes/interfaces + membres +
associations** ; **héritage DIFFÉRÉ** (le KnowledgeGraph n'émet pas d'arête EXTENDS/IMPLEMENTS — mesuré).

## 1. Mesure de l'existant (2026-07-11, stack live sur `HMMstudio` : 3973 nœuds / 7858 arêtes)

**Ce que le fork rend DÉJÀ :**
- `docker-server-graph-lens-core.mjs` projette au **niveau FICHIER** : `projectImports` (schema `imports-deps`,
  arêtes IMPORTS) et `projectFileGraph` (toutes relations agrégées par paire de fichiers, kind `related`).
  Sortie `{nodes:[{id,type,label,path,stage}], edges:[{id,source,target,kind}]}` (consommée par
  `research-graph-adapter`). **Aucune projection niveau-classe.**
- `docker-server-sysml-export-core.mjs` : `renderPlantUml` + `renderMermaid` rendent les **GHOSTS**
  (architecture roadmap-predictive) en `graph TD` groupé par tier, arêtes `satisfy`/`deriveReqt`.
  **Ce n'est PAS un `classDiagram` mermaid** — ni des classes réelles.

**Donnée brute disponible dans le KnowledgeGraph (`/api/graph`)** — mesurée :

| Besoin classDiagram | Présent ? | Signal mesuré |
|---|---|---|
| Classes / interfaces | ✅ | `Class` ×60, `Interface` ×92 |
| Méthodes / propriétés | ✅ | `Method` ×102, `Property` ×318 ; arêtes `HAS_METHOD` ×105, `HAS_PROPERTY` ×271, `MEMBER_OF` ×808 |
| Associations | ✅ | `CALLS` ×1029, `CONTAINS` ×1449 |
| **Héritage EXTENDS/IMPLEMENTS** | ❌ | **aucune arête d'héritage émise** (ingestion ne produit ni EXTENDS ni IMPLEMENTS) |

**Conclusion de mesure** : un class-diagram *utile* est renderable (classes + membres + associations), mais
les **flèches d'héritage sont impossibles v1** sans changer l'ingestion (`emit-references.ts`). → scope-cut honnête.

## 2. Scope (v1)

**IN :**
1. `projectClassDiagram(graph)` (pur, no-I/O) dans `graph-lens-core.mjs` : nœuds = `Class`+`Interface` ;
   pour chacun, membres résolus via `HAS_METHOD`/`HAS_PROPERTY`/`MEMBER_OF` (Method/Property enfants) ;
   arêtes = associations dérivées de `CALLS` (méthode→méthode, remontées à la classe propriétaire) +
   `MEMBER_OF`. Sortie = `{classes:[{id,name,path,stereotype:'class'|'interface',members:[{kind:'method'|'field',name,visibility?}]}], associations:[{source,target,kind:'calls'|'contains'}]}`.
2. `renderMermaidClass({classes, associations, repoName})` dans `sysml-export-core.mjs` : émet un
   `classDiagram` mermaid — un bloc `class Name { +method() \n +field }` par classe, associations en
   `A ..> B : calls`. IDs via `safeId()` (déjà présent). Sanitize via `mermaid-sanitizer.ts` (déjà présent).
3. Route : étendre `docker-server-sysml-export.mjs` pour `format=mermaid-class` → appelle
   `projectClassDiagram(fetchGraph(repo))` puis `renderMermaidClass(...)`. Réutilise le fetch `/api/graph`
   déjà fait par les autres formats.

**OUT (v1, différés documentés) :**
- **Héritage** (EXTENDS/IMPLEMENTS) : nécessite d'émettre ces arêtes à l'ingestion (`emit-references.ts`) —
  hors scope v1, `meta.inheritance: 'unavailable'` déclaré dans la sortie (Zero Masking : le diagramme dit
  ce qu'il ne montre pas). Ticket successeur si demandé.
- Visibilité (public/private) : `visibility?` optionnel — rempli seulement si le nœud Method/Property le porte,
  sinon omis (pas de `+`/`-` inventé).
- Cap de rendu : si `Class`+`Interface` > 150, tronquer par degré (`meta.truncated_from`) — même discipline
  que les grosses lentilles (jamais de rendu brut massif). HMMstudio = 152 → borderline, le cap s'applique.

## 3. Definition of Done

1. `GET /sysml-export?repo=HMMstudio&format=mermaid-class` → **200**, `content-type: text/plain`, corps =
   un `classDiagram` mermaid **valide** (parse-able ; vérifié via `mermaid-sanitizer` + un parse de smoke).
2. Chaque `Class`/`Interface` du graphe (jusqu'au cap) → un bloc `class` avec ses méthodes (`HAS_METHOD`) et
   champs (`HAS_PROPERTY`). Zéro classe fantôme, zéro membre orphelin.
3. Les associations `calls`/`contains` apparaissent en arêtes ; **aucune** flèche d'héritage (v1) ;
   `meta.inheritance == 'unavailable'` présent.
4. **Tests** (pyramide fork) : `projectClassDiagram` + `renderMermaidClass` = **unit** (`tests/unit/`, golden
   sur un mini-graph fixture avec 2 classes + 1 interface + 1 CALLS) ; l'endpoint = **integration**
   (`tests/integration/endpoints/sysml-export-class.test.mjs` : 200 + parse mermaid + assert ≥1 bloc class).
5. **Smoke loop** (CLAUDE.md) : ajouter la ligne `sysml-export?format=mermaid-class`.
6. **Docs** : ROADMAP item ✅ + INVENTORY (nouvelle ligne export) + régén patches (édite `upstream/` →
   `additive`/`inplace` regénérés + `check-patch-drift.mjs` vert). Cette spec mise à jour à la livraison.

## 4. Verdict du gate (roadmap : « si abandon → escalade user »)

**BUILD.** La donnée existe (mesurée), le point d'extension est propre (`sysml-export-core` + `graph-lens-core`
déjà structurés pour ça), le scope v1 est borné et testable. **Pas d'abandon → pas d'escalade.** Le seul
compromis (héritage différé) est un scope-cut honnête imposé par la donnée, pas un échec.

## 5. Build order (bite-sized, pour l'exécution — Docker requis pour la vérif finale)

1. `projectClassDiagram` + unit golden (RED→GREEN).
2. `renderMermaidClass` + unit golden (RED→GREEN).
3. Route `format=mermaid-class` + integration endpoint test.
4. Smoke loop + ROADMAP/INVENTORY + régén patches + drift-check.
5. `docker compose build gitnexus-web` + curl live sur `HMMstudio` (DoD 1-3) → commit.

## 6. Iron Rules dégagées

- **Σ-MEASURE-THE-RAW-DATA-BEFORE-PROMISING-THE-RENDER** : le classDiagram « complet » était impossible
  (pas d'arête d'héritage) — mesurer le graphe AVANT d'écrire le DoD a évité un livrable qui ment sur l'héritage.
- **Σ-DERIVED-LENS-EXTENDS-THE-EXISTING-EXPORT-SEAM** : réutiliser `sysml-export-core` + `graph-lens-core`
  (un nouveau format + une nouvelle projection) plutôt qu'un pipeline parallèle.
