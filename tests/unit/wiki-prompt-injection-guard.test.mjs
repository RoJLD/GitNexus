/**
 * P0-5 Σ-PROMPT-INJECTION-GUARD — hardening of the wiki LLM path against
 * instructions smuggled through untrusted repository content.
 *
 * v1.6.5 seam under test (no process spawn, no LLM call):
 *   ANTI_INJECTION_DIRECTIVE / appendAntiInjectionFrame (prompts.ts) — the
 *   system-prompt frame declaring repo content UNTRUSTED DATA, applied at
 *   generator.ts's invokeLLM choke point (module/parent/overview wiki pages).
 *
 * NOTE: the read-only --disallowedTools parity lever (CLAUDE_DENIED_TOOLS /
 * buildClaudeArgs in local-cli-args.ts) is a v1.6.7 local-cli seam that does NOT
 * exist on this v1.6.5 base — importing it here broke the whole suite at load
 * time (Failed to resolve import), silently masked by the `unit` job being
 * continue-on-error. Removed. The upstream .ts sibling covers the same helper.
 */
import { describe, it, expect } from 'vitest';
import {
  ANTI_INJECTION_DIRECTIVE,
  appendAntiInjectionFrame,
} from '../../upstream/gitnexus/src/core/wiki/prompts.ts';

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
