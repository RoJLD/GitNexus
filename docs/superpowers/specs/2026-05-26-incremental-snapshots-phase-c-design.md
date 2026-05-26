# Phase C — true per-commit incremental snapshots

**Date** : 2026-05-26
**Status** : design exploration (no code yet)
**Auteur** : Robin DENIS (audit + design Claude Opus 4.7)
**Parent** : [`2026-05-26-incremental-snapshots-design.md`](2026-05-26-incremental-snapshots-design.md) — phasing A/B/C
**État Phase A** : ✅ livrée (auto-snapshot aux pics)
**État Phase B** : ✅ livrée (PR-mode snapshot on-demand)

---

## 0. TL;DR — discovery majeure

**gitnexus upstream a déjà 99% du machinery incremental**, juste pas exposé.

Ce que la machinerie fait déjà (audit code dans `upstream/gitnexus/src/core/incremental/` et `src/orchestrator/run-analyze.ts`) :

- **File-hash diffing** (`file-hash.ts` + `diffFileHashes()`) — détecte changed/added/deleted entre deux runs
- **Importer queries** (`queryImporters()`) — BFS bornée pour propager aux fichiers qui importent les modifiés
- **Subgraph extraction** (`extractChangedSubgraph()`) — filtre le graph complet aux seuls nodes du write-set
- **Selective DB writes** (`deleteNodesForFile()` + `loadGraphToLbug(subgraph)`) — purge + insert par fichier
- **Stable node IDs** (`Label:QualifiedName` — `lib/utils.ts:1`) — survivent aux re-runs, ancres pour les diffs
- **LBugDB upsert-via-delete-then-insert** — déjà production-ready

**Ce qui manque** :
- **CLI flag** `--incremental` ou `--since=<sha>` (le mode n'est jamais déclenché par l'utilisateur, seulement comme path automatique post-pipeline)
- **Option** de skipper Leiden communities (la détection tourne globalement à chaque pass, coût fixe ~10-30s sur repo moyen)
- **Persistance des diffs** par commit côté gitnexus (les snapshots actuels = full DB)

**Conséquence pour notre design** : Phase C n'est plus un projet de réimplémenter un analyzer (5K LOC + plusieurs mois). C'est exposer + persister ce qui existe (~200-500 LOC, 1-2 semaines avec benchmarks).

---

## 1. Re-statement du problème

Aujourd'hui :
- Snapshots = full `gitnexus analyze` à un commit (clone + parse + Leiden + DuckDB), ~3-5 min, ~10-100 MB
- Phase A snapshotte aux pics → 5-30 snapshots par repo
- Phase B snapshotte 2 commits pour comparaison PR
- **Mais** : pour obtenir le graph à un commit X arbitraire, pas d'autre choix que snapshot complet

Use cases du brainstorm parent restés non couverts par A+B :
- **Q6** "Donne-moi le graph **exact** au commit abc123"
- **Q7** "Bisect : trouve le commit qui a introduit ce pattern de coupling"

Phase C cible spécifiquement ces deux.

## 2. Les 4 problèmes durs (et leur état réel)

### 2.1 Parité Tree-sitter

**Crainte initiale** : "il faudrait re-parser à l'identique de gitnexus, avec les mêmes versions de grammars, le multi-langage, etc."

**Réalité** : non. gitnexus' pipeline tourne en entier — on **réutilise** le parser upstream. On ne réimplémente rien.

### 2.2 Communities (Leiden)

**Réalité** : `pipeline-phases/communities.ts` tourne sur le **graph complet** post-MRO, à chaque pass. C'est une phase globale, non file-local. Implication pour Phase C :

- **Option 2.2.a** — Inclure communities dans chaque diff per-commit. Coût : Leiden ~10-30s à chaque commit. Sur 1000 commits = 3-8h compute additionnel. Inacceptable.
- **Option 2.2.b** — Skipper communities pour les passes incremental. Le graph reconstruit au commit X aura les communities **du baseline le plus proche**, pas celles "réelles" au commit X. Honnête, documentable. Recommandé.
- **Option 2.2.c** — Rebuild communities périodiquement (mensuel ?) sur un nouveau baseline. Best of both worlds avec un peu d'overhead. À considérer.

Décision recommandée : **2.2.b** au MVP, **2.2.c** en optimisation post-MVP.

### 2.3 Propagation d'edges cross-file

**Crainte initiale** : "un nouveau Function dans fichier A qui appelle un truc dans fichier B → comment on update les CALLS edges de B ?"

**Réalité** : le pipeline upstream parse 100% des fichiers (la résolution cross-file en a besoin). L'incremental upstream **utilise déjà** `queryImporters()` (BFS bornée) + le write-set extension pour catcher exactement ce cas. On hérite gratuitement.

### 2.4 Format de stockage

Trois options sérieuses :

| Option | Pour | Contre |
|---|---|---|
| **JSON file-per-commit** dans `<repoPath>/.gitnexus/incremental/<sha>.json` | Simple, debuggable, scale à ~10k commits | Pas syncable via remotes sans astuce |
| **`git notes` ref dédié** (`refs/notes/gitnexus-incremental`) | Syncable via `git push/fetch refs/notes/*`, intégré au workflow Git | Plus complexe à debug, gitnotes pas super utilisé donc edge-cases tooling |
| **LBugDB sidecar** (`<repoPath>/.gitnexus/incremental.lbug/`) | Cohérent avec le storage gitnexus | Adapter à écrire (notre code n'a jamais touché LBugDB direct) |

Décision recommandée : **JSON file-per-commit** pour le MVP (simple, on connaît). Migration vers `git notes` en v2 si on veut le sync remote.

## 3. Investigation à faire avant de coder

Trois choses qu'on ne sait pas et qu'il faut mesurer :

### 3.1 Combien de temps prend `gitnexus analyze --incremental` sur un commit "petit" ?

Le briefing dit "le pipeline parse 100% des fichiers même en incremental". Le gain incremental est **uniquement** sur les writes DB. La parse complète sur un repo moyen peut prendre 30s-2min.

**Spike** : modifier `upstream/gitnexus/src/cli/analyze.ts` pour exposer `--incremental` (juste la CLI), mesurer le temps sur 3 commits différents de hmm_studio (1 commit qui touche 1 fichier, 1 qui touche 10, 1 qui touche 100). Si c'est 30s par commit, faisable. Si c'est 2min, on doit revoir.

### 3.2 Quelle taille font les diffs en pratique ?

Théorique : 10 KB / commit. Réel : ?

**Spike** : compter les nodes/edges modified dans 10 commits réels d'hmm_studio, sérialiser, mesurer.

### 3.3 Le drift accumulé sur N commits → quand re-baseline ?

Le pipeline upstream reparse tout à chaque pass — donc en théorie pas de drift. Mais si on commence à persister des diffs et reconstruire from baseline, les imports résolus à C^ peuvent ne plus matcher ceux résolus à C (un import a été ajouté dans un fichier non-modifié par le commit qu'on regarde — edge case rare mais possible).

**Spike** : pas faisable avant impl. À documenter comme "watch for it, rebuild baseline si drift constaté".

## 4. Architecture proposée (post-investigation OK)

### 4.1 Path préféré : patch upstream gitnexus

Pourquoi pas Path A (wrap les fonctions internes via TS imports) :
- Les modules sont compilés dans le npm package. Importer `dist/core/incremental/*.js` marche probablement mais c'est une dépendance privée upstream — pète au prochain bump.
- Pas de garantie d'API stability.

Pourquoi Path B (CLI flag upstream) :
- Surface publique stable
- ~50 LOC à ajouter (CLI flag + skip-leiden option)
- Survit aux bumps mineurs upstream tant qu'on garde le diff dans `patches/upstream-all.diff`
- On a déjà l'infra `patches/` pour ça
- Optionnel : on peut **upstream le patch** au projet gitnexus (PR généreuse à la community). Acceptation pas garantie, mais ça vivrait dans notre fork patché si refusé.

### 4.2 Surface utilisateur

```
POST /snapshot/incremental?repo=<base>&commit=<sha>
Body (optionnel):
  {
    "force": false,             // re-generate even if diff exists
    "skipCommunities": true,    // skip Leiden (=default for incremental)
    "dryRun": false             // resolve + plan without running gitnexus
  }
```

**Réponse** :
```json
{
  "repo": "hmm_studio",
  "commit": { "sha": "abc...", "shortSha": "abc1234", "date": "..." },
  "baseline": { "sha": "previous-baseline-sha", "snapshotKey": "hmm_studio@..." },
  "diff": {
    "added":    { "nodes": 12, "edges": 34 },
    "modified": { "nodes": 3, "edges": 8 },
    "removed":  { "nodes": 1, "edges": 5 }
  },
  "diffPath": ".gitnexus/incremental/abc1234.json",
  "diffSizeBytes": 4521,
  "computeMs": 47000,
  "communities": "from-baseline-stale"
}
```

### 4.3 Reconstruction graph at commit X

```
GET /api/graph?repo=<base>&commit=<sha>
```

Nouveau path à côté du `?snapshot=` existant. Algorithme :

1. Trouver le baseline (snapshot) le plus proche dans l'ancestor de `<sha>`
2. Charger ce snapshot en mémoire (= comme on fait aujourd'hui pour les snapshots normaux)
3. Lister tous les commits entre baseline et `<sha>` via `git rev-list baseline..<sha>`
4. Pour chaque commit dans l'ordre chronologique : appliquer son diff (depuis `<repoPath>/.gitnexus/incremental/<commitSha>.json`)
5. Si un diff manque (commit pas encore traité par `/snapshot/incremental`), 2 options :
   - **a** : déclencher la génération à la volée (lazy)
   - **b** : 503 avec hint "missing diffs: [list]"
6. Retourner le graph reconstruit dans le format `/api/graph` standard

Décision : **a** pour la convenance, mais avec un timeout (10 commits manquants = 10×30s = trop long → fallback 503 avec hint).

### 4.4 Maintenance du baseline

- Initial : utiliser le snapshot le plus ancien existant
- Si plus de N commits depuis le baseline (config, e.g. N=500), créer un nouveau baseline (= snapshot complet) en background
- Garder les diffs des anciens baselines pour pouvoir reconstruire en arrière jusqu'à mois -X (purge configurable)

### 4.5 Cron / lazy

- **Lazy** : `/snapshot/incremental` est manuel ou déclenché par `/api/graph?commit=`
- **Cron** : daemon qui pre-warm les diffs des derniers N commits push (option `.gitnexus.json > incremental.preWarmCommits: 50`)

MVP = lazy uniquement. Cron en v2 si signal d'usage.

## 5. Effort estimé (post-investigation)

| Tâche | Effort si Path B (CLI flag upstream) |
|---|---|
| Patch upstream `--incremental` + `--skip-communities` flags | 2-3j |
| Backend `/snapshot/incremental` endpoint qui pipe vers le CLI | 2-3j |
| Storage helpers (read/write `<repoPath>/.gitnexus/incremental/<sha>.json`) | 1-2j |
| `/api/graph?commit=<sha>` reconstruction logic | 3-4j |
| MCP tool `gitnexus_snapshot_incremental` + `gitnexus_graph_at_commit` | 1j |
| Tests + benchmarks réels | 2-3j |
| Doc + ROADMAP/INVENTORY updates | 1j |
| **Total** | **12-17 jours** (vs 1+ mois prévu initialement) |

Plus les spikes de §3 (1-2j avant tout commit majeur).

## 6. Risques résiduels

| Risque | Mitigation |
|---|---|
| Parse complète trop lente (>2min/commit) | Si le spike §3.1 le révèle, parquer Phase C. On a A+B. |
| Drift sur long historique | Rebuild baseline périodique (§4.4). Spike pour confirmer fréquence nécessaire. |
| Upstream bump casse notre patch CLI | Le patch est petit (50 LOC), résolution des conflits manageable. |
| Communities stale = confusion utilisateur | Documenter explicitement dans la réponse (`communities: "from-baseline-stale"`). UI peut afficher un badge. |
| Disk usage explose | Cap configurable + purge des diffs hors-fenêtre. |

## 7. Plan d'attaque

1. **Spike §3.1** : patcher juste le CLI flag, mesurer 3 commits sur hmm_studio. **Go/no-go** sur la suite.
2. Si go : implémenter Path B selon §4.
3. Si no-go : documenter, parquer Phase C définitivement, on a A+B qui couvrent 95% des use cases.

**Estimation totale incluant spike + impl si go** : **2-3 semaines**.

## 8. Décisions à trancher

### D1 — On lance le spike ?

Coût : 1-2 jours. Bénéfice : on saura si Phase C est viable à 1-2 sem d'impl ou si on parque définitivement.

### D2 — Si spike OK, on patche upstream ou on wrap les internes ?

Recommandation : **patch upstream**. Briefing audit indique ~50 LOC, surface stable.

### D3 — Storage MVP : JSON file-per-commit ou direct `git notes` ?

Recommandation : **JSON file-per-commit**. Migration vers git notes en v2 si on veut le sync remote.

### D4 — Lazy ou cron pour le premier coup ?

Recommandation : **lazy seulement** au MVP. Cron en v2.

### D5 — Si upstream bump ré-écrit `src/core/incremental/`, on fait quoi ?

Recommandation : **on ré-applique le patch CLI**. Si l'API interne change drastiquement, on revisite. Acceptable risk.

---

**Méta-note** : ce design est radicalement plus prometteur que celui du brainstorm initial parce que la dette de réimplémenter un analyzer disparaît. gitnexus a fait 99% du boulot, faut juste l'exposer. C'est une opportunité unique de fork-utile : un petit patch upstream qui débloque une feature qu'on est seuls à shipper.
