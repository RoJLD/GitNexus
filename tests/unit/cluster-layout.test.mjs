import { describe, it, expect } from 'vitest';
import {
  convexHull,
  clusterHullPolygon,
  polygonCentroid,
  assignSwimlanes,
  pointInPolygon,
} from '../../upstream/gitnexus-web/src/lib/cluster-layout.ts';

// ─── convexHull ─────────────────────────────────────────────────────

describe('convexHull', () => {
  it('returns a clone for 0 or 1 points', () => {
    expect(convexHull([])).toEqual([]);
    const one = [{ x: 3, y: 4 }];
    const hull = convexHull(one);
    expect(hull).toEqual(one);
    // Clone, not the same reference (callers mutate hulls).
    expect(hull).not.toBe(one);
    expect(hull[0]).not.toBe(one[0]);
  });

  it('returns the same two points for a 2-point input', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    const hull = convexHull(pts);
    expect(hull).toHaveLength(2);
    // Sorted lexicographically by x.
    expect(hull[0]).toEqual({ x: 0, y: 0 });
    expect(hull[1]).toEqual({ x: 1, y: 1 });
  });

  it('returns the 4 corners of an axis-aligned square (interior points dropped)', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // interior
      { x: 3, y: 7 }, // interior
    ];
    const hull = convexHull(pts);
    expect(hull).toHaveLength(4);
    // No interior point survives.
    expect(hull.some((p) => p.x === 5 && p.y === 5)).toBe(false);
    expect(hull.some((p) => p.x === 3 && p.y === 7)).toBe(false);
    // The 4 corners are present.
    expect(hull).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    );
  });

  it('is counter-clockwise (cross product positive)', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    // Signed area of CCW polygon is positive.
    let area = 0;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      area += a.x * b.y - b.x * a.y;
    }
    expect(area / 2).toBeGreaterThan(0);
  });

  it('handles collinear input by collapsing to the extreme points', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    // All on the x-axis → the hull degenerates to the two endpoints.
    expect(hull.length).toBeLessThanOrEqual(2);
    expect(hull).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
      ]),
    );
  });
});

// ─── clusterHullPolygon ─────────────────────────────────────────────

describe('clusterHullPolygon', () => {
  it('returns null for 0 members', () => {
    expect(clusterHullPolygon([])).toBeNull();
  });

  it('returns null for a singleton (caller renders a circle)', () => {
    expect(clusterHullPolygon([{ x: 1, y: 2 }])).toBeNull();
  });

  it('returns the 2-point segment for exactly 2 members', () => {
    const poly = clusterHullPolygon([
      { x: 0, y: 0 },
      { x: 5, y: 3 },
    ]);
    expect(poly).toHaveLength(2);
    expect(poly).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 3 },
    ]);
  });

  it('returns a polygon (>=3 vertices) for 3+ non-collinear members', () => {
    const poly = clusterHullPolygon([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ]);
    expect(poly).not.toBeNull();
    expect(poly.length).toBeGreaterThanOrEqual(3);
  });

  it('falls back when 3+ collinear members collapse the hull', () => {
    const poly = clusterHullPolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    // The hull collapses to the two endpoints — caller can render a pill.
    expect(poly).not.toBeNull();
    expect(poly.length).toBeLessThanOrEqual(2);
  });
});

// ─── polygonCentroid ────────────────────────────────────────────────

describe('polygonCentroid', () => {
  it('returns (0,0) for an empty polygon', () => {
    expect(polygonCentroid([])).toEqual({ x: 0, y: 0 });
  });

  it('returns the point itself for a singleton', () => {
    expect(polygonCentroid([{ x: 7, y: 9 }])).toEqual({ x: 7, y: 9 });
  });

  it('returns the midpoint for a 2-point segment', () => {
    expect(polygonCentroid([{ x: 0, y: 0 }, { x: 4, y: 4 }])).toEqual({ x: 2, y: 2 });
  });

  it('returns the center for an axis-aligned square (CCW)', () => {
    const c = polygonCentroid([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    expect(c.x).toBeCloseTo(2, 6);
    expect(c.y).toBeCloseTo(2, 6);
  });

  it('returns the centroid of a triangle (1/3 mean of vertices)', () => {
    const c = polygonCentroid([
      { x: 0, y: 0 },
      { x: 9, y: 0 },
      { x: 0, y: 9 },
    ]);
    expect(c.x).toBeCloseTo(3, 6);
    expect(c.y).toBeCloseTo(3, 6);
  });

  it('falls back to arithmetic mean when polygon is degenerate (collinear)', () => {
    const c = polygonCentroid([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ]);
    // signed area = 0 → mean of vertices = (2, 0).
    expect(c).toEqual({ x: 2, y: 0 });
  });
});

// ─── assignSwimlanes ────────────────────────────────────────────────

describe('assignSwimlanes', () => {
  const row = (id, plannedAt = null) => ({ id, plannedAt: plannedAt ? { date: plannedAt } : null });

  it('returns only the Unclustered lane when there are no clusters', () => {
    const out = assignSwimlanes([row('a'), row('b')], []);
    expect(out).toHaveLength(1);
    expect(out[0].lane).toBe('Unclustered');
    expect(out[0].rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns [] when both rows and clusters are empty', () => {
    expect(assignSwimlanes([], [])).toEqual([]);
  });

  it('orders clusters by earliest plannedAt ASC', () => {
    const rows = [
      row('a1', '2026-05-01'),
      row('b1', '2026-03-01'),
      row('c1', '2026-04-01'),
    ];
    const clusters = [
      { id: 'A', title: 'Alpha', memberIds: ['a1'] },
      { id: 'B', title: 'Bravo', memberIds: ['b1'] },
      { id: 'C', title: 'Charlie', memberIds: ['c1'] },
    ];
    const out = assignSwimlanes(rows, clusters);
    expect(out.map((l) => l.lane)).toEqual(['Bravo', 'Charlie', 'Alpha']);
  });

  it('puts ghosts not in any cluster into an Unclustered lane at the bottom', () => {
    const rows = [row('a1', '2026-05-01'), row('orphan', '2026-04-01')];
    const out = assignSwimlanes(rows, [
      { id: 'A', title: 'Alpha', memberIds: ['a1'] },
    ]);
    expect(out.map((l) => l.lane)).toEqual(['Alpha', 'Unclustered']);
    expect(out[1].rows.map((r) => r.id)).toEqual(['orphan']);
  });

  it('duplicates a ghost present in multiple clusters (one per lane)', () => {
    const rows = [row('shared', '2026-04-01')];
    const out = assignSwimlanes(rows, [
      { id: 'A', title: 'Alpha', memberIds: ['shared'] },
      { id: 'B', title: 'Bravo', memberIds: ['shared'] },
    ]);
    expect(out).toHaveLength(2);
    expect(out.flatMap((l) => l.rows.map((r) => r.id))).toEqual(['shared', 'shared']);
    // No "Unclustered" lane since `shared` is a member of both.
    expect(out.some((l) => l.lane === 'Unclustered')).toBe(false);
  });

  it('skips clusters with no resolvable members', () => {
    const rows = [row('a1')];
    const out = assignSwimlanes(rows, [
      { id: 'A', title: 'Alpha', memberIds: ['a1'] },
      { id: 'B', title: 'Bravo', memberIds: ['does-not-exist'] },
    ]);
    expect(out.map((l) => l.lane)).toEqual(['Alpha']);
  });
});

// ─── pointInPolygon ─────────────────────────────────────────────────

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('returns true for a point clearly inside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it('returns false for a point clearly outside', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: -1 }, square)).toBe(false);
  });

  it('returns false for a polygon with fewer than 3 vertices', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });

  it('handles a non-convex (concave) polygon', () => {
    // L-shape: outer rectangle 0..10 minus the top-right 5..10 × 5..10 corner.
    const lShape = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 8 }, lShape)).toBe(true); // inside the L
    expect(pointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false); // in the carved-out corner
  });

  it('is consistent with convexHull + clusterHullPolygon for a known cluster', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const poly = clusterHullPolygon(positions);
    expect(pointInPolygon({ x: 5, y: 5 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 100, y: 100 }, poly)).toBe(false);
  });
});
