import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GhostTooltip from '../../../upstream/gitnexus-web/src/components/GhostTooltip';

const sampleGhost = {
  id: 'tier-2-3-what-if',
  declared: {
    id: 'tier-2-3-what-if',
    tier: '2.3',
    title: 'What-if simulator',
    description: 'Mutations symboliques sans exécution.',
    status: 'planned' as const,
    expectedLinks: [
      { kind: 'path' as const, value: 'services/mutation-engine.ts' },
      { kind: 'path' as const, value: 'WhatIfPanel.tsx' },
    ],
    dependsOn: [],
  },
  plannedAt: { commit: 'aaa', date: '2026-05-01T00:00:00Z' },
  materializedAt: null,
  cancelledAt: null,
  links: [],
};

describe('GhostTooltip', () => {
  it('renders title, tier badge, and description', () => {
    render(
      <GhostTooltip
        ghost={sampleGhost}
        matchedNodeIds={[]}
        onClose={vi.fn()}
        onOpenRoadmap={vi.fn()}
      />,
    );
    expect(screen.getByText('What-if simulator')).toBeInTheDocument();
    expect(screen.getByText(/Tier 2\.3/)).toBeInTheDocument();
    expect(screen.getByText(/Mutations symboliques/)).toBeInTheDocument();
  });

  it('marks expectedLinks as matched / unmatched', () => {
    render(
      <GhostTooltip
        ghost={sampleGhost}
        matchedNodeIds={['upstream/WhatIfPanel.tsx']}
        onClose={vi.fn()}
        onOpenRoadmap={vi.fn()}
      />,
    );
    const matchedRow = screen.getByText('WhatIfPanel.tsx').closest('li');
    expect(matchedRow?.textContent).toContain('✓');
    const unmatchedRow = screen.getByText('services/mutation-engine.ts').closest('li');
    expect(unmatchedRow?.textContent).toContain('✗');
  });

  it('calls onOpenRoadmap when the button is clicked', () => {
    const onOpenRoadmap = vi.fn();
    render(
      <GhostTooltip
        ghost={sampleGhost}
        matchedNodeIds={[]}
        onClose={vi.fn()}
        onOpenRoadmap={onOpenRoadmap}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /open.*roadmap/i }));
    expect(onOpenRoadmap).toHaveBeenCalledWith(sampleGhost.declared.id);
  });

  it('calls onClose when the × button is clicked', () => {
    const onClose = vi.fn();
    render(
      <GhostTooltip
        ghost={sampleGhost}
        matchedNodeIds={[]}
        onClose={onClose}
        onOpenRoadmap={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders label-style expectedLinks as badges', () => {
    const ghost = {
      ...sampleGhost,
      declared: {
        ...sampleGhost.declared,
        expectedLinks: [
          { kind: 'path' as const, value: 'foo.ts' },
          { kind: 'label' as const, value: 'Class' },
        ],
      },
    };
    render(
      <GhostTooltip
        ghost={ghost}
        matchedNodeIds={[]}
        onClose={vi.fn()}
        onOpenRoadmap={vi.fn()}
      />,
    );
    expect(screen.getByText('Class')).toBeInTheDocument();
  });
});
