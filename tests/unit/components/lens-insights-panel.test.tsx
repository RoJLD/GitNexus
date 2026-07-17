import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LensInsightsPanel } from '../../../upstream/gitnexus-web/src/components/LensInsightsPanel';

describe('LensInsightsPanel', () => {
  it('renders meaning + a single insight (name and value visible)', () => {
    render(
      <LensInsightsPanel
        meaning="Services critiques."
        insights={[{ id: 'x', name: 'X', value: 9 }]}
      />,
    );
    expect(screen.getByText('Services critiques.')).toBeInTheDocument();
    expect(screen.getByText('X')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('returns null (renders nothing) when meaning and insights are both empty', () => {
    const { container } = render(<LensInsightsPanel meaning="" insights={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null (renders nothing) when meaning and insights are both undefined', () => {
    const { container } = render(<LensInsightsPanel meaning={undefined} insights={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders multiple insights in the order received', () => {
    render(
      <LensInsightsPanel
        meaning={undefined}
        insights={[
          { id: 'a', name: 'Alpha', value: 1 },
          { id: 'b', name: 'Beta', value: 2 },
          { id: 'c', name: 'Gamma', value: 3 },
        ]}
      />,
    );
    const rows = screen.getAllByTestId('lens-insight-row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Alpha:1',
      'Beta:2',
      'Gamma:3',
    ]);
  });

  it('renders an insight without a name using its id as fallback label', () => {
    render(<LensInsightsPanel meaning={undefined} insights={[{ id: 'no-name', value: 5 }]} />);
    expect(screen.getByText('no-name')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
