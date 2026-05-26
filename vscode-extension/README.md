# GitNexus (local) — VSCode extension

Adds a status-bar item showing the **bus factor** (or total commits) of
the file you're editing, fetched from your local gitnexus deployment.

This is the v0.1 MVP. See `../ROADMAP.md` (Tier 2.4) for the planned
direction — overlays, hover providers, MCP-driven impact analysis.

## Why local-only?

The extension talks to `http://localhost:4173` by default — the address
of the `gitnexus-web` container in this repo's `docker-compose.yml`.
There's no central server, no telemetry, no account; if your deployment
is up, the status bar lights up. If it's not, the bar shows a hint and
the rest of the editor is unaffected.

## Install (dev / unpacked)

1. Make sure the gitnexus stack is running:
   ```powershell
   cd ..  # back to the gitnexus folder
   .\start.ps1
   ```
2. Open this `vscode-extension/` folder in VSCode.
3. Run `npm install` once.
4. Hit **F5** — VSCode opens an "Extension Development Host" window
   with the extension active.
5. Open any file from a repo you've indexed in gitnexus. The status
   bar (right side, near the bottom) should show
   `⚠ GitNexus: BF 1` or similar.

## Settings

| Key | Default | Effect |
|---|---|---|
| `gitnexus.serverUrl` | `http://localhost:4173` | Base URL of the gitnexus-web deployment |
| `gitnexus.statusBarMetric` | `busFactor` | Which metric to surface in the status bar (`busFactor` \| `totalCommits`) |

## Commands

- **GitNexus: Refresh metrics for active file** — drops the in-memory
  cache and re-fetches `/ownership` for the active file's repo.
- **GitNexus: Open the web UI** — opens `gitnexus.serverUrl` in your
  default browser (also bound to clicking the status-bar item).

## How file → repo matching works

The server-side repo paths are container-local (`/data/projects/...`),
which doesn't match your editor's file paths. The extension walks the
ancestor folders of the active file from deepest to root and looks for
a folder whose **basename** matches a registered gitnexus repo name.
That works for the common case (`~/code/myapp` indexed as `myapp`); it
breaks if you renamed your folder or used the gitnexus `--name` flag
to register under a different name.

If the status bar shows `? GitNexus: no repo match`, either rename
the folder to match the registered repo name, or add a mapping section
to a future v0.2.

## Not done in v0.1 (deliberately)

- **Gutter / line-level decorations** — needs careful per-language
  setup; the status-bar anchor delivers most of the signal with 5%
  of the code.
- **Hover providers** — would need editor-symbol-to-graph-node
  mapping; punted to v0.2 once we know what people actually want.
- **MCP wiring** — the deployment already exposes MCP at
  `http://localhost:4747/api/mcp`. Claude Code et al. already talk to
  it; the editor extension wrapping MCP would duplicate that.

## Smoke test

```bash
# 1. Verify the deployment exposes the endpoints we depend on.
curl -fsS http://localhost:4173/api/repos | head -c 200
curl -fsS "http://localhost:4173/ownership?repo=<your-repo>" | head -c 200
# 2. Then load the extension and open any file in that repo.
```
