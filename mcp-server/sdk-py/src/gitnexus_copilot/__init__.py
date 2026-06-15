"""
gitnexus_copilot - Python client SDK for the GitNexus Architect's Copilot
AI REST surface (Tier 3.7 Phase B SDK extraction MVP scaffold, 2026-06-15).

Wraps the four /copilot/* endpoints exposed by the GitNexus deployment:

    GET /copilot/mcp-inventory
    GET /copilot/blt-context?repo=&limit=
    GET /copilot/cluster-context?actions=&limit=
    GET /copilot/forge-context?concept=&depth=

Iron Rules:
    Sigma-COPILOT-SDK-1: types mirror server-side shapes, never source-of-truth.
    Sigma-COPILOT-SDK-2: pure transport wrapper, zero analytics.
    Sigma-COPILOT-SDK-3: no implicit retries; idempotent GETs make external
        retry policy composable.
    Sigma-COPILOT-SDK-4: convenience functions construct fresh clients per call.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Optional, Union

import requests

from .types import (
    BLTContextResponse,
    ClusterContextResponse,
    CopilotClientOptions,
    ForgeContextResponse,
    MCPInventoryResponse,
)

__all__ = [
    "CopilotClient",
    "CopilotClientOptions",
    "CopilotHTTPError",
    "CopilotAuthError",
    "mcp_inventory",
    "blt_context",
    "cluster_context",
    "forge_context",
    "BLTContextResponse",
    "ClusterContextResponse",
    "ForgeContextResponse",
    "MCPInventoryResponse",
]

__version__ = "0.1.0"


class CopilotHTTPError(Exception):
    """Raised when the GitNexus copilot endpoint returns a non-2xx response."""

    def __init__(self, message: str, status: int, body: str) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class CopilotAuthError(CopilotHTTPError):
    """
    Raised on HTTP 401 / 403 responses.

    Subclass of ``CopilotHTTPError`` so existing
    ``except CopilotHTTPError`` blocks keep working; callers wanting to
    refresh a bearer token can branch on ``except CopilotAuthError``.

    Iron Rule Sigma-COPILOT-SDK-AUTH-1 (Sigma-BEARER-AUTH-MANDATORY):
        401 = missing / expired bearer ; 403 = bearer valid but lacks scope.
        The SDK does NOT retry - token refresh is a caller-side concern.
    """


class CopilotClient:
    """
    Thin synchronous client over the GitNexus /copilot/* REST surface.

    Example:

        >>> client = CopilotClient(base_url="http://localhost:4747")
        >>> inv = client.mcp_inventory()
        >>> assert inv["gateVerdict"] == "pass"
    """

    def __init__(
        self,
        base_url: str = "http://localhost:4747",
        timeout_s: float = 30.0,
        headers: Optional[Dict[str, str]] = None,
        session: Optional[requests.Session] = None,
        auth_token: Optional[str] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.headers = {"Accept": "application/json", **(headers or {})}
        # Iron Rule Sigma-COPILOT-SDK-AUTH-1 (Sigma-BEARER-AUTH-MANDATORY) :
        # append the Bearer header LAST so it wins over any caller-supplied
        # `Authorization` value in `headers`.
        if isinstance(auth_token, str) and auth_token:
            self.headers["Authorization"] = f"Bearer {auth_token}"
        self.session = session or requests.Session()
        self.auth_token = auth_token

    # ------------------------------------------------------------------ API

    def mcp_inventory(self) -> MCPInventoryResponse:
        """GET /copilot/mcp-inventory - MCP registry + Tier 3.7 gate verdict."""
        return self._get_json("/copilot/mcp-inventory")  # type: ignore[return-value]

    def blt_context(
        self,
        repo: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> BLTContextResponse:
        """GET /copilot/blt-context - Belt Market BLT ledger slice."""
        params: Dict[str, Union[str, int]] = {}
        if repo:
            params["repo"] = repo
        if limit is not None:
            params["limit"] = int(limit)
        return self._get_json("/copilot/blt-context", params=params)  # type: ignore[return-value]

    def cluster_context(
        self,
        actions: Optional[Union[str, Iterable[str]]] = None,
        limit: Optional[int] = None,
    ) -> ClusterContextResponse:
        """GET /copilot/cluster-context - cluster ops audit hash chain slice."""
        params: Dict[str, Union[str, int]] = {}
        if actions:
            if isinstance(actions, str):
                params["actions"] = actions
            else:
                params["actions"] = ",".join(actions)
        if limit is not None:
            params["limit"] = int(limit)
        return self._get_json("/copilot/cluster-context", params=params)  # type: ignore[return-value]

    def forge_context(
        self,
        concept: Optional[str] = None,
        depth: Optional[int] = None,
    ) -> ForgeContextResponse:
        """GET /copilot/forge-context - forge concept graph BFS neighborhood."""
        params: Dict[str, Union[str, int]] = {}
        if concept:
            params["concept"] = concept
        if depth is not None:
            params["depth"] = int(depth)
        return self._get_json("/copilot/forge-context", params=params)  # type: ignore[return-value]

    # ------------------------------------------------------------ internals

    def _get_json(
        self,
        path: str,
        params: Optional[Dict[str, Union[str, int]]] = None,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        res = self.session.get(
            url,
            params=params or None,
            headers=self.headers,
            timeout=self.timeout_s,
        )
        if not res.ok:
            message = (
                f"GitnexusCopilotClient: GET {path} -> HTTP {res.status_code}"
            )
            body = res.text[:2000]
            # Iron Rule Sigma-COPILOT-SDK-AUTH-1 : surface 401/403 as a
            # distinct subclass so callers can refresh tokens without
            # parsing status codes by hand.
            if res.status_code in (401, 403):
                raise CopilotAuthError(message, status=res.status_code, body=body)
            raise CopilotHTTPError(message, status=res.status_code, body=body)
        return res.json()


# ----------------------------------------------------------- one-shot helpers


def _build_client(options: Optional[CopilotClientOptions]) -> CopilotClient:
    if options is None:
        return CopilotClient()
    return CopilotClient(
        base_url=options.base_url,
        timeout_s=options.timeout_s,
        headers=dict(options.headers),
        auth_token=options.auth_token,
    )


def mcp_inventory(
    options: Optional[CopilotClientOptions] = None,
) -> MCPInventoryResponse:
    return _build_client(options).mcp_inventory()


def blt_context(
    repo: Optional[str] = None,
    limit: Optional[int] = None,
    options: Optional[CopilotClientOptions] = None,
) -> BLTContextResponse:
    return _build_client(options).blt_context(repo=repo, limit=limit)


def cluster_context(
    actions: Optional[Union[str, Iterable[str]]] = None,
    limit: Optional[int] = None,
    options: Optional[CopilotClientOptions] = None,
) -> ClusterContextResponse:
    return _build_client(options).cluster_context(actions=actions, limit=limit)


def forge_context(
    concept: Optional[str] = None,
    depth: Optional[int] = None,
    options: Optional[CopilotClientOptions] = None,
) -> ForgeContextResponse:
    return _build_client(options).forge_context(concept=concept, depth=depth)
