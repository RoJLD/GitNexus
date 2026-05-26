# GitNexus — Roadmap

État vivant des fonctionnalités déjà livrées et des prochaines pistes.
Dernière mise à jour : 2026-05-26 (revue architecturale : Tier 2bis plate-forme, 2.6 Galaxie séparée, Tier 3 étendu 3.6-3.10, sections Optimisations + Vision + Refactos structurels, Ordre d'exécution en 6 phases).

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
manuel via la section `policy:` de `.gitnexus.yaml` (cf 2bis.4) pour
neutraliser les faux positifs (compliance, multi-tenant, freeze legacy,
fork OSS), et heuristiques automatiques de `warnings` (licence
divergente, last-commit-age, sets d'auteurs disjoints).

**Pré-requis** : Repo ID stable (cf 2bis.5) pour que la similarité porte
à travers les re-clones et identifie les paires legacy/rewrite (FN-2).

**Vecteur d'Identité v2** (par repo, features normalisées) :
- `entropy` (via `/entropy`)
- `growth_rate` (pente moyenne de `/growth`)
- `churn_concentration` (Gini des churns, dérivé de `/churn`)
- `bus_factor_distribution` (médiane + p10 de `/ownership`)
- `community_count` + `modularity` (Leiden upstream)
- `file_size_pareto` (Gini des tailles de fichiers — Pareto vs uniforme = signature forte)
- `language_diversity` (entropie Shannon sur la distribution des extensions — catch direct pour FN-1 "stacks opposés")
- `tree_depth` (profondeur médiane + max de l'arbre de répertoires)
- `test_to_source_ratio` (LOC tests / LOC source via détection heuristique des fichiers test)
- `top_N_semantic_labels` embedded — moyenne des embeddings des labels
  LLM des N plus gros clusters (via `/semantic-labels`)

**Score à 3 axes** :
- `structuralScore` = cosine similarity sur les 9 premières features du
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

**Configuration via `.gitnexus.yaml > policy`** (cf 2bis.4 pour le format
unifié qui remplace les multiples `.gitnexus-*.yaml`) :
```yaml
policy:
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
1. Résout chaque `repo` en `repoId` stable via 2bis.5.
2. Agrège les features depuis les endpoints existants (pas de re-calcul).
3. Embed les top-N labels via le même chemin LLM que `/semantic-labels`.
4. Charge la section `policy:` de `.gitnexus.yaml` de chaque repo s'il existe.
5. Calcule les 3 scores + applique les heuristiques `warnings`.
6. Retourne :
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

**UI** : nouveau panneau `SimilarityPanel.tsx` — matrice N×N color-coded
par quadrant (8 couleurs), drill-down par paire sur les features
dominantes, warnings affichés en bandeau. La **vue Galaxie UMAP** est
extraite en feature dédiée 2.6.

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
Factory) = cf 3.8 (Domain-specific AST extractors) — nécessite un
extracteur de patterns sur Tree-sitter.

**Effort** : 2-3 semaines pour l'endpoint complet (Vecteur v2 + 3 axes +
warnings + policy parser) + panneau matrice. Pré-requis 2bis.4 (unified
config, 2-3j) + 2bis.5 (repo ID stable, 3-5j). Vue Galaxie = 2.6
séparée. AST-fingerprint = 3.8.

---

## 🔧 Tier 2bis — Plate-forme avant de continuer à empiler

> Briques structurelles à livrer **avant** Tier 2.5/2.6 et tout Tier 3.
> Chacune rend les features suivantes plus rapides à produire et plus
> utilisables via les agents IA. Effort cumulé ~3 semaines, ROI permanent.

### 2bis.1 — MCP exposure des analytics time-travel
**Promesse** : chaque endpoint backend devient un tool MCP. Claude
(ou tout agent compatible) peut interroger `/churn`, `/entropy`,
`/ownership`, `/similarity`, etc. en langage naturel — sans curl ni
panneau frontend.

**Justification stratégique** : le principe **MCP first** des Principes
de design n'est aujourd'hui appliqué qu'au graphe upstream. Nos
analytics time-travel sont invisibles à l'agent. C'est le gap le plus
exploitable rapidement, et le pré-requis dur de 3.7 (AI-guided tour).

**Premier pas** : `upstream/docker-server-mcp-analytics.mjs` qui wrap
chaque endpoint REST en MCP tool avec description claire :
- `mcp__gitnexus__churn(repo, snapshotId?)`
- `mcp__gitnexus__entropy(repo, fromSnapshot?, toSnapshot?)`
- `mcp__gitnexus__ownership(repo, filePath?)`
- `mcp__gitnexus__dissonance(repo)`
- `mcp__gitnexus__similarity(repos)`
- `mcp__gitnexus__coupling_cross(repos)`
- `mcp__gitnexus__growth_cross(repos)`
- `mcp__gitnexus__lifespan(repo)`

**Effort** : 3-5 jours. Wrapper + tests manuels via Claude Code chat
("compare l'entropie de hmm_studio entre janvier et mars").

### 2bis.2 — Commit-level entropy delta
**Promesse** : actuellement entropie calculée par snapshot. Étendre à un
**delta par commit** → identifie la PR exacte qui démarre la dégradation
de cohérence. Combo killer avec `git blame` → "cette PR a démarré la
perte d'architecture".

**Premier pas** : `GET /entropy/commits?repo=<base>&from=&to=` qui :
1. Liste les commits dans la fenêtre via `git log --pretty=format:%H %ai %an`.
2. Pour chaque commit, calcule en mémoire le delta de modularité Leiden
   sur les fichiers touchés + leurs voisins du graphe d'imports
   (approximation, mais bon enough pour détecter les sauts).
3. Renvoie `[{ sha, author, date, entropyDelta, filesTouched }]`.

**UI** : sparkline `EntropyCommitTimeline.tsx` au-dessus de la Timeline,
click sur un pic → diff visuel du commit + lien blame.

**Effort** : ~1 semaine.

### 2bis.3 — Alerting continu (watch + webhook)
**Promesse** : transformer GitNexus de "dashboard pull-only" à
"garde-fou actif". Endpoint `/watch` qui SSE des events quand un seuil
est franchi, couplé à webhooks (Slack / Email / Discord / Teams).

**Premier pas** :
- `POST /watches` → enregistre une watch dans LadybugDB : `{ repo,
  metric, threshold, op, webhookUrl }`.
- Cron interne (toutes les N minutes, configurable) qui rejoue chaque
  watch et déclenche le webhook si trigger.
- `GET /watches?repo=<base>` → liste + statut.
- `DELETE /watches/:id`.

**Format webhook POST** :
```json
{
  "repoBase": "hmm_studio",
  "metric": "entropy",
  "threshold": 0.6, "op": ">",
  "currentValue": 0.63,
  "snapshotId": "abc123",
  "triggeredAt": "2026-05-26T10:30:00Z"
}
```

**Configuration declarative** via `.gitnexus.yaml > watches:` (cf 2bis.4)
pour reproductibilité.

**Limitation** : seuils statiques pour le MVP. Pas d'apprentissage des
seuils "normaux" — ça relève d'un Tier 3 ML.

**Effort** : 1-2 semaines.

### 2bis.4 — Unified `.gitnexus.yaml`
**Promesse** : consolider tous les fichiers de config par-repo sous un
unique `.gitnexus.yaml` avec sections. Évite l'explosion à 4-5 fichiers
config disjoints quand on empile policy, budget, alerting.

**Format unifié** :
```yaml
domains:                          # ex-`.gitnexus-domains.yaml` (Tier 2.2)
  auth: ["src/auth/**", "src/login/**"]
  billing: ["src/billing/**"]

policy:                           # consommé par Tier 2.5 (similarity)
  isolation_required: false
  reason: ""
  allow_merge_with: []

budgets:                          # consommé par Tier 3.6 (Architectural CI)
  entropy_max: 0.6
  coupling_max_per_file: 5
  bus_factor_min: 2

watches:                          # consommé par Tier 2bis.3 (alerting)
  - metric: entropy
    threshold: 0.6
    op: ">"
    webhook: "https://hooks.slack.com/..."
```

**Premier pas** : parser unifié `upstream/lib/gitnexus-config.mjs` qui :
1. Charge `.gitnexus.yaml` à la racine du repo.
2. Fallback sur les anciens fichiers (`.gitnexus-domains.yaml`,
   `.gitnexus-policy.yaml`) avec warning de dépréciation pour rétrocompat.
3. Expose `getConfig(repo)` consommé par `/dissonance`, `/similarity`,
   `/ci-check`, `/watches`.

**Effort** : 2-3 jours.

### 2bis.5 — Repo ID stable
**Promesse** : chaque repo a un identifiant stable basé sur (a) le SHA
du premier commit et (b) le `git remote origin` normalisé. Survit aux
re-clones avec noms de dossier différents.

**Justification** : actuellement `<base>` = nom du dossier d'index.
Re-clone le même repo ailleurs → la Galaxie / similarity ne porte pas le
link, et la détection FN-2 (legacy + rewrite) est bloquée.

**Premier pas** :
- Au moment du snapshot, calculer `repoId = sha256(firstCommitSha + normalizedRemote)`.
- Stocker dans le snapshot metadata + index global.
- `GET /repos/by-id/:repoId` qui résout vers tous les `<base>` connus
  pour cet ID (utile quand un repo est cloné dans plusieurs paths).
- Tous les endpoints cross-repo acceptent désormais soit `<base>` soit
  `repoId` (auto-detect).

**Effort** : 3-5 jours, principalement à câbler dans les analytics
cross-repo qui prennent encore `<base>` (coupling/cross, growth/cross,
similarity).

---

### 2.6 — Galaxie OSS / Carte de l'écosystème
**Promesse** : projection UMAP 2D du Vecteur d'Identité de N repos.
Chaque repo = un point dans un espace 2D, distance euclidienne ≈
similarité. Permet de visualiser un écosystème entier comme une carte
stellaire : clusters = familles technologiques, points isolés =
exotiques ou anomalies de dette technique masquée.

**Justification de l'extraction de 2.5** : la matrice N×N (2.5) répond à
"quelle paire fusionner ?". La Galaxie répond à "à quoi ressemble mon
écosystème de repos ?". Public et use case différents (architecte
d'organisation vs ingénieur staff).

**Premier pas** : `GET /galaxy?repos=A,B,...` qui :
1. Calcule le Vecteur d'Identité de chaque repo (réutilise 2.5).
2. UMAP fit (umap-js côté backend Node, ou délégation à un script Python
   via subprocess si trop coûteux en JS).
3. K-means sur les coordonnées 2D pour identifier les clusters.
4. Renvoie `[{ repoId, label, x, y, dominantCluster, exoticnessScore }]`.

**`exoticnessScore`** = distance moyenne aux k plus proches voisins.
Repos isolés = forte exoticness → soit niche tech volontaire, soit
anomalie.

**UI** : nouveau panneau `GalaxyView.tsx` — canvas 2D avec points
color-codés par cluster K-means. Hover → nom + Vecteur d'Identité.
Click → drill-down panneau Similarity sur cette paire.

**Effort** : 1 semaine si on délègue UMAP à un script Python ; 1.5-2
semaines avec umap-js intégré côté backend Node.

**Extension future** : alimenter la Galaxie avec le dataset public OSS
(cf 3.9) → "votre repo est dans ce cluster, comparable à django/django
et flask/flask".

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

### 3.6 — Architectural CI
**Promesse** : check PR-time qui calcule `entropy_delta`,
`max_coupling_delta`, `bus_factor_min_delta` entre la base branch et la
PR. Bloque (ou flag warning) si la PR dégrade au-delà des budgets
déclarés dans `.gitnexus.yaml > budgets`.

**Premier pas** :
- `POST /ci-check` qui prend `{ repo, baseCommit, headCommit }`,
  snapshotte les deux, diff les métriques, compare aux budgets.
- GitHub Action / GitLab CI wrapper qui poste un commentaire structuré
  sur la PR.
- Bouton "reviewer override" obligatoire pour les gros refactos légitimes.

**Concurrence directe** : Akon Labs vend déjà "PR Review — blast radius
automatique" en commercial ([INVENTORY A.11](INVENTORY.md#partie-a)).
**Choix stratégique à trancher** avant d'attaquer : est-ce qu'on veut
être en bataille frontale avec leur offre ?

**Difficulté** :
- Coût snapshot par PR. Mitigé si les snapshots sont cachables (cf
  Optimisations section).
- Faux positifs sur les gros refactos → override obligatoire.
- Compatibilité avec leur PolyForm-Noncommercial pour usage commercial
  partenaire.

**Effort** : 3-4 semaines (endpoint + GitHub Action + tests sur 2-3 PRs
réelles).

### 3.7 — AI-guided tour (Architect's Copilot)
**Promesse** : un agent LLM consomme tous les endpoints MCP (cf 2bis.1)
et produit une **interprétation narrative** du repo. Pas de nouvelle
analytique, juste une couche de synthèse — le moins coûteux pour le
plus de valeur perçue.

**Exemple de sortie** :
> "Votre repo a +18% d'entropie depuis mars 2026, principalement dans
> le cluster 'auth' (semantic label confiance 0.84). Le fichier
> `oauth.ts` a vu son bus factor chuter de 2 à 1 après le départ de
> Marie en mars. Recommandation : (a) refactorer `oauth.ts` en 3
> modules plus petits pour diluer le risque social, (b) auditer la
> dette technique du cluster auth via `/dissonance`."

**Premier pas** :
- Skill Claude (`.claude/skills/gitnexus-architect.md`) qui décrit la
  pipeline : appeler `/entropy`, `/ownership`, `/dissonance`,
  `/similarity` via MCP (cf 2bis.1) et synthétiser.
- Prompt template structuré : Constat → Causes → Recommandations →
  Niveau de confiance.
- Mode `/tour --depth=quick|standard|deep`.

**Dépendance dure** : 2bis.1 (MCP exposure) doit être livré avant.

**Effort** : 2-3 semaines (prompt engineering + tests sur 3-4 repos
réels).

### 3.8 — Domain-specific AST extractors
**Promesse** : aujourd'hui Tree-sitter parse en générique. Ajouter des
extracteurs spécialisés par stack qui exposent des **concepts métier**
(Django: Models / Views / Serializers, React: Components / Hooks,
Spring: Controllers / Services / Repositories) → analytics au niveau
"domaine technique".

**Exemples d'insights nouveaux** :
- "Tes Django Models ont grossi de 40% en fields mais tes Serializers
  n'ont pas suivi → drift API/DB."
- "Tes React Components ont 12 niveaux de prop drilling moyen →
  introduire Context."
- "Tes Spring Controllers exposent 3× plus d'endpoints que de
  Repositories → couche service sous-développée."

**Premier pas** : refactor le parser Tree-sitter pour accepter des
extracteurs en plugin (dépend de 3.10). Chaque extracteur expose :
```js
{ language: "python", framework: "django",
  patterns: [{ nodeType: "class_definition",
               classifier: node => isDjangoModel(node) ? "Model" : null }],
  analytics: [...] }
```

**Couvre aussi** la détection AST-pattern (DI, Factory, etc.)
mentionnée comme limitation de 2.5.

**Effort** : 1-2 semaines par stack supporté. Démarrage avec la stack
dominante de hmm_studio.

### 3.9 — Public reference dataset / industry baselines
**Promesse** : indexer N repos OSS publics (top GitHub par langage,
curated list) pour créer un dataset de référence. Permet de répondre à
"votre entropie 0.42, médiane des Django projects OSS = 0.31, p90 =
0.55".

**Premier pas** :
- Pipeline d'indexation batch : `gitnexus analyze` sur 100-1000 repos
  OSS curés (top par stars × diversité de stacks).
- Storage dédié (DuckDB partagé ou LadybugDB read-only).
- `GET /baseline?language=python&framework=django&metric=entropy` →
  `{ p10, p50, p90, n, sampledRepos: [...] }`.
- Intégration dans la Galaxie 2.6 : tes repos placés au milieu de la
  carte OSS.

**Difficulté** :
- Coût compute (1000 repos × 10 min indexation ≈ 1 semaine machine).
- Stockage (~100 GB ordre de grandeur).
- Mise à jour : ré-indexer mensuellement ? Trimestriellement ?
- Licence : indexation pour stats publiques OSS, mais l'embedding LLM
  des labels peut avoir des implications selon le provider.

**Moat compétitif** : aucun outil grand public n'expose ces baselines.
**Pivot stratégique potentiel** : si on attaque le Chemin C (SaaS / API
publique), ce dataset est le différenciateur.

**Effort** : 1 mois initial (compute + curation + endpoint), puis
1-2j/mois maintenance.

### 3.10 — Plugin architecture pour analytics
**Promesse** : registre déclaratif des analytics. Toute nouvelle
métrique = déclaration `{ name, inputs, outputSchema, ui, mcpExposure }`.
Le backend compose dynamiquement les endpoints REST, le CSV serializer,
les MCP tools, et les hints UI. **Lève le goulot d'inflation
horizontale** (chaque analytique = 5 fichiers à toucher aujourd'hui).

**Schéma de plugin** :
```js
// upstream/plugins/entropy.mjs
export default {
  name: "entropy",
  version: "1.0.0",
  inputs: { repo: "string", snapshotId: "string?" },
  outputSchema: {
    density: "number",
    modularity: "number",
    entropy: "number"
  },
  compute: async ({ repo, snapshotId }, ctx) => { /* ... */ },
  ui: { panel: "EntropyBadge", placement: "Timeline" },
  mcp: {
    description: "Calcule l'entropie structurelle d'un snapshot.",
    exposeAs: "mcp__gitnexus__entropy"
  },
  csv: { columns: ["density", "modularity", "entropy"] }
};
```

**Premier pas** :
1. Identifier 3 analytics représentatives (entropy, ownership,
   similarity) et les ré-implémenter via le plugin schema.
2. Backend qui scanne `upstream/plugins/*.mjs` au boot et enregistre :
   - route REST `GET /:name`
   - colonne CSV via le serializer partagé
   - tool MCP (cf 2bis.1)
   - hint UI (registry frontend qui consomme la liste des plugins)
3. Migrer les 18 analytics existantes une par une.

**Effort** : 1 mois (refonte backend + migration des analytics existantes).

**ROI** : permanent. Chaque future analytique économise 60-80% du
plumbing. Pré-requis tacite à toute évolution Tier 3 ultérieure.

---

## 🛠️ Optimisations d'existant à programmer

> Pas des nouvelles features — des durcissements à faire avant que la
> plate-forme casse sous le poids des features successives.

| Cible | Optimisation | Effort | Trigger |
|---|---|---|---|
| **Snapshot storage** | Audit LadybugDB pour structural sharing entre snapshots ; si non dispo, dé-dupe par hash de node | À auditer | À 200+ snapshots cumulés, vérifier la taille disque |
| **Semantic label cache** | Invalidation auto sur drift de community (re-fingerprint à chaque création snapshot) | 2-3j | Quand un label affiche un sens incorrect après reindex |
| **Frontend bundle** | Code-splitting par panel (lazy load Sigma, three.js, react-force-graph-3d) | 1 semaine | Cold start visible >3s sur un repo moyen |
| **Export/Import** | Round-trip integrity check + versioning du format export | 2-3j | Avant le premier "import a échoué silencieusement" en prod |
| **HTTP cache** | ETag sur analytics figées — les snapshots passés sont immuables, cachables ∞ | 3-5j | Quand le dashboard charge >5 endpoints en parallèle au démarrage |
| **Repo registry** | Index inversé sur `repoId` (cf 2bis.5) pour lookup multi-base | 1-2j | Quand on a 3+ clones du même repo sur des chemins différents |
| **Smoke tests** | Harness `curl + assert` qui tourne après `docker compose build` (CLAUDE.md note "no test suite") | 1 semaine | Avant la prochaine fois où un patch upstream casse un endpoint silencieusement |
| **Perf instrumentation** | Endpoint `/metrics` exposant latences p50/p95/p99 par endpoint + count de cache hits | 3-5j | Quand on n'arrive plus à diagnostiquer un slowdown |

---

## 🎯 Vision architecturale — trois chemins de maturité

Le produit actuel est une **plate-forme d'analytique de code historisée
+ social-aware**. Trois orientations stratégiques pour la maturité,
**exclusives en positionnement** même si techniquement compatibles :

| Chemin | Slogan | Features clés | Public visé | Modèle |
|---|---|---|---|---|
| **A — Architectural CI** | "Surveille votre architecture comme un garde-fou" | 3.6, 2bis.3, 2.4 | Team lead / eng manager | Workflow PR / GitHub Action |
| **B — Architect's Copilot** | "Architecte virtuel qui vous conseille" | 3.7, 2.5, 2.6, 3.4, principe MCP-first | Staff / principal engineer | Conversationnel / MCP |
| **C — Galaxie OSS / Industry baseline** | "Comparez votre repo à 10k projets publics" | 3.9, 2.6 étendue, 2.5 Galaxie | CTO, M&A diligence, OSS maintainers | SaaS / API publique |

**Recommandation actuelle (à valider explicitement avant pivot)** :
**Chemin B** pour le contexte single-user / écosystème adjacents. C'est
le moins en concurrence directe avec Akon Labs (qui vend déjà du Chemin
A via leur PR Review commercial — cf [INVENTORY A.11](INVENTORY.md#partie-a)),
et c'est le plus aligné avec l'usage agent-IA actuel.

**Important** : "Chemin B" ne signifie pas "abandonner le reste". Tier
1, Tier 2.1-2.4 ✅ livrés, Tier 2bis (plate-forme), 2.5, et la plupart
du Tier 3 sont indispensables à n'importe quel chemin. La vision sert à
**filtrer les futures additions** et à choisir le messaging — pas à
abandonner l'acquis.

---

## 🚨 Refactos structurels à surveiller

> Issues architecturales identifiées dans la revue 2026-05-26. À
> traiter **avant** que la plate-forme casse, pas après.

| Issue | Symptôme actuel | Quand devient critique | Fix |
|---|---|---|---|
| **Pas de méta-architecture analytics** | Chaque nouvelle métrique = 5 fichiers à toucher (endpoint, CSV, panel, types, MCP) | À 25+ analytics (on est à 18) | 3.10 Plugin architecture |
| **Pas d'observabilité produit** | Aucune perf metric, aucun SLO, "no test suite, manual curl" (CLAUDE.md) | Quand un endpoint régresse silencieusement | Smoke harness + `/metrics` endpoint (cf Optimisations) |
| **Repo ID instable** | `<base>` = chemin disque, re-clone casse les liens cross-repo | Dès qu'on a 2 clones du même repo | 2bis.5 |
| **Configs disjointes** | `.gitnexus-domains.yaml` existe déjà ; policy + budgets + watches arrivent | À 3+ fichiers config par repo | 2bis.4 Unified config |
| **MCP gap sur analytics** | Le MCP-first principle des Principes de design n'est appliqué qu'au graphe upstream | Dès qu'on veut utiliser Claude comme advisor (cf 3.7) | 2bis.1 MCP exposure |
| **Divergence upstream** | +275 commits behind main upstream ([INVENTORY C](INVENTORY.md#partie-c)) | Au prochain bump majeur (refactor LadybugDB ?) | Bumper + reapply, OU négocier plugin system upstream avec abhigyanpatwari |
| **Croissance UI horizontale** | Chaque feature = 1 panel ; on est à ~10 panels | À 15+ panels (inflation cognitive) | Consolidation UX + regroupement par contexte (Health / Social / Cross-repo) |

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

## Ordre d'exécution recommandé (post-revue 2026-05-26)

Ordonné par **ratio impact / effort** + dépendances. La **plate-forme
d'abord** (Tier 2bis), les features stratégiques ensuite, le R&D pour la
fin. Tout ce qui suit s'appuie sur Tier 1 + Tier 2.1-2.4 ✅ déjà livrés.

### Phase 0 — Acquis (rappel)
- ✅ Tier 1 complet (1.1 à 1.5)
- ✅ Tier 2.1 (semantic labels), 2.2 (dissonance), 2.3 (what-if), 2.4 (VSCode MVP)

### Phase 1 — Plate-forme (avant toute nouvelle feature horizontale)
1. **2bis.1 MCP exposure** — débloque l'agent-driven usage et 3.7. ~3-5j.
2. **2bis.4 Unified `.gitnexus.yaml`** — avant que les configs explosent. ~2-3j.
3. **2bis.5 Repo ID stable** — pré-requis cross-repo robuste. ~3-5j.

> **Sortie de Phase 1** : ~2 semaines. Tout le reste devient plus facile et plus puissant.

### Phase 2 — Diagnostic fin
4. **2bis.2 Commit-level entropy delta** — identifie la PR exacte qui dégrade. ~1 semaine.
5. **2bis.3 Alerting continu** — garde-fou actif via webhook. ~1-2 semaines.

### Phase 3 — Cross-repo (quand ≥3 repos indexés)
6. **2.5 Cross-repo similarity** — Score de Correspondance + cube 2×2×2. ~2-3 semaines.
7. **2.6 Galaxie UMAP** — carte de l'écosystème, K-means + exoticness. ~1-2 semaines.

### Phase 4 — Méta-architecture (lever le goulot horizontal)
8. **3.10 Plugin architecture** — registre déclaratif des analytics. ~1 mois.

> Trigger : quand on a 25+ analytics OU avant 3.8 (qui le requiert).

### Phase 5 — Stratégique (dépend du Chemin retenu)
9. **3.7 AI-guided tour** (Chemin B) — synthèse narrative MCP-driven. ~2-3 semaines. Requiert 2bis.1.
10. **3.6 Architectural CI** (Chemin A — vs commercial Akon Labs) — PR check + budgets. ~3-4 semaines. Décision stratégique requise.
11. **3.8 Domain-specific AST extractors** — Django/React/Spring concepts. ~1-2 sem/stack. Requiert 3.10.
12. **3.9 Public reference dataset** (Chemin C) — baseline industrie. ~1 mois initial + maintenance.

### Phase 6 — R&D long terme
13. **3.1 Dead code runtime** — APM-bloqué.
14. **3.2 Mutation tracking / profils devs** — social-sensible.
15. **3.3 Conway's Law audit** — GitHub API requise.
16. **3.4 Auto-PR refactoring** — codegen fiable difficile.
17. **3.5 Modèle prédictif de bugs** — pure R&D ML.

### En parallèle continu — Optimisations & refactos
- Smoke tests harness (avant que ça casse silencieusement).
- HTTP cache ETag (quand le dashboard rame).
- Bump upstream + reapply (quand on touche un fichier upstream majeur).
- Cf section "Optimisations d'existant" + "Refactos structurels".

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
