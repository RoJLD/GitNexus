# Lens Studio Shell (Atelier Phase 1, Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doter le fork gitnexus-web d'un « Lens Studio » (mode expert) qui prévisualise une spec de lentille dans le vrai canvas (WYSIWYG) et la propose au backend ELYSIUM — le versant UI de l'authoring, consommant le backend Plan A (déjà dans main).

**Architecture:** Le fork reste un **client pur**. Un composant additif `LensStudioModal.tsx` (textarea JSON) appelle deux callbacks : `onPreview` (→ `useAppState.previewLens` → POST gateway `/lens/preview` sans auth → rend le BrainGraph dans le canvas via `setGraph`+`applyLensMetadata`) et `onPropose` (→ `backendClient.proposeLens` → POST bridge-api `/elysium/lens/propose` avec Bearer). Le fork ne persiste jamais et ne connaît pas `lens_registry.yaml`.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind v4 (tokens custom) + i18next. Tests Vitest. Aucune nouvelle dépendance (pas de zod pour le backend — convention fork = TS-cast + `assertOk`).

## Global Constraints

- **Repo & git** : tout le travail dans le repo nested `ingestion/GitNexus/` (RoJLD/GitNexus, gitignored par ELYSIUM → worktree-guard EXEMPT ; **aucun worktree ELYSIUM**). Le cwd d'exécution EST `ingestion/GitNexus/` (ou un sous-dossier). Identité déjà `Robin Denis <roblastar@live.fr>` — JAMAIS `--author`, JAMAIS l'email Alten, ne pas bypasser de hooks.
- **Modèle patches (CARDINAL)** : les sources React vivent dans `upstream/gitnexus-web/` (clone vanilla abhigyanpatwari v1.6.7, **GITIGNORED** par GitNexus → les édits y sont des mods de working-tree transitoires). Le **livrable tracké** = `patches/inplace-edits.diff` (édits de fichiers upstream existants) + `patches/additive-files.diff` (fichiers NOUVEAUX) + les tests sous `tests/unit/`. Régénérer AVANT chaque commit, depuis `ingestion/GitNexus/` :
  ```bash
  cd upstream && git add -N . && git diff HEAD --diff-filter=A > ../patches/additive-files.diff && git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff && git reset && cd ..
  node scripts/check-patch-drift.mjs
  ```
  `check-patch-drift.mjs` exit 1 si les diffs ne reflètent plus le working-tree — il DOIT être vert avant commit. Un nouveau composant = **additif** (zéro conflit au bump) ; éditer Header/backend-client/useAppState/App = **in-place**.
- **Branche & PR** : créer une NOUVELLE branche off le HEAD courant (`7178f31f`, lens 1b). Commit = `patches/*.diff` + `tests/unit/*` (+ ROADMAP.md/INVENTORY.md si le repo l'exige). PR à `RoJLD/GitNexus` (peut être stackée sur PR #2 `lens-phase1b` OPEN).
- **Le fork ne persiste JAMAIS** : il POST vers ELYSIUM, ne connaît pas le registre.
- **Preview = sans auth** (gateway read-only) ; **propose = Bearer** (token depuis `localStorage.getItem('elysium_bridge_token')` ; l'acquisition réelle du token Dex/K8s dans le navigateur = **GATE LIVE**, non testable unitairement — les tests mockent `fetch`).
- **Conventions fork** : Tailwind tokens (`bg-surface`, `bg-elevated`, `border-border-subtle`, `text-text-primary`/`text-text-secondary`/`text-text-muted`, `bg-accent`, `text-accent`, `hover:bg-hover`), icônes depuis `@/lib/lucide-icons` (JAMAIS `lucide-react`), toute chaîne UI via `t('header:...')`. Pré-garde JSON = `JSON.parse` try-catch natif, PAS zod.
- **Contrat backend consommé** (Plan A, dans main) :
  - `POST ${_backendUrl}/lens/preview` (défaut `_backendUrl='http://localhost:4747'`), body = spec JSON, SANS auth → `200` BrainGraph `{lens,nodes,relationships,meta,insights,meaning}` | `422 {ok:false,errors:[...]}` | `400 {ok:false,errors:[...]}` | `404 {error:...}`.
  - `POST ${_bridgeUrl}/elysium/lens/propose`, Bearer requis, body `{spec, auto_approve}` (PAS de `author` — dérivé server-side) → `{id, status}` ; `403` si `auto_approve` sans rôle approver ; `422` si spec vide.
- Chaque tâche : éditer working-tree → vitest vert → **régénérer patches + drift check** → commit.

---

### Task 1: backend-client — `previewLens`, `proposeLens`, base `_bridgeUrl`

**Files:**
- Modify: `upstream/gitnexus-web/src/services/backend-client.ts` (ajouts près des méthodes existantes, ex. après `fetchLensFreshness`)
- Test: `tests/unit/lens-authoring-client.test.ts` (create — suivre le harness d'un test unit existant du repo, ex. le style de `tests/unit/use-app-state-lens.test.tsx` pour le mock)
- Regenerate: `patches/inplace-edits.diff` (backend-client est upstream existant) + `patches/additive-files.diff`

**Interfaces:**
- Consumes (déjà dans le fichier) : `_backendUrl` (let module-level, défaut `'http://localhost:4747'`), `fetchWithTimeout(url, init?, timeoutMs?)`, `assertOk(response)`. Vérifier leurs noms exacts dans le fichier avant d'écrire (le fork a des mods non commitées → numéros de ligne décalés).
- Produces : `previewLens(spec) -> Promise<LensPreviewResult>` · `proposeLens(spec, autoApprove, token) -> Promise<{id,status}>` · `getBridgeUrl()`/`setBridgeUrl(url)` · type `LensPreviewResult = { ok: boolean; errors?: string[]; braingraph?: Record<string, unknown> }`.

- [ ] **Step 1: Write the failing test**

Crée `tests/unit/lens-authoring-client.test.ts`. Mock `global.fetch` (ou le helper utilisé par `fetchWithTimeout` — inspecter le fichier). Trois assertions :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { previewLens, proposeLens } from '@/services/backend-client';

const okResp = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

describe('lens authoring client', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('previewLens returns {ok:true, braingraph} on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResp(200, { lens: { name: 'x' }, nodes: [], relationships: [] })));
    const r = await previewLens({ name: 'x', source: { lens: 'sigil' } });
    expect(r.ok).toBe(true);
    expect(r.braingraph).toBeTruthy();
  });

  it('previewLens returns {ok:false, errors} on 422', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResp(422, { ok: false, errors: ['invalid color.scale'] })));
    const r = await previewLens({ name: 'x', color: { scale: 'NOPE' } });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toContain('color.scale');
  });

  it('proposeLens sends Bearer token and a body WITHOUT author', async () => {
    const fetchMock = vi.fn(async () => okResp(200, { id: 'abc123', status: 'approved' }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await proposeLens({ name: 'x', source: { lens: 'sigil' } }, true, 'TOK');
    expect(r.id).toBe('abc123');
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOK');
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({ spec: { name: 'x', source: { lens: 'sigil' } }, auto_approve: true });
    expect('author' in sent).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (depuis `ingestion/GitNexus/`, ou le dossier où vitest est configuré — vérifier `package.json` scripts) : `npm test -- tests/unit/lens-authoring-client.test.ts`
Expected : FAIL (`previewLens`/`proposeLens` not exported).

- [ ] **Step 3: Implémenter dans backend-client.ts**

Ajouter (près de `fetchLensFreshness`) :

```ts
// ── Lens Atelier (authoring) — POST preview (gateway, no auth) + propose (bridge-api, Bearer) ──
let _bridgeUrl = 'http://localhost:8000'; // ELYSIUM bridge-api; override via setBridgeUrl (prod: https://bridge.elysium.local)

export const setBridgeUrl = (url: string): void => { _bridgeUrl = url.replace(/\/$/, ''); };
export const getBridgeUrl = (): string => _bridgeUrl;

export interface LensPreviewResult {
  ok: boolean;
  errors?: string[];
  braingraph?: Record<string, unknown>; // {lens,nodes,relationships,meta,insights,meaning} on 200
}

export const previewLens = async (spec: Record<string, unknown>): Promise<LensPreviewResult> => {
  const response = await fetchWithTimeout(`${_backendUrl}/lens/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  });
  if (response.status === 200) {
    return { ok: true, braingraph: (await response.json()) as Record<string, unknown> };
  }
  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  const errors = Array.isArray((body as { errors?: unknown }).errors)
    ? ((body as { errors: string[] }).errors)
    : [String((body as { error?: unknown }).error ?? `HTTP ${response.status}`)];
  return { ok: false, errors };
};

export const proposeLens = async (
  spec: Record<string, unknown>,
  autoApprove: boolean,
  token: string,
): Promise<{ id: string; status: string }> => {
  const response = await fetchWithTimeout(`${_bridgeUrl}/elysium/lens/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ spec, auto_approve: autoApprove }), // NO author — server derives it
  });
  await assertOk(response);
  return (await response.json()) as { id: string; status: string };
};
```

Si `fetchWithTimeout`/`assertOk` ne sont pas dans le scope module (vérifier), utiliser les helpers réels du fichier. Les POST ont déjà `maxAttempts=1` (pas de retry) — ne rien changer à ce comportement.

- [ ] **Step 4: Run test to verify it passes**

Run : `npm test -- tests/unit/lens-authoring-client.test.ts`
Expected : PASS (3 tests).

- [ ] **Step 5: Régénérer patches + drift + commit**

```bash
cd upstream && git add -N . && git diff HEAD --diff-filter=A > ../patches/additive-files.diff && git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff && git reset && cd ..
node scripts/check-patch-drift.mjs
git add patches/inplace-edits.diff patches/additive-files.diff tests/unit/lens-authoring-client.test.ts
git commit -m "feat(lens): backend-client previewLens/proposeLens + bridge base [Lens Studio]"
```
Expected : `check-patch-drift.mjs` OK (exit 0).

---

### Task 2: `LensStudioModal.tsx` (composant additif)

**Files:**
- Create: `upstream/gitnexus-web/src/components/LensStudioModal.tsx`
- Test: `tests/unit/lens-studio-modal.test.tsx` (create)
- Regenerate: `patches/additive-files.diff` (nouveau composant) + `patches/inplace-edits.diff`

**Interfaces:**
- Consumes : rien de backend directement — deux callbacks props (le wiring Task 3 les branche). Icônes `@/lib/lucide-icons`, `useTranslation` de `react-i18next`.
- Produces : `LensStudioModal` (default export ou nommé) avec props :
  ```ts
  interface LensStudioModalProps {
    isOpen: boolean;
    onClose: () => void;
    onPreview: (spec: Record<string, unknown>) => Promise<{ ok: boolean; errors?: string[] }>;
    onPropose: (spec: Record<string, unknown>, autoApprove: boolean) => Promise<{ id: string; status: string }>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Crée `tests/unit/lens-studio-modal.test.tsx` (Testing-Library + Vitest, suivre le pattern d'un test composant existant) :

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LensStudioModal } from '@/components/LensStudioModal';

const noop = async () => ({ ok: true as const });
const specText = '{"name":"my_view","source":{"lens":"sigil"},"color":{"by":"domainType","scale":"categorical"}}';

describe('LensStudioModal', () => {
  it('does not render when closed', () => {
    const { container } = render(<LensStudioModal isOpen={false} onClose={() => {}} onPreview={noop} onPropose={async () => ({ id: 'i', status: 's' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('parses the textarea and calls onPreview with the canonical spec', async () => {
    const onPreview = vi.fn(async () => ({ ok: true }));
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={onPreview} onPropose={async () => ({ id: 'i', status: 's' })} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: specText } });
    fireEvent.click(screen.getByTestId ? screen.getByTestId('lens-preview-btn') : screen.getByText(/preview/i));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(JSON.parse(specText)));
  });

  it('shows a JSON error and does NOT call onPreview on invalid JSON', async () => {
    const onPreview = vi.fn(async () => ({ ok: true }));
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={onPreview} onPropose={async () => ({ id: 'i', status: 's' })} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{not json' } });
    fireEvent.click(screen.getByText(/preview/i));
    await waitFor(() => expect(screen.getByText(/json/i)).toBeInTheDocument());
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('calls onPropose with (spec, autoApprove)', async () => {
    const onPropose = vi.fn(async () => ({ id: 'abc', status: 'approved' }));
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={noop} onPropose={onPropose} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: specText } });
    fireEvent.click(screen.getByLabelText(/auto/i));            // check auto-approve
    fireEvent.click(screen.getByText(/propose/i));
    await waitFor(() => expect(onPropose).toHaveBeenCalledWith(JSON.parse(specText), true));
  });
});
```
(Adapter les sélecteurs — `getByText(/preview/i)` etc. — aux libellés i18n réels ajoutés en Task 3 ; en Task 2 le composant peut utiliser des clés `t('header:lensStudio.preview')` qui, sous le provider de test i18n, rendent la clé ou l'anglais. Suivre le pattern des tests composants existants pour le provider i18n.)

- [ ] **Step 2: Run — FAIL** (composant absent). Run : `npm test -- tests/unit/lens-studio-modal.test.tsx`

- [ ] **Step 3: Implémenter `LensStudioModal.tsx`**

```tsx
import { useState } from 'react';
import { X, Eye, Send, AlertCircle } from '@/lib/lucide-icons';
import { useTranslation } from 'react-i18next';

interface LensStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPreview: (spec: Record<string, unknown>) => Promise<{ ok: boolean; errors?: string[] }>;
  onPropose: (spec: Record<string, unknown>, autoApprove: boolean) => Promise<{ id: string; status: string }>;
}

const EXAMPLE = `{
  "name": "my_lens",
  "source": { "lens": "sigil" },
  "select": { "node_where": "inLens == true" },
  "color": { "by": "domainType", "scale": "categorical" },
  "meaning": "Ma lentille."
}`;

export const LensStudioModal = ({ isOpen, onClose, onPreview, onPropose }: LensStudioModalProps) => {
  const { t } = useTranslation(['header']);
  const [text, setText] = useState(EXAMPLE);
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const parse = (): Record<string, unknown> | null => {
    try {
      const spec = JSON.parse(text);
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        setErrors([t('header:lensStudio.notObject')]);
        return null;
      }
      setErrors([]);
      return spec as Record<string, unknown>;
    } catch (e) {
      setErrors([`${t('header:lensStudio.jsonError')}: ${(e as Error).message}`]);
      return null;
    }
  };

  const handlePreview = async () => {
    const spec = parse();
    if (!spec) return;
    setBusy(true); setToast(null);
    try {
      const r = await onPreview(spec);
      if (!r.ok) setErrors(r.errors ?? [t('header:lensStudio.unknownError')]);
    } finally { setBusy(false); }
  };

  const handlePropose = async () => {
    const spec = parse();
    if (!spec) return;
    setBusy(true); setToast(null);
    try {
      const r = await onPropose(spec, autoApprove);
      setToast(`${t('header:lensStudio.proposed')}: ${r.id} (${r.status})`);
    } catch (e) {
      setErrors([`${t('header:lensStudio.proposeFailed')}: ${(e as Error).message}`]);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[min(680px,calc(100vw-2rem))] max-h-[min(760px,calc(100vh-4rem))] overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-2xl flex flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-4 py-3">
          <Eye className="h-4 w-4 text-accent" />
          <span className="font-medium text-text-primary">{t('header:lensStudio.title')}</span>
          <button type="button" onClick={onClose} className="ml-auto cursor-pointer rounded p-1 text-text-muted transition-colors hover:bg-hover hover:text-text-primary" title={t('header:lensStudio.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-4 overflow-y-auto">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="h-64 w-full resize-y rounded-lg border border-border-subtle bg-void px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
          />
          {errors.length > 0 && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
              {errors.map((err, i) => (
                <div key={i} className="flex items-start gap-1.5"><AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /><span>{err}</span></div>
              ))}
            </div>
          )}
          {toast && <div className="rounded-lg border border-accent/40 bg-accent/10 p-2 text-xs text-accent">{toast}</div>}
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
            {t('header:lensStudio.autoApprove')}
          </label>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-4 py-3">
          <button type="button" data-testid="lens-preview-btn" onClick={handlePreview} disabled={busy}
            className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm text-text-primary transition-colors hover:bg-hover disabled:opacity-50">
            <Eye className="h-4 w-4" />{t('header:lensStudio.preview')}
          </button>
          <button type="button" onClick={handlePropose} disabled={busy}
            className="ml-auto flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent/90 disabled:opacity-50">
            <Send className="h-4 w-4" />{t('header:lensStudio.propose')}
          </button>
        </div>
      </div>
    </div>
  );
};
```
Vérifier que les icônes `Eye`, `Send`, `AlertCircle`, `X` sont exportées par `@/lib/lucide-icons` (sinon en choisir d'équivalentes présentes). Vérifier le token `bg-void` (sinon `bg-elevated`).

- [ ] **Step 4: Run — PASS** (4 tests). Run : `npm test -- tests/unit/lens-studio-modal.test.tsx`

- [ ] **Step 5: Régénérer patches + drift + commit**

```bash
cd upstream && git add -N . && git diff HEAD --diff-filter=A > ../patches/additive-files.diff && git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff && git reset && cd ..
node scripts/check-patch-drift.mjs
git add patches/additive-files.diff patches/inplace-edits.diff tests/unit/lens-studio-modal.test.tsx
git commit -m "feat(lens): LensStudioModal (expert textarea + preview/propose) [Lens Studio]"
```

---

### Task 3: Wiring — `useAppState.previewLens` + Header bouton + App modal + i18n

**Files:**
- Modify: `upstream/gitnexus-web/src/hooks/useAppState.tsx` (handler `previewLens` + exposition)
- Modify: `upstream/gitnexus-web/src/components/Header.tsx` (prop `onAddLens` + bouton)
- Modify: `upstream/gitnexus-web/src/App.tsx` (état modale + callbacks + `<LensStudioModal/>` + `onAddLens` au `<Header/>`)
- Modify: `upstream/gitnexus-web/src/locales/en/header.json` + `upstream/gitnexus-web/src/locales/zh-CN/header.json` (+ toute autre langue présente) + `upstream/gitnexus-web/src/i18n/resources.ts` si nécessaire
- Test: `tests/unit/use-app-state-preview-lens.test.tsx` (create)
- Regenerate: `patches/inplace-edits.diff` + `patches/additive-files.diff`

**Interfaces:**
- Consumes : `previewLens` (backend-client, Task 1), `LensPreviewResult`, `createKnowledgeGraph()`, `setGraph`, `applyLensMetadata` (tous déjà dans useAppState — cf `switchRepo`), `LensStudioModal` (Task 2), `proposeLens` (backend-client, Task 1).
- Produces : `useAppState().previewLens(spec) -> Promise<{ok, errors?}>` (fetch + rend dans le canvas si ok) ; `HeaderProps.onAddLens?: () => void`.

- [ ] **Step 1: Write the failing test — useAppState.previewLens rend dans le canvas**

Crée `tests/unit/use-app-state-preview-lens.test.tsx`, calqué sur le harness de `tests/unit/use-app-state-lens.test.tsx` (même façon d'accéder au hook + de mocker backend-client). Mock `previewLens` de backend-client :

```tsx
import { describe, it, expect, vi } from 'vitest';
// ... importer le harness du hook comme use-app-state-lens.test.tsx le fait ...
vi.mock('@/services/backend-client', async (orig) => ({
  ...(await orig()),
  previewLens: vi.fn(async () => ({ ok: true, braingraph: { lens: { name: 'p' }, nodes: [{ id: 'n1', label: 'CodeElement', properties: {} }], relationships: [], insights: [], meaning: 'm' } })),
}));

// Test A: previewLens ok -> setGraph reçoit un graphe non-null ET applyLensMetadata est appelé (panel lens non-inerte, cf gap #7).
// Test B: previewLens !ok -> pas de setGraph d'un nouveau graphe, retourne {ok:false, errors}.
```
Écrire les deux tests concrètement en réutilisant EXACTEMENT le mécanisme d'accès au store de `use-app-state-lens.test.tsx` (renderHook ou wrapper). Le point de vérification cardinal (Test A) : après `previewLens(spec)`, le graphe du store contient les nœuds ET `lensInsights`/`lensMeaning` sont posés (preuve que `applyLensMetadata` a bien été appelée — le gap #7 était précisément un chemin qui faisait `setGraph` SANS `applyLensMetadata`).

- [ ] **Step 2: Run — FAIL** (`previewLens` absent du store). Run : `npm test -- tests/unit/use-app-state-preview-lens.test.tsx`

- [ ] **Step 3: Ajouter `previewLens` à useAppState**

Dans `useAppState.tsx`, ajouter un handler qui réutilise le pattern de `switchRepo` (slow-path : `createKnowledgeGraph()` → `addNode`/`addRelationship` → `setGraph` → `applyLensMetadata`). Import `previewLens as previewLensApi` depuis backend-client.

```tsx
  const previewLens = useCallback(async (spec: Record<string, unknown>): Promise<{ ok: boolean; errors?: string[] }> => {
    const result = await previewLensApi(spec);
    if (!result.ok || !result.braingraph) return { ok: false, errors: result.errors };
    const bg = result.braingraph as { nodes?: unknown[]; relationships?: unknown[]; insights?: unknown[]; meaning?: string; lens?: { name?: string } };
    const newGraph = createKnowledgeGraph();
    for (const node of (bg.nodes ?? [])) newGraph.addNode(node as never);
    for (const rel of (bg.relationships ?? [])) newGraph.addRelationship(rel as never);
    setGraph(newGraph);
    // MÊME contrat que switchRepo — sinon le panneau insights/meaning reste inerte (gap #7).
    applyLensMetadata(
      { insights: (bg.insights ?? []) as never, meaning: bg.meaning, repoInfo: { family: 'authoring' } },
      bg.lens?.name ?? 'preview',
    );
    return { ok: true };
  }, [setGraph, applyLensMetadata]);
```
Exposer `previewLens` dans l'objet retourné par `useAppState` (là où `switchRepo`, `setGraph`, `applyLensMetadata` sont exposés) + l'ajouter au type du contrat du store. Vérifier la signature EXACTE d'`applyLensMetadata` dans le fichier (le grounding : `applyLensMetadata(result: {insights?, meaning?, repoInfo:{family?}}, pName)`), et de `createKnowledgeGraph`.

- [ ] **Step 4: Run — PASS** (Test A+B). Run : `npm test -- tests/unit/use-app-state-preview-lens.test.tsx`

- [ ] **Step 5: Header — prop `onAddLens` + bouton « + Lentille »**

Dans `Header.tsx` : ajouter `onAddLens?: () => void;` à `HeaderProps`, le destructurer, et ajouter un bouton dans le dropdown du switcher (symétrique de l'entrée `analyzeNew` « Analyze a new repository » — chercher `analyzeNew`), qui appelle `onAddLens?.()` :

```tsx
            <button
              type="button"
              onClick={() => { onAddLens?.(); setIsRepoDropdownOpen(false); }}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-accent transition-colors hover:bg-hover"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              {t('header:addLens')}
            </button>
```
(Importer `Plus` depuis `@/lib/lucide-icons` s'il n'y est pas déjà. Placer ce bouton près du bloc `groupedRepos`/`analyzeNew` dans le même dropdown.)

- [ ] **Step 6: App.tsx — état modale + callbacks + rendu**

Dans `App.tsx` : `import { LensStudioModal } from './components/LensStudioModal';` + `import { proposeLens } from './services/backend-client';` (ou le chemin réel). Ajouter :

```tsx
  const [lensStudioOpen, setLensStudioOpen] = useState(false);
  // useAppState() expose déjà previewLens (Task 3 step 3) :
  const proposeLensCb = useCallback(
    (spec: Record<string, unknown>, autoApprove: boolean) =>
      proposeLens(spec, autoApprove, localStorage.getItem('elysium_bridge_token') ?? ''),
    [],
  );
```
Passer `onAddLens={() => setLensStudioOpen(true)}` au `<Header ... />` (à côté de `onSwitchRepo={switchRepo}`), et rendre la modale (près des autres modales rendues dans App) :
```tsx
      <LensStudioModal
        isOpen={lensStudioOpen}
        onClose={() => setLensStudioOpen(false)}
        onPreview={previewLens}
        onPropose={proposeLensCb}
      />
```
(`previewLens` vient de la déstructuration de `useAppState()` — l'ajouter à la déstructuration si absente.)

- [ ] **Step 7: i18n — clés header**

Ajouter à `src/locales/en/header.json` :
```json
  "addLens": "+ New lens",
  "lensStudio": {
    "title": "Lens Studio",
    "preview": "Preview",
    "propose": "Propose",
    "autoApprove": "Auto-approve (approver role required)",
    "proposed": "Proposed",
    "proposeFailed": "Propose failed",
    "jsonError": "Invalid JSON",
    "notObject": "The spec must be a JSON object",
    "unknownError": "Unknown error",
    "close": "Close"
  }
```
Ajouter les équivalents traduits à `src/locales/zh-CN/header.json` (et toute autre langue présente sous `src/locales/`). Vérifier que `src/i18n/resources.ts` agrège déjà `header` (aucun changement si le namespace y est déjà importé statiquement).

- [ ] **Step 8: Run — suite complète du fork verte**

Run (depuis le dossier de test) : `npm test` (toute la suite unit, PAS de régression sur les tests lens existants comme `use-app-state-lens.test.tsx`).
Expected : PASS.

- [ ] **Step 9: Régénérer patches + drift + commit**

```bash
cd upstream && git add -N . && git diff HEAD --diff-filter=A > ../patches/additive-files.diff && git diff HEAD --diff-filter=M > ../patches/inplace-edits.diff && git reset && cd ..
node scripts/check-patch-drift.mjs
git add patches/inplace-edits.diff patches/additive-files.diff tests/unit/use-app-state-preview-lens.test.tsx
git commit -m "feat(lens): wire Lens Studio — useAppState.previewLens + Header +Lens + App modal + i18n [Lens Studio]"
```

---

## Self-Review

**Spec coverage** (design composant 4) : modale expert (textarea + preview + propose + auto-approve) → Task 2 ✅ ; preview WYSIWYG dans le canvas (setGraph+applyLensMetadata) → Task 3 ✅ ; POST gateway sans auth → Task 1 `previewLens` ✅ ; POST bridge-api Bearer sans author → Task 1 `proposeLens` ✅ ; `_bridgeUrl` nouvelle base → Task 1 ✅ ; i18n bilingue → Task 3 ✅ ; fork client-pur (jamais persister) → aucun accès registre, POST-only ✅. Le **guidé** (Phase 2) reste hors scope.

**Type consistency** : `LensPreviewResult` (Task 1) consommé par `useAppState.previewLens` (Task 3) ; `previewLens(spec)->Promise<{ok,errors?}>` et `proposeLens(spec,auto,token)->Promise<{id,status}>` cohérents entre backend-client (Task 1), la modale props (Task 2) et le wiring (Task 3). `applyLensMetadata` réutilisée avec la signature mesurée.

**Placeholder scan** : aucun TBD ; code complet à chaque step. Les sélecteurs de test i18n et les numéros de ligne sont explicitement « à vérifier contre le fichier réel » (le fork a des mods non commitées → lignes décalées) — c'est une instruction de vérification, pas un placeholder.

## Hors scope
Formulaire guidé (Phase 2) · YAML en entrée · édition/suppression de lentilles · l'acquisition réelle du token bridge-api dans le navigateur (**gate live**) · le rendu WYSIWYG live end-to-end (nécessite gateway + bridge-api + vite dev — gate live).
