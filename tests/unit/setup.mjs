import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node >= 22 ships an experimental native `localStorage` global; without
// `--localstorage-file` it is a non-functional stub whose methods are absent
// (`TypeError: storage.getItem is not a function` — measured 2026-07-11 on
// Node 25 + jsdom, where the native global shadows jsdom's Storage and took
// down ~20 component tests). Install a real in-memory Web Storage on both
// globalThis and window so component code touching localStorage/sessionStorage
// behaves identically on every Node version (CI pins 22.11, devs drift newer).
function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => { map.clear(); },
  };
}
for (const name of ['localStorage', 'sessionStorage']) {
  const store = memoryStorage();
  Object.defineProperty(globalThis, name, { value: store, configurable: true, writable: true });
  if (typeof window !== 'undefined' && window !== globalThis) {
    Object.defineProperty(window, name, { value: store, configurable: true, writable: true });
  }
}

afterEach(() => {
  cleanup();
  // Per-test isolation — a test writing settings must not leak into the next.
  globalThis.localStorage?.clear?.();
  globalThis.sessionStorage?.clear?.();
});
