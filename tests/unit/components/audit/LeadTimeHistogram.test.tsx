import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LeadTimeHistogram from '../../../../upstream/gitnexus-web/src/components/audit/LeadTimeHistogram';

describe('LeadTimeHistogram', () => {
  it('renders one bar per bucket with the bucket label visible', () => {
    const data = {
      medianDays: 5,
      p25Days: 3,
      p75Days: 8,
      maxDays: 32,
      distribution: [
        { bucket: '0-7d', count: 4 },
        { bucket: '7-14d', count: 2 },
        { bucket: '14-30d', count: 1 },
        { bucket: '30d+', count: 1 },
      ],
    };
    render(<LeadTimeHistogram data={data} />);
    expect(screen.getByTestId('lead-time-histogram')).toBeInTheDocument();
    expect(screen.getByTestId('bar-0-7d')).toBeInTheDocument();
    expect(screen.getByTestId('bar-7-14d')).toBeInTheDocument();
    expect(screen.getByTestId('bar-14-30d')).toBeInTheDocument();
    expect(screen.getByTestId('bar-30d+')).toBeInTheDocument();
    expect(screen.getByText('0-7d')).toBeInTheDocument();
    expect(screen.getByText(/median 5d/i)).toBeInTheDocument();
  });

  it('returns null when distribution is empty', () => {
    const { container } = render(
      <LeadTimeHistogram
        data={{
          medianDays: null,
          p25Days: null,
          p75Days: null,
          maxDays: null,
          distribution: [],
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
