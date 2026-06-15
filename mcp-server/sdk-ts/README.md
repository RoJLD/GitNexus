# @gitnexus/copilot-sdk

TypeScript client SDK for the **GitNexus Architect's Copilot AI** REST surface
(Tier 3.7 Phase A endpoints). Scaffolded 2026-06-15 - Phase B (SDK extraction).

> Status: **MVP scaffold**. Auth (Task B6), `gitnexus_tour` SSE streaming
> wrapper (Task B3), and npm publish (Task B7) are **REMAINING**. This package
> is currently consumed in-tree only.

## Why this SDK exists

The four `/copilot/*` endpoints (`mcp-inventory`, `blt-context`,
`cluster-context`, `forge-context`) are the **stable consumption surface**
the future tour-worker (Phase A Task A2) and any external agent (Claude
Code skills, Cursor, Windsurf, OpenCode) will call. Hand-rolling
`fetch + JSON.parse + types` in every consumer rots fast - this SDK
freezes the shapes.

Cross-link : Iron Rule **COPILOT-1** (synthesis pure) - the SDK is also a
synthesis-pure transport layer ; it adds no analytics, no caching, no
heuristics. See spec section 7.

## Install

```bash
# Currently in-tree only (no npm publish yet - Task B7 REMAINING).
# To use locally from another package in the GitNexus monorepo :
npm install ../mcp-server/sdk-ts
```

Once published (Phase B7):

```bash
npm install @gitnexus/copilot-sdk
```

## Usage

### One-shot convenience functions

```ts
import { mcpInventory, bltContext } from "@gitnexus/copilot-sdk";

const inventory = await mcpInventory({ baseUrl: "http://localhost:4747" });
if (inventory.gateVerdict !== "pass") {
  throw new Error("Tier 3.7 inventory gate FAILED - refusing to start tour");
}

const blt = await bltContext(
  { repo: "hmm_studio", limit: 20 },
  { baseUrl: "http://localhost:4747" },
);
console.log(`Recent BLT tx : ${blt.tx_count}, total : ${blt.total_blt}`);
```

### Shared client (recommended for long-running workers)

```ts
import { GitnexusCopilotClient } from "@gitnexus/copilot-sdk";

const client = new GitnexusCopilotClient({
  baseUrl: process.env.GITNEXUS_BASE_URL ?? "http://localhost:4747",
  timeoutMs: 15000,
});

const [inventory, cluster, forge] = await Promise.all([
  client.mcpInventory(),
  client.clusterContext({ actions: ["deploy", "scale"], limit: 50 }),
  client.forgeContext({ concept: "narrow-waist", depth: 2 }),
]);
```

## API surface

| Function / method | Endpoint | Notes |
|---|---|---|
| `mcpInventory()` | `GET /copilot/mcp-inventory` | Returns MCP registry + `gateVerdict`. |
| `bltContext({ repo?, limit? })` | `GET /copilot/blt-context` | Belt Market BLT ledger slice. |
| `clusterContext({ actions?, limit? })` | `GET /copilot/cluster-context` | Cluster ops audit hash chain. |
| `forgeContext({ concept?, depth? })` | `GET /copilot/forge-context` | Forge concept graph BFS. |

All shapes are exported from `@gitnexus/copilot-sdk/types` :
`MCPInventoryResponse`, `BLTContextResponse`, `ClusterContextResponse`,
`ForgeContextResponse`.

## Build

```bash
cd mcp-server/sdk-ts
npm install
npm run build       # tsc -> dist/
npm run typecheck   # tsc --noEmit (CI-friendly)
```

## Iron Rules (this SDK)

| Rule | Statement |
|---|---|
| **Sigma-COPILOT-SDK-1** | Types are mirrors of server response shapes, never source-of-truth. Bump minor on shape change. |
| **Sigma-COPILOT-SDK-2** | The SDK is a pure transport wrapper. Zero analytics, zero heuristics. |
| **Sigma-COPILOT-SDK-3** | No implicit retries. Errors surface to caller ; idempotent GETs make external retry safe. |
| **Sigma-COPILOT-SDK-4** | Convenience functions construct fresh clients per call - long-running consumers must instantiate `GitnexusCopilotClient` directly. |

Spec : [Tier 3.7 Architect's Copilot AI](../../docs/superpowers/specs/2026-06-14-Tier-3.7-Architect-Copilot-AI.md)
Plan : [Tier 3.7 Implementation Plan](../../docs/superpowers/plans/2026-06-14-Tier-3.7-Architect-Copilot-AI-plan.md)

## Remaining work (Phase B6 + B7)

- **B6 - Auth pattern** : header-based token (`Authorization: Bearer <token>`)
  surfaced via `options.headers`. Not enforced server-side in Phase A MVP.
- **B7 - Publish** : `npm publish --access public` once auth + a real
  changelog land.

## License

MIT - see workspace [LICENSE](../../LICENSE).
