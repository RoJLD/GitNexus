import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../upstream/gitnexus-web/src/services/backend-client', () => ({
  fetchRepos: vi.fn().mockResolvedValue([]),
  fetchSnapshots: vi.fn().mockResolvedValue([]),
  probeBackend: vi.fn().mockResolvedValue(false),
  fetchGraph: vi.fn().mockResolvedValue({ nodes: [], relationships: [] }),
  fetchNodesAliveBetween: vi.fn().mockResolvedValue({
    nodeIds: ['n1', 'n2'],
    snapshotCount: 3,
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
    window.localStorage.removeItem('timelineTemporalFilterMode');
  }
});

describe('useAppState — temporal filter slice', () => {
  it('defaults to mode "off" with null filteredNodeIds', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    expect(result.current.temporalFilterMode).toBe('off');
    expect(result.current.temporalFilteredNodeIds).toBeNull();
    expect(result.current.temporalFilterLoading).toBe(false);
    expect(result.current.temporalFilterError).toBeNull();
  });

  it('restores mode from localStorage on mount', () => {
    window.localStorage.setItem('timelineTemporalFilterMode', 'strict');
    const { result } = renderHook(() => useAppState(), { wrapper });
    expect(result.current.temporalFilterMode).toBe('strict');
  });

  it('setTemporalFilterMode persists to localStorage', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    act(() => {
      result.current.setTemporalFilterMode('normal');
    });
    expect(result.current.temporalFilterMode).toBe('normal');
    expect(window.localStorage.getItem('timelineTemporalFilterMode')).toBe('normal');
  });

  it('setTemporalFilterMode("off") clears filteredNodeIds + persists', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    act(() => {
      result.current.setTemporalFilterMode('strict');
    });
    act(() => {
      result.current.setTemporalFilterMode('off');
    });
    expect(result.current.temporalFilterMode).toBe('off');
    expect(result.current.temporalFilteredNodeIds).toBeNull();
    expect(window.localStorage.getItem('timelineTemporalFilterMode')).toBe('off');
  });

  it('accepts all 4 modes', () => {
    const { result } = renderHook(() => useAppState(), { wrapper });
    const modes = ['off', 'strict', 'normal', 'permissive'] as const;
    for (const mode of modes) {
      act(() => {
        result.current.setTemporalFilterMode(mode);
      });
      expect(result.current.temporalFilterMode).toBe(mode);
    }
  });
});
