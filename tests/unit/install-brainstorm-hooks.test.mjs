import { describe, it, expect } from 'vitest';
import {
  mergeClaudeHook,
  GIT_HOOK,
  GHA_WORKFLOW,
} from '../../scripts/install-brainstorm-hooks.mjs';

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

describe('GIT_HOOK template', () => {
  it('is a POSIX shell script with the right diff-tree command', () => {
    expect(GIT_HOOK.startsWith('#!/bin/sh')).toBe(true);
    expect(GIT_HOOK).toContain('git diff-tree --no-commit-id');
    expect(GIT_HOOK).toContain('docs/superpowers/specs/');
    expect(GIT_HOOK).toContain('ghost-from-spec.mjs');
  });

  it('iterates each changed spec file via while-read (no xargs)', () => {
    expect(GIT_HOOK).toMatch(/while read spec/);
    expect(GIT_HOOK).toContain('node scripts/ghost-from-spec.mjs "$spec"');
  });

  it('mentions the installer in a comment so users can trace it', () => {
    expect(GIT_HOOK).toContain('install-brainstorm-hooks.mjs');
  });
});

describe('GHA_WORKFLOW template', () => {
  it('matches branches [deployment] and paths specs/', () => {
    expect(GHA_WORKFLOW).toContain('branches: [deployment]');
    expect(GHA_WORKFLOW).toContain("paths: ['docs/superpowers/specs/**']");
  });

  it('uses Node 22.11.0 and is non-blocking', () => {
    expect(GHA_WORKFLOW).toContain("node-version: '22.11.0'");
    expect(GHA_WORKFLOW).toContain('continue-on-error: true');
  });

  it('commits with the roblastar identity', () => {
    expect(GHA_WORKFLOW).toContain('roblastar@live.fr');
    expect(GHA_WORKFLOW).toContain('Robin DENIS');
  });

  it('triggers ghost-from-spec.mjs for every changed spec in the push', () => {
    expect(GHA_WORKFLOW).toContain('git diff --name-only HEAD~1 HEAD');
    expect(GHA_WORKFLOW).toContain('node scripts/ghost-from-spec.mjs "$spec"');
  });

  it('only commits ROADMAP.md back if it actually changed', () => {
    expect(GHA_WORKFLOW).toContain('git diff --quiet ROADMAP.md');
    expect(GHA_WORKFLOW).toContain(
      'chore(roadmap): sync ghosts from specs (auto)',
    );
  });
});
