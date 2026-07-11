import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Strip shebangs from directly-imported CLI scripts (scripts/*.mjs,
// tools/*.mjs). vitest 4 / rolldown's CJS-interop transform hoists the
// rewritten `node:` imports ABOVE the original file body, so a
// `#!/usr/bin/env node` first line lands mid-statement and rolldown throws
// `Parse failure: Invalid Character '!'` (measured 2026-07-11 — took down
// 8 unit files: check-patch-drift, bump-report, check-upstream-releases,
// onnx-to-model-graph, academic-extract, baseline-seed-marker,
// install-brainstorm-hooks, panel-groups). enforce:'pre' runs before that
// interop transform; a newline keeps sourcemap line numbers aligned.
const stripShebang = {
  name: 'strip-shebang-for-cli-scripts',
  enforce: 'pre',
  transform(code) {
    if (code.startsWith('#!')) {
      return { code: code.replace(/^#![^\n]*/, ''), map: null };
    }
    return null;
  },
};

export default defineConfig({
  plugins: [stripShebang, react()],
  // Mirror the app's vite `define` so modules referencing build-time constants
  // (e.g. config/ui-constants.ts → __REQUIRED_NODE_VERSION__) load under the
  // test runner. Value is irrelevant to tests; it just must be defined.
  define: {
    __REQUIRED_NODE_VERSION__: JSON.stringify('22.12.0'),
  },
  // The gitnexus-web app uses the `@` → src alias (Vite). Component tests
  // import patched components that use it (e.g. `@/lib/lucide-icons`), so the
  // test runner must resolve it too — else transform fails before our vi.mock
  // can intercept. (Latent until the suite first ran under Node 22 in Docker.)
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../upstream/gitnexus-web/src', import.meta.url)),
      'gitnexus-shared': fileURLToPath(new URL('../upstream/gitnexus-shared/src/index.ts', import.meta.url)),
      '@shared': fileURLToPath(new URL('../upstream/shared', import.meta.url)),
    },
  },
  test: {
    name: 'unit',
    include: ['unit/**/*.test.{mjs,ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./unit/setup.mjs'],
    testTimeout: 10_000,
    pool: 'threads',
    reporters: ['default'],
  },
});
