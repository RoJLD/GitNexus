# Changelog — @gitnexus/copilot-sdk

All notable changes to this package will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `authToken` option on `CopilotClientOptions` (Iron Rule **Sigma-COPILOT-SDK-AUTH-1** —
  `Sigma-BEARER-AUTH-MANDATORY`). When set, the SDK attaches
  `Authorization: Bearer <token>` to every request.
- `CopilotAuthError` class (subclass of `CopilotHTTPError`) thrown on HTTP
  401 / 403 responses. Existing `catch (CopilotHTTPError)` blocks keep
  working ; callers can branch on `instanceof CopilotAuthError` to refresh
  bearer tokens.
- GitHub Actions workflow `.github/workflows/publish-npm.yml` for
  tag-driven CI publish (Iron Rule **Sigma-COPILOT-SDK-PUBLISH-1** —
  `Sigma-TAG-DRIVEN-CI-PUBLISH`). Triggered by `sdk-ts-v*` tags.
- `npm test` script wired to `tsc + node --test dist/__tests__/*.test.js`
  (no Jest/Vitest dep — keeps the test stack as lean as the SDK).
- `src/__tests__/auth.test.ts` (5 cases : Bearer attach / no-token / 401 /
  403 / collision resolution).
- `CHANGELOG.md` (this file) and `PUBLISH.md` (manual publish runbook).

### Changed
- `requestJson` now routes 401 / 403 responses through `CopilotAuthError`
  before falling back to the generic `CopilotHTTPError` path.

## [0.1.0] - 2026-06-15

### Added
- MVP scaffold of the TypeScript SDK (`@gitnexus/copilot-sdk`).
- `GitnexusCopilotClient` class wrapping the four `/copilot/*` REST endpoints :
  `mcp-inventory`, `blt-context`, `cluster-context`, `forge-context`.
- Convenience one-shot helpers `mcpInventory()`, `bltContext()`,
  `clusterContext()`, `forgeContext()`.
- TypedDict mirrors of every wire shape (Iron Rule
  **Sigma-COPILOT-SDK-1** — types mirror, never source-of-truth).
- `CopilotHTTPError` thrown on non-2xx responses.

[Unreleased]: https://github.com/abhigyanpatwari/gitnexus/compare/sdk-ts-v0.1.0...HEAD
[0.1.0]: https://github.com/abhigyanpatwari/gitnexus/releases/tag/sdk-ts-v0.1.0
