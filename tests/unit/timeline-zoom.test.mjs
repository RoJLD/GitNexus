import { describe, it, expect } from 'vitest';
import {
  computeZoomWindow,
  mapDateToPosition,
  mapPositionToDate,
  snapToNearestSnapshot,
  applyWheelZoom,
} from '../../upstream/gitnexus-web/src/lib/timeline-zoom';

describe('computeZoomWindow', () => {
  it('returns { startISO, endISO } sorted ascending', () => {
    const w = computeZoomWindow('2026-01-15T00:00:00Z', '2026-03-22T00:00:00Z');
    expect(w).toEqual({ startISO: '2026-01-15T00:00:00Z', endISO: '2026-03-22T00:00:00Z' });
  });

  it('auto-swaps when A > B', () => {
    const w = computeZoomWindow('2026-03-22T00:00:00Z', '2026-01-15T00:00:00Z');
    expect(w).toEqual({ startISO: '2026-01-15T00:00:00Z', endISO: '2026-03-22T00:00:00Z' });
  });

  it('handles equal dates by returning zero-width window', () => {
    const w = computeZoomWindow('2026-01-15T00:00:00Z', '2026-01-15T00:00:00Z');
    expect(w.startISO).toBe(w.endISO);
  });
});

describe('mapDateToPosition', () => {
  const window = { startISO: '2026-01-01T00:00:00Z', endISO: '2026-01-11T00:00:00Z' }; // 10 days
  const pixelWidth = 1000;

  it('maps window.startISO to 0', () => {
    expect(mapDateToPosition('2026-01-01T00:00:00Z', window, pixelWidth)).toBe(0);
  });

  it('maps window.endISO to pixelWidth', () => {
    expect(mapDateToPosition('2026-01-11T00:00:00Z', window, pixelWidth)).toBe(1000);
  });

  it('maps middle of window linearly', () => {
    // 5 days = halfway
    expect(mapDateToPosition('2026-01-06T00:00:00Z', window, pixelWidth)).toBe(500);
  });

  it('saturates at 0 for dates before window start', () => {
    expect(mapDateToPosition('2025-12-25T00:00:00Z', window, pixelWidth)).toBe(0);
  });

  it('saturates at pixelWidth for dates after window end', () => {
    expect(mapDateToPosition('2026-02-01T00:00:00Z', window, pixelWidth)).toBe(1000);
  });

  it('returns 0 for zero-width window (avoids div-by-zero)', () => {
    const zeroWindow = { startISO: '2026-01-01T00:00:00Z', endISO: '2026-01-01T00:00:00Z' };
    expect(mapDateToPosition('2026-01-01T00:00:00Z', zeroWindow, pixelWidth)).toBe(0);
  });
});

describe('mapPositionToDate', () => {
  const window = { startISO: '2026-01-01T00:00:00Z', endISO: '2026-01-11T00:00:00Z' };
  const pixelWidth = 1000;

  it('maps 0 to window.startISO', () => {
    expect(mapPositionToDate(0, window, pixelWidth)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('maps pixelWidth to window.endISO', () => {
    expect(mapPositionToDate(1000, window, pixelWidth)).toBe('2026-01-11T00:00:00.000Z');
  });

  it('round-trips with mapDateToPosition', () => {
    const date = '2026-01-06T12:00:00.000Z';
    const pos = mapDateToPosition(date, window, pixelWidth);
    const back = mapPositionToDate(pos, window, pixelWidth);
    expect(back).toBe(date);
  });

  it('saturates at window bounds when position out of [0, pixelWidth]', () => {
    expect(mapPositionToDate(-50, window, pixelWidth)).toBe('2026-01-01T00:00:00.000Z');
    expect(mapPositionToDate(1500, window, pixelWidth)).toBe('2026-01-11T00:00:00.000Z');
  });
});

describe('snapToNearestSnapshot', () => {
  const snapshots = [
    { date: '2026-01-01T00:00:00Z' },
    { date: '2026-01-05T00:00:00Z' },
    { date: '2026-01-10T00:00:00Z' },
    { date: '2026-01-20T00:00:00Z' },
  ];

  it('returns exact match when date == snapshot date', () => {
    expect(snapToNearestSnapshot('2026-01-05T00:00:00Z', snapshots)).toBe('2026-01-05T00:00:00Z');
  });

  it('snaps to closest snapshot when between two', () => {
    // 2026-01-07 is 2 days from Jan 5 and 3 days from Jan 10 → Jan 5
    expect(snapToNearestSnapshot('2026-01-07T00:00:00Z', snapshots)).toBe('2026-01-05T00:00:00Z');
  });

  it('snaps to first snapshot when date is before all', () => {
    expect(snapToNearestSnapshot('2025-12-01T00:00:00Z', snapshots)).toBe('2026-01-01T00:00:00Z');
  });

  it('snaps to last snapshot when date is after all', () => {
    expect(snapToNearestSnapshot('2026-12-01T00:00:00Z', snapshots)).toBe('2026-01-20T00:00:00Z');
  });

  it('returns null for empty snapshot list', () => {
    expect(snapToNearestSnapshot('2026-01-01T00:00:00Z', [])).toBeNull();
  });
});

describe('applyWheelZoom', () => {
  const full = { startISO: '2026-01-01T00:00:00.000Z', endISO: '2026-02-01T00:00:00.000Z' };

  it('zoom in (deltaY<0) shrinks the span', () => {
    const cur = { startISO: '2026-01-01T00:00:00.000Z', endISO: '2026-02-01T00:00:00.000Z' };
    const out = applyWheelZoom(cur, '2026-01-16T00:00:00.000Z', -120, full);
    const span = Date.parse(out.endISO) - Date.parse(out.startISO);
    const curSpan = Date.parse(cur.endISO) - Date.parse(cur.startISO);
    expect(span).toBeLessThan(curSpan);
  });

  it('zoom out (deltaY>0) grows the span', () => {
    const cur = { startISO: '2026-01-10T00:00:00.000Z', endISO: '2026-01-20T00:00:00.000Z' };
    const out = applyWheelZoom(cur, '2026-01-15T00:00:00.000Z', 120, full);
    const span = Date.parse(out.endISO) - Date.parse(out.startISO);
    const curSpan = Date.parse(cur.endISO) - Date.parse(cur.startISO);
    expect(span).toBeGreaterThan(curSpan);
  });

  it('keeps the anchor at the same relative position when zooming in', () => {
    const cur = { startISO: '2026-01-01T00:00:00.000Z', endISO: '2026-01-31T00:00:00.000Z' };
    const anchor = '2026-01-08T00:00:00.000Z'; // ratio ~0.233
    const ratioBefore = (Date.parse(anchor) - Date.parse(cur.startISO)) / (Date.parse(cur.endISO) - Date.parse(cur.startISO));
    const out = applyWheelZoom(cur, anchor, -120, full);
    const ratioAfter = (Date.parse(anchor) - Date.parse(out.startISO)) / (Date.parse(out.endISO) - Date.parse(out.startISO));
    expect(ratioAfter).toBeCloseTo(ratioBefore, 5);
  });

  it('clamps the span to minSpanMs (no infinite zoom in)', () => {
    const cur = { startISO: '2026-01-15T00:00:00.000Z', endISO: '2026-01-15T02:00:00.000Z' };
    const out = applyWheelZoom(cur, '2026-01-15T01:00:00.000Z', -10000, full, { minSpanMs: 3_600_000 });
    const span = Date.parse(out.endISO) - Date.parse(out.startISO);
    expect(span).toBeGreaterThanOrEqual(3_600_000);
  });

  it('clamps to full span on aggressive zoom out and stays within fullRange', () => {
    const cur = { startISO: '2026-01-14T00:00:00.000Z', endISO: '2026-01-16T00:00:00.000Z' };
    const out = applyWheelZoom(cur, '2026-01-15T00:00:00.000Z', 10000, full);
    const span = Date.parse(out.endISO) - Date.parse(out.startISO);
    const fullSpan = Date.parse(full.endISO) - Date.parse(full.startISO);
    expect(span).toBe(fullSpan);
    expect(Date.parse(out.startISO)).toBeGreaterThanOrEqual(Date.parse(full.startISO));
    expect(Date.parse(out.endISO)).toBeLessThanOrEqual(Date.parse(full.endISO));
  });

  it('shift-to-fit: a window pushed past the left edge is translated back inside', () => {
    const cur = { startISO: '2026-01-02T00:00:00.000Z', endISO: '2026-01-06T00:00:00.000Z' };
    const out = applyWheelZoom(cur, '2026-01-03T00:00:00.000Z', 200, full);
    expect(Date.parse(out.startISO)).toBeGreaterThanOrEqual(Date.parse(full.startISO));
    expect(Date.parse(out.endISO)).toBeLessThanOrEqual(Date.parse(full.endISO));
  });
});
