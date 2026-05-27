/**
 * Section F / Task 10 — ClusterTooltip popup.
 *
 * Renders against an in-memory cluster object; no fetch, no router.
 * Verifies the title, the source badge, the synthesizedStatus pill,
 * the expectedBy line, the completion %, and that clicking a member
 * row propagates to `onMemberClick`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ClusterTooltip, {
  type ClusterTooltipData,
} from '../../../upstream/gitnexus-web/src/components/ClusterTooltip';

const baseCluster: ClusterTooltipData = {
  id: 'gantt-roadmap-cluster',
  source: 'declared',
  title: 'Gantt roadmap cluster',
  expectedBy: '2026-Q3',
  synthesizedStatus: 'planned',
  memberIds: ['ghost-a', 'ghost-b', 'ghost-c'],
  aggregate: {
    total: 3,
    materialized: 1,
    planned: 2,
    expired: 0,
    cancelled: 0,
    completionPct: 33.33,
  },
};

describe('ClusterTooltip', () => {
  it('renders title, source badge, synthesizedStatus, expectedBy, completion', () => {
    render(
      <ClusterTooltip cluster={baseCluster} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Gantt roadmap cluster')).toBeInTheDocument();
    expect(screen.getByTestId('cluster-source-badge').textContent).toMatch(/declared/i);
    expect(screen.getByTestId('cluster-status-badge').textContent).toMatch(/planned/i);
    expect(screen.getByTestId('cluster-expected-by').textContent).toMatch(/2026-Q3/);
    expect(screen.getByTestId('cluster-completion').textContent).toMatch(/33\s?%/);
  });

  it('renders the members list with one row per member', () => {
    render(<ClusterTooltip cluster={baseCluster} onClose={vi.fn()} />);
    const list = screen.getByTestId('cluster-member-list');
    expect(list.querySelectorAll('li')).toHaveLength(3);
    // Default labels fall back to the raw id when no member map is given.
    expect(screen.getByTestId('cluster-member-ghost-a')).toBeInTheDocument();
  });

  it('uses friendly member titles when a members map is provided', () => {
    render(
      <ClusterTooltip
        cluster={baseCluster}
        members={{
          'ghost-a': { id: 'ghost-a', title: 'Alpha bar', status: 'materialized' },
          'ghost-b': { id: 'ghost-b', title: 'Beta bar', status: 'planned' },
          'ghost-c': { id: 'ghost-c', title: 'Gamma bar', status: 'cancelled' },
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Alpha bar')).toBeInTheDocument();
    expect(screen.getByText('Beta bar')).toBeInTheDocument();
    expect(screen.getByText('Gamma bar')).toBeInTheDocument();
  });

  it('fires onMemberClick with the ghost id', () => {
    const onMemberClick = vi.fn();
    render(
      <ClusterTooltip
        cluster={baseCluster}
        onClose={vi.fn()}
        onMemberClick={onMemberClick}
      />,
    );
    fireEvent.click(screen.getByTestId('cluster-member-ghost-b'));
    expect(onMemberClick).toHaveBeenCalledWith('ghost-b');
  });

  it('fires onClose when the × button is clicked', () => {
    const onClose = vi.fn();
    render(<ClusterTooltip cluster={baseCluster} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('highlights the auto source with a different badge tone', () => {
    render(
      <ClusterTooltip
        cluster={{ ...baseCluster, source: 'auto', title: 'Auto cluster' }}
        onClose={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('cluster-source-badge');
    expect(badge.textContent).toMatch(/auto/i);
    expect(badge.className).toMatch(/amber/);
  });

  it('omits the expectedBy line when the cluster has no target date', () => {
    render(
      <ClusterTooltip
        cluster={{ ...baseCluster, expectedBy: null }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('cluster-expected-by')).not.toBeInTheDocument();
  });

  it('renders the expired status pill', () => {
    render(
      <ClusterTooltip
        cluster={{ ...baseCluster, synthesizedStatus: 'expired' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('cluster-status-badge').textContent).toMatch(/expired/i);
  });
});
