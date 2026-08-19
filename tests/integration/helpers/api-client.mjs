/**
 * Minimal typed-ish client for the gitnexus REST API.
 * Used by integration tests to avoid repeating fetch() everywhere.
 *
 * DUAL-BASE (2026-07-12): the deployment runs TWO servers, not one —
 *   - the upstream API server (Dockerfile.cli, `dist/cli/index.js serve`)
 *     on TEST_PORT (default 4747) serves ONLY the `/api/*` routes
 *     (repos, graph, analyze, health).
 *   - our analytics server (Dockerfile.web, `docker-server.mjs`) on
 *     TEST_WEB_PORT (default 4173) serves everything WE added
 *     (snapshots, churn, coupling, lifespan, ghosts, clusters, …).
 * Pointing every call at 4747 (the old behaviour) 404s every analytics
 * route — which is why the integration tier never had a green baseline.
 * This mirrors the split the MCP sidecar already encodes
 * (mcp-server/server.mjs: GITNEXUS_API vs GITNEXUS_WEB).
 */
export class ApiClient {
  constructor(apiBaseUrl, webBaseUrl) {
    this.apiBase = apiBaseUrl.replace(/\/$/, '');
    this.webBase = (webBaseUrl || apiBaseUrl).replace(/\/$/, '');
  }

  async _get(base, path, query = {}) {
    const qs = new URLSearchParams(query).toString();
    const url = `${base}${path}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${await res.text()}`);
    const ctype = res.headers.get('content-type') || '';
    return ctype.includes('application/json') ? res.json() : res.text();
  }

  async _post(base, path, body) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${base}${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }

  // --- Upstream API server (4747) — the `/api/*` routes ---
  health() { return this._get(this.apiBase, '/api/health'); }
  listRepos() { return this._get(this.apiBase, '/api/repos'); }
  // analyze takes a PATH (e.g. /data/projects/sample-repo), not a repo name.
  // The real route is POST /api/analyze { path } → { jobId } (proven by the
  // e2e global-setup); the old `/analyze { repo }` 404s on the API server.
  analyze(path, opts = {}) { return this._post(this.apiBase, '/api/analyze', { path, ...opts }); }
  analyzeStatus(jobId) { return this._get(this.apiBase, `/api/analyze/${jobId}`); }
  graph(repo, opts = {}) { return this._get(this.apiBase, '/api/graph', { repo, ...opts }); }

  // --- Our analytics server (4173) — everything we added ---
  // Snapshots
  createSnapshot(repo, sha) { return this._post(this.webBase, '/snapshot', { repo, sha }); }
  listSnapshots(repo) { return this._get(this.webBase, '/snapshots', { repo }); }
  // repo is a QUERY param (?repo=); the body is { mode, count, sinceDays }.
  // Completion is signalled by polling /snapshots (see analyze.mjs), NOT by the
  // GET /snapshot/bulk/:jobId route — that route is an SSE progress stream, not
  // a JSON status, so a `res.json()` poll on it could never succeed.
  bulkSnapshot(repo, opts = {}) {
    const qs = new URLSearchParams({ repo }).toString();
    return this._post(this.webBase, `/snapshot/bulk?${qs}`, opts);
  }

  // Analytics
  churn(repo, opts = {}) { return this._get(this.webBase, '/churn', { repo, ...opts }); }
  coupling(repo, opts = {}) { return this._get(this.webBase, '/coupling', { repo, ...opts }); }
  couplingCross(repos, opts = {}) { return this._get(this.webBase, '/coupling/cross', { repos: repos.join(','), ...opts }); }
  growth(repo, opts = {}) { return this._get(this.webBase, '/growth', { repo, ...opts }); }
  growthCross(repos, opts = {}) { return this._get(this.webBase, '/growth/cross', { repos: repos.join(','), ...opts }); }
  lifespan(repo, opts = {}) { return this._get(this.webBase, '/lifespan', { repo, ...opts }); }
  entropy(repo, opts = {}) { return this._get(this.webBase, '/entropy', { repo, ...opts }); }
  ownership(repo, opts = {}) { return this._get(this.webBase, '/ownership', { repo, ...opts }); }
  dissonance(repo, opts = {}) { return this._get(this.webBase, '/dissonance', { repo, ...opts }); }
  semanticLabels(repo) { return this._get(this.webBase, '/semantic-labels', { repo }); }
  setSemanticLabel(repo, communityId, label) { return this._post(this.webBase, '/semantic-labels', { repo, communityId, label }); }

  // Misc (analytics server)
  listdir(path) { return this._get(this.webBase, '/listdir', { path }); }
  export(repo, opts = {}) { return this._get(this.webBase, '/export', { repo, ...opts }); }
  importBundle(payload) { return this._post(this.webBase, '/import', payload); }
}

export function getApi() {
  const apiPort = process.env.TEST_PORT || 4747;
  const webPort = process.env.TEST_WEB_PORT || 4173;
  return new ApiClient(`http://localhost:${apiPort}`, `http://localhost:${webPort}`);
}
