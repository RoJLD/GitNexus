import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import GanttBar from '../../../../upstream/gitnexus-web/src/components/gantt/GanttBar';

describe('GanttBar', () => {
  // Dummy linear scale — just maps ms onto a small numeric range.
  const scale = (d: Date) => d.getTime() / 1e10;

  it('renders a solid rect for kind=solid', () => {
    const { container } = render(
      <svg>
        <GanttBar
          bar={{ kind: 'solid', startDate: '2026-04-01', endDate: '2026-04-30', color: '#5b9bd5' }}
          scale={scale}
          y={0}
          height={10}
          title="solid bar"
        />
      </svg>,
    );
    const rect = container.querySelector('rect');
    expect(rect).toBeTruthy();
    expect(rect?.getAttribute('fill')).toBe('#5b9bd5');
    expect(rect?.getAttribute('stroke-dasharray')).toBeFalsy();
  });

  it('renders a dashed rect for kind=dashed', () => {
    const { container } = render(
      <svg>
        <GanttBar
          bar={{ kind: 'dashed', startDate: '2026-04-01', endDate: '2026-04-30', color: '#5b9bd5' }}
          scale={scale}
          y={0}
          height={10}
          title="dashed bar"
        />
      </svg>,
    );
    const rect = container.querySelector('rect');
    expect(rect?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(rect?.getAttribute('fill')).toBe('none');
    expect(rect?.getAttribute('stroke')).toBe('#5b9bd5');
  });

  it('renders a circle for kind=dot', () => {
    const { container } = render(
      <svg>
        <GanttBar
          bar={{ kind: 'dot', startDate: '2026-04-01', endDate: null, color: '#5b9bd5' }}
          scale={scale}
          y={0}
          height={10}
          title="dot bar"
        />
      </svg>,
    );
    expect(container.querySelector('circle')).toBeTruthy();
    expect(container.querySelector('circle')?.getAttribute('fill')).toBe('#5b9bd5');
  });

  it('renders a grey rect for kind=grey', () => {
    const { container } = render(
      <svg>
        <GanttBar
          bar={{ kind: 'grey', startDate: '2026-04-01', endDate: '2026-04-30', color: '#888' }}
          scale={scale}
          y={0}
          height={10}
          title="cancelled bar"
        />
      </svg>,
    );
    const rect = container.querySelector('rect');
    expect(rect?.getAttribute('fill')).toBe('#888');
    expect(rect?.getAttribute('opacity')).toBe('0.4');
  });

  it('exposes the title as SVG <title> for native hover tooltip', () => {
    const { container } = render(
      <svg>
        <GanttBar
          bar={{ kind: 'solid', startDate: '2026-04-01', endDate: '2026-04-30', color: '#5b9bd5' }}
          scale={scale}
          y={0}
          height={10}
          title="My ghost (materialized)"
        />
      </svg>,
    );
    expect(container.querySelector('title')?.textContent).toBe('My ghost (materialized)');
  });
});
