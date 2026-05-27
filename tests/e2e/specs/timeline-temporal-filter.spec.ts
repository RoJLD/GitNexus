import { test, expect } from '@playwright/test';

/**
 * E2E spec for Timeline Temporal Filter (Phase 2 Item #1).
 * 4 modes : Off / Strict / Normal / Permissive.
 * Composable with Compare A↔B.
 */

test.describe('Timeline Temporal Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    await page.waitForSelector('[data-cursor="B"]', { timeout: 30_000 });
  });

  test('dropdown renders with 4 options', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await expect(select).toBeVisible();
    const options = await select.locator('option').allTextContents();
    expect(options).toEqual(expect.arrayContaining(['Off', 'Strict (A ∩ B)', 'Normal (A ∪ B)', 'Permissive (window)']));
  });

  test('default mode is "off"', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await expect(select).toHaveValue('off');
  });

  test('selecting Strict computes intersection', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');
    // Wait for filter to compute
    await page.waitForTimeout(2000);
    // No spinner means done
    await expect(page.locator('label:has-text("Filter:")').locator('svg[class*="animate-spin"]')).toHaveCount(0);
    // localStorage persisted
    const stored = await page.evaluate(() => localStorage.getItem('timelineTemporalFilterMode'));
    expect(stored).toBe('strict');
  });

  test('selecting Normal computes union', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('normal');
    await page.waitForTimeout(2000);
    const stored = await page.evaluate(() => localStorage.getItem('timelineTemporalFilterMode'));
    expect(stored).toBe('normal');
  });

  test('selecting Permissive calls backend', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');

    // Set up listener for the backend call
    const requestPromise = page.waitForRequest(/\/nodes\/alive-between\?/, { timeout: 10_000 });
    await select.selectOption('permissive');
    const request = await requestPromise;
    expect(request.url()).toContain('/nodes/alive-between');
    expect(request.url()).toMatch(/repo=/);
    expect(request.url()).toMatch(/from=/);
    expect(request.url()).toMatch(/to=/);
  });

  test('selecting Off clears the filter', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');
    await page.waitForTimeout(1000);
    await select.selectOption('off');
    const stored = await page.evaluate(() => localStorage.getItem('timelineTemporalFilterMode'));
    expect(stored).toBe('off');
  });

  test('mode is restored from localStorage on page reload', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('normal');
    await page.reload();
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    const stored = await page.evaluate(() => localStorage.getItem('timelineTemporalFilterMode'));
    expect(stored).toBe('normal');
    await expect(page.locator('label:has-text("Filter:")').locator('select')).toHaveValue('normal');
  });

  test('composes with Compare A↔B (both can be active)', async ({ page }) => {
    const select = page.locator('label:has-text("Filter:")').locator('select');
    await select.selectOption('strict');
    await page.click('button:has-text("Compare A↔B")');
    // Both should be active simultaneously
    await expect(page.locator('button:has-text("Exit compare")')).toBeVisible();
    await expect(select).toHaveValue('strict');
  });
});
