import type { Page } from '@playwright/test';

/**
 * Connect the GitNexus web app to an indexed repo and wait for the Timeline
 * (cursors) to render.
 *
 * WHY THIS EXISTS (measured 2026-07-12) : the app does NOT auto-connect on a
 * bare `goto('/')` — it lands on the "Choose a repository" picker. Auto-connect
 * fires only when BOTH `?project=<name>` AND `?server=<api-url>` are present
 * (clicking a repo card navigates to exactly that). With `project` alone the
 * app connects to `window.location.origin` (the WEB server), fetches a graph
 * bundle, gets HTML, and throws `SyntaxError: Unexpected token '<'`. So every
 * spec that did a bare `goto('/')` + `waitForSelector('[data-cursor]')` would
 * have hung — which never surfaced because the tier never ran (no config).
 *
 * Overridable via env for CI vs local:
 *   E2E_REPO      default 'sample-repo' (the fixture global-setup analyzes)
 *   E2E_API_URL   default 'http://localhost:4747' (the api/test container)
 */
const DEFAULT_REPO = process.env.E2E_REPO || 'sample-repo';
const API_URL = process.env.E2E_API_URL || 'http://localhost:4747';

export async function connectRepo(page: Page, repo: string = DEFAULT_REPO): Promise<void> {
  const url = `/?project=${encodeURIComponent(repo)}&server=${encodeURIComponent(API_URL)}`;
  await page.goto(url);
  // The Timeline mounts its cursors once the repo graph + commits are loaded.
  await page.waitForSelector('[data-cursor="A"]', { timeout: 60_000 });
  await page.waitForSelector('[data-cursor="B"]', { timeout: 60_000 });
}
