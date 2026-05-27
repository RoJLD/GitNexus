import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CleanupModal from '../../../../upstream/gitnexus-web/src/components/audit/CleanupModal';

describe('CleanupModal', () => {
  it('does not render when closed', () => {
    const { container } = render(<CleanupModal repo="r" open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "no expired ghosts" when list is empty', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ expired: [] }) })) as any;
    render(<CleanupModal repo="r" open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/clean/i)).toBeInTheDocument());
  });

  it('renders expired entries with prompts', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        expired: [{ id: 'g1', title: 'Foo', daysPastExpiry: 42, alertLevel: 'critical', prompt: 'prompt-A' }],
      }),
    })) as any;
    render(<CleanupModal repo="r" open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Foo')).toBeInTheDocument());
    expect(screen.getByText(/42d past/i)).toBeInTheDocument();
  });
});
