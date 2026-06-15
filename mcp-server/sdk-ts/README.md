# @gitnexus/copilot-sdk

TypeScript client SDK for the **GitNexus Architect's Copilot AI** REST surface
(Tier 3.7 Phase A endpoints). Scaffolded 2026-06-15 - Phase B (SDK extraction).

> Status: **MVP scaffold + B'5 auth + B'6 publish-prep**. Bearer auth
> (Task B'5) and tag-driven npm publish CI (Task B'6) **SCAFFOLDED 2026-06-15**.
> `gitnexus_tour` SSE streaming wrapper (Task B3) remains open. The package
> is still consumed in-tree only until the first `sdk-ts-v*` tag is pushed.

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
  authToken: process.env.GITNEXUS_TOKEN, // optional - Sigma-COPILOT-SDK-AUTH-1
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

## Authentication

The SDK supports the **Bearer scheme only** (Iron Rule
**Sigma-COPILOT-SDK-AUTH-1**, `Sigma-BEARER-AUTH-MANDATORY`). Pass an
`authToken` on the client options and the SDK attaches
`Authorization: Bearer <token>` to every request :

```ts
import { GitnexusCopilotClient, CopilotAuthError } from "@gitnexus/copilot-sdk";

const client = new GitnexusCopilotClient({
  baseUrl: "https://gitnexus.example",
  authToken: process.env.GITNEXUS_TOKEN,
});

try {
  const inventory = await client.mcpInventory();
} catch (err) {
  if (err instanceof CopilotAuthError) {
    // 401 = missing / expired bearer ; 403 = scope insufficient.
    // The SDK never retries - refresh the token here and call again.
    throw err;
  }
  throw err;
}
```

- `CopilotAuthError` subclasses `CopilotHTTPError`, so existing
  `catch (CopilotHTTPError)` blocks keep working.
- Basic, Digest, and cookie auth are explicitly **out of scope**.
- Server-side enforcement of the bearer is scheduled for Tier 3.7.1+ ; in
  Phase B the token is forwarded transparently.

## Iron Rules (this SDK)

| Rule | Statement |
|---|---|
| **Sigma-COPILOT-SDK-1** | Types are mirrors of server response shapes, never source-of-truth. Bump minor on shape change. |
| **Sigma-COPILOT-SDK-2** | The SDK is a pure transport wrapper. Zero analytics, zero heuristics. |
| **Sigma-COPILOT-SDK-3** | No implicit retries. Errors surface to caller ; idempotent GETs make external retry safe. |
| **Sigma-COPILOT-SDK-4** | Convenience functions construct fresh clients per call - long-running consumers must instantiate `GitnexusCopilotClient` directly. |
| **Sigma-COPILOT-SDK-AUTH-1** | `Sigma-BEARER-AUTH-MANDATORY` — only the Bearer scheme is supported. Basic / Digest / cookies are explicitly out of scope. 401 / 403 surface as `CopilotAuthError`. |
| **Sigma-COPILOT-SDK-PUBLISH-1** | `Sigma-TAG-DRIVEN-CI-PUBLISH` — publish exclusively from CI on `sdk-ts-v*` tags. Manual `npm publish` is a break-glass event. |

Spec : [Tier 3.7 Architect's Copilot AI](../../docs/superpowers/specs/2026-06-14-Tier-3.7-Architect-Copilot-AI.md)
Plan : [Tier 3.7 Implementation Plan](../../docs/superpowers/plans/2026-06-14-Tier-3.7-Architect-Copilot-AI-plan.md)

## Remaining work

- **B'5 Auth pattern** — DONE 2026-06-15 (Bearer + `CopilotAuthError`).
- **B'6 Publish prep** — DONE 2026-06-15 (CI workflow + `CHANGELOG.md` +
  `PUBLISH.md`). First real publish gated on Architecte sign-off.
- **B3 - `gitnexus_tour` SSE wrapper** : streaming tour transcript. Still
  open ; depends on tour-worker shape stabilisation.

## License

MIT - see workspace [LICENSE](../../LICENSE).
