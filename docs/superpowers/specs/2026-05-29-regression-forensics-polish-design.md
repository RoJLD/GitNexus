# Regression Forensics Polish (coupling watch + UI highlight) — Design

**Date** : 2026-05-29
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Origine** : Deux follow-ons optionnels notés à la livraison de "Auto regression forensics" (Tier 59). Étend la ligne regression forensics (Tiers 57-59).
**Depends on** : `/regression` (Tiers 57-58), moteur watches + auto-forensics (Tiers 2bis.3 / 59), `/coupling?...&pairsAboveThreshold` (Tier 58), `EntropyCommitTimeline.tsx` (Tier 2bis.2).

---

## 1. Context / problem

Deux trous laissés ouverts par la ligne regression forensics :

1. **Coupling ne peut pas s'auto-forensiquer.** Le moteur watches a 5 évaluateurs (entropy.{density,modularity}, ownership.{busFactor,topAuthorShare}, dissonance.purity) ; il n'y a **pas** d'évaluateur `coupling`, et `mapWatchToRegressionMetric` exclut explicitement `coupling` (→ null). Donc on ne peut ni *watcher* le coupling, ni déclencher l'auto-forensics dessus — alors que `/regression?metric=coupling` existe (Tier 58) et que `/coupling` expose déjà un scalaire `pairsAboveThreshold`.

2. **Le verdict regression n'est pas visible dans l'UI.** `/regression` est purement endpoint + MCP. `EntropyCommitTimeline.tsx` affiche déjà une barre par commit (delta entropy density/modularity attribué) avec drill-down + "Show on graph" + "Rebuild @ commit" — l'endroit naturel pour *montrer* le commit coupable, mais rien ne le fait.

## 2. Goal

(A) Ajouter un évaluateur watch `coupling` + l'inclure dans le mapping auto-forensics ⇒ coupling devient watchable ET auto-forensiquable (6 métriques). (B) Ajouter un highlight regression dans `EntropyCommitTimeline` : un bouton "Locate regression" qui appelle `/regression` pour la métrique entropy active, affiche une bannière coupable, et entoure la barre du commit coupable (clic → drill-down existant). Scope serré, pas d'inflation.

Succès = (A) un watch `{ metric: 'coupling', op: '>', threshold: 5 }` fire + son webhook porte le coupable ; (B) dans le composant, cliquer "Locate regression" surligne la barre du commit fautif + affiche "Regression: <sha> by <author> (N files)".

## 3. Décisions cadres (validées en brainstorm 2026-05-29)

| Décision | Choix | Raison |
|---|---|---|
| Scalaire watch coupling | **`pairsAboveThreshold`** (déjà exposé par `/coupling`, Tier 58) | Pas besoin d'un nouveau calcul ; cohérent avec le scalaire regression coupling. |
| worseDirection coupling (watch op) | L'utilisateur déclare l'op (`>`) dans son watch ; l'évaluateur retourne juste la valeur | Le moteur watches est op-driven (pas de worseDirection) — l'évaluateur fournit juste le nombre. |
| Mapping coupling | `coupling → coupling` dans `mapWatchToRegressionMetric` | Débloque l'auto-forensics coupling ; `/regression?metric=coupling` existe. |
| UI scope | **Bouton + bannière + ring de barre**, entropy-only (density/modularity), réutilise le drill-down | YAGNI ; les autres métriques n'ont pas de barre par-commit ici. |
| État UI | **State local au composant** (`regressionVerdict`/loading/error) | Le composant garde déjà du state local (`metric`, `selected`) ; surface de patch minimale, pas de useAppState. |
| Un seul spec | A (backend) + B (frontend) ensemble | Petits + thématiquement unifiés. |

### Alternatives écartées

| Alternative | Pourquoi écartée |
|---|---|
| Nouveau scalaire coupling pour le watch (autre que pairsAboveThreshold) | `pairsAboveThreshold` existe déjà + est le scalaire regression coupling. DRY. |
| Highlight auto (sans bouton) appelant /regression à chaque load | Appel /regression (N appels snapshot) à chaque chargement ; moins discoverable. Le bouton est explicite + on-demand. |
| Panneau regression complet (6 métriques) | Surface séparée + métriques sans barre par-commit ici ; inflation de panels (risque ROADMAP). |
| Mettre le verdict dans useAppState | Inutile — le verdict est local au composant (comme `selected`). |

## 4. Design

### 4.1 Fichiers

```
upstream/docker-server-watches.mjs   MOD  + évaluateur `coupling` dans METRIC_EVALUATORS ; + `coupling: 'coupling'` dans mapWatchToRegressionMetric
upstream/gitnexus-web/src/components/EntropyCommitTimeline.tsx   MOD  bouton "Locate regression" + bannière + ring de barre + state local
tests/unit/auto-regression-forensics.test.mjs   MOD  coupling map null → 'coupling'
tests/e2e/specs/regression-highlight.spec.ts     NEW  ouvrir entropy-commits + Locate regression → bannière + requête /regression

ROADMAP.md / INVENTORY.md / tests/README.md / CLAUDE.md   MOD
patches/upstream-all.diff                                 REGEN
```

### 4.2 Part A — Coupling watch evaluator (`docker-server-watches.mjs`)

Add to `METRIC_EVALUATORS` (mirroring the 5 existing evaluators, signature `(repo, webBase) → { ok, value } | { ok:false, error }`):

```javascript
  coupling: async (repo, webBase) => {
    const r = await fetchJson(`${webBase}/coupling?repo=${encodeURIComponent(repo)}`);
    if (!r.ok) return r;
    if (typeof r.body?.pairsAboveThreshold !== 'number') return { ok: false, error: 'no pairsAboveThreshold' };
    return { ok: true, value: r.body.pairsAboveThreshold };
  },
```

In `mapWatchToRegressionMetric`, add `coupling: 'coupling'` to the MAP. (Now only genuinely-unknown metrics return null.)

No other change: the cron loop, `fireWebhook`, the auto-forensics enrichment (Tier 59) all already key off `METRIC_EVALUATORS` + the mapping, so coupling auto-fires + auto-forensics for free. `supportedMetrics` in `GET /watches` = `Object.keys(METRIC_EVALUATORS)` → auto-lists `coupling`.

### 4.3 Part B — UI highlight (`EntropyCommitTimeline.tsx`)

State (local, added to the existing `useState` block):

```ts
const [regressionVerdict, setRegressionVerdict] = useState<RegressionVerdict | null>(null);
const [regressionLoading, setRegressionLoading] = useState(false);
const [regressionError, setRegressionError] = useState<string | null>(null);
```

`RegressionVerdict` = the subset we read: `{ regressed: boolean; attribution: string; netDelta: number; worstCommit: { sha; shortSha; author; filesTouched?; files?: unknown[] } | null }`.

- **Button** "Locate regression" in the header (next to the metric toggle). `onClick` → `setRegressionLoading(true)`, `GET /regression?repo=<baseRepo>&metric=<metric>` (metric = the active `density|modularity`), store verdict, clear on error.
- **Re-fetch on metric toggle**: when `metric` changes and a verdict is showing, clear it (or re-fetch) — simplest: clear the verdict on metric change so the highlight never mismatches the displayed metric.
- **Banner** (below the header, above the bars): if `regressionLoading` → spinner "Locating…"; if `regressionError` → error line; if verdict && `worstCommit` → `Regression located: <shortSha> by <author> (<N> files) · net <±netDelta> [<attribution>]` + close `[×]` (clears verdict); if verdict && `!worstCommit` (regressed:false or stragglers) → `No clear regression on <metric>.`
- **Bar ring**: in the bar render loop, if `regressionVerdict?.worstCommit?.sha === commit.sha`, add a ring/glow class (e.g. `ring-2 ring-amber-400`) to that bar.
- **Click-through**: clicking the banner (when `worstCommit` resolves to a rendered commit) calls `setSelected(thatCommit)` → opens the existing drill-down (sha/author/files + Show on graph + Rebuild @ commit). If the culprit sha isn't among the rendered commits (outside the window), the banner shows but isn't clickable.

`N files` = `worstCommit.filesTouched ?? worstCommit.files?.length ?? 0`. `attribution` is `attributed` (entropy) here.

## 5. Edge cases

| Cas | Comportement |
|---|---|
| `/regression` échoue | `regressionError` ligne ; bouton ré-activé |
| `regressed:false` ou pas de worstCommit | bannière "No clear regression on <metric>." ; pas de ring |
| Culprit sha hors fenêtre affichée | bannière visible, pas de ring, pas de clic drill-down |
| Toggle métrique pendant qu'un verdict est affiché | verdict cleared (évite un mismatch métrique/highlight) |
| Pas de données entropy-commits | bouton caché (auto-hide du composant déjà en place) |
| Watch `coupling` mais `/coupling` sans pairsAboveThreshold (vieux build) | évaluateur retourne `{ok:false}` → watch error, pas de fire (cohérent moteur watches) |

## 6. Testing strategy

- **Unit** (`tests/unit/auto-regression-forensics.test.mjs`, MOD) : `mapWatchToRegressionMetric('coupling')` → `'coupling'` (était null) ; un metric vraiment inconnu reste null. (L'évaluateur coupling est de l'I/O — couvert par le smoke `supportedMetrics`.)
- **E2E** (`tests/e2e/specs/regression-highlight.spec.ts`, NEW) : activer le mode entropy-commits (toggle dans la Timeline), cliquer "Locate regression", intercepter la requête `/regression?...&metric=density`, asserter qu'elle part + que la bannière (`[data-testid="regression-banner"]`) devient visible. (Pas de test composant jsdom — le projet n'en a pas pour ce composant ; le fetch + drill-down sont du comportement navigateur.)
- **Smoke** (CLAUDE.md) : `GET /watches` → `supportedMetrics` inclut `coupling` (grep dans la réponse). `/regression?metric=coupling` déjà smoke-é (Tier 58).
- **Build** : `docker compose build gitnexus-web` (valide le composant compile + le watches module).

## 7. Out of scope (futurs)

- Highlight pour les métriques non-entropy (ownership/dissonance/coupling) — pas de barre par-commit dans ce composant ; demanderait une autre viz.
- Panneau regression dédié multi-métriques.
- Bouton "Rebuild @ commit" auto sur le coupable (le drill-down l'offre déjà manuellement).

## 8. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| `EntropyCommitTimeline.tsx` est gros + chaud (parallel session le touche) | Moyen | Patch minimal (state local + 1 bouton + 1 bannière + 1 classe conditionnelle) ; edits grep-anchored ; build valide. |
| Test unit existant `coupling→null` casse | Faible | Mis à jour dans le même commit (Part A). |
| `/regression?metric=coupling` lent (N appels snapshot) au clic | Faible | On-demand (clic), pas auto ; l'UI montre un spinner. Mais le bouton n'appelle que density|modularity (entropy, rapide) — coupling regression n'est pas déclenché par CE bouton (entropy-only). |
| coupling watch fire trop souvent | Faible | C'est l'utilisateur qui déclare le seuil + l'op ; debounce 1h du moteur watches s'applique. |

## 9. Effort estimate

| Tâche | Effort |
|---|---|
| Part A : évaluateur coupling + mapping + test update | ~½j |
| Part B : bouton + fetch + state local | ~½j |
| Part B : bannière + bar ring + click-through drill-down | ~1j |
| E2E + docs + build + smoke | ~½j |
| **Total** | **~2-3 jours (~5-6 tasks)** |

## 10. Document updates checklist (à la livraison)

- `ROADMAP.md` : nouvelle ligne "Déjà livré" (polish) + note que coupling rejoint l'auto-forensics (6 métriques watchables) + UI highlight livré. Bump date header.
- `INVENTORY.md` : `/watches` supporte 6 métriques (coupling ajouté) ; `EntropyCommitTimeline` gagne le highlight regression.
- `CLAUDE.md` : note coupling watchable ; smoke `supportedMetrics`.
- `tests/README.md` : e2e `regression-highlight` ; note la maj du test auto-regression-forensics.
- `patches/upstream-all.diff` : regen.
