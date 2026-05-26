# GitNexus — Roadmap

État vivant des fonctionnalités déjà livrées et des prochaines pistes.
Dernière mise à jour : 2026-05-22 (Tier 1 livré).

L'objectif global : transformer GitNexus en **outil d'archéologie + de
diagnostic structurel** pour un écosystème de dépôts, pas juste un
visualiseur de code. Chaque ligne ici décrit une promesse précise — pas
un nom marketing — et son premier pas concret.

---

## ✅ Déjà livré

| # | Feature | Endpoint(s) / Composant(s) |
|---|---|---|
| 1 | **Loading bars + UX path picker + folder browser server-side** | `/listdir` + `DropZone.LoadingCard`, `RepoAnalyzer` |
| 2 | **Export / Import (index-only + bundle)** + register-only mode | `/export`, `/import?registerOnly`, `BulkSnapshotModal` |
| 3 | **Diff visuel entre 2 repos** (rouge/vert/gris sur le graphe) | `/api/graph`, `graph-diff.ts`, `useSigma` reducer |
| 4 | **Stale-lbug-connection fix** côté serveur (patch upstream via [`scripts/patch-lbug-staleness.mjs`](scripts/patch-lbug-staleness.mjs)) | `Dockerfile.cli` |
| 5 | **Snapshots manuels** d'un repo à un commit donné | `/snapshot`, `/snapshots` |
| 6 | **Snapshots bulk** (N commits sur Y jours, SSE progress) | `/snapshot/bulk`, `BulkSnapshotModal` |
| 7 | **Timeline UI** (slider + play/pause auto-animation) | `Timeline.tsx` |
| 8 | **Churn heatmap** (volatilité des nodes sur le timeline) | `/churn`, `useSigma.churnColor` |
| 9 | **Coupling temporel** (paires de fichiers qui changent ensemble) | `/coupling`, `CouplingPanel.tsx` |
| 10 | **Growth chart** (counts par catégorie sur le temps, SVG natif) | `/growth`, `GrowthChart.tsx` |
| 11 | **Lifespan analysis** (foundational/recent/discontinued/ephemeral) | `/lifespan`, `LifespanPanel.tsx` |
| 12 | **Entropy / structural health badge** dans la Timeline (densité + trend) | `/entropy`, `EntropyBadge.tsx` |
| 13 | **CSV export** sur churn/coupling/growth/lifespan/entropy/ownership | `?format=csv` partout, `docker-server-csv.mjs` |
| 14 | **Ownership / bus factor** (per-file commit-share + repo-level summary) | `/ownership`, `OwnershipPanel.tsx` |
| 15 | **Dissonance** (declared domains vs detected communities, purity score, misplaced files) | `/dissonance`, `DissonancePanel.tsx`, `patches/example-gitnexus-domains.json` |

Toutes les analytics ci-dessus marchent dans un seul repo. La granularité
est le node gitnexus (File, Function, Class, Section, …).

---

## 🎯 Tier 1 — Prochaines briques à fort impact ✅ LIVRÉ

> Ces features s'appuient toutes sur ce qui existe déjà. Effort : jours à
> 2 semaines chacune. ROI immédiat pour le use case "reverse engineering
> du projet". **Toutes livrées dans le commit qui suit l'init.**

### 1.1 — Bus factor + knowledge silos ✅
**Promesse** : par fichier, qui contribue le plus, et quel est le risque
de bus (un seul dev sur du code critique).

**Premier pas** : pendant `createSnapshot`, après le `git checkout`, run
`git blame --line-porcelain` sur chaque fichier source. Stocker
`<snapshotDir>/blame/<filePath>.json` avec `{ author, lines }` par auteur.

**Nouvel endpoint** : `GET /authorship?repo=<base>` → pour chaque fichier,
top contributeurs et `bus_factor = ceil(authors_covering_80pct_of_lines)`.

**UI** : nouveau panneau `OwnershipPanel.tsx` qui liste les fichiers
critiques (très modifiés via `/churn` × bus_factor ≤ 1).

### 1.2 — Cross-repo coupling ⏳ pending
**Promesse** : détecte des dépendances invisibles entre dépôts
(`monorepo-A` change quand `monorepo-B` change).

**Premier pas** : étendre `/coupling` pour accepter `?repos=A,B,C`.
Snapshots des 3 repos pris au "même moment" (par horodatage proche → soft
match, ou par date manuelle). Pour chaque transition cross-repo, comptage
des paires de fichiers (a∈A, b∈B) qui ont changé dans la même fenêtre
de temps.

**Difficulté** : alignement temporel. Plusieurs heuristiques possibles
(fenêtre glissante de 1h, ou commits liés par PR si on intègre l'API
GitHub plus tard).

### 1.3 — Migration des centres de gravité ⏳ pending
**Promesse** : voir le poids de code se déplacer entre repos au fil du
temps (monolithe → microservices, ou inverse).

**Premier pas** : `GET /growth?repos=A,B,C` (au lieu de `?repo=`).
Renvoie un timeline aligné avec une série par repo, par catégorie.

**UI** : option dans `GrowthChart.tsx` pour basculer "single repo /
multi-repo". En multi-repo, stack-area chart au lieu de multi-line.

### 1.4 — Entropie structurelle ✅
**Promesse** : un seul chiffre — le **Coefficient de Cohérence
Structurelle** — qui monte quand l'architecture se dégrade et descend
après refactos. Trackable dans le temps.

**Définition** (proposée, à affiner) :
```
entropy = 1 - normalized_modularity(graph)
```
où `normalized_modularity` est calculé via Louvain ou Leiden sur le graph
des relations CALLS / IMPORTS. Plus le graph se découpe proprement en
communautés, plus l'entropie est basse.

**Premier pas** : `GET /entropy?repo=<base>` qui calcule un score par
snapshot du timeline. Affichage : nouvelle série dans `GrowthChart.tsx`
ou bandeau dédié au-dessus de la Timeline.

### 1.5 — Export CSV/JSON pour analyse externe ✅
**Promesse** : tu balances dans Excel / Jupyter / Looker pour ton propre
post-mortem.

**Premier pas** : ajouter `&format=csv` à
`/churn`, `/coupling`, `/growth`, `/lifespan`, `/snapshots`. Headers
adaptés (`Content-Type: text/csv`, `Content-Disposition: attachment`).

---

## 🚧 Tier 2 — Plus ambitieux, 1-2 mois

### 2.1 — Annotation sémantique des clusters
**Promesse** : pour chaque communauté gitnexus, un label métier
("auth", "billing", "data ingestion") généré par LLM à partir des noms
des nodes.

**Premier pas** : pipeline MCP-driven (puisque le MCP gitnexus est déjà
exposé). Skill Claude qui lit la liste des nodes d'une Community via
cypher, génère un label, écrit dans une nouvelle table ou en cache.

**Endpoint** : `GET /semantic-labels?repo=<base>` → `{ communityId: { label, confidence, evidenceNodes } }`.

**UI** : affichage du label au-dessus des clusters sur le graph, et
overlay dans le panneau Filters existant.

### 2.2 — Dissonance score ✅
**Promesse** : compare le découpage *automatique* du code (Communities
gitnexus + labels LLM) avec le découpage *déclaré* du business (que tu
fournis comme YAML : `{ "auth": ["src/auth/**", "src/login/**"], … }`).
Plus le score est élevé, plus le code "fuit" hors de son domaine
théorique → signal de refacto.

**Premier pas** : format d'input `<repo>/.gitnexus-domains.yaml`,
endpoint `GET /dissonance?repo=<base>` qui :
- map chaque file vers son domaine déclaré
- map chaque file vers son cluster détecté
- calcule un Adjusted Mutual Information ou un score d'overlap par
  paire (domaine, cluster)
- liste les fichiers "mal placés" (dans un cluster qui ne correspond
  pas à leur domaine déclaré)

### 2.3 — What-if simulator (statique)
**Promesse** : "Si je renomme `validateUser` en `verifyUser`, qu'est-ce
qui change ?", "Si je split `src/big_module/` en `src/auth/` et
`src/db/`, l'impact sur le graphe ?". Pas d'exécution réelle, juste une
manipulation symbolique du graph.

**Premier pas** : action `rename` déjà côté MCP gitnexus (`mcp__gitnexus__rename`).
Étendre avec `move`, `split-folder`. UI = formulaire dans un nouveau
panneau qui montre le diff prévisionnel via `graph-diff.ts`.

**Limitation honnête** : marche pour des mutations purement structurelles
(renames, moves). Pour des transformations sémantiques ("passer de SQL
à GraphQL"), ce n'est pas faisable sans un modèle profond du code.

### 2.4 — VSCode/Cursor extension
**Promesse** : tu ouvres un fichier dans ton IDE, tu vois directement
les métriques GitNexus en overlay (churn, ownership, blast radius).
L'intuition remplace la documentation.

**Premier pas** : extension VSCode qui appelle le MCP server (déjà
fonctionnel à `localhost:4747/api/mcp`). Pour chaque symbole en focus :
- couleur du gutter selon le churn (rouge/amber/grey)
- tooltip avec `mcp__gitnexus__context`
- badge "bus factor X" si owner unique

Effort : 1-2 semaines pour un MVP minimal, plus si on veut une vraie
intégration polishée.

---

## 🔬 Tier 3 — Demande infrastructure ou validation forte

### 3.1 — Dead code via instrumentation runtime
**Idée** : couleur des nodes par fréquence d'exécution en production.

**Bloqué par** : nécessite un APM (OpenTelemetry, Datadog, Prometheus)
ou un agent custom dans l'app. Hors scope analyse statique.

**Si on s'y attaque** : adapter qui ingère des spans OTLP, mappe les
function names sur les nodes du graph, expose un endpoint `/heat`
similaire à `/churn` mais avec des comptes d'invocations.

### 3.2 — Mutation tracking / profils de devs
**Idée** : classifier le "style" de chaque dev (ajoute de la masse vs
refactore, augmente le couplage vs le réduit).

**Bloqué par** :
- Sociologiquement délicat (mesurer les gens via leur code → résistance
  équipe garantie). Demande accord explicite avant d'implémenter.
- Techniquement : faisable avec `git blame` + delta de complexité par
  commit-auteur.

### 3.3 — Conway's Law audit
**Idée** : compare le graphe de communication des équipes (qui review
qui, qui commit dans quel module) avec le graphe de code. Détecte les
décalages.

**Bloqué par** : demande accès à l'API GitHub/GitLab pour les PRs +
reviews. Plus des heuristiques pour mapper auteurs → équipes (qui
souvent ne sont pas explicites).

### 3.4 — Auto-PR de refactoring
**Idée** : GitNexus propose automatiquement des PRs pour aplatir un
couplage cyclique, déplacer une fonction mal placée, etc.

**Bloqué par** : codegen fiable est *très* dur. Cas réalistes possibles
pour un MVP : moves de fonctions entre fichiers (utilise les AST
gitnexus), extract method, dédoublonnage de fonctions quasi-identiques
(détection par hash de signature normalisée).

### 3.5 — Modèle prédictif de bugs
**Idée** : prédit où va apparaître le prochain bug en fonction du churn
× couplage × bus factor.

**Bloqué par** : nécessite des labels (commits de fix, tickets liés).
Pure R&D ML. À reporter loin.

---

## 🗑️ Idées qui ne deviennent pas leur propre feature

Pour éviter la prolifération de "noms marketing" qui font miroiter sans
livrer, voici ce qui est **déjà** couvert par d'autres tickets :

| Nom proposé | Ce qu'on livre à la place |
|---|---|
| "Code en réalité augmentée cognitive / Holodeck" | Tier 2.4 (IDE extension) |
| "Conscience de l'architecture" | Tier 1.4 (Entropie) |
| "Nexus auto-guérissant" | Tier 3.4 (Auto-PR) — pas tier 1, soyons honnêtes |
| "Génétique logicielle" | Tier 3.2 (Mutation tracking) |
| "Cancer bénin / métastase" | Combinaison de Tier 1.1 (bus factor) + Tier 1.4 (entropie) + Tier 1.2 (cross-repo coupling) |
| "Dimension vivante / Time-lapse" | Déjà livré (Phase 3, bouton Play dans Timeline) |
| "Code City" 3D évolutif | Existe déjà en partie via `Graph3DCanvas`, à étendre avec Timeline → Phase 4D++ |

---

## Ordre d'exécution recommandé

Ordonné par **ratio impact / effort** sur ton use case réel
(reverse-engineering de hmm_studio + écosystème futur) :

1. **1.4 Entropie** — un seul chiffre qui dit "ça pourrit ou pas", plot sur Timeline. ~3 jours.
2. **1.5 Export CSV/JSON** — débloque tes analyses externes maintenant. ~½ journée.
3. **1.1 Bus factor** — révèle quels fichiers sont fragiles socialement. ~3-5 jours.
4. **2.1 Annotation LLM des clusters** — donne du sens aux Communities qui sont nues. ~1-2 semaines.
5. **2.2 Dissonance score** — directement utile pour le "trouve les patterns qui marchent". ~1 semaine.
6. **1.2 Cross-repo coupling + 1.3 Cross-repo growth** — quand tu auras 3+ repos indexés. ~1 semaine.
7. **2.4 VSCode extension** — le multiplicateur de valeur quotidien. ~2 semaines pour MVP.
8. **2.3 What-if simulator** — utile pour refactos importants. ~1-2 semaines.
9. **3.x** — selon les besoins (instrumentation runtime, audit social, auto-PR).

---

## Principes de design

- **Une feature = une promesse précise**. Pas de noms qui font rêver sans
  livraison vérifiable.
- **Tout passe par un endpoint testable au curl**. Le frontend est un
  consommateur, pas le sanctuaire de la logique métier.
- **Mode dégradé doit toujours marcher**. Si tu n'as pas de snapshots,
  l'UI explique au lieu de planter. Si l'LLM annotation échoue, le
  cluster reste "Cluster #5" et c'est OK.
- **MCP first**. Toute nouvelle analytique doit aussi être queryable par
  Claude — c'est ce qui rend l'outil 10× plus puissant qu'un dashboard.
- **Le sandbox protège l'index existant**. Toute opération destructive
  (re-analyze, import écrasant) doit être consciente du staleness +
  poser un check.
