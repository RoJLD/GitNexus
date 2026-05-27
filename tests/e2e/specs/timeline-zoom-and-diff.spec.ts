import { test, expect } from '@playwright/test';

/**
 * E2E spec for Timeline zoom + 2 cursors A/B (Phase 1 of
 * timeline-zoom-cursors-design).
 *
 * Coverage as of commits 9ec002e8...40594689 :
 *   - Tasks 1-9 + Task 10 button + Task 12 keyboard shortcuts
 *   - Task 11 (wire graphMode='diff' to fetch + Sigma coloring) is DEFERRED
 *     in this iteration. The "Compare A↔B" button toggles graphMode state
 *     correctly but the canvas does not yet render the diff colors. This
 *     spec validates the button label transition but does NOT assert on
 *     red/green/gray graph coloring.
 *
 * Spec source: docs/superpowers/specs/2026-05-27-timeline-zoom-cursors-design.md
 */

test.describe('Timeline zoom + cursor diff (Phase 1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4173/');
    // Wait for the app to load. The integration global-setup analyzes the
    // sample-repo fixture which has ≥ 3 snapshots, so cursors should
    // initialize automatically.
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
    await page.waitForSelector('[data-cursor="B"]', { timeout: 30_000 });
  });

  test('cursors A (blue) and B (orange) render on the timeline', async ({ page }) => {
    const cursorA = page.locator('[data-cursor="A"]');
    const cursorB = page.locator('[data-cursor="B"]');
    await expect(cursorA).toBeVisible();
    await expect(cursorB).toBeVisible();
    // Visual : A should be at lower x than B (since auto-swap enforces A ≤ B).
    const boxA = await cursorA.boundingBox();
    const boxB = await cursorB.boundingBox();
    expect(boxA).not.toBeNull();
    expect(boxB).not.toBeNull();
    if (boxA && boxB) {
      expect(boxA.x).toBeLessThanOrEqual(boxB.x);
    }
  });

  test('clicking "Zoom to window" shows the mini-map and toggles button label', async ({ page }) => {
    // Initially no mini-map (zoomWindow null)
    await expect(page.getByRole('region', { name: /mini-map/i })).not.toBeVisible();

    // Click zoom button
    await page.click('button:has-text("Zoom to window")');

    // Mini-map appears + button label toggles
    await expect(page.getByRole('region', { name: /mini-map/i })).toBeVisible();
    await expect(page.locator('button:has-text("Zoom out")')).toBeVisible();
    await expect(page.locator('button:has-text("Zoom to window")')).not.toBeVisible();

    // Click again to zoom out
    await page.click('button:has-text("Zoom out")');
    await expect(page.getByRole('region', { name: /mini-map/i })).not.toBeVisible();
    await expect(page.locator('button:has-text("Zoom to window")')).toBeVisible();
  });

  test('"Compare A↔B" toggles graphMode state (button label switch)', async ({ page }) => {
    await expect(page.locator('button:has-text("Compare A↔B")')).toBeVisible();
    await page.click('button:has-text("Compare A↔B")');
    await expect(page.locator('button:has-text("Exit compare")')).toBeVisible();
    await page.click('button:has-text("Exit compare")');
    await expect(page.locator('button:has-text("Compare A↔B")')).toBeVisible();
  });

  test('keyboard shortcut Z toggles zoom', async ({ page }) => {
    await page.keyboard.press('z');
    await expect(page.locator('button:has-text("Zoom out")')).toBeVisible();
    await page.keyboard.press('z');
    await expect(page.locator('button:has-text("Zoom to window")')).toBeVisible();
  });

  test('keyboard shortcut Shift+D toggles compare', async ({ page }) => {
    await page.keyboard.press('Shift+D');
    await expect(page.locator('button:has-text("Exit compare")')).toBeVisible();
    await page.keyboard.press('Shift+D');
    await expect(page.locator('button:has-text("Compare A↔B")')).toBeVisible();
  });

  test('duration indicator shows YYYY-MM-DD → YYYY-MM-DD · Δ N · M snapshots', async ({ page }) => {
    const indicator = page.locator('[data-testid="timeline-duration-indicator"]');
    await expect(indicator).toBeVisible();
    // Format: "YYYY-MM-DD → YYYY-MM-DD · Δ X (days|hours|years) · N snapshot(s)"
    await expect(indicator).toContainText(/\d{4}-\d{2}-\d{2}\s+→\s+\d{4}-\d{2}-\d{2}/);
    await expect(indicator).toContainText(/Δ\s+\d+\s+(days?|hours?|years?)/);
    await expect(indicator).toContainText(/\d+\s+snapshots?/);
  });

  test('Cursor A keyboard accessibility (role=slider + aria-label)', async ({ page }) => {
    const cursorA = page.locator('[role="slider"][aria-label="Cursor A"]');
    const cursorB = page.locator('[role="slider"][aria-label="Cursor B"]');
    await expect(cursorA).toBeVisible();
    await expect(cursorB).toBeVisible();
    // aria-valuemin/aria-valuemax should be set
    await expect(cursorA).toHaveAttribute('aria-valuemin', '0');
    await expect(cursorB).toHaveAttribute('aria-valuemin', '0');
  });
});
