# Graph Templates on GitNexus — Design

**Date**: 2026-06-02
**Branch**: deployment
**Status**: current
**Related**: `2026-05-31-multigraph-ui-wire-design.md`, `2026-05-29-multi-repo-unified-graph-design.md`, `2026-05-29-upstream-cohabitation-contract-design.md`

> This design was grounded against the real codebase by an 8-reader + 1-critic
> verification pass (2026-06-02). The original "shared core + REST, thin
> surfaces" sketch was found **not implementable as-is** (three blockers, see
> §6). The design below (Stage 1 / Approach B) is the corrected, buildable
> slice; the original Kuzu vision survives as the documented successor
> (Stage 2 / Approach A, §7).

---

## 1. Context / problem

GitNexus today produces exactly one kind of graph: the **code-cognition** graph,
an AST-derived knowledge graph built by the upstream `gitnexus analyze` engine
into a LadybugDB/Kùzu store. The multigraph layer (`MultigraphLoader`,
`GraphSidebar`, `CanvasMultigraph`, Tasks 9.5–9.8) introduced the *idea* of N
typed graphs grouped by `schema_type`, driven by `gitnexus.config.json`.

We want users to create **other kinds of graphs from reusable templates** — the
first being a **research-artifacts graph** (nodes = experiments / notebooks /
hypotheses / results derived from a local research tree such as
`Experiment.Crypto`, edges = derives-from / validates / contradicts). The
mechanism must be **generic** ("there will not only be research graphs"):
academic-literature and other graph types are expected later as additional
templates.

## 2. Goal

A user can pick a template (e.g. `research-artifacts`), point it at a source
directory, and get a populated, explorable graph — end to end — without leaving
the part of the deployment the fork is allowed to modify. The template
mechanism is an extensible registry so new templates are added without
reworking the engine. Research-artifacts is the worked example that proves the
whole chain.

## 3. The constraint that shapes everything

The gitnexus fork **only modifies the `gitnexus-web` container** (the
`docker-server-*.mjs` HTTP handlers + the `gitnexus-web` React app, both built
by `Dockerfile.web`). The **graph engine — LadybugDB/Kùzu — lives exclusively
in the separate API container** (the prebuilt npm image
`ghcr.io/abhigyanpatwari/gitnexus`, `Dockerfile.cli`), which the fork treats as
**immutable** (per the cohabitation contract; touching it would expand the
patch surface into the backend and is what every `cohabit bump` is designed to
avoid).

Verified consequences:

- The web container has **no `@ladybugdb/core`, no kuzu bindings, no gitnexus
  npm package** — every existing handler that needs graph data **proxies over
  HTTP to `GITNEXUS_API` (`http://gitnexus:4747/api/graph`)**. A
  `docker-server-*.mjs` route therefore **cannot open a graph or run DDL**.
  *(grep of `docker-server-*.mjs` for `lbug|kuzu|@ladybugdb` → 0 matches.)*
- **`gitnexus.config.json` is read-only**: it is generated externally by ELYSIUM
  (`sigma_gitnexus_config_generator.py`), baked into `dist/`, served as a static
  asset under `USER node`. `MultigraphLoader` only *fetches* it; **nothing in the
  repo writes it**.
- The **multigraph render path is a stub**: `CanvasMultigraph` mounts no Sigma
  instance (placeholder `<div>` only), and `/api/graph` resolves graphs **by
  registered repo name**, never by `GraphConfigEntry.path`.

The design must live inside these facts, not around them.

## 4. Design — Stage 1 (Approach B): web-container research graph, JSON-rendered

Everything runs in the `gitnexus-web` container. No backend image change. No
Kùzu. No write to `gitnexus.config.json`.

### 4.1 Template registry (web container)

A new additive handler module `upstream/docker-server-graph-templates.mjs` holds
an **in-memory registry**, mirroring the *shape* (not the location) of the
existing, tested `registerGhostSource` pattern: a `Map` populated at module load,
builtin-protected, with `registerTemplate(tpl)` / `listTemplates()` /
`getTemplate(id)`.

A **template descriptor** is pure data (safe to live in the web container):

```
GraphTemplate {
  id, label, schema_type, description,
  visual:   { nodeColors: { <type>: <hex> }, defaultZoom },
  importer: <importerId>,
  include:  [glob…],   exclude: [glob…]
}
```

`research-artifacts` ships built-in. External code can `registerTemplate()` →
extensible. The registry is **in-memory, per-process, re-registered at load**
(explicitly, like `ghostSources` — not persisted, not a TS registry).

### 4.2 Importer (web container, pure Node, zero native deps)

The `research-fs` importer walks a source directory under the **`/data/projects`
RW mount** and emits a graph as JSON. Two passes (the approved hybrid contract):

- **Pass 1 — auto skeleton.** Walk `include` globs (default
  `['**/*.ipynb','**/*.md']`), always excluding `.git`, `node_modules`,
  `.gitnexus`, `.ipynb_checkpoints`. Each file → one node. `id` = stable hash of
  the relative path; `label` = first H1 / first notebook markdown heading;
  `type` = `notebook` (`.ipynb`) or `note` (`.md`); `stage` = top-level folder.
- **Pass 2 — frontmatter enrichment (optional).** Parse YAML frontmatter
  (`.md`: leading `---` block; `.ipynb`: `metadata.gitnexus` or the first
  markdown cell). Recognized keys: `type`, `id`, `title`, `links: [{to, kind}]`.
  Each `links[]` entry → one edge of that `kind`. **Unresolved targets →
  warning in the report, never fatal.**

Output is a **KnowledgeGraph-shaped JSON** (the same node/edge shape the existing
frontend adapter consumes — see §4.5), plus an `ImportReport`
(`{ nodes, edges, byType, byKind, unresolvedLinks[], skipped[] }`).

Node types (`type`) and edge kinds (`kind`) are **free strings** —
`{notebook, experiment, hypothesis, result, dataset, note}` and
`{derives_from, validates, contradicts, produces, contains}` for
research-artifacts — so adding a type needs no schema migration.

### 4.3 Storage (writable location the web container owns)

Graphs are written as JSON to the **`gitnexus-data` volume**
(`/data/gitnexus`, RW — the same volume `/import` already writes the repo
registry + groups into): `/data/gitnexus/research-graphs/<name>.json`, plus a
small **web-owned index** `research-graphs/index.json` listing scaffolded graphs
(`name`, `template`, `source`, `schema_type`, `created`).

We do **not** touch `gitnexus.config.json` (read-only, ELYSIUM-owned). The
research graphs use this separate lightweight index that the web container can
read *and write*.

### 4.4 Routes (web container) — `docker-server-graph-templates.mjs`

Each is a standard `(req, url, res, opts) → boolean` handler registered in the
`registerGitnexusRoutes()` if-chain of `docker-server-routes.mjs`:

- `GET  /graph/templates` → list registered templates.
- `POST /graph/scaffold` `{templateId, name, source}` → validate template,
  write an index record (no Kùzu, just a JSON record).
- `POST /graph/import` `{name}` → run the template's importer, write
  `<name>.json`, return `ImportReport`. **Re-import = overwrite** (idempotent;
  trivial because it is a file replace, not DDL).
- `GET  /graph/research` → list scaffolded research graphs (from `index.json`).
- `GET  /graph/research/:name` → serve the graph JSON for rendering.

POST bodies are read manually (`req` data/end accumulation — standard Node
`http`, no body-parser middleware in this server).

### 4.5 Frontend (reuse the renderer that works)

The multigraph `CanvasMultigraph` is a stub, so Stage 1 **reuses the functional
single-graph pipeline**: `graph-adapter.knowledgeGraphToGraphology → graphology →
useSigma`. A thin fetch-and-render path takes our `GET /graph/research/:name`
JSON and feeds it to the existing adapter; node colours come from the template's
`visual.nodeColors` palette (a new `TEMPLATE_COLORS`-style override applied
before the diff/churn logic in the node reducer, or threaded through
`knowledgeGraphToGraphology`). Entry point: a "New research graph" action
(template picker → source → create + import) surfaced in the sidebar.

> ⚠️ This fetch-and-render path is the **main net-new frontend risk** (the
> template-picker action is the other net-new piece, but it is routine); the
> plan must validate that an arbitrary KnowledgeGraph-shaped JSON renders
> through `knowledgeGraphToGraphology` without a live `/api/graph` round-trip.

### 4.6 MCP (+3 tools)

In `mcp-server/server.mjs`: `list_graph_templates`, `create_graph_from_template`,
`import_into_graph`, wrapping the web routes via the existing `callWeb` helper
(GET) and the AbortController POST pattern. **Precondition:** reconcile the
existing tool-count inconsistency first — the `TOOLS` array has 22 entries (21
`gitnexus_`-prefixed + the unprefixed `query_meta_graph`) while `smoke.mjs`
asserts exactly 21. Fix that baseline before bumping the assertion by 3.

### 4.7 Data flow

```
pick template (GET /graph/templates)
  → POST /graph/scaffold {templateId,name,source}      (index record on gitnexus-data)
  → POST /graph/import {name}                            (walk /data/projects, parse, emit JSON)
  → JSON written to /data/gitnexus/research-graphs/<name>.json
  → UI: GET /graph/research/:name → knowledgeGraphToGraphology → Sigma (template palette)
```

### 4.8 Build / CI obligations (verified, easy to miss)

- **`Dockerfile.web` `COPY` line** for the new `docker-server-graph-templates.mjs`
  (and any sibling) — omitting it **crash-loops** the container at boot (the most
  common bug class in this repo).
- **Patch regeneration**: re-serialize new files into
  `patches/additive-files.diff` (`--diff-filter=A`) and the route-registration
  edit into `patches/inplace-edits.diff` (`--diff-filter=M`); `check-patch-drift.mjs`
  must pass.
- **Tests** integrate into the existing pyramid:
  - unit (`tests/unit/`, vitest + jsdom): registry, importer skeleton +
    frontmatter + unresolved-link reporting.
  - integration (`tests/integration/endpoints/`, vitest + node + docker stack):
    scaffold → import → `GET /graph/research/:name`, with golden snapshots in
    `tests/fixtures/expected/`.
  - MCP (`tests/integration/mcp/`): the 3 new tools.
  - fixture: `tests/fixtures/research-sample.tar.gz` via a new
    `make-research-fixture.mjs` (mirror `make-fixture.mjs`); add
    `extractFixture(name)` plumbing in `stack.mjs`.
  - **inventory gate**: every new test file **must** get a row in
    `tests/README.md` or the `check-test-inventory.mjs` CI job fails.

## 5. Alternatives considered

### Approach A — backend-fork (the full Kùzu vision)
Rebuild the gitnexus npm package from the vendored `upstream/gitnexus/` source to
put the registry + scaffolder + DDL + importer in the **API server / CLI** where
lbug lives, storing real Kùzu graphs and reusing `/api/graph`. **Rejected for
Stage 1** because it (a) puts patches *into the immutable backend*, contradicting
the conservative cohabitation contract this workspace deliberately built; (b)
stacks three unsolved problems at once (backend rebuild + `gitnexus.config.json`
write-ownership coordination with ELYSIUM + building the multigraph renderer,
currently a stub); (c) is the most work for deferred value. **Retained as the
Stage 2 successor (§7).**

### Approach C — declarative-only template DSL
Templates fully in YAML including extraction rules as a mini-DSL. **Rejected**:
the DSL is a large upfront design and becomes inadequate the moment an importer
needs non-trivial logic (YAGNI). Importers stay code; the descriptor stays
declarative.

### Why B won
B delivers a real, explorable research graph **now**, entirely inside the
container the fork is allowed to change, with no backend rebuild, no read-only
file to write, and no dependency on the unbuilt multigraph renderer. The cost is
honest divergence: a JSON graph rendered in the single-graph canvas, tracked in a
web-owned index, **not** a Kùzu graph in the multigraph viewer.

## 6. The three blockers B sidesteps (verified 2026-06-02)

| # | Original claim | Reality | How B avoids it |
|---|---|---|---|
| 1 | REST route opens Kùzu + runs DDL | web container has no lbug; handlers proxy to API | No DDL — importer emits JSON in-process |
| 2 | Scaffolder appends to `gitnexus.config.json` | file is read-only + ELYSIUM-owned; nothing writes it | Web-owned `research-graphs/index.json` on the RW `gitnexus-data` volume |
| 3 | `CanvasMultigraph` colours nodes via palette | `CanvasMultigraph` is a stub; `/api/graph` ignores config `path` | Reuse the working single-graph renderer + a fetch-and-render path |

## 7. Stage 2 — Approach A as the successor ("la suite de B qui est A")

> **Status: planned / not built. Preconditions unmet today.** Documented here so
> the eventual Kùzu+multigraph evolution is a deliberate, recorded step, not a
> silent rewrite of Stage 1.

When the time comes to make research (and other) graphs **first-class Kùzu graphs
inside the multigraph viewer**, the evolution is:

1. **Relocate the engine.** Move the registry + scaffolder (DDL via
   `@ladybugdb/core`: `CREATE NODE/REL TABLE`) + importer into the **API server**
   (`upstream/gitnexus/src/server/api.ts`, which already has `withLbugDb` /
   `executeQuery`) **or** a new `gitnexus graph` **CLI command** (commander,
   `createLazyAction`) in the npm package. Stage-1's importer logic ports almost
   verbatim — only its output target changes (Kùzu rows instead of JSON).
2. **Web routes become proxies/spawners.** `docker-server-graph-templates.mjs`
   stops doing work and instead proxies to the API endpoint (like `/graph/merged`)
   or spawns the CLI via the `wiki-worker` sidecar (like `gitnexus wiki` /
   `gitnexus group` are spawned today).
3. **Real storage convention.** Prefer per-repo `<repo>/.gitnexus/lbug` (no
   extension, matching `getStoragePaths`) registered in the existing repo
   registry so the existing `/api/graph?repo=<name>` render path is reused —
   **not** an invented `<data>/graphs/<name>.kuzu`. `privacy_class` /
   `ttl_snapshot_hours` become template-declared (defaults
   `REGENERABLE` / `24h`).
4. **Config write-ownership.** Resolve who writes `gitnexus.config.json` with the
   ELYSIUM generator (`sigma_gitnexus_config_generator.py`) — either gitnexus
   appends to a relocated, writable config, or it hands defaults to the generator.
5. **Build the multigraph renderer.** Mount a real Sigma instance in
   `CanvasMultigraph` (the deferred Tasks 9.9 fractal-zoom / 9.10 SSE live-reload),
   so the template `visual` palette has a real surface in the multigraph view.

**Preconditions before Stage 2 is worth starting:** (a) a deliberate decision to
take on backend patches and the resulting cohabitation cost; (b) the multigraph
canvas is no longer a stub. Until both hold, Stage 1 (B) is the right shape and
Stage 2 stays planned.

## 8. Scope boundaries

**In scope (Stage 1 / B):** generic template registry (web), `research-artifacts`
template + `research-fs` importer (hybrid auto + frontmatter), JSON storage on
`gitnexus-data` + web-owned index, 5 web routes, 3 MCP tools, frontend
fetch-and-render reusing the single-graph canvas with template palette, tests +
fixture + CI inventory rows + Dockerfile.web COPY + patch regen.

**Out of scope:** Kùzu storage and the multigraph viewer integration (→ Stage 2,
§7); backend/npm-image changes; writing `gitnexus.config.json`; a `gitnexus graph`
CLI subcommand (→ Stage 2); academic-literature template (future template, reuses
the framework); incremental/live re-import and file-watching; in-UI graph editing;
a declarative extraction DSL (→ Approach C, rejected).

## 9. Open questions — resolved

1. **Physical path of graphs** → `gitnexus-data` volume at
   `/data/gitnexus/research-graphs/<name>.json` (web-writable). The Kùzu
   `<repo>/.gitnexus/lbug` convention is deferred to Stage 2.
2. **Default include-glob** → `['**/*.ipynb','**/*.md']`, template-declared and
   per-import overridable; always exclude `.git` / `node_modules` / `.gitnexus` /
   `.ipynb_checkpoints`.
3. **`privacy_class` / `ttl_snapshot_hours`** → not applicable in Stage 1 (we do
   not write `GraphConfigEntry`). When Stage 2 writes config entries, declare them
   on the template (defaults `REGENERABLE` / `24h`).

### Remaining for the plan
- Confirm `knowledgeGraphToGraphology` accepts an arbitrary research JSON without a
  live `/api/graph` round-trip (the §4.5 risk).
- Reconcile the MCP 21-vs-22 tool-count baseline before adding 3 tools.
- Exact shape of the KnowledgeGraph-compatible JSON the importer emits vs. a
  research-specific shape + a small adapter.
