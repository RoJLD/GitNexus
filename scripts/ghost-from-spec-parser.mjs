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
