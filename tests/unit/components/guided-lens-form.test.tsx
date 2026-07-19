// GuidedLensForm — the 2nd input surface for Lens Studio (guided mode).
//
// i18n / mock note: copied VERBATIM from lens-studio-modal.test.tsx. `tests/`
// and `upstream/gitnexus-web/` are two independent npm installs (two React 19
// patch copies), so rendering the real `react-i18next` hook here crashes with
// "Invalid hook call" — see that file's header comment for the full forensic
// trail. Mocking the resolved absolute module id (not the bare specifier)
// keeps this scoped to GuidedLensForm's own logic (onChange reporting).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../upstream/gitnexus-web/node_modules/react-i18next/dist/es/index.js', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

vi.mock('@/lib/lucide-icons', () => {
  const Stub = (props: Record<string, unknown>) => <svg {...props} />;
  return { X: Stub, Eye: Stub, Send: Stub, AlertCircle: Stub };
});

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

  // Final-review fix (F4): only 3 of the 10 controls were covered. Swapping
  // `set({ colorBy: ... })` for `set({ meaning: ... })` on the colour input
  // left the suite 22/22 green — a control wired to the WRONG state key is
  // invisible to a test that never touches it. Every control now pins the
  // exact `LensFormState` key it must patch.
  it.each([
    ['guided-meaning', 'Ma lentille.', 'meaning', 'Ma lentille.'],
    ['guided-color-by', 'domainType', 'colorBy', 'domainType'],
    ['guided-color-scale', 'heat', 'colorScale', 'heat'],
    ['guided-insight-n', '5', 'insightTopN', 5],
    ['guided-insight-by', 'pagerank', 'insightBy', 'pagerank'],
  ])('%s patches LensFormState.%s', (testId, typed, key, expected) => {
    const onChange = vi.fn();
    render(<GuidedLensForm state={EMPTY_FORM_STATE} onChange={onChange} />);
    fireEvent.change(screen.getByTestId(testId as string), { target: { value: typed } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ [key as string]: expected }));
  });

  it.each([
    ['guided-pred-op', 'in', 'op', 'in'],
    ['guided-pred-value', 'critical', 'value', 'critical'],
  ])('%s patches the predicate row\'s `%s`', (testId, typed, key, expected) => {
    const onChange = vi.fn();
    render(<GuidedLensForm state={EMPTY_FORM_STATE} onChange={onChange} />);
    fireEvent.change(screen.getByTestId(testId as string), { target: { value: typed } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ predicates: [expect.objectContaining({ [key as string]: expected })] }),
    );
  });

  // A number input in badInput state (type `3` then `e`) reports value '' —
  // the state must follow, so `validateFormState` can flag it instead of the
  // insight block being dropped while the screen still shows its content.
  it('reports a blanked number input as `` rather than NaN', () => {
    const onChange = vi.fn();
    render(<GuidedLensForm state={{ ...EMPTY_FORM_STATE, insightTopN: 3 }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('guided-insight-n'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ insightTopN: '' }));
  });

  // F6: neither <select> is wrapped in a <label> (unlike the three text
  // fields), so without a title a screen reader announces "listbox, ==" and
  // never names what the control drives. No <select> in this fork is left bare.
  it('gives both selects an accessible name', () => {
    render(<GuidedLensForm state={EMPTY_FORM_STATE} onChange={vi.fn()} />);
    expect(screen.getByTestId('guided-pred-op')).toHaveAttribute('title', 'header:lensStudio.guided.op');
    expect(screen.getByTestId('guided-color-scale')).toHaveAttribute('title', 'header:lensStudio.guided.scale');
  });
});
