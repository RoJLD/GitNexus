import { test, expect } from '@playwright/test';
import { connectRepo } from '../helpers/connect';

/**
 * E2E — Cluster halos (roadmap-predictive Tier 3.x Ghost Cluster,
 * Section J Task 15).
 *
 * Verifies the Augmented surface of the Ghost Cluster feature:
 *  1. The "Show cluster halos" master toggle in the Filters panel turns
 *     ON the SVG overlay that paints convex-hull halos over the Sigma
 *     graph canvas.
 *  2. At least one `[data-testid^="cluster-halo-"]` element renders
 *     when the fixture repo has declared clusters.
 *  3. Clicking a halo opens the `ClusterTooltip` popup
 *     (`[data-testid="cluster-tooltip"]`).
 *
 * DE-QUARANTINED 2026-08-19 (was `test.fixme` since 2026-07-12). Two
 * independent gaps closed, both needed together:
 *  (a) the "Show cluster halos" toggle lives inside the Filters panel,
 *      which this test never opened — fixed by opening it first, the
 *      same gating pattern already proven by 04-augmented-graph.spec.ts
 *      (`page.getByRole('button', { name: /filter/i })`).
 *  (b) the sample-repo fixture declared 0 clusters (`/clusters` → []),
 *      so the halo path was unexercisable regardless of the UI fix —
 *      fixed by declaring a real "Tier 1 foundation" cluster in the
 *      fixture's ROADMAP.md (`## 🔗 Clusters`, see
 *      tests/fixtures/make-fixture.mjs commit 14), grouping two Tier-1
 *      ghosts (`tier-1-2-helpers-utility`, `tier-1-3-config-validator`).
 *
 * Two non-obvious prerequisites, both measured against the real source
 * (not assumed):
 *  - `applyClusterHalos` (useSigma.ts) hulls each cluster's polygon from
 *    the ghost-NODE canvas positions (`ghost:<memberId>`) — those nodes
 *    only exist once the master "Show ghosts" toggle is also ON
 *    (`applyGhostLayer` no-ops the whole layer when `showGhosts` is
 *    false). So the test flips both toggles, not just the halo one.
 *  - `passesFilter` (ghost-layout.ts) never draws a ghost node once its
 *    status is `materialized` ("doublons of real nodes"). The fixture's
 *    pre-existing `### 1.1 — Migration runner ✅` is materialized, so it
 *    can NEVER contribute a halo vertex — the cluster deliberately picks
 *    two still-`planned` (⏳) Tier-1 ghosts instead.
 */

const REPO = process.env.E2E_REPO || 'sample-repo';

test.describe('Cluster halos', () => {
  test('toggle Show cluster halos → halos visible → click → tooltip', async ({ page }) => {
    await connectRepo(page);

    // Open the fixture repo (sidebar list) — same gating pattern as the
    // other Augmented / Audit / Gantt E2Es.
    await page.getByText(REPO, { exact: false }).first().click();

    // Wait for the Sigma canvas to render (graph mounted before the
    // SVG overlay tries to read camera state).
    await page.waitForSelector('canvas', { timeout: 15_000 });

    // Open the Filters panel — both toggles below live inside it.
    await page.getByRole('button', { name: /filter/i }).click();

    // Ghost nodes must be on the canvas for the halo hull to have
    // positions to hull from — flip the master "Show ghosts" toggle
    // first (see file header: this is the 3rd, non-UI prerequisite).
    await page.getByLabel(/show ghosts/i).click();

    // Flip the master "Show cluster halos" toggle (Roadmap-predictive
    // sub-block; getByLabel is robust to data-testid drift, same
    // idiom as the "Show ghosts" toggle above).
    await page.getByLabel(/show cluster halos/i).click();

    // The fixture declares 1 real cluster (see file header) whose two
    // members are both still-planned (non-materialized, non-cancelled)
    // Tier-1 ghosts, so both pass DEFAULT_GHOST_FILTERS and the halo
    // renders once the ghost layer + overlay effects settle.
    const halo = page.locator('[data-testid^="cluster-halo-"]').first();
    await expect(halo).toBeVisible({ timeout: 15_000 });

    await halo.click();
    await expect(page.locator('[data-testid="cluster-tooltip"]')).toBeVisible();
  });
});
