/**
 * @gitnexus/copilot-sdk — public entry point.
 *
 * Tier 3.7 Phase B SDK extraction (MVP scaffold, 2026-06-15).
 *
 * Exposes four convenience functions (zero-construction call sites) and
 * the `GitnexusCopilotClient` class for callers that want to share a
 * configured client across calls.
 *
 * Iron Rule Sigma-COPILOT-SDK-4 : the convenience wrappers MUST NOT cache
 * client instances across calls — they construct a fresh client per call.
 * This keeps the API stateless and safe to compose with custom baseUrls
 * provided ad-hoc. Long-running consumers should instantiate
 * `GitnexusCopilotClient` directly to amortize the constructor cost.
 */

import {
  GitnexusCopilotClient,
  type BLTContextParams,
  type ClusterContextParams,
  type ForgeContextParams,
} from "./client.js";
import type {
  BLTContextResponse,
  ClusterContextResponse,
  CopilotClientOptions,
  ForgeContextResponse,
  MCPInventoryResponse,
} from "./types.js";

export * from "./types.js";
export {
  GitnexusCopilotClient,
  CopilotHTTPError,
  CopilotAuthError,
  type BLTContextParams,
  type ClusterContextParams,
  type ForgeContextParams,
} from "./client.js";

/**
 * One-shot wrapper around `client.mcpInventory()`.
 */
export async function mcpInventory(
  options: CopilotClientOptions = {},
): Promise<MCPInventoryResponse> {
  return new GitnexusCopilotClient(options).mcpInventory();
}

/**
 * One-shot wrapper around `client.bltContext()`.
 */
export async function bltContext(
  params: BLTContextParams = {},
  options: CopilotClientOptions = {},
): Promise<BLTContextResponse> {
  return new GitnexusCopilotClient(options).bltContext(params);
}

/**
 * One-shot wrapper around `client.clusterContext()`.
 */
export async function clusterContext(
  params: ClusterContextParams = {},
  options: CopilotClientOptions = {},
): Promise<ClusterContextResponse> {
  return new GitnexusCopilotClient(options).clusterContext(params);
}

/**
 * One-shot wrapper around `client.forgeContext()`.
 */
export async function forgeContext(
  params: ForgeContextParams = {},
  options: CopilotClientOptions = {},
): Promise<ForgeContextResponse> {
  return new GitnexusCopilotClient(options).forgeContext(params);
}
