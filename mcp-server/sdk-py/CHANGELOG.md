# Changelog - gitnexus-copilot-sdk (Python)

All notable changes to this package will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `auth_token` argument on `CopilotClient.__init__` and field on
  `CopilotClientOptions` (Iron Rule **Sigma-COPILOT-SDK-AUTH-1** —
  `Sigma-BEARER-AUTH-MANDATORY`). When set, the SDK attaches
  `Authorization: Bearer <token>` to every request.
- `CopilotAuthError` class (subclass of `CopilotHTTPError`) raised on HTTP
  401 / 403 responses. Existing `except CopilotHTTPError` blocks keep
  catching ; callers can branch on `except CopilotAuthError` to refresh
  bearer tokens.
- GitHub Actions workflow `.github/workflows/publish-pypi.yml` for
  tag-driven CI publish (Iron Rule **Sigma-COPILOT-SDK-PUBLISH-1** —
  `Sigma-TAG-DRIVEN-CI-PUBLISH`). Triggered by `sdk-py-v*` tags.
- `tests/test_auth.py` (6 cases : Bearer attach / no-token / 401 / 403 /
  collision resolution / `CopilotClientOptions` propagation).
- `CHANGELOG.md` (this file) and `PUBLISH.md` (manual publish runbook).

### Changed
- `_get_json` now routes 401 / 403 responses through `CopilotAuthError`
  before falling back to the generic `CopilotHTTPError` path.

## [0.1.0] - 2026-06-15

### Added
- MVP scaffold of the Python SDK (`gitnexus-copilot-sdk`).
- `CopilotClient` synchronous client wrapping the four `/copilot/*` REST
  endpoints : `mcp-inventory`, `blt-context`, `cluster-context`,
  `forge-context`.
- One-shot helpers `mcp_inventory()`, `blt_context()`,
  `cluster_context()`, `forge_context()`.
- TypedDict mirrors of every wire shape (Iron Rule
  **Sigma-COPILOT-SDK-1** — types mirror, never source-of-truth).
- `CopilotHTTPError` raised on non-2xx responses.
- 5 stub URL-construction tests using a recording `requests.Session`
  double.

[Unreleased]: https://github.com/abhigyanpatwari/gitnexus/compare/sdk-py-v0.1.0...HEAD
[0.1.0]: https://github.com/abhigyanpatwari/gitnexus/releases/tag/sdk-py-v0.1.0
