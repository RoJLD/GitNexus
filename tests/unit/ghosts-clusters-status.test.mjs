import { describe, it, expect } from 'vitest';
import { computeClusterStatus } from '../../upstream/docker-server-ghosts-core.mjs';

const NOW = new Date('2026-05-27T00:00:00Z');

describe('computeClusterStatus', () => {
  const cluster = { id: 'c', memberIds: ['a', 'b', 'c'], expectedBy: null, declaredStatus: null };

  it('synthesizes "planned" when ≥1 member planned', () => {
    const members = [
      { id: 'a', status: 'planned' },
      { id: 'b', status: 'materialized' },
      { id: 'c', status: 'materialized' },
    ];
    const r = computeClusterStatus(cluster, members, { now: NOW });
    expect(r.aggregate).toMatchObject({ total: 3, materialized: 2, planned: 1, expired: 0, cancelled: 0 });
    expect(r.aggregate.completionPct).toBeCloseTo(66.7, 1);
    expect(r.synthesizedStatus).toBe('planned');
  });

  it('synthesizes "shipped" when all-terminal AND ≥1 materialized', () => {
    const members = [
      { id: 'a', status: 'materialized' },
      { id: 'b', status: 'cancelled' },
      { id: 'c', status: 'materialized' },
    ];
    const r = computeClusterStatus(cluster, members, { now: NOW });
    expect(r.synthesizedStatus).toBe('shipped');
  });

  it('synthesizes "cancelled" when all cancelled', () => {
    const members = cluster.memberIds.map(id => ({ id, status: 'cancelled' }));
    const r = computeClusterStatus(cluster, members, { now: NOW });
    expect(r.synthesizedStatus).toBe('cancelled');
  });

  it('synthesizes "expired" when not shipped AND expectedBy + grace passed', () => {
    const c = { ...cluster, expectedBy: '2025-12-01' }; // grace 30j → expired since 2025-12-31
    const members = cluster.memberIds.map(id => ({ id, status: 'planned' }));
    const r = computeClusterStatus(c, members, { now: NOW, gracePeriodDays: 30 });
    expect(r.synthesizedStatus).toBe('expired');
  });

  it('declaredStatus wins over synthesis', () => {
    const c = { ...cluster, declaredStatus: 'shipped' };
    const members = cluster.memberIds.map(id => ({ id, status: 'planned' }));
    const r = computeClusterStatus(c, members, { now: NOW });
    expect(r.synthesizedStatus).toBe('shipped');
  });

  it('plannedAt = min member plannedAt; materializedAt = max when all-terminal-with-mat', () => {
    const members = [
      { id: 'a', status: 'materialized', plannedAt: { date: '2026-01-01' }, materializedAt: { date: '2026-02-01' } },
      { id: 'b', status: 'materialized', plannedAt: { date: '2026-01-15' }, materializedAt: { date: '2026-03-01' } },
      { id: 'c', status: 'cancelled', plannedAt: { date: '2026-01-10' }, cancelledAt: { date: '2026-02-15' } },
    ];
    const r = computeClusterStatus({ ...cluster, memberIds: ['a', 'b', 'c'] }, members, { now: NOW });
    expect(r.plannedAt?.date).toBe('2026-01-01');
    expect(r.materializedAt?.date).toBe('2026-03-01');
  });
});
