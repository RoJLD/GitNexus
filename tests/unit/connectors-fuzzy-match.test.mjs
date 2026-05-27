import { describe, it, expect } from 'vitest';
import { fuzzyMatchTicketToGhost, tokenize, jaccardSimilarity } from '../../upstream/docker-server-connectors-core.mjs';

describe('tokenize', () => {
  it('lowercases + strips punctuation', () => {
    expect(tokenize('What-if simulator! v2.')).toEqual(['what', 'if', 'simulator', 'v2']);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
  });
  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(['a'], ['b'])).toBe(0);
  });
});

describe('fuzzyMatchTicketToGhost', () => {
  const ghosts = [
    { id: 'g1', title: 'What-if simulator', declared: { description: 'Rename / move / delete' } },
    { id: 'g2', title: 'Audit dashboard', declared: { description: '' } },
  ];
  it('matches by title similarity above threshold', () => {
    const r = fuzzyMatchTicketToGhost(
      { title: 'What-if simulator v2', description: 'follow-up to rename support' },
      ghosts,
      0.5,
    );
    expect(r).toBeTruthy();
    expect(r.ghost.id).toBe('g1');
  });
  it('returns null when below threshold', () => {
    const r = fuzzyMatchTicketToGhost(
      { title: 'Completely unrelated', description: '' },
      ghosts,
      0.7,
    );
    expect(r).toBeNull();
  });
});
