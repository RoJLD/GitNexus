# Roadmap Predictive — Audit view design

**Date** : 2026-05-26
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Depends on** : [`2026-05-26-roadmap-predictive-core-design.md`](2026-05-26-roadmap-predictive-core-design.md) (CORE — ghost lifecycle, sidecars `.gitnexus/ghosts.json` + `.gitnexus/snapshots/<sha>/ghosts.json`)
**Sibling sub-specs** : Augmented graph, Brainstorm-hook, Gantt — voir [`IDEAS-PARKING-roadmap-predictive.md`](IDEAS-PARKING-roadmap-predictive.md)

---

## 1. Context / problem

Le CORE roadmap-predictive ([spec](2026-05-26-roadmap-predictive-core-design.md)) produit un état runtime des ghosts (planifiés / matérialisés / annulés) avec leur lifecycle dans `.gitnexus/ghosts.json` et un sidecar par snapshot historique. Cette donnée brute existe mais n'est pas exploitable telle quelle : on n'a aucun moyen de répondre à des questions comme **"est-ce que la roadmap glisse ?"**, **"quel est notre rythme de livraison ?"**, **"quels items voient leur plan changer souvent ?"** sans regrouper manuellement les ghosts à coups de jq.

L'utilisateur a 24+ features livrées et 2-3 en attente dans `ROADMAP.md` ; il veut voir l'écart entre prévisions et livraison de façon agrégée, et identifier les ghosts dont le plan instable signale un coût caché.

## 2. Goal

Livrer une **vue d'audit** (regard arrière) composée de 5 métriques agrégées (cancellation rate, lead time, slippage vs `plannedFor`, plan churn cross-snapshot, velocity 28-jour) exposées via :
- un endpoint HTTP `GET /ghost-audit?repo=<base>` avec cache disque invalidé sur mtime des sidecars sources,
- un panneau React `AuditPanel.tsx` dans gitnexus-web (summary + 3 charts + table détaillée),
- un tool MCP `ghost_audit` dans `gitnexus-claude-plugin` pour que Claude puisse répondre à des questions d'audit en langage naturel.

À l'issue, un user (ou Claude) doit pouvoir poser **"on respecte nos délais ?"** et obtenir un chiffre + une visualisation.

## 3. Design

### 3.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| UI calcule tout client-side (fetch `/ghosts` + N×`/ghosts/at`) | Plan churn nécessite N+1 fetches sur l'historique, prohibitif. Pattern incohérent avec les autres analytics (`/churn`, `/coupling`) qui ont un endpoint dédié. |
| Endpoint sans cache | Plan churn walk les snapshots à chaque call (~100ms–1s selon historique). Sur polling UI, ça additionne. Cache mtime-based ajoute 30 lignes de code pour x10 perf répétée. |
| Cache invalidation événementielle (POST hook) | Plus complexe et fragile que mtime check. Mtime check est idempotent et marche même si le serveur redémarre / si un snapshot est créé par un autre client. |
| Pas de tool MCP | Casse le pattern Tier 2bis.1 (12 tools MCP existants). Claude ne peut pas répondre aux questions d'audit sans passer par l'UI. |
| Lib externe pour stats (d3-array, simple-statistics) | Médian/percentiles tiennent en 5 lignes JS. Ajouter une dep pour ça n'est pas justifié. |
| Histogramme avec D3 / Recharts | Pattern `GrowthChart.tsx` (SVG natif) suffit pour 4 buckets. D3 = dep lourde pour zéro bénéfice. |

### 3.2 Approche retenue : endpoint + cache disque + MCP tool + panneau React

#### Architecture en couches

```
HTTP (web UI)            MCP (Claude clients)      [CLI : aucune en v1]
       │                          │
       ▼                          ▼
   ────────────────────────────────────────────────
                          │
                          ▼
  docker-server-ghost-audit.mjs   (I/O + cache invalidation)
      • computeAudit(repoPath)
          - if cache valid (mtime check) → return cache.json
          - else → compute via core fns, write cache, return
      • handleGhostAudit(req, res)      ← HTTP entry
                          │
                          ▼
  docker-server-ghost-audit-core.mjs    (pure fns, testable)
      • computeSummary(ghosts) → { total, materialized, planned, cancelled, cancellationRate }
      • computeLeadTime(ghosts) → { medianDays, p25Days, p75Days, maxDays, distribution }
      • computeSlippage(ghosts) → { early, onTime, late, noTarget, onTimePct }
      • computePlanChurn(snapshotGhostsArray) → { totalGhostsWithChurn, avgChurnPerGhost, topChurners }
      • computeVelocity(ghosts, windowDays) → { windowDays, currentCount, history }
      • parseTargetDate(s) → Date | null  (ISO / YYYY-QX / YYYY-MM)
                          │
                          ▼ reads
  <repo>/.gitnexus/ghosts.json                  (CORE latest)
  <repo>/.gitnexus/snapshots/<sha>/ghosts.json  (CORE per snapshot — for plan churn)
  <repo>/.gitnexus/ghost-audit-cache.json       (NEW : cached output)
```

#### Endpoint shape

`GET /ghost-audit?repo=<base>` retourne (200) :

```json
{
  "computedAt": "2026-05-26T...",
  "cached": true,
  "summary": { "total": 27, "materialized": 24, "planned": 2, "cancelled": 1, "cancellationRate": 0.037 },
  "leadTime": {
    "medianDays": 5.2, "p25Days": 3.0, "p75Days": 8.5, "maxDays": 24,
    "distribution": [{ "bucket": "0-7d", "count": 12 }, { "bucket": "7-14d", "count": 8 }, ...]
  },
  "slippage": { "early": 4, "onTime": 14, "late": 6, "noTarget": 3, "onTimePct": 0.58 },
  "planChurn": {
    "totalGhostsWithChurn": 5,
    "avgChurnPerGhost": 0.7,
    "topChurners": [{ "id": "...", "churn": 3, "deltas": ["description", "expectedLinks", "description"] }]
  },
  "velocity": {
    "windowDays": 28,
    "currentCount": 6,
    "history": [{ "weekStarting": "2026-04-26", "count": 2 }, ...]
  }
}
```

- **404** si `.gitnexus/ghosts.json` n'existe pas (jamais sync). Body : `{ error: "Run POST /ghosts/sync first." }`
- **200** si la sync a tourné mais `summary.materialized === 0` ; les sections `leadTime` et `slippage` ont `distribution: []` / `onTimePct: null` (UI les masque).

#### Algorithmes (résumé)

| Fonction | Algorithme |
|---|---|
| `computeSummary` | Group by `computeStatus(g, ctx)`, ratio cancelled/total. |
| `computeLeadTime` | Pour chaque ghost matérialisé : `(materializedAt.date - plannedAt.date)/86400000`. Sort + index pour percentiles. 4 buckets : `0-7d / 7-14d / 14-30d / 30d+`. |
| `computeSlippage` | `parseTargetDate(declared.plannedFor)` essaye ISO, `YYYY-QX` (→ dernier jour du trimestre), `YYYY-MM`, sinon `null`. Comparaison avec `materializedAt.date`, tolérance ±1 jour, 4 buckets {early, onTime, late, noTarget}. `onTimePct = onTime / (early + onTime + late)`. |
| `computePlanChurn` | Walk snapshots chronologiquement ; pour chaque ghost id, compte les transitions où `declared.description` OU `declared.expectedLinks` changent entre snapshots consécutifs. TopChurners = top 10 par count DESC. |
| `computeVelocity` | `currentCount` = matérialisations dans la fenêtre `[now-windowDays, now]`. `history` = group by ISO week, count materializations, limité aux 26 dernières semaines. |

#### Cache invalidation (mtime-based)

```js
async function isCacheValid(cachePath, repoPath) {
  const cs = await stat(cachePath).catch(() => null);
  if (!cs) return false;
  const latest = await stat(join(repoPath, '.gitnexus/ghosts.json')).catch(() => null);
  if (latest && latest.mtime > cs.mtime) return false;
  for await (const entry of glob('.gitnexus/snapshots/*/ghosts.json', { cwd: repoPath })) {
    const s = await stat(join(repoPath, entry));
    if (s.mtime > cs.mtime) return false;
  }
  return true;
}
```

Sur `POST /ghosts/sync` ou `POST /snapshot[/bulk]`, les sidecars sont touchés → leur mtime > cache.mtime → invalidation automatique sans hook explicite.

#### Frontend (`AuditPanel.tsx`)

Décomposition en 7 fichiers :
- `AuditPanel.tsx` — container, gère 2 fetches (`/ghost-audit` + `/ghosts`), states loading/error/success.
- `audit/AuditSummary.tsx` — 5 cards de chiffres.
- `audit/LeadTimeHistogram.tsx` — SVG natif 4 buckets, pattern `GrowthChart.tsx`.
- `audit/SlippageBar.tsx` — barre empilée 4 segments (early/onTime/late/noTarget).
- `audit/VelocitySparkline.tsx` — SVG ligne 26 semaines + chiffre courant.
- `audit/PlanChurnList.tsx` — top 10 churners, click → highlight dans `GhostTable`.
- `audit/GhostTable.tsx` — table triable des ghosts (latest), filtres tier/status, click → propagate vers le graph Sigma pour highlight des `links[]`.

Interactions clés :
- Click top-churner → highlight row dans GhostTable (state local).
- Click row → `onFileSelect` (pattern existant) → graph highlight via reducer.
- Header download CSV → `?format=csv` sur `/ghosts` (réutilise pattern existant).
- 404 → banner "Run sync" + bouton qui POST /ghosts/sync.

#### MCP tool `ghost_audit`

Dans `gitnexus-claude-plugin/src/tools/ghost_audit.ts`. Schema Zod `{ repo: string }`. Le handler fait `fetch http://localhost:${GITNEXUS_PORT}/ghost-audit?repo=${repo}` et renvoie 2 blocs `content` : un résumé texte lisible (cités par Claude), un dump JSON brut (pour drill-down). Aligné avec le pattern des 12 tools existants livrés en Tier 2bis.1.

Cas d'usage Claude :
- *"Qu'est-ce qui prend le plus de temps à livrer ?"* → `ghost_audit` → top churners + lead time distribution.
- *"On respecte nos délais ?"* → `slippage.onTimePct`.
- *"Notre velocity baisse ?"* → comparer `velocity.history[-4:]` vs `[-8:-4]`.

#### Tests (intégration au test pyramid Phase 1b)

**Pure fns** (Tier D) : 6 fichiers — summary, lead-time, slippage, churn, velocity, cache validation.
**Components** (Tier E) : 7 fichiers — AuditPanel + 6 sous-composants.
**Endpoints** (Tier G) : 3 fichiers — basic GET, cache invalidation, MCP tool.
**E2E** (Tier H) : 1 fichier — open panel, click churner, observe table highlight.

Fixture extension : ajouter un **12ème commit** à `make-fixture.mjs` qui marque un ghost ✅ dans le ROADMAP.md (sinon planChurn/slippage n'ont rien à mâcher).

## 4. Scope boundaries

**In-scope** : endpoint `/ghost-audit` + cache + 5 pure fns + AuditPanel + 6 sous-composants + MCP tool + tests + fixture extension + ROADMAP/INVENTORY/CLAUDE/spec updates.

**Out-of-scope explicite** :
- Audit cross-repo (`/ghost-audit?repos=A,B,C`) — sous-spec future si besoin.
- Audit "what changed since last audit" (alertes sur changement de churn) — pas demandé.
- Export PDF / report mailing — out.
- Audit projecté (extrapoler future velocity) — out, c'est de la prédiction pas de l'audit (regard arrière).
- Annotations user sur les ghosts ("on l'a annulé parce que…") — out, le ROADMAP.md sert pour ça.
- Audit cross-repo aggregation (multi-repo dashboard) — out.

## 5. Open questions

1. **Tolérance slippage** : actuellement ±1 jour. Trop strict pour `plannedFor: "2026-Q3"` (trimestre = 90 jours). **Décision design** : pour les targets de granularité supérieure au jour (QX, MM, YYYY), la tolérance est la durée du bucket — un ghost matérialisé n'importe quand DANS le bucket est `onTime`. Le parser de `parseTargetDate` retourne le **dernier jour** du bucket et la fonction `computeSlippage` voit `early` si avant le 1er jour, `onTime` si dans le bucket, `late` si après. **Marqué résolu pour le plan.**
2. **Velocity window configurable** : actuellement 28 jours par défaut. `GET /ghost-audit?windowDays=14` pour override. **Marqué résolu pour le plan.**
3. **Plan churn : compter les ajouts d'`expectedLinks` (extension d'un ghost) ?** Aujourd'hui : OUI si la liste change (longueur ou contenu). Une extension de plan = churn. **Marqué résolu.**
4. **Cache TTL en plus du mtime ?** Non — mtime suffit. Si plus tard on observe que des changements de cache hors-snapshot (e.g. édition manuelle de roadmap.yml) ne sont pas détectés, on ajoutera un TTL court (30s) en plus. Hors-scope MVP.
5. **`ghost_audit` MCP tool acceptera-t-il un repo cross-tenant ?** Aujourd'hui chaque tool MCP accepte `{ repo: string }` et frappe le serveur local. Pas de cross-tenant en v1.

## 6. Effort estimé

**5.5 jours** au total. Suppose que le CORE est déjà livré.

| Composant | Effort |
|---|---|
| 5 pure fns + cache helper + tests unit | 1 j |
| Endpoint HTTP + caching + I/O | 0.5 j |
| MCP tool ghost_audit | 0.5 j |
| AuditPanel + 6 sous-composants + tests components | 1.5 j |
| Tests integration + e2e + fixture extension | 1.5 j |
| Wiring CI + docs (ROADMAP, INVENTORY, CLAUDE smoke loop) + spec Update | 0.5 j |

## 7. Suite

Le plan d'implémentation suit (via `superpowers:writing-plans`) une fois ce spec validé.

Sous-specs encore à brainstormer dans cette session : **Augmented graph**, **Brainstorm-hook**, **Gantt opérationnel**.

---

## Update 2026-05-26 — 6ème métrique `expired` (review externe)

Suite à la [review externe Gemini](2026-05-26-ghost-nodes-external-review.md) et à l'introduction d'`expectedBy` mandatory + status dérivé `expired` dans le CORE (Update sur le CORE spec), l'Audit view gagne une **6ème métrique**.

### Métrique `expired`

```json
"expired": {
  "total": 3,
  "critical": 1,           // dépassé de > 50% (1.5× expectedBy)
  "expiredButRecent": 2,   // dépassé mais < 50%
  "list": [
    { "id": "tier-3-2-mutation-tracking", "expectedBy": "2026-04-30", "daysPastExpiry": 26, "alertLevel": "critical" }
  ]
}
```

### Distinction late vs expired

- **`slippage.late`** (déjà spec'é) = ghost matérialisé après son `expectedBy`. Audit historique.
- **`expired`** (nouveau) = ghost `planned` qui a dépassé `expectedBy` sans être matérialisé. Action requise.

Les deux sont complémentaires.

### UI mise à jour

Dans `AuditSummary` (5 cards initialement), ajout d'une **6ème card** "Expired" avec badge rouge si `total > 0` et compteur. Click sur la card ouvre `CleanupModal` (de la sous-spec [cleanup-and-connectors](2026-05-26-roadmap-predictive-cleanup-and-connectors-design.md)).

### Test additionnel

`tests/unit/ghost-audit-expired.test.mjs` — couvre le calcul `expired` selon `expectedBy + grace_period`, edge cases (pas d'`expectedBy`, ghost déjà materialized).

### Effort additionnel

**~0.3 jour** : pure fn `computeExpired` + endpoint enrichi + card UI + test.

---

## Update 2026-05-26 — 7ème métrique `placementAccuracy` (lecture conv Gemini brute)

Après lecture de la conversation Gemini brute (au-delà du résumé via la [review externe](2026-05-26-ghost-nodes-external-review.md)), le concept de "Delta Engine" — distance entre ghost prévu et matérialisation réelle dans le graph — gagne en clarté.

Reformulé concrètement, ce n'est pas un nouveau "engine" mais **Dissonance appliqué aux ghosts** : quand un ghost se matérialise, le node réel atterrit-il dans la même communauté Leiden que ses expectedLinks ? Si oui, la prédiction architecturale a tenu. Si non, il y a eu une **dérive de placement** entre design et impl.

### Métrique `placementAccuracy`

```json
"placementAccuracy": {
  "globalScore": 0.78,                    // % de ghosts bien placés
  "wellPlaced": 18,                       // matérialization dans la community attendue
  "drifted": 5,                           // matérialization dans une community différente
  "noReference": 1,                       // ghost sans expectedLinks matchant un node existant pré-matérialization
  "topDrifters": [                        // jusqu'à 5
    {
      "id": "tier-2-3-what-if-simulator",
      "expectedCommunity": "components/auth",
      "actualCommunity": "components/utils",
      "title": "What-if simulator"
    }
  ]
}
```

### Algorithme

Pour chaque ghost en status `materialized` :
1. Récupérer la community Leiden majoritaire des nodes pointés par les `expectedLinks` matchés **avant la matérialization** (utilise un snapshot juste avant `materializedAt.commit`)
2. Récupérer la community Leiden du node réel qui matche `links[].file` **après la matérialization**
3. Comparer : si même community → `wellPlaced` ; si différente → `drifted` (record drift)
4. Si pas de référence (pas d'expectedLinks matchés à l'époque) → `noReference`

### Pourquoi c'est utile

Signale les **divergences silencieuses** entre design et impl. Un ghost qui a `materialized: true` peut quand même indiquer un échec si le code a fini ailleurs. Complémentaire à `slippage` (temporel) et `planChurn` (instabilité de définition).

### Dépendance

Nécessite une **snapshot juste avant `materializedAt.commit`** pour avoir l'état pré-matérialization. Si pas dispo (e.g. ghost matérialisé dans le 1er commit), retourne `noReference`. Pas de drift hallucinée.

### Test additionnel

`tests/unit/ghost-audit-placement.test.mjs` — couvre 3 cas : well-placed, drifted, no-reference.

### Effort additionnel

**~0.4 jour** : pure fn `computePlacementAccuracy` + intégration endpoint + UI card additionnelle.

### Cohérence avec Dissonance

C'est essentiellement le même calcul que Tier 2.2 Dissonance (community détectée vs domaine déclaré), mais appliqué à la dimension **temps** plutôt que **domaine** :
- **Dissonance** : "le code est-il dans le bon cluster vs où il devrait être thématiquement ?"
- **placementAccuracy** : "le code matérialisé est-il dans le cluster où il devait atterrir vs où il a été planifié ?"

Réutilisation possible du `clusterPurity` core fn de la Dissonance feature.

## Update 2026-05-27 — Shipped

Section F of the execution plan landed. The Audit view is live in
production. Concrete deltas vs the original design:

### Shipped

- **6 metrics** : `computeSummary`, `computeLeadTime` (p25/médian/p75/max
  + buckets), `computeSlippage` (early/onTime/late/noTarget vs
  `expectedBy`), `computePlanChurn` (cross-snapshot deltas + top
  churners), `computeVelocity` (rolling 28j) + **Update 1** `computeExpired`
  (alertLevel green/yellow/red).
- **Endpoint** : `GET /ghost-audit?repo=<base>` — 404 when no
  `/ghosts/sync` has run yet, otherwise returns the 6-metric JSON
  payload with `cached: bool` + `computedAt`. **mtime cache** on
  `<repo>/.gitnexus/ghosts.json` — recompute only when the sidecar
  file has been touched since the last `computedAt`.
- **MCP tool** : `gitnexus_ghost_audit` registered in
  `mcp-server/server.mjs` (19th tool). Smoke covered in
  `mcp-server/smoke.mjs`.
- **7 React components** : `AuditPanel.tsx` container + 6 sub-components
  (`AuditSummary`, `LeadTimeHistogram`, `SlippageBar`,
  `VelocitySparkline`, `PlanChurnList`, `GhostTable`) under
  `gitnexus-web/src/components/audit/`. PlanChurnList ↔ GhostTable
  synchronized via `highlightedId` state lifted in the container.
- **Host wiring** : `App.tsx` imports `AuditPanel`, local
  `auditPanelOpen` state, floating bottom-right toggle button
  (`data-testid="audit-panel-toggle"`) + top-right overlay rendering
  `<AuditPanel repo={projectName} />` when open. Kept out of
  `useAppState` to minimize patch surface against upstream.
- **Fixture** : commit 12 added to `tests/fixtures/make-fixture.mjs`
  (Alice, 2025-02-12). Flips `### 1.2 — Helpers utility` to ⏳ with
  `**Expected by** : 2026-Q2`, and adds `### 2.2 — Cancelled feature 🗑️`.
  This gives the audit metrics a planned ghost with `expectedBy` (for
  slippage / expired), a materialized ghost (1.1), and two cancelled
  ghosts (cancellation-rate ≠ 0).
- **Smoke loop** : `/ghost-audit` added to the `for ep in …` loop in
  `CLAUDE.md` + a dedicated curl note clarifying it requires a prior
  `/ghosts/sync`.

### Deferred — `Update 2` (placementAccuracy)

The original spec mentioned a future Update 2 metric measuring "ghosts
placed in the right community vs the planned location". That metric
requires backend access to **Leiden communities** at snapshot time —
which doesn't exist in our docker-server today (Dissonance recomputes
its own clustering per request, but it's not exposed as a separate
endpoint we can read from the audit core fn). Deferred until that
backend exists. Tracked in this spec's history rather than in ROADMAP
because it's an internal extension, not a new tier.

### Known limitations

- **`parseTargetDate` duplicated** : the audit-core module
  (`docker-server-ghost-audit-core.mjs`) duplicates `parseTargetDate`
  from `docker-server-ghosts-core.mjs` rather than re-importing it.
  Choice : keep the audit module **self-contained** so it can be
  pruned / split into a separate Tier sub-product later without taking
  the CORE module as a hard dep. The duplication is small (one pure
  fn, < 20 lines) and both copies have the same test golden.
- **placementAccuracy deferred** — see above.

### Build / CI status

- **Local : Node 21** blocks vitest in this workspace (Phase 1b waiting
  on the Node 22 upgrade, see
  `docs/superpowers/decisions/2026-05-26-defer-node22-upgrade.md`).
- **CI : Node 22** runs the full unit + integration + e2e suite,
  including the 13 new audit test files inventoried in
  `tests/README.md`.
- Manual smoke : `docker compose build gitnexus-web` green + the
  `/ghost-audit` curl in the after-restart smoke loop returns 200.
