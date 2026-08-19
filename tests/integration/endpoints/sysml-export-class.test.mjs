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
    // Class blocks are well-formed (balanced braces).
    const opens = (body.match(/^class \w+ \{$/gm) || []).length;
    const closes = (body.match(/^\}$/gm) || []).length;
    expect(closes).toBeGreaterThanOrEqual(opens);
  });

  it('renders REAL inheritance arrows from the fixture (EXTENDS + IMPLEMENTS)', async () => {
    // The fixture's src/store/store.ts declares an INTERNAL hierarchy (commit 13):
    //   class Store {}            interface Cache {}
    //   class UserStore extends Store {}
    //   class MemoryCache extends Store implements Cache {}
    // Both bases are in-repo, so projectClassDiagram renders real arrows. This
    // pins the EXTENDS/IMPLEMENTS path DETERMINISTICALLY in CI — HMMstudio (external
    // bases only) can never exercise it. Measured 2026-07-12: the ingestion emits
    // EXTENDS (class→superclass) + IMPLEMENTS (class→interface), NOT `INHERITS`.
    const res = await fetch(
      `${BASE}/sysml-export?repo=${encodeURIComponent(FIXTURE.name)}&format=mermaid-class`,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    // The header comment reports the count + real edge types (Zero Masking).
    expect(body).toMatch(/inheritance: \d+ relation\(s\) \(EXTENDS\/IMPLEMENTS\)/);
    // Solid inheritance arrow (extends).
    expect(body).toMatch(/Store <\|-- UserStore/);
    expect(body).toMatch(/Store <\|-- MemoryCache/);
    // Dashed realization arrow (implements).
    expect(body).toMatch(/Cache <\|\.\. MemoryCache/);
  });

  it('missing repo → 400 (checked before the class-diagram branch)', async () => {
    const res = await fetch(`${BASE}/sysml-export?format=mermaid-class`);
    expect(res.status).toBe(400);
  });
});
