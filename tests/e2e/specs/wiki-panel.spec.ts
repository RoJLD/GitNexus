import { test, expect } from '@playwright/test';
import { connectRepo } from '../helpers/connect';

test.describe('Code Wiki panel', () => {
  test.beforeEach(async ({ page }) => {
    await connectRepo(page);
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
  });

  test('opens the Wiki panel and shows iframe or empty-state', async ({ page }) => {
    await page.getByRole('button', { name: /wiki/i }).first().click();
    await expect(page.getByTestId('wiki-panel')).toBeVisible();
    const empty = page.getByTestId('wiki-empty');
    const iframe = page.getByTestId('wiki-iframe');
    await expect(empty.or(iframe)).toBeVisible();
  });

  test('Regenerate fires POST /wiki/generate', async ({ page }) => {
    await page.getByRole('button', { name: /wiki/i }).first().click();
    await expect(page.getByTestId('wiki-panel')).toBeVisible();
    const reqPromise = page.waitForRequest(/\/wiki\/generate\?/, { timeout: 10_000 });
    await page.getByTestId('wiki-regenerate').click();
    const req = await reqPromise;
    expect(req.method()).toBe('POST');
  });
});
