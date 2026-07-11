// Tier 3.7 Phase D — Hardening : E2E coverage for the CopilotPanel UI
// + the new /copilot/metrics Prometheus endpoint.
//
// Iron Rule COPILOT-HARDENING-2 (Sigma-E2E-PLAYWRIGHT-COVERAGE) — every Tier
// 3.x UI panel ships an E2E Playwright suite that exercises rendering, the
// happy-path state machine, error toasts, and metrics increments.
//
// The specs intentionally use loose selectors (`data-testid` first, fallback
// to role/text) so the test survives Phase C UI polish iteration. Test rows
// that depend on the live stack are guarded by `?repo=` and skip when the
// fixture repo (`hmm_studio` in the smoke loop) is not indexed.
//
// Companion module : `upstream/docker-server-copilot-metrics.mjs` (Prometheus
// registry + GET /copilot/metrics handler). The metrics scrape assertions
// match its `# TYPE` lines exactly.

// ─────────────────────────────────────────────────────────────────────────
// QUARANTINE VERDICT — 2026-07-11 (Σ-COPILOT-IS-SIDECAR-ONLY, ratifié user)
// ─────────────────────────────────────────────────────────────────────────
// Mesuré 3× : le copilot est SIDECAR-ONLY par construction, pas web-servi.
//   1. routes /copilot/* NON enregistrées dans upstream/docker-server-routes.mjs ;
//   2. modules copilot NON COPY'd dans upstream/Dockerfile.web (rebuild n'y change rien) ;
//   3. empirique : 8/8 de ces tests échouent, /copilot/metrics rend le shell HTML SPA
//      (pas du Prometheus text/plain v0.0.4).
// La réconciliation v1.6.7 a ratifié le copilot = 4 modules MCP sidecar, SANS routes ni
// COPY (re-poser les routes aurait *introduit* un crash-loop). Ces 2 describe testent donc
// une SURFACE WEB ABANDONNÉE → `test.describe.fixme` (quarantaine, pas rouge menteur).
//
// PREUVE RÉELLE du copilot (ce qui EST vérifié) : `node mcp-server/smoke.mjs` →
// gitnexus_copilot_{inventory,blt_context,cluster_context,forge_context} verts,
// inventory gate=GREEN, 9/9 endpoints mappés. C'est le vrai gate copilot-phase-d.
//
// DÉ-QUARANTAINE (condition falsifiable) : enregistrer les routes /copilot/* dans
// docker-server-routes.mjs + COPY dans Dockerfile.web + monter le panel React, PUIS
// retirer les `.fixme`. NB : corriger aussi le faux fallback l.~176 (son commentaire dit
// « accept absence » mais l'assertion `toContain('# TYPE …')` échoue sur absence).
// Registre : tests/quarantine.json (verdict + plafond anti-croissance).
// ─────────────────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.GITNEXUS_BASE_URL || 'http://localhost:4173';
const FIXTURE_REPO = process.env.GITNEXUS_E2E_REPO || 'hmm_studio';

// QUARANTINE (voir verdict en tête) : panel web copilot non servi (sidecar-only).
test.describe.fixme('Tier 3.7 — CopilotPanel E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForSelector('[data-cursor="A"]', { timeout: 30_000 });
  });

  test('renders the 4 sub-panels (inventory, BLT, cluster, forge)', async ({ page }) => {
    // Open the Architect Copilot panel. The header button may render either
    // via aria-label or visible text — accept both.
    const opener = page
      .getByRole('button', { name: /copilot|architect/i })
      .first();
    await opener.click();
    const panel = page.getByTestId('copilot-panel');
    await expect(panel).toBeVisible();

    // Phase C scaffolded 4 sub-panels — they should all be present even when
    // their underlying API call is still loading.
    await expect(page.getByTestId('copilot-subpanel-inventory')).toBeVisible();
    await expect(page.getByTestId('copilot-subpanel-blt')).toBeVisible();
    await expect(page.getByTestId('copilot-subpanel-cluster')).toBeVisible();
    await expect(page.getByTestId('copilot-subpanel-forge')).toBeVisible();
  });

  test('Refresh button triggers loading state and fires the inventory request', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /copilot|architect/i }).first().click();
    await expect(page.getByTestId('copilot-panel')).toBeVisible();

    const reqPromise = page.waitForRequest(
      (req) => /\/copilot\/mcp-inventory(\?|$)/.test(req.url()),
      { timeout: 10_000 },
    );
    await page.getByTestId('copilot-refresh').click();
    const req = await reqPromise;
    expect(req.method()).toBe('GET');

    // Loading state shows the spinner attribute for >= 1 tick.
    const subpanel = page.getByTestId('copilot-subpanel-inventory');
    await expect(subpanel).toHaveAttribute('data-state', /loading|ready/);
  });

  test('mocked inventory response is displayed in the panel', async ({ page }) => {
    // Route-mock the inventory endpoint before opening the panel.
    await page.route('**/copilot/mcp-inventory', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tools: ['gitnexus_entropy', 'gitnexus_churn'],
          count: 2,
          requiredEndpoints: ['entropy', 'churn'],
          gateVerdict: { ok: true, missing: [] },
        }),
      });
    });

    await page.getByRole('button', { name: /copilot|architect/i }).first().click();
    await page.getByTestId('copilot-refresh').click();
    const subpanel = page.getByTestId('copilot-subpanel-inventory');
    await expect(subpanel.getByText(/gitnexus_entropy/)).toBeVisible();
    await expect(subpanel.getByText(/gitnexus_churn/)).toBeVisible();
  });

  test('fetch error renders an error toast and never crashes the panel', async ({ page }) => {
    await page.route('**/copilot/mcp-inventory', async (route) => {
      await route.fulfill({ status: 503, body: 'service unavailable' });
    });

    await page.getByRole('button', { name: /copilot|architect/i }).first().click();
    await page.getByTestId('copilot-refresh').click();

    const toast = page.getByTestId('copilot-error-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });
    // Panel structure must survive the error.
    await expect(page.getByTestId('copilot-panel')).toBeVisible();
  });

  test('filter tabs switch the active sub-panel', async ({ page }) => {
    await page.getByRole('button', { name: /copilot|architect/i }).first().click();

    // Default = inventory; click BLT then forge tab.
    await page.getByTestId('copilot-tab-blt').click();
    await expect(page.getByTestId('copilot-subpanel-blt')).toHaveAttribute(
      'data-active',
      'true',
    );

    await page.getByTestId('copilot-tab-forge').click();
    await expect(page.getByTestId('copilot-subpanel-forge')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  test('X-Elysium-Cache header surfaces as hit/miss indicator', async ({ page }) => {
    await page.route('**/copilot/mcp-inventory', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'X-Elysium-Cache': 'hit' },
        body: JSON.stringify({ tools: [], count: 0, requiredEndpoints: [], gateVerdict: { ok: true } }),
      });
    });

    await page.getByRole('button', { name: /copilot|architect/i }).first().click();
    await page.getByTestId('copilot-refresh').click();
    const cacheBadge = page.getByTestId('copilot-cache-badge');
    await expect(cacheBadge).toHaveText(/hit/i);
  });
});

// QUARANTINE (voir verdict en tête) : /copilot/metrics non servi (rend le shell SPA).
test.describe.fixme('Tier 3.7 — /copilot/metrics Prometheus endpoint', () => {
  test('responds with Prometheus text exposition v0.0.4', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/copilot/metrics`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] || '').toMatch(/text\/plain.*version=0\.0\.4/);
    const body = await res.text();
    // The four families MUST be present in the registry exposition.
    expect(body).toContain('# TYPE copilot_endpoint_calls_total counter');
    expect(body).toContain('# TYPE copilot_endpoint_duration_seconds histogram');
    expect(body).toContain('# TYPE copilot_chain_verify_count_total counter');
    expect(body).toContain('# TYPE copilot_cache_hit_total counter');
    // Stable default labels even at zero (dashboards depend on it).
    expect(body).toMatch(/copilot_chain_verify_count_total\{result="valid"\}\s+\d+/);
    expect(body).toMatch(/copilot_chain_verify_count_total\{result="invalid"\}\s+\d+/);
  });

  test('metrics counter increments after a copilot call', async ({ request }) => {
    // Scrape once to capture baseline.
    const before = await (await request.get(`${BASE_URL}/copilot/metrics`)).text();
    // Hit an existing copilot endpoint to bump the counter.
    await request.get(`${BASE_URL}/copilot/mcp-inventory`).catch(() => null);
    const after = await (await request.get(`${BASE_URL}/copilot/metrics`)).text();

    // The endpoint label must appear and its sum must be monotonic.
    const beforeMatch = before.match(
      /copilot_endpoint_calls_total\{endpoint="mcp-inventory",status="200"\}\s+(\d+)/,
    );
    const afterMatch = after.match(
      /copilot_endpoint_calls_total\{endpoint="mcp-inventory",status="200"\}\s+(\d+)/,
    );
    if (beforeMatch && afterMatch) {
      expect(Number(afterMatch[1])).toBeGreaterThanOrEqual(Number(beforeMatch[1]));
    } else {
      // Endpoint not yet wired (Phase D scaffold) — accept absence so the spec
      // is green on a fresh stack while the wiring lands in a follow-up.
      expect(after).toContain('# TYPE copilot_endpoint_calls_total counter');
    }
  });
});

// Smoke-only fallback in case the dev server isn't up : we still assert the
// spec file itself loads (Playwright resolves the imports).
test('spec module loaded (sanity)', async () => {
  expect(FIXTURE_REPO).toBeTruthy();
});
