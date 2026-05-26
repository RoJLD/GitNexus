# Ghost Nodes / Roadmap Prédictive — Review externe (Gemini brainstorm + analyse)

**Date** : 2026-05-26
**Source** : Brainstorm Gemini partagé par l'utilisateur dans la session principale ROADMAP/INVENTORY/bump v1.6.5
**Statut** : Notes de review à passer à la session parallèle qui instruit le CORE + sub-specs
**Docs liés** :
- [`2026-05-26-roadmap-predictive-core-design.md`](2026-05-26-roadmap-predictive-core-design.md) — CORE en cours
- [`IDEAS-PARKING-roadmap-predictive.md`](IDEAS-PARKING-roadmap-predictive.md) — 6 sub-specs déjà parquées (Audit, Augmented graph, Gantt, Brainstorm-hook, LLM-materialization, SysML)

---

## TL;DR — verdict en 1 ligne

Gemini propose une vision "Ghost Nodes / Roadmap Fantôme" dont **~70% map sur des features GitNexus déjà livrées ou en cours d'instruction**. Les 30% restants sont les vrais deltas — et la **question finale qu'il pose (tickets vs graph-only)** est une fausse dichotomie : il existe une **3e option** alignée sur le pattern qu'on a déjà adopté pour `.gitnexus-domains.yaml` et `.gitnexus-policy.yaml`.

---

## Mapping ligne par ligne — Gemini vs ce qu'on a déjà

| Pitch Gemini | Notre équivalent existant | Statut |
|---|---|---|
| **§1 Cycle de vie** : intention → influence → matérialisation → dérive | "Influence" = handwave non-actionnable. Les 3 autres = visualisations, pas un vrai lifecycle. La session parallèle l'a déjà mieux discrétisé (`plannedAt` / `materializedAt` / `cancelledAt`) | Concept flou côté Gemini, mieux côté CORE |
| **§1 Matérialisation** (premier commit solidifie le fantôme) | Diff visuel rouge/vert/gris (déjà livré #3 du ROADMAP) + sub-spec 2 Audit view (lead time) couvre ça | ✅ + en cours |
| **§1 Dérive** (lien rouge réel ↔ planifié) | Tier 2.2 Dissonance — même logique à granularité cluster/fichier ; à étendre granularité node pour ghosts | ✅ (à étendre) |
| **§2 "Gantt Structurel"** (Y=topologie, slider temporel) | Timeline play/pause (#7) + Galaxie UMAP 2.6 + sub-spec 4 Gantt opérationnel à venir | ✅ + en cours |
| **§3 C4 → GitNexus pour diagrammes de composants** | Tree-sitter parse déjà les composants ; graphe Sigma = le diagramme. Comparaison vs design = Dissonance | ✅ (sans le mot "C4") |
| **§3 SysML export** | Sub-spec 6 (bonus dans IDEAS-PARKING) | ⏳ déjà parqué |
| **§4 Brainstorm-as-graph-injection** | Sub-spec 5 Brainstorm-hook + Tier 2.3 What-if simulator (livré) + Tier 3.7 AI-guided tour (planifié) | ✅ + en cours |
| **§5 Étape A — manifest standard** | `.gitnexus-domains.yaml` (Tier 2.2 ✅) + `.gitnexus.yaml` unifié (Tier 2bis.4 — en cours dans la session parallèle) | ✅ + en cours |
| **§5 Étape B — overlay nodes transparents Sigma** | **🆕 Sub-spec 3 Augmented graph** — exactement ça, déjà bien décrit (opacité 0.4, contour dashed, couleur par Tier) | ⏳ |
| **§5 Étape C — Delta Engine** | `graph-diff.ts` (déjà livré pour diff entre 2 repos), à étendre à "diff réel vs planifié" | Quasi-livré |

**Conclusion** : Gemini ne propose presque rien que la session parallèle n'ait pas déjà mieux structuré. Le vrai apport de cette review = la 3e option sur l'obsolescence + le warning architectural.

---

## Les vrais deltas que Gemini apporte

Trois choses que la review parallèle peut intégrer ou re-débattre :

### 1. Un format `.gitnexus-roadmap.yaml` séparé de `.gitnexus-domains.yaml`

Gemini propose un **manifest distinct** pour les nodes planifiés (vs `domains.yaml` qui partitionne les nodes existants). C'est sémantiquement justifié :
- `domains.yaml` = "classification des nodes qui existent"
- `roadmap.yaml` = "promesse de nodes qui n'existent pas encore"

**Question pour la session parallèle** : le CORE prévoit-il un manifest distinct, ou un append à `.gitnexus.yaml` (cohérent avec le 2bis.4 unifié) ?

Format suggéré (à challenger) :
```yaml
planned:
  - id: "AuthService::validateUser"
    type: "Function"
    cluster: "auth"
    plannedAt: "2026-05-26"
    expectedBy: "2026-Q3"     # ← clé pour la 3e option ci-dessous
    tier: "2bis.4"
    relations:
      - { type: "CALLS", to: "DB::usersTable" }
```

### 2. Visual decay au lieu de visual binary

Sub-spec 3 (Augmented graph) prévoit opacité fixe 0.4 pour les ghosts. **Variante à considérer** : opacité fonction du temps écoulé depuis `plannedAt`.
- `now - plannedAt < expectedBy/2` → opacité 0.4 (frais, à livrer)
- `now > expectedBy` → opacité 0.2 + contour orange (en retard, à reaffirmer)
- `now > expectedBy + 1 mois` → opacité 0.1 + contour rouge (slippage critique)

Donne une **pression visuelle naturelle** sans alerting actif.

### 3. La 3e option sur la question d'obsolescence (la plus importante)

Gemini pose la dichotomie :
> "Voudrais-tu que ce système de nœuds fantômes soit couplé directement à tes tickets GitHub/Jira (pour qu'un nœud fantôme disparaisse automatiquement s'il est marqué 'obsolète' dans le tracker) ou préfères-tu que le graphe soit la seule source de vérité ?"

**Les deux sont mauvais** :
- **Tickets** : Jira/GitHub issues sont notoirement *stale*. La moitié des tickets ouverts sont morts. Coupler ghost nodes à ça = importer leur staleness dans le graph. Pire : les tickets ne mappent pas naturellement aux nodes architecturaux ("fix bug X" n'est pas un node).
- **Graph-only manuel** : ghost nodes restent quand le scope change. Devient archéologique en 3 mois.

**3e option (la bonne)** — alignée sur les patterns déjà adoptés pour `.gitnexus-domains.yaml` et `.gitnexus-policy.yaml` :

1. **Déclaratif YAML committé au repo** (single source of truth)
2. **Expiration explicite obligatoire** (`expectedBy` n'est pas optionnel)
3. **Décroissance visuelle** (cf delta #2 ci-dessus) — pas d'alerte active, pression naturelle par UI
4. **LLM-assisted cleanup** à `expectedBy + N` : "Tu avais planifié X pour Q1, on est en Q3, prompt = reaffirmer / supprimer / acter"
5. **Hook optionnel ticketing** (Linear/GitHub/Jira) qui peut **suggérer** des matérialisations mais ne **commande** rien — éviter l'importation de staleness externe

**Cette option est compatible avec sub-spec 5 (Brainstorm-hook) et sub-spec 5.bis (LLM-materialization) déjà parquées** — elle ne les remplace pas, elle complète avec le côté "cleanup à expiration".

---

## Warning architectural

On a inscrit dans le ROADMAP la section **"🚨 Refactos structurels à surveiller"** dont la 1ère ligne :
> "Pas de méta-architecture analytics → chaque nouvelle métrique = 5 fichiers à toucher → 25+ analytics nous tuent"

**Ghost Nodes / Roadmap prédictive risque d'être exactement le pattern qu'on s'est promis d'éviter** : une feature horizontale qui touche backend (`/ghosts` endpoint), frontend (4 panels : Audit, Augmented graph, Gantt, possibly SysML), config (manifest), et lifecycle (Brainstorm-hook). Soit ~10 fichiers à toucher.

**Recommandation forte** : avant de livrer le CORE Ghost Nodes, livrer ou pré-câbler **Tier 3.10 (Plugin architecture pour analytics)** du ROADMAP. Ghost Nodes devient alors un plugin :
- 1 plugin déclaratif `ghosts.mjs` exposant `{ name, inputs, outputSchema, ui, mcpExposure }`
- 1 plugin Sigma reducer (overlay transparent)
- 1 plugin scorer (delta engine planifié vs réel)

Au lieu de 10 fichiers monolithiques.

**À débattre dans la session parallèle** : est-ce que le CORE peut être conçu comme **plugin-first** dès le départ, même si Tier 3.10 n'est pas encore livré ? (Ça pré-positionne sans bloquer.)

---

## Points spécifiques à challenger avec la session parallèle

Quand cette review est lue par eux, voici les questions précises auxquelles ils peuvent répondre :

1. **Manifest** : 1 fichier `.gitnexus-roadmap.yaml` distinct, OU une section `roadmap:` dans `.gitnexus.yaml` unifié (2bis.4) ?
2. **Visual decay** : opacité fixe (sub-spec 3 actuel) ou opacité fonction de `(now - plannedAt) / expectedBy` ?
3. **Obsolescence** : ils prévoient quoi pour les ghosts qui dépassent `expectedBy` ? Auto-flag visuel + LLM prompt, ou rien (manuel) ?
4. **Plugin-first** : est-il possible de concevoir le CORE comme plugin (anticipant 3.10) sans coût supplémentaire ?
5. **Granularité node vs cluster** : Dissonance (Tier 2.2) travaille au niveau cluster. Ghost Nodes travaillerait au niveau node. Faut-il un "Ghost Cluster" intermédiaire ?

---

## Liens vers contexte original

- **Brainstorm Gemini complet** : message utilisateur dans la conversation principale du 2026-05-26 (voir transcript de la session "ROADMAP + bump v1.6.5")
- **Mon analyse complète** : même conversation, message juste avant la sauvegarde de ce doc
- **Sub-specs existantes** : [`IDEAS-PARKING-roadmap-predictive.md`](IDEAS-PARKING-roadmap-predictive.md)
- **CORE design en cours** : [`2026-05-26-roadmap-predictive-core-design.md`](2026-05-26-roadmap-predictive-core-design.md)
