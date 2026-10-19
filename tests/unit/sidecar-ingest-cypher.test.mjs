import { describe, it, expect } from 'vitest';
import { safeName, nodeMergeQuery, edgeMergeQuery } from '../../graphs-sidecar/ingest-cypher.mjs';

describe('edgeMergeQuery', () => {
  it('keeps the unlabeled endpoint match when from_table/to_table are absent', () => {
    const { query, params } = edgeMergeQuery({ table: 'Link', from: 'h1', to: 'r1', props: { id: 'h1->r1', kind: 'validates' } });
    expect(query).toBe('MATCH (a {id: $from}), (b {id: $to}) MERGE (a)-[r:Link {id: $id}]->(b) SET r.kind = $kind');
    expect(params).toEqual({ from: 'h1', to: 'r1', id: 'h1->r1', kind: 'validates' });
  });

  it('labels both endpoints with from_table/to_table (several node tables)', () => {
    const { query, params } = edgeMergeQuery({
      table: 'relies_on', from: 'wi-a', to: 'spec-b', from_table: 'WorkItem', to_table: 'Spec',
      props: { id: 'wi-a->relies_on->spec-b' },
    });
    expect(query).toBe('MATCH (a:WorkItem {id: $from}), (b:Spec {id: $to}) MERGE (a)-[r:relies_on {id: $id}]->(b)');
    // The endpoint tables are part of the query text, never params.
    expect(params).toEqual({ from: 'wi-a', to: 'spec-b', id: 'wi-a->relies_on->spec-b' });
  });

  it('labels only the endpoint whose table is given', () => {
    const { query } = edgeMergeQuery({ table: 'R', from: 'a', to: 'b', from_table: 'A' });
    expect(query).toBe('MATCH (a:A {id: $from}), (b {id: $to}) MERGE (a)-[r:R {id: $id}]->(b)');
  });

  it('defaults the edge id to from->to', () => {
    expect(edgeMergeQuery({ table: 'R', from: 'a', to: 'b' }).params.id).toBe('a->b');
  });

  it.each([
    ['from_table', { from_table: 'A) DETACH DELETE (a' }],
    ['to_table', { to_table: 'B {id: $to}), (c' }],
    ['rel table', { table: 'R]->(b) //' }],
  ])('rejects an unsafe %s with status 400', (what, patch) => {
    const edge = { table: 'R', from: 'a', to: 'b', ...patch };
    expect(() => edgeMergeQuery(edge)).toThrow(`invalid ${what}`);
    try { edgeMergeQuery(edge); } catch (e) { expect(e.status).toBe(400); }
  });
});

describe('nodeMergeQuery', () => {
  it('MERGEs on id and SETs the other props', () => {
    const { query, params } = nodeMergeQuery({ table: 'WorkItem', props: { id: 'wi-a', title: 'A', status: 'open' } });
    expect(query).toBe('MERGE (x:WorkItem {id: $id}) SET x.title = $title, x.status = $status');
    expect(params).toEqual({ id: 'wi-a', title: 'A', status: 'open' });
  });

  it('rejects an unsafe node table', () => {
    expect(() => nodeMergeQuery({ table: 'X {id: $id}) DETACH DELETE (x', props: { id: 'a' } })).toThrow('invalid node table');
  });
});

describe('safeName', () => {
  it('accepts the graph-name alphabet and rejects anything else', () => {
    expect(safeName('quant-lab_v1.2', 'graph name')).toBe('quant-lab_v1.2');
    for (const bad of ['', 'a b', 'a`b', 'a:b', 'a/b', null, undefined, 42]) {
      expect(() => safeName(bad, 'graph name')).toThrow('invalid graph name');
    }
  });
});
