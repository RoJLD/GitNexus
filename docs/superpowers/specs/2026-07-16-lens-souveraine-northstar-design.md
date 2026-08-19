# La Lentille Souveraine — north-star du lens-explorer (design)

**Date** : 2026-07-16
**SIGIL** : SIGIL-1711 Bloc 3 (north-star, design-first)
**Statut** : design (grounded contre le code/données réels via workflow `lens-northstar-grounding`)

> Ce design **traverse deux dépôts** : le moteur + le registre vivent côté ELYSIUM
> (`scripts/governance/` + `data/governance/`), le projecteur navigateur côté fork
> (`ingestion/GitNexus/upstream/gitnexus-web/`). Les parties ELYSIUM nécessitent le flux
> worktree/PR (garde SIGIL-1555) à l'implémentation. Le doc vit dans le fork par cohérence
> avec le reste du programme SIGIL-1711.

## North-star (une phrase)

> **Une lentille est un artefact déclaratif, first-class, porté par les métriques,
> composable, qui répond à des questions, et se projette identiquement sur toute surface —
> l'œil de Robin (viz), la query de l'agent (MCP), la narration pour un héritier.**

Les quatre « manques » du lens-explorer actuel (non-authorable/composable · ne répond pas à
des questions · pas partagé entre surfaces · coloration pauvre) sont **quatre facettes d'une
seule idée** : promouvoir la lentille de *code colorant un graphe* à *donnée déclarative*.
Déclaratif → authorable/composable · porte des règles d'insight · portable · réfère des
métriques.

## Ce qui existe déjà (mesuré) — c'est une promotion, pas une réécriture

- `data/governance/lens_registry.yaml` (5 entrées : inter_graph, sigil, workflow,
  health::critical_services, health::pxe) est **déjà semi-déclaratif** — mais ne porte que
  des **métadonnées** (name, family, capabilities, un champ `adapter:` **décoratif, jamais
  importé**). La logique de projection est codée en dur dans
  `scripts/governance/brain_graph/projection.py` (4 fonctions : `inter_graph_to_braingraph`,
  `_json_lens` pour sigil+workflow, `health_to_braingraph`) + un ladder if/elif dans
  `sigma_brain_graph_gateway.py:build_graph_for_repo` (~:132-138) + le dict `_JSON_LENSES`
  (~:29-32) + du Cypher inline (`_read_inter_graph` ~:221-249).
- Le north-star **fait descendre la logique dans le registre** (project/select/color/insight/
  meaning) et transforme la gateway en **moteur** qui évalue cette donnée. Les 4 fonctions +
  le ladder + le dict + le Cypher **s'effondrent** dans un unique `engine.evaluate(spec, graph,
  metrics)`. Les 5 lentilles actuelles deviennent les 5 premiers fichiers de spec.

## Portée du moteur — GOUVERNANCE-only en Phase 1 (décision mesurée)

**Prémisse initiale falsifiée par la mesure** : « un moteur pour gouvernance ET code via
`/api/graph` » est architecturalement faux aujourd'hui. La gateway Python `/api/graph` ne sert
**que** des lentilles de gouvernance re-labellisées (`gitnexusify`) ; elle n'a **aucun** chemin
AST/tree-sitter et **aucun** accès aux métriques de code (qui vivent dans le service
graph-theory du fork, `/graph/metrics/lens/:id`). Les lentilles-code du fork (imports-deps,
file-graph, symbol-graph — `docker-server-graph-lens-core.mjs`) sont un **ensemble disjoint**,
dans un process Node séparé, avec un autre adaptateur et une autre source de métriques.

→ **Phase 1 : moteur déclaratif pour les graphes de gouvernance, dans la gateway. Les
lentilles-code = Phase 2** (moteur séparé côté fork, OU proxy gateway→fork lisant
`/api/graph` + `/graph/metrics`). **Un seul format de spec, deux moteurs.**
`projectClassDiagram` reste bespoke (sortie non-graphe) — hors du langage déclaratif à jamais.

## Le Lens Spec (l'artefact)

Un fichier YAML par lentille (le corps descend dans `lens_registry.yaml`, rendant `adapter:`
load-bearing ou le supprimant). Forme :

```yaml
id: cardinal-services
title: "Services critiques"
family: HEALTH                     # groupe le switcher (META | DOMAIN | HEALTH)
source:
  kind: health                     # health | json_nodes | kuzu   (voir §source)
  path: critical_services_health.json
transform: health_polymorphic      # built-in nommé OU combinateur déclaratif (voir §transform)
select:                            # optionnel — QUI est dans la lentille
  node_where: "status == CRITICAL" # prédicat sur props/métriques de NŒUD
  edge_where: "type in [IMPORTS]"  # prédicat sur type d'ARÊTE (les lentilles-code en ont besoin)
color:                             # encodage visuel
  by: severity                     # propriété/métrique (ou binding, voir §metric-binding)
  scale: categorical               # heat | categorical | community
insight:                           # optionnel — la couche "répond à des questions"
  rank: "top 5 by severity"
  delta: "since 24h"
meaning: "Les services dont la panne menace la souveraineté — agis ici d'abord."
```

### §source — trois backends (mesuré, pas homogène)

Les 5 lentilles ne sont PAS symétriques. `source.kind` couvre :
- `kuzu` — inter_graph : lecture Cypher (`MATCH (g:GraphRegistryNode) …`) + mapping row→nœud.
  Le spec déclare la requête (ou une lecture-registre fixe) + le mapping colonnes.
- `json_nodes` — sigil/workflow : liste de nœuds JSON (via l'actuel `_json_lens`).
- `health` — `*_health.json` : forme polymorphe (voir §transform).

### §transform — grammaire minuscule + built-ins nommés (la tension résolue)

**La grammaire d'expression reste minuscule et sûre** (refs de propriétés/métriques,
comparateurs `>= < == in`, fonctions nommées `top N by X`, `heat()`, `since()`,
`normalize_key()`) et gouverne **select/color/insight**. **Aucun eval de code arbitraire.**

Mais trois transforms réels sont **intrinsèquement impératifs** et ne peuvent PAS être
exprimés par une grammaire minuscule (mesuré) :
- `health_polymorphic` — sniffe la forme au runtime (`if list-of-dicts sous
  services|checks|violations|probes|items → explode root+items+anomalies ; else → collapse
  scalaires en une HealthCard`, `projection.py:136-231`).
- `imports_collapse` (Phase 2) — collapse symboles→fichiers par `filePath` + réécriture
  d'endpoints + drop self-loops + dedup + drop-isolated.

→ `transform:` est **soit** un petit combinateur déclaratif (`select_edges` / `collapse` /
`rewrite` avec params explicites : `group_key`, `endpoint_remap`, `drop_self_loops`,
`dedup_key`, **`keep_isolated`** — imports-deps drop, symbol-graph keep) **soit** une
**référence à un built-in impératif nommé par id**. Les built-ins sont du code du moteur
(revu, pas arbitraire) ; le spec les invoque par nom. **Ordre du pipeline load-bearing** :
`select-edges → collapse → dérive l'ensemble de nœuds → color`.

## Le moteur

`engine.evaluate(spec, graph, metrics) → RenderedLens`. **Pur** (aucune I/O dans le cœur,
testable) ; les I/O (lire KuzuDB, lire les JSON métriques, mtime→`indexedAt`) sont injectées.
Il **remplace** (n'étend pas — les symboles `_apply_community_color`/`lens_family` que le
design initial nommait n'existent pas) : les 4 fonctions de `projection.py`, le ladder
`build_graph_for_repo`, le dict `_JSON_LENSES`, le Cypher inline.

### Contrat de sortie — le BrainGraph COMPLET + color/inLens/insights

`RenderedLens` n'est PAS `{id,color,inLens}` (sous-spécifié — casserait les consommateurs
existants). C'est le **contrat BrainGraph existant** :
```
node  { id, label:"CodeElement", properties{ name, filePath, domainType, schemaType, … } }
edge  { id, sourceId, targetId, type, confidence, reason }
meta  { node_count, edge_count, truncated, capabilities, schema_hash }
```
**plus** par-nœud `{ color, inLens }` **plus** top-level `{ insights, meaning }`. Le wire
`/api/graph` mirroir `edges`→`relationships`. `gitnexusify` (remap `domainType`→NodeLabel)
reste en aval.

## Metric-binding — OPTIONNEL, best-effort, PAR-LENTILLE (le pilier reshapé)

**Risque #1 confirmé par la mesure** : il n'existe **aucune clé de jointure nœud↔métrique
universelle**, et la plupart des métriques nommées n'ont **pas de données joignables** :
- `test_coverage_dette.json` n'a **aucun** score numérique (binaire, keyé par chemin `.py`).
- La **sévérité SIGIL** vit dans le frontmatter `.md`, **non ingérée** dans `sigil_graph.json`.
- Les noms inter_graph divergent de **tous** les namespaces de métriques (`ASTKG`≠`astkg_brain`,
  `Forge`≠`forge_concepts`) → jointure naïve = **1/13 nœud coloré** (partial-match silencieux,
  pire qu'un miss propre). `node_count`/`rel_count` sont **NULL** dans la DB live.

→ Le metric-binding est **optionnel**, **par-lentille**, jamais une jointure globale. Chaque
binding déclare : `metric_file`, `metric_index_path` (ex. `services[].service`,
`graphs[].id`), `metric_value_path` (ex. `severity`, `age_hours`), `node_join_prop`
(`id`-préfixe-strippé | `properties.name` | `properties.filePath`), et une **agrégation**
pour les lentilles collapsées. **First-class** : un `normalize_key()` (backslash↔slash, casse,
strip du préfixe `<lens>::`) et un **comportement non-matché explicite** (`inLens=false` /
couleur neutre, **jamais** de crash). Le null-handling (`color by`/`select where` sur valeur
absente : skip / neutre / exclu) est first-class aussi.

**Deux catégories** : (a) métriques **déjà embarquées** comme props de nœud (health severity/
status via la projection) → `color: by severity` **sans jointure** ; (b) métriques dans des
fichiers séparés → vraie jointure.

## Décomposition en phases

### Phase 1 (spec + build en détail) — gouvernance-only, 1 démo métrique garantie
1. Schéma **Lens Spec** + le corps déclaratif descendu dans `lens_registry.yaml`.
2. **Moteur** `evaluate()` gouvernance (kuzu/json_nodes/health) émettant le contrat BrainGraph
   complet + color/inLens ; built-ins `health_polymorphic` + les transforms triviaux.
3. **Réexprimer les 5 lentilles actuelles en déclaratif** (preuve du modèle) — categorical/
   community existant, zéro régression de rendu.
4. **Colorer UNE lentille par une vraie métrique** : `health::critical_services` par
   `color: by severity, scale: categorical` — **déjà embarquée, zéro jointure, garantie de
   peindre** (`projection.py:174-183`).
5. **Projecteur navigateur** : nouvelle branche dans `researchGraphToGraphology` lisant
   `node.color` (mirroir de la branche `projectionColor` de `graph-adapter.ts:247`) + dim/hide
   sur `inLens===false` (réutilise le dim `isolateCommunity`). Les échelles
   heat/community/categorical **existent déjà côté client** (`heatColor`, `COMMUNITY_PALETTE`,
   `RESEARCH_COLORS`). Réconcilier les deux systèmes de couleur : `node.color` fait autorité,
   le toggle UI devient un override de spec (pas un chemin parallèle).
6. **Panneau insights/meaning** (navigateur) — **100% greenfield** (aucun n'existe ;
   `ResearchGraph.report` est typé `unknown`, jamais rendu).
7. **Le glob `/health-lens`** (12 fichiers `*_health.json`) reste **inchangé et fonctionnel** en
   Phase 1 (il sert déjà le transform `health_polymorphic`) ; Phase 1 ne réexprime que les 2
   lentilles health **curées** du registre. **Décision explicite** : l'**unification** du glob
   (auto-générer un spec par `*_health.json` → registre unique) est un item **Phase 2** — pas de
   faux-semblant que « les 5 » couvrent tout le surface health (10 fichiers restent sur le glob).

> **Découpage naturel pour le plan** : items 1-4 = côté **ELYSIUM** (`scripts/governance/`
> gateway + `data/governance/lens_registry.yaml`, flux worktree/PR SIGIL-1555) ; items 5-7 =
> côté **fork** (`gitnexus-web`). **Moteur d'abord** — le navigateur consomme sa sortie.

### Phases 2+ (vision gravée, non spec ici)
- Projecteur **MCP** `query_lens(id) → RenderedLens JSON` (surface agent).
- Projecteur **narration** (RenderedLens + meaning → markdown, surface héritier).
- **Composition** : `source: { lens: <id> }` (chaînage) ; `overlay:[a,b]` différé.
- **Lentilles-code** (imports/file/symbol) : moteur fork séparé OU proxy gateway→fork ;
  `transform: imports_collapse` + agrégation métrique sur nœuds collapsés.
- **UI d'authoring** de lentilles.

### Pré-requis DONNÉES (nommés, hors features moteur)
- Ingérer la **sévérité SIGIL** (frontmatter `.md` → prop de nœud `sigil_graph.json`) pour
  débloquer `color sigil by severity`.
- Peupler `node_count`/`rel_count` dans `register_graph()` (`meta_graph_master.py:~201`) pour
  débloquer `color inter_graph by graphNodeCount`.
- (Optionnel) table d'alias `inter_graph → graph_registry_health` (ASTKG→astkg_brain, …) si on
  veut colorer inter_graph par `age_hours`/`status`.

## Iron Rules (gravées par le grounding)

- **Σ-MEASURE-FIRST-CAN-REVERSE-A-SPEC-PREMISE** — « un moteur pour les deux » présenté comme
  évidence, falsifié en 5 min de mesure (la gateway Python n'a aucun chemin code).
- **Σ-A-NAIVE-JOIN-THAT-MATCHES-1-OF-13-LOOKS-LIKE-IT-WORKS** — le partial-match silencieux
  (inter_graph↔health, seul `tech_genealogy` byte-égal) est pire qu'un miss propre ; toujours
  vérifier le taux de match, pas juste « ça colore ».
- **Σ-THE-REGISTRY-ALREADY-EXISTS-MAKE-ITS-BODY-LOAD-BEARING** — `lens_registry.yaml` +
  `adapter:` décoratif : le north-star remplit le corps, ne réinvente pas le registre.
- **Σ-A-TINY-GRAMMAR-ADMITS-NAMED-BUILTINS-NOT-ARBITRARY-CODE** — les transforms impératifs
  (health polymorphe, collapse) sont des built-ins référencés par id ; la grammaire reste
  minuscule pour select/color/insight.
- **Σ-METRIC-BINDING-IS-OPTIONAL-PER-LENS-WITH-A-NORMALIZER** — jamais de jointure globale ;
  clé + fichier + normalisateur de chemins + comportement non-matché explicites.
- **Σ-THE-ENGINE-EMITS-THE-FULL-CONTRACT-NOT-A-SUBSET** — RenderedLens = BrainGraph complet +
  color/inLens/insights, sinon les consommateurs existants cassent.

## Non-goals (YAGNI)

Pas de metric-binding universel (per-lens seulement). Pas de `projectClassDiagram` déclaratif
(reste bespoke). Pas de composition/overlay en Phase 1. Pas de coloration SIGIL-severity en
Phase 1 (pré-requis données). Pas de « un moteur pour tout » (gouvernance + code = deux
moteurs, un format).
