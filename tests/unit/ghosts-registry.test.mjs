/**
 * Plugin-aware ghost-source registry — unit tests.
 *
 * Covers the public surface added by Update delta (b) of the CORE spec :
 *   - registerGhostSource (validation, no-replace builtin)
 *   - listGhostSources
 *   - _resetGhostSourcesForTests (clears externals, preserves builtin)
 *   - Merge precedence at the API level (builtin always wins)
 *
 * The full sync flow (syncGhostsForRepo / syncGhostsForSnapshot) requires a
 * real git repo and is covered by the integration suite — these unit tests
 * exercise the registry surface only.
 *
 * Spec : docs/superpowers/specs/2026-05-26-roadmap-predictive-core-design.md (Update delta b).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerGhostSource,
  listGhostSources,
  _resetGhostSourcesForTests,
  _fetchAndMergeDeclaredGhostsForTests,
} from '../../upstream/docker-server-ghosts.mjs';

const BUILTIN = 'roadmap-md';

describe('ghost-source registry', () => {
  // Keep tests deterministic : every test starts with only the builtin
  // registered, and we wipe externals at the end too in case a test threw
  // halfway through registration.
  beforeEach(() => { _resetGhostSourcesForTests(); });
  afterEach(() => { _resetGhostSourcesForTests(); });

  describe('builtin auto-registration', () => {
    it('registers the builtin source at module load', () => {
      expect(listGhostSources()).toContain(BUILTIN);
    });

    it('lists the builtin first even after externals are added', async () => {
      registerGhostSource({
        name: 'plane',
        fetchGhosts: async () => [],
      });
      const names = listGhostSources();
      expect(names[0]).toBe(BUILTIN);
      expect(names).toContain('plane');
    });
  });

  describe('registerGhostSource validation', () => {
    it('rejects a missing source object', () => {
      expect(() => registerGhostSource(null)).toThrow(TypeError);
      expect(() => registerGhostSource(undefined)).toThrow(TypeError);
    });

    it('rejects sources without a name', () => {
      expect(() => registerGhostSource({ fetchGhosts: async () => [] })).toThrow(/name/);
      expect(() => registerGhostSource({ name: '', fetchGhosts: async () => [] })).toThrow(/name/);
    });

    it('rejects sources without a fetchGhosts function', () => {
      expect(() => registerGhostSource({ name: 'plane' })).toThrow(/fetchGhosts/);
      expect(() => registerGhostSource({ name: 'plane', fetchGhosts: 'not-a-fn' })).toThrow(/fetchGhosts/);
    });

    it('rejects sources whose fetchGhosts is not a function', () => {
      // We accept any function (including transpiled / wrapped / promisified
      // ones) that returns a Promise — the contract is "callable returning a
      // Promise", not "syntactically async". A non-function value is still
      // rejected loudly.
      expect(() => registerGhostSource({
        name: 'plane',
        fetchGhosts: 'not a function',
      })).toThrow(/fetchGhosts/);
    });

    it('accepts a valid source and lists it', () => {
      registerGhostSource({
        name: 'plane',
        fetchGhosts: async () => [{ id: 'p1', title: 'P', status: 'planned', expectedLinks: [] }],
      });
      expect(listGhostSources()).toEqual([BUILTIN, 'plane']);
    });

    it('allows last-write-wins for non-builtin names', () => {
      registerGhostSource({ name: 'plane', fetchGhosts: async () => [] });
      registerGhostSource({ name: 'plane', fetchGhosts: async () => [{ id: 'x' }] });
      // Still only listed once — the second registration replaced the first.
      const names = listGhostSources();
      expect(names.filter(n => n === 'plane')).toHaveLength(1);
    });
  });

  describe('builtin protection', () => {
    it('refuses to replace the builtin source (no-op + warn)', () => {
      const warnings = [];
      const origWarn = console.warn;
      console.warn = (msg) => warnings.push(String(msg));
      try {
        registerGhostSource({
          name: BUILTIN,
          fetchGhosts: async () => [{ id: 'hijack' }],
        });
      } finally {
        console.warn = origWarn;
      }
      // The call returned normally (no throw) but emitted a warning and did
      // not change the listing.
      expect(warnings.some(w => w.includes(BUILTIN))).toBe(true);
      expect(listGhostSources()).toEqual([BUILTIN]);
    });
  });

  describe('_resetGhostSourcesForTests', () => {
    it('clears externals but preserves the builtin', () => {
      registerGhostSource({ name: 'plane', fetchGhosts: async () => [] });
      registerGhostSource({ name: 'audit', fetchGhosts: async () => [] });
      expect(listGhostSources()).toEqual([BUILTIN, 'plane', 'audit']);

      _resetGhostSourcesForTests();

      expect(listGhostSources()).toEqual([BUILTIN]);
    });

    it('is idempotent — calling twice keeps the builtin', () => {
      _resetGhostSourcesForTests();
      _resetGhostSourcesForTests();
      expect(listGhostSources()).toEqual([BUILTIN]);
    });
  });

  describe('merge precedence (first non-builtin wins among externals)', () => {
    // We exercise the real merge helper here so the test's name matches what
    // it actually checks. The builtin's fetcher reads ROADMAP.md at the given
    // repoPath; we pass a non-existent path so it returns [] (parseRoadmap('')
    // yields no ghosts). That leaves the externals as the only contributors,
    // and lets us assert the "first non-builtin wins on id collision among
    // externals" semantic that the registry actually implements.
    //
    // The "builtin wins over externals" direction requires a real ROADMAP.md
    // collision and lives in the integration suite (needs git + filesystem).
    it('first registered external wins on id collision; uniques from both survive; source field is stamped', async () => {
      registerGhostSource({
        name: 'plane',
        fetchGhosts: async () => [
          { id: 'shared-id', title: 'From Plane', status: 'planned', expectedLinks: [] },
          { id: 'plane-only', title: 'Plane Only', status: 'planned', expectedLinks: [] },
        ],
      });
      registerGhostSource({
        name: 'linear',
        fetchGhosts: async () => [
          { id: 'shared-id', title: 'From Linear', status: 'planned', expectedLinks: [] },
          { id: 'linear-only', title: 'Linear Only', status: 'planned', expectedLinks: [] },
        ],
      });

      const merged = await _fetchAndMergeDeclaredGhostsForTests('/nonexistent-path-for-builtin');

      // Colliding id appears exactly once and is claimed by the first
      // non-builtin registered (= 'plane').
      const collisions = merged.filter(g => g.id === 'shared-id');
      expect(collisions).toHaveLength(1);
      expect(collisions[0].source).toBe('plane');
      expect(collisions[0].title).toBe('From Plane');

      // Unique ids from both sources survive.
      const planeOnly = merged.find(g => g.id === 'plane-only');
      expect(planeOnly).toBeDefined();
      expect(planeOnly.source).toBe('plane');

      const linearOnly = merged.find(g => g.id === 'linear-only');
      expect(linearOnly).toBeDefined();
      expect(linearOnly.source).toBe('linear');

      // Builtin emitted nothing (no ROADMAP.md at the fake path), so no
      // ghost carries source === 'roadmap-md' here.
      expect(merged.some(g => g.source === BUILTIN)).toBe(false);
    });
  });
});
