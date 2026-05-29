import { test, expect } from '@playwright/test';

/**
 * E2E for the regression highlight in EntropyCommitTimeline (Tier 60).
 * Turn on the commit-entropy sparkline, click "Locate regression", assert the
 * /regression request fires and the culprit banner appears.
 */

test.describe('Regression highlight in EntropyCommitTimeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
  });

  test('Locate regression fires /regression and shows the banner', async ({ page }) => {
    // Turn on the per-commit entropy sparkline via the Timeline "Commit Δ" toggle.
    const toggle = page.getByRole('button', { name: /Commit\s*Δ/ });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await toggle.click();

    // The "Locate regression" button only exists when the sparkline is mounted.
    const locate = page.getByTestId('locate-regression');
    await expect(locate).toBeVisible({ timeout: 30_000 });

    const reqPromise = page.waitForRequest(/\/regression\?.*metric=(density|modularity)/, { timeout: 15_000 });
    await locate.click();
    const req = await reqPromise;
    expect(req.url()).toMatch(/\/regression\?/);

    // The banner appears (culprit, "no clear regression", or an error — all use the same testid).
    await expect(page.getByTestId('regression-banner')).toBeVisible({ timeout: 15_000 });
  });
});
