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

  // NB (measured 2026-07-12): `enterLifespanMode` reads temporalFilterMode AT OPEN
  // time (useCallback in useAppState — no live re-fetch on later filter changes), so
  // the filter must be set BEFORE opening the panel. The old "reset reverts while
  // open" test asserted a live-update behavior that never existed. These two tests
  // were briefly quarantined because the windowed backend path was broken (2 bugs,
  // both fixed in docker-server-lifespan.mjs): `fetch(${api}/snapshots)` hit a 404
  // HTML page (→ in-process read), and the windowed response lacked `totalPoints`
  // (→ the frontend rejected it). Verified live: /lifespan?from&to returns
  // { totalPoints, windowed:{from,to,snapshotCount}, counts, nodes }.
  test('Strict filter set before open → header "Lifespan (window)" + badge', async ({ page }) => {
    await page.locator('label:has-text("Filter:")').locator('select').selectOption('strict');
    await openLifespanPanel(page);
    await expect(page.getByTestId('lifespan-header')).toContainText('(window)', { timeout: 15_000 });
    const badge = page.getByTestId('lifespan-window-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('→');
    await expect(badge).toContainText(/snapshots?/);
  });

  test('Normal filter set before open also windows the panel', async ({ page }) => {
    await page.locator('label:has-text("Filter:")').locator('select').selectOption('normal');
    await openLifespanPanel(page);
    await expect(page.getByTestId('lifespan-header')).toContainText('(window)', { timeout: 15_000 });
  });
});
