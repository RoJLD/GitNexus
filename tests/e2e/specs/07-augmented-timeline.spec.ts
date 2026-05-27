import { test, expect } from '@playwright/test';

/**
 * E2E — Augmented Timeline (roadmap-predictive Tier 3.x, 2026-05-27).
 *
 * Two minimal sanity flows, both with graceful skip when the fixture
 * doesn't have the prerequisite snapshots :
 *  1. Activate "Show ghosts", scrub the timeline (drag cursorB) — the
 *     canvas must keep rendering without throwing.
 *  2. Click the "Animate roadmap" button — the "Animating roadmap…"
 *     banner appears.
 *
 * Detailed cross-fade behavior is exercised by the unit tests in
 * `tests/unit/augmented-timeline.test.mjs` + `snapshot-ghosts-cache.test.mjs`.
 */

const REPO = process.env.E2E_REPO || 'sample-repo';

test.describe('Augmented Timeline', () => {
  test('scrub timeline cursor with ghosts on (or skip if no snapshots)', async ({ page }) => {
    await page.goto('/');
    await page.getByText(REPO, { exact: false }).first().click();
    await page.waitForSelector('canvas', { timeout: 15_000 });

    // Open Filters, activate Show ghosts.
    await page.getByRole('button', { name: /filter/i }).click();
    const showGhosts = page.getByLabel(/show ghosts/i);
    await showGhosts.click();

    // CursorB drag handle — present only when ≥ 2 snapshots exist.
    const cursorB = page.locator('[data-cursor="B"]');
    const count = await cursorB.count();
    test.skip(count === 0, 'Fixture has no snapshot timeline');

    const box = await cursorB.boundingBox();
    if (!box) test.skip(true, 'Cursor B has no bounding box');
    // Drag cursor B to the left so it lands on an earlier snapshot.
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x - 60, box!.y + box!.height / 2, { steps: 6 });
    await page.mouse.up();

    // Canvas must still be visible (no React error tearing it down).
    await page.waitForTimeout(300);
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('Animate roadmap button triggers play + shows banner (or skip)', async ({ page }) => {
    await page.goto('/');
    await page.getByText(REPO, { exact: false }).first().click();
    await page.waitForSelector('canvas', { timeout: 15_000 });

    const btn = page.locator('[data-testid="animate-roadmap-button"]');
    const count = await btn.count();
    test.skip(count === 0, 'Animate button absent (no snapshots in fixture)');

    await btn.click();
    await expect(
      page.locator('[data-testid="animate-roadmap-banner"]'),
    ).toBeVisible({ timeout: 2000 });
  });
});
