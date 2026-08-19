import { describe, it, expect } from 'vitest';
import {
  serializeEvent,
  parseEvents,
  computeUsageVerdict,
  DEFAULT_THRESHOLDS,
  type UsageEvent,
} from '../../vscode-extension/src/usage';

const DAY = 24 * 60 * 60 * 1000;
const D0 = Date.UTC(2026, 6, 1, 12, 0, 0); // 2026-07-01

function fileMatches(n: number, startDay = 0): UsageEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    t: D0 + startDay * DAY + i * 1000,
    type: 'file_match' as const,
    detail: 'repoA',
  }));
}

describe('appendEventLine / parseEvents', () => {
  it('round-trips events as JSONL', () => {
    const body =
      serializeEvent({ t: D0, type: 'activate' }) +
      serializeEvent({ t: D0 + 1000, type: 'command', detail: 'refresh' });
    const evs = parseEvents(body);
    expect(evs).toHaveLength(2);
    expect(evs[0].type).toBe('activate');
    expect(evs[1].detail).toBe('refresh');
  });

  it('tolerates blank and corrupt lines', () => {
    const body = '{"t":1,"type":"activate"}\n\nnot-json\n{"t":2,"type":"file_match"}\n';
    const evs = parseEvents(body);
    expect(evs).toHaveLength(2);
    expect(evs[1].type).toBe('file_match');
  });

  it('drops entries missing required fields', () => {
    const body = '{"type":"activate"}\n{"t":5}\n{"t":6,"type":"command"}\n';
    expect(parseEvents(body)).toHaveLength(1);
  });
});

describe('computeUsageVerdict', () => {
  it('returns NO-DATA with no events', () => {
    const v = computeUsageVerdict([], D0);
    expect(v.verdict).toBe('NO-DATA');
    expect(v.goForV02).toBe(false);
  });

  it('returns USE-PROVEN when matches and active days clear the thresholds', () => {
    const events = [
      { t: D0, type: 'activate' as const },
      ...fileMatches(8, 0),
      ...fileMatches(8, 1),
      ...fileMatches(8, 2), // 24 matches across 3 distinct days
      { t: D0 + 2 * DAY, type: 'command' as const, detail: 'openWebUI' },
    ];
    const v = computeUsageVerdict(events, D0 + 3 * DAY);
    expect(v.verdict).toBe('USE-PROVEN');
    expect(v.goForV02).toBe(true);
    expect(v.fileMatches).toBe(24);
    expect(v.activeDays).toBe(3);
    expect(v.activations).toBe(1);
    expect(v.commandInvocations).toBe(1);
    expect(v.reason).toMatch(/Go for v0\.2/);
  });

  it('returns INSUFFICIENT when enough matches but too few active days (one burst)', () => {
    const events = fileMatches(DEFAULT_THRESHOLDS.minFileMatches + 5, 0); // all same day
    const v = computeUsageVerdict(events, D0 + DAY);
    expect(v.verdict).toBe('INSUFFICIENT');
    expect(v.goForV02).toBe(false);
    expect(v.activeDays).toBe(1);
  });

  it('returns INSUFFICIENT when spread over days but too few matches', () => {
    const events = [...fileMatches(1, 0), ...fileMatches(1, 1), ...fileMatches(1, 2)];
    const v = computeUsageVerdict(events, D0 + 3 * DAY);
    expect(v.verdict).toBe('INSUFFICIENT');
    expect(v.fileMatches).toBe(3);
    expect(v.activeDays).toBe(3);
  });

  it('honors custom thresholds', () => {
    const events = [...fileMatches(1, 0), ...fileMatches(1, 1)];
    const v = computeUsageVerdict(events, D0 + 2 * DAY, {
      minFileMatches: 2,
      minActiveDays: 2,
      probeWindowDays: 7,
    });
    expect(v.goForV02).toBe(true);
  });
});
