/**
 * Minimal typed-ish client for the gitnexus REST API.
 * Used by integration tests to avoid repeating fetch() everywhere.
 */
export class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async _get(path, query = {}) {
    const qs = new URLSearchParams(query).toString();
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${await res.text()}`);
    const ctype = res.headers.get('content-type') || '';
    return ctype.includes('application/json') ? res.json() : res.text();
  }

  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }

  health() { return this._get('/health'); }
  listRepos() { return this._get('/api/repos'); }
  analyze(repo, opts = {}) { return this._post('/analyze', { repo, ...opts }); }

  // Snapshots
  createSnapshot(repo, sha) { return this._post('/snapshot', { repo, sha }); }
  listSnapshots(repo) { return this._get('/snapshots', { repo }); }
  bulkSnapshot(repo, opts) { return this._post('/snapshot/bulk', { repo, ...opts }); }
  bulkSnapshotStatus(jobId) { return this._get(`/snapshot/bulk/${jobId}`); }

  // Analytics
  churn(repo, opts = {}) { return this._get('/churn', { repo, ...opts }); }
  coupling(repo, opts = {}) { return this._get('/coupling', { repo, ...opts }); }
  couplingCross(repos, opts = {}) { return this._get('/coupling/cross', { repos: repos.join(','), ...opts }); }
  growth(repo, opts = {}) { return this._get('/growth', { repo, ...opts }); }
  growthCross(repos, opts = {}) { return this._get('/growth/cross', { repos: repos.join(','), ...opts }); }
  lifespan(repo, opts = {}) { return this._get('/lifespan', { repo, ...opts }); }
  entropy(repo, opts = {}) { return this._get('/entropy', { repo, ...opts }); }
  ownership(repo, opts = {}) { return this._get('/ownership', { repo, ...opts }); }
  dissonance(repo, opts = {}) { return this._get('/dissonance', { repo, ...opts }); }
  semanticLabels(repo) { return this._get('/semantic-labels', { repo }); }
  setSemanticLabel(repo, communityId, label) { return this._post('/semantic-labels', { repo, communityId, label }); }

  // Misc
  listdir(path) { return this._get('/listdir', { path }); }
  graph(repo, opts = {}) { return this._get('/api/graph', { repo, ...opts }); }
  export(repo, opts = {}) { return this._get('/export', { repo, ...opts }); }
  importBundle(payload) { return this._post('/import', payload); }
}

export function getApi(port = process.env.TEST_PORT || 4747) {
  return new ApiClient(`http://localhost:${port}`);
}
