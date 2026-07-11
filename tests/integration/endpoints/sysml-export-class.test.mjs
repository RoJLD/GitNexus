import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';

const BASE = 'http://localhost:4173';

describe('GET /sysml-export?format=mermaid-class', () => {
  it('returns a valid mermaid classDiagram (text/plain)', async () => {
    const res = await fetch(
      `${BASE}/sysml-export?repo=${encodeURIComponent(FIXTURE.name)}&format=mermaid-class`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') || '').toMatch(/text\/plain/);
    const body = await res.text();
    expect(body.startsWith('classDiagram')).toBe(true);
    // Zero Masking : the inheritance limitation is stated in the output.
    expect(body).toMatch(/inheritance: unavailable/);
    // Any emitted class block must be well-formed (balanced braces). The fixture
    // may be class-less (0 blocks) — a richer ≥1-class check runs live on HMMstudio.
    const opens = (body.match(/^class \w+ \{$/gm) || []).length;
    const closes = (body.match(/^\}$/gm) || []).length;
    expect(closes).toBeGreaterThanOrEqual(opens);
  });

  it('missing repo → 400 (checked before the class-diagram branch)', async () => {
    const res = await fetch(`${BASE}/sysml-export?format=mermaid-class`);
    expect(res.status).toBe(400);
  });
});
