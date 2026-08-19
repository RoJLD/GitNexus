/**
 * Usage observable for the GitNexus VSCode extension (SIGIL-1711 Bloc 1, (ii).5).
 *
 * Pure logic only — NO `vscode` API import — so the fork's vitest suite can
 * unit-test it. The extension glue (extension.ts) owns the storage path and the
 * fs read/write; this module owns the event model, the JSONL (de)serialization,
 * and the go/no-go verdict.
 *
 * WHY: doctrine "no v0.2 without proof of usage". The extension is unused today;
 * this accumulates a local, privacy-preserving (no network, no telemetry) usage
 * signal so the v0.2 decision is evidence-backed, not a guess. The highest-signal
 * event is `file_match` — the status bar showed a real bus-factor for a file in
 * an indexed repo, i.e. the extension did its job on real code.
 */

export type UsageEventType = 'activate' | 'file_match' | 'command';

export interface UsageEvent {
  /** epoch milliseconds */
  t: number;
  type: UsageEventType;
  /** command name, or repo name for a file_match */
  detail?: string;
}

export interface VerdictThresholds {
  /** real-usage signal: how many file_match events prove the extension worked */
  minFileMatches: number;
  /** spread over time, not one burst */
  minActiveDays: number;
  /** the "7-day probe" window, informational in the verdict text */
  probeWindowDays: number;
}

export const DEFAULT_THRESHOLDS: VerdictThresholds = {
  minFileMatches: 20,
  minActiveDays: 3,
  probeWindowDays: 7,
};

export interface UsageVerdict {
  verdict: 'USE-PROVEN' | 'INSUFFICIENT' | 'NO-DATA';
  /** true → go/no-go gate for a v0.2 is open */
  goForV02: boolean;
  activations: number;
  fileMatches: number;
  commandInvocations: number;
  /** distinct UTC calendar days on which any event occurred */
  activeDays: number;
  firstSeen: number | null;
  lastSeen: number | null;
  reason: string;
}

/** Serialize one event as a single JSONL line (trailing newline included). The
 * extension glue appends this straight to the log file (fs.appendFile); the same
 * format is what parseEvents reads back. */
export function serializeEvent(ev: UsageEvent): string {
  return JSON.stringify(ev) + '\n';
}

/** Parse a JSONL body into events, tolerating blank and corrupt lines. */
export function parseEvents(body: string): UsageEvent[] {
  if (!body) return [];
  const out: UsageEvent[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const ev = JSON.parse(line) as UsageEvent;
      if (ev && typeof ev.t === 'number' && typeof ev.type === 'string') out.push(ev);
    } catch {
      /* skip a corrupt line — a partial write never breaks the report */
    }
  }
  return out;
}

/** UTC day key (YYYY-MM-DD) for an epoch-ms timestamp. */
function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function computeUsageVerdict(
  events: UsageEvent[],
  now: number,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): UsageVerdict {
  if (!events.length) {
    return {
      verdict: 'NO-DATA',
      goForV02: false,
      activations: 0,
      fileMatches: 0,
      commandInvocations: 0,
      activeDays: 0,
      firstSeen: null,
      lastSeen: null,
      reason: 'No usage recorded yet. Install the extension and open files in an indexed repo.',
    };
  }

  let activations = 0;
  let fileMatches = 0;
  let commandInvocations = 0;
  const days = new Set<string>();
  let firstSeen = Infinity;
  let lastSeen = -Infinity;

  for (const ev of events) {
    if (ev.type === 'activate') activations++;
    else if (ev.type === 'file_match') fileMatches++;
    else if (ev.type === 'command') commandInvocations++;
    days.add(dayKey(ev.t));
    if (ev.t < firstSeen) firstSeen = ev.t;
    if (ev.t > lastSeen) lastSeen = ev.t;
  }

  const activeDays = days.size;
  const goForV02 = fileMatches >= thresholds.minFileMatches && activeDays >= thresholds.minActiveDays;
  const verdict: UsageVerdict['verdict'] = goForV02 ? 'USE-PROVEN' : 'INSUFFICIENT';

  const reason = goForV02
    ? `USE-PROVEN: ${fileMatches} file matches across ${activeDays} active days ` +
      `(≥ ${thresholds.minFileMatches} / ≥ ${thresholds.minActiveDays}). Go for v0.2.`
    : `INSUFFICIENT: ${fileMatches} file matches across ${activeDays} active days ` +
      `(need ≥ ${thresholds.minFileMatches} matches over ≥ ${thresholds.minActiveDays} days ` +
      `within a ${thresholds.probeWindowDays}-day probe). No-go for v0.2 yet.`;

  return {
    verdict,
    goForV02,
    activations,
    fileMatches,
    commandInvocations,
    activeDays,
    firstSeen: firstSeen === Infinity ? null : firstSeen,
    lastSeen: lastSeen === -Infinity ? null : lastSeen,
    reason,
  };
}
