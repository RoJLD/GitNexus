import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveLayoutPositions,
  loadLayout,
  applyLayoutToGraph,
  clearLayout,
  clearAllLayouts,
} from '../../upstream/gitnexus-web/src/lib/layout-cache.ts';

// Minimal localStorage shim for Node test runtime.
function setupLocalStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        store.set(k, v);
      },
      removeItem: (k) => {
        store.delete(k);
      },
      get length() {
        return store.size;
      },
      key: (i) => [...store.keys()][i] ?? null,
    },
  };
  return store;
}

describe('layout-cache', () => {
  beforeEach(() => {
    setupLocalStorage();
  });

  it('save then load round-trip', () => {
    saveLayoutPositions('repo@sha1', { n1: { x: 10, y: 20 }, n2: { x: 30, y: 40 } });
    const c = loadLayout('repo@sha1');
    expect(c?.positions.n1).toEqual({ x: 10, y: 20 });
    expect(c?.nodeCount).toBe(2);
    expect(c?.version).toBe(1);
  });

  it('loadLayout returns null on absent / corrupt / wrong-version', () => {
    expect(loadLayout('nope')).toBeNull();
    // Simulate corrupt entry
    window.localStorage.setItem('gitnexus:layout:v1:bad', 'not json');
    expect(loadLayout('bad')).toBeNull();
    // Wrong version
    window.localStorage.setItem('gitnexus:layout:v1:v0', JSON.stringify({ version: 0 }));
    expect(loadLayout('v0')).toBeNull();
  });

  it('applyLayoutToGraph counts applied vs missing', () => {
    const positions = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } };
    saveLayoutPositions('key', positions);
    const cached = loadLayout('key');
    const seen = {};
    const graph = {
      order: 3,
      forEachNode(cb) {
        ['a', 'b', 'c'].forEach((id) => cb(id, {}));
      },
      setNodeAttribute(id, key, value) {
        seen[id] = { ...(seen[id] || { x: 0, y: 0 }), [key]: value };
      },
    };
    const r = applyLayoutToGraph(cached, graph);
    expect(r).toEqual({ applied: 2, missing: 1 });
    expect(seen.a).toEqual({ x: 1, y: 2 });
  });

  it('clearLayout removes one entry', () => {
    saveLayoutPositions('k1', {});
    saveLayoutPositions('k2', {});
    clearLayout('k1');
    expect(loadLayout('k1')).toBeNull();
    expect(loadLayout('k2')).not.toBeNull();
  });

  it('clearAllLayouts removes only prefixed entries', () => {
    saveLayoutPositions('k1', {});
    window.localStorage.setItem('unrelated', 'keep me');
    clearAllLayouts();
    expect(loadLayout('k1')).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('keep me');
  });
});
