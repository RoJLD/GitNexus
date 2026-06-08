# `research-graph` import template — Design

**Date**: 2026-06-03
**Status**: current
**Builds on**: `2026-06-03-graph-platform-p0-kuzu-sidecar-design.md` (Template SDK + sidecar),
`2026-06-03-graph-platform-p1-sdk-proof-design.md` (SDK proven; schema-agnostic ingest).
**Related (other repo)**: Experiment.Crypto `docs/superpowers/specs/2026-06-02-research-knowledge-graph-design.md`
(the curated research graph this template ingests — its **M5 "GitNexus registration"** milestone).

## 1. Context / problem

The first Template Library entry is the crypto/Experiment.Crypto domain. While
scoping it, a better path surfaced: Experiment.Crypto **already has a curated
research knowledge graph** — a typed YAML store (`notes/graph/`, seeded) with
`Hypothesis`/`Experiment`/`Verdict`/`SDR`/`ADR`/`Paper`/… nodes and **real
semantic edges** (`tests`/`validates`/`gated_by`/`supersedes`/`produces`/`cites`/…),
designed in its own spec. That spec planned a **GitNexus-registration milestone
(M5)** — emit the graph and register it in GitNexus's multigraph — and
**gated it on `origin/deployment` landing** the multigraph/sidecar machinery.

`deployment` has now landed: **P0/P1 (the Kùzu sidecar + import-template SDK)
are exactly the GitNexus side M5 was waiting for.** And the SDK offers a cleaner
realization than the original M5 sketch: instead of registering a **raw `.kuzu`
file** (which couples to the backend's Kùzu version — the exact risk P0's sidecar
and P1's JSON-lens were built to avoid), the research graph enters as a normal
**import template** consuming a JSON emit (like academic's `papers.json`).

Two rejected non-starters clarified the target:
- A **bespoke crypto-coupling template** (assets/correlations) — a *different*
  graph (findings, not research structure); deferred, not what's wanted now.
- `research-artifacts` on raw `.md`/`.ipynb` files — yields ~78 **disconnected**
  nodes (no frontmatter links); it captures *files*, not the curated reasoning.

The curated graph already holds the rich edges; the job is to **import it**.

## 2. Goal

A `research-graph` import template that ingests a curated research knowledge
graph from a `research-graph.json` emit into the Kùzu sidecar and renders it on
the existing canvas — so the research's *reasoning structure* (hypotheses →
experiments → verdicts, with gating/validation/supersession edges) is a
first-class graph in gitnexus. **gitnexus-side only**: this spec also **defines
the `research-graph.json` contract** that the Experiment.Crypto emitter (the
user's later, Alten-side work) will target — but builds none of that emitter.

## 3. Design

### 3.1 A second research template, complementary to `research-artifacts`

`research-graph` is **separate** from the shipped `research-artifacts`:

| | `research-artifacts` | `research-graph` (this) |
|---|---|---|
| Source | `.md`/`.ipynb` files (walked) | a curated `research-graph.json` emit |
| Nodes | notes / notebooks | Hypothesis / Experiment / Verdict / SDR / … |
| Edges | frontmatter links (sparse) | curated reasoning: `tests`/`validates`/`gated_by`/… |

Both coexist as distinct templates; choosing one vs the other is a source choice.

### 3.2 The `research-graph.json` contract (cross-repo interface)

The emit format, mirroring the curated store's loader output:
```json
{ "schema": { "node_types": ["Hypothesis","Experiment","Verdict","SDR","ADR","Paper","Idea","Detector","Run","Tool","Indicator","Dataset","Regime","Phase","Submeasure"],
              "edge_types": ["tests","refines","supersedes","gated_by","pins","produces","validates","uses","cites","spawns","focuses_regime","decided_by","implemented_by"],
              "statuses":   ["open","active","validated","rejected","inconclusive","superseded","planned","deferred"] },
  "nodes": [ { "id": "exp001", "type": "Experiment", "title": "TradFi link H1", "status": "active",
               "anchor": "notes/scientific_decisions.md#2026-05-15-exp001" } ],
  "edges": [ { "from": "exp001", "to": "H1", "type": "tests" },
             { "from": "v1", "to": "H1", "type": "validates" } ] }
```
- The `schema` block is **optional metadata** (documents the vocabulary); the
  importer does **not** reject unknown types — `type` is carried as a property,
  and validation already happens upstream in the Experiment.Crypto loader.
- `anchor` (a `notes/<file>.md#YYYY-MM-DD-slug` pointer to the source decision)
  is carried as a node property — a clickable source link in a later iteration.

### 3.3 Sidecar DDL — generic `Entity`/`Relates`, type as a property

```
CREATE NODE TABLE Entity(id STRING, type STRING, title STRING, status STRING, anchor STRING, PRIMARY KEY(id))
CREATE REL TABLE  Relates(FROM Entity TO Entity, id STRING, kind STRING)
```
(Table names Entity/Relates avoid Cypher reserved words — NODE is a Kùzu keyword; node type / edge kind come from properties, so table names never surface in render.)

Two tables only. **Why not per-type tables** (as academic used Paper/Author/Topic)?
The curated graph has ~15 node types + ~13 edge types — per-type DDL would be ~28
tables, and the source model is a `networkx` graph with `type` as a node/edge
**attribute**, not separate typed tables. Generic `Entity`/`Relates` with type-as-
property is therefore the faithful *and* simplest mapping. *Rejected:* per-type
tables (28-table DDL, no benefit here; the SDK supports both shapes — this domain
wants generic). The P1 sidecar render already surfaces `node.type` (→ color) and
`edge.kind`; the importer maps the contract's edge `type` → the ingest edge prop
**`kind`** so the render picks it up (the render reads `r.kind`).

### 3.4 Components (all gitnexus-side, personal identity)

| # | File | Responsibility |
|---|---|---|
| A | `upstream/docker-server-research-graph-importer.mjs` *(new)* | read `research-graph.json` → emit generic ingest shape (`Entity` nodes, `Relates` edges with `kind`=type) + report (counts by node type); pure Node, deterministic, dedup by id |
| B | `upstream/docker-server-graph-templates-core.mjs` *(edit)* | register `research-graph` descriptor (kind `import`, `importer:'research-graph-json'`, the 2-table DDL with `Entity`/`Relates`, `visual.nodeColors` per type); add to `BUILTINS` |
| C | `upstream/docker-server-graph-templates.mjs` *(edit)* | wire `IMPORTERS['research-graph-json']` |
| D | `upstream/Dockerfile.web` *(edit)* | **COPY** the new importer module (boot-crash discipline — `docker-server.mjs` imports it at boot) |
| E | fixtures + tests | synthetic `research-graph.json` + importer unit test + registry test + HTTP integ test |

### 3.5 Render / visual

Rendered through the existing canvas (the importer output flows sidecar →
`/graph/research/:name` → `research-graph-adapter`). `visual.nodeColors` keys on
the node `type` (Hypothesis/Experiment/Verdict/SDR/Paper/Idea/… palette); edge
`kind` distinguishes `tests`/`validates`/`gated_by`/… Rich legibility of a
many-type graph leans on **P3** later; v1 uses the existing force layout.

## 4. Testing (synthetic only — zero Experiment.Crypto data)

- **Unit** (`tests/unit/research-graph-importer.test.mjs`): a hand-written
  `research-graph.json` fixture (≥2 hypotheses, ≥2 experiments, ≥1 verdict, edges
  `tests`/`validates`/`gated_by`/`supersedes`) → assert node `type`/`status`,
  edge `kind`, dedup by id, report counts, and that an absent/empty file is
  handled (clear error / empty graph).
- **Registry** (`tests/unit/graph-templates-registry.test.mjs`): assert the
  `research-graph` descriptor (kind `import`, importer id, the `Entity`+`Relates` DDL).
- **Integration** (`tests/integration/endpoints/graph-templates.test.mjs` +
  fixture): a `research-graph-corpus/research-graph.json` added to the
  `sample-repo.tar.gz` (sibling of `sample-repo/`/`academic-corpus/`), driving
  scaffold→import→render over HTTP, asserting node types + edge kinds.

## 5. Scope boundaries

- **gitnexus-side only.** This spec defines the `research-graph.json` *contract*;
  it does **not** build the Experiment.Crypto emitter (M1 builder + JSON emit) —
  that is the user's later, **Alten-identity, AI-trace-free** work, committed by
  the user, and touches **no** file in this scope.
- **No graph-theory queries** (frontier/gated/provenance) here — those live in
  the Experiment.Crypto Python model today and become **P2 lenses** over the
  imported graph later (clean synergy; out of scope now).
- **No M2/M3 views** (Graphviz SVG / pyvis HTML) — those are Experiment.Crypto-
  side, unrelated to this template.
- **No `research-artifacts` change** — this is an additional, independent template.

## 6. Open questions

- **Template id / naming** — `research-graph` chosen (vs `knowledge-graph`); it
  pairs clearly with the existing `research-artifacts`. Settled unless the user
  prefers otherwise.
- **`anchor` as a live link** — carried as a prop now; turning it into a
  clickable jump (to the source decision doc, or a gitnexus code symbol for
  `implemented_by`) is a later iteration, not v1.
- **Emit trigger on the Experiment.Crypto side** — whether the emitter is a CLI
  subcommand of `cmex_crypto.research_graph` or a `make` target is the user's
  call when they do that Alten-side work; this spec only fixes the JSON shape.
