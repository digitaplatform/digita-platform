import { describe, it, expect } from 'vitest';
import { FILTER_OPERATORS, operatorArity, type FilterOp, type OperatorArity } from '@/lib/filter-operators';

/**
 * A filter row picks its value control by the arity of its operator, so an arity no operator
 * has would promise a control that never shows. The record names every arity: the type check
 * fails when the type names one the record lacks, and the assertion when no operator has one.
 */
describe('operatorArity', () => {
  it('names only the arities an operator has', () => {
    const everyArity: Record<OperatorArity, true> = { single: true, range: true, multi: true, presence: true };
    const arities = new Set([...FILTER_OPERATORS].map((op) => operatorArity(op as FilterOp)));
    expect([...arities].sort()).toEqual(Object.keys(everyArity).sort());
  });
});
