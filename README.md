# GitNexus — local deployment

[![tests](https://github.com/RoJLD/GitNexus/actions/workflows/test.yml/badge.svg?branch=deployment)](https://github.com/RoJLD/GitNexus/actions/workflows/test.yml)

Standalone Docker Compose setup for [GitNexus](https://github.com/abhigyanpatwari/gitnexus)
(graph code-intelligence MCP server), independent of any specific project.

The whole point: **one daemon that indexes any number of repos under
the host folder you set as `PROJECTS_ROOT`**, with a clickable launcher.

## Files

```
gitnexus/
├── Dockerfile.cli                  9-line derived image: upstream :1.6.3 + 2 patches
├── docker-compose.yml              services + globally-named volumes
├── .env.example                    template for per-machine config (copy to .env)
├── scripts/
│   └── install-duckdb-extension.mjs    48-line vendored script (missing from npm tarball)
├── start.bat                       desktop-clickable launcher (CMD, no PS policy issue)
├── start.ps1                       same logic, in PowerShell (richer error messages)
├── stop.bat / stop.ps1             graceful stop
├── reindex.ps1                     trigger a forced re-analysis of an existing repo
└── README.md                       this file
```

## First-time setup

1. Make sure **Rancher Desktop** is installed and running.
2. **Copy `.env.example` to `.env`** and edit `PROJECTS_ROOT` to point to the
   host folder containing the repos you want to be able to index. Forward
   slashes are recommended on Windows. Example:
   ```
   PROJECTS_ROOT=C:/Users/jdupont/Code
   ```
3. Open this folder in PowerShell or just double-click `start.bat`. It:
   - Verifies `.env` exists
   - Builds the derived image (~30s, only fetches upstream `:1.6.3` once)
   - Builds `gitnexus-web` from the local `upstream/` checkout
   - Starts both services
   - Opens [http://localhost:4173](http://localhost:4173) in your browser
4. (Optional) Right-click `start.bat` → **Send to** → **Desktop (create shortcut)**.
   Rename the desktop shortcut to "GitNexus". Double-click any time to wake the
   daemon and open the UI.

## Sharing this setup with a colleague

Zip the entire `gitnexus/` folder and send it. On the colleague's machine:
1. Install Rancher Desktop (or Docker Desktop) and start it.
2. Unzip somewhere convenient.
3. Copy `.env.example` → `.env` and set `PROJECTS_ROOT` to *their* code folder.
4. Double-click `start.bat`. The derived images are built locally on first run
   — no registry account needed.

The local `.env` is gitignored and per-machine; nothing else needs editing.

## Indexing a repo

The container has `C:\Users\rdenis\VScode\` mounted at `/data/projects/`.
So any project under that folder is reachable from inside gitnexus.

### From the UI ([http://localhost:4173](http://localhost:4173))

- **GitHub URL**: `RepoAnalyzer` → "GitHub URL" tab → paste `https://github.com/owner/repo`. The daemon clones into the `gitnexus-data` volume and analyzes.
- **Local folder**: `RepoAnalyzer` → "Local Folder" tab → type the path **as gitnexus sees it**, e.g. `/data/projects/<your-sub-path>`. The container will create `.gitnexus/` next to `.git/` in your source tree.

### From PowerShell

```powershell
.\reindex.ps1 /data/projects/<your-sub-path>
.\reindex.ps1 https://github.com/owner/repo
```

`reindex.ps1` always passes `force: true` — useful when the index is stale
(after a non-trivial code change) and you want a fresh analysis.

## Code Wiki

GitNexus can generate an auto-documentation **Code Wiki** from a repo's
knowledge graph. In this deployment it shows up as a **Wiki** panel in the web
UI (a "Wiki" button in the header), with a **Regenerate** button and optional
automatic regeneration.

Generation runs **server-side** (a small `wiki-worker` in the `gitnexus`
container spawns the `gitnexus wiki` CLI), so it needs an **LLM API key**. Set
it in a local `.env` (gitignored) next to `docker-compose.yml`:

```
GITNEXUS_API_KEY=sk-...
GITNEXUS_MODEL=gpt-4o-mini          # optional
GITNEXUS_LLM_BASE_URL=https://...   # optional (OpenAI-compatible endpoint)
```

The stack boots fine without a key — the Wiki panel just reports an error
until one is set. The repo must have been analyzed first (the wiki reads the
graph). To auto-regenerate on a schedule, add to that repo's `.gitnexus.json`:

```json
{ "wiki": { "autoEvery": "24h" } }
```

`autoEvery` accepts `"<n>h"` / `"<n>d"` or `"off"` (default). The existing
watches cron triggers due regenerations.

## Where things live

| What                               | Path                                                          |
|------------------------------------|---------------------------------------------------------------|
| Per-repo graph DB                  | `<repo>/.gitnexus/` (next to `.git/`, gitignore it per repo)  |
| Global registry of indexed repos   | Docker volume `gitnexus-data` → `/data/gitnexus/registry.json`|
| HuggingFace embedding model cache  | Docker volume `gitnexus-hf-cache`                             |
| API endpoint                       | http://localhost:4747/api/...                                 |
| MCP endpoint (for Claude Code)     | http://localhost:4747/api/mcp                                 |
| Web UI                             | http://localhost:4173                                         |

The two named volumes (`gitnexus-data`, `gitnexus-hf-cache`) are scoped
globally (no compose-project prefix), so they survive teardowns and rebuilds.

## Why a derived image (and not just the upstream one)

Upstream `ghcr.io/abhigyanpatwari/gitnexus:1.6.3` ships with two known bugs in
its `Dockerfile.cli`:

1. The runtime stage doesn't `mkdir -p /data/hf-cache` with `node:node`
   ownership, so embedding cache writes fail with `EACCES`.
2. The runtime stage skips `gitnexus/scripts/`, so
   `install-duckdb-extension.mjs` is missing — DuckDB FTS+VECTOR don't get
   installed and the analyzer persists 0 embeddings.

Our `Dockerfile.cli` is a 9-line layer on top of upstream that adds those two
fixes. The missing script is vendored verbatim from
[gitnexus@a418c47](https://github.com/abhigyanpatwari/gitnexus/blob/a418c47/gitnexus/scripts/install-duckdb-extension.mjs)
because the npm tarball at `gitnexus@1.6.3` doesn't include it.

When upstream ships these fixes, drop `Dockerfile.cli` + `scripts/` and switch
the compose to `image: ghcr.io/abhigyanpatwari/gitnexus:<new_tag>` directly.

## License

GitNexus is distributed under
[PolyForm-Noncommercial-1.0.0](https://github.com/abhigyanpatwari/gitnexus/blob/main/LICENSE).
The vendored `install-duckdb-extension.mjs` is redistributed under the same
terms. **Confirm with your legal/IT team** that this license is compatible
with your usage context (academic research is fine; commercial use of the
*outputs* may need clarification).

## Troubleshooting

| Symptom                                                      | Fix                                                      |
|--------------------------------------------------------------|----------------------------------------------------------|
| `start.bat` fails with "Docker is not reachable"             | Open Rancher Desktop, wait for the green status, retry   |
| `start.bat` says "container with name X already exists"      | Already handled (`docker rm -f` upfront), but if it leaks: `docker rm -f gitnexus gitnexus-web` |
| Container starts then exits                                  | `docker compose logs gitnexus` — usually a port conflict on :4747 |
| UI shows "0 indexed repos" after a re-deploy                 | Volumes were re-created; re-run analyze from the UI      |
| Embeddings count stays at 0 after analyze                    | Patch failed — `docker exec gitnexus ls /app/gitnexus/scripts/` should list `install-duckdb-extension.mjs` |
| Need to wipe everything                                      | `docker compose down -v` (also removes named volumes — destructive) |
