import { describe, it, expect } from 'vitest';
import { isWikiRegenDue, parseAutoEvery } from '../../upstream/gitnexus-web/src/lib/wiki-schedule';

describe('parseAutoEvery', () => {
  it('parses h/d units to ms', () => {
    expect(parseAutoEvery('1h')).toBe(3_600_000);
    expect(parseAutoEvery('24h')).toBe(86_400_000);
    expect(parseAutoEvery('7d')).toBe(604_800_000);
  });
  it('returns null for off / undefined / malformed', () => {
    expect(parseAutoEvery('off')).toBeNull();
    expect(parseAutoEvery(undefined)).toBeNull();
    expect(parseAutoEvery('')).toBeNull();
    expect(parseAutoEvery('garbage')).toBeNull();
    expect(parseAutoEvery('10x')).toBeNull();
  });
});

describe('isWikiRegenDue', () => {
  const now = Date.parse('2026-05-28T12:00:00.000Z');
  it('false when autoEvery is off/undefined', () => {
    expect(isWikiRegenDue(null, 'off', now)).toBe(false);
    expect(isWikiRegenDue(Date.parse('2026-05-01T00:00:00Z'), undefined, now)).toBe(false);
  });
  it('true when never generated and autoEvery set', () => {
    expect(isWikiRegenDue(null, '24h', now)).toBe(true);
  });
  it('false when interval not elapsed', () => {
    const last = now - 3_600_000; // 1h ago
    expect(isWikiRegenDue(last, '24h', now)).toBe(false);
  });
  it('true when interval elapsed', () => {
    const last = now - 90_000_000; // ~25h ago
    expect(isWikiRegenDue(last, '24h', now)).toBe(true);
  });
  it('false on malformed autoEvery (no regen on broken config)', () => {
    expect(isWikiRegenDue(null, 'garbage', now)).toBe(false);
  });
});
