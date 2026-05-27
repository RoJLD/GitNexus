import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AuditPanel from '../../../../upstream/gitnexus-web/src/components/AuditPanel';

describe('AuditPanel', () => {
  it('renders the loading skeleton initially', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any; // never resolves
    render(<AuditPanel repo="sample-repo" />);
    expect(screen.getByText(/loading audit/i)).toBeInTheDocument();
  });

  it('renders error banner on 404', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'not synced' }) }),
    ) as any;
    render(<AuditPanel repo="sample-repo" />);
    await waitFor(() => expect(screen.getByText(/run sync/i)).toBeInTheDocument());
  });

  it('renders summary + sub-components after successful fetch', async () => {
    const audit = {
      computedAt: '2026-05-26T00:00:00Z',
      cached: false,
      summary: { total: 5, materialized: 3, planned: 1, cancelled: 1, cancellationRate: 0.2 },
      leadTime: { medianDays: 5, p25Days: 3, p75Days: 8, maxDays: 10, distribution: [] },
      slippage: { early: 1, onTime: 1, late: 1, noTarget: 0, onTimePct: 0.33 },
      planChurn: { totalGhostsWithChurn: 0, avgChurnPerGhost: 0, topChurners: [] },
      velocity: { windowDays: 28, currentCount: 2, history: [] },
      expired: { total: 0, critical: 0, expiredButRecent: 0, list: [] },
    };
    const ghosts = { ghosts: [] };
    global.fetch = vi.fn((url: any) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => (String(url).includes('audit') ? audit : ghosts),
      }),
    ) as any;
    render(<AuditPanel repo="sample-repo" />);
    await waitFor(() => expect(screen.getByText(/5 ghosts/i)).toBeInTheDocument());
  });
});
