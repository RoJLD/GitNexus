import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import GanttPanel from '../../../upstream/gitnexus-web/src/components/GanttPanel';
import {
  _seedCacheForTests,
  invalidateGhostsCache,
} from '../../../upstream/gitnexus-web/src/services/ghosts-client';
import {
  _seedCacheForTests as _seedClustersCacheForTests,
  invalidateClustersCache,
} from '../../../upstream/gitnexus-web/src/services/clusters-client';

describe('GanttPanel', () => {
  beforeEach(() => {
    invalidateGhostsCache();
    invalidateClustersCache();
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
    await waitFor(() => expect(screen.getByTestId('gantt-swimlanes-radio')).toBeInTheDocument());

    // Flat mode initially — no group headers.
    expect(screen.queryByText(/^Tier 1$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Tier 2$/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('gantt-swimlanes-tier'));

    // Both tier headers should now be visible.
    expect(screen.getByText('Tier 1')).toBeInTheDocument();
    expect(screen.getByText('Tier 2')).toBeInTheDocument();
  });

  it('renders cluster lane headers when swimlanes=cluster', async () => {
    _seedCacheForTests('cluster-repo', {
      syncedAt: '2026-05-26T00:00:00Z',
      syncedCommit: 'abc',
      ghosts: [
        {
          id: 'g1',
          declared: {
            id: 'g1',
            tier: '1.4',
            title: 'Alpha',
            description: '',
            status: 'planned',
            expectedLinks: [],
            dependsOn: [],
          },
          plannedAt: { commit: 'a', date: '2026-04-01' },
          materializedAt: null,
          cancelledAt: null,
          links: [],
        },
        {
          id: 'g2',
          declared: {
            id: 'g2',
            tier: '2.3',
            title: 'Beta',
            description: '',
            status: 'planned',
            expectedLinks: [],
            dependsOn: [],
          },
          plannedAt: { commit: 'b', date: '2026-04-05' },
          materializedAt: null,
          cancelledAt: null,
          links: [],
        },
      ],
    });
    _seedClustersCacheForTests('cluster-repo', {
      syncedAt: '2026-05-26T00:00:00Z',
      syncedCommit: 'abc',
      clusters: [
        {
          id: 'cluster-foo',
          source: 'declared',
          title: 'Foo cluster',
          expectedBy: null,
          memberIds: ['g1', 'g2'],
          synthesizedStatus: 'planned',
          aggregate: {
            total: 2,
            materialized: 0,
            planned: 2,
            expired: 0,
            cancelled: 0,
            completionPct: 0,
          },
          plannedAt: { commit: 'a', date: '2026-04-01' },
          materializedAt: null,
          cancelledAt: null,
        },
      ],
    });

    render(<GanttPanel repo="cluster-repo" />);
    await waitFor(() => expect(screen.getByTestId('gantt-swimlanes-radio')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('gantt-swimlanes-cluster'));

    // Cluster lane header is rendered. The label embeds completion %
    // and the synthesizedStatus so the user gets the overview in-place.
    await waitFor(() => {
      expect(screen.getByText(/Foo cluster/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Foo cluster/).textContent).toMatch(/0%.*planned/);
  });

  it('collapses members into a single synthetic bar when "Cluster bars only" is on', async () => {
    _seedCacheForTests('collapse-repo', {
      syncedAt: '2026-05-26T00:00:00Z',
      syncedCommit: 'abc',
      ghosts: [
        {
          id: 'g1',
          declared: {
            id: 'g1',
            tier: '1.4',
            title: 'Alpha-bar',
            description: '',
            status: 'planned',
            expectedLinks: [],
            dependsOn: [],
          },
          plannedAt: { commit: 'a', date: '2026-04-01' },
          materializedAt: null,
          cancelledAt: null,
          links: [],
        },
        {
          id: 'g2',
          declared: {
            id: 'g2',
            tier: '2.3',
            title: 'Beta-bar',
            description: '',
            status: 'planned',
            expectedLinks: [],
            dependsOn: [],
          },
          plannedAt: { commit: 'b', date: '2026-04-05' },
          materializedAt: null,
          cancelledAt: null,
          links: [],
        },
      ],
    });
    _seedClustersCacheForTests('collapse-repo', {
      syncedAt: '2026-05-26T00:00:00Z',
      syncedCommit: 'abc',
      clusters: [
        {
          id: 'cluster-bar',
          source: 'declared',
          title: 'Bar cluster',
          expectedBy: null,
          memberIds: ['g1', 'g2'],
          synthesizedStatus: 'planned',
          aggregate: {
            total: 2,
            materialized: 0,
            planned: 2,
            expired: 0,
            cancelled: 0,
            completionPct: 0,
          },
          plannedAt: { commit: 'a', date: '2026-04-01' },
          materializedAt: null,
          cancelledAt: null,
        },
      ],
    });

    render(<GanttPanel repo="collapse-repo" />);
    await waitFor(() => expect(screen.getByTestId('gantt-swimlanes-radio')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('gantt-swimlanes-cluster'));
    await waitFor(() =>
      expect(screen.getByTestId('gantt-show-only-cluster-bars')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('gantt-show-only-cluster-bars'));

    // After collapse, individual ghost titles should no longer have
    // their own bar row — only the synthetic cluster header label
    // remains as a row anchor.
    await waitFor(() => {
      expect(screen.queryByText('Alpha-bar')).not.toBeInTheDocument();
      expect(screen.queryByText('Beta-bar')).not.toBeInTheDocument();
    });
  });

  it('applies the ghostFilters prop (Tier filter excludes non-matching rows)', async () => {
    _seedCacheForTests('filt-repo', {
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
            status: 'planned',
            expectedLinks: [],
            dependsOn: [],
          },
          plannedAt: { commit: 'a', date: '2026-04-01' },
          materializedAt: null,
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
            status: 'planned',
            expectedLinks: [],
            dependsOn: [],
          },
          plannedAt: { commit: 'b', date: '2026-04-05' },
          materializedAt: null,
          cancelledAt: null,
          links: [],
        },
      ],
    });
    render(
      <GanttPanel
        repo="filt-repo"
        ghostFilters={{ showGhosts: true, tiers: ['1'], showCancelled: false }}
      />,
    );
    await waitFor(() => expect(screen.getByText('Tier1 ghost')).toBeInTheDocument());
    expect(screen.queryByText('Tier2 ghost')).not.toBeInTheDocument();
  });

  it('shows a "filtered out" message when filters exclude every ghost', async () => {
    _seedCacheForTests('all-filt-repo', {
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
            status: 'planned',
            expectedLinks: [],
            dependsOn: [],
          },
          plannedAt: { commit: 'a', date: '2026-04-01' },
          materializedAt: null,
          cancelledAt: null,
          links: [],
        },
      ],
    });
    render(
      <GanttPanel
        repo="all-filt-repo"
        ghostFilters={{ showGhosts: false, tiers: ['1', '2', '3'], showCancelled: false }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/no ghosts match the current filters/i)).toBeInTheDocument(),
    );
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
