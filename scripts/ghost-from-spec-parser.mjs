/**
 * Pure fns to parse a spec markdown into ghost fields.
 * No I/O. Consumed by scripts/ghost-from-spec.mjs.
 *
 * See docs/superpowers/specs/2026-05-26-roadmap-predictive-brainstorm-hook-design.md
 */
import { basename } from 'node:path';

const DESIGN_SUFFIX_RE = /-(design|spec)$/i;
const TRAILING_DESIGN_RE = /\b(design|spec|implementation plan)\s*$/i;

export function deriveId(filePath) {
  const name = basename(filePath).replace(/\.md$/i, '');
  const stripped = name.replace(DESIGN_SUFFIX_RE, '');
  return `spec-${stripped}`;
}

export function extractTitle(md) {
  if (!md) return '(untitled spec)';
  const line = md.split('\n').find(l => /^#\s/.test(l));
  if (!line) return '(untitled spec)';
  const title = line.replace(/^#\s+/, '').replace(TRAILING_DESIGN_RE, '').trim();
  return title || '(untitled spec)';
}

const GOAL_SECTION_RE = /^##\s+2\.\s+Goal\s*$/i;
const NEXT_H2_RE = /^##\s+/;
const TIER_RE = /Tier\s+(\d+(?:\.\d+)?)/i;

export function extractDescription(md) {
  if (!md) return '';
  const lines = md.split('\n');
  let inGoal = false;
  let started = false;
  const buf = [];
  for (const line of lines) {
    if (!inGoal) {
      if (GOAL_SECTION_RE.test(line)) inGoal = true;
      continue;
    }
    if (NEXT_H2_RE.test(line)) break;
    const trimmed = line.trim();
    if (!started && trimmed === '') continue;       // skip leading blanks
    if (started && trimmed === '') break;            // first blank after content ends the paragraph
    if (trimmed) { buf.push(trimmed); started = true; }
  }
  const joined = buf.join(' ').replace(/\s+/g, ' ').trim();
  return joined.length > 200 ? joined.slice(0, 197) + '...' : joined;
}

export function extractTier(md) {
  if (!md) return null;
  const m = md.match(TIER_RE);
  return m ? m[1] : null;
}

const DESIGN_SECTION_RE = /^##\s+3\.\s+Design\s*$/i;
const BACKTICK_RE = /`([^`]+)`/g;
// File-extension whitelist used both for path classification (`kind`) and as
// the gate for backtick tokens that contain a `/` (endpoint paths like
// `/ghosts` are NOT files and must be rejected even though they contain `/`).
const PATH_EXT_RE = /\.(?:mjs|ts|tsx|js|jsx|py|css|scss|json|yaml|yml|md|sh|sql|rs|go|java|kt|swift|html)$/i;
// Reject tokens with shell metacharacters / whitespace — `curl > out.puml`,
// `?includeEdges=imports,calls`, etc. (Spaces inside backticks are common
// in prose like `some label`, those are kept as label-kind below; this RE
// only filters shell-noise candidates for the path/label classification.)
const SHELL_NOISE_RE = /[<>|&$]/;

/**
 * Decide whether a backticked token is "interesting enough" to show up as
 * an expected-link entry in the ROADMAP row. Rejection rules (tightened on
 * 2026-05-27 after the brainstorm-hook self-test caught noise like
 * `?format=mermaid`, `/ghosts`, `curl > out.puml`, `?includeEdges=...`):
 *  - empty / single-char / pure punctuation → reject
 *  - starts with `?` (query string fragment) → reject
 *  - contains whitespace OR shell metacharacters → reject
 *  - starts with `/` AND has no file extension → reject (endpoint path)
 *  - has a `/` but no file extension → reject (e.g. `foo/bar`)
 * A token is classified as `path` iff it has a recognized file extension;
 * otherwise it stays a `label` (e.g. `repoId`, `WatchSpec`).
 */
function isAcceptableToken(t) {
  if (!t) return false;
  const s = t.trim();
  if (s.length <= 1) return false;
  if (/^[\p{P}\p{S}]+$/u.test(s)) return false; // pure punctuation
  if (s.startsWith('?')) return false;
  if (/\s/.test(s)) return false;
  if (SHELL_NOISE_RE.test(s)) return false;
  const hasExt = PATH_EXT_RE.test(s);
  if (s.includes('/') && !hasExt) return false; // endpoint path
  return true;
}

export function extractExpectedLinks(md) {
  if (!md) return [];
  const lines = md.split('\n');
  let inDesign = false;
  const tokens = new Set();
  for (const line of lines) {
    if (DESIGN_SECTION_RE.test(line)) { inDesign = true; continue; }
    if (!inDesign) continue;
    for (const m of line.matchAll(BACKTICK_RE)) {
      tokens.add(m[1]);
    }
  }
  return [...tokens]
    .filter(isAcceptableToken)
    .map(t => ({
      kind: PATH_EXT_RE.test(t) ? 'path' : 'label',
      value: t,
    }));
}

export function parseSpec(filePath, md) {
  return {
    id: deriveId(filePath),
    title: extractTitle(md),
    description: extractDescription(md),
    tier: extractTier(md),
    status: 'planned',
    expectedLinks: extractExpectedLinks(md),
  };
}
