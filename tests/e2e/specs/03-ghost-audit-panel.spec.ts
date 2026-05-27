import { test, expect } from '@playwright/test';

/**
 * E2E — Audit panel (Tier 2.6 Ghost-Audit, Section E Task 22b).
 *
 * Verifies:
 *  1. The audit panel renders for a synced repo (data-testid="audit-panel").
 *  2. The 6-card summary block is visible (data-testid="audit-summary").
 *  3. Clicking the top churner in PlanChurnList highlights the
 *     matching row in GhostTable (the row gains a `highlighted`
 *     class — see AuditPanel.tsx state wiring).
 */

const REPO = process.env.E2E_REPO || 'sample-repo';

test.describe('Audit panel', () => {
  test('renders summary + highlights churner row on click', async ({ page }) => {
    await page.goto('/');

    // Open the fixture repo (sidebar list).
    await page.getByText(REPO, { exact: false }).first().click();

    // Switch to the Audit panel via its toggle button.
    await page.getByRole('button', { name: /audit/i }).click();

    const panel = page.locator('[data-testid="audit-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // 6 summary cards (Total / Materialized / Planned / Cancelled / Cancel rate / Expired).
    await expect(panel.getByTestId('audit-summary')).toBeVisible();

    // Find a top churner — bail out gracefully if the fixture has no churners.
    const churners = panel.locator('[data-testid="plan-churn-item"]');
    const churnerCount = await churners.count();
    test.skip(churnerCount === 0, 'fixture has no plan churners to click');

    const firstChurner = churners.first();
    const churnerId = await firstChurner.getAttribute('data-ghost-id');
    expect(churnerId, 'churner item must carry data-ghost-id').toBeTruthy();

    await firstChurner.click();

    // The matching GhostTable row should be highlighted.
    const highlightedRow = panel.locator(
      `[data-testid="ghost-row"][data-ghost-id="${churnerId}"]`,
    );
    await expect(highlightedRow).toHaveClass(/highlighted/);
  });
});
