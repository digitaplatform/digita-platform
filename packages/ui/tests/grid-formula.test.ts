import { describe, it, expect } from 'vitest';
import { evalFormula } from '@/lib/grid-formula';

const row = { qty: 3, rate: 10, base: 6, status: 'active', adj: 0 };
const scope = { doc: row, row };

describe('evalFormula', () => {
  it('does arithmetic with precedence and parentheses', () => {
    expect(evalFormula('eval:doc.qty * doc.rate', scope).value).toBe(30);
    expect(evalFormula('eval:doc.qty * doc.rate - doc.base', scope).value).toBe(24);
    expect(evalFormula('eval:(doc.rate - doc.base) / doc.rate * 100', scope).value).toBeCloseTo(40);
  });

  it('evaluates comparisons and logic', () => {
    expect(evalFormula('eval:doc.qty > 2', scope).value).toBe(true);
    expect(evalFormula('eval:doc.status == "active"', scope).value).toBe(true);
    expect(evalFormula('eval:doc.qty > 2 && doc.rate < 5', scope).value).toBe(false);
    expect(evalFormula('eval:doc.adj == 0 || doc.qty > 100', scope).value).toBe(true);
  });

  it('supports unary minus and not', () => {
    expect(evalFormula('eval:-doc.base', scope).value).toBe(-6);
    expect(evalFormula('eval:!(doc.qty > 5)', scope).value).toBe(true);
  });

  it('returns NaN for arithmetic over an unknown path (no throw)', () => {
    const r = evalFormula('eval:doc.missing * 2', scope);
    expect(Number.isNaN(r.value as number)).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('reports a parse error without throwing', () => {
    const r = evalFormula('eval:doc.a +', scope);
    expect(r.error).toBeDefined();
    expect(r.value).toBeUndefined();
  });

  it('rejects function calls', () => {
    expect(evalFormula('eval:alert(1)', scope).error).toBeDefined();
  });

  it('strips the eval: prefix and also works without it', () => {
    expect(evalFormula('doc.qty + 1', scope).value).toBe(4);
  });

  it('concatenates strings with +', () => {
    expect(evalFormula('eval:doc.status + "!"', scope).value).toBe('active!');
  });
});
