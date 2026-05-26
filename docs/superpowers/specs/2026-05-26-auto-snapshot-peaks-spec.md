# Auto-snapshot aux pics — Phase A spec

**Date** : 2026-05-26
**Status** : ready-to-implement
**Auteur** : Robin DENIS (spec Claude Opus 4.7)
**Parent** : [`2026-05-26-incremental-snapshots-design.md`](2026-05-26-incremental-snapshots-design.md) — Phase A du phasing A/B/C.

---

## 1. Goal

Permettre au système de snapshotter automatiquement les commits "intéressants" (ceux où l'entropy a le plus bougé), pour densifier la timeline sans la noyer. Résultat utilisateur : meilleure résolution sur les moments qui comptent (UC1 bisect approximatif, UC2 démo, Q1/Q3/Q5), sans avoir à snapshotter manuellement chaque commit ou chaque jour.

## 2. Out of scope

- Snapshot **automatique post-push** (= déclenché à chaque commit/push). C'est Phase C.
- PR-mode snapshot (= Phase B).
- Détection de pics autres que entropy (coupling spike, ownership churn). Extension possible plus tard.

## 3. Surface utilisateur

### 3.1 Endpoint

```
POST /snapshot/auto?repo=<base>
Content-Type: application/json

{
  "topPercent": 10,         // garder les commits dont |Δ| est dans le top 10%
  "windowDays": 90,         // fenêtre d'analyse
  "debounceDays": 7,        // jamais deux snapshots à <N jours l'un de l'autre
  "minDelta": 0,            // floor absolu sur |attributedDensityDelta| (skip pics trop petits)
  "excludeMerges": true,    // skip les commits de merge
  "metric": "density",      // "density" | "modularity" — sur quoi peaker
  "dryRun": false,          // si true, retourne le plan sans snapshotter
  "maxToCreate": 20         // hard cap — sécurité contre les explosions
}
```

Tous les params optionnels avec defaults raisonnables. Body vide → defaults. Fallback : `.gitnexus.json > auto_snapshot` si pas de body. Le body explicite gagne sur la config.

### 3.2 Réponse

```json
{
  "repo": "hmm_studio",
  "dryRun": false,
  "windowDays": 90,
  "metric": "density",
  "topPercent": 10,
  "candidatesTotal": 99,          // commits dans la fenêtre
  "eligibleAfterFilters": 12,     // après top-P% + merges + minDelta + debounce
  "alreadySnapshotted": 3,        // déjà dans le snapshot store
  "plannedSnapshots": 9,          // = eligible - alreadySnapshotted (capped at maxToCreate)
  "results": [                     // un par commit traité (créé OU déjà existant OU skipped/error)
    {
      "sha": "c736ea0...",
      "date": "2026-05-22T15:46:47+02:00",
      "author": "Robin DENIS",
      "attributedDelta": 0.0034,
      "status": "created" | "existing" | "skipped" | "error" | "planned",
      "reason"?: "debounce" | "merge" | "below-min-delta",
      "snapshotKey"?: "hmm_studio@abc123",
      "error"?: "..."
    },
    ...
  ],
  "summary": {
    "created": 9,
    "skipped": 0,
    "errors": 0
  }
}
```

### 3.3 MCP tool

`gitnexus_snapshot_auto(repo, topPercent?, windowDays?, dryRun?, ...)`. Description précise que c'est non-destructive en `dryRun: true`, et que `dryRun: false` crée vraiment des snapshots (compute + disk cost). Recommander toujours `dryRun: true` d'abord pour voir le plan.

### 3.4 UI (déferred Phase A.bis)

Bouton "Auto-snapshot peaks" dans la Timeline OU dans le drill-down du EntropyCommitTimeline. Initialement on shippe l'endpoint + le MCP tool, et on attend retour user avant l'UI — pour ne pas wrapper un endpoint qu'on n'a jamais utilisé en vrai.

## 4. Algorithme

1. Lire le body params + merge avec `.gitnexus.json > auto_snapshot` defaults
2. Récupérer les commits via la même mécanique que `/entropy/commits` :
   - Construire la snapshot timeline (= déjà fait par `loadSnapshotEntropyTimeline`)
   - `git log` sur la fenêtre `windowDays`
   - Attribuer les deltas par interpolation snapshot-bracketing (déjà fait par `parseGitLog` + `parseLogForRepo` + l'algo qui existe)
3. Filtrer :
   - Drop merges si `excludeMerges`
   - Drop stragglers (`attributedDelta === null`)
   - Drop ceux dont `|attributedDelta| < minDelta`
   - Garder le top `topPercent` par `|attributedDelta|`
4. Pour chaque commit éligible :
   - Vérifier s'il est déjà snapshotté (`<SNAPSHOTS_ROOT>/<safeKey(base)>/<sha>` existe)
   - Appliquer le debounce : skip si un autre snapshot (existant OU planifié dans ce pass) est à <`debounceDays` jours
5. Cap à `maxToCreate`. Trier par date desc avant de capper (= priorité aux pics récents).
6. Si `dryRun: true`, retourner le plan sans rien créer
7. Sinon : pour chaque commit planifié, appeler `createSnapshot({ repoName, commitRef: sha, api })` séquentiellement (parallel serait trop agressif sur `gitnexus analyze`).
   - On_phase callback : juste log à stderr, pas de SSE pour Phase A (les snapshots ciblés sont rapides à monitorer via Docker logs ; SSE peut être ajouté Phase A.bis si besoin).
8. Retourner le résumé final.

## 5. Implementation

- **Nouveau fichier** : `upstream/docker-server-snapshot-auto.mjs`
- **Réutilise** :
  - `loadSnapshotEntropyTimeline` + `parseGitLog` + interp algo → idéalement extraire vers un helper partagé avec `docker-server-entropy-commits.mjs`. Si refactor trop lourd, dupliquer en MVP avec TODO de partage.
  - `createSnapshot` exporté par `docker-server-snapshots.mjs`
  - `getConfig` (déjà parse `auto_snapshot` si on ajoute la section dans `docker-server-config.mjs`)
- **Extension** de `docker-server-config.mjs` : parser `auto_snapshot` section avec les mêmes defaults que l'endpoint
- **Wire route** dans `docker-server.mjs`
- **Dockerfile.web** COPY ligne
- **MCP tool** dans `mcp-server/server.mjs` + update `smoke.mjs` (17 tools)
- **Test manuel** : `dryRun: true` sur hmm_studio (99 commits, 5 snapshots existants) — vérifier que le plan est sensé. Puis un vrai run avec `maxToCreate: 2` pour valider end-to-end sans exploser le storage.

## 6. Edge cases à gérer

- **Repo sans snapshots** : on ne peut pas attribuer de delta → retourner `eligibleAfterFilters: 0` + warning "Need at least 2 snapshots to compute deltas. Run /snapshot/bulk first to seed the timeline."
- **Repo sans .git** : 400 (déjà géré par `findRepoByName` ou check explicite)
- **Compte total qui descend à zéro après filtres** : retourner `plannedSnapshots: 0`, c'est un cas normal
- **Race** : si deux clients lancent `/snapshot/auto` en parallèle, ils créeront tous les deux les mêmes snapshots. `createSnapshot` est idempotent (déjà géré : check `existing` dans bulk), donc safe mais wasteful. Pas critique pour MVP. Documenter.
- **Long timeout** : `createSnapshot` peut prendre 3-5 min × N. Sur Phase A on n'envoie pas de progress aux clients, ils attendent la réponse finale. Si `maxToCreate=20`, ça peut être ~1h. Le client HTTP timeout côté frontend sera dépassé. **Choix** : pour la v1, capper hard `maxToCreate ≤ 5` côté code (override possible par env var) + recommander dans la doc d'utiliser plusieurs runs successifs. Phase A.bis ajoute SSE.

## 7. Smoke checklist post-impl

```bash
# Dry-run sur un repo qui a déjà des snapshots
curl -X POST "http://localhost:4173/snapshot/auto?repo=hmm_studio" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "topPercent": 10}'
# → 200, summary avec plannedSnapshots > 0 et results en mode "planned"

# Vrai run cappé à 1 snapshot
curl -X POST "http://localhost:4173/snapshot/auto?repo=hmm_studio" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false, "topPercent": 10, "maxToCreate": 1}'
# → 200 après ~3-5 min, summary.created = 1

# Erreurs
curl -X POST "http://localhost:4173/snapshot/auto"           # → 400 missing repo
curl -X POST "http://localhost:4173/snapshot/auto?repo=ko"   # → 404 repo not found

# MCP tool
node mcp-server/smoke.mjs  # → 17 tools incluant gitnexus_snapshot_auto
```

## 8. Decision before code

Cap hard à `maxToCreate ≤ 5` par défaut, override-able. OK ? Sinon proposer un cap différent.

→ Spec validée par user dans la conversation, on attaque l'impl.
