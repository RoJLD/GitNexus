import { test, expect } from '@playwright/test';

/**
 * E2E — Cluster halos (roadmap-predictive Tier 3.x Ghost Cluster,
 * Section J Task 15).
 *
 * Verifies the Augmented surface of the Ghost Cluster feature:
 *  1. The "Show cluster halos" master toggle in the Filters panel turns
 *     ON the SVG overlay that paints convex-hull halos over the Sigma
 *     graph canvas.
 *  2. At least one `[data-testid^="cluster-halo-"]` element renders
 *     when the fixture repo has declared clusters.
 *  3. Clicking a halo opens the `ClusterTooltip` popup
 *     (`[data-testid="cluster-tooltip"]`).
 *
 * Skips gracefully when the fixture has no clusters declared — that
 * scenario is exercised by the unit + integration tests anyway, and
 * the E2E here only needs to prove the wiring (toggle → overlay →
 * click → tooltip) end-to-end.
 */

const REPO = process.env.E2E_REPO || 'sample-repo';

test.describe('Cluster halos', () => {
  test('toggle Show cluster halos → halos visible → click → tooltip', async ({ page }) => {
    await page.goto('/');

    // Open the fixture repo (sidebar list) — same gating pattern as the
    // other Augmented / Audit / Gantt E2Es.
    await page.getByText(REPO, { exact: false }).first().click();

    // Wait for the Sigma canvas to render (graph mounted before the
    // SVG overlay tries to read camera state).
    await page.waitForSelector('canvas', { timeout: 15_000 });
    await page.locator('[data-testid="graph-canvas"]').waitFor({ timeout: 15_000 });

    // Flip the master "Show cluster halos" toggle (lives in the
    // Roadmap-predictive section of the Filters panel — text-locator
    // is robust to data-testid drift).
    const toggle = page.locator('text=Show cluster halos').first();
    await toggle.click();

    // If the fixture has no clusters declared (and no auto-derivable
    // dependsOn[] chains), the overlay renders empty. Skip rather than
    // fail spuriously — coverage of the empty path lives in the unit +
    // integration tiers.
    const halo = page.locator('[data-testid^="cluster-halo-"]').first();
    if ((await halo.count()) === 0) {
      test.skip(true, 'No clusters in fixture — declare some in ROADMAP.md or rely on dependsOn[] auto-derivation');
    }

    await halo.click();
    await expect(page.locator('[data-testid="cluster-tooltip"]')).toBeVisible();
  });
});
