"""
Tier 3.7 Phase B'5 - Bearer auth unit tests for the Python SDK.

Iron Rule Sigma-COPILOT-SDK-AUTH-1 (Sigma-BEARER-AUTH-MANDATORY):
    when auth_token is set, every request carries
    `Authorization: Bearer <auth_token>`. 401/403 surfaces as
    `CopilotAuthError` (subclass of `CopilotHTTPError`).
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

from gitnexus_copilot import (  # noqa: E402
    CopilotAuthError,
    CopilotClient,
    CopilotClientOptions,
    CopilotHTTPError,
)


class _FakeResponse:
    def __init__(self, status_code: int, payload: Dict[str, Any]) -> None:
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self) -> Dict[str, Any]:
        return self._payload


class _RecordingSession:
    """Capture .get() calls so we can assert URL + headers shape."""

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


def _ok_inventory_payload() -> Dict[str, Any]:
    return {
        "count": 0,
        "tools": [],
        "requiredEndpoints": [],
        "mapping": {},
        "gateVerdict": "pass",
    }


def test_auth_token_attaches_bearer_header() -> None:
    fake = _FakeResponse(200, _ok_inventory_payload())
    session = _RecordingSession(fake)
    client = CopilotClient(
        base_url="http://example.test",
        session=session,  # type: ignore[arg-type]
        auth_token="sk-test-abc123",
    )

    client.mcp_inventory()

    headers = session.calls[0]["headers"]
    assert headers["Authorization"] == "Bearer sk-test-abc123"
    assert headers["Accept"] == "application/json"


def test_no_auth_token_means_no_authorization_header() -> None:
    fake = _FakeResponse(200, _ok_inventory_payload())
    session = _RecordingSession(fake)
    client = CopilotClient(
        base_url="http://example.test",
        session=session,  # type: ignore[arg-type]
    )

    client.mcp_inventory()

    headers = session.calls[0]["headers"]
    assert "Authorization" not in headers


def test_401_response_raises_copilot_auth_error() -> None:
    fake = _FakeResponse(401, {"error": "invalid token"})
    session = _RecordingSession(fake)
    client = CopilotClient(
        base_url="http://example.test",
        session=session,  # type: ignore[arg-type]
        auth_token="sk-expired",
    )

    with pytest.raises(CopilotAuthError) as excinfo:
        client.mcp_inventory()

    # Sigma-COPILOT-SDK-AUTH-1 : subclass relation must hold so existing
    # `except CopilotHTTPError` blocks keep catching.
    assert isinstance(excinfo.value, CopilotHTTPError)
    assert excinfo.value.status == 401
    assert "invalid token" in excinfo.value.body


def test_403_response_also_raises_copilot_auth_error() -> None:
    fake = _FakeResponse(403, {"error": "scope missing"})
    session = _RecordingSession(fake)
    client = CopilotClient(
        base_url="http://example.test",
        session=session,  # type: ignore[arg-type]
        auth_token="sk-low-scope",
    )

    with pytest.raises(CopilotAuthError) as excinfo:
        client.mcp_inventory()

    assert excinfo.value.status == 403


def test_auth_token_wins_over_manual_authorization_header() -> None:
    fake = _FakeResponse(200, _ok_inventory_payload())
    session = _RecordingSession(fake)
    client = CopilotClient(
        base_url="http://example.test",
        session=session,  # type: ignore[arg-type]
        headers={"Authorization": "Bearer sk-stale"},
        auth_token="sk-canonical",
    )

    client.mcp_inventory()

    headers = session.calls[0]["headers"]
    assert headers["Authorization"] == "Bearer sk-canonical"


def test_options_dataclass_propagates_auth_token() -> None:
    """`CopilotClientOptions(auth_token=...)` reaches the client via helpers."""
    fake = _FakeResponse(200, _ok_inventory_payload())
    session = _RecordingSession(fake)

    # Build directly through the dataclass constructor used by _build_client.
    opts = CopilotClientOptions(
        base_url="http://example.test",
        auth_token="sk-options-route",
    )
    client = CopilotClient(
        base_url=opts.base_url,
        timeout_s=opts.timeout_s,
        headers=dict(opts.headers),
        auth_token=opts.auth_token,
        session=session,  # type: ignore[arg-type]
    )

    client.mcp_inventory()
    assert (
        session.calls[0]["headers"]["Authorization"] == "Bearer sk-options-route"
    )
