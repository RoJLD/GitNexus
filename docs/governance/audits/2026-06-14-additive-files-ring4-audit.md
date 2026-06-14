---
audit_id: 2026-06-14-additive-files-ring4-audit
audit_date: 2026-06-14
auditor: Claude Opus 4.7 (IMPL D, agent-driven)
scope: cohabitation contract — `patches/additive-files.diff`
upstream_target: GitNexus v1.6.7 (Gergő Magyar)
upstream_baseline: v1.6.5 (commit 42d4fcaf)
upstream_head: v1.6.7 (post commit 4fc2ffa5)
ring: Ring 4 — Legacy Resolution Engine deletion
ring4_commits:
  - "083aedbc — RING4-1 #942 — delete legacy call-resolution DAG + heritage processor (2026-06-04)"
  - "bd59fa95 — RING4-2 #943 — delete ResolutionContext + tiered-lookup + import-map plumbing (2026-06-04)"
  - "4fc2ffa5 — RING4-3 #944 — delete shadow-mode parity harness (2026-06-07)"
verdict: SAFE — zero migration required
breaking_files: 0
total_files_audited: 131
methodology: static regex scan + import surface enumeration
---

# Additive-files × Ring 4 Legacy Resolution Engine — Breakage Audit

> *"Avant tout bump d'un upstream qui a supprimé une API core, l'audit additive-files est obligatoire. Le contrat de cohabitation se prouve, il ne se présume pas."*

## TL;DR

| Field | Value |
|---|---|
| Additive files in scope | **131** (parsed `^diff --git a/` lines, `patches/additive-files.diff` = 26909 lines) |
| Ring 4 patterns scanned | 26 (deleted APIs + legacy keywords) |
| Pattern matches (total) | **0 / 26** |
| Imports from `gitnexus-shared` | **3** — all type-only, all public graph schema |
| Files in Ring 4 impact zone | **0** (Ring 4 deleted `gitnexus/src/core/ingestion/**` + `gitnexus-shared/src/scope-resolution/shadow/**` — disjoint from our additive surface) |
| **Verdict** | **SAFE — zero migration work required for v1.6.5 → v1.6.7 with respect to Ring 4** |
| Caveat | Companion `patches/inplace-edits.diff` NOT audited here — recommend a parallel READER R4-bis pass |

The brief mentioned 99 files; the actual additive surface in the diff is **131 files**. Auto Mode: proceeded with the real count. If the figure 99 was authoritative for some prior inventory, reconciliation may be needed — but the verdict (zero Ring 4 dependency) holds at any cardinality.

---

## 1. Inventory

### 1.1 Distribution by zone (131 files)

| Zone | Count | Nature |
|---|---|---|
| `connectors/*.mjs` | 4 | github / jira / linear / plane external connectors |
| `docker-server-*.mjs` | 58 | sidecar HTTP server endpoints (academic-json, churn, similarity, sysml-export, ghosts, etc.) |
| `gitnexus-web/src/**` | 69 | React UI components + lib utilities + services + hooks |
| **Total** | **131** | All adjacent application layers |

### 1.2 Zone × Ring 4 impact map

| Zone | In Ring 4 impact zone? | Reason |
|---|---|---|
| `connectors/` | NO | External-system API plumbing only (REST/GraphQL to GitHub/Jira/Linear/Plane). No resolution-engine surface. |
| `docker-server-*.mjs` | NO | HTTP route handlers + thin orchestration to Kuzu/SQLite. No reach into `core/ingestion/**`. |
| `gitnexus-web/src/**` | NO | Browser-side React + TypeScript. Cannot import Node-side `core/ingestion` even in principle. |
| Ring 4 deletion targets | — | `gitnexus/src/core/ingestion/**` + `gitnexus-shared/src/scope-resolution/shadow/**` — **architecturally disjoint** from all three above. |

### 1.3 Full path list

Available at `/tmp/additive-files-list.txt` (extracted from diff). Excerpt — head/tail samples:

**Head (10):**
```
connectors/github.mjs
connectors/jira.mjs
connectors/linear.mjs
connectors/plane.mjs
docker-server-academic-json-importer.mjs
docker-server-auto-reindex.mjs
docker-server-baseline-seed.mjs
docker-server-churn.mjs
docker-server-cluster-audit.mjs
docker-server-commit-footprint.mjs
```

**Tail (10):**
```
gitnexus-web/src/lib/timeline-url.ts
gitnexus-web/src/lib/timeline-zoom.ts
gitnexus-web/src/lib/wiki-schedule.ts
gitnexus-web/src/services/clusters-client.ts
gitnexus-web/src/services/ghosts-client.ts
gitnexus-web/src/services/graph-theory-client.ts
gitnexus-web/src/services/mutation-engine.ts
gitnexus-web/src/services/research-client.ts
gitnexus-web/src/services/semantic-labeler.ts
gitnexus-web/src/services/snapshot-ghosts-cache.ts
```

---

## 2. Empirical grep — files × patterns

Method: `grep -c <pattern> patches/additive-files.diff` over each Ring 4 / legacy keyword.

### 2.1 Ring 4 deleted API surface

| # | Pattern | Source (Ring 4 commit) | Matches |
|---|---|---|---|
| 1 | `resolveCallTarget` | 083aedbc RING4-1 | **0** |
| 2 | `inferImplicitReceiver` | 083aedbc RING4-1 | **0** |
| 3 | `selectDispatch` | 083aedbc RING4-1 | **0** |
| 4 | `buildHeritageMap` | 083aedbc RING4-1 | **0** |
| 5 | `HeritageMap` | 083aedbc RING4-1 | **0** |
| 6 | `processHeritage` | 083aedbc RING4-1 | **0** |
| 7 | `heritageExtractor` | 083aedbc RING4-1 | **0** |
| 8 | `ResolutionContext` | bd59fa95 RING4-2 | **0** |
| 9 | `TIER_CONFIDENCE` | bd59fa95 RING4-2 | **0** |
| 10 | `TieredCandidates` | bd59fa95 RING4-2 | **0** |
| 11 | `walkBindingChain` | bd59fa95 RING4-2 | **0** |
| 12 | `GITNEXUS_SHADOW_MODE` | 4fc2ffa5 RING4-3 | **0** |
| 13 | `preEmitInheritanceEdges` | 083aedbc RING4-1 | **0** |
| 14 | `emitHeritageEdges` | 083aedbc RING4-1 | **0** |
| 15 | `MethodDispatchIndex` | 083aedbc RING4-1 | **0** |
| 16 | `tiered-lookup` | bd59fa95 RING4-2 | **0** |
| 17 | `wildcard-synthesis` | bd59fa95 RING4-2 | **0** |
| 18 | `namedImportMap` | bd59fa95 RING4-2 | **0** |
| 19 | `moduleAliasMap` | bd59fa95 RING4-2 | **0** |

### 2.2 Legacy resolution surface keywords

| # | Pattern | Matches |
|---|---|---|
| 20 | `resolveScope` | **0** |
| 21 | `ScopeResolver` | **0** |
| 22 | `LegacyResolver` | **0** |
| 23 | `ring4` | **0** |
| 24 | `ring_4` | **0** |
| 25 | `Ring 4` | **0** |
| 26 | `@/legacy` | **0** |
| — | `legacy/` (as import path) | **0** |

### 2.3 `gitnexus-shared` import surface

3 distinct import statements detected across the full diff (line numbers in `patches/additive-files.diff`):

| Line | File | Statement | Symbols |
|---|---|---|---|
| 17022 | `gitnexus-web/src/components/Graph3DCanvas.tsx` | `import type { GraphNode, NodeLabel } from 'gitnexus-shared';` | `GraphNode`, `NodeLabel` |
| 24600 | `gitnexus-web/src/lib/graph-diff.ts` | `import type { GraphNode, GraphRelationship } from 'gitnexus-shared';` | `GraphNode`, `GraphRelationship` |
| 26108 | `gitnexus-web/src/services/mutation-engine.ts` | `import type { GraphNode, GraphRelationship } from 'gitnexus-shared';` | `GraphNode`, `GraphRelationship` |

All 3 imports are:
- **`type`-only** (TypeScript `import type` — erased at compile time, no runtime binding).
- **Public graph schema** — `GraphNode`, `NodeLabel`, `GraphRelationship`. These remain exported from `gitnexus-shared/src/index.ts` post-Ring 4 (verified at commit `4fc2ffa5`).
- **Disjoint from the deleted surface** — Ring 4 retired `scope-resolution/shadow/**`, not the public graph types.

---

## 3. Verdict per file

Given:
- 26/26 Ring 4 patterns match **0** times.
- 3 `gitnexus-shared` imports — all type-only public schema, none touching deleted Ring 4 internals.
- 0 files in the Ring 4 impact zone (`gitnexus/src/core/ingestion/**`, `gitnexus-shared/src/scope-resolution/shadow/**`).

The per-file verdict is uniform.

| Verdict | Count | Files |
|---|---|---|
| **BREAKING** | **0** | (none) |
| **SAFE** | **131** | all 131 additive files |
| **UNSURE** | 0 | (none) |

No file-level sub-table is produced because the result is uniformly SAFE. Per-file enumeration would just repeat the inventory in Section 1.

---

## 4. Migration strategy

**Recommendation: NONE REQUIRED for the additive surface.**

| Approach | Verdict | Rationale |
|---|---|---|
| Bulk no-op migration | **APPLICABLE** | Zero deleted-API call-sites means zero rewrites. The additive layer transits the v1.6.5 → v1.6.7 bump unchanged with respect to Ring 4. |
| File-by-file shim | NOT NEEDED | No file imports a deleted symbol. |
| Compatibility layer (re-export deleted APIs) | NOT NEEDED | Nothing to compatibility-wrap. |
| Type-import migration | NOT NEEDED | The 3 `gitnexus-shared` type imports target public graph schema preserved post-Ring 4. |

### 4.1 Architectural cleanliness of the cohabitation contract

The audit empirically validates the **cohabitation contract architecture**:

```
┌─────────────────────────────────────────────────────────────────┐
│  ELYSIUM additive surface (131 files — SAFE)                    │
│  ├─ connectors/        (external API plumbing)                  │
│  ├─ docker-server-*.mjs (sidecar HTTP endpoints)                │
│  └─ gitnexus-web/src/  (React UI)                               │
│                                                                  │
│           │ talks only to PUBLIC graph schema                   │
│           ▼ (GraphNode / NodeLabel / GraphRelationship)         │
│                                                                  │
│  gitnexus-shared (public API surface — STABLE across Ring 4)    │
│                                                                  │
│           │ wraps                                                │
│           ▼                                                      │
│                                                                  │
│  gitnexus/src/core/ingestion/** (Ring 4 deletion zone)          │
│  gitnexus-shared/src/scope-resolution/shadow/** (deleted)       │
│                  ⨯ UNREACHED by additive surface                │
└─────────────────────────────────────────────────────────────────┘
```

The additive layer treats GitNexus as a black box exposing a graph schema. Ring 4 refactored the engine *behind* that schema. The contract held.

### 4.2 Out-of-scope (must be audited separately)

- **`patches/inplace-edits.diff`** — the "modify-existing-files" half of the cohabitation contract. By definition it modifies files inside `gitnexus/src/**` and *could* carry Ring 4 dependencies. A parallel READER R4-bis pass on `inplace-edits.diff` is **mandatory before declaring the full v1.6.7 bump safe**.
- **Dynamic indirection** — if any additive file accesses Ring 4 APIs via `Function()` constructor, runtime `require(computedPath)`, or JSON-defined entrypoints, static regex misses it. Probability LOW given the additive surface profile (HTTP routes, React UI, REST connectors — all statically-imported). Risk classed **LOW**.

---

## 5. Cardinal facts (R4 audit, distilled)

1. Risk level GLOBAL: **LOW** — zero detected dependency on Ring 4 deleted APIs.
2. Ring 4 deletion impact zone — `gitnexus/src/core/ingestion/**` + `gitnexus-shared/src/scope-resolution/shadow/**` — is **disjoint** from our additive surface.
3. Only `gitnexus-shared` surface touched: type-only imports of `GraphNode`/`NodeLabel`/`GraphRelationship` — preserved in v1.6.6+ public API.
4. 3 cardinal Ring 4 commits: `083aedbc` RING4-1, `bd59fa95` RING4-2, `4fc2ffa5` RING4-3 — all authored by Gergő Magyar 2026-06-04 → 2026-06-07.
5. Migration strategy: **zero work needed** on the additive layer.
6. Bump v1.6.5 → v1.6.7 **safe for the additive layer with respect to Ring 4**.

---

## 6. Risks & caveats

| Sev | Risk | Mitigation |
|---|---|---|
| LOW | `patches/inplace-edits.diff` not audited here — could still carry Ring 4 surface dependencies | Schedule READER R4-bis pass on `inplace-edits.diff` before full v1.6.7 bump |
| LOW | Static regex grep would miss dynamic-indirection access (`Function()`, computed `require()`, JSON entrypoints) | Cohabitation review at runtime + smoke tests on sidecar boot + UI E2E |
| INFO | Brief said 99 files; actual count is 131. Audit used the real surface | If the 99 figure was canonical (some prior inventory), reconcile — but verdict holds at any cardinality |

---

## 7. Iron Rule — Σ-UPSTREAM-MAJOR-DELETION-AUDIT-MANDATORY

> **Avant tout bump d'un upstream qui a supprimé un core API, audit additive-files automatique. Le contrat de cohabitation se prouve, il ne se présume pas.**

### 7.1 Trigger

This Iron Rule fires whenever:
1. An upstream release (semver bump or commit range) **deletes** any module under a path where the consumer (us) maintains an **additive cohabitation layer**.
2. The deletion crosses what was — prior to the deletion — a stable internal API.

### 7.2 Mandatory checklist (before merging the bump)

| Step | Tool | Pass criterion |
|---|---|---|
| **1. Identify deletion commits** | `git log <prev>..<new> -- <deleted_paths>` | List of commits ≥ 1 |
| **2. Extract deleted API surface** | `git diff <prev>..<new> -- <deleted_paths>` + symbol grep | Canonical list of symbols (functions, types, constants, env vars, import paths) |
| **3. Static scan of additive surface** | `grep -c <symbol> patches/additive-files.diff` × N patterns | **0** matches per pattern OR documented per-file migration |
| **4. Public API touch enumeration** | `grep "from '<upstream-package>'" patches/additive-files.diff` | Every hit classified: `type-only` / `public-runtime` / `deleted-surface` |
| **5. Companion in-place patches audit** | Same procedure applied to `patches/inplace-edits.diff` | Same pass criterion |
| **6. Audit artifact** | Markdown report under `docs/governance/audits/YYYY-MM-DD-<topic>.md` | File exists, signed, frontmatter `verdict:` set |

### 7.3 Why this Iron Rule exists

This audit (2026-06-14) revealed a happy-path outcome: the cohabitation contract held cleanly across a 3-commit core-API deletion (Ring 4) because the additive surface only touches public graph schema types. **That outcome was not guaranteed.** Had the additive surface reached into `core/ingestion/**` directly (a common anti-pattern for sidecars chasing performance), the v1.6.5 → v1.6.7 bump would have detonated 131 files silently. The mandatory audit step makes the cohabitation contract **falsifiable**: either the grep returns zero, or migration work is enumerated and executed *before* the bump merges.

### 7.4 Anti-pattern this Iron Rule prevents

> "*The bump compiled, so we're fine.*"

Compilation can pass while runtime fails — dynamic indirection (string-keyed dispatch, JSON entrypoints, computed `require`) hides deleted-API references from the type-checker. The Iron Rule mandates a **textual grep of the additive diff**, not just a successful `tsc`.

### 7.5 Synergy with existing doctrine

- **SCM-9 (SIGIL-1255 Σ-Composition-Souverain-OSS-Cardinale)** — same lineage: deep-extract OSS + sentinel souverain catches what isolated layers miss.
- **MEM-1..5 (SIGIL-1537 Σ-MEMORY-FIRST)** — audit artifacts go under `docs/governance/audits/` (memory-first surface) so future bumps replay the verdict instead of re-discovering it.
- **STORAGE-1 (anti-SPOF)** — applies the same falsifiability discipline to dependency-side single-points-of-failure.

---

## 8. Files identified (artifacts touched / produced)

| Path | Role |
|---|---|
| `C:/Users/robla/VScode_Project/ELYSIUM/ingestion/GitNexus/patches/additive-files.diff` | Audit input — 131 files, 26909 lines |
| `C:/Users/robla/VScode_Project/ELYSIUM/ingestion/GitNexus/patches/inplace-edits.diff` | NOT audited here — companion patch, **scheduled for R4-bis pass** |
| `C:/Users/robla/VScode_Project/ELYSIUM/ingestion/GitNexus/patches/upstream-all.diff` | Upstream v1.6.5 → v1.6.7 reference diff |
| `C:/Users/robla/VScode_Project/ELYSIUM/ingestion/GitNexus/upstream/.git` | Reference commits: `083aedbc`, `bd59fa95`, `4fc2ffa5` |
| `C:/Users/robla/VScode_Project/ELYSIUM/ingestion/GitNexus/cohabitation.config.json` | Cohabitation contract config |
| `C:/Users/robla/VScode_Project/ELYSIUM/ingestion/GitNexus/docs/governance/audits/2026-06-14-additive-files-ring4-audit.md` | **This audit report** |

---

## 9. Sign-off

| Field | Value |
|---|---|
| Audit complete | YES |
| Scope honoured | YES — `additive-files.diff` only |
| Out-of-scope flagged | YES — `inplace-edits.diff` (mandatory R4-bis follow-up) |
| Verdict | **SAFE — 0 breaking files / 131** |
| Iron Rule emitted | Σ-UPSTREAM-MAJOR-DELETION-AUDIT-MANDATORY |
| Next action | Schedule READER R4-bis pass on `patches/inplace-edits.diff` |

*Audit produced under Auto Mode — ELYSIUM cognitive harness, IMPL D delegation, 2026-06-14.*
