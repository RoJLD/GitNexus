/**
 * Section H / Task 13 — ClustersCard.
 *
 * Pure render component: no fetch, no router. Verifies:
 *  - hidden when clusters is empty,
 *  - shows N + median completion + expired badge,
 *  - propagates `onClick`.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ClustersCard from '../../../../upstream/gitnexus-web/src/components/audit/ClustersCard';
import type { ClusterRuntime } from '../../../../upstream/gitnexus-web/src/services/clusters-client';

const makeCluster = (id: string, pct: number, status: ClusterRuntime['synthesizedStatus'] = 'planned'): ClusterRuntime => ({
  id,
  source: 'declared',
  title: `cluster-${id}`,
  expectedBy: null,
  memberIds: ['g1', 'g2'],
  synthesizedStatus: status,
  aggregate: {
    total: 2,
    materialized: status === 'shipped' ? 2 : 0,
    planned: status === 'shipped' ? 0 : 2,
    expired: status === 'expired' ? 1 : 0,
    cancelled: status === 'cancelled' ? 2 : 0,
    completionPct: pct,
  },
  plannedAt: null,
  materializedAt: null,
  cancelledAt: null,
});

describe('ClustersCard', () => {
  it('renders nothing when clusters is empty', () => {
    const { container } = render(<ClustersCard clusters={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders N + median completion across clusters', () => {
    render(
      <ClustersCard
        clusters={[
          makeCluster('a', 10),
          makeCluster('b', 50),
          makeCluster('c', 90),
        ]}
      />,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Clusters')).toBeInTheDocument();
    expect(screen.getByText(/50%\s?median/i)).toBeInTheDocument();
  });

  it('surfaces an expired badge when any cluster has expired status', () => {
    render(
      <ClustersCard
        clusters={[makeCluster('a', 0, 'expired'), makeCluster('b', 75)]}
      />,
    );
    expect(screen.getByText(/1\s?expired/)).toBeInTheDocument();
  });

  it('propagates onClick when the card is clicked', () => {
    const onClick = vi.fn();
    render(<ClustersCard clusters={[makeCluster('a', 33)]} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('stat-clusters'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
