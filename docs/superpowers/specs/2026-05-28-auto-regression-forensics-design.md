# "Auto" Regression Forensics (watch → culprit) — Design

**Date** : 2026-05-28
**Status** : current
**Auteur** : Robin DENIS (brainstorm Claude Opus 4.7)
**Origine** : Complète l'item enterprise "Auto regression forensics". Phase 1 (Tier 57) + Phase 2 (Tier 58) ont livré le `/regression` **on-demand** ; ce design ajoute le **"auto"** : enrichir les webhooks du moteur watches avec le commit coupable.
**Depends on** : moteur watches (Tier 2bis.3, `docker-server-watches.mjs` — `METRIC_EVALUATORS`, `fireWebhook`, `evaluateRepoWatches`), `/regression` (Tiers 57-58, 6 scalaires).

---

## 1. Context / problem

Le moteur watches (`docker-server-watches.mjs`) évalue 5 métriques (`entropy.density`, `entropy.modularity`, `ownership.busFactor`, `ownership.topAuthorShare`, `dissonance.purity`) toutes les `WATCH_INTERVAL_MS` et, quand une métrique franchit son seuil (op + debounce `WATCH_DEBOUNCE_MS` 1h), POST un webhook Slack-compatible via `fireWebhook`. Le payload dit *"density = 0.6 > 0.5 (threshold)"* — mais **pas pourquoi** : aucun commit coupable, aucun fichier impliqué. L'utilisateur reçoit l'alerte puis doit lancer `/regression` à la main.

`/regression` répond déjà exactement à "quel commit a causé cette régression de <métrique> + quels fichiers". Le gap = les connecter : quand un watch fire, appeler `/regression` et joindre le verdict au webhook. C'est le "auto" du nom enterprise "**Auto** regression forensics".

## 2. Goal

Quand un watch franchit son seuil et fire un webhook, enrichir ce webhook avec le **verdict /regression complet** pour la métrique concernée (commit coupable + fichiers + fenêtre), ajouter une ligne coupable au texte Slack, et exposer le dernier coupable via `GET /watches`. Best-effort : le webhook fire toujours, enrichi ou non. Tout dans `docker-server-watches.mjs` + une pure fn extraite pour les tests.

Succès = un watch `entropy.density > 0.5` qui fire envoie un webhook dont le payload contient `regression: { worstCommit, ... }` et dont le `text` Slack finit par *"· Likely culprit: a8f3c2d by Marie (4 files) [attributed]"* ; `GET /watches` montre `state.lastCulprit`.

## 3. Décisions cadres (validées en brainstorm 2026-05-28)

| Décision | Choix | Raison |
|---|---|---|
| Enrichissement | **TOUT** : verdict `/regression` complet dans le payload + ligne coupable dans le `text` Slack + `lastCulprit` dans `/watches` | Choix utilisateur (tout). Observabilité maximale. |
| Quand appeler `/regression` | **Au fire** (franchissement + debounce passé), pas à chaque évaluation | 1 appel par fire (debounced 1h) ⇒ cheap, même si `/regression` fait N appels snapshot pour ownership/dissonance. |
| Mapping métrique | `entropy.density→density`, `entropy.modularity→modularity` ; les 3 autres identiques | `/regression` n'a pas le préfixe `entropy.` pour density/modularity ; ownership/dissonance partagent le même nom. |
| Best-effort | Le webhook fire **toujours** ; si `/regression` échoue/timeout/no-culprit → pas de champ `regression`, pas de ligne coupable | La forensics ne doit jamais bloquer l'alerting. |
| Coupling | **Pas couvert** (pas d'évaluateur watch `coupling`) | Ajouter un évaluateur coupling = extension du moteur watches, hors-scope. Documenté. |
| Testabilité | Extraire `buildWebhookPayload(...)` (pure) + `mapWatchToRegressionMetric(...)` (pure) | Permet des unit tests sans réseau. |

### Alternatives écartées

| Alternative | Pourquoi écartée |
|---|---|
| Appeler `/regression` à chaque évaluation (pas seulement au fire) | Gaspille des appels (N snapshot calls) sur des watches qui ne franchissent pas. Au-fire-only suffit. |
| Payload compact (objet coupable seul) | L'utilisateur veut tout (verdict complet + texte + /watches). |
| Ajouter un évaluateur watch `coupling` pour couvrir le 6e scalaire | Extension du moteur watches, feature distincte ; auto-forensics se branche sur les watches existants. |
| Recalcul forensics inline (sans appeler `/regression`) | Duplique la logique ; appeler notre endpoint est DRY. |

## 4. Design

### 4.1 Fichiers

```
upstream/docker-server-watches.mjs   MOD  mapping + buildWebhookPayload (pur, exporté) + fetchRegressionVerdict + fire-time enrichment + lastCulprit dans /watches
tests/unit/auto-regression-forensics.test.mjs   NEW  mapWatchToRegressionMetric + buildWebhookPayload

ROADMAP.md / INVENTORY.md / tests/README.md / CLAUDE.md   MOD
patches/upstream-all.diff                                 REGEN
```

Aucun nouveau module, aucun nouvel endpoint, aucune dépendance. Tout dans le moteur watches.

### 4.2 Pure helpers (testables, exportés)

```js
// Map a watch metric key to the /regression metric param. Returns null for
// metrics /regression doesn't cover (→ no enrichment).
export function mapWatchToRegressionMetric(watchMetric) {
  const MAP = {
    'entropy.density': 'density',
    'entropy.modularity': 'modularity',
    'ownership.busFactor': 'ownership.busFactor',
    'ownership.topAuthorShare': 'ownership.topAuthorShare',
    'dissonance.purity': 'dissonance.purity',
  };
  return MAP[watchMetric] || null;
}

// Build the webhook payload. `regression` is the /regression verdict or null.
// Pure — no I/O — so it's unit-testable.
export function buildWebhookPayload(repoBase, watch, currentValue, regression) {
  let text = `🚨 GitNexus: \`${repoBase}\` ${watch.metric} = ${currentValue.toFixed(4)} ${watch.op} ${watch.threshold} (threshold)`;
  const wc = regression && regression.worstCommit;
  if (wc && wc.sha) {
    const files = typeof wc.filesTouched === 'number'
      ? wc.filesTouched
      : (Array.isArray(wc.files) ? wc.files.length : null);
    const filesStr = files !== null ? ` (${files} files)` : '';
    const mode = regression.attribution ? ` [${regression.attribution}]` : '';
    text += ` · Likely culprit: ${wc.shortSha || wc.sha.slice(0, 7)} by ${wc.author || 'unknown'}${filesStr}${mode}`;
  }
  const payload = {
    repoBase, metric: watch.metric, threshold: watch.threshold, op: watch.op,
    currentValue, triggeredAt: new Date().toISOString(),
    source: 'gitnexus-watches/2bis.3', text,
  };
  if (regression) payload.regression = regression; // full /regression verdict
  return payload;
}
```

### 4.3 Fire-time enrichment

- New helper (I/O): `fetchRegressionVerdict(repoBase, watchMetric, webBase)` — `const m = mapWatchToRegressionMetric(watchMetric); if (!m) return null;` then `fetchJson(`${webBase}/regression?repo=${enc(repoBase)}&metric=${enc(m)}`)` (reusing the existing `fetchJson` with its `WATCH_TIMEOUT_MS` abort). Returns the verdict body or `null` on failure.
- `fireWebhook(repoBase, watch, currentValue, regression)` — gains the `regression` param; replaces its inline payload literal with `buildWebhookPayload(repoBase, watch, currentValue, regression)`. Everything else (the POST, timeout, return) unchanged.
- In `evaluateRepoWatches`, at the fire site (after the debounce check passes, before `fireWebhook`): `const regression = await fetchRegressionVerdict(repo, w.metric, webBase);` then `await fireWebhook(repo, w, evalResult.value, regression)`. Store a compact culprit in state: `state.lastCulprit = regression && regression.worstCommit ? { sha, shortSha, author, attribution: regression.attribution, filesTouched, at: now-ISO } : null;`

### 4.4 `/watches` exposure

The `GET /watches` handler already emits a `state` object per watch (lastEvaluatedAt/lastValue/lastError/lastTriggeredAt). Add `lastCulprit` (the compact object from § 4.3) to that `state` shape. Null when never fired / no culprit.

## 5. Edge cases

| Cas | Comportement |
|---|---|
| Métrique watch non mappée (custom) | `mapWatchToRegressionMetric` → null → pas d'enrichissement ; webhook fire en clair |
| `/regression` échoue / timeout | `fetchRegressionVerdict` → null ; webhook fire sans `regression` ni ligne coupable |
| `/regression` `regressed:false` (seuil franchi mais pas de régression nette détectée) | Verdict quand même attaché (honnête : seuil franchi, pas de coupable unique) ; ligne coupable seulement si `worstCommit` non-null |
| `regressed:true` mais `worstCommit:null` (stragglers) | `regression` attaché, pas de ligne coupable (pas de `wc.sha`) |
| Webhook sans URL | `fireWebhook` retourne déjà `{ ok:false }` — inchangé ; on n'appelle `/regression` que si on va fire (URL présente + seuil + debounce) |
| Coupling | Pas d'évaluateur watch ⇒ jamais de fire ⇒ jamais d'auto-forensics coupling (documenté) |

NOTE perf : `fetchRegressionVerdict` n'est appelé que dans la branche fire (seuil franchi + debounce). On le place APRÈS le check debounce pour ne pas payer l'appel quand on est debounced.

## 6. Testing strategy

- **Unit** (`tests/unit/auto-regression-forensics.test.mjs`) :
  - `mapWatchToRegressionMetric` : les 5 mappings + `coupling`/inconnu → null.
  - `buildWebhookPayload` : sans `regression` → payload de base, text sans ligne coupable, pas de champ `regression` ; avec `regression` ayant un `worstCommit` → champ `regression` présent + text finit par "Likely culprit: <sha> by <author> (N files) [<mode>]" ; avec `regression` mais `worstCommit:null` → champ présent, pas de ligne coupable ; `filesTouched` vs `files[]` length tous deux gérés.
- **Smoke** : `GET /watches` reste 200 (déjà dans la loop). Le fire-path réel (webhook POST) n'est pas e2e-testé (nécessite un endpoint webhook réel) — vérification manuelle documentée : configurer un watch + un webhook (ex. webhook.site), franchir le seuil, observer le payload enrichi.
- Pas de nouvel endpoint ⇒ pas de nouveau test d'intégration endpoint.

## 7. Out of scope (futurs)

- **Évaluateur watch `coupling`** (rendre `pairsAboveThreshold` watchable) → activerait l'auto-forensics coupling. Extension du moteur watches.
- **UI** : highlight du coupable dans `EntropyCommitTimeline` (commun aux phases regression).
- **Fenêtre forensics ciblée** : aujourd'hui `/regression` sans from/to (série complète + attribution 90j default). Une fenêtre récente ciblée est une amélioration future.

## 8. Risques et mitigations

| Risque | Sévérité | Mitigation |
|---|---|---|
| `/regression` lent (N snapshot calls ownership/dissonance) ralentit le fire | Faible | Au-fire-only + debounce 1h + `WATCH_TIMEOUT_MS` (30s) borne l'appel. Best-effort : timeout → webhook plain. |
| Payload "fat" (verdict complet) | Faible | Choix utilisateur (tout). Slack ignore les champs inconnus ; `text` reste lisible. |
| Couplage au shape de la réponse `/regression` | Faible | `buildWebhookPayload` ne lit que `worstCommit.{sha,shortSha,author,filesTouched,files}` + `attribution` (défensif, optional chaining) ; le reste est passe-plat. |
| Boucle (regression appelle des endpoints qui... ) | Nul | `/regression` lit /entropy etc., pas /watches ; pas de cycle. |

## 9. Effort estimate

| Tâche | Effort |
|---|---|
| Pure helpers (`mapWatchToRegressionMetric` + `buildWebhookPayload`) + unit | ~½j |
| `fetchRegressionVerdict` + fire-time enrichment + `fireWebhook` arg | ~½j |
| `lastCulprit` dans `/watches` | ~¼j |
| Docs + build + smoke | ~½j |
| **Total** | **~2 jours (~4 tasks)** |

## 10. Document updates checklist (à la livraison)

- `ROADMAP.md` : nouvelle ligne "Déjà livré" + dans la table enterprise, "Auto regression forensics" passe à ✅ (auto livré ; reste l'UI highlight). Bump date header.
- `INVENTORY.md` : enrichissement webhook watches + `lastCulprit` dans `/watches`.
- `CLAUDE.md` : note sur l'enrichissement (pas de nouvel endpoint ; `/watches` déjà dans la loop).
- `tests/README.md` : unit `auto-regression-forensics`.
- `patches/upstream-all.diff` : regen.
