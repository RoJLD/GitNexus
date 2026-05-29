---
Status: current
---

# Extraction d'un outil de cohabitation générique multi-repo (Phase 3)

> Spec de design — écrit le 2026-05-29. Suite de
> `2026-05-29-upstream-cohabitation-contract-design.md` (Phase 2, open question
> §5 « généralisation multi-repo »). Crée un dépôt frère **`fork-cohabitation`**
> qui généralise le mécanisme de cohabitation (bump / drift / release-watch) à
> N repos via un registre + une config par repo. gitnexus devient consommateur #1.

## 1. Contexte / problème

Les Phases 1-2 ont produit, **dans gitnexus**, un mécanisme de cohabitation avec
upstream : split de patches additif/in-place, `bump-upstream.mjs` (dry-run gate),
`check-patch-drift.mjs` (dérive interne), `check-upstream-releases.mjs` (veille
release). Ces 3 scripts ont des spécificités gitnexus **codées en dur** :
`UPSTREAM_URL`, chemins `patches/additive-files.diff` / `patches/inplace-edits.diff`,
dossier de clone `upstream/`, fichier de pin `Dockerfile.cli` + regex.

La vision (mémoire `multi-repo-fork-tracking-vision`) : suivre **des milliers de
repos upstream**, avec des **tiers d'importance** et une **cadence variable**.
gitnexus n'est que le premier. Garder le mécanisme enterré dans gitnexus bloque
cette vision. Décision utilisateur (2026-05-29) : extraire **maintenant** l'outil
générique **et** le registre multi-repo (pas seulement le mécanisme).

## 2. Goal

Un dépôt frère `fork-cohabitation` qui : (a) expose un outil générique
config-driven (les 3 commandes prennent une config par repo, plus aucune constante
hardcodée) ; (b) tient un **registre fin** des repos suivis (nom → chemin + tier +
cadence) ; (c) orchestre les gardes sur tout le parc (`--all` / `--due`). gitnexus
devient le premier consommateur via sa propre `cohabitation.config.json`, **tout en
restant opérable de façon autonome** (ses 3 scripts actuels sont conservés, gelés,
et servent d'oracle de parité).

## 3. Design

### 3.1 Le dépôt `fork-cohabitation` (frère de gitnexus)
Son **propre dépôt git** sous `C:\Users\rdenis\VScode\fork-cohabitation\` (identité
`roblastar@live.fr`, comme les autres repos du workspace — pas un sous-dossier de
gitnexus, c'est tout l'intérêt de la sortie). Structure :
```
fork-cohabitation/
├── bin/cohabit.mjs          CLI — dispatch des sous-commandes
├── src/
│   ├── config.mjs           charge + valide une cohabitation.config.json (fns pures)
│   ├── registry.mjs         charge repos.json, résout nom→chemin, filtre tier/cadence
│   ├── drift.mjs            logique de dérive interne (extraite de check-patch-drift)
│   ├── release-watch.mjs    logique de veille release (extraite de check-upstream-releases)
│   └── bump.mjs             logique de dry-run de bump (extraite de bump-upstream)
├── repos.json               LE registre multi-repo
├── tests/unit/              tests des fonctions pures (config, registry, semver, diff)
├── docs/superpowers/specs/  futurs specs propres ; accueille le CONTRAT générique
├── README.md  CLAUDE.md  LICENSE  package.json
```
CLI : `cohabit drift <repo>` · `cohabit bump <repo> <tag>` · `cohabit watch <repo>` ·
`cohabit watch --all` / `--due`.

### 3.2 L'outil générique (config-driven, JSON)
Les 3 commandes sont l'**extraction** (pas la réécriture) de la logique des scripts
gitnexus, paramétrée par une config. **Format JSON partout** (zéro dépendance,
Node-natif ; pas de parser YAML). Chaque commande garde la forme « fonctions pures
+ fine couche I/O » des Phases 1-2.

**Config par repo** `<repo>/cohabitation.config.json` :
```json
{
  "upstreamUrl": "https://github.com/abhigyanpatwari/gitnexus.git",
  "cloneDir": "upstream",
  "additiveDiff": "patches/additive-files.diff",
  "inplaceDiff": "patches/inplace-edits.diff",
  "pinFile": "Dockerfile.cli",
  "pinPattern": "gitnexus:(\\d+\\.\\d+\\.\\d+)"
}
```
`config.mjs` charge + valide (champs requis, regex compilable) et renvoie un objet
normalisé. Toutes les commandes résolvent leurs chemins **relativement au repo
ciblé**, plus jamais en dur.

### 3.3 Le registre fin `repos.json`
```json
[
  { "name": "gitnexus", "path": "../gitnexus", "tier": "normal",
    "cadence": "weekly", "lastWatch": null }
]
```
`registry.mjs` : charge, résout `name → path`, charge la config du repo depuis son
`path`, et filtre par tier/cadence. `tier` = label d'importance (libre, ex.
`critical`/`normal`/`low`). `cadence` = intervalle de veille (ex. `daily`/`weekly`/
`monthly`). `lastWatch` = timestamp ISO de la dernière veille (mis à jour par
`watch`).

### 3.4 Orchestration multi-repo
- `cohabit watch --all` : veille release sur tous les repos du registre → rapport
  consolidé (à jour / alerte par repo).
- `cohabit watch --due` : ne lance que les repos dont `now - lastWatch ≥ cadence` ;
  met à jour `lastWatch` ; rapport consolidé. (`now` passé en argument/injecté pour
  testabilité — pas de `Date.now()` caché dans les fonctions pures.)
- **Le déclencheur planifié réel reste différé** (cohérent avec le report Phase 2) :
  l'orchestrateur fournit `--all`/`--due`, mais on ne câble pas encore un cron /
  `/schedule` qui appelle `--due` périodiquement. C'est une couche fine ultérieure.

### 3.5 gitnexus = consommateur #1 (option B-iii : garder + geler + oracle)
- Ajout de `gitnexus/cohabitation.config.json` (valeurs ci-dessus).
- Ajout d'une entrée gitnexus dans `fork-cohabitation/repos.json`.
- **Les 3 scripts `gitnexus/scripts/{bump-upstream,check-patch-drift,check-upstream-releases}.mjs` sont CONSERVÉS** → gitnexus reste opérable en standalone (le flow « apply on a fresh clone » du `patches/README` n'exige pas le repo central).
- **3 garde-fous contre la dérive de duplication** :
  1. **Extraction, pas réécriture** : l'outil central réutilise les mêmes fonctions
     pures (mêmes algorithmes) que les scripts gitnexus.
  2. **Test de parité** : un test lance l'outil central ET le script gitnexus
     correspondant sur gitnexus et **assert un résultat identique** — les scripts
     gitnexus (connus bons) sont l'**oracle** de l'extraction.
  3. **Gel + condition de consolidation écrite** : les scripts gitnexus sont gelés
     (toute évolution de logique va désormais dans l'outil central) et documentés
     « référence autonome ; consolider quand un cutover aura du sens (2ᵉ repo
     onboardé, ou dépendance au repo central acceptée) ».
- Le **contrat générique** (doc) déménage dans `fork-cohabitation` ; gitnexus garde
  un pointeur. Le spec de contrat Phase 2 reste dans gitnexus (historique).

### Alternatives considérées
- **Mécanisme seul, registre différé** — écarté (choix utilisateur : vision
  complète maintenant).
- **Registre central tout-en-un** (specs de chaque repo DANS le registre) — écarté :
  couple le repo central à la structure interne de chaque repo. Préféré : registre
  fin + config par repo (séparation nette).
- **gitnexus en wrappers minces vers le central** (option B-i/ii) — écarté : casse
  l'opérabilité autonome de gitnexus (dépendance au repo frère à l'exécution).
- **YAML** — écarté : ajoute un parser ; JSON est Node-natif et suffit.

## 4. Scope boundaries (Phase 3)

**Dans le périmètre :**
- Le dépôt `fork-cohabitation` (scaffolding, git init, identité, README/CLAUDE/LICENSE).
- Outil générique config-driven : `config.mjs`, `registry.mjs`, `drift.mjs`,
  `release-watch.mjs`, `bump.mjs`, `bin/cohabit.mjs`, tests unitaires.
- Registre `repos.json` + orchestration `watch --all` / `--due`.
- gitnexus : `cohabitation.config.json`, entrée registre, test de parité, gel +
  doc des scripts gelés, déménagement du contrat générique + pointeur.

**Hors périmètre — différé :**
- Déclencheur planifié réel (cron / `/schedule`) appelant `--due` périodiquement.
- Suppression des scripts gitnexus (consolidation) — conditionnée, pas maintenant.
- Onboarding d'un 2ᵉ repo réel (validera le registre/tiers avec N>1).
- UI / dashboard du parc multi-repo.

## 5. Open questions

- **Cutover de gitnexus** : à quelle condition exacte retire-t-on les scripts gelés
  au profit du seul outil central ? (proposé : après onboarding d'un 2ᵉ repo, ou
  décision explicite d'accepter la dépendance.) À trancher plus tard.
- **Sémantique fine de `cadence`** : intervalles nommés (`daily`/`weekly`/`monthly`)
  vs durée ISO 8601. Proposé : noms simples mappés à des jours ; affiner si besoin.
- **Localisation du contrat générique** : il déménage dans `fork-cohabitation` ;
  reste à décider s'il garde une trace dans gitnexus au-delà d'un pointeur.

## Vérification

- **Outil générique** correct si, pour gitnexus, `cohabit drift gitnexus` /
  `cohabit watch gitnexus` produisent le **même verdict** que les scripts gitnexus
  locaux (test de parité §3.5.2).
- **Registre/orchestration** correct si `watch --all` itère les entrées et
  `watch --due` ne sélectionne que les repos dont la cadence est échue (testable
  avec un `now` injecté + un `repos.json` de fixture).
- **Fonctions pures** (config/registry/semver/diff) couvertes en unit tests, comme
  les Phases 1-2.
- **gitnexus inchangé fonctionnellement** : ses 3 scripts gelés passent toujours
  (smoke + leurs unit tests existants restent verts).
