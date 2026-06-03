# Graph Platform — P1: SDK proven on a 2nd template of each kind — Design

**Date**: 2026-06-03
**Status**: current
**Builds on**: `2026-06-03-graph-platform-p0-kuzu-sidecar-design.md` (P0 — Template SDK + Kùzu sidecar)
**Related**: `2026-06-02-graph-templates-design.md` (Stage 1), `2026-05-29-upstream-cohabitation-contract-design.md`

## 1. Context / problem

P0 shipped the **Template SDK**: a registry of template descriptors with two
declared `kind`s — `import` (build a new graph from a source: DDL + importer →
Kùzu sidecar) and `lens` (a saved projection over an *existing* graph). P0
proved the **import** path end-to-end with exactly one template,
`research-artifacts`, and the **lens** kind exists only as a `kind` field — it
has **no implementation yet**.

A foundation with a single consumer of one kind is unproven. Two specific
weaknesses are invisible until a second, structurally-different case applies
pressure:

1. **The import path is secretly single-schema.** The ingest mapper
   `researchGraphToIngest()` is **hardcoded** to the `research-artifacts`
   schema: every node becomes `table:'Artifact'`, every edge becomes
   `table:'Link'`. A template with a *multi-table* schema (several node tables,
   several rel tables) cannot flow through it. The "SDK" only supports one
   shape, and nobody has noticed because there is only one template.
2. **The `lens` kind is vaporware.** It is declared but never executed. We do
   not know whether reading the AST Knowledge Graph (ASTKG) through a lens is
   even feasible without coupling to the immutable backend's Kùzu file format
   (the exact coupling the cohabitation contract forbids).

P1's job is **not** to build a domain library. It is to **prove the SDK is
genuinely general** by forcing both weaknesses to resolve under a real second
case — one import template and one lens — chosen to be as structurally
*different* from `research-artifacts` as practical.

### Why these two cases

- **Import — `academic-literature`**: a scientific-paper graph. Chosen because
  its schema is genuinely **multi-table** (`Paper` / `Author` / `Topic` with
  `AUTHORED` / `ABOUT` relations), unlike `research-artifacts`' single
  `Artifact` table. It is the strongest available stress on the import path.
  (The user pointed at a real corpus — 28 finance/quant PDFs under the Alten
  CMEX-3710 share — to ground the shape; see §4 and §5 on how that real,
  proprietary data is kept out of the repo.)
- **Lens — `imports-deps`**: a file-level import/dependency projection over the
  ASTKG. Chosen because it is the most legible, universal code-intel lens and
  the closest existing analog (`group-graph`) already proves the mechanism is
  feasible without touching the Kùzu file.

The other three import templates the user wants (crypto/Experiment.Crypto,
Zettelkasten, research-artifacts extension) are deliberately deferred to a
post-P1 **Template Library** milestone — each becomes a cheap, repeated
application of the SDK *once it is proven*. That deferral is the whole point of
having an SDK.

## 2. Goal

After P1, the Template SDK demonstrably supports an arbitrary multi-table
import schema **and** a working lens over the existing ASTKG, both registered as
first-class templates, rendered through the existing canvas — with the
hardcoded single-schema mapper removed and no new coupling to the immutable
backend.

## 3. Design

### 3.1 G1 — Schema-agnostic import contract (the import proof)

Today an importer returns a `ResearchGraph` (`{nodes:[{id,type,label,path,
stage}], edges:[{id,source,target,kind}], report}`) which
`researchGraphToIngest()` then maps onto the fixed `Artifact`/`Link` tables.

P1 changes the importer contract so an importer **emits the generic sidecar
ingest shape directly**:

```
{ nodes: [{ table, props }],
  edges: [{ table, from, to, props }],
  report }
```

The graph-templates handler then calls
`sidecarIngest(name, rg.nodes, rg.edges)` with **no schema-specific mapper**.
`researchGraphToIngest()` is **deleted**. `research-fs` is adapted (a thin
change) to emit the generic shape — its nodes carry `table:'Artifact'`, its
edges `table:'Link'` — so its behaviour and tests stay green.

**Why this approach won.** Alternatives considered:

- *(ii) One mapper function per template.* Rejected: pushes per-schema knowledge
  into the engine for every template and grows the engine's surface with the
  library; the importer already knows its own schema, so the mapper is
  redundant indirection.
- *(iii) Keep the `ResearchGraph` shape, extend the single mapper to handle
  multiple tables.* Rejected: keeps one central schema-aware chokepoint — the
  exact thing that makes the current code single-schema. It would have to grow
  a branch per template. Anti-SDK.
- *(i, chosen) Importer emits the generic ingest shape; engine ingests
  blindly.* The engine becomes schema-agnostic; adding a template adds **zero**
  engine code. This is what "generic SDK" means, and it is what makes the
  deferred Template Library cheap.

### 3.2 G2 — First real `lens` implementation (the lens proof)

A `lens` descriptor (`kind:'lens'`, `target:'astkg'`) gets a server-side
handler **modelled on the existing `group-graph` handler**, which already
fetches a repo's graph from the CLI and projects it:

```
GET /graph/lens/:id?repo=<repo>
  → fetch(`${GITNEXUS_API}/api/graph?repo=<repo>`)   // existing internal channel
  → projectImports(graph)                            // pure projection, no I/O
  → { nodes, edges }                                 // existing render shape
```

- **No new wire.** `GITNEXUS_API` (default `http://gitnexus:4747`) is the same
  internal web→CLI channel `group-graph`, `regression`, and `wiki` already use.
- **No Kùzu coupling.** The lens reads the CLI's `/api/graph` **JSON**, never
  the `.lbug` file — so it is immune to the backend's Kùzu version, honouring
  the cohabitation contract.

`projectImports(graph)` is a pure function (its own `-core.mjs`, unit-testable
like `group-graph-core`): filter `graph.relationships` to `r.type === 'IMPORTS'`,
then roll relationships up to the file level via each node's
`properties.filePath` (the dedup/self-loop logic of `collapseToFileLevel`,
restricted to import edges). Output: `{nodes:[{id,label,kind:'file'}],
edges:[{source,target}]}`.

**Why server-side won.** Alternative considered: ship the lens as a declarative
projection spec applied **client-side** in the browser bundle (the ASTKG is
already loaded there). Rejected for P1: harder to unit-test in the Node CI,
asymmetric with the import path (which has server handlers + integration tests),
and it would put the SDK's lens logic in two languages. Server-side keeps the
projection a pure, tested Node function and the frontend a thin renderer.

### 3.3 Components

| # | File | Responsibility |
|---|---|---|
| A | `docker-server-graph-templates-core.mjs` *(edit)* | add `academic-literature` descriptor (multi-table DDL, `importer:'academic-json'`, `kind:'import'`); add `imports-deps` descriptor (`kind:'lens'`, `target:'astkg'`); **remove** `researchGraphToIngest` |
| B | `docker-server-academic-json-importer.mjs` *(new)* | read `papers.json` from source dir → emit generic ingest shape (`Paper`/`Author`/`Topic` nodes + `AUTHORED`/`ABOUT` edges) + report; pure Node, deterministic |
| C | `tools/academic-extract.mjs` *(new — offline/host only)* | one-shot PDF → `papers.json` (filename + PDF metadata heuristics, light topic keywording). Runs on the host, **not** in any container, **not** a test dependency. Used once on the real corpus for the dev demo |
| D | `docker-server-graph-lens.mjs` + `docker-server-graph-lens-core.mjs` *(new)* | lens route handler + pure `projectImports(graph)` projection |
| E | `docker-server-graph-templates.mjs` *(edit)* | register `IMPORTERS['academic-json']`; ingest the generic shape (drop the mapper call); route `kind:'lens'` template selections to D |
| F | frontend *(light edit)* | template list shows both kinds; selecting a lens calls `/graph/lens/:id?repo=` and renders through the existing canvas |

### 3.4 Data flows

**Import (`academic-literature`):**
`scaffold` (`sidecarCreate` with the multi-table DDL + index record) →
`import` (`academic-json` reads `papers.json` → generic nodes/edges →
`sidecarIngest`) → `render` (`sidecarRender`).

**Lens (`imports-deps`):**
user selects the lens + a repo → `GET /graph/lens/imports-deps?repo=X` →
fetch ASTKG via `GITNEXUS_API` → `projectImports` → render through the canvas.

### 3.5 Schemas

**Academic graph DDL (sidecar):**
```
CREATE NODE TABLE Paper (id STRING, title STRING, year INT64, path STRING, PRIMARY KEY(id))
CREATE NODE TABLE Author(id STRING, name STRING, PRIMARY KEY(id))
CREATE NODE TABLE Topic (id STRING, label STRING, PRIMARY KEY(id))
CREATE REL TABLE AUTHORED(FROM Author TO Paper, id STRING)
CREATE REL TABLE ABOUT   (FROM Paper  TO Topic, id STRING)
```

**`papers.json`** — the contract the preprocessor (C) produces and the importer
(B) consumes:
```json
{ "papers": [
  { "id": "kyle1985",
    "title": "Continuous Auctions and Insider Trading",
    "year": 1985,
    "path": "1985 EMA Kyle.pdf",
    "authors": ["Albert S. Kyle"],
    "topics": ["market microstructure"] }
]}
```
`Author` nodes are deduplicated by **normalized name** (lowercased, whitespace-
collapsed), so an author shared across papers becomes one shared node — real
multi-table edges, which `research-artifacts` never produced. `Topic` nodes are
deduplicated by normalized label the same way. `topics` are populated by C's
light heuristic keywording (title/filename) so `Topic`/`ABOUT` are actually
exercised (see §6).

## 4. Handling the real corpus (proprietary data)

The corpus the user pointed at (28 finance/quant PDFs under the Alten
CMEX-3710 SharePoint) is **work/proprietary data**. It is used **only** to:
- ground the realistic shape of `papers.json` (titles, years, authors), and
- run preprocessor C once for a **local dev demo** (the resulting graph lives in
  the sidecar's Kùzu volume, which is **not** committed).

It is **never** committed to the personal gitnexus repo: not the PDFs, not a
real `papers.json` derived from them. All committed **test fixtures are
synthetic** (a hand-written `papers.json` with invented papers and a synthetic
ASTKG fixture). This keeps Alten data out of the open repo and keeps tests
deterministic and offline.

## 5. Testing

Synthetic fixtures only — zero Alten data.

- **Unit**
  - `academic-json` importer on a synthetic `papers.json` (≥3 papers, ≥1 author
    shared across two papers, ≥1 shared topic) → asserts dedup, table tagging,
    edge endpoints, and report counts.
  - `projectImports` on a synthetic ASTKG fixture mixing `IMPORTS` and
    non-`IMPORTS` (e.g. `CALLS`) relationships → asserts only import edges
    survive, roll-up to file level, self-loops/dupes dropped.
- **Integration**
  - scaffold + import + render of `academic-literature` through the real sidecar
    (exercises the 3-node-table / 2-rel-table DDL end-to-end).
  - lens endpoint against a **mocked** `/api/graph` response → asserts the
    file-level import projection.
- **Preprocessor C**: a light unit test on a tiny synthetic PDF, or excluded
  from CI as an offline tool (decided at plan time; it must not gate the suite).

All new tests integrate into the existing tiers (`tests/unit`,
`tests/integration`) and run in the existing CI jobs — no new test
infrastructure (per workspace CLAUDE.md test discipline).

## 6. Scope boundaries (YAGNI)

- **No `CITES` edges.** Citation extraction from raw PDFs is unreliable; P1
  ships `AUTHORED`/`ABOUT` only. Real citation edges are a later concern (e.g. a
  curated `.bib` variant in the Template Library).
- **Exactly one import template + one lens.** The other three import templates
  are the post-P1 Template Library.
- **Lens = coded projection over `/api/graph` JSON**, not Cypher over Kùzu. The
  Kùzu-file coupling is explicitly avoided.
- **Preprocessor C is a one-shot offline tool**, not productized, not wired into
  any container or CI gate.
- **No network**: no arXiv/DOI/CrossRef fetching, no frontmatter walker reuse.

## 7. Open questions

- **Topics heuristic.** Resolved during brainstorming: C derives topics with a
  light title/filename keywording so `Topic`/`ABOUT` are exercised (rather than
  leaving `topics:[]`, which would leave the multi-table proof weaker). The
  exact keyword list/heuristic is an implementation detail for the plan.
- **Preprocessor C test treatment** (light synthetic-PDF unit test vs. excluded
  offline tool) — to settle at plan time; must not gate the suite.

## Update 2026-06-03 — sidecar generalization + lens output shape (plan-time)

Two refinements discovered while writing/executing the plan:

1. **The sidecar is part of G1.** G1 (§3.1) covered the *importer* contract, but
   the sidecar `ingest`/`render` were themselves single-schema: `ingest`
   hardcoded `SET r.kind` on every edge (breaks on `AUTHORED`/`ABOUT`, which have
   no `kind` column) and `render` projected the fixed `Artifact` columns. The
   implementation generalizes both (`graphs-sidecar/kuzu-store.mjs`): edges set
   arbitrary props; render uses `MATCH (n) RETURN n, label(n) AS lbl` with a
   property-or-table-name fallback (`type = n.type ?? label(n)`, `kind = r.kind
   ?? label(r)`). (kuzu 0.11.3 does not expose `_label` on returned rows, so the
   `label()` function form is used.) Component table §3.3 should be read as
   including `graphs-sidecar/kuzu-store.mjs`.
2. **Lens output shape.** §3.2 sketched `{nodes:[{id,label,kind:'file'}],...}`.
   The implementation instead returns the **research-render shape**
   (`{nodes:[{id,type:'file',label,path,stage}], edges:[{id,source,target,kind:'imports'}]}`)
   so the existing `research-graph-adapter` + the URL-driven render path render
   it unchanged — the lens reaches the canvas via `?lens=<id>&repo=<repo>`.

3. **Lens test landed at the unit tier.** §5 placed the lens-endpoint test ("against a mocked `/api/graph`") in the *Integration* tier; it shipped as a unit test with a stubbed `fetch` (`tests/unit/graph-lens-handler.test.mjs`, covering the 200 projection + 404/400/502/500 paths). This is a deliberate, defensible choice for a pure fetch+projection handler.
4. **The offline extractor is filename-only.** §3.3 component C describes "PDF metadata heuristics"; the shipped `tools/academic-extract.mjs` reads no PDF content — it derives title/year from the filename and always emits `authors: []` (reliable author/citation parsing from raw PDFs is out of scope for P1, per §6). Topics come from a title-keyword heuristic.

Implemented across commits 981b0368 (sidecar), 7adbfe73 (academic importer),
fabd9ca6 (G1 contract), 6f9d8270 (academic template), 67e4abe2 (lens),
f4dcaa36 (frontend), ef3a13bf (extractor).
