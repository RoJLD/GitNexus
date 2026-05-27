import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SlippageBar from '../../../../upstream/gitnexus-web/src/components/audit/SlippageBar';

describe('SlippageBar', () => {
  it('renders 4 segments + the onTimePct text', () => {
    render(
      <SlippageBar
        data={{ early: 2, onTime: 5, late: 3, noTarget: 1, onTimePct: 0.5 }}
      />,
    );
    expect(screen.getByTestId('segment-early')).toBeInTheDocument();
    expect(screen.getByTestId('segment-onTime')).toBeInTheDocument();
    expect(screen.getByTestId('segment-late')).toBeInTheDocument();
    expect(screen.getByTestId('segment-noTarget')).toBeInTheDocument();
    expect(screen.getByTestId('on-time-pct')).toHaveTextContent(/50\.0\s?%/);
  });

  it('falls back to a dash when onTimePct is null', () => {
    render(
      <SlippageBar
        data={{ early: 0, onTime: 0, late: 0, noTarget: 4, onTimePct: null }}
      />,
    );
    expect(screen.getByTestId('on-time-pct')).toHaveTextContent('—');
  });
});
