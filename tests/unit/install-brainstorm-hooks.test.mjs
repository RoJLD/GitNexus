import { describe, it, expect } from 'vitest';
import { mergeClaudeHook } from '../../scripts/install-brainstorm-hooks.mjs';

describe('mergeClaudeHook', () => {
  it('adds the hook to an empty settings file', () => {
    const out = mergeClaudeHook({});
    expect(out.hooks.PostToolUse).toContainEqual({
      matcher: 'Write',
      filePattern: 'docs/superpowers/specs/*.md',
      command: 'node scripts/ghost-from-spec.mjs $CLAUDE_TOOL_FILE_PATH',
    });
  });

  it('handles a null/undefined input gracefully', () => {
    const out = mergeClaudeHook(undefined);
    expect(out.hooks.PostToolUse).toHaveLength(1);
    expect(out.hooks.PostToolUse[0].matcher).toBe('Write');
  });

  it('appends without overwriting existing PostToolUse hooks', () => {
    const existing = {
      hooks: {
        PostToolUse: [{ matcher: 'Edit', filePattern: '*.ts', command: 'echo edited' }],
      },
    };
    const out = mergeClaudeHook(existing);
    expect(out.hooks.PostToolUse).toHaveLength(2);
    expect(out.hooks.PostToolUse[0]).toMatchObject({ matcher: 'Edit' });
    expect(out.hooks.PostToolUse[1]).toMatchObject({
      matcher: 'Write',
      filePattern: 'docs/superpowers/specs/*.md',
    });
  });

  it('refuses to add a duplicate hook (same matcher + filePattern)', () => {
    const existing = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Write',
            filePattern: 'docs/superpowers/specs/*.md',
            command: 'node scripts/ghost-from-spec.mjs $CLAUDE_TOOL_FILE_PATH',
          },
        ],
      },
    };
    const out = mergeClaudeHook(existing);
    expect(out.hooks.PostToolUse).toHaveLength(1); // unchanged
  });

  it('preserves unrelated top-level settings keys', () => {
    const existing = {
      permissions: { allow: ['Bash(ls:*)'] },
      env: { FOO: 'bar' },
    };
    const out = mergeClaudeHook(existing);
    expect(out.permissions).toEqual({ allow: ['Bash(ls:*)'] });
    expect(out.env).toEqual({ FOO: 'bar' });
    expect(out.hooks.PostToolUse).toHaveLength(1);
  });
});
