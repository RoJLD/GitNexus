/**
 * Commit-level time-travel (spec 2026-05-28 §3.2) — Timeline "Commits" mode.
 *
 * Mocks `useAppState` (Timeline pulls dozens of fields) + fetch (/snapshots
 * pour ≥2 points => la timeline rend, /commits pour le mode Commits).
 * Mirrors the setup of Timeline.augmented.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('/snapshots')) {
      return { ok: true, json: async () => ({ snapshots: [
        { name: 'demo@aaa', key: 'demo@aaa', commit: { shortHash: 'aaa', message: 'first', author: 'a', date: '2026-05-10T00:00:00Z' } },
        { name: 'demo@bbb', key: 'demo@bbb', commit: { shortHash: 'bbb', message: 'second', author: 'a', date: '2026-05-20T00:00:00Z' } },
      ] }) };
    }
    if (u.startsWith('/commits')) {
      return { ok: true, json: async () => ({ repo: 'demo', commits: [
        { hash: 'h_new', shortHash: 'hnew', message: 'newest', author: 'a', date: '2026-05-20T00:00:00Z' },
        { hash: 'h_old', shortHash: 'hold', message: 'oldest', author: 'a', date: '2026-05-10T00:00:00Z' },
      ], truncated: false }) };
    }
    return { ok: true, json: async () => ({}) };
  });
});

const defaultAppState = {
  projectName: 'demo',
  availableRepos: [{ name: 'demo', indexedAt: '2026-05-25T00:00:00Z' }],
  switchRepo: vi.fn(),
  exitDiffMode: vi.fn(), diffMode: null,
  churnActive: false, churnLoading: false, churnError: null, churnTotalSnapshots: 0, enterChurnMode: vi.fn(), exitChurnMode: vi.fn(),
  couplingActive: false, couplingLoading: false, couplingError: null, enterCouplingMode: vi.fn(), exitCouplingMode: vi.fn(),
  growthActive: false, growthLoading: false, growthError: null, enterGrowthMode: vi.fn(), exitGrowthMode: vi.fn(),
  lifespanActive: false, lifespanLoading: false, lifespanError: null, enterLifespanMode: vi.fn(), exitLifespanMode: vi.fn(),
  ownershipActive: false, ownershipLoading: false, ownershipError: null, enterOwnershipMode: vi.fn(), exitOwnershipMode: vi.fn(),
  dissonanceActive: false, dissonanceLoading: false, dissonanceError: null, enterDissonanceMode: vi.fn(), exitDissonanceMode: vi.fn(),
  similarityActive: false, similarityLoading: false, similarityError: null, enterSimilarityMode: vi.fn(), exitSimilarityMode: vi.fn(),
  whatIfPanelOpen: false, whatIfActive: false, whatIfMutations: [], exitWhatIfMode: vi.fn(), setWhatIfMutations: vi.fn(), setWhatIfPanelOpen: vi.fn(),
  entropyCommitsActive: false, enterEntropyCommitsMode: vi.fn(), exitEntropyCommitsMode: vi.fn(),
  cachedSnapshotNames: new Set(), preloadingSnapshots: false, preloadProgress: null, preloadError: null,
  preloadAllSnapshots: vi.fn(), cancelPreload: vi.fn(), clearSnapshotCache: vi.fn(),
  cursorA: null, cursorB: null, zoomWindow: null, graphMode: 'single',
  setCursorA: vi.fn(), setCursorB: vi.fn(), enterZoom: vi.fn(), exitZoom: vi.fn(), setGraphMode: vi.fn(),
  temporalFilterMode: 'off', setTemporalFilterMode: vi.fn(), temporalFilterLoading: false,
  ghostFilters: { showGhosts: false, tiers: ['1', '2', '3'], showCancelled: false }, setGhostFilters: vi.fn(),
  lockGhostsToHead: false, setLockGhostsToHead: vi.fn(), animationActive: false, setAnimationActive: vi.fn(),
  // Commit-level time-travel wiring (this plan)
  loadGraphAtCommit: vi.fn(), exitGraphAtCommit: vi.fn(),
  atCommitActive: false, atCommitSha: null, atCommitLoading: false, atCommitMissingDiffs: 0,
};

let currentState = { ...defaultAppState };

vi.mock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({ useAppState: () => currentState }));
vi.mock('../../../upstream/gitnexus-web/src/components/EntropyBadge', () => ({ EntropyBadge: () => null }));
vi.mock('@/lib/lucide-icons', () => new Proxy({}, { get: () => () => null }));

const { Timeline } = await import('../../../upstream/gitnexus-web/src/components/Timeline');

describe('Timeline — Commits mode', () => {
  beforeEach(() => {
    currentState = { ...defaultAppState, loadGraphAtCommit: vi.fn(), exitGraphAtCommit: vi.fn() };
  });

  it('renders the nav-mode toggle', async () => {
    render(<Timeline />);
    await waitFor(() => expect(screen.getByTestId('timeline-navmode-toggle')).toBeInTheDocument());
  });

  it('switching to Commits fetches /commits and renders one dot per commit', async () => {
    render(<Timeline />);
    fireEvent.click(await screen.findByTestId('navmode-commits'));
    await waitFor(() => expect(screen.getAllByTestId('commit-dot')).toHaveLength(2));
  });

  it('clicking a commit dot calls loadGraphAtCommit with that commit hash', async () => {
    render(<Timeline />);
    fireEvent.click(await screen.findByTestId('navmode-commits'));
    const dots = await screen.findAllByTestId('commit-dot');
    fireEvent.click(dots[0]); // newest commit (i=0)
    expect(currentState.loadGraphAtCommit).toHaveBeenCalledWith('h_new');
  });

  it('shows a missing-diffs strip with a lazy retry when atCommitMissingDiffs > 0', async () => {
    currentState = { ...defaultAppState, loadGraphAtCommit: vi.fn(), atCommitSha: 'h_new', atCommitMissingDiffs: 3 };
    render(<Timeline />);
    fireEvent.click(await screen.findByTestId('navmode-commits'));
    const retry = await screen.findByTestId('commit-generate-retry');
    fireEvent.click(retry);
    expect(currentState.loadGraphAtCommit).toHaveBeenCalledWith('h_new', { lazy: true });
  });
});
