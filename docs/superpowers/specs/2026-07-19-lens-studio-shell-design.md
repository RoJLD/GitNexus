# Lens Studio — shell d'authoring de lentilles (design)

**Date** : 2026-07-19 · **SIGIL** : SIGIL-1711 Phase 2 (« L'Atelier des Lentilles ») · **Statut** : livré (PR RoJLD/GitNexus #3)
**Backend consommé** (monorepo hôte ELYSIUM, PR #616 mergée dans `main`) : spec `docs/superpowers/specs/2026-07-18-lens-atelier-design.md` du monorepo. Ce spec-ci couvre **uniquement le versant fork**.
**Plan d'exécution** : [`docs/superpowers/plans/2026-07-19-lens-studio-shell.md`](../plans/2026-07-19-lens-studio-shell.md)

## Problème

Les lentilles de gouvernance ELYSIUM se rendent déjà dans ce fork (Phase 1b : panneau insights/meaning, badge de fraîcheur). Mais **créer** une lentille imposait d'éditer à la main `lens_registry.yaml` dans le monorepo. Le Lens Studio donne une surface d'authoring **là où les lentilles se voient** : éditer une spec, la **prévisualiser dans le vrai canvas** (WYSIWYG), puis la **proposer** au backend souverain.

## Contrainte cardinale — le fork reste un client pur

Le fork **ne persiste jamais** : il ne connaît pas `lens_registry.yaml`, n'écrit aucun état de gouvernance, et se contente de POSTer vers le monorepo hôte. Toute la validation (grammaire), la promotion en canon et le gate de gouvernance vivent côté ELYSIUM. Cela garde le fork bumpable et sans dette de souveraineté.

## Architecture (3 couches, additive au maximum)

1. **Client** (`services/backend-client.ts`, in-place) — deux méthodes + une base :
   - `previewLens(spec)` → `POST ${_backendUrl}/lens/preview` (gateway, **sans auth**, lecture pure). `200` → `{ok:true, braingraph}` ; `422`/`400`/`404` → `{ok:false, errors}`. **Ne rejette jamais** : un échec de transport (gateway down, timeout, circuit-open) est converti en `{ok:false, errors}` — sinon un gateway injoignable produisait un clic « Preview » **silencieux** (Zero-Masking).
   - `proposeLens(spec, autoApprove, token)` → `POST ${_bridgeUrl}/elysium/lens/propose` (bridge-api, `Authorization: Bearer`). Body `{spec, auto_approve}` **sans `author`** : l'identité est dérivée server-side (l'auto-approbation est un privilège de rôle côté backend).
   - `_bridgeUrl` + `getBridgeUrl`/`setBridgeUrl` — nouvelle base (aucune n'existait) ; `setBridgeUrl` réutilise la garde de schéma `validateBackendUrl` (anti-SSRF/CSRF), miroir complet de `setBackendUrl`.
   - `assertOk` surface aussi le `{detail}` de FastAPI (le bridge-api renvoie ses raisons de 403/422 dans `detail`, le gateway dans `errors` — les deux canaux sont honorés).
2. **Composant** (`components/LensStudioModal.tsx`, **additif** — zéro conflit au bump) — modale pure pilotée par deux callbacks (`onPreview`, `onPropose`) : textarea de spec JSON avec pré-garde `JSON.parse` native (**pas de zod** : la convention du fork est TS-cast + `assertOk`, et l'autorité de validation est `parse_spec` côté backend), panneau d'erreurs, toast, case « auto-approve ».
3. **Wiring** (in-place) — `useAppState.previewLens` rend le BrainGraph retourné dans le **canvas réel** en réutilisant exactement le contrat de `switchRepo` : `createKnowledgeGraph()` → `addNode`/`addRelationship` (champ **`relationships`**, pas `edges` — c'est la forme que le gateway sert au web) → `setGraph` → **`applyLensMetadata`**. Cette dernière étape est cardinale : un `setGraph` sans `applyLensMetadata` laisse le panneau insights **inerte** (c'est exactement la régression gap #7 de la Phase 1b). Entrée « + New lens » dans le switcher du Header (prop `onAddLens`) ; `App` tient l'état de la modale et le `proposeLensCb` (token depuis `localStorage.elysium_bridge_token`).

## Décisions

- **Expert d'abord, guidé ensuite** : cette livraison expose la grammaire brute (textarea JSON). Un formulaire **guidé** (héritier) émettant la *même* spec canonique est la Phase 2 suivante — il se branche sur les mêmes callbacks, sans changement backend.
- **JSON, pas YAML** : le registre est en YAML mais une spec est trivialement exprimable en JSON, et `JSON.parse` est natif (zéro dépendance ajoutée). YAML en entrée = différé.
- **Modale additive** : le composant est un fichier neuf (`additive-files.diff`) ; seules 4 surfaces existantes sont éditées in-place (client, hook, Header, App + locales), ce qui minimise la surface de conflit au prochain bump.

## Tests (pyramide du fork)

| Tier | Fichier | Couvre |
|---|---|---|
| Pure/unit | `tests/unit/lens-authoring-client.test.ts` | mapping 200/422, non-rejet sur throw, Bearer + body sans `author`, `{detail}` FastAPI, garde SSRF de `setBridgeUrl` |
| Pure/unit | `tests/unit/use-app-state-preview-lens.test.tsx` | chemin ok → graphe **et** métadonnées appliquées (garde anti-régression gap #7) ; chemin non-ok → pas de remplacement du graphe |
| Component | `tests/unit/components/lens-studio-modal.test.tsx` | fermée → `null`, parse + `onPreview(spec)`, JSON invalide → erreur **et** `onPreview` non appelé, `onPropose(spec, autoApprove)` |

**Note d'environnement** : `tests/` et `upstream/gitnexus-web/` sont deux installs npm distincts ; rendre le vrai hook `react-i18next` lève « Invalid hook call » (deux copies de React). Le test composant mocke donc `react-i18next` + `@/lib/lucide-icons` **au niveau du fichier** (les clés sont rendues brutes) — la logique du composant reste exercée telle quelle.

## Hors scope / gate live

Formulaire guidé · YAML en entrée · édition/suppression de lentilles existantes. **Gate live** (non couvert par les tests, par construction) : acquisition du token Dex/K8s dans le navigateur + stack gateway/bridge-api en cluster + `LENS_APPROVER_GROUPS` configuré côté hôte.
