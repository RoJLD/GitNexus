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

  // Follow-up (onPropose-rejection): handlePropose is the ONLY action wrapping
  // its callback in try/catch, because proposeLens THROWS on a non-2xx bridge
  // response (403 "auto_approve requires an approver role", a 422 spec reason,
  // or a transport failure) — unlike previewLens, which resolves {ok:false}.
  // That catch branch is the sole thing between a rejected Propose and an
  // unhandled promise with zero user feedback, yet no test exercised it: a
  // mutation deleting the catch left the suite fully green. This locks it —
  // the real bridge reason must reach the user, and no success toast may show.
  it('shows an error banner (with the real reason) and no success toast when onPropose rejects', async () => {
    const onPropose = vi.fn(async () => {
      throw new Error('auto_approve requires an approver role');
    });
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={noop} onPropose={onPropose} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: specText } });
    fireEvent.click(screen.getByText(/propose/i)); // unique before any error banner exists
    await waitFor(() => expect(screen.getByText(/lensStudio\.proposeFailed/i)).toBeInTheDocument());
    // the FastAPI reason is surfaced, never swallowed:
    expect(screen.getByText(/auto_approve requires an approver role/i)).toBeInTheDocument();
    // a rejected Propose must not leave a success toast on screen:
    expect(screen.queryByText(/lensStudio\.proposed:/i)).toBeNull();
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

  // Final-review fix (F4.c): the mirror of the test above. The mutation
  // `setErrors([])` -> `if (next === 'guided') setErrors([])` left the suite
  // fully green because only the expert -> guided direction was covered.
  it('clears a stale guided validation error when switching to expert mode', async () => {
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={async () => ({ ok: true })} onPropose={async () => ({ id: 'i', status: 's' })} />);
    fireEvent.click(screen.getByTestId('lens-mode-guided'));
    fireEvent.click(screen.getByTestId('lens-preview-btn'));
    await waitFor(() => expect(screen.getByText(/errors\.nameRequired/i)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('lens-mode-expert'));
    expect(screen.queryByText(/errors\.nameRequired/i)).toBeNull();
  });

  // Final-review fix (F4.b): removing `setToast(null)` from switchMode left the
  // suite green. A success toast from the other surface ("Preview rendered")
  // must not linger over a form the user has not previewed yet.
  it('clears a toast when switching mode', async () => {
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={async () => ({ ok: true })} onPropose={async () => ({ id: 'i', status: 's' })} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: specText } });
    fireEvent.click(screen.getByTestId('lens-preview-btn'));
    await waitFor(() => expect(screen.getByText(/lensStudio\.previewRendered/i)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('lens-mode-guided'));
    expect(screen.queryByText(/lensStudio\.previewRendered/i)).toBeNull();
  });

  // Final-review fix (F4.a): Propose is the ONLY action on this whole surface
  // with a persistent side effect (it writes to the sovereign canon), and it
  // was the one action never covered in guided mode. The mutation
  // `const spec = parse()` -> `const spec = JSON.parse(text)` in handlePropose
  // left the suite 22/22 green while sending the untouched EXAMPLE constant.
  it('in guided mode, Propose receives the spec BUILT BY THE FORM', async () => {
    const onPropose = vi.fn(async () => ({ id: 'abc', status: 'pending' }));
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={noop} onPropose={onPropose} />);
    fireEvent.click(screen.getByTestId('lens-mode-guided'));
    fireEvent.change(screen.getByTestId('guided-name'), { target: { value: 'my_view' } });
    fireEvent.change(screen.getByTestId('guided-source'), { target: { value: 'sigil' } });
    fireEvent.click(screen.getByText(/propose/i));
    await waitFor(() =>
      expect(onPropose).toHaveBeenCalledWith({ name: 'my_view', source: { lens: 'sigil' } }, false));
  });

  // Final-review fix (F2 — CRITICAL path): `parse()` returned
  // `formStateToSpec(form)` unconditionally in guided mode, so `if (!spec)
  // return;` never fired and a pristine form POSTed
  // {"name":"","source":{"lens":""}} into the canon. Measured, not theorised.
  it('in guided mode, an empty form shows errors and does NOT call onPropose', async () => {
    const onPropose = vi.fn(async () => ({ id: 'abc', status: 'pending' }));
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={noop} onPropose={onPropose} />);
    fireEvent.click(screen.getByTestId('lens-mode-guided'));
    fireEvent.click(screen.getByText(/propose/i));
    await waitFor(() => expect(screen.getByText(/errors\.nameRequired/i)).toBeInTheDocument());
    expect(screen.getByText(/errors\.sourceRequired/i)).toBeInTheDocument();
    expect(onPropose).not.toHaveBeenCalled();
  });

  it('in guided mode, a missing source lens alone blocks Preview', async () => {
    const onPreview = vi.fn(async () => ({ ok: true }));
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={onPreview} onPropose={async () => ({ id: 'i', status: 's' })} />);
    fireEvent.click(screen.getByTestId('lens-mode-guided'));
    fireEvent.change(screen.getByTestId('guided-name'), { target: { value: 'my_view' } });
    fireEvent.click(screen.getByTestId('lens-preview-btn'));
    await waitFor(() => expect(screen.getByText(/errors\.sourceRequired/i)).toBeInTheDocument());
    expect(onPreview).not.toHaveBeenCalled();
  });

  // Final-review fix (F1 — CRITICAL): the guard tested only the DIRECTION of
  // the switch, never whether the form held anything. Round-tripping through
  // guided mode without typing a character replaced 40 lines of hand-written
  // JSON with {"name":"","source":{"lens":""}} — no warning, no undo.
  it('expert -> guided -> expert leaves hand-written JSON intact when the form was never touched', () => {
    const precious = '{"name":"precious","source":{"lens":"sigil"},"meaning":"40 lines of work"}';
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={noop} onPropose={async () => ({ id: 'i', status: 's' })} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: precious } });
    fireEvent.click(screen.getByTestId('lens-mode-guided'));
    fireEvent.click(screen.getByTestId('lens-mode-expert'));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(precious);
  });

  // ...and the isomorphism proof still holds the moment the form IS touched
  // (Σ-SWITCHING-TO-EXPERT-REVEALS-THE-EMITTED-JSON is preserved, not traded away).
  it('expert -> guided -> expert DOES serialize once the form has been edited', () => {
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={noop} onPropose={async () => ({ id: 'i', status: 's' })} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"name":"old","source":{"lens":"old"}}' } });
    fireEvent.click(screen.getByTestId('lens-mode-guided'));
    fireEvent.change(screen.getByTestId('guided-name'), { target: { value: 'my_view' } });
    fireEvent.click(screen.getByTestId('lens-mode-expert'));
    expect(JSON.parse((screen.getByRole('textbox') as HTMLTextAreaElement).value))
      .toEqual({ name: 'my_view', source: { lens: '' } });
  });

  // F6: the segmented control communicated its state through a CSS class only.
  it('exposes the active mode through aria-pressed on the segmented control', () => {
    render(<LensStudioModal isOpen onClose={() => {}} onPreview={noop} onPropose={async () => ({ id: 'i', status: 's' })} />);
    expect(screen.getByTestId('lens-mode-expert')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('lens-mode-guided')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('lens-mode-guided'));
    expect(screen.getByTestId('lens-mode-guided')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('lens-mode-expert')).toHaveAttribute('aria-pressed', 'false');
  });
});
