# Formulaire guidé de lentille (design)

**Date** : 2026-07-19 · **SIGIL** : SIGIL-1711 Phase 2 (« L'Atelier des Lentilles », dernier item) · **Statut** : design
**Prérequis** : [`2026-07-19-lens-studio-shell-design.md`](2026-07-19-lens-studio-shell-design.md) (mode expert, livré) — ce spec ajoute la **2ᵉ surface d'entrée**.
**Backend** : inchangé. Aucune route, aucun contrat modifié.

## Problème

Le mode expert expose la **grammaire brute** (textarea JSON). C'est efficace pour l'opérateur de gouvernance qui la connaît, mais opaque pour l'**héritier** — le successeur non-technique que le north-star « La Lentille Souveraine » désigne comme consommateur de premier rang. Sans surface guidée, créer une lentille reste réservé à qui sait écrire `{"source":{"lens":…},"select":{"node_where":…}}`.

## Thèse : deux surfaces, un seul objet

Le guidé n'est **pas** un second système. C'est un **traducteur** : des champs de formulaire → **la même spec canonique** que le mode expert produit, envoyée aux **mêmes callbacks** (`onPreview`/`onPropose`). Toute la validation, la preview, la promotion et le rendu sont déjà prouvés — le guidé n'ajoute qu'une saisie assistée.

Corollaire de design : **basculer Guidé → Expert doit afficher le JSON que le formulaire vient de produire.** C'est à la fois la preuve visible de l'isomorphisme et le chemin d'apprentissage naturel de la grammaire (on compose au formulaire, on lit le résultat, on finit par écrire directement).

## Architecture

### 1. `formStateToSpec` — fonction pure (le cœur, unit-testable sans React)

`upstream/gitnexus-web/src/lib/lens-form-spec.ts` (**additif**) :

```ts
export interface LensFormState {
  name: string;
  sourceLens: string;          // lentille amont (composition) — requis
  meaning: string;
  predicates: PredicateRow[];  // -> select.node_where
  colorBy: string;             // '' = pas de color
  colorScale: 'heat' | 'categorical' | 'community';
  insightTopN: number | '';    // '' = pas d'insight
  insightBy: string;
}
export interface PredicateRow { field: string; op: '=='|'!='|'>='|'<='|'>'|'<'|'in'; value: string; }

export function formStateToSpec(s: LensFormState): Record<string, unknown>;
export function predicateRowToExpr(r: PredicateRow): string;   // 'status == critical' | 'kind in [a,b]'
```

Règles (toutes testables, zéro I/O) :
- **Omission, pas de vide** : un bloc absent (`color`, `insight`, `select`) n'est **pas** émis plutôt qu'émis vide — la grammaire backend rejette `color` sans `color.by` (E6), donc un champ couleur laissé vide doit disparaître de la spec, pas produire `{"color":{}}`.
- `select.node_where` = les lignes de prédicat jointes ; **une seule ligne** en Phase 1 du guidé (pas de `&&`/`||` — la grammaire backend `eval_predicate` n'a pas de conjonction ; en émettre une produirait un « unparseable predicate »). Plusieurs lignes = différé jusqu'à ce que la grammaire les supporte.
- `in` sérialise en `champ in [a, b, c]` (valeurs séparées par virgule dans le champ).
- `source: {lens: sourceLens}` toujours — l'authoring est **composition-based** (contrainte backend Phase 1 : une spec sans `source.lens` ne résout pas).

### 2. Mode toggle dans `LensStudioModal` (in-place, minimal)

Un state `mode: 'guided' | 'expert'` et un segmented control dans l'en-tête. En mode guidé, le corps rend `<GuidedLensForm state onChange/>` ; en mode expert, le textarea actuel **inchangé**. Les boutons Preview/Propose du pied restent **partagés** : ils appellent `parse()` en expert, `formStateToSpec(formState)` en guidé — même `onPreview`/`onPropose` ensuite.

**Bascule guidé → expert** : sérialise `formStateToSpec(formState)` dans le textarea (`JSON.stringify(spec, null, 2)`). La bascule inverse (expert → guidé) ne tente **aucun** parsing inverse — elle laisse l'état du formulaire tel quel (un JSON arbitraire n'est pas toujours représentable dans le formulaire ; prétendre le contraire perdrait des champs silencieusement).

### 3. `GuidedLensForm` — composant de saisie (additif)

`upstream/gitnexus-web/src/components/GuidedLensForm.tsx` : champs contrôlés (name, source lens, meaning), une ligne de prédicat (champ / opérateur / valeur), couleur (by + scale), insight (top N by champ). Conventions du fork : tokens Tailwind, icônes `@/lib/lucide-icons`, chaînes via `t('header:lensStudio.guided.*')`. Le `sourceLens` est saisi librement en Phase 1 (une liste déroulante alimentée par `/lens` = amélioration ultérieure ; le backend renvoie de toute façon une erreur claire « unknown lens » sur un amont inexistant).

## Ce que ça ne fait pas

Pas de nouveau contrat backend · pas de conjonction de prédicats (grammaire) · pas de reverse-parsing expert→guidé · pas de dropdown de lentilles amont (Phase suivante) · YAML toujours hors scope.

## Tests

| Tier | Fichier | Couvre |
|---|---|---|
| Pure | `tests/unit/lens-form-spec.test.ts` | `formStateToSpec` : spec minimale (name+source+meaning), **omission** de `color`/`insight`/`select` quand vides, `predicateRowToExpr` pour chaque opérateur + `in` (liste), spec complète ronde |
| Component | `tests/unit/components/guided-lens-form.test.tsx` | saisie → `onChange` porte l'état attendu ; rendu des champs |
| Component | `tests/unit/components/lens-studio-modal.test.tsx` (étendu) | toggle guidé/expert ; en guidé, Preview appelle `onPreview` avec la spec **construite par le formulaire** ; bascule guidé→expert écrit le JSON dans le textarea |

## Iron Rules

- Σ-THE-GUIDED-FORM-IS-A-TRANSLATOR-NOT-A-SECOND-SYSTEM (même spec, mêmes callbacks).
- Σ-OMIT-AN-EMPTY-BLOCK-NEVER-EMIT-IT-EMPTY (`color:{}` viole la grammaire backend E6).
- Σ-ONE-PREDICATE-UNTIL-THE-GRAMMAR-HAS-CONJUNCTION (ne pas émettre un `&&` que `eval_predicate` ne parse pas).
- Σ-SWITCHING-TO-EXPERT-REVEALS-THE-EMITTED-JSON (preuve d'isomorphisme + chemin d'apprentissage).
- Σ-NO-REVERSE-PARSING-EXPERT-TO-GUIDED (perte silencieuse de champs).

## Update 2026-07-19 — revue finale adversariale (8 findings, tous vérifiés empiriquement)

Le design ci-dessus tenait la **traduction** pour acquise et n'a jamais posé la question de
la **garde**. Les correctifs ci-dessous ne changent ni le contrat, ni les callbacks, ni les
5 Iron Rules — ils ferment les chemins par lesquels la surface guidée émettait quelque chose
que personne n'avait demandé, ou détruisait quelque chose que personne n'avait consenti à perdre.

### `validateFormState` — la garde cliente qui manquait (F2 · F3 · F7)

`parse()` retournait `formStateToSpec(form)` **inconditionnellement** en mode guidé, donc le
garde `if (!spec) return;` du modal ne se déclenchait jamais sur cette surface : un formulaire
vierge + clic « Propose » POSTait réellement `{"name":"","source":{"lens":""}}` au canon
souverain (mesuré). Le mode expert était protégé de facto par `JSON.parse` + le contrôle
`typeof spec === 'object'` ; le guidé n'avait **rien**.

`validateFormState(s): FormIssue[]` est la garde unique de la surface guidée. Elle retourne
des **codes** (suffixes i18n sous `header:lensStudio.guided.errors.*`), jamais des phrases —
le traducteur reste pur, React-free et locale-free. Trois classes d'échec, une seule primitive :

- **`name` / `source.lens` requis** — §1 posait déjà `source.lens` comme toujours requis ;
  rien ne l'appliquait. Un amont vide est *falsy*, donc le garde d'intégrité référentielle du
  promoteur (`if upstream and upstream not in existing`) est **court-circuité** : selon le
  préfixe du nom, soit le backend échoue sur un `_infer_transform` qui parle de « transform »
  (un mot absent du formulaire), soit la preview **réussit** en reconstruisant de zéro — et
  la lentille entre au canon avec l'intention de composition jetée en silence.
- **Opérandes de prédicat portant `< > = !`** — `eval_predicate` scanne
  `['==','!=','>=','<=','>','<']` par **sous-chaîne sur l'expression entière** avant
  d'atteindre sa branche ` in `. `path in [a>b, c]` partitionne donc sur `>` et produit le nom
  de propriété `path in [` : tous les nœuds évaluent False, `apply_select` met `inLens=False`
  partout, le graphe s'éteint entièrement sans qu'aucune erreur ne remonte. Rejeté côté client
  (champ **et** valeurs, mêmes conséquences) tant que la grammaire scanne au lieu de tokeniser.
- **`insight` mal formé** — le `min={1}` du champ Top-N n'est **jamais** appliqué : aucun
  `<form>` n'entoure le formulaire et tous les boutons sont `type="button"`, donc la validation
  de contrainte HTML ne se déclenche pas. `top 0 by x` matche le regex backend puis découpe
  `scored[:0]` ; `top -3`/`top 2.5` ne matchent pas et tombent dans `if not m: return []` ;
  `by in-degree` capture `in` et classe sur une propriété inexistante. Dans les quatre cas :
  preview verte, panneau insights vide, aucune erreur. `formStateToSpec` **n'émet plus** un
  `insight` que le backend ne peut qu'ignorer, et un bloc à demi rempli remonte désormais une
  erreur au lieu d'être omis en silence alors que l'écran montre son contenu.

Précision de doctrine : l'émission n'est **pas** la garde. `formStateToSpec` refuse seulement
ce que le backend mal-lirait de toute façon ; ce que l'utilisateur a littéralement demandé
mais que la grammaire ne sait pas exprimer est bloqué **en amont, avec un message**, jamais
réécrit ni discrètement supprimé.

### `isFormPristine` — la direction n'est pas un consentement (F1)

Le garde de bascule ne testait que la **direction** (`next === 'expert' && mode === 'guided'`),
jamais si le formulaire contenait quoi que ce soit. Conséquence mesurée : écrire une spec
complète en expert, cliquer « Guided » (rien ne se passe — conforme à
Σ-NO-REVERSE-PARSING), puis recliquer « Expert » **sérialisait le formulaire vide** par-dessus
le textarea. Travail détruit, sans avertissement ni undo, sans qu'une seule frappe n'ait eu
lieu dans le formulaire.

`isFormPristine(s)` — comparaison par valeur, indexée sur les clés d'`EMPTY_FORM_STATE` pour
qu'un champ ajouté plus tard ne puisse pas échapper au test — conditionne la sérialisation.
Σ-SWITCHING-TO-EXPERT-REVEALS-THE-EMITTED-JSON est **préservée**, pas troquée : dès la
première frappe, la bascule sérialise comme avant.

### Couverture (F4) et accessibilité (F6)

Quatre mutations appliquées au code réel laissaient la suite 22/22 **verte**, dont le
remplacement de `parse()` par `JSON.parse(text)` dans `handlePropose` — Propose est la
**seule** action à effet de bord persistant de toute la surface, et c'était la seule non
couverte en mode guidé. `guided-lens-form.test.tsx` ne touchait que 3 des 10 contrôles : un
contrôle câblé à la mauvaise clé d'état est invisible à un test qui ne l'actionne jamais.
Chaque contrôle épingle désormais la clé exacte qu'il patche, et les deux directions de
bascule sont couvertes. **12 mutations rejouées, 12 rouges.**

Les deux `<select>` n'avaient ni `aria-label`, ni `title`, ni `id` — contrairement aux trois
champs texte, enfants d'un `<label>` : un lecteur d'écran annonçait « zone de liste, == » sans
nommer ce que le contrôle pilote. L'héritier est le consommateur de premier rang désigné par
le north-star ; aucun `<select>` du fork n'est laissé nu. Le segmented control ne communiquait
son état que par une classe CSS → `aria-pressed`.

### Iron Rules ajoutées

- Σ-THE-GUIDED-SURFACE-NEEDS-ITS-OWN-GATE (`JSON.parse` garde l'expert ; le guidé n'hérite de rien).
- Σ-A-SWITCH-DIRECTION-IS-NOT-A-CONSENT-TO-OVERWRITE.
- Σ-VALIDATE-WHAT-YOU-EMIT-FROM-THE-SAME-PREDICATE (émission et validation partagent leurs
  helpers, sinon elles divergent).
- Σ-AN-HTML-CONSTRAINT-OUTSIDE-A-FORM-IS-DECORATION (`min`/`step` ne valident rien ici).
- Σ-A-BACKEND-THAT-RETURNS-EMPTY-WITHOUT-ERROR-MUST-BE-GUARDED-CLIENT-SIDE.
