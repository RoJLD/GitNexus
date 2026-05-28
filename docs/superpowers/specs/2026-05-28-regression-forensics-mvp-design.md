# Regression Forensics MVP (Phase 1) — Design

**Date** : 2026-05-28
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Origine** : Item "Auto regression forensics" (upcoming) de l'évaluation de l'offre enterprise upstream (ROADMAP § "Enterprise / commercial offering", verdict 🔴 absent — primitives adjacentes livrées).
**Depends on** : `/entropy` (timeline density/modularity par snapshot, Tier 1.4), `/entropy/commits` (attribution par commit, Tier 2bis.2), `/commit/footprint` (fichiers touchés par commit, Tier 2bis.2 follow-up), le pattern docker-server + MCP sidecar.
**Phase** : 1 sur 2. Phase 1 = skeleton générique + entropy (density/modularity). Phase 2 (spec future) = ownership / dissonance / coupling branchés sur le même skeleton.

---

## 1. Context / problem

L'offre enterprise upstream annonce un "Auto regression forensics" (à venir). On ne l'a pas, mais on ship les briques : `/entropy/commits` attribue à chaque commit sa part du delta entropy (density + modularity) entre snapshots bracketants ; `/entropy` donne la série temporelle de la métrique par snapshot ; `/commit/footprint` donne les fichiers touchés par un commit ; `/graph/at-commit` reconstruit le graphe.

Ce qui manque : la **synthèse**. `/entropy/commits` dump *tous* les commits avec leur delta, sans identifier LA régression, sans classer le commit coupable, sans joindre les fichiers impliqués. Un utilisateur qui voit "la santé structurelle s'est dégradée la semaine dernière" doit aujourd'hui trier à la main. La forensics répond directement : *"density a régressé de X entre tel et tel point ; le commit ABC (par Marie, touchant foo.py/bar.py) en porte 60% ; voici le runner-up."*

## 2. Goal

Un endpoint on-demand `GET /regression?repo=&metric=&from=&to=` (+ MCP tool) qui, pour une métrique structurelle sur une fenêtre, **localise** la régression (chute la plus raide + delta net), **classe** le(s) commit(s) coupable(s) par attribution adverse, et **joint** les fichiers impliqués du pire commit — en réutilisant les 3 endpoints existants. Skeleton générique pour que Phase 2 branche d'autres métriques sans retoucher la logique. Pas de ML.

Succès = je demande `/regression?repo=hmm_studio&metric=density&from=oldest&to=live` et j'obtiens un verdict : régression oui/non, fenêtre + before/after/netDelta, pire commit (sha/author/date/message/attributedDelta/files), runners-up.

## 3. Décisions cadres (validées en brainstorm 2026-05-28)

| Décision | Choix retenu | Raison |
|---|---|---|
| Couverture métriques | **TOUT, mais phasé** : Phase 1 = entropy (density + modularity) ; Phase 2 = ownership / dissonance / coupling | Seul entropy a le pipeline complet (série + attribution). Les autres n'ont PAS de série scalaire par snapshot (coupling n'a même pas de scalaire repo-level). Skeleton générique → extension sans rework. |
| Skeleton | **Registry de métriques + `locateRegression` + `rankCulprits` (purs)** | Réutilisable ; Phase 2 = ajouter une ligne au registry + un series-provider. |
| Localisation | **Chute adverse la plus raide (snapshot-pair) + delta net de fenêtre** | "Qu'est-ce qui a soudain empiré" + le contexte global. |
| Attribution | **Réutilise `/entropy/commits`** (attribution filesTouched-proportional déjà livrée) | Zéro nouvelle analyse ; haute fidélité pour entropy. |
| Surface | **Endpoint + MCP tool seulement** (pas d'UI) | Cohérent avec toutes nos analytics ; évite l'inflation de panels (risque ROADMAP). |
| Déclenchement | **On-demand** | MVP = "demande quand tu veux". Auto-on-watch-fire = futur. |
| Direction "pire" | **Per-métrique dans le registry** (`worseDirection`) | density up = pire ; modularity down = pire. À aligner sur la convention rouge/vert existante (`EntropyCommitTimeline`) — vérifié au plan. |

### Alternatives écartées

| Alternative | Pourquoi écartée |
|---|---|
| Étendre `/entropy/commits` au lieu d'un nouvel endpoint | `/entropy/commits` est "tous les commits + deltas" ; la forensics est "localiser + classer + impliquer" — responsabilité distincte, mérite son endpoint + son skeleton réutilisable. |
| Reconstruire le graphe à chaque commit (`/graph/at-commit`) pour mesurer la métrique exacte par commit | Coûteux (~50s/commit sans diffs pré-construits). L'attribution interpolée de `/entropy/commits` suffit pour un MVP de localisation. |
| Framework générique "any metric" pluggable dès maintenant | Sur-ingénierie : on construit pour les métriques connues (registry concret), pas pour des hypothétiques. |
| Toutes les métriques dans un seul spec | Plus gros/risqué ; les séries + attribution non-entropy sont net-new. Phasé = chaque incrément shippable. |

## 4. Design

### 4.1 Fichiers

```
upstream/
├── docker-server-regression-core.mjs   NEW  pur : METRIC_REGISTRY + locateRegression + rankCulprits
├── docker-server-regression.mjs         NEW  I/O : handleRegressionRoute (fetch /entropy + /entropy/commits + /commit/footprint, assemble)
└── docker-server.mjs                    MOD  monte handleRegressionRoute (avant le static fallthrough)
Dockerfile.web                           MOD  COPY des 2 modules
mcp-server/server.mjs                    MOD  + tool gitnexus_regression
mcp-server/smoke.mjs                     MOD  + smoke du nouveau tool

tests/
├── unit/regression-core.test.mjs                    NEW  locateRegression + rankCulprits + registry
└── integration/endpoints/regression.test.mjs        NEW  GET /regression (density + modularity)

ROADMAP.md / INVENTORY.md / tests/README.md / CLAUDE.md (smoke loop)   MOD
patches/upstream-all.diff                                              REGEN
```

Aucun changement serveur API upstream. Aucune nouvelle dépendance.

### 4.2 Core pur — `docker-server-regression-core.mjs`

```js
// Per-metric config. Phase 2 adds rows; the logic below never changes.
export const METRIC_REGISTRY = {
  density:    { worseDirection: 'up',   seriesField: 'density',    attrField: 'attributedDensityDelta' },
  modularity: { worseDirection: 'down', seriesField: 'modularity', attrField: 'attributedModularityDelta' },
};

// series : [{ name, sha, date, <seriesField>: number }, ...] oldest→newest (from /entropy timeline)
// Returns the steepest adverse snapshot-pair drop + the net window delta.
export function locateRegression(series, worseDirection, eps = 1e-9) {
  // adverse delta = (worseDirection==='up') ? (next - prev) : (prev - next)
  // worstPair = pair maximizing adverse delta (>0 = got worse); netDelta over [first,last];
  // regressed = netAdverse > eps.
  // Returns { worstPair: [a,b]|null, stepDelta, netDelta, regressed, first, last }.
}

// attributedCommits : the `commits` array from /entropy/commits
// Returns commits sorted worst-first by adverse attributed delta (adverse>0 only kept first).
export function rankCulprits(attributedCommits, attrField, worseDirection) {
  // adverse = (worseDirection==='up') ? delta : -delta ; sort desc by adverse.
  // Returns the full sorted array (caller takes [0] as worst, slice for runners-up).
}
```

`locateRegression` reads each `series[i][seriesField]`, skips entries where the value is null/NaN. Adverse delta normalizes direction so "bigger adverse = worse" regardless of metric. `rankCulprits` does the same normalization on the attributed deltas.

### 4.3 I/O — `docker-server-regression.mjs`

`handleRegressionRoute(req, url, res, opts)` → `Promise<boolean>` :
- Owns `GET /regression`. Params : `repo` (required), `metric` (`density`|`modularity`, default `density`), `from`, `to` (sha|iso|`oldest`|`live`, passed through to `/entropy/commits`).
- `metricCfg = METRIC_REGISTRY[metric]` ; 400 if unknown metric ; 400 if no repo.
- `api = opts.api` (`http://gitnexus:4747`)? **No** — these are OUR endpoints on the web server. Call them on the web base (`http://127.0.0.1:${PORT||4173}`) like the watches cron calls our endpoints, OR pass through `opts.api` if our endpoints are reachable there. **Decision:** call our own endpoints via `http://127.0.0.1:${process.env.PORT||4173}` (same-process HTTP, the pattern used by the watches cron's `webBase`).
- Steps :
  1. `GET /entropy?repo=<repo>` → `timeline` ; map to series of `{name, sha, date, value: entry[seriesField]}` ; `locateRegression(series, worseDirection)`.
  2. `GET /entropy/commits?repo=<repo>&from=&to=` → `commits` ; `rankCulprits(commits, attrField, worseDirection)`.
  3. If a worst culprit exists : `GET /commit/footprint?repo=<repo>&sha=<worst.sha>` → `filesTouched`.
  4. Respond :
     ```json
     {
       "repo": "...", "metric": "density",
       "regressed": true,
       "window": { "from": "...", "to": "..." },
       "before": 0.42, "after": 0.55, "netDelta": 0.13,
       "steepestDrop": { "between": ["snapA-date","snapB-date"], "delta": 0.09 },
       "worstCommit": { "sha", "shortSha", "author", "date", "message",
                        "attributedDelta": 0.07, "files": [{ "path", "status" }] },
       "runnersUp": [ { "sha", "shortSha", "author", "attributedDelta" }, ... up to 3 ]
     }
     ```
  - Edge: no snapshots / empty series → `{ regressed: false, worstCommit: null, runnersUp: [] }` with a `note`. Footprint fetch failure → `worstCommit.files: []` (don't fail the whole response). `/entropy/commits` straggler-only window → `worstCommit: null`.
- Returns `false` for other paths.

### 4.4 MCP tool

`gitnexus_regression(repo, metric?, from?, to?)` in `mcp-server/server.mjs` — wraps `GET /regression`, returns the JSON. Extend `mcp-server/smoke.mjs` to call it (assert it returns an object with `metric` + `regressed`).

## 5. Edge cases

| Cas | Comportement |
|---|---|
| Métrique inconnue | 400 `{ error: 'unknown metric' }` |
| Repo absent / <2 snapshots | `regressed:false`, `worstCommit:null`, `note` explicatif (série trop courte pour un delta) |
| Aucune régression (métrique s'est améliorée) | `regressed:false`, `worstCommit` = quand même le "moins bon" commit ou null si tous favorables ; `netDelta` signé |
| `/entropy/commits` ne retourne que des stragglers | `worstCommit:null` (rien d'attribuable) |
| `/commit/footprint` échoue | `worstCommit.files: []`, le reste de la réponse intact |
| Valeurs null/NaN dans la timeline | Skippées par `locateRegression` |
| Direction "pire" inversée par erreur | Mitigé : Task 1 du plan aligne `worseDirection` sur la convention rouge/vert de `EntropyCommitTimeline` |

## 6. Testing strategy

- **Unit** (`tests/unit/regression-core.test.mjs`) :
  - `locateRegression` : série en dégradation monotone (worstPair = plus gros saut, regressed true), série en amélioration (regressed false), série plate (regressed false), null/NaN skippés, worseDirection up vs down.
  - `rankCulprits` : tri worst-first pour up et down, deltas favorables après les adverses, tableau vide.
  - `METRIC_REGISTRY` : density up / modularity down présents avec les bons champs.
- **Integration** (`tests/integration/endpoints/regression.test.mjs`) : `GET /regression?repo=<fixture>&metric=density` → 200, shape `{ metric, regressed (bool), window, worstCommit (object|null), runnersUp (array) }` ; idem `metric=modularity` ; `metric=garbage` → 400. Mirror le harness de `lifespan-windowed.test.mjs`.
- **Smoke loop** (CLAUDE.md) : `curl /regression?repo=hmm_studio&metric=density` → 200.
- **MCP smoke** : `node mcp-server/smoke.mjs` exerce `gitnexus_regression`.

## 7. Out of scope (Phase 2 + futurs)

- **Phase 2** (spec dédié) : registry rows + series-providers pour `ownership.busFactor`, `ownership.topAuthorShare`, `dissonance.purity`, `coupling` (avec un scalaire dérivé — ex. moyenne Jaccard top-N — car pas de scalaire repo-level). Attribution non-entropy de plus faible fidélité (heuristique filesTouched, à étiqueter).
- **Auto regression forensics** : quand un watch franchit son seuil (moteur watches existant), calculer + attacher le commit coupable au payload webhook.
- **UI** : highlight de la régression + du commit coupable dans `EntropyCommitTimeline`.
- **Vrai per-commit metric** (vs interpolé) via `/graph/at-commit` reconstruit — coûteux, reporté.

## 8. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| `worseDirection` inversé (density/modularity) | **Moyen** | Task 1 : aligner sur la convention rouge/vert de `EntropyCommitTimeline` (déjà encode dégradation/amélioration). |
| Attribution interpolée imprécise (pas le vrai delta per-commit) | Faible/Moyen | Documenté ; c'est le compromis MVP (même base que `/entropy/commits`, déjà accepté). |
| Appels HTTP internes (web→web) latence | Faible | 3 fetch séquentiels sur des endpoints rapides (/entropy lit meta.json ; /entropy/commits + /commit/footprint = git). OK on-demand. |
| Confusion avec `/entropy/commits` | Faible | Framing honnête (synthèse vs dump) + doc INVENTORY/ROADMAP. |
| Skeleton sur/sous-abstrait pour Phase 2 | Faible | Registry + 2 pures fns = juste assez ; Phase 2 valide le seam (ajout d'1 ligne + 1 provider). |

## 9. Effort estimate

| Tâche | Effort |
|---|---|
| Core pur (registry + locateRegression + rankCulprits) + unit | ~1j |
| `docker-server-regression.mjs` (assemble 3 endpoints) | ~1j |
| Mount + Dockerfile.web COPY | ~¼j |
| MCP tool + smoke | ~½j |
| Integration test | ~½j |
| Docs (ROADMAP/INVENTORY/CLAUDE/tests) + build + smoke | ~½j |
| **Total** | **~3-4 jours** |

## 10. Document updates checklist (à la livraison)

- `ROADMAP.md` : nouvelle ligne "Déjà livré" (Phase 1) + dans la table enterprise, passer "Auto regression forensics" de 🔴 à 🟡 (MVP Phase 1 livré, Phase 2 + auto restants) + bump date header.
- `INVENTORY.md` : endpoint `GET /regression` + les 2 modules + le MCP tool (compteur de tools +1).
- `CLAUDE.md` : ajouter `/regression` au smoke loop + 1 ligne MCP tool.
- `tests/README.md` : unit `regression-core` + integration `regression`.
- `patches/upstream-all.diff` : regen.
