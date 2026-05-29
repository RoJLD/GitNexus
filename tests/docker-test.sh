#!/usr/bin/env bash
# Run the deployment test suite under Node 22 in Docker.
#
# Why: the host may run Node < 22 (e.g. 21.7.x), which vitest 4 / vite 8 /
# rolldown reject (they require ^20.19 || >=22.12). A throwaway node:22
# container runs the suite without touching the host Node, and a *named*
# volume for node_modules keeps the host's (win32) node_modules untouched
# while caching the container's (linux) install across runs.
#
# Usage:
#   bash tests/docker-test.sh                 # unit + component tier (default)
#   bash tests/docker-test.sh unit <args>     # pass extra args to vitest (e.g. a file filter)
#   bash tests/docker-test.sh integ           # integration tier — SEE CAVEAT below
#
# CAVEAT (integ): the integration tier's globalSetup runs `docker compose` to
# spin up a test stack. Running it from inside this container needs docker-in-
# docker (host socket + path parity) — fragile on Docker Desktop/Windows. The
# integration tier is meant to run on a Node-22 *host* (`cd tests && npm run
# test:integ`). This script's integ mode is best-effort and may not work until
# the host is on Node 22.
set -euo pipefail

TIER="${1:-unit}"
shift 2>/dev/null || true

case "$TIER" in
  unit)  CFG="vitest.config.unit.mjs" ;;
  integ) CFG="vitest.config.integ.mjs" ;;
  *) echo "usage: bash tests/docker-test.sh [unit|integ] [vitest args...]" >&2; exit 2 ;;
esac

# Repo root as a Windows-style path so Docker Desktop accepts the bind mount.
# `pwd -W` is Git-Bash-specific (this deployment is Windows-targeted).
REPO_WIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -W 2>/dev/null || pwd)"

# The component/hook tests that import the real useAppState pull gitnexus-web's
# full dep tree (langchain/anthropic/mermaid/sigma). Install those too for the
# unit tier (cached in a named volume → only the first run is heavy). Skipped
# for integ (node-env, no components).
WEB_INSTALL=""
if [ "$TIER" = "unit" ]; then
  WEB_INSTALL="echo '=== installing gitnexus-web deps (first run is heavy, cached after) ==='; npm install --prefix /work/upstream/gitnexus-web --no-audit --no-fund --legacy-peer-deps >/tmp/web.log 2>&1 || { echo 'gitnexus-web install failed:'; tail -25 /tmp/web.log; exit 1; };"
fi

MSYS_NO_PATHCONV=1 docker run --rm \
  -v "${REPO_WIN}:/work" \
  -v "gnx-test-nm:/work/tests/node_modules" \
  -v "gnx-web-nm:/work/upstream/gitnexus-web/node_modules" \
  -w "/work/tests" \
  node:22-bookworm-slim \
  bash -lc "npm install --no-package-lock --no-audit --no-fund >/tmp/npm.log 2>&1 || { echo 'tests npm install failed:'; tail -25 /tmp/npm.log; exit 1; }; ${WEB_INSTALL} npx vitest run --config ${CFG} $*"
