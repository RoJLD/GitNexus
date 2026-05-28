import { test, expect } from '@playwright/test';

/**
 * E2E spec for Timeline URL Persistence (Phase 2 Item #5).
 * Verify Timeline state round-trips through URL query params.
 */

test.describe('Timeline URL persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    await page.waitForSelector('[data-cursor="B"]', { timeout: 30_000 });
  });

  test('selecting filter + compare writes tl* params to URL', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');
    await page.click('button:has-text("Compare A↔B")');
    await page.waitForTimeout(1500);

    const url = page.url();
    expect(url).toMatch(/tlFilter=strict/);
    expect(url).toMatch(/tlMode=diff/);
    // tlA + tlB written once cursors resolve to shortHashes
    expect(url).toMatch(/tlA=/);
    expect(url).toMatch(/tlB=/);
  });

  test('state restores after reload', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('normal');
    await page.waitForTimeout(1500);
    expect(page.url()).toMatch(/tlFilter=normal/);

    await page.reload();
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    await page.waitForTimeout(1500);

    // Filter dropdown restored to "normal"
    await expect(page.locator('label:has-text("Filter:")').locator('select')).toHaveValue('normal');
    // URL still has the param
    expect(page.url()).toMatch(/tlFilter=normal/);
  });

  test('resetting filter to off removes tlFilter from URL', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');
    await page.waitForTimeout(1000);
    expect(page.url()).toMatch(/tlFilter=strict/);

    await select.selectOption('off');
    await page.waitForTimeout(1000);
    expect(page.url()).not.toMatch(/tlFilter=/);
  });

  test('zoom writes tlZoom=1, zoom out removes it', async ({ page }) => {
    await page.click('button:has-text("Zoom to window")');
    await page.waitForTimeout(1000);
    expect(page.url()).toMatch(/tlZoom=1/);

    await page.click('button:has-text("Zoom out")');
    await page.waitForTimeout(1000);
    expect(page.url()).not.toMatch(/tlZoom=/);
  });

  test('zoom + cursors restore after reload (deferred-zoom path)', async ({ page }) => {
    // Zoom writes tlZoom=1 plus the resolved cursor shortHashes (tlA/tlB).
    await page.click('button:has-text("Zoom to window")');
    await page.waitForTimeout(1500);
    expect(page.url()).toMatch(/tlZoom=1/);
    expect(page.url()).toMatch(/tlA=/);
    expect(page.url()).toMatch(/tlB=/);

    await page.reload();
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    await page.waitForSelector('[data-cursor="B"]', { timeout: 30_000 });
    await page.waitForTimeout(1500);

    // Deferred-zoom effect should have re-entered zoom once cursors landed.
    await expect(page.locator('button:has-text("Zoom out")')).toBeVisible();
    expect(page.url()).toMatch(/tlZoom=1/);
  });
});
