import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VelocitySparkline from '../../../../upstream/gitnexus-web/src/components/audit/VelocitySparkline';

describe('VelocitySparkline', () => {
  it('renders the currentCount and a polyline when there are >= 2 history points', () => {
    render(
      <VelocitySparkline
        data={{
          windowDays: 28,
          currentCount: 7,
          history: [
            { weekStarting: '2026-04-01', count: 2 },
            { weekStarting: '2026-04-08', count: 3 },
            { weekStarting: '2026-04-15', count: 5 },
            { weekStarting: '2026-04-22', count: 7 },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('current-count')).toHaveTextContent('7');
    expect(screen.getByTestId('sparkline-polyline')).toBeInTheDocument();
  });

  it('hides the polyline when history has < 2 points but still shows currentCount', () => {
    render(
      <VelocitySparkline
        data={{ windowDays: 28, currentCount: 0, history: [] }}
      />,
    );
    expect(screen.getByTestId('current-count')).toHaveTextContent('0');
    expect(screen.queryByTestId('sparkline-polyline')).not.toBeInTheDocument();
  });
});
