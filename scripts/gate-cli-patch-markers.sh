#!/bin/sh
# Σ-GATE-BORN-DEAD — the CLI package's fork patches must be PRESENT, twice over.
#
# WHY THIS FILE EXISTS
# --------------------
# Until 2026-08-20 the CLI image was built as `FROM ghcr.io/abhigyanpatwari/
# gitnexus:<tag>` + three dist/ rewrites. The four CLI hunks of
# patches/inplace-edits.diff (trusted-write-origins CSRF allow-list, PR #11;
# wiki anti-prompt-injection frame, P0-5) were applied by
# scripts/apply-upstream-patches.mjs — which ONLY .github/workflows/test.yml
# ever called. No image build ever ran it. The patches were compiled by CI,
# then thrown away; measured absent from 1.6.9-elysium AND from the running
# 1.6.5 production pod. Guards written, committed, merged — never deployed.
#
# Dockerfile.cli now compiles the PATCHED sources itself (multi-stage). This
# script is the post-condition that makes a repeat impossible: a born-dead
# build fails instead of shipping green.
#
# ONE TEXT, TWO READERS (Σ-DEUX-SOURCES)
# --------------------------------------
# The marker list lives here and NOWHERE else. Both readers call this file:
#   * gitops/jobs/image-ci/build-gitnexus-1.6.9-elysium-v2.yaml (ELYSIUM) runs
#     `src` mode in its initContainer, BEFORE Kaniko starts — a bad tree costs
#     seconds, not a full build;
#   * Dockerfile.cli runs `src` mode in the builder stage (covers `docker
#     compose build` / CI, which have no initContainer) and `dist` mode as the
#     LAST instruction of the runtime stage — the only assertion that speaks
#     about the artifact actually pushed.
#
# USAGE
#   sh scripts/gate-cli-patch-markers.sh src  <monorepo-root>   # <root>/gitnexus/src/**.ts
#   sh scripts/gate-cli-patch-markers.sh dist <app-root>        # <root>/gitnexus/dist/**.js
#
# Exit 0 = every marker present. Exit 1 = at least one missing (or bad usage).

set -u

MODE="${1:-}"
ROOT="${2:-}"

if [ -z "$MODE" ] || [ -z "$ROOT" ]; then
  echo "usage: sh $0 <src|dist> <root>" >&2
  exit 1
fi

RC=0

# has <label> <file> <fixed-string>
has() {
  if [ ! -f "$2" ]; then
    echo "[gate] ABSENT FILE  $2  ($1)" >&2
    RC=1
    return 0
  fi
  if grep -q -F -- "$3" "$2"; then
    echo "[gate] ok     $1"
  else
    echo "[gate] MISSING $1  — '$3' not found in $2" >&2
    RC=1
  fi
  return 0
}

# has_re <label> <file> <ere>
has_re() {
  if [ ! -f "$2" ]; then
    echo "[gate] ABSENT FILE  $2  ($1)" >&2
    RC=1
    return 0
  fi
  if grep -q -E -- "$3" "$2"; then
    echo "[gate] ok     $1"
  else
    echo "[gate] MISSING $1  — /$3/ not found in $2" >&2
    RC=1
  fi
  return 0
}

case "$MODE" in
  src)
    echo "[gate] mode=src  root=$ROOT  (patched TypeScript, pre-compile)"
    MW="$ROOT/gitnexus/src/server/middleware.ts"
    API="$ROOT/gitnexus/src/server/api.ts"
    PR="$ROOT/gitnexus/src/core/wiki/prompts.ts"
    GEN="$ROOT/gitnexus/src/core/wiki/generator.ts"

    # PR #11 — trusted write-origins allow-list (the only thing that makes the
    # browser write routes usable behind gitnexus-gateway: CMD binds 0.0.0.0,
    # so normalizeBoundHost() is undefined and ONLY loopback origins pass).
    has    "src/middleware: TRUSTED_WRITE_ORIGINS env"   "$MW"  "TRUSTED_WRITE_ORIGINS"
    has    "src/middleware: fail-closed parser"          "$MW"  "parseTrustedWriteOrigins"
    has    "src/middleware: guard 2nd parameter"         "$MW"  "trustedWriteOrigins?: ReadonlySet<string>"
    has    "src/api:        parser wired in createServer" "$API" "parseTrustedWriteOrigins"
    has_re "src/api:        guard called with 2 args"    "$API" "createLocalhostOriginGuard\([^)]+,"

    # P0-5 — wiki anti-prompt-injection frame at the single invokeLLM choke
    # point (repo content reaches claude/codex/opencode providers with
    # cwd=repoPath: injection would be execution).
    has    "src/prompts:    ANTI_INJECTION_DIRECTIVE"    "$PR"  "ANTI_INJECTION_DIRECTIVE"
    has    "src/prompts:    UNTRUSTED INPUT frame"       "$PR"  "UNTRUSTED INPUT"
    has    "src/prompts:    appendAntiInjectionFrame"    "$PR"  "appendAntiInjectionFrame"
    has    "src/generator:  frame imported"              "$GEN" "appendAntiInjectionFrame"
    has    "src/generator:  framedSystem passed on"      "$GEN" "framedSystem"
    ;;

  dist)
    echo "[gate] mode=dist root=$ROOT  (compiled JS actually shipped)"
    MW="$ROOT/gitnexus/dist/server/middleware.js"
    API="$ROOT/gitnexus/dist/server/api.js"
    PR="$ROOT/gitnexus/dist/core/wiki/prompts.js"
    GEN="$ROOT/gitnexus/dist/core/wiki/generator.js"
    LBUG="$ROOT/gitnexus/dist/core/lbug/lbug-adapter.js"
    RUNAN="$ROOT/gitnexus/dist/core/run-analyze.js"
    WIKIW="$ROOT/wiki-worker.mjs"

    has    "dist/middleware: TRUSTED_WRITE_ORIGINS env"  "$MW"  "TRUSTED_WRITE_ORIGINS"
    has    "dist/middleware: fail-closed parser"         "$MW"  "parseTrustedWriteOrigins"
    # THE measurement that exposed the defect: the shipped guard had ONE
    # parameter (bare upstream). Two = our patch is in the artifact.
    has_re "dist/middleware: guard has 2 parameters"     "$MW"  "function createLocalhostOriginGuard\(boundHost, ?trustedWriteOrigins\)"
    has    "dist/api:        parser wired in createServer" "$API" "parseTrustedWriteOrigins"
    has_re "dist/api:        guard called with 2 args"   "$API" "createLocalhostOriginGuard\([^)]+,"

    has    "dist/prompts:    ANTI_INJECTION_DIRECTIVE"   "$PR"  "ANTI_INJECTION_DIRECTIVE"
    has    "dist/prompts:    UNTRUSTED INPUT frame"      "$PR"  "UNTRUSTED INPUT"
    has    "dist/generator:  frame imported"             "$GEN" "appendAntiInjectionFrame"
    has    "dist/generator:  framedSystem passed on"     "$GEN" "framedSystem"

    # The three dist/ rewrites that DID reach production since 2026-05. The
    # COPY of the freshly-built dist/ happens BEFORE the two patch RUNs; put
    # it after and these two are erased in silence while the build stays
    # green. That is what this pair of assertions is here to catch.
    has    "dist/lbug:       staleness patch applied"    "$LBUG"  "PATCHED:lbug-staleness-check"
    has    "dist/run-analyze:incremental dump applied"   "$RUNAN" "INCREMENTAL-DUMP"
    if [ -f "$WIKIW" ]; then
      echo "[gate] ok     wiki-worker.mjs present"
    else
      echo "[gate] ABSENT FILE  $WIKIW  (wiki-worker)" >&2
      RC=1
    fi
    ;;

  *)
    echo "usage: sh $0 <src|dist> <root>" >&2
    exit 1
    ;;
esac

if [ "$RC" -ne 0 ]; then
  echo "[gate] FAILED — the fork patches are NOT in the tree/artifact. Refusing to ship a born-dead image." >&2
  exit 1
fi

echo "[gate] PASSED ($MODE)"
