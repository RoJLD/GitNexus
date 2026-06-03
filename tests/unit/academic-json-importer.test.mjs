import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importAcademicJson } from '../../upstream/docker-server-academic-json-importer.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/academic');

describe('importAcademicJson', () => {
  it('emits the generic ingest shape with deduped authors and topics', async () => {
    const rg = await importAcademicJson(FIX);
    const byTable = (t) => rg.nodes.filter((n) => n.table === t);
    expect(byTable('Paper')).toHaveLength(3);
    expect(byTable('Author')).toHaveLength(3);   // Kyle, Fama, French — Fama deduped
    expect(byTable('Topic')).toHaveLength(2);    // microstructure, efficiency — efficiency deduped
    const fama = byTable('Author').find((n) => n.props.name === 'Eugene F. Fama');
    const authoredByFama = rg.edges.filter((e) => e.table === 'AUTHORED' && e.from === fama.props.id);
    expect(authoredByFama).toHaveLength(2);
    const paper = byTable('Paper').find((n) => n.props.id === 'kyle1985');
    expect(paper.props).toMatchObject({ id: 'kyle1985', title: 'Continuous Auctions and Insider Trading', year: 1985, path: 'kyle.pdf' });
    expect(rg.edges.filter((e) => e.table === 'ABOUT')).toHaveLength(3); // one ABOUT per paper
    expect(rg.report.nodes).toBe(rg.nodes.length);
    expect(rg.report.edges).toBe(rg.edges.length);
  });

  it('rejects with a clear error when papers.json is absent', async () => {
    await expect(importAcademicJson('/no/such/dir')).rejects.toThrow(/cannot read papers.json/);
  });

  it('returns an empty graph when the papers key is missing', async () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/academic-malformed');
    const rg = await importAcademicJson(dir);
    expect(rg.nodes).toHaveLength(0);
    expect(rg.edges).toHaveLength(0);
    expect(rg.report.nodes).toBe(0);
  });

  it('skips papers with a missing id and records them in report.skipped', async () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/academic-noid');
    const rg = await importAcademicJson(dir);
    expect(rg.nodes.filter((n) => n.table === 'Paper')).toHaveLength(1); // only ok1
    expect(rg.report.skipped).toHaveLength(1);
    expect(rg.report.skipped[0]).toMatchObject({ reason: 'missing id' });
  });

  it('dedups repeated authors/topics within one paper (report.edges matches stored)', async () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/academic-dup');
    const rg = await importAcademicJson(dir);
    expect(rg.edges.filter((e) => e.table === 'AUTHORED')).toHaveLength(1);
    expect(rg.edges.filter((e) => e.table === 'ABOUT')).toHaveLength(1);
    expect(rg.report.edges).toBe(rg.edges.length);
  });
});
