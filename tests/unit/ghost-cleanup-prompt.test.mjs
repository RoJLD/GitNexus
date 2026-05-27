import { describe, it, expect } from 'vitest';
import { buildCleanupPrompt, parseCleanupResponse } from '../../upstream/docker-server-ghost-cleanup-core.mjs';

describe('buildCleanupPrompt', () => {
  const expiredGhost = {
    id: 'tier-3-2-mutation-tracking',
    title: 'Mutation tracking',
    declared: {
      description: 'Track mutations across releases',
      expectedBy: '2026-04-30',
      expectedLinks: [{ kind: 'path', value: 'docker-server-mutation.mjs' }],
    },
    daysPastExpiry: 26,
  };

  it('produces a prompt with the ghost metadata + evidence sections', () => {
    const prompt = buildCleanupPrompt({
      ghost: expiredGhost,
      matchedNodes: ['docker-server-similarity.mjs'],
      recentCommits: ['feat(similarity): v1 shipped (2026-04-15)'],
    });
    expect(prompt).toContain('Mutation tracking');
    expect(prompt).toContain('2026-04-30');
    expect(prompt).toContain('26 days');
    expect(prompt).toContain('docker-server-similarity.mjs');
    expect(prompt).toContain('feat(similarity)');
    expect(prompt).toMatch(/reaffirm.*cancel.*ship-as-other/);
    expect(prompt).toMatch(/JSON/);
  });

  it('handles empty matchedNodes + recentCommits', () => {
    const prompt = buildCleanupPrompt({
      ghost: expiredGhost,
      matchedNodes: [],
      recentCommits: [],
    });
    expect(prompt).toContain('Mutation tracking');
    expect(prompt).toContain('(no matching nodes)');
    expect(prompt).toContain('(no recent commits)');
  });
});

describe('parseCleanupResponse', () => {
  it('parses a valid JSON response', () => {
    const r = parseCleanupResponse(`{"action":"cancel","rationale":"X","confidence":0.85}`);
    expect(r).toEqual({ action: 'cancel', rationale: 'X', confidence: 0.85 });
  });

  it('strips ```json``` fences if present', () => {
    const r = parseCleanupResponse('```json\n{"action":"reaffirm","rationale":"Y","confidence":0.6}\n```');
    expect(r.action).toBe('reaffirm');
  });

  it('returns null on invalid input', () => {
    expect(parseCleanupResponse('not json')).toBeNull();
    expect(parseCleanupResponse('')).toBeNull();
  });

  it('rejects responses with invalid action', () => {
    expect(parseCleanupResponse(`{"action":"delete","rationale":"X","confidence":1}`)).toBeNull();
  });
});
