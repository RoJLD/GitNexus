# Wiki LLM Prompt-Injection Guard (P0-5)

**Date:** 2026-07-06
**Status:** delivered
**Area:** `upstream/gitnexus/src/core/wiki/` (in-place edits) + `tests/unit/`

## Problem

The wiki generator sends **untrusted repository content** — source code, file
names, comments, commit messages, `package.json` metadata, exported symbol
names, and previously generated child documentation — to an LLM to produce
documentation. Before this change there was **no prompt-injection defense**: an
attacker who controls repository content (e.g. a public repo cloned via
`server/git-clone.ts`) could smuggle instructions into the model.

Two distinct impacts, by provider:

- **HTTP provider** (`callLLM`, `GITNEXUS_API_KEY` — the ELYSIUM deployment
  default): a poisoned wiki (misinformation, phishing links in docs read by
  humans/agents). Moderate.
- **Local agentic provider** `claude` (`callClaudeLLM`, `gitnexus wiki
  --provider claude`): the CLI ran with `cwd = repoPath` and **no tool
  restriction**, so an injection could escalate to **tool/command execution**.
  HIGH. The sibling `codex` provider was already sandboxed
  (`--sandbox read-only` + `approval_policy="never"`); `claude` was not.

## Threat model

Untrusted repo content reaches the model as data in the user message; the model
must never treat that data as instructions, and — for local agentic providers —
must never be able to execute tools even if the frame is bypassed.

## Design — two defenses

### (a) Anti-injection system frame — `prompts.ts` + `generator.ts`

- `ANTI_INJECTION_DIRECTIVE`: a fixed instruction declaring repo material
  untrusted data, never instructions.
- `appendAntiInjectionFrame(systemPrompt)`: pure helper appending the directive
  **last** (most salient position before the untrusted user content).
- `WikiGenerator.buildSystemPrompt` now **always** applies it. Previously it
  returned `base` unchanged when `--lang` was unset → zero framing. Covers the
  content-bearing pages: module (raw source), parent (child docs), overview
  (project info).

### (b) Read-only tool parity for the `claude` provider — `local-cli-args.ts` (new) + `local-cli-client.ts`

- `CLAUDE_DENIED_TOOLS` + `buildClaudeArgs(config)`: pure, IO-free module
  (no logger/pino) so the security-critical arg construction is unit-testable
  in isolation.
- `callClaudeLLM` passes `--disallowedTools Bash Edit MultiEdit Write
  NotebookEdit WebFetch WebSearch Task KillShell`. `--disallowedTools` is the
  one lever an injected instruction cannot re-enable (it wins over
  `--allowedTools` and any permission-mode bypass), giving `claude` read-only
  parity with `codex`. A denylist is intentional: extra/unknown names are
  harmless no-ops, so over-listing stays safe as the tool surface evolves.

## Out of scope (documented residual vectors — defense-in-depth follow-up)

- `GROUPING_SYSTEM_PROMPT` deliberately bypasses `buildSystemPrompt`
  (`generator.ts` ~494) and is therefore unframed. It carries `FILE_LIST`
  (attacker-controlled file paths + symbol names) — lower content risk.
- `ingestion/cluster-enricher.ts` `buildEnrichmentPrompt` injects symbol names
  with no system prompt at all.
- A nonce delimiter around the per-file boundary in `readSourceFiles`
  (`--- {path} ---`) would harden against fake-delimiter escapes.

## Testing

`tests/unit/wiki-prompt-injection-guard.test.mjs` (Tier D — pure units), 6
cases: directive content, frame append/order, denied-tool set, `buildClaudeArgs`
shape and `--model` / `--disallowedTools` ordering. All green.

The shared unit config forces a jsdom + React `setupFile` onto every test; that
setup is currently broken locally under vitest 4.1.7 ("failed to find the
current suite") — the canonical runner is Docker. The pure test was validated
via an isolated node-env config. `tsc` type-checking is the Docker/CI build.
