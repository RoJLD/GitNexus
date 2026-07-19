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
});
