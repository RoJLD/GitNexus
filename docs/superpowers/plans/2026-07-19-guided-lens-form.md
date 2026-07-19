# Formulaire guidé de lentille — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une 2ᵉ surface d'entrée (formulaire guidé, pour l'héritier) au Lens Studio, qui **émet la même spec canonique** que le mode expert et passe par les **mêmes callbacks** — zéro changement backend.

**Architecture:** Une fonction pure `formStateToSpec` (le traducteur, unit-testable sans React) + un composant de saisie `GuidedLensForm` (additif) + un toggle `guided|expert` dans `LensStudioModal` dont les boutons Preview/Propose restent partagés. Basculer guidé→expert sérialise la spec produite dans le textarea (preuve d'isomorphisme).

**Tech Stack:** React 19 + TypeScript + Tailwind v4 + i18next. Tests Vitest. Aucune nouvelle dépendance.

## Global Constraints

- **Repo & git** : repo nested `ingestion/GitNexus` (RoJLD/GitNexus, gitignored par ELYSIUM → worktree-guard EXEMPT). Branche **`feat/lens-studio-shell`** (on empile sur le Lens Studio expert déjà livré). Identité déjà `Robin Denis <roblastar@live.fr>` — JAMAIS `--author`, ne pas bypasser de hooks.
- **Modèle patches** : les sources React vivent dans `upstream/gitnexus-web/` (clone **gitignored**) → les édits y sont transitoires. Le **livrable tracké** = `patches/additive-files.diff` (fichiers neufs) + `patches/inplace-edits.diff` (édits) + tests sous `tests/unit/`. Régénérer avant chaque commit, depuis `ingestion/GitNexus/` :
  ```bash
  cd upstream && git add -N . && git diff HEAD --diff-filter=A > ../patches/additive-files.diff && git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff && git reset && cd ..
  node scripts/check-patch-drift.mjs
  ```
- **Doctrine de livraison du fork (CI-enforcée)** : après la dernière tâche, mettre à jour `tests/README.md` (déclarer chaque nouveau test — `node scripts/check-test-inventory.mjs` doit sortir OK) et resynchroniser les compteurs (`node scripts/check-doc-counters.mjs --write`), + une ligne ROADMAP « Déjà livré » et une entrée INVENTORY. Ces deux scripts forment le gate CI `inventory-check`.
- **Tests** : `npx vitest run --config vitest.config.unit.mjs <chemin>` depuis `ingestion/GitNexus/tests`. Composants sous `tests/unit/components/`, purs sous `tests/unit/`.
- **Env connu** : `tests/` et `upstream/gitnexus-web/` sont deux installs npm distincts → rendre le vrai `react-i18next` lève « Invalid hook call ». Les tests composants **mockent `react-i18next` + `@/lib/lucide-icons` au niveau du fichier** (voir `tests/unit/components/lens-studio-modal.test.tsx` — copier son en-tête verbatim).
- **Grammaire backend (contraintes dures)** : `color` présent SANS `color.by` → erreur E6 ; `color.scale` ∈ {`heat`,`categorical`,`community`} ; `eval_predicate` n'a **pas** de conjonction (`&&`/`||` → « unparseable predicate ») ; une spec authored doit déclarer `source.lens` (composition-based). Donc : **omettre un bloc vide plutôt que l'émettre vide**, et **un seul prédicat**.
- Conventions fork : tokens Tailwind (`bg-surface`, `border-border-subtle`, `text-text-primary`, `bg-accent`, `bg-void`, `hover:bg-hover`), icônes depuis `@/lib/lucide-icons`, chaînes via `t('header:lensStudio.guided.*')`.

---

### Task 1: `formStateToSpec` — le traducteur pur

**Files:**
- Create: `upstream/gitnexus-web/src/lib/lens-form-spec.ts` (**additif**)
- Test: `tests/unit/lens-form-spec.test.ts` (create)

**Interfaces:**
- Produces : `LensFormState`, `PredicateRow`, `formStateToSpec(s) -> Record<string, unknown>`, `predicateRowToExpr(r) -> string`, `EMPTY_FORM_STATE` (état initial exporté, réutilisé par Task 2).

- [ ] **Step 1: Write the failing test**

Crée `tests/unit/lens-form-spec.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { formStateToSpec, predicateRowToExpr, EMPTY_FORM_STATE } from '@/lib/lens-form-spec';

const base = { ...EMPTY_FORM_STATE, name: 'my_view', sourceLens: 'sigil', meaning: 'Ma lentille.' };

describe('predicateRowToExpr', () => {
  it('renders comparison operators', () => {
    expect(predicateRowToExpr({ field: 'status', op: '==', value: 'critical' })).toBe('status == critical');
    expect(predicateRowToExpr({ field: 'score', op: '>=', value: '3' })).toBe('score >= 3');
  });
  it('renders `in` as a bracketed list', () => {
    expect(predicateRowToExpr({ field: 'kind', op: 'in', value: 'a, b ,c' })).toBe('kind in [a, b, c]');
  });
});

describe('formStateToSpec', () => {
  it('builds the minimal spec (name + source + meaning)', () => {
    expect(formStateToSpec(base)).toEqual({
      name: 'my_view', source: { lens: 'sigil' }, meaning: 'Ma lentille.',
    });
  });

  it('OMITS color entirely when colorBy is empty (an empty color block breaks the backend grammar)', () => {
    const spec = formStateToSpec({ ...base, colorBy: '', colorScale: 'heat' });
    expect('color' in spec).toBe(false);
  });

  it('emits color when colorBy is set', () => {
    expect(formStateToSpec({ ...base, colorBy: 'domainType', colorScale: 'categorical' }).color)
      .toEqual({ by: 'domainType', scale: 'categorical' });
  });

  it('OMITS select when there is no usable predicate', () => {
    expect('select' in formStateToSpec({ ...base, predicates: [{ field: '', op: '==', value: '' }] })).toBe(false);
  });

  it('emits select.node_where from the single predicate row', () => {
    expect(formStateToSpec({ ...base, predicates: [{ field: 'status', op: '==', value: 'critical' }] }).select)
      .toEqual({ node_where: 'status == critical' });
  });

  it('OMITS insight unless BOTH topN and by are set', () => {
    expect('insight' in formStateToSpec({ ...base, insightTopN: 5, insightBy: '' })).toBe(false);
    expect('insight' in formStateToSpec({ ...base, insightTopN: '', insightBy: 'pagerank' })).toBe(false);
    expect(formStateToSpec({ ...base, insightTopN: 5, insightBy: 'pagerank' }).insight)
      .toEqual({ rank: 'top 5 by pagerank' });
  });

  it('omits meaning when blank', () => {
    expect('meaning' in formStateToSpec({ ...base, meaning: '   ' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (depuis `ingestion/GitNexus/tests`) : `npx vitest run --config vitest.config.unit.mjs unit/lens-form-spec.test.ts`
Expected : FAIL (module `@/lib/lens-form-spec` introuvable).

- [ ] **Step 3: Implémenter `lens-form-spec.ts`**

```ts
export type PredicateOp = '==' | '!=' | '>=' | '<=' | '>' | '<' | 'in';

export interface PredicateRow {
  field: string;
  op: PredicateOp;
  value: string;
}

export interface LensFormState {
  name: string;
  sourceLens: string;
  meaning: string;
  predicates: PredicateRow[];
  colorBy: string;
  colorScale: 'heat' | 'categorical' | 'community';
  insightTopN: number | '';
  insightBy: string;
}

export const EMPTY_FORM_STATE: LensFormState = {
  name: '',
  sourceLens: '',
  meaning: '',
  predicates: [{ field: '', op: '==', value: '' }],
  colorBy: '',
  colorScale: 'categorical',
  insightTopN: '',
  insightBy: '',
};

/** `status == critical` | `kind in [a, b, c]` — mirrors the backend's eval_predicate grammar. */
export const predicateRowToExpr = (r: PredicateRow): string => {
  const field = r.field.trim();
  if (r.op === 'in') {
    const items = r.value.split(',').map((v) => v.trim()).filter(Boolean);
    return `${field} in [${items.join(', ')}]`;
  }
  return `${field} ${r.op} ${r.value.trim()}`;
};

/**
 * Translate the guided form into the SAME canonical lens spec the expert
 * textarea produces. Cardinal rule: OMIT a block rather than emit it empty —
 * the backend grammar rejects `color` without `color.by` (E6), and an empty
 * `select`/`insight` would be meaningless. Only ONE predicate is emitted:
 * eval_predicate has no conjunction, so joining rows would produce an
 * unparseable expression.
 */
export const formStateToSpec = (s: LensFormState): Record<string, unknown> => {
  const spec: Record<string, unknown> = {
    name: s.name.trim(),
    source: { lens: s.sourceLens.trim() },
  };
  if (s.meaning.trim()) spec.meaning = s.meaning.trim();

  const row = s.predicates.find((p) => p.field.trim() && (p.op === 'in' ? p.value.trim() : p.value.trim()));
  if (row) spec.select = { node_where: predicateRowToExpr(row) };

  if (s.colorBy.trim()) spec.color = { by: s.colorBy.trim(), scale: s.colorScale };

  if (s.insightTopN !== '' && s.insightBy.trim()) {
    spec.insight = { rank: `top ${s.insightTopN} by ${s.insightBy.trim()}` };
  }
  return spec;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run : `npx vitest run --config vitest.config.unit.mjs unit/lens-form-spec.test.ts`
Expected : PASS (9 cases).

- [ ] **Step 5: Régénérer patches + drift + commit**

```bash
cd upstream && git add -N . && git diff HEAD --diff-filter=A > ../patches/additive-files.diff && git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff && git reset && cd ..
node scripts/check-patch-drift.mjs
git add patches/additive-files.diff patches/inplace-edits.diff tests/unit/lens-form-spec.test.ts
git commit -m "feat(lens): formStateToSpec — guided form to canonical spec translator [Lens Studio]"
```

---

### Task 2: `GuidedLensForm` + toggle guidé/expert dans la modale

**Files:**
- Create: `upstream/gitnexus-web/src/components/GuidedLensForm.tsx` (**additif**)
- Modify: `upstream/gitnexus-web/src/components/LensStudioModal.tsx` (mode toggle + branchement)
- Modify: `upstream/gitnexus-web/src/locales/en/header.json` + `upstream/gitnexus-web/src/locales/zh-CN/header.json`
- Test: `tests/unit/components/guided-lens-form.test.tsx` (create) + `tests/unit/components/lens-studio-modal.test.tsx` (extend)

**Interfaces:**
- Consumes : `LensFormState`, `EMPTY_FORM_STATE`, `formStateToSpec` (Task 1) ; les props existantes de `LensStudioModal` (`isOpen`,`onClose`,`onPreview`,`onPropose`) restent **inchangées**.
- Produces : `GuidedLensForm({ state, onChange })`.

- [ ] **Step 1: Write the failing test — le formulaire**

Crée `tests/unit/components/guided-lens-form.test.tsx`. **Copie l'en-tête de mock verbatim** depuis `tests/unit/components/lens-studio-modal.test.tsx` (mocks `react-i18next` + `@/lib/lucide-icons`), puis :

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuidedLensForm } from '@/components/GuidedLensForm';
import { EMPTY_FORM_STATE } from '@/lib/lens-form-spec';

describe('GuidedLensForm', () => {
  it('reports name edits through onChange', () => {
    const onChange = vi.fn();
    render(<GuidedLensForm state={EMPTY_FORM_STATE} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('guided-name'), { target: { value: 'my_view' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'my_view' }));
  });

  it('reports source lens edits through onChange', () => {
    const onChange = vi.fn();
    render(<GuidedLensForm state={EMPTY_FORM_STATE} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('guided-source'), { target: { value: 'sigil' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sourceLens: 'sigil' }));
  });

  it('reports predicate edits through onChange', () => {
    const onChange = vi.fn();
    render(<GuidedLensForm state={EMPTY_FORM_STATE} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('guided-pred-field'), { target: { value: 'status' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ predicates: [expect.objectContaining({ field: 'status' })] }),
    );
  });
});
```

- [ ] **Step 2: Run — FAIL.** Run : `npx vitest run --config vitest.config.unit.mjs unit/components/guided-lens-form.test.tsx`

- [ ] **Step 3: Implémenter `GuidedLensForm.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import type { LensFormState, PredicateOp } from '@/lib/lens-form-spec';

const OPS: PredicateOp[] = ['==', '!=', '>=', '<=', '>', '<', 'in'];
const SCALES = ['categorical', 'heat', 'community'] as const;

const inputCls =
  'w-full rounded-lg border border-border-subtle bg-void px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none';

interface GuidedLensFormProps {
  state: LensFormState;
  onChange: (next: LensFormState) => void;
}

export const GuidedLensForm = ({ state, onChange }: GuidedLensFormProps) => {
  const { t } = useTranslation(['header']);
  const set = (patch: Partial<LensFormState>) => onChange({ ...state, ...patch });
  const row = state.predicates[0] ?? { field: '', op: '==' as PredicateOp, value: '' };
  const setRow = (patch: Partial<typeof row>) => set({ predicates: [{ ...row, ...patch }] });

  return (
    <div className="space-y-3">
      <label className="block text-xs text-text-secondary">
        {t('header:lensStudio.guided.name')}
        <input data-testid="guided-name" className={inputCls} value={state.name}
          onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="block text-xs text-text-secondary">
        {t('header:lensStudio.guided.source')}
        <input data-testid="guided-source" className={inputCls} value={state.sourceLens}
          onChange={(e) => set({ sourceLens: e.target.value })} />
      </label>
      <label className="block text-xs text-text-secondary">
        {t('header:lensStudio.guided.meaning')}
        <input data-testid="guided-meaning" className={inputCls} value={state.meaning}
          onChange={(e) => set({ meaning: e.target.value })} />
      </label>

      <fieldset className="rounded-lg border border-border-subtle p-2">
        <legend className="px-1 text-[10px] uppercase tracking-wider text-text-muted">
          {t('header:lensStudio.guided.filter')}
        </legend>
        <div className="flex gap-2">
          <input data-testid="guided-pred-field" className={inputCls} placeholder={t('header:lensStudio.guided.field')}
            value={row.field} onChange={(e) => setRow({ field: e.target.value })} />
          <select data-testid="guided-pred-op" className={inputCls} value={row.op}
            onChange={(e) => setRow({ op: e.target.value as PredicateOp })}>
            {OPS.map((op) => <option key={op} value={op}>{op}</option>)}
          </select>
          <input data-testid="guided-pred-value" className={inputCls} placeholder={t('header:lensStudio.guided.value')}
            value={row.value} onChange={(e) => setRow({ value: e.target.value })} />
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border-subtle p-2">
        <legend className="px-1 text-[10px] uppercase tracking-wider text-text-muted">
          {t('header:lensStudio.guided.color')}
        </legend>
        <div className="flex gap-2">
          <input data-testid="guided-color-by" className={inputCls} placeholder={t('header:lensStudio.guided.colorBy')}
            value={state.colorBy} onChange={(e) => set({ colorBy: e.target.value })} />
          <select data-testid="guided-color-scale" className={inputCls} value={state.colorScale}
            onChange={(e) => set({ colorScale: e.target.value as LensFormState['colorScale'] })}>
            {SCALES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border-subtle p-2">
        <legend className="px-1 text-[10px] uppercase tracking-wider text-text-muted">
          {t('header:lensStudio.guided.insight')}
        </legend>
        <div className="flex gap-2">
          <input data-testid="guided-insight-n" type="number" min={1} className={inputCls}
            placeholder={t('header:lensStudio.guided.topN')} value={state.insightTopN}
            onChange={(e) => set({ insightTopN: e.target.value === '' ? '' : Number(e.target.value) })} />
          <input data-testid="guided-insight-by" className={inputCls} placeholder={t('header:lensStudio.guided.by')}
            value={state.insightBy} onChange={(e) => set({ insightBy: e.target.value })} />
        </div>
      </fieldset>
    </div>
  );
};
```

- [ ] **Step 4: Run — PASS** (3 cases). Run : `npx vitest run --config vitest.config.unit.mjs unit/components/guided-lens-form.test.tsx`

- [ ] **Step 5: Write the failing test — le toggle dans la modale**

Ajoute à `tests/unit/components/lens-studio-modal.test.tsx` (garde son en-tête de mocks) :

```tsx
  it('in guided mode, Preview receives the spec BUILT BY THE FORM', async () => {
    const onPreview = vi.fn(async () => ({ ok: true }));
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={onPreview} onPropose={async () => ({ id: 'i', status: 's' })} />);
    fireEvent.click(screen.getByTestId('lens-mode-guided'));
    fireEvent.change(screen.getByTestId('guided-name'), { target: { value: 'my_view' } });
    fireEvent.change(screen.getByTestId('guided-source'), { target: { value: 'sigil' } });
    fireEvent.click(screen.getByTestId('lens-preview-btn'));
    await waitFor(() =>
      expect(onPreview).toHaveBeenCalledWith({ name: 'my_view', source: { lens: 'sigil' } }));
  });

  it('switching guided -> expert serializes the built spec into the textarea', () => {
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={async () => ({ ok: true })} onPropose={async () => ({ id: 'i', status: 's' })} />);
    fireEvent.click(screen.getByTestId('lens-mode-guided'));
    fireEvent.change(screen.getByTestId('guided-name'), { target: { value: 'my_view' } });
    fireEvent.change(screen.getByTestId('guided-source'), { target: { value: 'sigil' } });
    fireEvent.click(screen.getByTestId('lens-mode-expert'));
    expect(JSON.parse((screen.getByRole('textbox') as HTMLTextAreaElement).value))
      .toEqual({ name: 'my_view', source: { lens: 'sigil' } });
  });
```

- [ ] **Step 6: Run — FAIL** (pas de toggle). Run : `npx vitest run --config vitest.config.unit.mjs unit/components/lens-studio-modal.test.tsx`

- [ ] **Step 7: Brancher le toggle dans `LensStudioModal.tsx`**

Ajouts (le reste du fichier inchangé) :
- imports : `import { GuidedLensForm } from './GuidedLensForm';` et `import { EMPTY_FORM_STATE, formStateToSpec, type LensFormState } from '@/lib/lens-form-spec';`
- states : `const [mode, setMode] = useState<'guided' | 'expert'>('expert');` et `const [form, setForm] = useState<LensFormState>(EMPTY_FORM_STATE);`
- `parse()` devient conscient du mode — en guidé, la spec vient du formulaire (jamais d'erreur JSON) :
  ```tsx
  const parse = (): Record<string, unknown> | null => {
    if (mode === 'guided') { setErrors([]); return formStateToSpec(form); }
    try { /* ... corps existant inchangé ... */ } catch (e) { /* ... */ }
  };
  ```
- bascule : basculer vers `expert` sérialise la spec construite ; vers `guided` ne tente aucun reverse-parsing.
  ```tsx
  const switchMode = (next: 'guided' | 'expert') => {
    if (next === 'expert' && mode === 'guided') setText(JSON.stringify(formStateToSpec(form), null, 2));
    setMode(next);
  };
  ```
- segmented control dans l'en-tête (après le titre, avant le bouton de fermeture) :
  ```tsx
  <div className="ml-3 flex overflow-hidden rounded-lg border border-border-subtle text-xs">
    <button type="button" data-testid="lens-mode-guided" onClick={() => switchMode('guided')}
      className={`px-2 py-1 ${mode === 'guided' ? 'bg-accent text-white' : 'text-text-muted hover:bg-hover'}`}>
      {t('header:lensStudio.guided.tab')}
    </button>
    <button type="button" data-testid="lens-mode-expert" onClick={() => switchMode('expert')}
      className={`px-2 py-1 ${mode === 'expert' ? 'bg-accent text-white' : 'text-text-muted hover:bg-hover'}`}>
      {t('header:lensStudio.guided.expertTab')}
    </button>
  </div>
  ```
- corps : `{mode === 'guided' ? <GuidedLensForm state={form} onChange={setForm} /> : <textarea ... />}` (le textarea existant inchangé dans la branche expert).

- [ ] **Step 8: Run — PASS** (modale 6 cases : 4 existants + 2 nouveaux).

- [ ] **Step 9: i18n**

Ajouter sous `lensStudio` dans `upstream/gitnexus-web/src/locales/en/header.json` :
```json
    "guided": {
      "tab": "Guided", "expertTab": "Expert", "name": "Lens name", "source": "Refines lens",
      "meaning": "Meaning", "filter": "Filter", "field": "field", "value": "value",
      "color": "Color", "colorBy": "color by", "insight": "Insight", "topN": "top N", "by": "by metric"
    }
```
Ajouter les équivalents traduits dans `upstream/gitnexus-web/src/locales/zh-CN/header.json`.

- [ ] **Step 10: Suite complète + doctrine + commit**

```bash
# depuis ingestion/GitNexus/tests
npx vitest run --config vitest.config.unit.mjs
# depuis ingestion/GitNexus
cd upstream && git add -N . && git diff HEAD --diff-filter=A > ../patches/additive-files.diff && git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff && git reset && cd ..
node scripts/check-patch-drift.mjs
node scripts/check-doc-counters.mjs --write   # compteurs additive/inplace
# déclarer les 2 nouveaux tests dans tests/README.md (Pure logic units + Components React), puis :
node scripts/check-test-inventory.mjs         # doit sortir OK
git add patches/ tests/ ROADMAP.md INVENTORY.md
git commit -m "feat(lens): guided lens form (2nd input surface, same canonical spec) [Lens Studio]"
```
Ajouter aussi une ligne à la table « Déjà livré » de `ROADMAP.md` et une entrée sous la section Lens Studio d'`INVENTORY.md`.

---

## Self-Review

**Spec coverage** : `formStateToSpec` + omission des blocs vides + `in` bracketé + un seul prédicat → Task 1 ✅ ; `GuidedLensForm` → Task 2 ✅ ; toggle + Preview/Propose partagés → Task 2 Step 7 ✅ ; bascule guidé→expert sérialise → Task 2 Step 5/7 ✅ ; pas de reverse-parsing → explicite dans `switchMode` ✅ ; i18n → Step 9 ✅ ; doctrine CI → Step 10 ✅.

**Type consistency** : `LensFormState`/`PredicateRow`/`PredicateOp`/`EMPTY_FORM_STATE` définis Task 1, consommés Task 2 sous les mêmes noms ; les props de `LensStudioModal` restent inchangées (aucun appelant à mettre à jour dans `App.tsx`).

**Placeholder scan** : aucun TBD ; chaque step porte son code.

## Hors scope
Conjonction de prédicats · reverse-parsing expert→guidé · dropdown des lentilles amont (`/lens`) · YAML.
