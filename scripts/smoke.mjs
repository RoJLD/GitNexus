#!/usr/bin/env node
// Standalone smoke harness: curl + assert key endpoints against a running stack.
//   node scripts/smoke.mjs [baseUrl]   (default http://localhost:4173)
// Exits 1 if any check fails. Does NOT boot the stack (caller does).
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const checks = [
  { path: '/graph/templates', assert: (b) => typeof b === 'string' && b.includes('imports-deps') },
  { path: '/graph/list', assert: () => true },
  { path: '/metrics', assert: (b) => { const j = JSON.parse(b); return j && 'latency' in j && 'caches' in j; } },
];
let failures = 0;
for (const c of checks) {
  const url = base + c.path;
  try {
    const res = await fetch(url);
    const body = await res.text();
    const ok = res.status === (c.expectStatus ?? 200) && (!c.assert || c.assert(body));
    console.log(`${ok ? '✓' : '✗'} ${c.path} (${res.status})`);
    if (!ok) { failures++; if (body) console.log(`    body: ${body.slice(0, 200)}`); }
  } catch (e) {
    failures++; console.log(`✗ ${c.path} — ${e.message}`);
  }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall smoke checks passed');
process.exit(failures ? 1 : 0);
