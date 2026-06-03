import { describe, it, expect } from 'vitest';
import { guessMetaFromFilename, keywordTopics } from '../../tools/academic-extract.mjs';

describe('academic-extract heuristics', () => {
  it('extracts year + title hint from common filename shapes', () => {
    expect(guessMetaFromFilename('Fama1970.pdf')).toMatchObject({ year: 1970, title: 'Fama' });
    expect(guessMetaFromFilename('1985 EMA Kyle.pdf')).toMatchObject({ year: 1985 });
    expect(guessMetaFromFilename('Volatility is rough.pdf')).toMatchObject({ year: null, title: 'Volatility is rough' });
  });
  it('derives topic keywords from a title', () => {
    expect(keywordTopics('Market Liquidity and Funding Liquidity')).toContain('liquidity');
  });
});
