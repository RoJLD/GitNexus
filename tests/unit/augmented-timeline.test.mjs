/**
 * Tier 3.x Augmented Timeline — pure fns.
 *
 * See docs/superpowers/specs/2026-05-27-roadmap-predictive-augmented-timeline-design.md
 *  §3.2 (selectGhostsAt closest-prior, computeTransitions window detection,
 *   resolveAugmentedTimelineMode auto-detect/lock).
 */

import { describe, it, expect } from 'vitest';
import {
  selectGhostsAt,
  computeTransitions,
  resolveAugmentedTimelineMode,
} from '../../upstream/gitnexus-web/src/lib/augmented-timeline';

function ghost(id, extra = {}) {
  return {
    id,
    title: id,
    tier: '1',
    status: 'planned',
    expectedLinks: [],
    ...extra,
  };
}

function snap(sha, date, ghosts) {
  return [sha, { sha, date, ghosts }];
}

describe('selectGhostsAt', () => {
  it('returns [] for empty cache in time-aware mode', () => {
    const cache = new Map();
    const out = selectGhostsAt(cache, new Date('2026-05-20'), 'time-aware', []);
    expect(out).toEqual([]);
  });

  it('picks the closest-prior snapshot relative to the cursor', () => {
    const cache = new Map([
      snap('aaa', '2026-05-01T00:00:00Z', [ghost('g1')]),
      snap('bbb', '2026-05-15T00:00:00Z', [ghost('g1'), ghost('g2')]),
      snap('ccc', '2026-05-25T00:00:00Z', [ghost('g3')]),
    ]);
    const out = selectGhostsAt(cache, new Date('2026-05-20T00:00:00Z'), 'time-aware', []);
    expect(out.map((g) => g.id).sort()).toEqual(['g1', 'g2']);
  });

  it('returns [] when cursor is before every snapshot', () => {
    const cache = new Map([
      snap('aaa', '2026-05-15T00:00:00Z', [ghost('g1')]),
      snap('bbb', '2026-05-25T00:00:00Z', [ghost('g2')]),
    ]);
    const out = selectGhostsAt(cache, new Date('2026-04-30T00:00:00Z'), 'time-aware', []);
    expect(out).toEqual([]);
  });

  it('returns liveGhosts unchanged in lock-to-head mode (ignores cache)', () => {
    const cache = new Map([
      snap('aaa', '2026-05-01T00:00:00Z', [ghost('historical')]),
    ]);
    const live = [ghost('live1'), ghost('live2')];
    const out = selectGhostsAt(cache, new Date('2026-05-20T00:00:00Z'), 'lock-to-head', live);
    expect(out).toBe(live);
  });
});

describe('computeTransitions', () => {
  it('detects ghosts materializing in the window', () => {
    const cache = new Map([
      snap('aaa', '2026-05-01T00:00:00Z', [
        ghost('g1', {
          materializedAt: { date: '2026-05-10T00:00:00Z', commit: 'x', confirmedBy: 'manual' },
        }),
      ]),
    ]);
    const { materializing, cancelling } = computeTransitions(
      cache,
      new Date('2026-05-05T00:00:00Z'),
      new Date('2026-05-15T00:00:00Z'),
    );
    expect(materializing).toEqual(['g1']);
    expect(cancelling).toEqual([]);
  });

  it('detects ghosts cancelling in the window', () => {
    const cache = new Map([
      snap('aaa', '2026-05-01T00:00:00Z', [
        ghost('g1', { cancelledAt: { date: '2026-05-12T00:00:00Z', commit: 'y' } }),
      ]),
    ]);
    const { materializing, cancelling } = computeTransitions(
      cache,
      new Date('2026-05-05T00:00:00Z'),
      new Date('2026-05-15T00:00:00Z'),
    );
    expect(materializing).toEqual([]);
    expect(cancelling).toEqual(['g1']);
  });

  it('does not double-count when a ghost appears in multiple snapshots', () => {
    const matEvent = {
      date: '2026-05-10T00:00:00Z',
      commit: 'x',
      confirmedBy: 'manual',
    };
    const cache = new Map([
      snap('aaa', '2026-05-01T00:00:00Z', [ghost('g1', { materializedAt: matEvent })]),
      snap('bbb', '2026-05-12T00:00:00Z', [ghost('g1', { materializedAt: matEvent })]),
      snap('ccc', '2026-05-20T00:00:00Z', [ghost('g1', { materializedAt: matEvent })]),
    ]);
    const { materializing } = computeTransitions(
      cache,
      new Date('2026-05-05T00:00:00Z'),
      new Date('2026-05-15T00:00:00Z'),
    );
    expect(materializing).toEqual(['g1']);
  });
});

describe('resolveAugmentedTimelineMode', () => {
  it('returns live when lockGhostsToHead is true (even when cursor diverges)', () => {
    const mode = resolveAugmentedTimelineMode({
      cursor: new Date('2026-05-01T00:00:00Z'),
      head: new Date('2026-05-27T00:00:00Z'),
      lockGhostsToHead: true,
    });
    expect(mode).toBe('live');
  });

  it('returns live when cursor is within the default skew tolerance', () => {
    const head = new Date('2026-05-27T12:00:00Z');
    const cursor = new Date('2026-05-27T12:00:30Z'); // +30s
    const mode = resolveAugmentedTimelineMode({ cursor, head, lockGhostsToHead: false });
    expect(mode).toBe('live');
  });

  it('returns time-aware when cursor exceeds the skew tolerance', () => {
    const head = new Date('2026-05-27T12:00:00Z');
    const cursor = new Date('2026-05-20T00:00:00Z'); // ~7 days back
    const mode = resolveAugmentedTimelineMode({ cursor, head, lockGhostsToHead: false });
    expect(mode).toBe('time-aware');
  });
});
