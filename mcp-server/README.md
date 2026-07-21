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

(The table above is the original Tier 2bis.1 batch; the registry has grown
since — `tools/list` is the authoritative list.)

### ELYSIUM governance lenses (`INTER_GRAPH_URL`)

Three tools proxy the Σ-BRAIN-GRAPH-GATEWAY, one per surface of the
`/lens` contract. All three degrade to a documented stub — never a
crash, never fabricated data — when `INTER_GRAPH_URL` is unset.

| Tool | Endpoint behind it | Use it when |
|---|---|---|
| `gitnexus_list_lenses` | `/lens` | You need to discover which lenses exist. |
| `gitnexus_get_lens_graph` | `/lens/<name>` | You need to **traverse** nodes and relationships. |
| `gitnexus_narrate_lens` | `/lens/<name>/narrate` | You need to **read** what the lens says. |

`narrate` is the cheap surface, and the gap is not marginal: on the
`sigil` lens the agent receives ~43 kB where the graph delivers ~1.7 MB —
**~40× less** for a "what should I watch" question. Reach for the graph
only when you actually intend to walk it.

> Both figures are **UTF-8 bytes of the MCP text block as actually
> delivered** — i.e. what the agent's context pays — measured 2026-07-21
> via `node smoke.mjs --live-gateway` (1474-node `sigil` lens). They
> drift as the lens content changes; the smoke asserts the *direction*
> (narration < graph), not the constant.
>
> Two earlier revisions of this line were wrong, both by mixing bases.
> The first published JS string lengths (UTF-16 code units) under a byte
> label. The second fixed the unit but still compared the raw markdown
> against a *compact re-serialisation* of the graph — neither side being
> what either tool hands back. Three defensible bases exist for this
> lens (wire bytes 32.7×, compact JSON 30.3×, as-delivered 40.1×); only
> the last one describes a transaction anybody actually makes.

### Why `gitnexus_narrate_lens` has no `synthesis` option

The gateway route accepts `?synthesis=1`, which appends an LLM-written
"Synthèse" paragraph. That option is **deliberately not exposed as an MCP
parameter**, on three measurements — re-measure them before restoring it:

1. **It is not a paid Claude call.** `_narration_synthesis()` requests
   `tier="claude-sonnet"`, but ELYSIUM's budget-aware router (SIGIL-529)
   resolves the tier, and with no `ANTHROPIC_API_KEY` configured the call
   lands on a local model. The ledger line written by a real synthesis run
   on 2026-07-21: `model=ollama/deepseek-r1:8b`, `tier=local-fast`,
   `cost_eur=0.0`. Earlier revisions of this file announced "COSTS ONE
   PAID MODEL CALL (claude-sonnet tier)" — wrong on both counts.
2. **No timeout cap is defensible.** Four samples of the same request:
   31.3 s, 42.5 s, 43.8 s, 47.1 s, plus one that ran past 120 s and was
   aborted. That is local-ollama latency — workstation scheduling,
   variable by nature. A cap either trips on an ordinary run or is not a
   cap. The "~4× the measurement" margin a previous revision shipped sat
   *inside* the spread.
3. **The yield does not justify the wait, and it is erratic.** The same
   request on the `sigil` lens returned 45, 450, 474 and 31 extra bytes
   across four runs — a 15× spread on the payload. What was stable is the
   failure: **all four were truncated mid-sentence** ("Pour prioriser la
   surveillance", "Pour assurer une", …). The local model is a reasoning
   model; its reasoning tokens exhaust the 400-token budget before the
   answer completes.

   > An earlier revision of this file published "42.5 s bought 45 bytes"
   > as *the* yield. That was a single draw near the floor of a
   > distribution point 2 above says one sample cannot characterise — it
   > understated the typical yield by ~10×. The decision survives the
   > correction (every sample is slow *and* truncated); the figure did not.

Blocking an agent for tens of seconds and then handing it a fragment is
worse than not offering the option. A human at a browser, who can wait
and can judge the output, still has `GET /lens/<name>/narrate?synthesis=1`.

Sending `synthesis: true` to the tool anyway is harmless: nothing on this
server validates `inputSchema`, so the extra property is ignored and you
get the ordinary narration. The smoke asserts the parameter never reaches
the gateway.

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

Restart Claude Code; the tools above (<!-- COUNTER:mcp-tools -->37<!-- /COUNTER --> in
total) will show up in the model's tool list. Try:

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
| `GITNEXUS_TIMEOUT` | `30000` | Per-tool fetch timeout, milliseconds. Applies to every route — there is no second budget. |
| `INTER_GRAPH_URL` | *(unset)* | Σ-BRAIN-GRAPH-GATEWAY base URL, e.g. `http://127.0.0.1:4750`. **Five tools hit it** (see below); unset → the three lens tools return a documented stub and the other two fall back. |

### Which tools actually use `INTER_GRAPH_URL`

Enumerated empirically (fake gateway on a loopback port recording every inbound
URL, all <!-- COUNTER:mcp-tools -->37<!-- /COUNTER --> tools invoked) — **not** by
reading the source, because an earlier revision of this table claimed "only the
three lens tools" and was wrong by two:

| tool | route |
|---|---|
| `query_meta_graph` | `/inter-graph?layer=…` |
| `gitnexus_list_lenses` | `/lens` |
| `gitnexus_get_lens_graph` | `/lens/<name>` |
| `gitnexus_narrate_lens` | `/lens/<name>/narrate` |
| `gitnexus_copilot_forge_context` | `/inter-graph/concept?concept=…&depth=…` |

Unsetting `INTER_GRAPH_URL` degrades **all five**, not three. The three lens tools
degrade loudly (documented stub with a `concern`); `query_meta_graph` and
`gitnexus_copilot_forge_context` fall back to a secondary path or a stub mode, so
their degradation is quieter — check their `stub` / `mode` field.

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
2. `tools/list` returns the expected tool count (<!-- COUNTER:mcp-tools -->37<!-- /COUNTER -->) and every
   name the smoke pins by hand.
3. `tools/call gitnexus_list_repos` returns a list (asserts the
   API host is reachable).
4. `tools/call gitnexus_entropy` on the first listed repo returns
   `{ totalPoints, timeline, headline }`.
5. Unknown tool → `isError: true` content (per MCP convention).
6. Unknown JSON-RPC method → `-32601 method-not-found`.
7. `gitnexus_narrate_lens` — env-aware but falsifiable either way:
   without `INTER_GRAPH_URL` it must return the documented stub with
   `markdown: null`; with it, real markdown carrying the lens heading and
   **no** `synthesis` field. Against a live gateway it also asserts an
   unknown lens name **errors** rather than returning an empty brief.
8. The gateway-backed tools against a **fake gateway** the smoke starts
   itself on a loopback port. This runs unconditionally — no stack, no
   gateway, no model call — and pins the things the live checks cannot:
   - no `synthesis` parameter reaches the gateway, whether or not a
     client sends one, and a client that sends `synthesis: true` anyway
     still gets a normal narration rather than an error;
   - the markdown comes back **byte-for-byte whole** (a fixture with a
     tail sentinel, so any truncation is visible);
   - `bytes` / `chars` are **derived from the content**, not constants —
     the fixture is deliberately non-ASCII so the two diverge and the
     *unit* is pinned, not just the value;
   - a non-`text/markdown` response makes the contract-drift guard
     **fail loud** instead of handing the agent an unreadable shape;
   - **all four** gateway routes (`/lens`, `/lens/<name>`,
     `/lens/<name>/narrate`, `/inter-graph`) name the **gateway** on
     failure — not `docker compose up -d`. Proved by shrinking the fetch
     budget rather than waiting one out, so the check costs ~600 ms. The
     four are asserted individually because dropping the remedy on any
     one of them was previously invisible; note `query_meta_graph`
     carries its message in a stub `concern` rather than an `isError`.

   Every one of these was written against a mutation that previously
   survived both smoke modes.

Each check prints `PASS` or `FAIL`; non-zero exit code on first
failure. Checks 3–4 need the stack up (see `../start.ps1`); check 8
needs nothing.

With a live Σ-BRAIN-GRAPH-GATEWAY you can run the opt-in lens section,
which asserts the narration is measurably cheaper than the graph:

```bash
INTER_GRAPH_URL=http://127.0.0.1:4750 node smoke.mjs --live-gateway
```

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
