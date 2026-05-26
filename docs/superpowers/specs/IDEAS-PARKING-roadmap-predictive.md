# Idées parquées — Sub-specs des 4 vues prédictives

> Issues de la session brainstorming du 2026-05-26 sur "ghost nodes /
> roadmap prédictive". Le CORE est brainstormé dans `2026-05-26-roadmap-predictive-core-design.md`.
> Les 4 sub-specs ci-dessous attendent leur propre brainstorm (un par
> session) une fois le CORE livré.

## Pré-requis commun

Toutes les vues consomment le CORE :
- Endpoint `GET /ghosts?repo=<base>` → liste les ghost nodes
- Endpoint `GET /ghosts/at?repo=<base>&commit=<sha>` → ghosts visibles à un commit donné (planifiés mais pas encore matérialisés)
- Endpoint `GET /ghost/:id` → métadonnées + liens vers nodes réels qui le matérialisent

## Sub-spec 2 — Audit view (regard arrière)

**Promesse** : "Voir l'écart entre prévisions et livraison."

**Premier pas** : Pour chaque ghost, tracer une ligne temporelle :
- `plannedAt` (commit qui a introduit le ghost dans ROADMAP.md)
- `materializedAt` (commit qui a livré le code matérialisant le ghost)
- `cancelledAt` (commit qui a explicitement retiré ou annulé le ghost)

Métriques dérivables :
- **Lead time moyen** : médiane de `materializedAt - plannedAt` sur tous les ghosts livrés.
- **Slippage** : sur les ghosts qui avaient une `deliveryWindow` annoncée, comparer attendu vs réel.
- **Cancellation rate** : ghosts annulés / total ghosts.
- **Plan churn** : ghosts qui ont vu leur description/scope changer plusieurs fois.

**UI** : `AuditPanel.tsx` — tableau triable + courbe "ghosts en attente" sur le temps.

**Endpoint dédié** : `GET /ghost-audit?repo=<base>` qui pré-calcule les stats.

## Sub-spec 3 — Augmented graph (regard avant, mixé dans le graph actuel)

**Promesse** : "Quand je regarde le graph d'aujourd'hui, les ghosts apparaissent en transparence là où ils s'intègreront."

**Premier pas** : Étendre le rendu Sigma actuel pour traiter les ghosts comme des nodes supplémentaires avec attribut `kind: "Ghost"`. Reducer Sigma : opacité 0.4, contour dashed, couleur par Tier.

Edges spéculatives : pour un ghost qui aura `links[]: ["upstream/docker-server-X.mjs"]`, on dessine un edge léger entre le ghost et le nœud File correspondant (si déjà créé) ou vers le futur emplacement (vide).

**Premier pas réaliste** : Toggle "Show ghosts" dans le panneau Filters. Quand activé, le graph est augmenté.

**UI** : nouveau toggle dans `Filters` + nouveau bouton de légende.

## Sub-spec 4 — Gantt opérationnel

**Promesse** : "Vue calendaire des features pass+présent+futur."

**Premier pas** : `GanttPanel.tsx`. Axe X = temps. Une ligne par ghost. Couleurs :
- Bar pleine : période de réalisation (`plannedAt` → `materializedAt`)
- Bar dashed : période prévue future (jusqu'à `deliveryWindow`)
- Bar grise : annulée

Lib SVG natif (suivre la pattern de `GrowthChart.tsx`) ou Vis.js Timeline si on accepte une dépendance.

Filtres : par Tier, par statut, par owner (si on a cette info).

## Sub-spec 5 — Brainstorm-hook (génération auto de ghosts)

**Promesse** : "Quand le skill `superpowers:brainstorming` valide une spec, un ghost est automatiquement ajouté à la roadmap prédictive du repo concerné."

**Premier pas** : Au moment où le skill brainstorming écrit `docs/superpowers/specs/YYYY-MM-DD-X-design.md` + commit, un hook post-commit (côté gitnexus ou côté Claude Code) :
1. Lit le frontmatter du spec (titre, tier, components prévus).
2. `POST /ghosts` avec les métadonnées.

Alternative plus simple : un script `scripts/add-ghost.mjs` que le skill appelle explicitement à la fin de la validation.

**Question ouverte** : faut-il un hook ou juste une convention manuelle (le user lance `npm run roadmap:add-ghost` après chaque spec) ?

## Sub-spec 5.bis — LLM-assisted materialization (extension du CORE)

**Promesse** : "Un agent LLM lit le diff de chaque commit et propose
proactivement de matérialiser les ghosts pertinents."

**Premier pas** : à invoquer si le hybride manuel ✅ + suggestion auto
ne suffit pas (typiquement si les paths attendus ne matchent pas, ou si
beaucoup de commits sont mal classifiés).

**Mécanisme proposé** : commande optionnelle `npm run ghosts:llm-detect`
qui lit les ghosts non-matérialisés + les N derniers commits + leurs
diffs, demande au LLM "ce commit matérialise-t-il un de ces ghosts ?",
collecte les suggestions et propose au user.

**À garder Tier 2 / extension du CORE** une fois les premières vues
livrées et qu'on mesure la friction du marquage manuel.

## Sub-spec 5.ter — Cleanup à expiration + multi-tool connectors (livré comme spec)

**Status** : ✅ Spec rédigée — voir [`2026-05-26-roadmap-predictive-cleanup-and-connectors-design.md`](2026-05-26-roadmap-predictive-cleanup-and-connectors-design.md)

Issue de la [review externe Gemini](2026-05-26-ghost-nodes-external-review.md). Couvre :
- Détection automatique des ghosts `expired` (`now > expectedBy + grace_period`)
- LLM cleanup prompt (reaffirm / cancel / ship-as-other) avec confirmation user
- Connecteurs vers tools de ticketing : **Plane primary** (impl complète v1), Linear / GitHub Issues / Jira (framework + stubs)
- Plugin-aware via `registerGhostSource()` du CORE (cf Update sur CORE spec)

**Effort** : ~3.5 jours.

## Sub-spec 6 (bonus, non-discuté en brainstorm initial mais à considérer)

**SysML / diagrammes systémiques** : export du graph augmenté en SysML (blocks pour nodes réels, requirements pour ghosts, satisfy edges pour matérialisation). Permet d'utiliser le graph dans des outils d'ingénierie système (Capella, Cameo, etc.). À évaluer après les 4 vues — c'est davantage un export qu'une vue interactive.

## Ordre d'exécution suggéré (révisé après review externe)

1. **CORE** (avec Update : `expectedBy` mandatory + plugin registry — ~3.5j)
2. **Audit view** (avec Update : 6ème métrique `expired` — ~5.8j)
3. **Augmented graph** (avec Update : time-decay opacity — ~3.3j)
4. **Cleanup + multi-tool connectors** (cf Sub-spec 5.ter — ~3.5j)
   - Pré-requis : CORE + Audit + Augmented graph livrés pour avoir les hooks UI
5. **Brainstorm-hook** (~2.5j)
6. **Gantt** (avec Update : time-decay bar color — ~3.2j)
7. **SysML** (si demandé — bonus, à brainstormer)

**Total cumulé** : ~21.8 jours (vs ~16-18j avant les Updates de la review externe).
