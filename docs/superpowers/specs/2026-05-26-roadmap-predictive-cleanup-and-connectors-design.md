# Roadmap Predictive — Cleanup & Multi-tool Connectors design

**Date** : 2026-05-26
**Status** : current
**Auteur** : Robin DENIS (review externe Gemini + brainstorm Claude Opus 4.7)
**Depends on** :
- [`2026-05-26-roadmap-predictive-core-design.md`](2026-05-26-roadmap-predictive-core-design.md) (CORE + Update sur `expectedBy` mandatory)
- [`2026-05-26-roadmap-predictive-audit-design.md`](2026-05-26-roadmap-predictive-audit-design.md) (Audit + Update sur `expired` metric)
**Trigger** : [`2026-05-26-ghost-nodes-external-review.md`](2026-05-26-ghost-nodes-external-review.md) — review externe Gemini (3e option d'obsolescence)

---

## 1. Context / problem

Les 5 sous-specs initiales (CORE, Audit, Augmented graph, Brainstorm-hook, Gantt) couvrent la mécanique des ghosts (création, matérialisation, visualisation) mais **ne traitent pas le cycle de vie complet** :
- Que se passe-t-il quand un ghost dépasse son `expectedBy` ?
- Qui décide qu'un ghost devient obsolète ?
- Doit-on importer des informations externes (tickets Plane, Linear, GitHub) ?

La review externe a démonté la dichotomie "tickets vs graph-only" :
- Tickets coupling → importe la staleness des trackers (50% des tickets ouverts sont morts)
- Graph-only manuel → ghosts archéologiques en 3 mois sans pression visuelle

La **3e option** est : YAML déclaratif comme source de vérité, `expectedBy` obligatoire, décroissance visuelle temporelle (cf Updates sur Augmented graph + Gantt), **LLM-assisted cleanup à expiration**, et **hook ticketing optionnel** qui suggère (sans commander) des matérialisations.

## 2. Goal

Livrer deux mécanismes complémentaires :

1. **Cleanup à expiration** : endpoint `POST /ghosts/cleanup-prompt?repo=X` qui détecte les ghosts dépassant `expectedBy + grace_period`, et propose une action LLM-assisted (reaffirmer / supprimer / acter comme livré). UI dans le panel Audit existant + bouton "Run cleanup".

2. **Multi-tool connector** : adapter framework qui peut lire des tickets/issues depuis Plane (primary), Linear, GitHub Issues, Jira (genericized) pour **suggérer** des matérialisations ou reaffirmer des `expectedBy`. Plugin-aware registry du CORE est utilisé pour brancher chaque connecteur.

Les deux mécanismes sont **opt-in** : un projet sans LLM clé d'API ou sans tickets fonctionne normalement, ghosts sont marqués `expired` mais le prompt LLM n'apparaît pas et aucun ticket n'est lu.

## 3. Design

### 3.1 Alternatives considérées

| Alternative | Pourquoi écartée |
|---|---|
| Couplage direct aux tickets (ticket close → ghost matérialisé) | Importe la staleness ; pas la bonne sémantique (un ticket close peut être "won't fix") |
| Graph-only manuel sans expiration | Pas de pression naturelle → archéologie en 3 mois |
| Hook ticket dans le CORE | Pollue le CORE lean ; obligation pour tout le monde alors que c'est opt-in |
| Connecteur unique pour Plane uniquement | Verrouillage prematuré ; l'user utilise Plane aujourd'hui mais peut migrer |
| LLM cleanup forcé à chaque sync | Coût tokens élevé, latence inutile ; doit être opt-in et déclenché manuellement |

### 3.2 Approche retenue — 2 mécanismes orthogonaux

#### Mécanisme A — Cleanup à expiration

**Détection** (côté CORE — déjà patché par Update) :
- Un ghost est marqué `expired` si `status === 'planned' && now > expectedBy + grace_period`
- `grace_period` configurable par repo, default 30 jours
- Le statut est dérivé, pas persisté (computed à chaque query, comme `materialized` est déjà computed)

**Endpoint dédié** :
```
POST /ghosts/cleanup-prompt?repo=<base>
→ Retourne la liste des ghosts expirés + une suggestion LLM par ghost :
  {
    "expired": [
      {
        "id": "tier-3-2-mutation-tracking",
        "title": "Mutation tracking",
        "expectedBy": "2026-04-30",
        "daysPastExpiry": 26,
        "suggestion": {
          "action": "reaffirm" | "cancel" | "ship-as-other",
          "rationale": "Le code montre que vous avez livré /similarity en remplacement de ce qui était prévu — proposer de cancel celui-ci.",
          "confidence": 0.85,
          "evidenceLinks": [{ "file": "docker-server-similarity.mjs", "kind": "actual-matching-spec" }]
        }
      }
    ]
  }
```

**LLM prompt** côté serveur — `docker-server-ghost-cleanup.mjs` :
```
Tu es un assistant qui aide à nettoyer une roadmap.
Ce ghost a expiré il y a {daysPastExpiry} jours :
  Title: {title}
  Description: {description}
  expectedBy: {expectedBy}
  expectedLinks: {expectedLinks}

Voici les nodes réels du graph qui matchent partiellement ses expectedLinks :
  {matchedNodes}

Voici les commits récents (3 derniers mois) :
  {recentCommits}

Propose une action parmi : reaffirm | cancel | ship-as-other
Si ship-as-other, indique quel autre ghost/code livré couvre maintenant ce besoin.
Réponds en JSON strict { action, rationale, confidence }.
```

LLM model configurable via `.gitnexus.yaml` (cohérent avec semantic-labels). Default = `claude-haiku-4-5` (rapide, cheap, suffit pour cette tâche).

**UI intégrée à AuditPanel** :
- Nouveau badge "🔴 N expired" dans AuditSummary si `N > 0`
- Click sur badge → ouvre `CleanupModal` (nouveau composant) qui appelle `POST /ghosts/cleanup-prompt`
- Modal liste les ghosts expirés avec leur suggestion LLM ; user valide ghost par ghost
- Action `reaffirm` : update `expectedBy` (next quarter) ; mais comme ROADMAP.md est la source, on génère un PATCH suggestion à appliquer manuellement
- Action `cancel` : génère également un patch (remove du ROADMAP)
- Action `ship-as-other` : ajoute une note dans le ghost JSON `replacedBy: <other-ghost-id>` ; le user doit retirer le ghost de ROADMAP.md

Le user reste in-the-loop, l'LLM ne commit pas tout seul.

#### Mécanisme B — Multi-tool connector

**Framework** : `connectors/` dans `upstream/` avec un fichier par tool. Chaque connecteur expose :

```js
// upstream/connectors/plane.mjs (exemple primary)
export const planeConnector = {
  name: 'plane',
  configKey: 'connectors.plane',  // dans .gitnexus.yaml
  async fetchOpenWorkItems({ apiUrl, workspaceSlug, projectId, apiKey }) {
    // Plane REST API → returns [{ id, title, description, state, dueDate, externalUrl }]
  },
  async fetchClosedWorkItems({ ... }) { /* ... */ },
};
```

**Registry CORE-aware** (depuis le plugin-aware registry défini en Update sur CORE) :
```js
// au boot du serveur
import { registerGhostSource } from './docker-server-ghosts.mjs';
import { planeConnector } from './connectors/plane.mjs';
import { linearConnector } from './connectors/linear.mjs';
import { githubConnector } from './connectors/github.mjs';

registerGhostSource(planeConnector);
registerGhostSource(linearConnector);
registerGhostSource(githubConnector);
```

**Lecture côté serveur — endpoint dédié** :
```
GET /ghosts/connector-suggestions?repo=<base>
→ Pour chaque connecteur configuré dans .gitnexus.yaml :
   1. fetchOpenWorkItems()
   2. Pour chaque work item, match contre les ghosts existants par :
      - titre similaire (fuzzy match)
      - mots-clés communs dans description
   3. Si match trouvé → suggère :
      - "Plane ticket #1234 est ouvert depuis 2 mois — ghost X probablement encore en cours"
      - "Plane ticket #5678 est fermé won't-fix — ghost Y probablement cancel"
   4. Retourne la liste des suggestions

→ Réponse : { suggestions: [{ ghostId, connectorName, ticketRef, suggestedAction, externalUrl }] }
```

**Suggestions, pas de commandes** : aucun connecteur ne modifie automatiquement les ghosts. Le user voit les suggestions dans `CleanupModal` ou dans un nouveau widget `ConnectorSuggestions` du AuditPanel.

**Configuration** dans `.gitnexus.yaml` (cohérent avec Tier 2bis.4) :
```yaml
connectors:
  plane:
    enabled: true
    apiUrl: "https://plane.mycorp.local"
    workspaceSlug: "main"
    projectId: "abc123"
    # apiKey lu via process.env.PLANE_API_KEY (jamais committé)
  linear:
    enabled: false
  github:
    enabled: true
    repo: "RoJLD/HMMstudio"
    # apiKey via process.env.GITHUB_TOKEN
  jira:
    enabled: false
```

**Plane primary** : implémentation complète dans v1. Linear / GitHub / Jira : framework prêt + connecteur stub qui fail gracefully ("Linear not implemented yet"). Les connecteurs additionnels sont des extensions futures.

#### Plugin-aware registry (Option C de la review)

Update sur CORE introduit `registerGhostSource(connector)`. Cleanup + multi-tool connector consomment ce registry :

```
CORE registry
├── builtinRoadmapSource (parse ROADMAP.md → ghosts.json)  [default, always on]
├── planeConnector       (optional, registered via .gitnexus.yaml)
├── linearConnector      (optional)
├── githubConnector      (optional)
└── jiraConnector        (optional)
```

Chaque source contribue à la liste agrégée de ghosts/suggestions, mais le ROADMAP.md reste la source de vérité primaire pour les nodes du graph.

### 3.3 Tests (intégration pyramid)

| Test | Fichier | Couvre |
|---|---|---|
| computeExpiredGhosts | `tests/unit/ghost-cleanup-expired.test.mjs` | Détection `expired` selon `expectedBy + grace_period` |
| LLM prompt builder | `tests/unit/ghost-cleanup-prompt.test.mjs` | Construction du prompt + parsing de la réponse JSON |
| Plane connector | `tests/unit/connectors-plane.test.mjs` | fetchOpenWorkItems + fuzzy match contre ghosts |
| Registry | `tests/unit/ghost-source-registry.test.mjs` | register/list/get fns + isolation entre sources |
| /cleanup-prompt endpoint | `tests/integration/endpoints/ghost-cleanup.test.mjs` | 200 avec ghosts expirés + suggestions, 200 vide si aucun |
| /connector-suggestions endpoint | `tests/integration/endpoints/ghost-connector-suggestions.test.mjs` | Lecture Plane mock + suggestions générées |
| CleanupModal | `tests/unit/components/CleanupModal.test.tsx` | Render expired list + validation actions |

## 4. Scope boundaries

**In-scope** :
- Endpoint `POST /ghosts/cleanup-prompt`
- LLM cleanup pipeline (prompt + parse + suggest)
- `CleanupModal` React component
- Endpoint `GET /ghosts/connector-suggestions`
- Plane connecteur **complet** (v1)
- Linear / GitHub / Jira connecteurs **stub** (framework prêt, fail gracefully)
- Plugin registry `registerGhostSource`
- Tests + wiring docs

**Out-of-scope** :
- Bidirectionnel : créer des tickets Plane depuis le graph → out (asymétrie volontaire, le graph reste la source de vérité)
- Auto-resolution sans validation user → out (les LLM ne commitent jamais)
- Implémentation complète Linear/GitHub/Jira → out v1 (mais le scaffold est livré)
- Webhooks (Plane push sur changement) → out v1
- UI dédiée connector (juste suggestions dans CleanupModal) → out
- Caching long-terme des connector responses → out (TTL 5 min en mémoire suffit pour v1)

## 5. Open questions

1. **LLM coût** : un cleanup prompt par ghost expiré × N ghosts = jusqu'à 10 calls LLM. À ce volume, OK. Si > 50, paginer. **Résolu pour v1.**
2. **Plane API auth** : Plane self-hosted peut avoir des certs auto-signés. Le fetch Node doit accepter `NODE_TLS_REJECT_UNAUTHORIZED=0` en option (configurable, off par défaut). **À documenter dans la config.**
3. **Fuzzy match seuil** : seuil de similarité (titre ghost vs titre ticket) pour proposer une suggestion. Default 0.7 (Jaccard sur tokens). Tunable via `.gitnexus.yaml`. **Résolu pour v1.**
4. **Conflit de suggestions** : si 2 connecteurs proposent des actions opposées pour le même ghost (e.g. Plane = "still active", GitHub = "closed won't-fix"), quoi faire ? **Décision** : afficher les 2 suggestions séparément dans CleanupModal, user tranche. Pas d'algorithme de merge.

## 6. Effort estimé

**~3.5 jours** :

| Composant | Effort |
|---|---|
| computeExpiredGhosts + tests | 0.25 j |
| LLM cleanup prompt + endpoint /cleanup-prompt | 0.75 j |
| CleanupModal + intégration AuditPanel | 0.5 j |
| Plugin registry (registerGhostSource) | 0.25 j |
| Plane connecteur + fuzzy match | 0.75 j |
| Endpoint /connector-suggestions | 0.5 j |
| Linear / GitHub / Jira stubs | 0.25 j |
| Tests integration + docs (ROADMAP/INVENTORY/spec Update) | 0.25 j |

## 7. Suite

Plan d'implémentation à écrire via `superpowers:writing-plans` quand prêt à exécuter. Recommandation : **livrer après le CORE + Audit + Augmented graph** (pour avoir les hooks UI). Avant Brainstorm-hook et Gantt si possible.

Sous-specs ouvertes restantes (du IDEAS-PARKING) :
- SysML export (bonus)
- "Ghost Cluster" granularité intermédiaire (non débattu, parking)

---

## Update 2026-05-27 — Shipped

Cleanup + Multi-tool connectors livré. Notes :

- 2 endpoints livrés : `POST /ghosts/cleanup-prompt` (expired list + LLM-ready prompts) + `GET /ghosts/connector-suggestions` (Plane fetch + fuzzy-match).
- Plane connector **full v1** : fetch open + closed via REST API + auth via `X-API-Key` env (`PLANE_API_KEY`).
- Linear / GitHub / Jira **stubs** : framework prêt mais `fetchOpenWorkItems` / `fetchClosedWorkItems` lèvent "not implemented yet". Extension future.
- Fuzzy match Jaccard (tokens minusculisés, ponctuation strippée), seuil 0.7 default, configurable via `.gitnexus.json > connectors.<name>.matchThreshold`.
- `CleanupModal.tsx` ouvert via la 6ème card "Expired" de AuditSummary (déjà shippée en Audit Update 1). UI v1 : user copie le prompt, l'envoie à son LLM, applique la suggestion manuellement à ROADMAP.md puis re-sync. Auto-LLM call = follow-up.
- Aucun connecteur ne modifie automatiquement les ghosts. Toujours suggestion → validation user.
- Configuration via `.gitnexus.json` (cohérent avec Tier 2bis.4 .gitnexus.json unifié, pas .gitnexus.yaml malgré le spec original ; cf CORE Update — Shipped pour le pivot).
- Tests : 3 unit + 1 component + 2 integration. Runtime local Node 21 impossible (vitest 4.x), CI Node 22 exerce le suite.

### Limitations connues

1. **LLM call manuel** : v1 le user copie le prompt. Auto-call via `createChatModel` (pattern semantic-labels) reste un follow-up.
2. **Pas de Webhooks** (Plane push sur changement) — out-of-scope.
3. **Linear / GitHub / Jira stubs** : framework ready, impl à venir si demandée.
4. **Threshold Jaccard 0.7** : tuning empirique probable selon le corpus titres ghost vs tickets.
5. **Bidirectionnel out** : pas de création de tickets Plane depuis le graph (asymétrie volontaire).
