import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuditSummary from '../../../../upstream/gitnexus-web/src/components/audit/AuditSummary';

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
});
