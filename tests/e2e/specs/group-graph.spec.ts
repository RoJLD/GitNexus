import { test, expect } from '@playwright/test';

/**
 * E2E for the multi-repo Group graph panel (Task 7). Opens the panel from the
 * toolbar and asserts the create/sync form is present. A live merged-graph
 * render needs two repos sharing a contract, so it is verified manually; this
 * spec guards the panel + form wiring, which require no synced group.
 */
test.describe('Group graph (multi-repo)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
  });

  test('opens the Group graph panel with a create/sync form', async ({ page }) => {
    await page.getByRole('button', { name: /group graph/i }).first().click();
    await expect(page.getByTestId('group-graph-panel')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('group-name')).toBeVisible();
    await expect(page.getByTestId('group-sync')).toBeVisible();
  });
});
