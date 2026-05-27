import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

  it('expands into swimlane headers when the toggle is on', async () => {
    _seedCacheForTests('swim-repo', {
      syncedAt: '2026-05-26T00:00:00Z',
      syncedCommit: 'abc',
      ghosts: [
        {
          id: 'g1',
          declared: {
            id: 'g1',
            tier: '1.4',
            title: 'Tier1 ghost',
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
        {
          id: 'g2',
          declared: {
            id: 'g2',
            tier: '2.3',
            title: 'Tier2 ghost',
            description: '',
            status: 'materialized',
            expectedLinks: [],
            dependsOn: [],
          },
          plannedAt: { commit: 'c', date: '2026-04-05' },
          materializedAt: { commit: 'd', date: '2026-04-20', confirmedBy: 'manual' },
          cancelledAt: null,
          links: [],
        },
      ],
    });
    render(<GanttPanel repo="swim-repo" />);
    await waitFor(() => expect(screen.getByTestId('gantt-swimlanes-toggle')).toBeInTheDocument());

    // Flat mode initially — no group headers.
    expect(screen.queryByText(/^Tier 1$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Tier 2$/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('gantt-swimlanes-toggle'));

    // Both tier headers should now be visible.
    expect(screen.getByText('Tier 1')).toBeInTheDocument();
    expect(screen.getByText('Tier 2')).toBeInTheDocument();
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
