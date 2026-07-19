// useAppState.previewLens — WYSIWYG preview render into the REAL canvas.
//
// Harness copied verbatim from tests/unit/use-app-state-lens.test.tsx (same
// vi.mock target for backend-client, same AppStateProvider wrapper, same
// renderHook access pattern) — that file already proves this mechanism works
// for exercising useAppState() without hitting the tests/ vs
// upstream/gitnexus-web/ dual-React-copy i18n defect (it tests the hook, not
// an i18n-rendering component).
//
// Cardinal assertion (Test A): after previewLens(spec) resolves { ok: true },
// the store's graph holds the returned nodes AND lensInsights/lensMeaning are
// set — proof applyLensMetadata ran on the SAME contract as switchRepo's
// slow-path. The gap #7 defect (see LESSONS_LEARNED / feedback digest) was
// precisely a setGraph call WITHOUT applyLensMetadata, leaving the lens
// insights panel inert; this test exists to make that regression class
// impossible to reintroduce here.
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
  fetchLensFreshness: vi.fn().mockResolvedValue(null),
  previewLens: vi.fn(async () => ({
    ok: true,
    braingraph: {
      lens: { name: 'p' },
      nodes: [{ id: 'n1', label: 'CodeElement', properties: {} }],
      relationships: [],
      insights: [{ id: 'i1', name: 'n', value: 3 }],
      meaning: 'm',
    },
  })),
}));

import { useAppState, AppStateProvider } from '../../upstream/gitnexus-web/src/hooks/useAppState';
import { previewLens as previewLensApi } from '../../upstream/gitnexus-web/src/services/backend-client';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppStateProvider>{children}</AppStateProvider>
);

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  vi.mocked(previewLensApi).mockClear();
});

describe('useAppState — previewLens', () => {
  it('Test A: {ok:true} renders nodes into the graph AND applies lens metadata (insights/meaning) — gap #7 contract', async () => {
    const { result } = renderHook(() => useAppState(), { wrapper });

    let outcome: { ok: boolean; errors?: string[] } | undefined;
    await act(async () => {
      outcome = await result.current.previewLens({ name: 'my_lens' });
    });

    expect(outcome).toEqual({ ok: true });
    expect(previewLensApi).toHaveBeenCalledWith({ name: 'my_lens' });

    // The graph now holds the returned node.
    expect(result.current.graph).not.toBeNull();
    expect(result.current.graph?.nodes.some((n) => n.id === 'n1')).toBe(true);

    // applyLensMetadata's positive-capture ran (same contract as switchRepo).
    expect(result.current.lensInsights).toEqual([{ id: 'i1', name: 'n', value: 3 }]);
    expect(result.current.lensMeaning).toBe('m');
  });

  // Fix 4 (final review): previewLens used to pass repoInfo:{family:'authoring'}
  // to applyLensMetadata, which (per graph.tsx) fires fetchLensFreshness
  // whenever repoInfo.family is truthy. There is no `/lens/preview`-created
  // registry entry named 'preview'/<lens-name> on the backend, so that fetch
  // is a guaranteed 404 whose (discarded, best-effort) result is never
  // displayed — a spurious network call on every Preview click. insights/
  // meaning must still be applied (Test A above), but the freshness fetch
  // must be skipped.
  it('Fix 4: does NOT trigger fetchLensFreshness (no /lens/preview registry entry to fetch)', async () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    const freshnessMock = vi.mocked(
      (await import('../../upstream/gitnexus-web/src/services/backend-client')).fetchLensFreshness,
    );
    freshnessMock.mockClear();

    await act(async () => {
      await result.current.previewLens({ name: 'my_lens' });
    });

    expect(freshnessMock).not.toHaveBeenCalled();
  });

  it('Test B: {ok:false} does not touch the graph and returns {ok:false, errors}', async () => {
    vi.mocked(previewLensApi).mockResolvedValueOnce({ ok: false, errors: ['bad spec'] });
    const { result } = renderHook(() => useAppState(), { wrapper });

    expect(result.current.graph).toBeNull();

    let outcome: { ok: boolean; errors?: string[] } | undefined;
    await act(async () => {
      outcome = await result.current.previewLens({ name: 'bad' });
    });

    expect(outcome).toEqual({ ok: false, errors: ['bad spec'] });
    expect(result.current.graph).toBeNull();
    expect(result.current.lensInsights).toEqual([]);
    expect(result.current.lensMeaning).toBeUndefined();
  });
});
