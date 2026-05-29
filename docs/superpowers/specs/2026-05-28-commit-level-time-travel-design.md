# Commit-level time-travel — mode Commits timeline + baseline auto-seed + pré-chauffage

**Date** : 2026-05-28
**Status** : current (design validé en brainstorm, plan à écrire)
**Auteur** : Robin DENIS (design + brainstorm Claude Opus 4.7)
**Parent** : [`2026-05-26-incremental-snapshots-phase-c-design.md`](2026-05-26-incremental-snapshots-phase-c-design.md) — le moteur de reconstruction (`/graph/at-commit`) y est déjà livré + benché. Ce spec **complète** la Phase C (baseline rebuild auto + cron on-push, restés "à faire") et ajoute la **couche UX timeline**.

---

## 1. Contexte / problème

- La timeline principale ([Timeline.tsx](../../../upstream/gitnexus-web/src/components/Timeline.tsx)) n'affiche que les **snapshots** + le live. Cliquer un point appelle `switchRepo` → **download du graphe complet** → fenêtre « Downloading graph… » entre chaque phase.
- Un snapshot = un `analyze` complet (~3-5 min, plusieurs MB), créé délibérément (Phase A/B + bulk).
- La **Phase C a livré le moteur** de reconstruction par-commit : `GET /graph/at-commit` (baseline + replay de deltas, fidélité structurelle 100%, ~40 KB/commit, in-memory, **sans overlay**). **Mais** :
  - il n'est exposé que dans le drill-down **"Commit Δ"** ([EntropyCommitTimeline.tsx](../../../upstream/gitnexus-web/src/components/EntropyCommitTimeline.tsx), bouton "Rebuild @ commit"), **un commit à la fois** ;
  - la **timeline principale l'ignore** ;
  - **baseline rebuild auto** + **cron on-push** = non livrés (notés "reste" dans le spec parent).
- Conséquence : impossible de naviguer commit-par-commit *légèrement* depuis la timeline principale ; l'utilisateur subit l'overlay full-download entre snapshots.

## 2. Goal

Naviguer **commit-par-commit, fluide et léger**, depuis la timeline principale. Les snapshots deviennent des **jalons / eras** (baselines délibérés) ; entre eux on scrube les commits via reconstruction in-memory (pas d'overlay). **Turnkey** : baselines auto-seedés en fond + diffs pré-chauffés, sans setup manuel.

## 3. Design

### 3.1 Modèle conceptuel à deux étages

| Étage | Quoi | Coût | Visibilité |
|---|---|---|---|
| **Jalon / era (snapshot)** | full graph délibéré (version/milestone), sert de **baseline** de reconstruction | lourd (~3-5 min) | visible (mode Snapshots) |
| **Baseline interne** | full graph auto-seedé quand aucun jalon ancêtre n'existe | lourd, une fois | **caché**, **promouvable** en jalon |
| **Commit** | reconstruction baseline + replay deltas via `/graph/at-commit` | léger (~40 KB) | mode Commits |

### 3.2 A — Mode "Commits" sur la timeline principale

**Décision** : un **toggle Snapshots ⇄ Commits** dans la barre Timeline.
- Mode **Snapshots** = comportement actuel (jalons + live ; clic = `switchRepo` full).
- Mode **Commits** : énumère les commits de la **fenêtre visible** (le wheel-zoom déjà codé borne la densité) ; chaque commit = un point ; **clic → `loadGraphAtCommit(sha)`** (déjà câblé dans [useAppState.tsx](../../../upstream/gitnexus-web/src/hooks/useAppState.tsx)) au lieu de `switchRepo`. Jalons cerclés + live restent visibles parmi les commits.

**Alternatives considérées** (maquettées) :
- **B — ticks de commits entre snapshots** : préserve l'actuel mais visuellement chargé, "trait vs point" ambigu.
- **C — curseur de granularité** (snapshots / hebdo / chaque commit) : scale, mais un contrôle de plus, moins direct.
- **D — zoom-to-reveal** (commits apparaissent en zoomant) : élégant et réutilise le zoom, mais par-commit caché tant que pas zoomé → moins découvrable.

**Pourquoi A** : le plus **découvrable** (mode explicite), et il se **combine** naturellement avec le wheel-zoom existant (zoomer en mode Commits gère la densité, absorbant l'idée de D). Cohérent avec le modèle "snapshots = jalons" : le toggle sépare clairement les deux étages.

**Fork d'implémentation (reco)** : source des commits = **nouvel endpoint léger `GET /commits?repo=&from=&to=&max=`** (git log, ~ms), plutôt que réutiliser `/entropy/commits` (calcule l'entropy, plus lourd, fenêtré par jours).

### 3.3 B — Baseline auto-seed (arrière-plan, caché, promouvable)

**Décision** :
- À l'entrée du mode Commits, si **aucun jalon n'est ancêtre** du plus vieux commit de la fenêtre → **seed d'un baseline en arrière-plan** (job SSE, réutilise le pattern de `/snapshot/bulk`). **Non-bloquant** : chip de progression dans la timeline, nav par-commit activée dès que le baseline est prêt ; l'utilisateur continue à bosser.
- Le baseline est marqué **`hidden`** → exclu du mode Snapshots et de [SnapshotsPanel.tsx](../../../upstream/gitnexus-web/src/components/SnapshotsPanel.tsx).
- Bouton **"Promouvoir en jalon"** → flip `hidden → false`.

**Alternatives considérées** :
- Visibilité : *vrai jalon visible* (simple mais mélange jalons intentionnels et baselines techniques) ; *caché strict* (propre mais rigide). → **hybride caché+promouvable** retenu : garde la liste de jalons délibérée tout en permettant d'élever un point devenu significatif.
- UX du seed : *bloquant overlay* (simple mais fait attendre) ; *paresseux par commit* (micro-attentes répétées). → **arrière-plan non-bloquant** retenu.

**Forks d'implémentation (reco)** :
- Flag `hidden: true` dans l'entrée registry du snapshot + filtrage dans `/snapshots` et le front. *(À valider en impl : `findNearestBaseline` doit continuer à voir les baselines cachés — `hidden` masque seulement l'UI, pas la reconstruction.)*
- Nouveaux endpoints `POST /snapshot/baseline-seed?repo=&commit=` (full analyze marqué hidden, en job) et `POST /snapshot/promote?repo=&commit=`.

### 3.4 C — Pré-chauffage des diffs

**Décision** : **les deux** sources, alimentant le même cache disque `.gitnexus/incremental/<sha>.json.gz` que `/graph/at-commit` consomme.
- **On-push** : la cron `watches` (qui détecte déjà les changements de HEAD pour l'auto-reindex) pré-génère les diffs des **N derniers commits** via `/snapshot/incremental`. **Opt-in par repo** : `.gitnexus.json > incremental { enabled, preWarmCommits }` (même pattern qu'`auto_reindex` / `auto_snapshot`).
- **On-era-entry** : à l'entrée du mode Commits, queue de génération en fond des diffs de la **plage visible** (non-bloquant).

**Alternatives considérées** : *on-push seul* (zone récente chaude, vieilles eras lazy) ; *on-era seul* (zéro compute tant qu'on n'explore pas, zone récente non pré-chaude). → **les deux** retenu pour une expérience réellement turnkey, l'utilisateur ayant accepté le compute en fond (cf. décision seed non-bloquant).

### 3.5 Surface backend / frontend

| | Réutilisé | Nouveau |
|---|---|---|
| **Backend** | `/graph/at-commit`, `/snapshot/incremental`, cron `watches` | `GET /commits`, `POST /snapshot/baseline-seed`, `POST /snapshot/promote`, extension cron pre-warm (opt-in `.gitnexus.json`) |
| **Frontend** | `loadGraphAtCommit` / `exitGraphAtCommit` | toggle mode Commits + rendu commits + chip seed/pre-warm + bouton promote dans `Timeline.tsx` ; trigger pre-warm-on-entry + seed dans `useAppState.tsx` |

## 4. Scope boundaries (hors scope)

- **Pas** de recompute Leiden par commit — les communities restent baseline-stale (déjà documenté §2.2 du spec parent).
- **Pas** de sync remote des diffs (git notes) — on garde JSON file-per-commit (v2 éventuel).
- **Pas** de renommage cosmétique global "snapshot" → "jalon/era" dans toute l'UI — le concept suffit ; un renommage est un chantier séparé.
- Mode Commits **borné à la fenêtre visible** — pas d'énumération de 10k commits d'un coup.
- **Pas** de purge automatique des diffs / vieux baselines (config purge = post-MVP, cf §4.4 parent).

## 5. Open questions

1. **Valeur par défaut de `preWarmCommits`** (50 ? avec cap dur comme `auto_snapshot` ?).
2. **Ancre du baseline auto-seed** : confirmer que "le plus vieux commit de la fenêtre" est le bon point (vs 1er commit du repo) — compromis distance-de-replay vs coût du seed.
3. **Représentation exacte du flag `hidden`** (entrée registry vs `meta.json`) — à trancher en lisant `docker-server-snapshots.mjs`.
4. **Dédup / lock** des jobs seed : éviter deux seeds baseline concurrents pour le même repo.
5. **Cohérence des filtres** sur la chaîne de diffs pré-chauffés (le `_meta.filters` doit rester homogène par repo, cf §3.bis parent) — le pre-warm doit utiliser le filtre par-repo configuré.

## 6. Tests (pyramide existante)

- **Unit** (`tests/unit/`) : parsing `/commits`, filtrage flag `hidden`, logique de la queue pre-warm.
- **Integration** (`tests/integration/endpoints/`) : shape `/commits` ; `promote` flippe la visibilité ; `baseline-seed` crée un snapshot `hidden` ; `/graph/at-commit` toujours 200 ; `/snapshots` n'expose pas les cachés.
- **Component** (`tests/unit/components/`) : toggle de mode, rendu mode Commits, bouton promote, chip de progression.
- **Smoke loop** (CLAUDE.md) : ajouter `/commits` + `/snapshot/promote`.

---

## Update 2026-05-29 — Plan 1 (A) + Plan 2 (B) livrés ; déviations d'implémentation

**Plan 1 (A — mode Commits timeline)** livré : endpoint `GET /commits`
(`docker-server-commits.mjs`) + toggle Snapshots⇄Commits dans `Timeline.tsx`
(clic commit → `loadGraphAtCommit`, fallback lazy sur diffs manquants).

**Plan 2 (B — baseline auto-seed)** livré, avec 3 déviations assumées vs le
design initial §3.3 (notées pour l'historique) :

1. **Flag caché = fichier sentinelle `.hidden`** dans le dossier du snapshot
   (pas de champ dans le registry ni `commit.json`). `handleListSnapshots`
   l'exclut par défaut, champ `hidden` + `?includeHidden=true`. `findNearestBaseline`
   inchangé (ne consulte pas le marqueur → voit tous les baselines).
2. **Seed = endpoint de statut *pollable*** (`GET /snapshot/baseline-seed/:jobId`
   → JSON `{state,phase}`), **pas SSE** comme suggéré en §3.3. Un chip de
   progression n'a besoin que de phases grossières ; évite de dupliquer la
   machinerie SSE de `/snapshot/bulk`. La job map est en mémoire (TTL 60s).
3. **Promote vit dans `SnapshotsPanel`** (sous-section "Internal baselines"),
   pas sur les dots de la timeline (maquette initiale). **Seed déclenché au
   clic** sur le 409 `needsBaseline` (`/graph/at-commit`), pas auto à l'entrée
   du mode — moins agressif, conforme à la décision "background non-bloquant".

**Vérification** (host vitest/vite bloqués par Node 21 < 22) : via build Docker
(porte de compilation) + smoke endpoints + tests d'intégration. Tests
composant écrits, exécution différée jusqu'à Node 22.

**Reste** : Plan 3 (C — pré-chauffage des diffs on-push + on-era-entry).
