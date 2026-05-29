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

---

## Update 2026-05-29 — Plan 3 (C) livré ; chantier commit-level time-travel COMPLET

**Plan 3 (C — pré-chauffage des diffs)** livré : `docker-server-prewarm.mjs`.
- **On-push** : la cron `watches` appelle `maybePrewarmRepo` par repo (opt-in
  `.gitnexus.json > incremental.preWarm` + `preWarmCommits`, défaut 50). Génère
  les diffs manquants des N derniers commits via `/snapshot/incremental`, avec
  un **cap par tick** (`PREWARM_PER_TICK`, défaut 5) + garde anti-overlap
  (`_inflight`) pour éviter une backfill de 50×~50s d'un coup — ça s'étale sur
  les ticks.
- **On-era** : `POST /snapshot/prewarm?repo=&max=` (fire-and-forget, 202
  `{queued}`) déclenché par `Timeline.tsx` à l'entrée du mode Commits sur la
  plage chargée. `GET /snapshot/prewarm?repo=&max=` → `{total, warm, cold}`
  (état, read-only — sert le smoke + un éventuel indicateur).
- Même cache `.gitnexus/incremental/<sha>.json.gz` consommé par
  `/graph/at-commit`. `diffExists` (stat) skippe les diffs déjà présents (pas
  de re-analyze).

**Déviation mineure vs §3.4** : pas d'indicateur UI dédié pour le pré-chauffage
(fire-and-forget ; le bénéfice est des clics plus rapides). Le `GET` pollable
existe si on veut en ajouter un plus tard.

**Le chantier commit-level time-travel (A + B + C) est désormais complet.**

**Vérification** : build Docker (compile gate) + smoke (`GET` 200 / `POST` 202)
+ tests d'intégration différés (Node 21 < 22).

---

## Update 2026-05-29 — Itération post-vérif : densité, fenêtre, ancre-era, feedback pré-chauffage

La **vérification navigateur** (Playwright) du mode Commits a confirmé A/B/C
fonctionnels mais a révélé un accroc UX (densité) + des coins MVP. Cette
itération pousse 4 items (#1, #2, #4, #6 de l'inventaire post-vérif).

### #1 + #2 — Dots-commits passés dans la machinerie de zoom (densité + fenêtre)

**Problème** : en mode Commits, les ≤200 commits chargés sont rendus comme dots
sur toute la barre, **indépendamment** du zoom/curseurs → chevauchement,
mé-clic (Playwright a dû `force`). Le `visiblePoints`/wheel-zoom existant ne
s'applique qu'aux snapshots.

**Réalité découverte à la 2e vérif navigateur (livré)** : le cap (60) +
filtrage-fenêtre étaient nécessaires mais **insuffisants** — la cause racine est
que la **barre de scrub partage sa ligne avec une grosse barre d'outils**
(~16 contrôles) qui déborde la largeur → la barre était écrasée à ~50px (dots à
0 px d'écart, voire hors-écran), **incliquables quel que soit leur nombre**.
**Fix complémentaire livré** : `flex-wrap` sur la ligne timeline + la barre passe
en **pleine largeur sur sa propre ligne en mode Commits** (`w-full basis-full`).
Vérifié : 60 dots à ~32 px d'écart, cliquables **sans `force`**. Le "+N cluster"
évoqué ci-dessous a été simplifié en cap+échantillonnage (le wheel-zoom EST le
mécanisme de drill-down).

**Décision** : router les dots-commits par la **même fenêtre [cursorA, cursorB]**
que les snapshots —
- filtrer `commits` par date à la fenêtre effective (comme `visiblePoints`),
- les espacer sur la barre filtrée (comme `positionFor`),
- **zoomer (molette) les éclaircit** naturellement (réutilise le pipeline
  zoom/curseurs déjà câblé — lecture seule de `cursorA/cursorB/zoomWindow`),
- garde d'**espacement minimal** : si la fenêtre contient encore trop de
  commits pour la largeur, regrouper le surplus en dot **"+N"** (clic → zoom
  sur ce sous-segment) plutôt que d'empiler des dots incliquables.

Livre #1 (densité) **et** #2 ("borné à la fenêtre visible") ensemble. Filtrage
client-side sur le set déjà fetché (pas de refetch tant que la fenêtre ⊆ 200
derniers ; au-delà, refetch `/commits?from=&to=`).

### #4 — Ancre du baseline = plus vieux commit de la fenêtre (pas le commit cliqué)

**Problème** : `seedBaseline(sha)` seede un baseline **au commit cliqué**
(snapshot exact, distance 0). Ce commit-là devient reconstructible, mais ses
voisins re-déclenchent seed/lazy → cliquer dans une era reste coûteux.

**Décision** : seeder le baseline au **plus vieux commit de la fenêtre visible**
(bord gauche `[cursorA]`). Alors **toute la fenêtre** = baseline(oldest) + replay
des diffs vers l'avant → navigable d'un **seul seed** (combiné au pré-chauffage
on-era de la pièce C qui chauffe la fenêtre). Colle au modèle "era".

**Alternatives écartées** : *commit cliqué* (= MVP actuel, ne couvre pas les
voisins) ; *1er commit du repo* (replay de milliers de diffs → lent + storage).

### #6 — Feedback de pré-chauffage (surfacer l'état warm/cold)

**Problème** : le pré-chauffage est fire-and-forget ; `GET /snapshot/prewarm`
`{total,warm,cold}` n'est pas affiché → l'utilisateur ne sait pas quand le scrub
devient instantané.

**Décision** : petit indicateur dans le mode Commits (près du toggle) — `"{warm}/{total}
chauds"` — alimenté par un poll de `GET /snapshot/prewarm` (à l'entrée + après
le fire on-era + cadence légère pendant le chauffage). Pur frontend (backend
déjà prêt).

### Hors scope de cette itération
- #3 (curseurs A/B + Compare A↔B + Play **sur les commits**) — reste snapshots-only.
- #5 (fidélité mixed-filters au-delà du badge), #7 (cadence cron 5/tick).
- #8 (**tests host bloqués Node 21 < 22**) — reste le plus gros trou de
  vérification ; cette itération sera vérifiée comme les précédentes (build
  Docker + smoke + Playwright).

---

## Update 2026-05-29 (suite) — Itération #3 / #5 / #7

Après la densité (#1#2#4#6, livrée + vérifiée), on pousse les 3 coins MVP
restants identifiés à la vérif.

### #7 — Cadence de pré-chauffage configurable (petit)

**Problème** : `PER_TICK_CAP` (env `PREWARM_PER_TICK`, défaut 5) limite le cron à
5 diffs/tick (~5 min) → backfill d'une grosse era = beaucoup de ticks.

**Décision** : exposer **`.gitnexus.json > incremental.preWarmPerTick`** (défaut
remonté à **10**, borné [1, 100]) consommé par `maybePrewarmRepo` (priorité :
config > env > défaut). Pure config + 1 ligne d'usage. Pas de boucle dédiée
(l'on-era POST cap=max couvre déjà le "tout chauffer maintenant").

### #5 — Fidélité mixed-filters : dire CE QUI manque (moyen)

**Problème** : la reconstruction calcule `filterConsistency` ('consistent' |
'MIXED') et le front affiche un simple badge "mixed filters" — sans dire quels
symboles manquent.

**Décision** : `GET /graph/at-commit` retourne, en plus, l'**union des labels /
types de relations exclus** sur la chaîne de diffs rejouée
(`droppedLabels: string[]`, `droppedRelTypes: string[]`) — dérivée des
`_meta.filters.includeLabels` / `includeRelationshipTypes` de chaque diff (un
`includeLabels` non-null signifie "tout le reste est dropé" → on accumule le
complément observé). Le bandeau de reconstruction liste alors explicitement
"reconstruction omet : Variable, Const…" au lieu d'un badge opaque. Backend
(`docker-server-snapshot-incremental.mjs`) + bandeau front
(`EntropyCommitTimeline` + chip Timeline). Pas de 422 (on informe, on ne bloque
pas — moins frustrant ; l'utilisateur voit la lossy et décide).

### #3 — Curseurs A/B + Compare A↔B + Play **sur les commits** (gros)

**Problème** : curseurs, Compare A↔B (`graphMode:'diff'`) et Play ne marchent que
sur les **snapshots** (`points` + `switchRepo`). En mode Commits, A/B ne servent
qu'à borner la fenêtre (#2).

**Décision — unifier A/B comme bornes de fenêtre ET endpoints de Compare** (résout
le conflit de sémantique que #2 a introduit) :
- **Curseurs** : en mode Commits, le drag des triangles A/B **snappe aux commits**
  (date du commit le plus proche dans `windowedCommits`) au lieu des snapshots.
  A/B = bornes de la fenêtre **et** points de comparaison — même objet, pas de
  conflit.
- **Compare A↔B** : nouvelle action `compareCommits(shaA, shaB)` dans `useAppState`
  qui reconstruit le graphe à A **et** à B (`/graph/at-commit` ×2), calcule
  `computeGraphDiff(graphA, graphB)` (réutilise le lib `graph-diff` existant) et
  pose `diffData` + `diffMode` (labels "A @<shaA>" / "B @<shaB>" pour le
  DiffBanner). Le toggle "Compare A↔B" route vers `compareCommits(cursorA→commit,
  cursorB→commit)` en mode Commits (vs `enterDiffMode` snapshot sinon).
- **Play** : en mode Commits, Play parcourt `windowedCommits` (oldest→newest) via
  `loadGraphAtCommit` avec le `FRAME_DELAY_MS` existant ; s'appuie sur le
  pré-chauffage (frame instantanée si le diff est chaud, sinon lazy plus lent —
  un commit froid ne bloque pas la boucle, il prend juste son temps). Réutilise
  le bouton Play (branche sur `navMode`).

**Alternatives écartées** : curseurs séparés window-vs-compare (2 paires de
triangles → confus) ; Compare via diff des deltas incrémentaux directement (plus
"pur" mais nécessite un nouveau chemin de diff ; reconstruire+`graph-diff`
réutilise tout l'existant, coût = 2 reconstructions in-memory, acceptable).

**Risque** : Compare-commits = 2 reconstructions (baseline + replay ×2) — peut
être lent si froid ; mitigé par le pré-chauffage (#C) + le fait que A/B sont
souvent déjà visités. Play sur une era froide est lent à la 1ʳᵉ passe (idem).

### Vérification
Build Docker (compile gate) + Playwright (Compare A↔B sur 2 commits → DiffBanner +
coloring ; Play en mode Commits avance les frames ; `droppedLabels` surfacé).
Tests composant/unit écrits, exécution différée (#8, Node 21 < 22).
