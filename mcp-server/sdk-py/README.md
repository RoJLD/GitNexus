# gitnexus-copilot-sdk (Python)

Python client SDK for the **GitNexus Architect's Copilot AI** REST surface
(Tier 3.7 Phase A endpoints). Scaffolded 2026-06-15 - Phase B (SDK extraction).

> Status: **MVP scaffold**. Auth (Task B6), `gitnexus_tour` SSE streaming
> wrapper (Task B3), and PyPI publish (Task B7) are **REMAINING**.

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
from gitnexus_copilot import CopilotClient

client = CopilotClient(base_url="http://localhost:4747", timeout_s=15.0)

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

## Iron Rules (this SDK)

| Rule | Statement |
|---|---|
| **Sigma-COPILOT-SDK-1** | Types mirror server response shapes, never source-of-truth. |
| **Sigma-COPILOT-SDK-2** | Pure transport wrapper. Zero analytics, zero heuristics. |
| **Sigma-COPILOT-SDK-3** | No implicit retries. Errors surface to caller. |
| **Sigma-COPILOT-SDK-4** | Convenience helpers construct fresh clients per call. |

Cross-link Iron Rule COPILOT-1 (Tier 3.7 spec section 7) - *Tour est synthese pure,
jamais nouvelle analytique*. The SDK is also synthesis-pure at the transport
layer.

## License

MIT.
