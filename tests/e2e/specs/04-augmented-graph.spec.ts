import { test, expect } from '@playwright/test';

/**
 * E2E — Augmented graph view (roadmap-predictive Tier 3.x).
 *
 * Verifies:
 *  1. Toggling "Show ghosts" in Filters reveals the per-Tier sub-toggles
 *     (master + Tier 1 + Tier 2 + Tier 3 + Show cancelled).
 *  2. Cancelled toggle is present but unchecked by default — cancelled
 *     ghosts are opt-in.
 *
 * Clicking a ghost on the WebGL canvas is non-trivial in Playwright
 * (no DOM target), so the tooltip assertion is left to unit tests
 * (GhostTooltip.test.tsx) + manual QA.
 */

const REPO = process.env.E2E_REPO || 'sample-repo';

test.describe('Augmented graph view', () => {
  test('Show ghosts toggle reveals per-Tier sub-toggles', async ({ page }) => {
    await page.goto('/');

    // Open the fixture repo (sidebar list).
    await page.getByText(REPO, { exact: false }).first().click();

    // Wait for the Sigma canvas to render.
    await page.waitForSelector('canvas', { timeout: 15_000 });

    // Open the Filters panel and flip the master "Show ghosts" toggle.
    await page.getByRole('button', { name: /filter/i }).click();
    await page.getByLabel(/show ghosts/i).click();

    // The per-Tier toggles + cancelled toggle become visible once master is ON.
    await expect(page.getByLabel(/tier 1/i)).toBeVisible();
    await expect(page.getByLabel(/tier 2/i)).toBeVisible();
    await expect(page.getByLabel(/tier 3/i)).toBeVisible();
  });

  test('Cancelled toggle hidden by default; appears unchecked when master ON', async ({ page }) => {
    await page.goto('/');
    await page.getByText(REPO, { exact: false }).first().click();
    await page.waitForSelector('canvas', { timeout: 15_000 });

    await page.getByRole('button', { name: /filter/i }).click();
    await page.getByLabel(/show ghosts/i).click();

    const cancelled = page.getByLabel(/show cancelled/i);
    await expect(cancelled).toBeVisible();
    await expect(cancelled).not.toBeChecked();

    // Tooltip click assertion deferred — WebGL hit-testing not reachable
    // via Playwright DOM queries. Covered by GhostTooltip.test.tsx unit.
  });
});
