import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GanttRow from '../../../../upstream/gitnexus-web/src/components/gantt/GanttRow';

describe('GanttRow', () => {
  const baseRow = {
    ghostId: 'g1',
    title: 'My ghost feature',
    tier: '2.3',
    status: 'materialized' as const,
    bars: [
      {
        kind: 'solid' as const,
        startDate: '2026-04-01',
        endDate: '2026-04-15',
        color: '#5b9bd5',
      },
    ],
  };
  const scale = (d: Date) => d.getTime() / 1e10;

  it('renders label + bars area', () => {
    render(
      <svg>
        <GanttRow row={baseRow} scale={scale} y={0} height={20} labelWidth={150} onClick={vi.fn()} />
      </svg>,
    );
    expect(screen.getByText('My ghost feature')).toBeInTheDocument();
  });

  it('truncates labels longer than 28 chars with an ellipsis', () => {
    const row = { ...baseRow, title: 'A very very very very long ghost title that exceeds twenty-eight' };
    render(
      <svg>
        <GanttRow row={row} scale={scale} y={0} height={20} labelWidth={150} onClick={vi.fn()} />
      </svg>,
    );
    const label = document.querySelector('text');
    expect(label?.textContent?.length).toBeLessThanOrEqual(28);
    expect(label?.textContent?.endsWith('…')).toBe(true);
  });

  it('calls onClick with ghostId on click', () => {
    const onClick = vi.fn();
    render(
      <svg>
        <GanttRow row={baseRow} scale={scale} y={0} height={20} labelWidth={150} onClick={onClick} />
      </svg>,
    );
    fireEvent.click(screen.getByText('My ghost feature'));
    expect(onClick).toHaveBeenCalledWith('g1');
  });

  it('renders one GanttBar per row bar', () => {
    const row = {
      ...baseRow,
      bars: [
        { kind: 'solid' as const, startDate: '2026-04-01', endDate: '2026-04-15', color: '#5b9bd5' },
        { kind: 'dashed' as const, startDate: '2026-04-15', endDate: '2026-05-01', color: '#e1aa55' },
      ],
    };
    const { container } = render(
      <svg>
        <GanttRow row={row} scale={scale} y={0} height={20} labelWidth={150} onClick={vi.fn()} />
      </svg>,
    );
    expect(container.querySelectorAll('rect').length).toBe(2);
  });
});
