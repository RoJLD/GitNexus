---
Status: current
---

# Contrat de cohabitation upstream ↔ fork (Phase 2)

> Spec de design — écrit le 2026-05-29. Suite de
> `2026-05-29-upstream-divergence-paydown-design.md` (Phase 1, open question §5).
> Formalise le *contrat* durable de cohabitation entre upstream
> `abhigyanpatwari/gitnexus` et notre fork. Pensé pour être **extrait et
> généralisé** ensuite (cf. §5 — vision multi-repo).

## 1. Contexte / problème

La Phase 1 a payé la dette de divergence : surface isolée (99 additifs / 17
in-place), `scripts/bump-upstream.mjs` (dry-run de bump), docs réparées. Il
manque le **contrat** : *quand* bumper, *comment*, et *comment éviter que le
système pourrisse* entre deux bumps.

Données qui cadrent la décision (dry-run contre `main`,
`patches/bump-dry-run-main.md`, 2026-05-29) :

- **99 additifs : tous clean.** Le gros `useAppState.tsx` (2069 lignes) : clean.
- **9 `fail`** (dont `package.json`/`package-lock.json` triviaux/régénérables) →
  **~6-7 fichiers source** à re-merger à la main pour un bump vers un `main`
  pourtant très divergent (Express 5 + refactor JS).
- **0 `conflict` (3-way) / 9 `fail`** : ces fichiers échouent **même avec les
  blobs ancêtres disponibles** en `--3way`. Conséquence directe : passer à
  subtree/submodule (= autre mécanisme de merge 3-way) **ne réduirait pas** la
  surface dure — elle est dure quel que soit le mécanisme.

Vécu récent qui motive la veille : pendant la Phase 1, un travail concurrent
(« group-graph ») a édité le clone `upstream/` sans régénérer les diffs commités
→ `additive-files.diff` périmé de 3 fichiers. C'est la **dérive interne** que le
contrat doit rendre détectable.

## 2. Goal

Un contrat de cohabitation **durable, explicite et applicable** qui : (a) fige la
règle de bump (conservatrice) ; (b) documente la procédure de bump comme une
opération à coût connu ; (c) détecte automatiquement les deux dérives (interne :
diffs commités vs clone ; externe : nouvelle release upstream). Écrit de façon à
pouvoir être **extrait** plus tard en mécanisme générique multi-repo (§5).

## 3. Design

### 3.0 Modèle de suivi — tranché : on reste en flat-diff scindé
On garde `additive-files.diff` + `inplace-edits.diff` + `bump-upstream.mjs`.
Justifié par la donnée (§1) : la migration subtree/submodule ne réduit pas la
surface dure. YAGNI sur la migration ; à ne reconsidérer que si un futur dry-run
réel montre la résolution flat-diff ingérable.

### 3.1 Règle de bump (conservatrice)
On bump **uniquement** quand **(a)** une release **stable** `v1.7.x+` sort upstream
**ET (b)** on a une raison concrète (fix/feature/sécurité dont on a besoin). On ne
suit **jamais** `main`. `bump-upstream.mjs` est le **gate go/no-go** : si son
rapport montre une surface ingérable, on diffère ou on découpe.

### 3.2 Procédure de bump (playbook)
1. `node scripts/bump-upstream.mjs <nouveau-tag>` → rapport (gate).
2. Si acceptable : clone du tag → applique `additive-files.diff` (doit être clean)
   → `git apply --3way inplace-edits.diff` → résout à la main la poignée de `fail`.
3. `docker compose build` + smoke loop (`CLAUDE.md`) + `cd tests && npm test`.
4. Régénère les deux diffs (diff-filter A/M) ; bump les pins de version
   (`Dockerfile.cli`, `docker-compose.yml`) ; MAJ `INVENTORY.md`/`ROADMAP.md`.

### 3.3 Veille auto — garde de dérive INTERNE (`scripts/check-patch-drift.mjs`)
Régénère le split depuis `upstream/` (diff-filter A/M en mémoire) et le compare aux
`patches/*.diff` commités ; **exit≠0 + liste des fichiers divergents** si écart.
- Mode d'usage retenu (**choix A-i**) : script **à la demande**, ajouté à la
  checklist « When you ship a feature » de `CLAUDE.md`. Le **pre-commit hook**
  bloquant est une option **différée** (phase suivante).
- C'est la garde qui aurait attrapé la dérive « group-graph ».

### 3.4 Veille auto — veille de divergence EXTERNE (`scripts/check-upstream-releases.mjs`)
Interroge l'API GitHub (`releases/latest` + compare tags) pour détecter une release
stable plus récente que notre pin, et résume la divergence (réutilise le dry-run de
`bump-upstream.mjs`). **Alerte, n'agit jamais.** Sortie : un court rapport
(release courante vs pin, nb de commits d'écart, surface `fail` estimée).
- Livraison cible (**choix B ii+iii**) : exécutée périodiquement via **(ii)** une
  routine `/schedule` **ET (iii)** le cron `watches` déjà présent dans le serveur
  docker. Le **câblage effectif** de ces deux déclencheurs est **différé** à la
  phase suivante ; la Phase 2 livre le **script cœur** réutilisable par les deux.

### 3.5 Où vit le contrat
Ce spec est le contrat durable. Pointeurs opérationnels ajoutés dans `CLAUDE.md`
(section bump/ship) et `patches/README.md` (section « Cohabitation contract » +
les deux scripts de garde).

### Alternatives considérées
- **Migrer en subtree/submodule** — rejeté par la donnée (§3.0) : ne réduit pas la
  surface dure, gros coût.
- **Suivre `main` (feature-driven)** — rejeté (choix utilisateur) : base instable
  (Express 5), re-merge fréquent. Posture conservatrice préférée.
- **Gel total sans veille** — rejeté : risque de big-bang divergence ; la veille
  légère est peu coûteuse et évite la surprise.

## 4. Scope boundaries (Phase 2)

**Dans le périmètre (choix C — recommandation) :**
- Ce spec-contrat.
- `scripts/check-patch-drift.mjs` (garde interne, run-on-demand).
- `scripts/check-upstream-releases.mjs` (veille externe, cœur réutilisable).
- Wiring doc (`CLAUDE.md`, `patches/README.md`) + entrée checklist.

**Hors périmètre — marqué pour la phase suivante :**
- Pre-commit hook bloquant pour la garde interne (option A-ii).
- Câblage effectif de la veille externe dans `/schedule` (B-ii) et dans le cron
  `watches` du serveur docker (B-iii).
- **Extraction + généralisation multi-repo** (§5).

## 5. Open questions / vision (Phase 3+)

- **Généralisation multi-repo (explicitement voulue, 2026-05-29).** Ce contrat est
  le **prototype de référence**. Objectif ultérieur : l'extraire en mécanisme
  générique pour suivre **des milliers de repos upstream**, avec :
  - **Niveaux d'importance** par repo (certains comptent plus) ;
  - **Cadence variable** de veille/bump (les plus importants suivis plus souvent) ;
  - un registre des repos suivis + leur pin + leur tier + leur dernière veille.
  Implication de conception **dès maintenant** : garder le **mécanisme générique**
  (split additif/in-place, dry-run gate, gardes interne/externe, règle de bump)
  **séparé des spécificités gitnexus** (pin `v1.6.5`, les 17 fichiers in-place, la
  smoke loop docker, le shim de routes) pour que le cœur soit extractible sans
  réécriture. Ne PAS construire la machinerie multi-repo dans la Phase 2, mais ne
  pas non plus coder en dur d'hypothèses qui bloqueraient l'extraction.
- Forme exacte du registre multi-repo (fichier de config ? service ?) et du
  scheduling par tier : à concevoir en Phase 3.

## Vérification

- **`check-patch-drift.mjs`** correct s'il exit 0 quand les diffs commités == clone
  régénéré, et exit≠0 en listant les fichiers quand on introduit une dérive de test.
- **`check-upstream-releases.mjs`** correct s'il rapporte « à jour » quand le pin ==
  dernière release, et signale une release plus récente sinon (testable en mockant
  la réponse API / en passant le pin et la liste de tags en entrée d'une fonction
  pure de comparaison).
- Wiring correct si `grep` ne trouve plus de procédure de bump périmée et si les
  deux scripts sont documentés dans `CLAUDE.md` + `patches/README.md`.
