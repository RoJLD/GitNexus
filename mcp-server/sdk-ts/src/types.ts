/**
 * Type definitions for the GitNexus Architect's Copilot AI REST surface.
 *
 * These interfaces mirror the response shapes produced by the four
 * `/copilot/*` endpoints implemented in `upstream/docker-server-copilot-*.mjs`.
 *
 * Iron Rule Sigma-COPILOT-SDK-1 : these types are **mirrors**, not source-of-truth.
 * Server-side response shapes are canonical. When the upstream shape changes,
 * bump the SDK minor version and re-mirror.
 */

// ---------------------------------------------------------------------------
// /copilot/mcp-inventory
// ---------------------------------------------------------------------------

export interface MCPToolDescriptor {
  /** Canonical MCP tool name, e.g. "gitnexus_entropy". */
  name: string;
  /** Endpoint slug, e.g. "entropy" (the bare key from REQUIRED_ENDPOINTS). */
  endpoint?: string;
  /** Whether this tool covers one of the 9 required Tier-3.7 endpoints. */
  required?: boolean;
}

export interface MCPInventoryResponse {
  /** Total MCP tools registered by the sidecar. */
  count: number;
  /** All tool descriptors known to the registry. */
  tools: MCPToolDescriptor[];
  /** The 9 logical endpoints required by Tier 3.7 (entropy, churn, ...). */
  requiredEndpoints: { endpoint: string; tool: string }[];
  /** Endpoint -> MCP tool name mapping, ready for direct lookup. */
  mapping: Record<string, string>;
  /** Gate verdict: "pass" if all required tools are present, else "fail". */
  gateVerdict: "pass" | "fail";
}

// ---------------------------------------------------------------------------
// /copilot/blt-context
// ---------------------------------------------------------------------------

export interface BLTTransaction {
  tx_id: string | null;
  tier: string;
  amount: number;
  status: string;
  ts: string | null;
}

export interface BLTContextResponse {
  /** Number of transactions returned (post-limit). */
  tx_count: number;
  /** Total BLT amount summed across `recent`. */
  total_blt: number;
  /** Per-tier breakdown of BLT amount. */
  tier_breakdown: Record<string, number>;
  /** Newest-first slice of recent transactions. */
  recent: BLTTransaction[];
  /** Backend mode: "live" / "absent" / "error" / "stub". */
  mode: "live" | "absent" | "error" | "stub";
  /** Count of malformed JSONL lines skipped during parse. */
  parseErrors: number;
  /** Absolute path to the ledger file consulted. */
  ledger: string;
  /** Canonical list of known belt tiers. */
  knownTiers?: string[];
  /** Optional error string (only populated when mode === "error"). */
  error?: string;
}

// ---------------------------------------------------------------------------
// /copilot/cluster-context
// ---------------------------------------------------------------------------

export interface ClusterEvent {
  seq: number | null;
  ts: string | null;
  actor: string | null;
  action: string | null;
  resource: string | null;
  namespace: string | null;
  post_action_status: string | null;
  this_hash: string | null;
}

export interface CorruptedSeq {
  seq: number | null;
  declared: string | null;
  expected: string | null;
  reason: string;
}

export interface ClusterContextResponse {
  /** Whether the entire hash chain validates (every prev_hash matches). */
  chain_valid: boolean;
  /** Total entries scanned (including filtered-out). */
  total_entries: number;
  /** Most recent `this_hash` observed (chain tip). */
  last_hash: string | null;
  /** Newest-first events matching the requested action filter. */
  recent: ClusterEvent[];
  /** List of seqs where the chain broke (with declared vs expected). */
  corrupted_seqs: CorruptedSeq[];
  /** Backend mode. */
  mode: "live" | "absent" | "error" | "stub";
  /** Absolute path to the audit ledger consulted. */
  ledger: string;
  /** Canonical list of known cluster ops actions. */
  knownActions?: string[];
}

// ---------------------------------------------------------------------------
// /copilot/forge-context
// ---------------------------------------------------------------------------

export interface ForgeNode {
  id: string;
  slug: string;
  type: string;
  name: string;
  origin: string | null;
  status: string | null;
}

export interface ForgeEdge {
  from: string;
  to: string;
  type: string;
}

export interface ForgeContextResponse {
  /** Backend mode used to satisfy the query. */
  mode: "http" | "jsonl" | "stub";
  /** Concept nodes within the requested neighborhood. */
  nodes: ForgeNode[];
  /** Edges connecting the nodes. */
  edges: ForgeEdge[];
  /** Total concepts known across all backends (not just the slice). */
  total_concepts: number;
  /** Which backend file/endpoint answered. */
  backend?: string;
  /** Original concept slug requested. */
  requestedConcept: string | null;
  /** Original BFS depth requested. */
  requestedDepth: number;
  /** Ledger / source path consulted. */
  ledger?: string;
  /** Optional concern message (populated when mode === "stub"). */
  concern?: string;
}

// ---------------------------------------------------------------------------
// Common client options
// ---------------------------------------------------------------------------

export interface CopilotClientOptions {
  /**
   * Base URL of the GitNexus deployment (e.g. "http://localhost:4747").
   * Defaults to "http://localhost:4747" if omitted.
   */
  baseUrl?: string;
  /**
   * Optional custom fetch implementation (useful for testing or for Node
   * versions < 18). Defaults to global `fetch`.
   */
  fetch?: typeof fetch;
  /**
   * Per-request timeout in milliseconds. Defaults to 30000 (30s).
   */
  timeoutMs?: number;
  /**
   * Optional headers merged into every request (e.g. for auth tokens).
   * NOTE: auth is not implemented in Tier 3.7 Phase B MVP (Task B6 future).
   */
  headers?: Record<string, string>;
}
