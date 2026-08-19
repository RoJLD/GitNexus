# La Lentille Souveraine — Phase 1b (projecteur navigateur) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 🤝 Coordination (lire AVANT d'exécuter — collision évitée measure-first)

Le north-star « La Lentille Souveraine » définit **UN contrat `/lens`, N consommateurs**. Deux
sessions le réalisent en parallèle sur des couches **disjointes** :

- **Session parallèle `claude-602a0ef2`** (mergée dans ELYSIUM main) : le **projecteur AGENT/MCP**
  (skill `.agent/skills/gitnexus-governance-lenses/SKILL.md` — outils `gitnexus_list_lenses`,
  `gitnexus_get_lens_graph`, `query_meta_graph`) + la lentille `health::graph_registry` + le
  `meta.freshness` côté gateway. Leur skill nomme `gitnexus-web` comme « le visualiseur humain » —
  **ils ne le revendiquent pas, ils l'attendent.**
- **CE plan (Phase 1b)** : le **projecteur HUMAIN/NAVIGATEUR** dans `gitnexus-web`. Même contrat,
  consommateur symétrique.

**Contrat `/lens` post-merge (VÉRIFIÉ dans le gateway mergé)** : `/lens/<name>` = `evaluate()`
(BrainGraph : `nodes[].properties.{communityColor, inLens}` + top-level `insights`/`meaning`) +
`meta.freshness` injecté au niveau route. **Asymétrie mesurée** : le navigateur fetch
`/api/graph?repo=<lens>` (gitnexusify) qui porte les nœuds+color+inLens+insights+meaning MAIS
**pas `meta.freshness`** (injecté uniquement sur la route `/lens/<name>`). Cf Task 3.

**Iron : Σ-A-PARALLEL-SESSION-MAY-SHIP-INTO-THE-SAME-NORTH-STAR-MERGE-DONT-CLOBBER.**

**Goal:** Rendre le projecteur navigateur symétrique du projecteur agent : la lentille dim/masque les nœuds hors-sélection (`inLens`), affiche ses insights + son meaning, et signale la fraîcheur (STALE) — même vérité que les outils MCP.

**Architecture:** Extensions minimales du chemin de rendu existant (`knowledgeGraphToGraphology` dans `graph-adapter.ts`, que l'explorer utilise déjà via `/api/graph`) + un panneau UI greenfield. **La couleur est DÉJÀ rendue** (`graph-adapter.ts:247` lit `properties.communityColor` que mon moteur Phase 1a produit) → aucune tâche couleur.

**Tech Stack:** TypeScript, React, Sigma/graphology, vitest (fork `ingestion/GitNexus/upstream/gitnexus-web/`).

## Global Constraints

- **Cible** : fork `ingestion/GitNexus/upstream/gitnexus-web/src/` — fichiers `upstream/` gitignorés, matérialisés depuis `patches/`. Après édition d'`upstream/`, **régénérer `patches/additive-files.diff` + `patches/inplace-edits.diff`** (cf CLAUDE.md fork) + `node scripts/check-patch-drift.mjs`.
- **Identité git** : `roblastar@live.fr` (jamais Alten). Commits au **root du fork** (`ingestion/GitNexus/`).
- **Zéro régression de rendu** : les lentilles et repos réels doivent continuer à rendre exactement comme avant pour les nœuds SANS `inLens`/`insights` (le contrat est un sur-ensemble additif — un nœud sans `inLens` n'est jamais dim).
- **La couleur ne fait l'objet d'AUCUNE tâche** (déjà rendue). Ne pas ré-implémenter.
- **Pas de nouvelle dépendance.** Réutiliser les primitives existantes (`heatColor`, `COMMUNITY_PALETTE`, le dim `#374151`/size 2).
- TDD, commits fréquents, mettre à jour `tests/README.md` (inventory-check) pour tout nouveau test.

---

### Task 1: Dim/masque des nœuds hors-lentille (`inLens === false`)

**Files:**
- Modify: `upstream/gitnexus-web/src/lib/graph-adapter.ts` (fonction `knowledgeGraphToGraphology`, ancre color ~:247-254)
- Test: `tests/unit/lens-inlens-dim.test.mjs` (ou `.test.ts` selon la convention unit du fork)

**Interfaces:**
- Consumes: le nœud BrainGraph `node.properties.inLens?: boolean` (produit par le moteur Phase 1a `apply_select`).
- Produces: dans `knowledgeGraphToGraphology`, un nœud dont `properties.inLens === false` est **dim** (couleur `#374151`, `size` réduite) — même idiome que le dim `isolateCommunity` existant. Un nœud sans `inLens` (undefined) ou `inLens === true` rend **inchangé** (pas de régression). Le dim `inLens` a la priorité la plus basse (une sélection explicite d'autres vues — dead/diff — le surchargent comme aujourd'hui).

- [ ] **Step 1: Write the failing test** — construire un KnowledgeGraph à 2 nœuds (`inLens:true`/`inLens:false`), appeler `knowledgeGraphToGraphology`, asserter que le nœud `inLens:false` a `color === '#374151'` et une `size` réduite, et que le nœud `inLens:true` garde sa couleur/size normale. Un 3ᵉ nœud SANS `inLens` doit être inchangé.

```javascript
// tests/unit/lens-inlens-dim.test.mjs (aligner l'import sur la convention unit existante du fork)
import { describe, it, expect } from 'vitest';
import { knowledgeGraphToGraphology } from '../../upstream/gitnexus-web/src/lib/graph-adapter';

function kg(nodes) { return { nodes, relationships: [] }; }

describe('inLens dim', () => {
  it('dims nodes with inLens===false, leaves others intact', () => {
    const g = knowledgeGraphToGraphology(kg([
      { id: 'a', label: 'CodeElement', properties: { communityColor: '#abc', inLens: true } },
      { id: 'b', label: 'CodeElement', properties: { communityColor: '#abc', inLens: false } },
      { id: 'c', label: 'CodeElement', properties: { communityColor: '#abc' } },
    ]), /* opts par défaut */ {});
    expect(g.getNodeAttribute('b', 'color')).toBe('#374151');
    expect(g.getNodeAttribute('a', 'color')).not.toBe('#374151');
    expect(g.getNodeAttribute('c', 'color')).not.toBe('#374151');
  });
});
```
> ⚠️ Vérifier la signature réelle de `knowledgeGraphToGraphology` (args `opts`) dans `graph-adapter.ts` et adapter l'appel de test. Si la fn n'est pas exportée telle quelle, exporter un helper testable ou tester via la surface exportée.

- [ ] **Step 2** : lancer le test → FAIL (le dim inLens n'existe pas).
- [ ] **Step 3: Implémenter** — dans le bloc de calcul couleur de `knowledgeGraphToGraphology` (près de `:247` où `projectionColor` est lu), après avoir résolu `nodeColor`, ajouter :
```typescript
const inLensFalse = (node.properties as { inLens?: boolean }).inLens === false;
// ... au moment du addNode / calcul de color+size :
//   si inLensFalse et qu'aucune vue prioritaire (dead/diff) ne s'applique → dim
//   color = '#374151'; size = <taille réduite existante, ex. 2>
```
Respecter l'ordre de priorité existant (dead/diff/activation gardent leur préséance ; inLens est le dim de plus basse priorité, comme `isolateCommunity`).
- [ ] **Step 4** : test → PASS. Vérifier qu'aucun test de rendu existant ne casse (`npm test` unit).
- [ ] **Step 5: Regen patches + commit** (`inplace-edits.diff` change car graph-adapter.ts est patché) : `git add -N` dans `upstream`, regen les 2 diffs, `check-patch-drift`, puis commit `feat(lens): browser dims out-of-lens nodes (inLens===false)`.

---

### Task 2: Panneau insights + meaning

**Files:**
- Create: `upstream/gitnexus-web/src/components/LensInsightsPanel.tsx`
- Modify: l'état app qui porte la réponse `/api/graph` (capturer top-level `insights`/`meaning`) + le point de montage du panneau (là où les autres panneaux de lentille vivent — à repérer : `Header.tsx`/panneau latéral).
- Test: `tests/unit/components/lens-insights-panel.test.tsx`

**Interfaces:**
- Consumes: la réponse `/api/graph` top-level `{ insights?: {id,name,value}[], meaning?: string }` (produit par `evaluate`).
- Produces: `<LensInsightsPanel insights={...} meaning={...} />` — rend `meaning` en tête + une liste des `insights` (`name` : `value`), triée. Absent/vide → le panneau ne s'affiche pas (pas de bruit sur les repos réels sans insights).

- [ ] **Step 1: Failing test** — monter `<LensInsightsPanel meaning="Services critiques." insights={[{id:'x',name:'X',value:9}]}/>`, asserter que « Services critiques. » et « X » et « 9 » sont rendus ; monter avec `insights=[]` + `meaning=""` → rien (composant retourne `null`).
- [ ] **Step 2** : FAIL (composant absent).
- [ ] **Step 3: Implémenter** le composant pur (props → JSX, `null` si vide) — pas d'état interne, pas de fetch (les données viennent des props).
- [ ] **Step 4** : test → PASS.
- [ ] **Step 5: Câbler** — capturer `insights`/`meaning` de la réponse `/api/graph` dans l'état app (là où `nodes`/`edges` sont déjà captés) et monter `<LensInsightsPanel>` près du canvas quand une lentille est active. Vérifier live (ou via un test d'intégration léger) que le panneau apparaît pour `health::critical_services` et pas pour un repo réel.
- [ ] **Step 6** : mettre à jour `tests/README.md` (2 entrées : unit panel). Regen patches (nouveau fichier additif + edits d'état). Commit `feat(lens): insights + meaning panel (renders /lens top-level insights/meaning)`.

---

### Task 3: Badge de fraîcheur (STALE) — Zero-Masking

**Files:**
- Modify (fork): le panneau/afficheur de lentille (badge) + l'état qui porte `meta.freshness`.
- Test: `tests/unit/lens-freshness-badge.test.tsx`
- **⚠️ Dépendance cross-frontière (ELYSIUM, coordination session //)** : voir décision ci-dessous.

**Contexte mesuré** : `meta.freshness` (`{stale, age_hours, ttl_hours, source_mtime}`) est injecté par le gateway **uniquement sur la route `/lens/<name>`**, PAS sur `/api/graph?repo=` que l'explorer utilise. Deux options :
- **(A) Fork-only** : quand une lentille est active, faire un fetch **additionnel** `/lens/<name>` (léger, juste le `meta.freshness`) en parallèle de `/api/graph`, et afficher le badge. Zéro changement gateway → **zéro collision** avec la session //.
- **(B) Gateway** : ajouter `meta.freshness` à la sortie `/api/graph` (ELYSIUM `sigma_brain_graph_gateway.py`, **territoire session //**) → nécessite **coordination** (blackboard) avant d'éditer leur fichier.

**Décision par défaut : (A) fork-only** (respecte la disjonction des couches ; le gateway reste à la session //). Le badge lit `stale` : `true` → badge orange « PÉRIMÉ (age > TTL) » ; `false` → rien ou vert discret ; `null`/absent → « fraîcheur inconnue » (le dire, cf doctrine Zero-Masking du skill //).

- [ ] **Step 1: Failing test** — un composant/badge `<LensFreshnessBadge freshness={{stale:true, age_hours:50, ttl_hours:24}}/>` rend « PÉRIMÉ » ; `stale:false` → pas de « PÉRIMÉ » ; `freshness={null}` → « inconnue ».
- [ ] **Step 2** : FAIL.
- [ ] **Step 3: Implémenter** le badge pur (props → JSX).
- [ ] **Step 4** : PASS.
- [ ] **Step 5: Câbler (option A)** — au chargement d'une lentille, fetch `/lens/<name>` pour `meta.freshness` (en plus du `/api/graph` de rendu), stocker, afficher le badge. Vérifier live sur `health::critical_services`.
- [ ] **Step 6** : `tests/README.md` + regen patches + commit `feat(lens): freshness (STALE) badge from meta.freshness, fork-only fetch (no gateway change)`.

---

## Self-Review

**Spec coverage** (contre le contrat mesuré) : couleur = déjà rendue (aucune tâche, intentionnel) ✅ ; inLens dim → Task 1 ✅ ; insights/meaning → Task 2 ✅ ; freshness STALE → Task 3 (fork-only, sans collision) ✅.
**Placeholder scan** : les `⚠️` sont des points de vérification runtime explicites (signature de `knowledgeGraphToGraphology`, point de montage du panneau, convention unit du fork), pas des TODO — l'implémenteur les résout en lisant le fichier réel.
**Anti-collision** : aucune tâche ne touche ELYSIUM `scripts/governance/` ni `.agent/skills/` (territoire session //). L'option (A) de Task 3 garde le gateway intact.

## Execution Handoff

Fork-side (`ingestion/GitNexus/`, remote `sovereign` = RoJLD/GitNexus). Nécessite le stack local (gateway + web) pour la vérif live des câblages (Steps 5). Le moteur Phase 1a est déjà mergé côté ELYSIUM (produit color/inLens/insights/meaning) — pull ELYSIUM main + relancer le gateway avant vérif live.
