import { describe, it, expect } from 'vitest';
import {
  formStateToSpec,
  predicateRowToExpr,
  validateFormState,
  isFormPristine,
  EMPTY_FORM_STATE,
} from '@/lib/lens-form-spec';

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

  // Review fix (F3): `min={1}` on the number input is never enforced — no
  // <form> wraps the fields and every button is type="button". The values below
  // all reach `formStateToSpec` in the real UI, and each one produces an
  // `insight.rank` the backend accepts syntactically then answers with an empty
  // list and no error (lens_engine.py:117-119).
  it.each([
    ['zero (matches the regex, then slices scored[:0] = [])', 0, 'pagerank'],
    ['negative (\\d+ does not match -> if not m: return [])', -3, 'pagerank'],
    ['fractional (\\d+ does not match)', 2.5, 'pagerank'],
  ])('never emits insight for a top-N that renders nothing: %s', (_label, topN, by) => {
    expect('insight' in formStateToSpec({ ...base, insightTopN: topN as number, insightBy: by as string }))
      .toBe(false);
  });

  it('never emits insight for a non-word metric (\\w+ captures only `in`, ranking a property that does not exist)', () => {
    expect('insight' in formStateToSpec({ ...base, insightTopN: 5, insightBy: 'in-degree' })).toBe(false);
  });
});

// Review fix (F2/F3/F7): the guided surface had NO client-side gate at all —
// `parse()` returned `formStateToSpec(form)` unconditionally, so the modal's
// `if (!spec) return;` never fired and a pristine form could POST
// `{"name":"","source":{"lens":""}}` into the sovereign canon.
describe('validateFormState', () => {
  it('accepts a well-formed minimal state', () => {
    expect(validateFormState(base)).toEqual([]);
  });

  it('reports an empty name', () => {
    expect(validateFormState({ ...base, name: '  ' })).toContain('nameRequired');
  });

  // An empty source.lens is FALSY, so the promoter's referential-integrity
  // guard (`if upstream and upstream not in existing`) is short-circuited and
  // the composition intent is dropped without a word.
  it('reports an empty source lens', () => {
    expect(validateFormState({ ...base, sourceLens: '   ' })).toContain('sourceRequired');
  });

  it('reports BOTH on a pristine form (the "empty form -> Propose" path)', () => {
    expect(validateFormState(EMPTY_FORM_STATE)).toEqual(['nameRequired', 'sourceRequired']);
  });

  // eval_predicate scans ['==','!=','>=','<=','>','<'] by *containment over the
  // whole expression* before reaching its ` in ` branch, so an operand carrying
  // one of those characters mis-partitions the expression and every node
  // evaluates False — a fully dimmed graph, no error anywhere.
  it.each([
    ['an `in` item containing `>`', { field: 'path', op: 'in' as const, value: 'a>b, c' }],
    ['an `in` item containing `==`', { field: 'kind', op: 'in' as const, value: 'a==b' }],
    ['a comparison value containing `>`', { field: 'score', op: '<' as const, value: 'a>b' }],
    ['a field containing an operator char', { field: 'a>b', op: '==' as const, value: 'c' }],
  ])('rejects %s', (_label, row) => {
    expect(validateFormState({ ...base, predicates: [row] })).toContain('predicateOperatorChar');
  });

  it('accepts a predicate whose value carries no operator character', () => {
    expect(validateFormState({ ...base, predicates: [{ field: 'kind', op: 'in', value: 'a, b' }] })).toEqual([]);
  });

  it('stays silent on an unusable predicate row (nothing will be emitted from it)', () => {
    expect(validateFormState({ ...base, predicates: [{ field: '', op: '==', value: 'a>b' }] })).toEqual([]);
  });

  it('treats a fully blank insight as an opt-out, not an error', () => {
    expect(validateFormState({ ...base, insightTopN: '', insightBy: '' })).toEqual([]);
  });

  // The half-filled cases used to be dropped SILENTLY by formStateToSpec while
  // the screen still showed their content (typing `3` then `e` in the number
  // input leaves state at '' via badInput without clearing the display).
  it.each([
    ['a top-N of 0', 0 as number | '', 'pagerank', 'insightTopN'],
    ['a negative top-N', -3 as number | '', 'pagerank', 'insightTopN'],
    ['a fractional top-N', 2.5 as number | '', 'pagerank', 'insightTopN'],
    ['a top-N blanked by badInput while `by` is filled', '' as number | '', 'pagerank', 'insightTopN'],
    ['a non-word metric', 5 as number | '', 'in-degree', 'insightBy'],
    ['a metric left blank while N is filled', 5 as number | '', '', 'insightBy'],
  ])('reports %s', (_label, insightTopN, insightBy, code) => {
    expect(validateFormState({ ...base, insightTopN, insightBy: insightBy as string })).toContain(code);
  });
});

// Review fix (F1): the mode toggle knew only the DIRECTION of the switch, so an
// untouched expert -> guided -> expert round-trip overwrote hand-written JSON
// with the empty form's spec. Pristine-ness is the missing consent signal.
describe('isFormPristine', () => {
  it('is true for the empty state', () => {
    expect(isFormPristine(EMPTY_FORM_STATE)).toBe(true);
  });

  it('is true for a structurally equal copy (identity is not the test)', () => {
    expect(isFormPristine({ ...EMPTY_FORM_STATE, predicates: [{ field: '', op: '==', value: '' }] })).toBe(true);
  });

  it.each([
    ['name', { name: 'x' }],
    ['sourceLens', { sourceLens: 'sigil' }],
    ['meaning', { meaning: 'x' }],
    ['colorBy', { colorBy: 'domainType' }],
    ['colorScale', { colorScale: 'heat' as const }],
    ['insightTopN', { insightTopN: 5 }],
    ['insightBy', { insightBy: 'pagerank' }],
    ['a predicate field', { predicates: [{ field: 'status', op: '==' as const, value: '' }] }],
    ['a predicate op', { predicates: [{ field: '', op: 'in' as const, value: '' }] }],
    ['a predicate value', { predicates: [{ field: '', op: '==' as const, value: 'critical' }] }],
  ])('is false once %s is touched', (_label, patch) => {
    expect(isFormPristine({ ...EMPTY_FORM_STATE, ...patch })).toBe(false);
  });
});
