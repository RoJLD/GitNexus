/**
 * P0-5 Σ-PROMPT-INJECTION-GUARD — hardening of the wiki LLM path against
 * instructions smuggled through untrusted repository content.
 *
 * Two pure seams under test (no process spawn, no LLM call):
 *   1. ANTI_INJECTION_DIRECTIVE / appendAntiInjectionFrame (prompts.ts) — the
 *      system-prompt frame declaring repo content UNTRUSTED DATA. Applied at the
 *      buildSystemPrompt chokepoint (module/parent/overview wiki pages).
 *   2. CLAUDE_DENIED_TOOLS / buildClaudeArgs (local-cli-client.ts) — read-only
 *      parity with the codex provider (--sandbox read-only): execution, mutation
 *      and network tools are hard-denied via --disallowedTools, the one lever an
 *      injected instruction cannot re-enable (it wins over allowedTools and any
 *      bypass mode). Closes the injection → command-execution vector.
 */
import { describe, it, expect } from 'vitest';
import {
  ANTI_INJECTION_DIRECTIVE,
  appendAntiInjectionFrame,
} from '../../upstream/gitnexus/src/core/wiki/prompts.ts';
import {
  buildClaudeArgs,
  CLAUDE_DENIED_TOOLS,
} from '../../upstream/gitnexus/src/core/wiki/local-cli-args.ts';

describe('anti-injection system frame', () => {
  it('directive marks repo content as untrusted and forbids obeying it', () => {
    const d = ANTI_INJECTION_DIRECTIVE.toLowerCase();
    expect(d).toContain('untrusted');
    expect(d).toContain('instruction');
    expect(d).toMatch(/never|do not follow|not follow/);
  });

  it('appends the directive to any base system prompt, preserving the base and putting the guard last', () => {
    const base = 'You are a technical documentation writer.';
    const framed = appendAntiInjectionFrame(base);
    expect(framed).toContain(base);
    expect(framed).toContain(ANTI_INJECTION_DIRECTIVE);
    // guard is the final word before the untrusted user content is appended
    expect(framed.indexOf(ANTI_INJECTION_DIRECTIVE)).toBeGreaterThan(framed.indexOf(base));
  });

  it('appends exactly once (no accidental duplication)', () => {
    const framed = appendAntiInjectionFrame('Role.');
    expect(framed.split(ANTI_INJECTION_DIRECTIVE).length - 1).toBe(1);
  });
});

describe('claude read-only tool parity', () => {
  it('denies execution, mutation and network tools', () => {
    for (const t of ['Bash', 'Write', 'Edit', 'WebFetch']) {
      expect(CLAUDE_DENIED_TOOLS).toContain(t);
    }
  });

  it('buildClaudeArgs passes --disallowedTools with the full denied set, keeping headless text mode', () => {
    const args = buildClaudeArgs({});
    expect(args.indexOf('--disallowedTools')).toBeGreaterThanOrEqual(0);
    for (const t of CLAUDE_DENIED_TOOLS) {
      expect(args).toContain(t);
    }
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('text');
  });

  it('keeps --model before the variadic --disallowedTools so the tool list stays terminal', () => {
    const args = buildClaudeArgs({ model: 'claude-x' });
    expect(args[args.indexOf('--model') + 1]).toBe('claude-x');
    expect(args.indexOf('--disallowedTools')).toBeGreaterThan(args.indexOf('--model'));
    expect(args[args.length - 1]).toBe(CLAUDE_DENIED_TOOLS[CLAUDE_DENIED_TOOLS.length - 1]);
  });
});
