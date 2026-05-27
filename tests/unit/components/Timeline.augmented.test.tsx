/**
 * Tier 3.x Augmented Timeline — Timeline.tsx Animate roadmap button.
 *
 * Mocks `useAppState` because Timeline pulls dozens of fields from it
 * (way too noisy to thread through a real provider for a 3-case test).
 *
 * See docs/superpowers/specs/2026-05-27-roadmap-predictive-augmented-timeline-design.md
 *   §3.2.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock fetch so the Timeline's `/snapshots` lookup yields 2 points.
beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('/snapshots')) {
      return {
        ok: true,
        json: async () => ({
          snapshots: [
            { name: 'demo@aaa', key: 'demo@aaa', commit: { shortHash: 'aaa', message: 'first', author: 'a', date: '2026-05-10T00:00:00Z' } },
            { name: 'demo@bbb', key: 'demo@bbb', commit: { shortHash: 'bbb', message: 'second', author: 'a', date: '2026-05-20T00:00:00Z' } },
          ],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
});

// Default mock factory for useAppState. Each test overrides the bits it
// cares about by re-mocking before render.
const defaultAppState = {
  projectName: 'demo',
  availableRepos: [{ name: 'demo', indexedAt: '2026-05-25T00:00:00Z' }],
  switchRepo: vi.fn(),
  exitDiffMode: vi.fn(),
  diffMode: null,
  churnActive: false,
  churnLoading: false,
  churnError: null,
  churnTotalSnapshots: 0,
  enterChurnMode: vi.fn(),
  exitChurnMode: vi.fn(),
  couplingActive: false,
  couplingLoading: false,
  couplingError: null,
  enterCouplingMode: vi.fn(),
  exitCouplingMode: vi.fn(),
  growthActive: false,
  growthLoading: false,
  growthError: null,
  enterGrowthMode: vi.fn(),
  exitGrowthMode: vi.fn(),
  lifespanActive: false,
  lifespanLoading: false,
  lifespanError: null,
  enterLifespanMode: vi.fn(),
  exitLifespanMode: vi.fn(),
  ownershipActive: false,
  ownershipLoading: false,
  ownershipError: null,
  enterOwnershipMode: vi.fn(),
  exitOwnershipMode: vi.fn(),
  dissonanceActive: false,
  dissonanceLoading: false,
  dissonanceError: null,
  enterDissonanceMode: vi.fn(),
  exitDissonanceMode: vi.fn(),
  similarityActive: false,
  similarityLoading: false,
  similarityError: null,
  enterSimilarityMode: vi.fn(),
  exitSimilarityMode: vi.fn(),
  whatIfPanelOpen: false,
  whatIfActive: false,
  whatIfMutations: [],
  exitWhatIfMode: vi.fn(),
  setWhatIfMutations: vi.fn(),
  setWhatIfPanelOpen: vi.fn(),
  entropyCommitsActive: false,
  enterEntropyCommitsMode: vi.fn(),
  exitEntropyCommitsMode: vi.fn(),
  cachedSnapshotNames: new Set(),
  preloadingSnapshots: false,
  preloadProgress: null,
  preloadError: null,
  preloadAllSnapshots: vi.fn(),
  cancelPreload: vi.fn(),
  clearSnapshotCache: vi.fn(),
  cursorA: null,
  cursorB: null,
  zoomWindow: null,
  graphMode: 'single',
  setCursorA: vi.fn(),
  setCursorB: vi.fn(),
  enterZoom: vi.fn(),
  exitZoom: vi.fn(),
  setGraphMode: vi.fn(),
  ghostFilters: {
    showGhosts: false,
    tiers: ['1', '2', '3'],
    showCancelled: false,
  },
  setGhostFilters: vi.fn(),
  lockGhostsToHead: false,
  setLockGhostsToHead: vi.fn(),
  animationActive: false,
  setAnimationActive: vi.fn(),
};

let currentState = { ...defaultAppState };

vi.mock('../../../upstream/gitnexus-web/src/hooks/useAppState', () => ({
  useAppState: () => currentState,
}));

// EntropyBadge does an HTTP fetch — replace with a noop to keep this
// test focused on the Animate button.
vi.mock('../../../upstream/gitnexus-web/src/components/EntropyBadge', () => ({
  EntropyBadge: () => null,
}));

// Stub lucide icons (the alias path uses @/lib/lucide-icons which is
// only resolved by Vite). The test pulls only the visual icons; we
// replace them with bare spans so the import resolves.
vi.mock('@/lib/lucide-icons', () => {
  const stub = () => null;
  return new Proxy(
    {},
    {
      get: () => stub,
    },
  );
});

// Import after mocks so the resolution picks them up.
const { Timeline } = await import('../../../upstream/gitnexus-web/src/components/Timeline');

describe('Timeline — Animate roadmap button (Augmented Timeline)', () => {
  beforeEach(() => {
    // Reset state to default between tests.
    currentState = {
      ...defaultAppState,
      switchRepo: vi.fn(),
      setCursorB: vi.fn(),
      setGhostFilters: vi.fn(),
      setLockGhostsToHead: vi.fn(),
      setAnimationActive: vi.fn(),
    };
  });

  it('renders the Animate roadmap button when there are ≥ 2 snapshot points', async () => {
    render(<Timeline />);
    await waitFor(() => {
      expect(screen.getByTestId('animate-roadmap-button')).toBeInTheDocument();
    });
  });

  it('click → setCursorB(earliest) + setAnimationActive(true) + setGhostFilters(showGhosts true)', async () => {
    render(<Timeline />);
    const btn = await screen.findByTestId('animate-roadmap-button');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(currentState.setAnimationActive).toHaveBeenCalledWith(true);
    });
    expect(currentState.setGhostFilters).toHaveBeenCalledWith(
      expect.objectContaining({ showGhosts: true }),
    );
    // cursor B should be set to the earliest snapshot date (2026-05-10).
    expect(currentState.setCursorB).toHaveBeenCalledWith('2026-05-10T00:00:00Z');
  });

  it('shows the "Animating roadmap…" banner while animationActive is true', async () => {
    currentState = { ...currentState, animationActive: true };
    render(<Timeline />);
    await waitFor(() => {
      expect(screen.getByTestId('animate-roadmap-banner')).toBeInTheDocument();
      expect(screen.getByTestId('animate-roadmap-banner').textContent).toMatch(/Animating roadmap/);
    });
  });
});
