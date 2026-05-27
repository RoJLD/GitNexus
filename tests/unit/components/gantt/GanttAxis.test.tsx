import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import GanttAxis from '../../../../upstream/gitnexus-web/src/components/gantt/GanttAxis';

describe('GanttAxis', () => {
  it('renders monthly ticks + today line', () => {
    const { container } = render(
      <GanttAxis
        window={{ start: new Date('2026-01-01'), end: new Date('2026-12-31') }}
        width={1200}
        height={20}
        now={new Date('2026-06-15')}
      />,
    );
    // 12 months → at least 12 tick groups (line + text).
    expect(container.querySelectorAll('text').length).toBeGreaterThanOrEqual(12);
    // Today line should exist and be unique.
    const lines = container.querySelectorAll('line.today');
    expect(lines.length).toBe(1);
  });

  it('today line uses the alert color', () => {
    const { container } = render(
      <GanttAxis
        window={{ start: new Date('2026-01-01'), end: new Date('2026-12-31') }}
        width={1200}
        height={20}
        now={new Date('2026-06-15')}
      />,
    );
    const today = container.querySelector('line.today');
    expect(today?.getAttribute('stroke')).toBe('#e74c3c');
  });
});
