# GitNexus — Roadmap

État vivant des fonctionnalités déjà livrées et des prochaines pistes.
Dernière mise à jour : 2026-05-26 (Tier 2.5 enrichi : cube 2×2×2, `.gitnexus-policy.yaml`, warnings auto, vue Galaxie UMAP).

> 📋 **Voir aussi** [INVENTORY.md](INVENTORY.md) — état des lieux complet :
> features upstream + nos ajouts + distance avec upstream. À utiliser
> comme base de brainstorming avant de décider du prochain Tier.

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
| 16 | **Semantic labels** (LLM-generated cluster names, cached on disk, integrated into Dissonance UI) | `/semantic-labels`, `semantic-labeler.ts` |
| 17 | **Cross-repo coupling** (git-log bucketing, multi-repo Jaccard) + UI toggle | `/coupling/cross`, `CouplingPanel` Layers toggle |
| 18 | **Cross-repo growth** (union timeline, per-repo step lines, label switcher) | `/growth/cross`, `GrowthChart` Layers toggle |
| 19 | **What-if simulator** (rename / move / delete symbolic mutations, preview via diff coloring) | `services/mutation-engine.ts`, `WhatIfPanel.tsx` |
| 20 | **VSCode extension v0.1** (status-bar bus factor for the active file) | `vscode-extension/` (separate package) |

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

### 1.2 — Cross-repo coupling ✅
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

### 1.3 — Migration des centres de gravité ✅
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

### 2.1 — Annotation sémantique des clusters ✅
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

### 2.3 — What-if simulator (statique) ✅
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

### 2.4 — VSCode/Cursor extension ✅ (MVP v0.1)
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

### 2.5 — Cross-repo similarity (Score de Correspondance)
**Promesse** : pour 2+ repos indexés, un diagnostic à **3 axes**
(structurel, sémantique, couplage temporel) qui classe chaque paire dans
une grille **2×2×2** avec une recommandation par cellule. Garde-fou
manuel via `.gitnexus-policy.yaml` pour neutraliser les faux positifs
(compliance, multi-tenant, freeze legacy, fork OSS), et heuristiques
automatiques de `warnings` (licence divergente, last-commit-age, sets
d'auteurs disjoints).

**Vecteur d'Identité** (par repo, features normalisées) :
- `entropy` (via `/entropy`)
- `growth_rate` (pente moyenne de `/growth`)
- `churn_concentration` (Gini des churns, dérivé de `/churn`)
- `bus_factor_distribution` (médiane + p10 de `/ownership`)
- `community_count` + `modularity` (Leiden upstream)
- `top_N_semantic_labels` embedded — moyenne des embeddings des labels
  LLM des N plus gros clusters (via `/semantic-labels`)

**Score à 3 axes** :
- `structuralScore` = cosine similarity sur les 5 premières features du
  Vecteur d'Identité.
- `semanticScore` = cosine similarity sur les labels embedded.
- `temporalCoupling` = densité du couplage cross-repo via
  `/coupling/cross` sur une fenêtre récente (90 jours par défaut).

Position dans le **cube 2×2×2** selon trois seuils (0.7 / 0.7 / 0.5 par
défaut, ajustables par query param) :

| Structurel | Sémantique | Couplé | Diagnostic | Recommandation |
|---|---|---|---|---|
| Haut | Haut | Haut | Jumeaux actifs | Extraire en lib partagée |
| Haut | Haut | Bas | Jumeaux isolés | **Suspect** — vérifier `.gitnexus-policy.yaml` |
| Haut | Bas | Haut | Patterns + collision | Standardiser outillage |
| Haut | Bas | Bas | Patterns partagés | Standardiser (sans urgence) |
| Bas | Haut | Haut | Collision réelle | Orchestrer via API Gateway |
| Bas | Haut | Bas | Domaines parallèles | Surveiller, pas d'action |
| Bas | Bas | Haut | Couplage caché | Découpler |
| Bas | Bas | Bas | Indépendants | Aucune action |

**`.gitnexus-policy.yaml`** (optionnel, par-repo, même mécanique que
`.gitnexus-domains.yaml` de 2.2) :
```yaml
isolation_required: true
reason: "PCI compliance — code identique mais doit rester séparé"
allow_merge_with: []   # whitelist optionnelle d'autres repos OK pour merge
```
Quand `isolation_required: true`, le quadrant "Jumeaux actifs" devient
"Jumeaux (isolation intentionnelle)" et la reco merge est supprimée.

**Heuristiques de `warnings[]`** (auto-générées par l'endpoint) :
- `LICENSE files diverge` — comparaison du fichier `LICENSE` à la racine
  de chaque repo.
- `Last commit > Xmo` — un repo gelé suggère version freeze ou
  abandonware.
- `Distinct author sets` — aucun committer en commun → fork ou équipes
  disjointes.
- `Domain names mismatched` — déclarés divergents dans
  `.gitnexus-domains.yaml`.

**Premier pas** : `GET /similarity?repos=A,B[,C,...]` qui :
1. Agrège les features de chaque repo depuis les endpoints existants
   (pas de re-calcul).
2. Embed les top-N labels via le même chemin LLM que `/semantic-labels`.
3. Charge `.gitnexus-policy.yaml` de chaque repo s'il existe.
4. Calcule les 3 scores + applique les heuristiques `warnings`.
5. Retourne :
```json
{
  "pairs": [{
    "a": "repo-A", "b": "repo-B",
    "structuralScore": 0.84, "semanticScore": 0.72, "temporalCoupling": 0.12,
    "quadrant": "Jumeaux isolés",
    "recommendation": "Suspect — vérifier .gitnexus-policy.yaml",
    "warnings": ["LICENSE files diverge", "Last commit on B > 6mo"],
    "dominantFeatures": ["entropy", "churn_concentration"],
    "policyApplied": null
  }]
}
```

**UI** : nouveau panneau `SimilarityPanel.tsx` avec deux vues :
- **Matrice** N×N color-coded par quadrant (8 couleurs), drill-down par
  paire, warnings affichés en bandeau.
- **Galaxie** (à partir de 5+ repos) — projection UMAP 2D du Vecteur
  d'Identité, chaque repo = un point, distance euclidienne ≈ similarité.
  Clusters de points proches = familles technologiques. Points isolés =
  "exotiques" ou anomalies.

**Modes d'échec à surveiller** :

| # | Scénario | Le modèle dit | Réalité | Mitigation |
|---|---|---|---|---|
| FP-1 | Réplication compliance (PCI / non-PCI, EU / US) | Jumeaux → merge | Isolation requise | `.gitnexus-policy.yaml` |
| FP-2 | Multi-tenant par isolation (1 repo / client) | Jumeaux → merge | Data leak si merge | `.gitnexus-policy.yaml` |
| FP-3 | Version freeze pour client legacy | Jumeaux → merge | Contrat figé | Warning `last_commit_age` |
| FP-4 | Fork OSS interne vs upstream public | Jumeaux → merge | Licences incompatibles | Warning `LICENSE diverge` |
| FN-1 | Même domaine, stacks opposés (Python ORM vs Go raw SQL) | Indépendants | Convergence ratée | `semanticScore` seul peut basculer en "Collision" |
| FN-2 | Legacy + rewrite | Indépendants | Réconciliation requise | Détection git remote ancestor (post-MVP) |
| FN-3 | Public API + private impl (contract coupling) | Indépendants | Collision sur le contrat | Axe `temporalCoupling` capture ce cas |

**Limitation honnête** : le vrai "Score de Collision" sur la donnée
métier (mêmes tables DB modifiées par les deux repos) reste hors scope —
demanderait l'annotation des schemas ou la lecture des migrations. L'axe
`temporalCoupling` via `/coupling/cross` est la meilleure approximation
disponible. Détection AST-pattern (design patterns récurrents type DI,
Factory) = Tier 3 ultérieur — nécessite un extracteur de patterns sur
Tree-sitter.

**Effort** : 2-3 semaines pour l'endpoint complet (Vecteur + 3 axes +
warnings + policy parser) + panneau matrice. +1 semaine pour la vue
Galaxie (UMAP). +2-3 semaines pour AST-fingerprint si on l'inclut au
MVP.

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
8. **2.5 Cross-repo similarity** — quand 3+ repos sont indexés, agrège les analytics existantes en un Score de Correspondance à 3 axes (structurel × sémantique × couplage temporel), cube 2×2×2 de recommandations, policy YAML pour gérer les faux positifs compliance/multi-tenant. ~2-3 semaines (+1 pour la vue Galaxie UMAP).
9. **2.3 What-if simulator** — utile pour refactos importants. ~1-2 semaines.
10. **3.x** — selon les besoins (instrumentation runtime, audit social, auto-PR).

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
