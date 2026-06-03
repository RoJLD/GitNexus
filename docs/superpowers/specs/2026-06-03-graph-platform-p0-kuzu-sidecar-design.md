# Graph Platform — P0: Template SDK + Kùzu sidecar — Design

**Date**: 2026-06-03
**Status**: current
**Supersedes (extends)**: `2026-06-02-graph-templates-design.md` (Stage 1 — web-only JSON)
**Related**: `2026-05-31-multigraph-ui-wire-design.md`, `2026-05-29-upstream-cohabitation-contract-design.md`

## 1. Context / problem

Stage 1 shipped `research-artifacts`: a single graph template, web-container-only,
storing graphs as **JSON** on the `gitnexus-data` volume and rendering them through
the existing single-graph Sigma canvas (Approach B — deliberately *not* Kùzu, to
avoid touching the immutable upstream backend; see the Stage-1 spec).

The user's north star for expanding is **"tout cela"** — a general **graph-template
platform** ("graph studio"): many graph types/domains, a graph-theory toolkit, and
multiple visualizations. That is far too large for one spec, so it was decomposed:

| # | Sub-project | Role |
|---|---|---|
| **P0** | **Template SDK + architecture (this spec)** | Foundation — everything depends on it |
| P1 | SDK proven on a 2nd template of *each kind* (1 import + 1 lens) | Validates generality |
| P2 | Graph-theory toolkit (centralities, communities, paths, embeddings) | Cross-cutting capability |
| P3 | Visualization paradigms (hierarchical/DAG, matrix, 3D, multigraph nav, layout selector) | Cross-cutting capability |
| → | Domains (research extensions, code-intel lenses, crypto/Experiment.Crypto) | Stack as templates once P0–P1 exist |

**The platform pulls toward Kùzu** (Cypher, scale, graph-theory, multigraph). But
Kùzu lives in gitnexus's **immutable upstream backend** (the prebuilt npm image),
and patching it violates the conservative cohabitation contract that the
`fork-cohabitation` tooling exists to protect. P0 resolves this tension.

## 2. Goal

A **Kùzu-backed template substrate** plus a **formal Template SDK** (two template
kinds: *import* and *lens*) that is **cohabitation-safe** — zero patches to the
upstream backend — and is proven end-to-end by migrating the existing
`research-artifacts` template from JSON onto real Kùzu.

## 3. Design — Approach 3: Kùzu sidecar

A **new container we own** owns the template graphs as real Kùzu databases; the
existing web container proxies to it. The "immutable part" (Kùzu) becomes an
ordinary dependency of *our* container, never an upstream patch.

### 3.1 The `gitnexus-graphs` sidecar
- New Compose service + our own `Dockerfile.graphs` (Node + the public **`kuzu`**
  binding). Owns `/data/gitnexus/graphs/<name>.kuzu` on the shared `gitnexus-data`
  volume. Internal HTTP API on its own port (mirrors the `wiki-worker` sidecar
  pattern already in the deployment):
  - `POST /g/:name/create {ddl}` — create the Kùzu DB + apply node/rel-table DDL.
  - `POST /g/:name/ingest {nodes, edges}` — insert nodes/edges.
  - `POST /g/:name/cypher {query}` — run a **read** Cypher query → rows.
  - `GET  /g/:name/render` — return the graph as `{nodes, edges}` (graphology-ready).
  - `GET  /g` — list graphs.
- Independent lifecycle; **no dependency on the upstream API container**.

### 3.2 The Template SDK (contract)
A registry (`registerTemplate` / `listTemplates` / `getTemplate`), builtin +
extensible, living in the web container as pure data (same shape as Stage 1).
Two template **kinds** (the key conceptual split):
- **import** — builds a *new* graph from a source:
  `{ kind:'import', id, label, schema_type, ddl, importer, visual }`.
  The `importer` (pure Node, web container) walks a source → `{nodes, edges}` →
  sidecar `ingest`.
- **lens** — a *saved Cypher query + viz* over an *existing* graph:
  `{ kind:'lens', id, label, target, cypher, visual }`. The sidecar runs the query.
  (First lens is built in P1; P0 only formalizes the descriptor.)
- `analyses?` and richer `visual` hooks are reserved for P2/P3.

### 3.3 Wiring + viewer
- The web container's `docker-server-graph-templates.mjs` routes become **proxies
  to the sidecar**: `scaffold`→sidecar `create`; `import`→importer-in-web produces
  `{nodes,edges}` then sidecar `ingest`; `research/:name`→sidecar `render`. The
  Stage-1 JSON store is replaced by the sidecar.
- **Viewer**: reuse the **existing single-graph Sigma canvas** (the frontend fetches
  `/graph/research/:name` → proxied to sidecar `render` → `{nodes,edges}` → the
  `research-graph-adapter` already built in Stage 1). **No dependency on the
  multigraph stub.**
- **Migration of `research-artifacts`** (the P0 proof): it becomes a Kùzu
  *import* template — DDL = `Artifact` node table + `Link` rel table; the existing
  `research-fs` importer now emits `{nodes,edges}` to the sidecar instead of JSON.
  End-to-end: scaffold → import → render works on real Kùzu.

### 3.4 Cohabitation + build/CI
- The sidecar = a **new image + new Compose service**, **zero upstream patch** →
  cohabitation-safe (the whole point). The `kuzu` dependency lives in the
  sidecar's own `package.json`. The web-route changes are in our already-additive
  `docker-server-graph-templates*.mjs`.
- `cohabit drift` stays green (no new `upstream/` surface beyond what's serialized).
- The CI `build-gate` (added 2026-06-03) extends to build the sidecar image too, so
  a broken sidecar fails the workflow.

## 4. Alternatives considered

- **Stay Stage-1 (JSON, web-only).** Cheapest, cohabitation-safe, already works.
  **Rejected as the platform foundation**: caps scale (in-memory JSON), no Cypher,
  graph-theory hand-rolled in JS, no ASTKG integration, no multigraph. Fine for
  small research graphs; too weak for a "graph studio."
- **Backend-fork (Stage-2 as originally documented).** Put Kùzu graph creation +
  Cypher into the upstream API server/CLI. Maximal native-ASTKG integration, but
  **modifies the immutable upstream npm package → backend patches → violates the
  cohabitation contract** `fork-cohabitation` exists to protect. Rejected.
- **Kùzu sidecar (chosen).** Delivers the platform ceiling (real Kùzu, Cypher,
  scale, room for graph-theory + multigraph) **while honoring cohabitation** (no
  upstream-backend patches — Kùzu becomes a dependency of *our* container). Cost: a
  new container + lifecycle, and we build the Cypher/render surface ourselves.

## 5. Scope boundaries

**In P0:** the sidecar substrate (`create`/`ingest`/`cypher`/`render`/list); the
Template SDK contract (import + lens descriptors, registry); migrating
`research-artifacts` to a Kùzu import template; the single-graph-canvas viewer fed
by the sidecar; sidecar image + Compose service + CI build-gate coverage.

**Out of P0 (later):** the graph-theory toolkit (P2); visualization paradigms incl.
multigraph navigation (P3); academic-literature / code-intel-lens / crypto domain
templates (P1); reading the upstream ASTKG `.gitnexus/lbug` from our sidecar
(lens-on-ASTKG); the inter-graph meta-layer (ELYSIUM `concept-forge`).

## 6. Open questions

1. **Kùzu binding** — public `kuzu` npm package vs `@ladybugdb/core` (if public).
   Recommendation: the public `kuzu` binding (independent of upstream).
2. **Lens-on-ASTKG** — reading the upstream's `.gitnexus/lbug` from our sidecar
   requires Kùzu-version compatibility between our `kuzu` dep and the version
   LadybugDB embeds. Deferred to P1; P0 lenses (if any) run only on
   sidecar-owned graphs. **Compatibility risk flagged.**
3. **Sidecar packaging** — a separate container (recommended: isolation + own deps
   + own lifecycle) vs a 2nd process inside the CLI container (like `wiki-worker`).
4. **Render endpoint semantics** — `render` returns a default `MATCH (n)-[r]->(m)`
   projection for P0; per-template render queries are a P1/P3 refinement.
