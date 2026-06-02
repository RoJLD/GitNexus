# Graph Templates — Stage 1 delta (2026-06-02)

Serialization of the Stage-1 graph-templates feature
(see `docs/superpowers/specs/2026-06-02-graph-templates-design.md` and
`docs/superpowers/plans/2026-06-02-graph-templates-stage1.md`).

> ⚠️ **Why a separate scoped delta instead of regenerating the global diffs?**
> At implementation time (2026-06-02) the committed global patch set was found
> **pre-existingly desynced** from the `upstream/` build clone:
> `scripts/check-patch-drift.mjs` exits 1 on the untouched `deployment` baseline
> (real additive files such as `connectors/{github,jira,linear}.mjs` are in the
> clone but absent from `additive-files.diff`), and a canonical regeneration
> produces a ~1.8 MB additive diff vs the ~17 KB committed — i.e. the committed
> diffs are truncated/stale (consistent with the 10 commits pulled on
> 2026-06-02 that showed ~62 k deletions across the patch files). The
> `tests/README.md` inventory is likewise stale (11 pre-existing orphan test
> files). Reconciling that baseline is a **separate task** (best done with
> Docker up + a human reviewing the large diff) and is intentionally NOT done
> here. This file captures *only* the graph-templates Stage-1 delta so the work
> is reviewable/reproducible without blessing the desynced global state. When
> the baseline is reconciled, fold this delta into `additive-files.diff` /
> `inplace-edits.diff` and delete this file.

The build runs from the `upstream/` clone (the Docker build context), which
already contains all of the changes below, so the feature builds/runs
regardless of the global patch-diff state.

## New files (additive) — in `graph-templates-stage1.diff`

Apply with `git apply ../patches/graph-templates-stage1.diff` from inside a
fresh `upstream/` clone (paths are relative to the clone root):

- `docker-server-graph-templates-core.mjs` — template registry + JSON store (gitnexus-data volume).
- `docker-server-research-fs-importer.mjs` — research-fs importer (walk + frontmatter → ResearchGraph).
- `docker-server-graph-templates.mjs` — 5 HTTP routes (templates/scaffold/import/list/get).
- `gitnexus-web/src/lib/research-colors.ts` — per-type color palette.
- `gitnexus-web/src/lib/research-graph-adapter.ts` — `researchGraphToGraphology()` + `ResearchGraph` type.
- `gitnexus-web/src/services/research-client.ts` — fetch wrappers for the 5 routes.
- `gitnexus-web/src/components/GraphSidebar.tsx` — minimal sidebar shell with the "+ New" action.

## In-place edits to pre-existing files (apply manually)

These four edits are documented here (rather than as a full-fork-delta diff,
which would drag in unrelated prior fork edits to the same vendored files):

### `docker-server-routes.mjs` (additive route registry)
- Import (after the `handleGroupGraphRoute` import, ~line 36):
  ```javascript
  import { handleGraphTemplatesRoute } from './docker-server-graph-templates.mjs';
  ```
- Registration (in `registerGitnexusRoutes`, immediately before `return false;`, ~line 76):
  ```javascript
  if (await handleGraphTemplatesRoute(req, reqUrl, res, ctx)) return true;
  ```

### `Dockerfile.web` (vendored, in-place)
- After `COPY docker-server-routes.mjs ./docker-server-routes.mjs` (~line 125), add:
  ```dockerfile
  COPY docker-server-graph-templates-core.mjs ./docker-server-graph-templates-core.mjs
  COPY docker-server-research-fs-importer.mjs ./docker-server-research-fs-importer.mjs
  COPY docker-server-graph-templates.mjs ./docker-server-graph-templates.mjs
  ```

### `gitnexus-web/src/App.tsx` (vendored, in-place)
- Imports (~lines 40-41):
  ```typescript
  import { GraphSidebar } from './components/GraphSidebar';
  import { listTemplates, scaffoldGraph, importGraph } from './services/research-client';
  ```
- Handler (in the App component, ~line 227):
  ```typescript
  const handleNewGraph = useCallback(async () => {
    const templates = await listTemplates();
    const templateId = window.prompt(`Template id (${templates.map((t) => t.id).join(', ')})`, 'research-artifacts');
    if (!templateId) return;
    const name = window.prompt('New graph name');
    if (!name) return;
    const source = window.prompt('Source dir (relative to /data/projects)');
    if (!source) return;
    await scaffoldGraph(templateId, name, source);
    await importGraph(name);
    window.location.search = `?research=${encodeURIComponent(name)}`;
  }, []);
  ```
- Render (in the exploring view's `<main>`, ~line 411):
  ```tsx
  {new URLSearchParams(window.location.search).get('multigraph') === '1' && (
    <GraphSidebar onNewGraph={handleNewGraph} />
  )}
  ```

### `gitnexus-web/src/components/GraphCanvas.tsx` (vendored, in-place)
- Imports (~lines 23-24):
  ```typescript
  import { researchGraphToGraphology, type ResearchGraph } from '../lib/research-graph-adapter';
  import { getResearchGraph } from '../services/research-client';
  ```
- State + fetch (~lines 116-122, alongside other hooks):
  ```typescript
  const researchName = new URLSearchParams(window.location.search).get('research');
  const [researchData, setResearchData] = useState<ResearchGraph | null>(null);
  useEffect(() => {
    if (!researchName) return;
    getResearchGraph(researchName).then(setResearchData).catch((e) => console.error('research graph load failed', e));
  }, [researchName]);
  ```
- Mount effect (right after the existing group-graph effect, ~lines 325-330):
  ```typescript
  // Research graph — mount JSON-derived graph when ?research=<name> is set
  useEffect(() => {
    if (!researchName || !researchData) return;
    const g = researchGraphToGraphology(researchData);
    setSigmaGraph(g, { cacheKey: `research:${researchName}` });
  }, [researchName, researchData, setSigmaGraph]);
  ```
- Guard the default-graph effect (add as the new second line, ~line 293):
  ```typescript
  if (researchName) return; // research view owns the canvas
  ```

## Already committed to git (tracked, not in this delta)
- `mcp-server/server.mjs` — 3 new MCP tools (`gitnexus_list_graph_templates`, `_create_graph_from_template`, `_import_into_graph`).
- `mcp-server/smoke.mjs` — tool-count baseline reconciled (21→25; added the previously-missing `query_meta_graph`).
- `tests/unit/{graph-templates-registry,research-fs-importer,research-graph-adapter}.test.mjs` — unit tests.
- `tests/fixtures/make-research-fixture.mjs` + `tests/fixtures/research-sample.tar.gz` — fixture.
- `tests/README.md` — inventory rows for the 3 unit tests.

## Verification status (2026-06-02)

**Verified on host (Windows, Node v21, Docker down):**
- Backend modules: `node --check` clean (`docker-server-graph-templates*.mjs`, `docker-server-routes.mjs`).
- `.mjs` unit tests pass: registry 4/4, importer 2/2.
- Frontend: `tsc --noEmit` clean (0 errors) across the web project.
- MCP: live stdio handshake → `tools/list` returns 25 tools incl. the 3 new ones.

**Deferred — needs Node ≥ 22 (vitest/rolldown) and/or Docker:**
- `.ts`-importing unit test `research-graph-adapter.test.mjs` (host Node 21 can't run vitest's TS transform).
- Full unit suite, endpoint integration test (scaffold→import→get), MCP tool-call integration test.
- Web image rebuild + stack health (`docker compose build`), and the manual `?research=<name>` browser render check (the spec §4.5 risk-closure).
