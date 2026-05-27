import { describe, it, expect } from 'vitest';
import { FIXTURE } from '../helpers/analyze.mjs';
const BASE = `http://localhost:${process.env.TEST_PORT || 4747}`;

describe('GET /sysml-export', () => {
  it('returns 400 when repo missing', async () => {
    const res = await fetch(`${BASE}/sysml-export`);
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid format', async () => {
    const res = await fetch(`${BASE}/sysml-export?repo=${FIXTURE.name}&format=xmi`);
    expect(res.status).toBe(400);
  });

  it('returns 200 text/plain PlantUML after sync', async () => {
    await fetch(`${BASE}/ghosts/sync?repo=${FIXTURE.name}`, { method: 'POST' });
    const res = await fetch(`${BASE}/sysml-export?repo=${FIXTURE.name}`);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toContain('@startuml');
    expect(body).toContain('@enduml');
  });

  it('returns 200 mermaid when format=mermaid', async () => {
    const res = await fetch(`${BASE}/sysml-export?repo=${FIXTURE.name}&format=mermaid`);
    const body = await res.text();
    expect(body).toMatch(/^graph TD/m);
  });
});
