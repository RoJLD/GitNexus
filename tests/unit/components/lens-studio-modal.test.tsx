// LensStudioModal — pure UI modal (JSON textarea + Preview/Propose), driven
// entirely by the two async callback props (`onPreview`/`onPropose`). No
// backend-client import here: Task 3 wires those callbacks to the real
// bridge; this test only verifies the component's own contract.
//
// i18n note: the component calls `t('header:lensStudio.*')`, but those keys
// are added to the resource bundle in Task 3 (not yet present on this
// branch). No test file in this repo renders a `useTranslation` component
// today (verified: `grep -rl "useTranslation" tests/` is empty), so there is
// no existing i18n test-provider pattern to copy.
//
// `react-i18next` itself is mocked below rather than rendered for real. Not
// a style choice — verified empirically that rendering the real hook here
// crashes with "Invalid hook call" / "Cannot read properties of null":
// `tests/` and `upstream/gitnexus-web/` are two independent `npm install`s
// with two different React 19 patch copies (19.2.6 vs 19.2.7, no symlink
// between them). react-i18next physically lives under
// `upstream/gitnexus-web/node_modules`, and its transitive
// `use-sync-external-store` shim does a raw CJS `require('react')` that
// resolves the *other* copy than the one @testing-library/react's
// `react-dom` (from `tests/node_modules`) set the hook dispatcher on —
// classic dual-React-copy breakage, pre-existing in the test harness and
// orthogonal to this component. Tried `resolve.alias`/`resolve.dedupe`/
// `server.deps.inline` in `tests/vitest.config.unit.mjs` first; alias+inline
// got react-i18next's own `useContext` to resolve the correct copy, but the
// crash then moved one layer deeper into `use-sync-external-store`'s CJS
// interop (`React` resolves `null` there) — a rabbit hole out of scope for
// a UI-component task. Mocking `useTranslation` to echo the raw key
// (matching react-i18next's own "no instance" fallback shape, see
// `notReadyT` in `react-i18next/src/useTranslation.js`) keeps this test
// scoped to LensStudioModal's own logic (JSON parsing, error display,
// calling the two callback props) without depending on that harness defect.
// Selectors below prefer `data-testid` (`lens-preview-btn`) where the
// component provides one, per the task brief, to avoid coupling to i18n
// text at all; the remaining `getByText`/`getByLabelText` regexes are loose
// enough to match either the mocked raw-key fallback (today) or real
// English copy (once Task 3 lands the translations and a real i18n
// integration test, if any, is added separately).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mocking the bare specifier 'react-i18next' does NOT work here: vitest
// resolves the mock target relative to *this* file, which can't reach
// react-i18next at all (it only exists under upstream/gitnexus-web's own
// node_modules — verified: resolving the bare specifier from tests/unit/
// fails outright). LensStudioModal.tsx, physically inside
// upstream/gitnexus-web/src, resolves it to a different absolute module id
// than anything reachable from here, so a bare-specifier `vi.mock` silently
// doesn't match and the real (harness-broken, see below) hook still runs.
// Mocking the resolved absolute file makes the id match exactly.
vi.mock('../../../upstream/gitnexus-web/node_modules/react-i18next/dist/es/index.js', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

// Same dual-React-copy defect (see block comment above) also hits
// lucide-react's <Icon> internals (it reads a size/color/strokeWidth
// default via `useContext(IconContext)` — Icon.ts). `@/lib/lucide-icons` is
// a *source* file (resolves consistently via the `@` alias both here and in
// the component, unlike node_modules-internal imports), so it can be
// mocked normally by specifier. Icons are decorative here — no assertion
// below depends on their actual SVG output — so stub them out.
vi.mock('@/lib/lucide-icons', () => {
  const Stub = (props: Record<string, unknown>) => <svg {...props} />;
  return { X: Stub, Eye: Stub, Send: Stub, AlertCircle: Stub };
});

import { LensStudioModal } from '@/components/LensStudioModal';

const noop = async () => ({ ok: true as const });
const specText = '{"name":"my_view","source":{"lens":"sigil"},"color":{"by":"domainType","scale":"categorical"}}';

describe('LensStudioModal', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <LensStudioModal isOpen={false} onClose={() => {}} onPreview={noop} onPropose={async () => ({ id: 'i', status: 's' })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('parses the textarea and calls onPreview with the canonical spec', async () => {
    const onPreview = vi.fn(async () => ({ ok: true }));
    render(
      <LensStudioModal isOpen onClose={() => {}} onPreview={onPreview} onPropose={async () => ({ id: 'i', status: 's' })} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: specText } });
    fireEvent.click(screen.getByTestId('lens-preview-btn'));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(JSON.parse(specText)));
  });

  it('shows a JSON error and does NOT call onPreview on invalid JSON', async () => {
    const onPreview = vi.fn(async () => ({ ok: true }));
    render(
      <LensStudioModal isOpen onClose={() => {}} onPreview={onPreview} onPropose={async () => ({ id: 'i', status: 's' })} />,
    );
    // Brief's fixture ('{not json') is avoided: a controlled <textarea>'s
    // value renders as its own text-node content, so getByText(/json/i)
    // would then match BOTH the textarea (echoing the raw input) and the
    // error <span> — "Found multiple elements" (verified). '{not valid'
    // still fails JSON.parse the same way without colliding with the
    // "...jsonError..." text the component renders for the error.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{not valid' } });
    fireEvent.click(screen.getByTestId('lens-preview-btn'));
    await waitFor(() => expect(screen.getByText(/json/i)).toBeInTheDocument());
    expect(onPreview).not.toHaveBeenCalled();
  });

  // Fix 3 (final review): the modal renders as a full-screen backdrop over
  // the canvas, so a successful Preview (canvas recolor happening behind
  // the modal) is otherwise invisible to the user — no feedback at all.
  // On the ok path, handlePreview must set a success toast.
  it('shows a success toast on {ok:true} Preview (canvas recolor is hidden behind the modal)', async () => {
    const onPreview = vi.fn(async () => ({ ok: true }));
    render(
      <LensStudioModal isOpen onClose={() => {}} onPreview={onPreview} onPropose={async () => ({ id: 'i', status: 's' })} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: specText } });
    fireEvent.click(screen.getByTestId('lens-preview-btn'));
    await waitFor(() => expect(screen.getByText(/lensStudio\.previewRendered/i)).toBeInTheDocument());
  });

  it('calls onPropose with (spec, autoApprove)', async () => {
    const onPropose = vi.fn(async () => ({ id: 'abc', status: 'approved' }));
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={noop} onPropose={onPropose} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: specText } });
    fireEvent.click(screen.getByLabelText(/auto/i)); // check auto-approve
    fireEvent.click(screen.getByText(/propose/i));
    await waitFor(() => expect(onPropose).toHaveBeenCalledWith(JSON.parse(specText), true));
  });

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

  // Review fix: a JSON parse error is impossible in guided mode (parse() never
  // JSON.parse's in that branch), so a stale error banner from a prior expert
  // attempt must not survive the switch INTO guided mode.
  it('clears a stale expert JSON error when switching to guided mode', async () => {
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={async () => ({ ok: true })} onPropose={async () => ({ id: 'i', status: 's' })} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{not valid' } });
    fireEvent.click(screen.getByTestId('lens-preview-btn'));
    await waitFor(() => expect(screen.getByText(/json/i)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('lens-mode-guided'));
    expect(screen.queryByText(/json/i)).toBeNull();
  });
});
