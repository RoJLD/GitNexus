import { test, expect } from '@playwright/test';
import { connectRepo } from '../helpers/connect';

/**
 * E2E — Gantt panel (roadmap-predictive Tier 3.x, Section D Task 10).
 *
 * Verifies:
 *  1. The Gantt toggle button opens the GanttPanel overlay (the
 *     `data-testid="gantt-panel"` container becomes visible).
 *  2. The panel renders at least one Gantt row (the underlying SVG —
 *     hosting axis + bars — is mounted). When the fixture repo has no
 *     ghosts the panel falls back to a placeholder message; skip the
 *     row assertion in that case rather than fail spuriously.
 *  3. Toggling the "Swimlanes by Tier" checkbox redraws the panel and
 *     surfaces a Tier group header — proof the swimlane grouping path
 *     wired through.
 *
 * Pure frontend feature (no backend modules touched), so the smoke
 * level is: panel opens, SVG renders, headers appear on toggle.
 */

const REPO = process.env.E2E_REPO || 'sample-repo';

test.describe('Gantt panel', () => {
  // De-quarantined 2026-07-12: the swimlanes control is a radio group
  // (`gantt-swimlanes-{flat,tier,cluster}`), not a single `gantt-swimlanes-toggle`.
  test('toggle button opens panel + swimlanes header appears on toggle', async ({ page }) => {
    await connectRepo(page);

    // Open the fixture repo (sidebar list).
    await page.getByText(REPO, { exact: false }).first().click();

    // Wait for the Sigma canvas to render — same gating as the other
    // overlay panels (Audit, Augmented).
    await page.waitForSelector('canvas', { timeout: 15_000 });

    // Flip the floating "Gantt" toggle button (bottom-right corner).
    await page.locator('[data-testid="gantt-panel-toggle"]').click();

    const panel = page.locator('[data-testid="gantt-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // SVG axis + bars area should be mounted. Bail out gracefully if
    // the fixture has no ghosts at all (placeholder text only).
    const svg = panel.locator('svg').first();
    const svgCount = await svg.count();
    test.skip(svgCount === 0, 'fixture has no ghosts — placeholder only');
    await expect(svg).toBeVisible();

    // Switch swimlanes to "By Tier" (radio input, not a single toggle).
    await panel.locator('[data-testid="gantt-swimlanes-tier"]').click();

    // A tier group header (e.g. "Tier 1", via tierGroupLabel) is rendered as
    // SVG text once the grouping path is wired. sample-repo's ROADMAP declares
    // a Tier 1, so at least one "Tier …" label appears.
    await expect(panel.getByText(/Tier/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
