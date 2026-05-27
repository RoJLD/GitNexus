/**
 * Section E / Task 10 — ghost filters block.
 *
 * The existing Filters UI lives inside `FileTreePanel.tsx` as a tab,
 * but the new "Roadmap predictive" hierarchical block is extracted
 * into its own `GhostFiltersSection` component so it can be exercised
 * in isolation here. The rest of the FileTreePanel (file tree,
 * NodeType toggles, EdgeType toggles, depth filter) is not in scope
 * for this test — those are covered by other suites or by the e2e.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GhostFiltersSection from '../../../upstream/gitnexus-web/src/components/GhostFiltersSection';
import { DEFAULT_GHOST_FILTERS } from '../../../upstream/gitnexus-web/src/lib/ghost-layout';

describe('GhostFiltersSection', () => {
  it('master toggle is unchecked by default and sub-toggles are hidden', () => {
    render(
      <GhostFiltersSection
        ghostFilters={DEFAULT_GHOST_FILTERS}
        setGhostFilters={vi.fn()}
      />,
    );
    const master = screen.getByLabelText(/show ghosts/i) as HTMLInputElement;
    expect(master.checked).toBe(false);
    expect(screen.queryByLabelText(/^tier 1$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/show cancelled ghosts/i)).not.toBeInTheDocument();
  });

  it('clicking the master toggle calls setGhostFilters with showGhosts: true', () => {
    const setGhostFilters = vi.fn();
    render(
      <GhostFiltersSection
        ghostFilters={DEFAULT_GHOST_FILTERS}
        setGhostFilters={setGhostFilters}
      />,
    );
    fireEvent.click(screen.getByLabelText(/show ghosts/i));
    expect(setGhostFilters).toHaveBeenCalledWith(
      expect.objectContaining({ showGhosts: true }),
    );
  });

  it('renders per-Tier checkboxes + cancelled toggle when ghosts are on', () => {
    render(
      <GhostFiltersSection
        ghostFilters={{ ...DEFAULT_GHOST_FILTERS, showGhosts: true }}
        setGhostFilters={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/^tier 1$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^tier 2$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^tier 3$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/show cancelled ghosts/i)).toBeInTheDocument();
  });

  it('unchecking a tier removes it from the filters list', () => {
    const setGhostFilters = vi.fn();
    render(
      <GhostFiltersSection
        ghostFilters={{ ...DEFAULT_GHOST_FILTERS, showGhosts: true }}
        setGhostFilters={setGhostFilters}
      />,
    );
    // Tier 2 is checked by default — click it to uncheck.
    fireEvent.click(screen.getByLabelText(/^tier 2$/i));
    expect(setGhostFilters).toHaveBeenCalledWith(
      expect.objectContaining({ tiers: expect.not.arrayContaining(['2']) }),
    );
  });

  it('checking a missing tier adds it (and re-sorts)', () => {
    const setGhostFilters = vi.fn();
    render(
      <GhostFiltersSection
        ghostFilters={{ ...DEFAULT_GHOST_FILTERS, showGhosts: true, tiers: ['2'] }}
        setGhostFilters={setGhostFilters}
      />,
    );
    fireEvent.click(screen.getByLabelText(/^tier 1$/i));
    expect(setGhostFilters).toHaveBeenCalledWith(
      expect.objectContaining({ tiers: ['1', '2'] }),
    );
  });

  it('toggling "Show cancelled ghosts" updates showCancelled', () => {
    const setGhostFilters = vi.fn();
    render(
      <GhostFiltersSection
        ghostFilters={{ ...DEFAULT_GHOST_FILTERS, showGhosts: true }}
        setGhostFilters={setGhostFilters}
      />,
    );
    fireEvent.click(screen.getByLabelText(/show cancelled ghosts/i));
    expect(setGhostFilters).toHaveBeenCalledWith(
      expect.objectContaining({ showCancelled: true }),
    );
  });

  // ── Section I / Task 14 — cluster halo filters ─────────────────────

  it('renders the cluster-halos master toggle when the prop set is wired', () => {
    render(
      <GhostFiltersSection
        ghostFilters={DEFAULT_GHOST_FILTERS}
        setGhostFilters={vi.fn()}
        showClusterHalos={false}
        setShowClusterHalos={vi.fn()}
        includeAutoClusters={false}
        setIncludeAutoClusters={vi.fn()}
        clusterSourceFilter="both"
        setClusterSourceFilter={vi.fn()}
      />,
    );
    expect(screen.getByTestId('toggle-show-cluster-halos')).toBeInTheDocument();
    // Sub-toggles + radio are hidden until the master is on.
    expect(screen.queryByTestId('toggle-include-auto-clusters')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cluster-source-radio')).not.toBeInTheDocument();
  });

  it('clicking master cluster toggle calls setShowClusterHalos', () => {
    const setShowClusterHalos = vi.fn();
    render(
      <GhostFiltersSection
        ghostFilters={DEFAULT_GHOST_FILTERS}
        setGhostFilters={vi.fn()}
        showClusterHalos={false}
        setShowClusterHalos={setShowClusterHalos}
        includeAutoClusters={false}
        setIncludeAutoClusters={vi.fn()}
        clusterSourceFilter="both"
        setClusterSourceFilter={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('toggle-show-cluster-halos'));
    expect(setShowClusterHalos).toHaveBeenCalledWith(true);
  });

  it('exposes include-auto + source radio once master cluster toggle is on', () => {
    render(
      <GhostFiltersSection
        ghostFilters={DEFAULT_GHOST_FILTERS}
        setGhostFilters={vi.fn()}
        showClusterHalos={true}
        setShowClusterHalos={vi.fn()}
        includeAutoClusters={false}
        setIncludeAutoClusters={vi.fn()}
        clusterSourceFilter="both"
        setClusterSourceFilter={vi.fn()}
      />,
    );
    expect(screen.getByTestId('toggle-include-auto-clusters')).toBeInTheDocument();
    expect(screen.getByTestId('cluster-source-radio')).toBeInTheDocument();
    // 3 options are mutually exclusive — only one is checked.
    const both = screen.getByTestId('cluster-source-both') as HTMLInputElement;
    const decl = screen.getByTestId('cluster-source-declared') as HTMLInputElement;
    const auto = screen.getByTestId('cluster-source-auto') as HTMLInputElement;
    expect(both.checked).toBe(true);
    expect(decl.checked).toBe(false);
    expect(auto.checked).toBe(false);
  });

  it('selecting a different cluster source calls setClusterSourceFilter (radio mutex)', () => {
    const setClusterSourceFilter = vi.fn();
    render(
      <GhostFiltersSection
        ghostFilters={DEFAULT_GHOST_FILTERS}
        setGhostFilters={vi.fn()}
        showClusterHalos={true}
        setShowClusterHalos={vi.fn()}
        includeAutoClusters={false}
        setIncludeAutoClusters={vi.fn()}
        clusterSourceFilter="both"
        setClusterSourceFilter={setClusterSourceFilter}
      />,
    );
    fireEvent.click(screen.getByTestId('cluster-source-declared'));
    expect(setClusterSourceFilter).toHaveBeenCalledWith('declared');
  });
});
