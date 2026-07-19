import { describe, it, expect } from 'vitest';
import { formStateToSpec, predicateRowToExpr, EMPTY_FORM_STATE } from '@/lib/lens-form-spec';

const base = { ...EMPTY_FORM_STATE, name: 'my_view', sourceLens: 'sigil', meaning: 'Ma lentille.' };

describe('predicateRowToExpr', () => {
  it('renders comparison operators', () => {
    expect(predicateRowToExpr({ field: 'status', op: '==', value: 'critical' })).toBe('status == critical');
    expect(predicateRowToExpr({ field: 'score', op: '>=', value: '3' })).toBe('score >= 3');
  });
  it('renders `in` as a bracketed list', () => {
    expect(predicateRowToExpr({ field: 'kind', op: 'in', value: 'a, b ,c' })).toBe('kind in [a, b, c]');
  });
});

describe('formStateToSpec', () => {
  it('builds the minimal spec (name + source + meaning)', () => {
    expect(formStateToSpec(base)).toEqual({
      name: 'my_view', source: { lens: 'sigil' }, meaning: 'Ma lentille.',
    });
  });

  it('OMITS color entirely when colorBy is empty (an empty color block breaks the backend grammar)', () => {
    const spec = formStateToSpec({ ...base, colorBy: '', colorScale: 'heat' });
    expect('color' in spec).toBe(false);
  });

  it('emits color when colorBy is set', () => {
    expect(formStateToSpec({ ...base, colorBy: 'domainType', colorScale: 'categorical' }).color)
      .toEqual({ by: 'domainType', scale: 'categorical' });
  });

  it('OMITS select when there is no usable predicate', () => {
    expect('select' in formStateToSpec({ ...base, predicates: [{ field: '', op: '==', value: '' }] })).toBe(false);
  });

  it('emits select.node_where from the single predicate row', () => {
    expect(formStateToSpec({ ...base, predicates: [{ field: 'status', op: '==', value: 'critical' }] }).select)
      .toEqual({ node_where: 'status == critical' });
  });

  it('OMITS select when an `in` row has no real items (commas/whitespace only)', () => {
    expect('select' in formStateToSpec({ ...base, predicates: [{ field: 'kind', op: 'in', value: ' , , ' }] })).toBe(false);
  });

  it('still emits select for an `in` row with real items', () => {
    expect(formStateToSpec({ ...base, predicates: [{ field: 'kind', op: 'in', value: 'a, b' }] }).select)
      .toEqual({ node_where: 'kind in [a, b]' });
  });

  it('OMITS insight unless BOTH topN and by are set', () => {
    expect('insight' in formStateToSpec({ ...base, insightTopN: 5, insightBy: '' })).toBe(false);
    expect('insight' in formStateToSpec({ ...base, insightTopN: '', insightBy: 'pagerank' })).toBe(false);
    expect(formStateToSpec({ ...base, insightTopN: 5, insightBy: 'pagerank' }).insight)
      .toEqual({ rank: 'top 5 by pagerank' });
  });

  it('omits meaning when blank', () => {
    expect('meaning' in formStateToSpec({ ...base, meaning: '   ' })).toBe(false);
  });
});
