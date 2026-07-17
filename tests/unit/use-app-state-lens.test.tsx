import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../upstream/gitnexus-web/src/services/backend-client', () => ({
  fetchRepos: vi.fn().mockResolvedValue([]),
  fetchSnapshots: vi.fn().mockResolvedValue([]),
  probeBackend: vi.fn().mockResolvedValue(false),
  fetchGraph: vi.fn().mockResolvedValue({ nodes: [], relationships: [] }),
  fetchNodesAliveBetween: vi.fn().mockResolvedValue({
    nodeIds: [],
    snapshotCount: 0,
    fromSnapshot: 'a',
    toSnapshot: 'b',
    computedAt: '2026-05-27T00:00:00Z',
  }),
}));

import { useAppState, AppStateProvider } from '../../upstream/gitnexus-web/src/hooks/useAppState';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppStateProvider>{children}</AppStateProvider>
);

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
});

// Covers the state slice exposed for LensInsightsPanel: default values +
// setter plumbing (added/exposed in hooks/app-state/graph.tsx, wired
// through useAppState.tsx). The actual capture-from-fetched-response
// logic lives deep inside `switchRepo` (a large handler with agent-init
// and embeddings side effects) and is NOT exercised here — see
// docs/superpowers/plans/2026-07-17-lens-souveraine-phase1b-browser-projector.md
// Task 2 + the Task 2 report for the explicit non-unit-tested flag.
describe('useAppState — lens insights/meaning slice', () => {
  it('defaults to lensInsights=[] and lensMeaning=undefined', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    expect(result.current.lensInsights).toEqual([]);
    expect(result.current.lensMeaning).toBeUndefined();
  });

  it('setLensInsights / setLensMeaning update state', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    act(() => {
      result.current.setLensInsights([{ id: 'x', name: 'X', value: 9 }]);
      result.current.setLensMeaning('Services critiques.');
    });
    expect(result.current.lensInsights).toEqual([{ id: 'x', name: 'X', value: 9 }]);
    expect(result.current.lensMeaning).toBe('Services critiques.');
  });

  it('setLensInsights([]) / setLensMeaning(undefined) clears back to defaults', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    act(() => {
      result.current.setLensInsights([{ id: 'x', value: 1 }]);
      result.current.setLensMeaning('Something');
    });
    act(() => {
      result.current.setLensInsights([]);
      result.current.setLensMeaning(undefined);
    });
    expect(result.current.lensInsights).toEqual([]);
    expect(result.current.lensMeaning).toBeUndefined();
  });
});
