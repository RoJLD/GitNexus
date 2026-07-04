# Registry-Aware Explorer UX — Brainstorm (EN COURS, à reprendre)

> **Statut : BRAINSTORM EN PAUSE.** Reprendre à l'étape « proposer 2-3 approches → présenter le design par sections → écrire le spec final ». Ce document capture la demande + la direction validée + les questions ouvertes pour qu'une session future reprenne sans re-découvrir.

## Demande (robla)
Faire de gitnexus (son fork) le **visualiseur du registre de graphes/lentilles/familles** du cerveau ELYSIUM, **avec toute la polish de l'UX gitnexus originale** — PAS un layout nu.

**Ce qui a mal tourné (à ne PAS refaire) :** j'ai « fini » le stub `?multigraph=1` (sidebar nue + canvas Sigma brut) → **hideux, pire que gitnexus original**, court-circuite tout le chrome (header, search, Filters, Force/Sequential/Radial, panels). **Le layout `?multigraph=1` est à ABANDONNER** (commit fork `e3337fd` à revert). Le **backend** (passerelle `/api/repos` + `/api/graph` + taxonomie family/graph_type) est **parfait, à garder** (PR #452).

## Direction validée par robla
- Le principe **registre / lentilles / familles** = parfait.
- Il veut **TOUTES** ces surfaces (« tout cela ») portant la navigation familles→lentilles→graphe, **dans l'explorer poli** :
  1. **Switcher header groupé par famille** — le dropdown « sigil ▾ » devient un menu groupé (META/DOCTRINE/PROCESS/LATTICE → lentilles) + recherche. Changement rapide sans quitter l'explorer.
  2. **Onboarding (RepoLanding) groupé par famille** — les cartes stylées groupées en sections de famille + badge type. Galerie d'entrée du registre.
  3. **Rail gauche = arbre familles→lentilles** — le panneau Explorer devient l'arbre du registre (familles pliables → lentilles), toujours visible, clic pour charger.
  4. **Master-graph comme carte d'entrée** — `inter_graph` en vue d'accueil : les graphes sont des nœuds cliquables (+ liens InterGraphRel) ; clic sur un nœud-graphe → plonge dans la lentille. La navigation EST un graphe (« la carte des cartes »).

## Fondation commune (toutes les surfaces la consomment)
Un **modèle de registre côté frontend** : hook/service qui fetch `/api/repos` (déjà servi avec `family` + `graph_type`) → groupe par famille → expose aux 4 surfaces. Une seule source, 4 renderers. (Cohérent BGG-1 : la passerelle possède le contrat, le frontend le présente.)

## Baseline UX confirmée (ne PAS diverger de ça)
Ton fork tourne (branche `feat/classdiagram-export-and-class-lens`, upstream v1.6.7, toutes tes couches). L'explorer poli = header (switcher lentille, Search ⌘K, compteurs, Nexus AI) + rail gauche (Explorer/Filters, arbre) + canvas (Force/Sequential/Radial, zoom/fit, Query) + footer. Screenshots session : `.playwright-mcp/fork-full-explorer.png`, `fork-normal-picker.png`.

## Questions ouvertes (à trancher à la reprise)
1. **Master-graph node→lens mapping** : `inter_graph` a **13 GraphRegistryNode** (ASTKG, Forge, tech_genealogy, body_map…) MAIS `/api/repos` n'expose que **5 lentilles curées** (inter_graph, sigil, workflow, health×2). Pour rendre les nœuds du master-graph cliquables-vers-une-lentille il faut résoudre ce décalage : (a) exposer tous les graphes enregistrés comme lentilles, (b) rendre cliquable seulement si une lentille existe, (c) différer la carte master-graph.
2. **Échelle** : 5 lentilles maintenant, >100 / 9 familles à terme → la recherche/collapse dans le switcher + rail devient obligatoire à l'échelle. Concevoir pour 100+.
3. **Séquencement** : quelle surface livrer en 1ère (ROI/risque) ? Candidat : switcher header groupé (le plus natif, le moins risqué) → onboarding groupé → rail arbre → master-graph carte (le plus complexe, dépend de Q1).
4. **Maquettes visuelles** : offre du companion visuel faite ; robla a préféré **voir l'interface réelle** d'abord. À la reprise : maquetter les 4 surfaces (compagnon visuel ou dans l'app) avant de coder.

## Discipline fork (rappel avant de coder)
Toute édition `upstream/` → régénérer `patches/{additive,inplace}-edits.diff` (via l'exclude `nul`/`*.rej` dans `.git/info/exclude`) + `node scripts/check-patch-drift.mjs` (exit 0) + commit identité `roblastar@live.fr`. Mettre à jour ROADMAP.md + INVENTORY.md. Le stub multigraph (`?multigraph=1`, `CanvasMultigraph`, `GraphSidebar`, `MultigraphLoader`) est à revert/abandonner.

## Runbook démo live (pour re-voir l'interface)
```bash
# 1) Passerelle brain-graph sur le port défaut 4747 (depuis le worktree gitnexus-render)
cd .claude/worktrees/gitnexus-render
python scripts/governance/sigma_brain_graph_gateway.py --host 127.0.0.1 --port 4747 --db data/governance/inter_graph.kuzu
# 2) Frontend fork (Vite dev) — patches déjà appliqués au clone
cd ingestion/GitNexus/upstream/gitnexus-web && npm run dev   # http://localhost:5173
# 3) Ouvrir : http://localhost:5173/  (onboarding poli) OU /?project=sigil&server=http://localhost:4747 (explorer)
```
Note : App.tsx WIP multigraph original toujours **stashé** dans `upstream/` (`git stash list`).

## Prochaine étape à la reprise
Reprendre la skill brainstorming à « propose 2-3 approaches » → présenter le design par sections (fondation registre + 4 surfaces + résolution Q1) → écrire le spec final → writing-plans.
