import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
