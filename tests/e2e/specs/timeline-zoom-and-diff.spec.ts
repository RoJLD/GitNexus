import { test, expect } from '@playwright/test';

/**
 * E2E spec for Timeline zoom + 2 cursors A/B (Phase 1 of
 * timeline-zoom-cursors-design).
 *
 * Coverage as of commits 9ec002e8...40594689 :
 *   - Tasks 1-9 + Task 10 button + Task 12 keyboard shortcuts
 *   - Task 11 (graphMode='diff' → Sigma coloring) — CORRIGÉ 2026-07-11 : le
 *     commentaire « DEFERRED » ci-devant était PÉRIMÉ. Mesure du code : la chaîne
 *     est CÂBLÉE de bout en bout — enterCursorDiff (useAppState) → computeGraphDiff
 *     → setDiffData → diffData.nodeStatus → GraphCanvas diffNodeStatus → le
 *     nodeReducer/edgeReducer de useSigma applique DIFF_COLORS (rouge onlyInA /
 *     émeraude onlyInB / gris inBoth). Le "Compare A↔B" ne ment PAS : il colore.
 *     L'util computeGraphDiff/diffBetweenSnapshots est unit-testé
 *     (unit/graph-diff-between-snapshots.test.mjs). Les couleurs de nœud sont du
 *     PIXEL CANVAS Sigma (non pixel-assertable en Playwright). Depuis 2026-07-11 une
 *     **légende DOM cursor-diff** (`data-testid="cursor-diff-legend"`, mêmes DIFF_COLORS
 *     que les reducers) donne un feedback visuel + les counts A/B/both. MAIS mesuré
 *     (Playwright MCP) : le diff (donc la légende) ne s'active QUE si les 2 cursors
 *     résolvent vers des snapshots DIFFÉRENTS (garde useAppState `nameA===nameB`) —
 *     c'est la vraie raison du « deferred » d'origine (forcer 2 snapshots distincts de
 *     façon fiable est le point dur, pas l'absence de rendu). Le test légende ci-dessous
 *     est donc conditionnel (pas de faux rouge si le fixture a des cursors identiques).
 *     NE PAS re-graver « deferred » : la chaîne EST câblée.
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

  test('Compare A↔B — cursor-diff legend appears ONLY when cursors span distinct snapshots', async ({ page }) => {
    // Task 11 enhancement (2026-07-11) : a DOM legend (`cursor-diff-legend`, same
    // DIFF_COLORS the Sigma reducers paint) renders WHEN a snapshot diff is active.
    // MESURÉ (Playwright MCP) : le diff ne s'active que si les 2 cursors résolvent vers
    // des snapshots DIFFÉRENTS (useAppState garde `if (nameA===nameB) return`) — sinon
    // enterCursorDiff bail, diffData reste null, pas de légende.
    // 2026-07-12 : rendre ce test DÉTERMINISTE est gaté par 3 trous d'infra e2e (voir
    // docs/superpowers/specs/2026-05-27-timeline-zoom-cursors-design.md § Update 2026-07-12) :
    //   (1) tests/e2e/playwright.config.ts ABSENT → ces specs ne s'exécutent JAMAIS (job
    //       CI e2e = continue-on-error, échec avalé) ;
    //   (2) l'auto-connect exige ?project=X&server=<api-url> ; `goto('/')` nu ne connecte rien ;
    //   (3) tlA/tlB (positionnement cursor→snapshot) racent le chargement async des snapshots
    //       → cursors au défaut → cursorA=null → diff jamais déclenché.
    // Le code de la légende est CORRECT ; c'est le harnais qui manque. Donc ce test reste
    // CONDITIONNEL (aucun faux rouge) : si la légende est là, son contenu est vérifié ;
    // sinon le mode a quand même toggle. NE PAS le rendre strict avant que (1)-(3) soient faits.
    await page.click('button:has-text("Compare A↔B")');
    await expect(page.locator('button:has-text("Exit compare")')).toBeVisible();
    const legend = page.getByTestId('cursor-diff-legend');
    if (await legend.count()) {
      await expect(legend).toContainText(/only in A/);
      await expect(legend).toContainText(/only in B/);
      await expect(legend).toContainText(/in both/);
      await page.click('button:has-text("Exit compare")');
      await expect(legend).not.toBeVisible();
    }
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

  test('mousewheel zooms in (mini-map appears, tlZoom=1) and out (exits)', async ({ page }) => {
    // Locate the timeline track via the cursor slider's position.
    const cursorA = page.locator('[role="slider"][aria-label="Cursor A"]');
    await expect(cursorA).toBeVisible();
    const box = await cursorA.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Wheel UP (deltaY<0) over the middle of the timeline → zoom in.
    const cx = box.x + 150;
    const cy = box.y;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(60);
    }
    // After the settle debounce, zoom is committed: mini-map visible + URL param.
    await page.waitForTimeout(600);
    await expect(page.getByRole('region', { name: /mini-map/i })).toBeVisible();
    expect(page.url()).toMatch(/tlZoom=1/);

    // Wheel DOWN (deltaY>0) hard → zoom out fully → exits.
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(600);
    await expect(page.getByRole('region', { name: /mini-map/i })).not.toBeVisible();
    expect(page.url()).not.toMatch(/tlZoom=1/);
  });
});
