# Roadmap Predictive — SysML export design

**Date** : 2026-05-27
**Status** : current
**Auteur** : Robin DENIS (auto-drafted, no interactive brainstorm)
**Depends on** :
- [`2026-05-26-roadmap-predictive-core-design.md`](2026-05-26-roadmap-predictive-core-design.md) (CORE — `/ghosts?repo=X` shape)
- gitnexus `/api/graph?repo=X` (existing real-node graph)

**Trigger** : [`IDEAS-PARKING-roadmap-predictive.md`](IDEAS-PARKING-roadmap-predictive.md) sub-spec 6 (bonus, à évaluer après les 4 vues) — now ready since CORE + Audit + Augmented + Cleanup + Gantt + Brainstorm-hook are all shipped.

---

## 1. Context / problem

L'écosystème gitnexus contient déjà toute la donnée nécessaire pour produire un diagramme SysML (blocks pour les fichiers réels, requirements pour les ghosts, satisfy edges pour les matérialisations). Mais elle reste prisonnière du format JSON propre à gitnexus : invisible aux outils d'ingénierie système (Capella, Cameo, Astah, Magic Systems of Systems Architect, etc.) qui consomment du SysML standard.

Beaucoup d'orgas qui font de la modélisation systémique aimeraient pouvoir importer la dépendance graph + roadmap d'un repo dans leur tool habituel pour faire de la traçabilité requirement → impl, ou pour produire des artefacts de revue d'architecture.

## 2. Goal

Livrer un export **PlantUML SysML 1.7** du graph augmenté, exposé via :
- endpoint `GET /sysml-export?repo=<base>&format=plantuml` qui retourne `text/plain` (le `.puml` consommable directement par PlantUML server / VSCode extension / Confluence)
- option `?format=mermaid` (fallback texte plus simple) pour les users qui n'ont pas PlantUML installé

L'export couvre :
- Fichiers réels → **blocks SysML**
- Ghosts planifiés (`status: planned` ou `expired`) → **requirements SysML**
- Liens matched (`links[]`) → **satisfy edges**
- Tiers (1/2/3) → **packages** (containment)

Pas de SysML v2 (draft) — PlantUML SysML 1.7 est le sweet spot maturité/tooling.

## 3. Design

### 3.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| Export XMI (XML Metadata Interchange) | Format machine-parsable mais ~10× plus verbeux que PlantUML, peu de tools simples le lisent directement, et la spec XMI exige un metamodel SysML résolu (heavy). Maturité PlantUML SysML est meilleure pour notre v1. |
| SysML v2 (draft KerML) | Toolchain encore expérimentale, peu d'outils orga le supportent. PlantUML SysML 1.7 = lingua franca aujourd'hui. |
| Mermaid uniquement | Mermaid n'a pas de syntaxe SysML native — il faut tout encoder en flowchart, ce qui perd la sémantique block/requirement/satisfy. On le garde en fallback (`?format=mermaid`) pour rendu rapide GitHub-style. |
| Endpoint dédié serveur qui génère un PNG | Demande PlantUML installé sur le serveur Docker ou un appel HTTP externe. Trop de complexité pour v1. On émet le texte ; le user le rend chez lui. |
| Frontend qui génère le `.puml` côté browser | Données déjà nécessaires côté serveur (mêmes que pour `/ghosts`). Garder le rendu côté serveur évite la duplication et permet l'export script-friendly (`curl > out.puml`). |
| Inclure les edges d'appel (CALLS / IMPORTS) | Le graph gitnexus a 10k+ edges sur un gros repo. Inclure tous les CALLS dans le SysML noie l'export. v1 = blocks + requirements + satisfy uniquement. Edges détaillés via une option future `?includeEdges=imports,calls`. |
| LLM-assisted naming des blocks | L'export reste 100% mécanique ; les noms viennent du graph (nodes File) et du ghost (`declared.title`). Pas de tokens LLM ici. |

### 3.2 Approche retenue : endpoint serveur émettant PlantUML SysML

#### Architecture (pure backend)

```
upstream/
├── docker-server-sysml-export-core.mjs    NEW  pure fns (renderPlantUml, renderMermaid)
├── docker-server-sysml-export.mjs         NEW  I/O wrapper + route handler
└── docker-server.mjs                       MOD  register route

tests/
├── unit/
│   ├── sysml-export-plantuml.test.mjs     NEW  pure renderer
│   └── sysml-export-mermaid.test.mjs      NEW  fallback renderer
└── integration/endpoints/
    └── sysml-export.test.mjs              NEW  HTTP shape

ROADMAP.md                                  MOD  row 44
INVENTORY.md                                MOD  new sub-section
CLAUDE.md                                   MOD  smoke loop entry
tests/README.md                             MOD  3 new rows
patches/upstream-all.diff                   REGEN
```

Aucun composant frontend en v1 — l'usage est CLI/script (`curl > diagram.puml`) ou raccordement Confluence/wiki.

#### Endpoint shape

```
GET /sysml-export?repo=<base>&format=plantuml|mermaid&tier=<n>
```

- `repo` : requis. Resolved via `findRepoByName` comme les autres endpoints.
- `format` : default `plantuml`. Valeurs `plantuml` ou `mermaid`. 400 sur autre valeur.
- `tier` : optionnel. Filtre les ghosts à ce Tier major (`1`, `2`, `3`). Default = tous.

**Response 200** `Content-Type: text/plain; charset=utf-8` :
```plantuml
@startuml
!include <archimate/Archimate>
title gitnexus — Roadmap predictive SysML (hmm_studio)

package "Tier 1 — Prochaines briques" {
  block "src/auth/login.ts" as B_src_auth_login_ts
  block "src/db/schema.ts" as B_src_db_schema_ts
  requirement "Audit dashboard" as R_tier_2_3_audit
  R_tier_2_3_audit ..> B_src_auth_login_ts : <<satisfy>>
}
@enduml
```

**404** si pas de `.gitnexus/ghosts.json` (pas de sync). **400** si `repo` absent ou inconnu.

#### Mapping graph → SysML

| gitnexus | SysML 1.7 | PlantUML keyword | Mermaid fallback |
|---|---|---|---|
| Real File node | `block` | `block "<name>" as B_<safe>` | `class <safe>` |
| Ghost (planned/expired) | `requirement` | `requirement "<title>" as R_<safe>` | `class <safe>` (stereotype `<<R>>`) |
| Ghost link (matched) | `<<satisfy>>` edge | `R_x ..> B_y : <<satisfy>>` | `R_x --> B_y : satisfy` |
| Tier section | `package` | `package "Tier N" { ... }` | `subgraph Tier_N ... end` |
| Cancelled ghost | (omis) | — | — |
| Materialized ghost | block + comment | `block "<file>" as ... \n note right of ... : matérialise R_x` | comment |

#### Pure fns

```js
// docker-server-sysml-export-core.mjs
export function renderPlantUml(input: {
  ghosts: GhostRuntime[];
  files: string[];
  repoName: string;
  tierFilter?: string;
}): string;

export function renderMermaid(input: { ... }): string;

export function safeId(s: string): string;   // converts a path/title to a PlantUML-safe alias
```

#### Algorithme de rendering

1. Filtrer les ghosts par `status in {'planned', 'expired'}` (et `tier` si `tierFilter` set).
2. Pour chaque ghost, extraire ses `matched` paths depuis `links[]` (déjà computé par CORE).
3. Indexer les fichiers réels mentionnés (intersection ghosts.matched ∪ option `?includeFiles=` future).
4. Grouper par Tier (`1`, `2`, `3`, `none`) → packages.
5. Émettre :
   - `@startuml` header + `title` + skin params
   - Pour chaque tier package : `package "Tier N" {`
   - Blocks (1 par fichier réel)
   - Requirements (1 par ghost planned/expired)
   - Satisfy edges
   - `}` clôt package
   - `@enduml` footer

#### Smoke loop entry (CLAUDE.md)

```bash
# SysML export (Tier 3.x bonus)
curl -s -o /dev/null -w "sysml-export: HTTP %{http_code}\n" \
  "http://localhost:4173/sysml-export?repo=hmm_studio&format=plantuml"
```

#### Tests

| Test | Fichier | Couvre |
|---|---|---|
| PlantUML renderer | `tests/unit/sysml-export-plantuml.test.mjs` | renderPlantUml (empty, 1 block, 1 ghost+1 satisfy, tier package, cancelled omis) |
| Mermaid renderer | `tests/unit/sysml-export-mermaid.test.mjs` | renderMermaid (idem, syntax mermaid) |
| Endpoint shape | `tests/integration/endpoints/sysml-export.test.mjs` | GET 200 (text/plain), 400 missing repo, 400 invalid format, 404 no sync |

## 4. Scope boundaries

**In-scope** :
- Endpoint `GET /sysml-export`
- Pure fns `renderPlantUml` + `renderMermaid` + `safeId`
- Tests : 2 unit + 1 integration
- Wiring docs (ROADMAP / INVENTORY / CLAUDE smoke / tests/README / spec Update)

**Out-of-scope explicite** :
- Export XMI ou SysML v2
- Rendu PNG/SVG côté serveur (le user rend chez lui via PlantUML)
- Composant frontend de preview du diagramme (futur si demandé)
- Inclusion des edges CALLS/IMPORTS du graph (option future `?includeEdges=`)
- Round-trip SysML → ROADMAP.md (le user édite ROADMAP.md, pas Capella → gitnexus)
- Export incrémental (delta SysML entre 2 snapshots)
- LLM-assisted simplification du diagramme

## 5. Open questions

1. **Quel format de skin/style PlantUML par défaut ?** v1 : aucun skinparam (vanilla PlantUML). User customise dans son env. **Résolu.**
2. **Comportement si > 200 ghosts ?** Affichage potentiellement illisible. Solution v1 : émettre quand même, le user filtrera via `?tier=`. Sous-spec future : paginer ou clusterer. **Résolu pour MVP.**
3. **safeId collision** (deux fichiers `index.ts` dans des dirs différents) ? Utiliser le path complet sluggé (`B_src_auth_index_ts`, `B_src_db_index_ts`). **Résolu.**
4. **Materialized ghosts** — afficher ou masquer ? v1 : masqués (focus sur le futur planifié). Le block du fichier matérialisateur est visible mais sans link `<<satisfy>>` (puisque le requirement n'est plus dans le diagramme). **Résolu.**
5. **Cas dépendance entre ghosts (`dependsOn[]`)** ? v1 : émettre comme `R_x ..> R_y : <<deriveReqt>>`. Si pas de matched paths sur le ghost dépendant, le requirement reste isolé visuellement. **Résolu.**

## 6. Effort estimé

**~1.5 jour** :

| Composant | Effort |
|---|---|
| `safeId` + `renderPlantUml` + tests unit | 0.5 j |
| `renderMermaid` (fallback simple) + tests | 0.25 j |
| Endpoint `GET /sysml-export` + I/O wrapper | 0.25 j |
| Route registration + integration test | 0.25 j |
| Wiring docs (ROADMAP, INVENTORY, CLAUDE, tests/README, spec Update) | 0.25 j |

## 7. Suite

Plan d'implémentation via `superpowers:writing-plans`. Bonus de la série Roadmap Predictive ; dernier item de l'IDEAS-PARKING avec une spec rédigée.
