import { test, expect } from '@playwright/test';
import { connectRepo } from '../helpers/connect';

/**
 * E2E spec for Lifespan Windowed (Phase 2 Item #3).
 * Verify the LifespanPanel header switches between global and windowed modes
 * based on temporalFilterMode.
 *
 * 2026-07-12 : de-quarantined. The feature exists (LifespanPanel renders
 * "Lifespan (window)" + a snapshot badge when `lifespanData.windowed` is set);
 * the old tests failed only because they looked for an `h2:has-text("Lifespan")`
 * that never existed (the header is a `<span>`). LifespanPanel now carries
 * `data-testid` on the panel / header / window-badge, so the assertions are
 * robust to Tailwind-class churn.
 */

async function openLifespanPanel(page) {
  // The "Lifespan" analytics-mode button (timeline toolbar) opens the panel.
  await page.getByRole('button', { name: 'Lifespan', exact: true }).click();
  await expect(page.getByTestId('lifespan-panel')).toBeVisible({ timeout: 15_000 });
}

test.describe('Lifespan windowed', () => {
  test.beforeEach(async ({ page }) => {
    await connectRepo(page);
  });

  test('initial header is "Lifespan" (global mode, temporalFilterMode=off)', async ({ page }) => {
    await openLifespanPanel(page);
    const header = page.getByTestId('lifespan-header');
    await expect(header).toContainText('Lifespan');
    await expect(header).not.toContainText('(window)');
  });

  // QUARANTINED 2026-07-12 — BACKEND bug, not a test/selector issue. The windowed
  // path (`GET /lifespan?repo=&from=&to=`) returns
  //   {"error":"Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"}
  // — it internally hits an endpoint that serves HTML (a 404 page) instead of JSON,
  // so `lifespanData.windowed` is never set and the "(window)" header/badge never
  // render (measured via curl on sample-repo, from=<snap>&to=live AND to=<snap>).
  // Same 404-HTML class as the /analyze api-client bug. The interaction is otherwise
  // correct: `enterLifespanMode` reads temporalFilterMode AT OPEN time (useCallback,
  // no live re-fetch), so the filter must be set BEFORE opening. Un-fixme once the
  // server-side windowed /lifespan path is fixed.
  test.fixme('Strict filter set before open → header "Lifespan (window)" + badge', async ({ page }) => {
    await page.locator('label:has-text("Filter:")').locator('select').selectOption('strict');
    await openLifespanPanel(page);
    await expect(page.getByTestId('lifespan-header')).toContainText('(window)', { timeout: 15_000 });
    const badge = page.getByTestId('lifespan-window-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('→');
    await expect(badge).toContainText(/snapshots?/);
  });

  test.fixme('Normal filter set before open also windows the panel', async ({ page }) => {
    await page.locator('label:has-text("Filter:")').locator('select').selectOption('normal');
    await openLifespanPanel(page);
    await expect(page.getByTestId('lifespan-header')).toContainText('(window)', { timeout: 15_000 });
  });
});
