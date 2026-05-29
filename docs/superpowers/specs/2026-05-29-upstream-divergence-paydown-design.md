---
Status: current
---

# Payer la dette de divergence upstream (Phase 1)

> Spec de design — écrit le 2026-05-29. Décision : rester sur `v1.6.5`,
> isoler/réduire la surface de patch et outiller le bump pour que tout
> futur passage à `v1.7.x` soit une opération à coût connu et borné.

## 1. Contexte / problème

Ce dépôt est l'extension *deployment + analytics* posée sur l'upstream
[abhigyanpatwari/gitnexus](https://github.com/abhigyanpatwari/gitnexus),
pinné à **`v1.6.5`**. Nos deltas sont sérialisés dans un diff plat
unique, `patches/upstream-all.diff`, ré-appliqué via `git apply` sur un
clone frais d'upstream.

État constaté au 2026-05-29 :

- **`v1.6.5` est la dernière release stable** ; les **120 commits** de
  retard sont sur `main`, **non taggés**, et incluent des refactors
  déstabilisants (Express 5, migration JS scope-based resolution, nouveau
  resolver Kotlin, C++ ranks). Aucune version stable à pinner au-delà de
  `v1.6.5`.
- **Le diff plat a explosé** : `patches/upstream-all.diff` fait
  **29 419 lignes / 114 fichiers**, alors que `patches/README.md`
  affirme encore « ~7k lignes » et pose explicitement la condition
  *« si nos deltas explosent, reconsidérer [diff plat vs submodule] »*.
  Ce seuil est franchi (×4).
- **La doc de bump est périmée** : `patches/README.md` indique de cloner
  `--branch v1.6.3` alors que tout le reste (`Dockerfile.cli`,
  `docker-compose.yml`) est sur `v1.6.5`.
- **`git apply` est tout-ou-rien** : il échoue en bloc dès qu'upstream a
  modifié un fichier qu'on édite en place. Le prochain bump est donc une
  opération à coût *inconnu et non borné*.

Diagnostic clé (mesuré, pas supposé) — la surface de conflit est petite
et très concentrée, pas répartie sur 114 fichiers :

| Catégorie | Nb fichiers | Risque de conflit au bump |
|---|---:|---|
| Fichiers neufs qu'on possède (additifs) | **97** | **nul** (copiés tels quels) |
| Édits en place de fichiers upstream | **17** | **toute la surface** |

Répartition des 17 fichiers in-place (lignes `+/-` dans le diff) :

| Lignes | Fichier | Réductible ? |
|---:|---|---|
| 2069 | `gitnexus-web/src/hooks/useAppState.tsx` | ❌ trop tissé |
| 795 | `gitnexus-web/src/components/RepoAnalyzer.tsx` | ⚠️ difficile |
| 751 | `gitnexus-web/src/hooks/useSigma.ts` | ⚠️ difficile |
| 563 | `docker-server.mjs` | ✅ pur câblage de routes |
| 453 | `gitnexus-web/src/components/GraphCanvas.tsx` | ⚠️ difficile |
| 285 | `gitnexus-web/package-lock.json` | n/a (régénérable) |
| 262 | `gitnexus-web/src/App.tsx` | ⚠️ partiel (montage panels) |
| 196 | `gitnexus-web/src/components/Header.tsx` | ✅ queue |
| 103 | `gitnexus-web/src/core/llm/agent.ts` | ✅ queue |
| 81 | `Dockerfile.web` | ✅ queue |
| 44 | `gitnexus-web/src/services/backend-client.ts` | ✅ queue |
| 36 | `gitnexus-web/src/components/DropZone.tsx` | ✅ queue |
| 25 | `gitnexus-web/src/components/FileTreePanel.tsx` | ✅ queue |
| 13 | `gitnexus-web/src/lib/lucide-icons.tsx` | ✅ queue |
| 11 | `gitnexus-web/src/index.css` | ✅ queue |
| 8 | `gitnexus-web/package.json` | n/a (deps) |
| 7 | `gitnexus-web/src/config/ui-constants.ts` | ✅ queue |

## 2. Goal

Faire en sorte que tout futur bump d'upstream soit une opération à coût
**connu, borné et reproductible**. On y parvient en (a) isolant la vraie
surface de conflit, (b) la réduisant là où c'est tractable sans gros
refactor, et (c) outillant le bump pour qu'il produise un rapport de
conflit fichier par fichier au lieu d'un échec opaque tout-ou-rien.
Aucun changement au comportement du build actuel ni au produit.

## 3. Design

Posture retenue : **rester sur `v1.6.5`** (pas de successeur stable) et
payer la dette de divergence maintenant. Quatre chantiers :

### 3.1 Isoler la surface
Scinder `patches/upstream-all.diff` en deux artefacts :
- **`patches/additive-files.diff`** — les 97 fichiers neufs qu'on
  possède. Ré-appliables sur n'importe quelle version sans conflit.
- **`patches/inplace-edits.diff`** — les 16 fichiers réellement à risque
  (hors `package-lock.json`, régénéré par `npm install`).

Bénéfice : la vraie surface devient visible et petite ; un bump ne
ré-applique en aveugle que les additifs et concentre l'attention humaine
sur les in-place.

### 3.2 Réduire la surface (là où c'est tractable)
- **`docker-server.mjs` (563 → ~1 ligne)** : remplacer le câblage de
  routes en place par **une seule ligne injectée**
  `require('./docker-server-routes.mjs')(app)`. Tout notre routing
  déménage dans un fichier neuf qu'on possède (passe d'in-place à
  additif). Plus gros gain unitaire et techniquement simple (le routing
  Express est purement additif côté upstream).
- **La queue** (`Header`, `agent.ts`, `DropZone`, `FileTreePanel`,
  `lucide-icons`, `index.css`, `ui-constants`, `backend-client`) :
  convertir en overlays / imports additifs quand l'édit est petit
  (< ~50 lignes) et propre.
- **On ne touche PAS** `useAppState.tsx`, `RepoAnalyzer.tsx`,
  `useSigma.ts`, `GraphCanvas.tsx` : trop tissés dans le state upstream ;
  le refactor coûterait plus que le merge 3-way ponctuel. Ils restent
  dans `inplace-edits.diff`, assumés.

### 3.3 Outiller le bump
`scripts/bump-upstream.mjs` qui, pour un tag/branche cible :
1. clone l'upstream à la cible dans un répertoire jetable ;
2. applique `additive-files.diff` (doit être clean, sinon erreur) ;
3. tente `inplace-edits.diff` avec `git apply --3way` ;
4. émet un **rapport fichier par fichier** : appliqué proprement /
   conflit 3-way / échec.

Premier usage immédiat : **dry-run contre `main`** pour obtenir un aperçu
chiffré et concret de la douleur d'une future `v1.7.x` — donnée qu'on n'a
pas aujourd'hui. Le script est read-only vis-à-vis de notre dépôt (il
travaille dans un clone jetable).

### 3.4 Réparer les docs périmées
`patches/README.md` : `v1.6.3` → `v1.6.5`, « ~7k lignes » → réalité
(diff scindé, ~29k), documenter les deux nouveaux artefacts et le script
de bump, et acter la décision *diff plat vs submodule* (différée à la
phase 2, cf. §5).

### Alternatives considérées
- **Bumper sur `main` maintenant** — rejeté : aucune release à pinner,
  Express 5 + refactor JS rendent la base instable. On prendrait la
  douleur du bump *et* une base fragile pour un déploiement. Mauvais ROI
  tant que `v1.7.x` n'est pas sortie.
- **Re-architecturer en subtree/submodule + rebase** — différé : change
  le *mécanisme* de merge (3-way au lieu de tout-ou-rien) mais **pas la
  surface de conflit** (rebaser 2069 lignes sur `useAppState.tsx`
  conflicte tout autant). Gros chantier, gros risque, ne traite pas la
  cause racine. À reconsidérer quand une `v1.7.x` stable sort (phase 2).
- **Approche retenue** — la plus haute valeur au plus faible risque :
  elle ne change rien au build actuel, attaque la cause racine (surface
  de conflit) et rend le prochain bump bon marché quelle que soit la
  cible.

## 4. Scope boundaries (hors-scope explicite)

- Pas de bump sur `main` ni sur quoi que ce soit au-delà de `v1.6.5`.
- Pas de migration submodule/subtree (= phase 2).
- Pas de refactor des 4 gros fichiers React (`useAppState`,
  `RepoAnalyzer`, `useSigma`, `GraphCanvas`).
- Aucun nouveau feature produit, aucun changement de comportement
  utilisateur.

## 5. Open questions

- **Phase 2 — formaliser le format de cohabitation upstream ↔ notre
  version** (demandé explicitement par l'utilisateur le 2026-05-29).
  Une fois la surface isolée et réduite (phase 1), définir le *contrat*
  durable de cohabitation : modèle de suivi d'upstream (rester en diff
  plat scindé vs adopter subtree/submodule), cadence de bump, critère de
  déclenchement (p. ex. « bumper dès qu'une `v1.7.x` stable sort »), et
  où vit la doc de ce contrat. Le rapport du dry-run §3.3 contre `main`
  alimentera cette décision avec des chiffres réels.
- Jusqu'où descendre dans « la queue » du §3.2 : quels édits valent la
  conversion en overlay vs lesquels rester en place (à trancher fichier
  par fichier pendant l'exécution, selon coût/propreté).

## Vérification

- **Split (§3.1) correct** si `git apply additive-files.diff` puis
  `git apply inplace-edits.diff` sur un clone `v1.6.5` propre reproduit
  l'état actuel à l'identique → `docker compose build` OK + smoke loop
  verte (cf. `CLAUDE.md`).
- **Shim `docker-server.mjs` (§3.2) correct** si la smoke loop passe à
  l'identique après refactor (toutes les routes analytics répondent).
- **Script de bump (§3.3) correct** s'il produit un rapport lisible
  fichier-par-fichier sur un dry-run, sans jamais écrire dans notre
  dépôt.

## Update 2026-05-29 — Réalité d'implémentation (Phase 1 livrée)

- **Split réel : 99 fichiers additifs / 17 in-place** (la valeur « 97 » du §1 était
  légèrement périmée — `docker-server-prewarm.mjs` était dans le clone mais absent
  du diff commité ; la régénération l'a capté, +1 ; le shim `docker-server-routes.mjs`
  ajoute le second).
- **Réduction `docker-server.mjs` partielle, pas « 563→1 » :** seul le *câblage de
  routes* (chaîne de dispatch + 33 imports + cron) est sorti dans le shim additif
  `docker-server-routes.mjs`. Les handlers inline `handleExport`/`handleImport`/`/listdir`
  (routes utilitaires couplées au module) restent in-place par design. `docker-server.mjs`
  reste donc un fichier in-place (footprint réduit, pas nul).
- **La « queue » frontend du §3.2 n'a PAS été convertie** en overlays additifs : les
  édits React ne deviennent pas additifs sans éditer un site d'import upstream. Renvoyé
  à la phase 2 (cf. open question §5).
- **Donnée Phase 2 (dry-run contre `main`, `patches/bump-dry-run-main.md`) :**
  107 clean / 0 conflict / 9 fail. Les 9 fichiers à re-merger à la main pour un bump
  vers `main` : docker-server.mjs, gitnexus-web/package.json + package-lock.json,
  composants DropZone/GraphCanvas/Header/RepoAnalyzer, core/llm/agent.ts,
  hooks/useAppState.tsx + useSigma.ts, lib/lucide-icons.tsx. (Les ~5 autres in-place,
  dont App.tsx et FileTreePanel.tsx, s'appliquent clean.)
