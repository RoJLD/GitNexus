/**
 * Golden snapshot helper. Reads expected/<name>.json and compares.
 * If WRITE_GOLDEN=1, writes the actual response instead of comparing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECTED_DIR = join(HERE, '..', '..', 'fixtures', 'expected');

export function expectGolden(name, actual, { tolerance = 1e-6 } = {}) {
  const file = join(EXPECTED_DIR, `${name}.json`);
  if (process.env.WRITE_GOLDEN === '1' || !existsSync(file)) {
    writeFileSync(file, JSON.stringify(actual, null, 2) + '\n');
    console.warn(`[golden] wrote ${file}`);
    return;
  }
  const expected = JSON.parse(readFileSync(file, 'utf8'));
  compareWithTolerance(actual, expected, tolerance, name);
}

function compareWithTolerance(actual, expected, tolerance, path) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    expect(actual, `${path} (float)`).toBeCloseTo(expected, -Math.log10(tolerance));
    return;
  }
  if (Array.isArray(expected)) {
    expect(actual, `${path} (length)`).toHaveLength(expected.length);
    expected.forEach((v, i) => compareWithTolerance(actual[i], v, tolerance, `${path}[${i}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    expect(Object.keys(actual ?? {}).sort(), `${path} (keys)`).toEqual(Object.keys(expected).sort());
    for (const k of Object.keys(expected)) compareWithTolerance(actual[k], expected[k], tolerance, `${path}.${k}`);
    return;
  }
  expect(actual, path).toEqual(expected);
}
