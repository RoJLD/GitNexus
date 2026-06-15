"""
Type definitions (dataclasses + TypedDicts) mirroring the GitNexus
Architect's Copilot AI REST response shapes.

Iron Rule Sigma-COPILOT-SDK-1 : these types are mirrors of the canonical
server-side shapes (`upstream/docker-server-copilot-*.mjs`). Bump the
minor version when the upstream shape changes.

NOTE : We use TypedDict (not @dataclass) for the public response types so
that consumers can treat the wire payload as-is without a deserialization
hop. Dataclasses are reserved for the SDK's internal options.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, TypedDict


# ---------------------------------------------------------------------------
# /copilot/mcp-inventory
# ---------------------------------------------------------------------------

class MCPToolDescriptor(TypedDict, total=False):
    name: str
    endpoint: str
    required: bool


class RequiredEndpoint(TypedDict):
    endpoint: str
    tool: str


class MCPInventoryResponse(TypedDict):
    count: int
    tools: List[MCPToolDescriptor]
    requiredEndpoints: List[RequiredEndpoint]
    mapping: Dict[str, str]
    gateVerdict: Literal["pass", "fail"]


# ---------------------------------------------------------------------------
# /copilot/blt-context
# ---------------------------------------------------------------------------

class BLTTransaction(TypedDict):
    tx_id: Optional[str]
    tier: str
    amount: float
    status: str
    ts: Optional[str]


class BLTContextResponse(TypedDict, total=False):
    tx_count: int
    total_blt: float
    tier_breakdown: Dict[str, float]
    recent: List[BLTTransaction]
    mode: Literal["live", "absent", "error", "stub"]
    parseErrors: int
    ledger: str
    knownTiers: List[str]
    error: str


# ---------------------------------------------------------------------------
# /copilot/cluster-context
# ---------------------------------------------------------------------------

class ClusterEvent(TypedDict):
    seq: Optional[int]
    ts: Optional[str]
    actor: Optional[str]
    action: Optional[str]
    resource: Optional[str]
    namespace: Optional[str]
    post_action_status: Optional[str]
    this_hash: Optional[str]


class CorruptedSeq(TypedDict):
    seq: Optional[int]
    declared: Optional[str]
    expected: Optional[str]
    reason: str


class ClusterContextResponse(TypedDict, total=False):
    chain_valid: bool
    total_entries: int
    last_hash: Optional[str]
    recent: List[ClusterEvent]
    corrupted_seqs: List[CorruptedSeq]
    mode: Literal["live", "absent", "error", "stub"]
    ledger: str
    knownActions: List[str]


# ---------------------------------------------------------------------------
# /copilot/forge-context
# ---------------------------------------------------------------------------

class ForgeNode(TypedDict):
    id: str
    slug: str
    type: str
    name: str
    origin: Optional[str]
    status: Optional[str]


class ForgeEdge(TypedDict):
    # NB : the wire payload uses the literal key "from". Python reserves the
    # word, so consumers reading the dict must access it as edge["from"] -
    # the SDK does NOT rename the key.
    to: str
    type: str


class ForgeContextResponse(TypedDict, total=False):
    mode: Literal["http", "jsonl", "stub"]
    nodes: List[ForgeNode]
    edges: List[Dict[str, Any]]  # wire shape preserves "from" key as-is
    total_concepts: int
    backend: str
    requestedConcept: Optional[str]
    requestedDepth: int
    ledger: str
    concern: str


# ---------------------------------------------------------------------------
# Internal SDK options (dataclass, not wire-shape)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CopilotClientOptions:
    """
    Construction options for ``CopilotClient``.

    ``auth_token`` (Iron Rule Sigma-COPILOT-SDK-AUTH-1, Sigma-BEARER-AUTH-MANDATORY):
        when set, the client attaches ``Authorization: Bearer <auth_token>`` to
        every request. Only the Bearer scheme is supported; Basic, Digest, and
        cookies are explicitly out of scope. Server-side enforcement is
        scheduled for Tier 3.7.1+; until then the token is forwarded
        transparently and 401/403 responses surface as ``CopilotAuthError``.
    """

    base_url: str = "http://localhost:4747"
    timeout_s: float = 30.0
    headers: Dict[str, str] = field(default_factory=dict)
    auth_token: Optional[str] = None
