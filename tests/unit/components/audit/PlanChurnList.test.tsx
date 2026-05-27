import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlanChurnList from '../../../../upstream/gitnexus-web/src/components/audit/PlanChurnList';

describe('PlanChurnList', () => {
  it('renders one row per top churner and invokes onSelectChurner on click', () => {
    const onSelect = vi.fn();
    render(
      <PlanChurnList
        topChurners={[
          { id: 'ghost-1', churn: 7, deltas: [] },
          { id: 'ghost-2', churn: 4, deltas: [] },
          { id: 'ghost-3', churn: 3, deltas: [] },
        ]}
        onSelectChurner={onSelect}
      />,
    );
    expect(screen.getByTestId('churner-ghost-1')).toBeInTheDocument();
    expect(screen.getByTestId('churner-ghost-2')).toBeInTheDocument();
    expect(screen.getByTestId('churner-ghost-3')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('churner-ghost-2'));
    expect(onSelect).toHaveBeenCalledWith('ghost-2');
  });

  it('renders an empty-state when topChurners is empty', () => {
    render(<PlanChurnList topChurners={[]} onSelectChurner={() => {}} />);
    expect(screen.getByText(/no churn/i)).toBeInTheDocument();
  });
});
