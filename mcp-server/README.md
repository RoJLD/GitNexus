# GitNexus analytics — MCP server

Stdio MCP server that exposes our **time-travel + cross-repo
analytics** as tools any MCP client can invoke. Sibling of the
upstream `npx gitnexus mcp` (which exposes the *graph* tools); this
one adds the analytics layer documented in
[../INVENTORY.md](../INVENTORY.md).

ROADMAP reference: **Tier 2bis.1 — MCP exposure des analytics
time-travel**.

## What it exposes

| Tool | Endpoint behind it |
|---|---|
| `gitnexus_list_repos` | `/api/repos` on the gitnexus API (port 4747) |
| `gitnexus_entropy` | `/entropy?repo=…` |
| `gitnexus_churn` | `/churn?repo=…` |
| `gitnexus_coupling` | `/coupling?repo=…` |
| `gitnexus_growth` | `/growth?repo=…` |
| `gitnexus_lifespan` | `/lifespan?repo=…` |
| `gitnexus_ownership` | `/ownership?repo=…` |
| `gitnexus_dissonance` | `/dissonance?repo=…` |
| `gitnexus_semantic_labels` | `/semantic-labels?repo=…` |
| `gitnexus_coupling_cross` | `/coupling/cross?repos=A,B,…` |
| `gitnexus_growth_cross` | `/growth/cross?repos=A,B,…` |
| `gitnexus_similarity` | `/similarity?repos=A,B,…` (cube 2×2×2 + galaxy XY) |

## Install (Claude Code)

Add this to `~/.claude.json` under `mcpServers` (or the equivalent
project-scoped `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "gitnexus-analytics": {
      "command": "node",
      "args": [
        "c:/Users/rdenis/VScode/gitnexus/mcp-server/server.mjs"
      ]
    }
  }
}
```

Restart Claude Code; the 12 tools above will show up in the model's
tool list. Try:

> "Use gitnexus to list my repos, then show me the entropy timeline
> of hmm_studio and tell me whether it's drifting."

## Install (Cursor / Windsurf / OpenCode)

Same shape — each client has its own MCP config location, but the
`command` + `args` shape is identical (stdio transport).

## Config (env vars)

| Var | Default | Purpose |
|---|---|---|
| `GITNEXUS_API` | `http://localhost:4747` | Upstream gitnexus API. Only `gitnexus_list_repos` hits it. |
| `GITNEXUS_WEB` | `http://localhost:4173` | Our deployment (`docker-compose.yml`). Every analytics tool hits it. |
| `GITNEXUS_TIMEOUT` | `30000` | Per-tool fetch timeout, milliseconds. |

If your stack runs on different ports, set these in the `env` field of
your MCP config:

```json
"gitnexus-analytics": {
  "command": "node",
  "args": ["c:/Users/rdenis/VScode/gitnexus/mcp-server/server.mjs"],
  "env": { "GITNEXUS_WEB": "http://localhost:8080" }
}
```

## Smoke test

The full pyramid is blocked on Node 22
([../docs/superpowers/decisions/2026-05-26-defer-node22-upgrade.md](../docs/superpowers/decisions/2026-05-26-defer-node22-upgrade.md)),
so this folder ships its own zero-dep smoke script:

```bash
# From this folder, with `docker compose up -d` running:
node smoke.mjs
```

What it checks:

1. `initialize` returns the right `protocolVersion` + `serverInfo`.
2. `tools/list` returns all 12 expected tools.
3. `tools/call gitnexus_list_repos` returns a list (asserts the
   API host is reachable).
4. `tools/call gitnexus_entropy` on the first listed repo returns
   `{ totalPoints, timeline, headline }`.
5. Unknown tool → `isError: true` content (per MCP convention).
6. Unknown JSON-RPC method → `-32601 method-not-found`.

Each check prints `PASS` or `FAIL`; non-zero exit code on first
failure. Stack must be up — see `../start.ps1`.

## Why a sidecar and not a patch into upstream

The upstream MCP server lives in `upstream/gitnexus/src/mcp/*.ts` and
ships pre-compiled in the gitnexus npm package. Adding tools there
means patching TypeScript files that change with every upstream bump
(`v1.6.3 → v1.6.5` already touched several MCP files). A standalone
sidecar in this folder, **outside** `upstream/`, survives bumps with
zero rebase work — it's just one more entry in the user's MCP config
alongside `npx gitnexus mcp`.

## Protocol details

- MCP version: **2024-11-05** (matches `@modelcontextprotocol/sdk@1.0.0`
  used by upstream gitnexus).
- Transport: **stdio**, JSON-RPC 2.0, line-delimited.
- No SSE / WebSocket / HTTP — the simplest transport every MCP client
  supports.
- Server-to-client logging goes to **stderr** (stdout is the protocol
  channel; one byte of stray output there breaks the connection).
- Tool errors come back as `isError: true` content blocks (MCP
  convention) rather than RPC errors, so the agent sees a human
  message and can adapt.

## What it does *not* do

- No subscriptions / streaming. Every tool is request/response.
- No `prompts` capability — we have no canned prompts to surface.
- No `resources` capability — analytics outputs are tool returns,
  not addressable resources.
- No upstream graph tools (search, cypher, grep, read, …) — those
  live in `npx gitnexus mcp` and we don't duplicate them.
