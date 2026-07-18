"""
Tier 3.7 Phase B - SDK Python stub tests.

These tests exercise the CopilotClient URL-construction layer (no network
I/O) by injecting a fake requests.Session. A real integration test against
the live /copilot/* endpoints lives elsewhere (Phase C E2E suite).

Iron Rule Sigma-COPILOT-SDK-3 cross-link: we deliberately do NOT test retry
semantics - there are none. Network errors must surface to the caller.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List, Optional

import pytest

# Allow `python -m pytest tests/` from the package root without an install.
_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from gitnexus_copilot import CopilotClient, CopilotHTTPError  # noqa: E402


class _FakeResponse:
    def __init__(self, status_code: int, payload: Dict[str, Any]) -> None:
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self) -> Dict[str, Any]:
        return self._payload


class _RecordingSession:
    """Capture .get() calls so we can assert URL + params shape."""

    def __init__(self, response: _FakeResponse) -> None:
        self._response = response
        self.calls: List[Dict[str, Any]] = []

    def get(
        self,
        url: str,
        params: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> _FakeResponse:
        self.calls.append(
            {"url": url, "params": params, "headers": headers, "timeout": timeout}
        )
        return self._response


def test_mcp_inventory_url_shape() -> None:
    fake = _FakeResponse(
        200,
        {
            "count": 12,
            "tools": [],
            "requiredEndpoints": [],
            "mapping": {},
            "gateVerdict": "pass",
        },
    )
    session = _RecordingSession(fake)
    client = CopilotClient(base_url="http://example.test", session=session)  # type: ignore[arg-type]

    result = client.mcp_inventory()

    assert result["gateVerdict"] == "pass"
    assert session.calls[0]["url"] == "http://example.test/copilot/mcp-inventory"
    assert session.calls[0]["params"] is None


def test_blt_context_passes_repo_and_limit() -> None:
    fake = _FakeResponse(
        200,
        {
            "tx_count": 0,
            "total_blt": 0,
            "tier_breakdown": {},
            "recent": [],
            "mode": "absent",
            "parseErrors": 0,
            "ledger": "/tmp/x",
        },
    )
    session = _RecordingSession(fake)
    client = CopilotClient(base_url="http://example.test/", session=session)  # type: ignore[arg-type]

    client.blt_context(repo="hmm_studio", limit=42)

    assert session.calls[0]["url"] == "http://example.test/copilot/blt-context"
    assert session.calls[0]["params"] == {"repo": "hmm_studio", "limit": 42}


def test_cluster_context_joins_actions_iterable() -> None:
    fake = _FakeResponse(
        200,
        {
            "chain_valid": True,
            "total_entries": 0,
            "last_hash": None,
            "recent": [],
            "corrupted_seqs": [],
            "mode": "absent",
            "ledger": "/tmp/x",
        },
    )
    session = _RecordingSession(fake)
    client = CopilotClient(base_url="http://example.test", session=session)  # type: ignore[arg-type]

    client.cluster_context(actions=["deploy", "scale"], limit=10)

    assert session.calls[0]["params"] == {"actions": "deploy,scale", "limit": 10}


def test_forge_context_omits_unspecified_params() -> None:
    fake = _FakeResponse(
        200,
        {
            "mode": "stub",
            "nodes": [],
            "edges": [],
            "total_concepts": 0,
            "requestedConcept": None,
            "requestedDepth": 0,
        },
    )
    session = _RecordingSession(fake)
    client = CopilotClient(base_url="http://example.test", session=session)  # type: ignore[arg-type]

    client.forge_context()

    # No params passed at all -> session.get receives params=None
    assert session.calls[0]["params"] is None


def test_http_error_surfaces_status_and_body() -> None:
    fake = _FakeResponse(503, {"error": "LLM not configured"})
    session = _RecordingSession(fake)
    client = CopilotClient(base_url="http://example.test", session=session)  # type: ignore[arg-type]

    with pytest.raises(CopilotHTTPError) as excinfo:
        client.mcp_inventory()

    assert excinfo.value.status == 503
    assert "LLM not configured" in excinfo.value.body
