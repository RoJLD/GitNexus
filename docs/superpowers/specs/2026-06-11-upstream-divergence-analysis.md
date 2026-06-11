# Upstream divergence analysis — v1.6.5 → abhigyanpatwari/gitnexus `main` (+257)

**Date**: 2026-06-11
**Status**: reference / analysis (for a future bump decision)
**Companion**: `patches/bump-dry-run-main.md` (the per-file dry-run), ROADMAP "Refactos →
Divergence upstream". "Upstream" = the **original fork repo** `abhigyanpatwari/gitnexus`
(NOT our `RoJLD/GitNexus`, which is fully in sync — it holds only patches + tooling;
`upstream/` is gitignored). Our pinned upstream = **v1.6.5**; their `main` = **+257
commits** (latest tag `v1.6.8-rc.9`; spans releases **v1.6.6, v1.6.7, v1.6.8-rc**).

## 1. What the 257 commits are (by type)

`fix 112 · chore 67 · feat 59 · refactor 6 · perf 6 · docs 3 · test 2 · ci 2`.
The chore bulk = dep bumps + RC release churn. The substance is in the 59 feats (+ the
fixes that support them).

## 2. What they added (the 59 feats), by theme

- **Parsing / scope-resolution engine (the dominant investment)** — "RFC #909 Ring 3":
  migrated **JavaScript, Ruby, Rust, Swift, Vue SFC, Kotlin, Java, COBOL** to scope-based
  resolution; **C++** got 9 commits (overload resolution, SFINAE filter, template partial
  ordering, inheritance-lattice member lookup, user-defined conversion ranking, dependent-
  base lookup); **Go** structural interface inference. Per-language progress reporting.
- **Ingestion / analysis substrate (10)** — **control-flow-graph layer for TS/JS**,
  **REACHING_DEF intra-procedural data-dependence**, **taint/PDG substrate (M0)**, FastAPI
  `include_router(prefix=)` cross-file routes + `Depends()` indirect-call tracing, Java
  Spring route→Route node extraction, tree-sitter node-type validation gate.
- **Cross-service / group (4)** — Kotlin Spring HTTP route+consumer extraction, OpenFeign
  `@RequestLine` consumer contracts (inter-service API contracts).
- **Web viewer (3)** — **Tree View + Circles View** in the viewer, **GitLab** repo URLs,
  **`GITNEXUS_BACKEND_URL`** env var for Docker deployments.
- **Wiki (3)** — multilanguage (`--lang`), local Claude/Codex/opencode providers.
- **CLI (3)** — `gitnexus uninstall`, impact `--uid/--file/--kind` disambiguation,
  `.gitnexusrc` + `--default-branch`.
- **MCP (2)** — pagination on `impact` + `list_repos` (token-truncation fix).
- **Misc** — **i18n** (web + CLI language-aware), devcontainer for Claude/Codex/Cursor,
  PR-reviewer swarm agents, toolchain-free vendored tree-sitter prebuilds, DeepSeek V4 API.

## 3. Why our 10 inplace files conflict (attribution)

The dry-run's 10 `fail` files are conflict-driven by a **handful** of upstream web commits,
not a sprawling refactor:

| Our file | Upstream commits touching it (v1.6.5..main) |
|---|---|
| `GraphCanvas.tsx` | Tree View + Circles View ; i18n |
| `useSigma.ts` | Tree View + Circles View |
| `App.tsx` | i18n |
| `docker-server.mjs` | `GITNEXUS_BACKEND_URL` env var |
| `core/llm/agent.ts` | DeepSeek V4 API ; agent-prompt alignment ; stop-on-click |
| `Header.tsx`, `DropZone.tsx`, `RepoAnalyzer.tsx` | viewer evolution (i18n / views / GitLab) |
| `package.json` + `package-lock.json` | dep bumps (incl. i18n libs) |

So the reapply surface = merging our overlays with **(a) the new Tree/Circles views, (b)
i18n, (c) GITNEXUS_BACKEND_URL, (d) the agent's DeepSeek/prompt/stop changes**. Bounded +
understandable.

## 4. Strategic conclusion (the key takeaway)

**Most of upstream's value (≈the entire engine investment: CFG, PDG/taint, scope
resolution for 8+ languages, C++ overload resolution, Spring/FastAPI route tracing) lives
in the CLI/analysis backend — which we consume as a PINNED DOCKER IMAGE (`gitnexus:X.Y.Z`),
NOT via our patches.** Therefore:

- **A CLI/backend image bump is cheap + high-value**: bump the pinned tag (Dockerfile
  `gitnexus:1.6.5` → a stable 1.6.7/1.6.8) → we get CFG/PDG/taint/more-languages **for
  free, with ZERO patch reapply**, *provided the `/api/graph` (+ analytics) API contract our
  patches consume is unchanged*. **Action: verify the API contract first** (diff the routes/
  response shapes our analytics depend on — `/api/graph`, snapshot/render endpoints — across
  v1.6.5→target). If stable, the image bump is low-risk and unlocks the engine gains.
- **The web-viewer patch reapply (10 files) is OPTIONAL** — only needed if we want their new
  web features (Tree/Circles View, i18n, GitLab, backend-url). It's the bounded job in §3,
  best done in an isolated worktree, targeting a **stable tag** (not moving `main`), then
  regen patches + drift + web build + boot-smoke.

**Recommended bump order (future session):**
1. Confirm the `/api/graph` + analytics API contract is stable v1.6.5 → target tag (e.g.
   v1.6.7). If yes → **bump the CLI/backend image pin alone** (engine gains, no reapply) and
   ship that first — biggest value/effort ratio.
2. Separately + optionally, reapply the 10 web-viewer inplace edits onto the target tag
   (merge our overlays with Tree/Circles + i18n), in a worktree, when the new viewer
   features are wanted.
3. Re-run `node scripts/bump-upstream.mjs <stable-tag>` to confirm the reapply surface on the
   chosen tag (vs the `main` snapshot here).

## 5. Open questions for the bump decision

- **Is the `/api/graph` contract stable** v1.6.5→target? (Gates the cheap image-only bump.)
  The ingestion changes (CFG/PDG/taint) ADD node/edge types — additive to the graph, likely
  contract-compatible, but verify the response shape + the lens projections still hold.
- **Do we want the new viewer features** (Tree/Circles View, i18n)? If not, skip the
  web-viewer reapply entirely and just bump the engine image.
- **Target tag**: wait for **v1.6.8 final** (currently rc.9) or take **v1.6.7** (stable)?
  Re-run the dry-run against the chosen tag before committing to it.
