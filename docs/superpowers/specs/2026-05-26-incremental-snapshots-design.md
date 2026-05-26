# Incremental snapshots — design brainstorm

**Date** : 2026-05-26
**Status** : brainstorm, pre-implementation
**Auteur** : Robin DENIS (brainstorm avec Claude Opus 4.7)
**Trigger** : conversation après Tier 2bis.2 follow-up (commit overlay). User a demandé "peut-on visualiser au commit près ?" et confirmé qu'il veut couvrir 4 angles d'usage à la fois.

---

## 0. TL;DR

**Recommandation honnête** : ne PAS attaquer le true incremental directement. Livrer 3 chantiers en escalier de coût croissant, et ne passer au suivant que si le précédent ne suffit pas pour le use case réel.

| Phase | Effort | Couvre | Décision avant |
|---|---|---|---|
| **A. Auto-snapshot aux pics** | 3-5j | 80% des "voir où ça a basculé" | OK toujours |
| **B. PR-mode snapshot on-demand** | 1 sem | "Quel est l'impact graph de cette PR ?" | Si workflow PR est régulier |
| **C. True incremental** | 1+ mois | Per-commit exact + bisect | Si A+B n'ont pas suffi après 3 mois d'usage |

Phase A peut commencer sans plus de brainstorm. Phase B et C devraient être re-discutées après vécu réel sur A.

---

## 1. Context / problem

Aujourd'hui le Timeline gitnexus opère à la **granularité snapshot** : chaque snapshot = un full `gitnexus analyze` à un commit donné, ~3-5 min de compute, ~10-100 MB stockage. La Play loop walke ces snapshots (avec preload depuis aujourd'hui pour la fluidité).

Côté commit-level, on a livré :
- `/entropy/commits` (Tier 2bis.2) — attribution des deltas entropy par commit
- `EntropyCommitTimeline` sparkline (Tier 2bis.2 UI) — visualisation
- `/commit/footprint` + overlay (Tier 2bis.2 follow-up) — highlight des fichiers touchés sur le snapshot le plus proche

Mais on n'a **pas** le graph reconstruit au commit X. Le footprint c'est "qu'est-ce que ce commit a touché", pas "à quoi ressemblait le graph juste après ce commit".

## 2. Use cases (user a coché les 4)

### UC1 — Bisect / forensic
> "Le module auth est devenu un monolithe entre janvier et avril. Je veux trouver LE commit qui a fait basculer la modularité."

- **Aujourd'hui** : `/entropy/commits` attribue le delta par commit (méthode : interpolation entre snapshots bracketants). Le commit responsable apparaît comme le plus gros delta dans son window. Précision = à la fenêtre snapshot près.
- **Manque** : la précision exacte au commit. Si 30 commits sont dans la même fenêtre, le coupable noyé est dilué.
- **Solution** : snapshot précis sur les commits suspects. Phase A (auto-snapshot aux pics) résoudrait ça en pratique car ce sont précisément les pics qu'on veut isoler. Pas besoin du true incremental.

### UC2 — Curiosité / démo visuelle
> "Je veux voir le graph évoluer commit par commit comme une vidéo."

- **Aujourd'hui** : Play loop sur snapshots avec preload = lisse, mais granularité = snapshot.
- **Manque** : la fluidité par-commit. Effet "wow" mais peu de valeur opérationnelle récurrente.
- **Honest framing** : à 1 commit/jour de moyenne, un repo a 100-3000 commits historiques. Faire 100 frames à la place de 5 = jolie démo. Faire 3000 frames = personne ne regarde, et c'est cher.
- **Solution** : Phase A snapshot aux moments significatifs (10-50 frames au lieu de 5) couvre la démo sans exploser les coûts. Le commit overlay (livré) répond au "regarder un commit spécifique".

### UC3 — PR review : impact graph d'une PR
> "Cette PR de 5 commits touche le cluster auth. Quel est le delta structurel exact ?"

- **Aujourd'hui** : on peut comparer 2 snapshots (diff visuel rouge/vert). Mais pas le graph à un commit PR-spécifique sans le snapshotter.
- **Manque** : un workflow "open PR → see graph delta" automatisé.
- **Solution** : Phase B = `/snapshot/from-branch?repo=X&base=main&head=feature/auth` qui snapshotte 2 commits on-demand (HEAD de base + HEAD de feature), puis diff. Pas besoin d'incremental général ; juste 2 snapshots à la volée. ~1 semaine d'effort + un GitHub Action wrapper.

### UC4 — Brainstorm (= "je sais pas tous les use cases")
> "Reculer d'un cran et lister honnêtement les questions qu'on veut pouvoir poser AVANT de décider de la mécanique."

Voici la liste pré-établie pour valider que A+B suffisent :

- **Q1** "Quel commit a démarré le pic entropy de mars ?" → Phase A
- **Q2** "Quelle PR a introduit la dépendance cyclique X → Y → X ?" → Phase A (snapshot au pic coupling) ou Phase C (bisect précis)
- **Q3** "Replay l'évolution du cluster auth" → Phase A (10-50 frames suffisent)
- **Q4** "Que va casser cette PR ?" → Phase B
- **Q5** "Le commit X a-t-il introduit un orphan ?" → on a déjà `/lifespan` qui catch ça aux frontières snapshot. Phase A améliore la résolution.
- **Q6** "Donne-moi le graph **exact** au commit abc123" → Phase C **seulement** ou snapshot manuel via `/snapshot/bulk` avec un range d'un seul commit
- **Q7** "Bisect : trouve le commit qui a introduit ce pattern de coupling" → Phase C (vrai bisect) OU snapshot ciblé manuel
- **Q8** "Comparer deux PRs concurrentes pour décider laquelle merger" → Phase B

**Verdict de la liste** : Q1-Q5 + Q8 couverts par A+B. Seul Q6 et Q7 demandent C en théorie, et même là un snapshot manuel répond pratiquement.

## 3. Sur "forker / améliorer Git" — non

Trois raisons :

1. **Git est imbattable en écosystème**. 19 ans de edge cases, 2000+ contributors, network effect GitHub/GitLab/Bitbucket. Forker = posséder la maintenance à vie sans rien gagner. Tous les concurrents (Mercurial, Bazaar, Fossil, Sapling, Jujutsu) ont leur niche, aucun n'a déplacé Git en pratique.
2. **Notre problème n'est pas un problème Git**. Git stocke des commits + diffs texte excellemment. Notre problème = stocker et replay des diffs AST-level + graph-level. C'est une couche **au-dessus** de Git.
3. **Upstream à Git** = pace glacial (années entre RFC et merge), et ils refuseraient un truc gitnexus-spécifique.

**Ce qu'on peut emprunter à Git sans forker** :
- `git notes` — objets first-class attachés aux commits, syncables via remotes. Pourrait porter nos diffs incrémentaux. Niche mais propre. À garder en tête si on arrive à Phase C.
- `git rev-list --bisect` pour des opérations de bisect natives (Phase C, UC7)
- Le reste du toolkit (`git log`, `git show`, `git diff`) déjà exploité par nos endpoints
- **Pas** le format de pack (overkill pour notre volume)

## 4. Ce que font les concurrents

| Outil | Approche | Verdict |
|---|---|---|
| **Codescene** (A. Tornhill, commercial) | Re-analyse à la demande, jamais incremental | Conclusion après ans de prod : "ne fais pas d'incremental, sois rapide" |
| **CodeQL** (GitHub) | Full per-commit databases | Payant + compute hosté, pas faisable pour nous |
| **Sourcetrail** (RIP) | Per-version, pas incremental | Mort en partie pour coût d'analyse |
| **Understand** (SciTools, commercial) | On-demand | Pas d'incremental |
| **Datomic / XTDB** | Bitemporal, fact-diff natif | Conceptuellement proche mais lourd, pas git-native |

**Personne ne fait du true incremental en production.** Signal fort : le ROI n'est pas évident.

## 5. Phasing proposé

### Phase A — Auto-snapshot aux pics (3-5 jours)

**Endpoint** : `POST /snapshot/auto?repo=<base>` qui :
1. Lit `/entropy/commits?repo=X&days=N` pour obtenir les attribués
2. Filtre les commits dont `|attributedDensityDelta|` est dans le top P% (e.g. p90)
3. Filtre les merges, les commits trop proches dans le temps (debounce 24h)
4. Pour chaque commit éligible non-snapshotté, déclenche `/snapshot/bulk` ciblé sur ce SHA
5. Optionnel : cron qui run ça en background une fois par jour (avec opt-in dans `.gitnexus.json > auto_snapshot`)

**Surface user** :
- Bouton "Auto-snapshot peaks" dans Timeline à côté de Preload, ou MCP tool `gitnexus_auto_snapshot`
- Config `.gitnexus.json > auto_snapshot: { topPercent: 10, debounceDays: 7, dryRun: false }`

**Couvre** : UC1, UC2, UC3 (en partie), UC5, Q1, Q3, Q5.

**Risques** :
- Coût de snapshot par pic (~3-5 min × 10 pics par repo = ~1h compute initial). Acceptable.
- Storage : 10 snapshots × 50 MB = 500 MB par repo. Acceptable.
- Sur un repo qui n'a jamais eu de snapshot bulk, le premier run en crée 10+ d'un coup. Ajouter un `dryRun: true` mode + confirmation.

### Phase B — PR-mode snapshot on-demand (1 semaine)

**Endpoint** : `POST /snapshot/from-pr?repo=<base>&base=<ref>&head=<ref>` qui :
1. Snapshotte le commit pointé par `base` (si pas déjà fait)
2. Snapshotte le commit pointé par `head` (idem)
3. Retourne `{ baseSnapshot, headSnapshot, diffUrl }`
4. Frontend ouvre direct le diff visuel existant entre les deux snapshots

**Variante GitHub** : `POST /snapshot/from-pr?repo=<base>&prNumber=42` qui appelle l'API GitHub pour résoudre base/head. Optional : Github App qui déclenche ça automatiquement à chaque PR open + commente la PR.

**Couvre** : UC3, UC4, Q4, Q8.

**Risques** :
- Coût : 2 snapshots par PR. Si l'équipe ouvre 20 PR/semaine = 40 snapshots/semaine. Manageable mais à monitorer.
- Cleanup : faut-il supprimer les snapshots PR après merge ? Probablement oui (`?ttl=7d` ou hook on PR-close).

### Phase C — True incremental (1+ mois, R&D)

**Idée** : un baseline snapshot + diffs append-only par commit. Chaque diff = `{ added: nodes[], removed: nodeIds[], modified: nodes[] }` sérialisé en JSON (~KB par commit pour les commits typiques).

**Mécanisme de calcul du diff** :
- Pour le commit C, lister les fichiers touchés (`git show --name-only`)
- Re-parser Tree-sitter sur ces fichiers à C^ et à C (deux checkouts) → deux sous-graphs
- Propager les changements aux voisins import-graph (1-hop suffit pour la plupart des cas)
- Diff les deux sous-graphs → `{ added, removed, modified }`
- Persister à `<repoPath>/.gitnexus/incremental/<sha>.json` (ou via `git notes`)

**Storage** :
- File-per-commit JSON : simple à debug, scale à ~10k commits. **Recommandé.**
- `git notes` ref dédié (`refs/notes/gitnexus`) : syncable via push/pull, intégré au workflow Git. **À considérer pour Phase C v2.**
- DB : overkill au début.

**Reconstruction** :
- Pour obtenir le graph à commit X : prendre le baseline le plus proche dans son histoire + replay les diffs jusqu'à X
- Cache les graphs reconstruits récents en LRU
- Rebuild la baseline périodiquement (mensuel ?) pour éviter le drift

**Risques** :
- **Compute** : ~1-5 sec par commit sur les fichiers touchés. 1000 commits = 1-1.5h de backfill par repo. OK pour un cron initial mais c'est cher.
- **Drift** : un replay de 1000 diffs accumule les erreurs de propagation (un import indirect mal détecté). Rebuild baseline nécessaire.
- **Storage** : 1000 commits × 10 KB diff = 10 MB. OK. Mais avec gros refactors (1000 nodes touchés) ça peut spike à 1 MB / commit.
- **Maintenabilité** : architecture qu'on n'a vu personne déployer en prod. On va inventer des bugs.

## 6. Décisions à trancher

### D1 — Démarrer par Phase A ?

Probablement oui. Coût bas (3-5j), ROI fort. Permet de générer la data dont les autres phases auront besoin (plus de snapshots = meilleurs deltas pour `/entropy/commits`).

### D2 — Phase B sans attendre B ?

Possible en parallèle. C'est un produit user-facing différent (workflow PR vs exploration historique). Pourrait être délégué à une session parallèle.

### D3 — Phase C : on attend la justification ou on prépare l'architecture ?

**Recommandation** : on attend. Vivre 3 mois avec A+B. Si on entend "j'aurais voulu un graph précis à ce commit-là" plus de 3 fois, on en reparle. Sinon, parquer la Phase C.

### D4 — Si Phase C, file-per-commit JSON ou git notes ?

À trancher au moment où on l'attaque. JSON est le MVP raisonnable ; git notes est le "polish" syncable.

### D5 — Intégrer `git notes` dès Phase A ?

Pas nécessaire. Phase A produit des snapshots full, pas des diffs. `git notes` n'aide pas ici.

## 7. Out of scope (parking)

- **Réimplémenter Git** : non (cf section 3).
- **Upstream à gitnexus** : pas dans ce design. Si on a un mode incremental qui marche, on pourrait proposer un patch upstream, mais ce serait une discussion à part.
- **Intégrer un fact-store type Datomic** : overkill et hors-écosystème Node.
- **Visualisation 4D** (graph + temps + auteur + métrique) : c'est un autre design.

## 8. Plan d'action immédiat

1. Le user lit ce doc et valide ou amende.
2. Si OK : on attaque Phase A. Spec courte (`2026-05-XX-auto-snapshot-peaks-spec.md`) puis impl.
3. Phase B après Phase A vécue 1-2 semaines.
4. Phase C reste parquée jusqu'à signal explicite du besoin.

---

**Méta-note** : ce design fait délibérément le choix de la modestie. La tentation de "construire un vrai système incremental" est forte, mais aucun concurrent ne l'a réussi en open-source ou en commercial. Notre avantage = être pragmatique. Si Phase A+B suffit, on a gagné.
