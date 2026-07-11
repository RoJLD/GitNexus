import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the GitNexus e2e tier.
 *
 * CONTEXT (2026-07-12) : this file was MISSING — `npm run test:e2e` invokes
 * `playwright test --config e2e/playwright.config.ts` but the config never
 * existed, so every spec died at config-load and the CI `e2e` job (which is
 * `continue-on-error: true`) swallowed the failure. No e2e spec had ever run.
 * See docs/superpowers/specs/2026-05-27-timeline-zoom-cursors-design.md
 * § Update 2026-07-12 for the full diagnosis.
 *
 * The stack is brought up OUTSIDE playwright (CI: `docker compose -f
 * docker-compose.test.yml up -d`; local: the dev compose). We do NOT declare a
 * `webServer` — we only point `baseURL` at the already-running web container.
 *
 * Connection: the app needs `?project=<repo>&server=<api>` to auto-connect a
 * repo (a bare `goto('/')` lands on the picker). Specs connect via
 * `helpers/connect.ts` (E2E_REPO / E2E_API_URL overridable).
 */

const WEB_URL = process.env.E2E_WEB_URL || 'http://localhost:4173';

export default defineConfig({
  testDir: './specs',
  // Snapshots + graph warm-up on a cold container make the first navigation
  // slow; keep the per-test budget generous but bounded.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Serial: the specs share one backend stack + one indexed repo; parallel
  // pages would race the same registry/snapshot state.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    // CI uploads tests/playwright-report (see .github/workflows/test.yml).
    // outputFolder resolves relative to this config's dir (tests/e2e).
    ['html', { outputFolder: '../playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
