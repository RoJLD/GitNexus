#!/usr/bin/env node
/**
 * OFFLINE, HOST-ONLY. Turn a directory of PDFs into papers.json for the
 * academic-literature template. Not run in any container; not a CI gate.
 * Metadata is best-effort (filename year + title hint, light topic keywords).
 * Usage: node tools/academic-extract.mjs <pdf-dir> <out.json>
 * NOTE: real corpora (e.g. Alten CMEX-3710) are processed locally only; the
 * resulting papers.json must NOT be committed.
 */
import { readdir, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const STOP = new Set(['the', 'and', 'of', 'a', 'an', 'is', 'for', 'in', 'on', 'to', 'via', 'under', 'with']);

export function guessMetaFromFilename(file) {
  const stem = basename(file, extname(file));
  const ym = stem.match(/(19|20)\d{2}/);
  const year = ym ? Number(ym[0]) : null;
  const title = stem.replace(/(19|20)\d{2}/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || stem;
  return { year, title };
}

export function keywordTopics(title) {
  return [...new Set(String(title).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4 && !STOP.has(w)))];
}

async function main() {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) { console.error('usage: node tools/academic-extract.mjs <pdf-dir> <out.json>'); process.exit(2); }
  const files = (await readdir(dir)).filter((f) => extname(f).toLowerCase() === '.pdf');
  const papers = files.map((f, i) => {
    const { year, title } = guessMetaFromFilename(f);
    return { id: `p${i}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`, title, year: year || 0, path: f, authors: [], topics: keywordTopics(title) };
  });
  await writeFile(out, JSON.stringify({ papers }, null, 2), 'utf8');
  console.log(`wrote ${papers.length} papers to ${out}`);
}
// Run only as a script, not on import (so tests can import the helpers).
if (process.argv[1] && process.argv[1].endsWith('academic-extract.mjs')) main();
