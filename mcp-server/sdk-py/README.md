# gitnexus-copilot-sdk (Python)

Python client SDK for the **GitNexus Architect's Copilot AI** REST surface
(Tier 3.7 Phase A endpoints). Scaffolded 2026-06-15 - Phase B (SDK extraction).

> Status: **MVP scaffold + B'5 auth + B'6 publish-prep**. Bearer auth
> (Task B'5) and tag-driven PyPI publish CI (Task B'6) **SCAFFOLDED 2026-06-15**.
> `gitnexus_tour` SSE streaming wrapper (Task B3) remains open. The package
> is still consumed in-tree only until the first `sdk-py-v*` tag is pushed.

## Why this SDK exists

The four `/copilot/*` endpoints are the stable consumption surface for
external agents (LangChain tools, AutoGen agents, ad-hoc scripts) that
want to feed the Architect's Copilot context into their own LLM pipelines.
Hand-rolling `requests.get + .json()` everywhere rots fast - this SDK
freezes the shapes and surfaces typed errors.

## Install

Currently in-tree only (no PyPI publish - Task B7 REMAINING):

```bash
cd mcp-server/sdk-py
pip install -e .
# or with dev extras
pip install -e ".[dev]"
```

Once published (Phase B7):

```bash
pip install gitnexus-copilot-sdk
```

## Usage

### One-shot helpers

```python
from gitnexus_copilot import mcp_inventory, blt_context, CopilotClientOptions

inv = mcp_inventory(CopilotClientOptions(base_url="http://localhost:4747"))
if inv["gateVerdict"] != "pass":
    raise RuntimeError("Tier 3.7 inventory gate FAILED")

blt = blt_context(
    repo="hmm_studio",
    limit=20,
    options=CopilotClientOptions(base_url="http://localhost:4747"),
)
print(f"Recent BLT tx: {blt['tx_count']}, total: {blt['total_blt']}")
```

### Shared client (recommended for long-running agents)

```python
import os
from gitnexus_copilot import CopilotClient

client = CopilotClient(
    base_url="http://localhost:4747",
    timeout_s=15.0,
    auth_token=os.environ.get("GITNEXUS_TOKEN"),  # optional - Sigma-COPILOT-SDK-AUTH-1
)

inv = client.mcp_inventory()
cluster = client.cluster_context(actions=["deploy", "scale"], limit=50)
forge = client.forge_context(concept="narrow-waist", depth=2)
```

## API surface

| Method | Endpoint | Notes |
|---|---|---|
| `mcp_inventory()` | `GET /copilot/mcp-inventory` | Returns MCP registry + gate verdict. |
| `blt_context(repo=, limit=)` | `GET /copilot/blt-context` | Belt Market BLT ledger slice. |
| `cluster_context(actions=, limit=)` | `GET /copilot/cluster-context` | Cluster ops audit chain. |
| `forge_context(concept=, depth=)` | `GET /copilot/forge-context` | Forge concept graph BFS. |

All response shapes are exported as `TypedDict`s from `gitnexus_copilot.types`.

## Run tests

```bash
cd mcp-server/sdk-py
pip install -e ".[dev]"
python -m pytest tests/ -v
```

The bundled `tests/test_client.py` exercises URL-construction with a fake
`requests.Session` - no live stack required.

## Authentication

The SDK supports the **Bearer scheme only** (Iron Rule
**Sigma-COPILOT-SDK-AUTH-1**, `Sigma-BEARER-AUTH-MANDATORY`). Pass an
`auth_token` and the SDK attaches `Authorization: Bearer <token>` to
every request :

```python
import os
from gitnexus_copilot import CopilotClient, CopilotAuthError

client = CopilotClient(
    base_url="https://gitnexus.example",
    auth_token=os.environ["GITNEXUS_TOKEN"],
)

try:
    inv = client.mcp_inventory()
except CopilotAuthError as err:
    # 401 = missing / expired bearer ; 403 = scope insufficient.
    # The SDK never retries - refresh the token here and call again.
    raise
```

- `CopilotAuthError` is a subclass of `CopilotHTTPError`, so existing
  `except CopilotHTTPError` blocks keep catching.
- Basic, Digest, and cookie auth are explicitly **out of scope**.
- Server-side enforcement of the bearer is scheduled for Tier 3.7.1+ ; in
  Phase B the token is forwarded transparently.

## Iron Rules (this SDK)

| Rule | Statement |
|---|---|
| **Sigma-COPILOT-SDK-1** | Types mirror server response shapes, never source-of-truth. |
| **Sigma-COPILOT-SDK-2** | Pure transport wrapper. Zero analytics, zero heuristics. |
| **Sigma-COPILOT-SDK-3** | No implicit retries. Errors surface to caller. |
| **Sigma-COPILOT-SDK-4** | Convenience helpers construct fresh clients per call. |
| **Sigma-COPILOT-SDK-AUTH-1** | `Sigma-BEARER-AUTH-MANDATORY` — only the Bearer scheme is supported. 401 / 403 surface as `CopilotAuthError`. |
| **Sigma-COPILOT-SDK-PUBLISH-1** | `Sigma-TAG-DRIVEN-CI-PUBLISH` — publish exclusively from CI on `sdk-py-v*` tags. Manual `twine upload` is a break-glass event. |

Cross-link Iron Rule COPILOT-1 (Tier 3.7 spec section 7) - *Tour est synthese pure,
jamais nouvelle analytique*. The SDK is also synthesis-pure at the transport
layer.

## License

MIT.
