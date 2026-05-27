import { test, expect } from '@playwright/test';

/**
 * E2E spec for Lifespan Windowed (Phase 2 Item #3).
 * Verify the panel header switches between global and windowed modes
 * based on temporalFilterMode.
 */

test.describe('Lifespan windowed', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    // Wait for the timeline cursors to initialize
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    await page.waitForSelector('[data-cursor="B"]', { timeout: 30_000 });
  });

  test('initial header is "Lifespan" (global mode, temporalFilterMode=off)', async ({ page }) => {
    // Open the Lifespan panel (assumes there's a button/tab to toggle it open)
    const lifespanBtn = page.locator('button:has-text("Lifespan")').first();
    await lifespanBtn.click();

    const header = page.locator('h2:has-text("Lifespan"), [data-panel="lifespan"] h2').first();
    await expect(header).toBeVisible();
    await expect(header).toContainText('Lifespan');
    await expect(header).not.toContainText('(window)');
  });

  test('selecting Strict filter → header becomes "Lifespan (window)" + badge', async ({ page }) => {
    // Open the Lifespan panel
    const lifespanBtn = page.locator('button:has-text("Lifespan")').first();
    await lifespanBtn.click();

    // Activate temporal filter via the dropdown (Item #1)
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');

    // Wait for the windowed re-fetch
    await page.waitForTimeout(2000);

    // Header should now show "(window)" + a badge
    const header = page.locator('h2:has-text("Lifespan")').first();
    await expect(header).toContainText('(window)');

    // Badge format : "<from> → <to> · <N> snapshots"
    const badge = page.locator('[class*="bg-accent"]:has-text("snapshot")').first();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/→/);
    await expect(badge).toContainText(/snapshots?/);
  });

  test('resetting Filter to Off → header reverts to "Lifespan"', async ({ page }) => {
    const lifespanBtn = page.locator('button:has-text("Lifespan")').first();
    await lifespanBtn.click();

    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('normal');
    await page.waitForTimeout(1500);

    // Confirm windowed mode active
    await expect(page.locator('h2:has-text("Lifespan")').first()).toContainText('(window)');

    // Reset to off
    await select.selectOption('off');
    await page.waitForTimeout(1500);

    // Header reverts
    const header = page.locator('h2:has-text("Lifespan")').first();
    await expect(header).not.toContainText('(window)');
  });
});
