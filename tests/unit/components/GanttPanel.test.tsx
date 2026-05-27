import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import GanttPanel from '../../../upstream/gitnexus-web/src/components/GanttPanel';
import {
  _seedCacheForTests,
  invalidateGhostsCache,
} from '../../../upstream/gitnexus-web/src/services/ghosts-client';

describe('GanttPanel', () => {
  beforeEach(() => {
    invalidateGhostsCache();
  });

  it('shows loading state initially', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(<GanttPanel repo="sample-repo" />);
    expect(screen.getByText(/loading gantt/i)).toBeInTheDocument();
  });

  it('renders the not-synced state on HTTP 404', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ status: 404, ok: false, json: async () => ({}) } as unknown as Response),
    ) as unknown as typeof fetch;
    render(<GanttPanel repo="sample-repo" />);
    await waitFor(() => expect(screen.getByText(/not synced/i)).toBeInTheDocument());
  });

  it('renders the empty state when no ghosts', async () => {
    // Seed the in-memory cache so the component skips network entirely.
    _seedCacheForTests('empty-repo', {
      syncedAt: '2026-05-26T00:00:00Z',
      syncedCommit: 'abc',
      ghosts: [],
    });
    render(<GanttPanel repo="empty-repo" />);
    await waitFor(() => expect(screen.getByText(/no ghosts/i)).toBeInTheDocument());
  });

  it('renders rows when ghosts are returned', async () => {
    _seedCacheForTests('sample-repo', {
      syncedAt: '2026-05-26T00:00:00Z',
      syncedCommit: 'abc',
      ghosts: [
        {
          id: 'g1',
          declared: {
            id: 'g1',
            tier: '1.4',
            title: 'Entropy panel',
            description: '',
            status: 'materialized',
            expectedLinks: [],
            dependsOn: [],
          },
          plannedAt: { commit: 'a', date: '2026-04-01' },
          materializedAt: { commit: 'b', date: '2026-04-08', confirmedBy: 'manual' },
          cancelledAt: null,
          links: [],
        },
      ],
    });
    render(<GanttPanel repo="sample-repo" />);
    await waitFor(() => expect(screen.getByText('Entropy panel')).toBeInTheDocument());
    expect(screen.getByTestId('gantt-panel')).toBeInTheDocument();
  });

  it('exposes a CSV export button', async () => {
    _seedCacheForTests('csv-repo', {
      syncedAt: '2026-05-26T00:00:00Z',
      syncedCommit: 'abc',
      ghosts: [
        {
          id: 'g1',
          declared: {
            id: 'g1',
            tier: '1.4',
            title: 'X',
            description: '',
            status: 'materialized',
            expectedLinks: [],
            dependsOn: [],
          },
          plannedAt: { commit: 'a', date: '2026-04-01' },
          materializedAt: { commit: 'b', date: '2026-04-08', confirmedBy: 'manual' },
          cancelledAt: null,
          links: [],
        },
      ],
    });
    render(<GanttPanel repo="csv-repo" />);
    await waitFor(() => expect(screen.getByTestId('gantt-export-csv')).toBeInTheDocument());
  });
});
