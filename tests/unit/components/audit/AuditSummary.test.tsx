import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AuditSummary from '../../../../upstream/gitnexus-web/src/components/audit/AuditSummary';
import type { ClusterRuntime } from '../../../../upstream/gitnexus-web/src/services/clusters-client';

const stubCluster = (id: string, pct = 50): ClusterRuntime => ({
  id,
  source: 'declared',
  title: `cluster-${id}`,
  expectedBy: null,
  memberIds: ['g1', 'g2'],
  synthesizedStatus: 'planned',
  aggregate: {
    total: 2,
    materialized: 1,
    planned: 1,
    expired: 0,
    cancelled: 0,
    completionPct: pct,
  },
  plannedAt: null,
  materializedAt: null,
  cancelledAt: null,
});

describe('AuditSummary', () => {
  it('renders 5 cards without the expired block', () => {
    const { container } = render(
      <AuditSummary
        data={{ total: 27, materialized: 24, planned: 2, cancelled: 1, cancellationRate: 0.037 }}
      />,
    );
    expect(screen.getByText('27')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText(/3\.7\s?%/)).toBeInTheDocument();
    expect(container.querySelectorAll('.stat')).toHaveLength(5);
  });

  it('renders 6 cards (including Expired with red badge) when expired.total > 0', () => {
    const { container } = render(
      <AuditSummary
        data={{ total: 27, materialized: 24, planned: 2, cancelled: 1, cancellationRate: 0.037 }}
        expired={{ total: 3, critical: 1, expiredButRecent: 2, list: [] }}
      />,
    );
    expect(container.querySelectorAll('.stat')).toHaveLength(6);
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByTestId('stat-expired')).toBeInTheDocument();
    expect(screen.getByText(/1 critical/)).toBeInTheDocument();
  });

  it('hides the Expired card when expired.total === 0', () => {
    const { container } = render(
      <AuditSummary
        data={{ total: 5, materialized: 5, planned: 0, cancelled: 0, cancellationRate: 0 }}
        expired={{ total: 0, critical: 0, expiredButRecent: 0, list: [] }}
      />,
    );
    expect(container.querySelectorAll('.stat')).toHaveLength(5);
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });

  it('fires onExpiredClick when the Expired card is clicked', () => {
    const onExpiredClick = vi.fn();
    render(
      <AuditSummary
        data={{ total: 27, materialized: 24, planned: 2, cancelled: 1, cancellationRate: 0.037 }}
        expired={{ total: 3, critical: 1, expiredButRecent: 2, list: [] }}
        onExpiredClick={onExpiredClick}
      />,
    );
    fireEvent.click(screen.getByTestId('stat-expired'));
    expect(onExpiredClick).toHaveBeenCalledTimes(1);
  });

  it('renders a 7th Clusters card when the clusters prop is non-empty', () => {
    const { container } = render(
      <AuditSummary
        data={{ total: 27, materialized: 24, planned: 2, cancelled: 1, cancellationRate: 0.037 }}
        clusters={[stubCluster('a'), stubCluster('b')]}
      />,
    );
    expect(container.querySelectorAll('.stat')).toHaveLength(6);
    expect(screen.getByTestId('stat-clusters')).toBeInTheDocument();
    expect(screen.getByText('Clusters')).toBeInTheDocument();
  });

  it('renders both Expired (6th) and Clusters (7th) cards when both props are present', () => {
    const { container } = render(
      <AuditSummary
        data={{ total: 27, materialized: 24, planned: 2, cancelled: 1, cancellationRate: 0.037 }}
        expired={{ total: 3, critical: 1, expiredButRecent: 2, list: [] }}
        clusters={[stubCluster('a'), stubCluster('b'), stubCluster('c')]}
      />,
    );
    expect(container.querySelectorAll('.stat')).toHaveLength(7);
    expect(screen.getByTestId('stat-expired')).toBeInTheDocument();
    expect(screen.getByTestId('stat-clusters')).toBeInTheDocument();
  });

  it('fires onClustersClick when the Clusters card is clicked', () => {
    const onClustersClick = vi.fn();
    render(
      <AuditSummary
        data={{ total: 27, materialized: 24, planned: 2, cancelled: 1, cancellationRate: 0.037 }}
        clusters={[stubCluster('a')]}
        onClustersClick={onClustersClick}
      />,
    );
    fireEvent.click(screen.getByTestId('stat-clusters'));
    expect(onClustersClick).toHaveBeenCalledTimes(1);
  });
});
