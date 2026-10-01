import { describe, it, expect } from 'vitest';
import { evaluateExpression } from '../../engine/src/core/expression/expression-evaluator';
import { evaluateExpr } from '@/lib/expression';

/**
 * A field expression as the form judges it and as the engine judges it on save. The two must
 * give the same value, or both fail; otherwise a field locks in the form unlike the save.
 */

type Outcome = { value: boolean } | { error: true };

const doc = {
  status: 'Closed',
  kind: 'b',
  qty: 3,
  price: 4,
  amount: '5',
  flag: 1,
  items: [] as unknown[],
  tags: ['x', 'y'],
  day: '2024-01-15',
  note: null,
};
const user = { email: 'rita@example.com', roles: ['Reception'], branch: 'North' };

const expressions = [
  "doc.status == 'Closed'",
  "doc.status != 'Closed'",
  "doc.status === 'Closed'",
  "doc.status !== 'Closed'",
  'doc.amount == 5',
  'doc.amount === 5',
  'doc.qty * doc.price > 10',
  'doc.qty + doc.price == 7',
  'doc.qty - 1 == 2 && doc.qty % 2 == 1',
  'doc.qty / doc.price < 1',
  "doc.kind in ['a', 'b']",
  "doc.kind not in ['a', 'b']",
  "'x' in doc.tags",
  'doc.flag == true',
  'doc.flag',
  '!doc.items',
  'doc.items',
  'doc.missing == null',
  'doc.note == null',
  'doc.missing > 0',
  "doc.day < '2024-02-01'",
  "doc.qty > 1 ? doc.status == 'Closed' : false",
  "!doc.flag == false",
  "(doc.status == 'Open' || doc.qty > 2) && !doc.note",
  "user.branch == 'North'",
  "user.email != null && doc.status == 'Closed'",
  "eval:doc.status=='Closed'",
  "doc.status = 'Closed'",
  'doc.status == Closed',
  "doc.status == 'Closed' and doc.qty",
  '(doc.qty',
  'doc.qty ==',
  'doc.constructor',
  'doc.f()',
];

function formOutcome(expression: string): Outcome {
  const result = evaluateExpr(expression, { doc, user });
  return result.error ? { error: true } : { value: result.value };
}

/** The engine answers a broken expression with the default its caller gives. */
function engineOutcome(expression: string): Outcome {
  const open = evaluateExpression(expression, { doc, user }, true);
  const closed = evaluateExpression(expression, { doc, user }, false);
  return open === closed ? { value: open } : { error: true };
}

describe('a field expression in the form and in the engine', () => {
  it.each(expressions)('%s', (expression) => {
    expect(formOutcome(expression)).toEqual(engineOutcome(expression));
  });

  it('covers expressions that hold, that fail to hold, and that are broken', () => {
    const outcomes = expressions.map(engineOutcome);
    expect(outcomes).toContainEqual({ value: true });
    expect(outcomes).toContainEqual({ value: false });
    expect(outcomes).toContainEqual({ error: true });
  });

  it('reports text the form cannot read after a whole expression', () => {
    expect(evaluateExpr("doc.status = 'Closed'", { doc: { status: 'Open' } }).error).toBeDefined();
    expect(evaluateExpr("doc.status == 'Closed'", { doc: { status: 'Open' } })).toEqual({ value: false });
  });
});
