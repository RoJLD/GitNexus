import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import GhostTable from '../../../../upstream/gitnexus-web/src/components/audit/GhostTable';

const ghosts = [
  {
    id: 'g1',
    tier: 'T1',
    declared: { title: 'Alpha' },
    materializedAt: { date: '2026-04-01' },
    churn: 2,
    leadTimeDays: 5,
  },
  {
    id: 'g2',
    tier: 'T2',
    declared: { title: 'Bravo' },
    plannedAt: { date: '2026-03-01' },
    churn: 7,
    leadTimeDays: null,
  },
  {
    id: 'g3',
    tier: 'T1',
    declared: { title: 'Charlie' },
    cancelledAt: { date: '2026-05-01' },
    churn: 0,
    leadTimeDays: null,
  },
];

describe('GhostTable', () => {
  it('renders one row per ghost', () => {
    render(<GhostTable ghosts={ghosts as any} />);
    expect(screen.getByTestId('row-g1')).toBeInTheDocument();
    expect(screen.getByTestId('row-g2')).toBeInTheDocument();
    expect(screen.getByTestId('row-g3')).toBeInTheDocument();
    expect(screen.getByTestId('row-count')).toHaveTextContent('3 of 3');
  });

  it('invokes onGhostSelect when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<GhostTable ghosts={ghosts as any} onGhostSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('row-g2'));
    expect(onSelect).toHaveBeenCalledWith('g2');
  });

  it('highlights the row matching highlightedId', () => {
    render(<GhostTable ghosts={ghosts as any} highlightedId="g2" />);
    expect(screen.getByTestId('row-g2').className).toMatch(/row-highlighted/);
    expect(screen.getByTestId('row-g1').className).not.toMatch(/row-highlighted/);
  });

  it('filters by status', () => {
    render(<GhostTable ghosts={ghosts as any} />);
    const select = screen.getByTestId('filter-status') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'cancelled' } });
    expect(screen.queryByTestId('row-g1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-g2')).not.toBeInTheDocument();
    expect(screen.getByTestId('row-g3')).toBeInTheDocument();
  });

  it('sorts by the churn column ascending then descending on a second click', () => {
    render(<GhostTable ghosts={ghosts as any} />);
    fireEvent.click(screen.getByTestId('sort-churn'));
    const rowsAsc = within(document.querySelector('tbody') as HTMLElement).getAllByRole('row');
    expect(rowsAsc[0]).toHaveAttribute('data-testid', 'row-g3'); // churn 0
    expect(rowsAsc[2]).toHaveAttribute('data-testid', 'row-g2'); // churn 7
    fireEvent.click(screen.getByTestId('sort-churn'));
    const rowsDesc = within(document.querySelector('tbody') as HTMLElement).getAllByRole('row');
    expect(rowsDesc[0]).toHaveAttribute('data-testid', 'row-g2'); // churn 7
  });
});
