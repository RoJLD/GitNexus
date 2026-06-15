/**
 * GitNexus Architect's Copilot AI — TypeScript client.
 *
 * Tier 3.7 Phase B (SDK extraction) MVP scaffold. Wraps the four REST
 * endpoints exposed by `upstream/docker-server-copilot.mjs` and friends:
 *
 *   GET  /copilot/mcp-inventory
 *   GET  /copilot/blt-context?repo=&limit=
 *   GET  /copilot/cluster-context?actions=&limit=
 *   GET  /copilot/forge-context?concept=&depth=
 *
 * Iron Rule Sigma-COPILOT-SDK-2 : the SDK never adds analytics — it is a
 * pure transport wrapper. Any synthesis happens server-side (Iron Rule
 * COPILOT-1) or in the LLM agent layer (Phase A worker, future Phase B
 * polish).
 *
 * Iron Rule Sigma-COPILOT-SDK-3 : no implicit retries. Network errors
 * surface to the caller as rejected promises. Callers compose retry
 * policy externally (idempotent GETs make this safe).
 */

import type {
  BLTContextResponse,
  ClusterContextResponse,
  CopilotClientOptions,
  ForgeContextResponse,
  MCPInventoryResponse,
} from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:4747";
const DEFAULT_TIMEOUT_MS = 30000;

export interface BLTContextParams {
  /** Repo identifier to filter the ledger by (matches repoId/repo_id/repo). */
  repo?: string | null;
  /** Max transactions to return (server clamps to [1, 1000]). */
  limit?: number;
}

export interface ClusterContextParams {
  /** Comma-separated action names, e.g. "deploy,scale". Omit for all. */
  actions?: string | string[] | null;
  /** Max events to return. */
  limit?: number;
}

export interface ForgeContextParams {
  /** Concept slug to anchor the BFS at. */
  concept?: string | null;
  /** BFS depth (server clamps to [0, 5]). */
  depth?: number;
}

/**
 * Thin client over the GitNexus `/copilot/*` REST surface.
 *
 * Usage:
 *
 *   const client = new GitnexusCopilotClient({ baseUrl: "http://localhost:4747" });
 *   const inventory = await client.mcpInventory();
 *   if (inventory.gateVerdict !== "pass") throw new Error("MCP gate failed");
 */
export class GitnexusCopilotClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(options: CopilotClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.headers = { Accept: "application/json", ...(options.headers ?? {}) };

    if (typeof this.fetchImpl !== "function") {
      throw new Error(
        "GitnexusCopilotClient: no fetch implementation available. " +
          "Pass `options.fetch` or run on Node >= 18.",
      );
    }
  }

  /**
   * GET /copilot/mcp-inventory
   *
   * Returns the MCP tool registry and the Tier 3.7 inventory gate verdict.
   */
  async mcpInventory(): Promise<MCPInventoryResponse> {
    return this.requestJson<MCPInventoryResponse>("/copilot/mcp-inventory");
  }

  /**
   * GET /copilot/blt-context
   *
   * Belt Market BLT ledger slice, optionally filtered by repoId.
   */
  async bltContext(params: BLTContextParams = {}): Promise<BLTContextResponse> {
    const qs = new URLSearchParams();
    if (params.repo) qs.set("repo", params.repo);
    if (typeof params.limit === "number") qs.set("limit", String(params.limit));
    return this.requestJson<BLTContextResponse>(
      `/copilot/blt-context${qs.toString() ? `?${qs}` : ""}`,
    );
  }

  /**
   * GET /copilot/cluster-context
   *
   * Cluster ops audit hash chain slice, optionally filtered by actions.
   */
  async clusterContext(
    params: ClusterContextParams = {},
  ): Promise<ClusterContextResponse> {
    const qs = new URLSearchParams();
    const actions = Array.isArray(params.actions)
      ? params.actions.join(",")
      : params.actions;
    if (actions) qs.set("actions", actions);
    if (typeof params.limit === "number") qs.set("limit", String(params.limit));
    return this.requestJson<ClusterContextResponse>(
      `/copilot/cluster-context${qs.toString() ? `?${qs}` : ""}`,
    );
  }

  /**
   * GET /copilot/forge-context
   *
   * Forge concept graph BFS neighborhood around `concept`.
   */
  async forgeContext(
    params: ForgeContextParams = {},
  ): Promise<ForgeContextResponse> {
    const qs = new URLSearchParams();
    if (params.concept) qs.set("concept", params.concept);
    if (typeof params.depth === "number") qs.set("depth", String(params.depth));
    return this.requestJson<ForgeContextResponse>(
      `/copilot/forge-context${qs.toString() ? `?${qs}` : ""}`,
    );
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async requestJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: this.headers,
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await safeText(res);
        throw new CopilotHTTPError(
          `GitnexusCopilotClient: GET ${path} -> HTTP ${res.status}`,
          res.status,
          body,
        );
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Error thrown when the server returns a non-2xx response.
 * Carries the HTTP status and best-effort response body for diagnostics.
 */
export class CopilotHTTPError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "CopilotHTTPError";
    this.status = status;
    this.body = body;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
