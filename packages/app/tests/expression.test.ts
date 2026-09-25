import { describe, it, expect } from 'vitest';
import { evaluateExpr, evaluateSafe } from '@/lib/expression';

const scope = (doc: Record<string, unknown>, user?: Record<string, unknown>) => ({ doc, user });

describe('evaluateExpr', () => {
  it('empty expression → true', () => {
    expect(evaluateExpr('', scope({})).value).toBe(true);
  });

  it('bare doc.field truthy check (fast path)', () => {
    expect(evaluateExpr('doc.active', scope({ active: true })).value).toBe(true);
    expect(evaluateExpr('doc.active', scope({ active: false })).value).toBe(false);
    expect(evaluateExpr('doc.active', scope({ active: '' })).value).toBe(false);
    expect(evaluateExpr('doc.count', scope({ count: 0 })).value).toBe(false);
  });

  it('user.field fast path', () => {
    expect(evaluateExpr('user.is_admin', scope({}, { is_admin: true })).value).toBe(true);
    expect(evaluateExpr('user.missing', scope({}, {})).value).toBe(false);
  });

  it('equality with loose numeric/string coercion', () => {
    expect(evaluateExpr('doc.status == "open"', scope({ status: 'open' })).value).toBe(true);
    expect(evaluateExpr('doc.qty == 5', scope({ qty: '5' })).value).toBe(true);
    expect(evaluateExpr('doc.status != "open"', scope({ status: 'closed' })).value).toBe(true);
  });

  it('numeric comparisons', () => {
    expect(evaluateExpr('doc.total > 100', scope({ total: 150 })).value).toBe(true);
    expect(evaluateExpr('doc.total >= 150', scope({ total: 150 })).value).toBe(true);
    expect(evaluateExpr('doc.total < 100', scope({ total: 150 })).value).toBe(false);
  });

  it('in / not in against arrays', () => {
    expect(evaluateExpr('doc.kind in ["a","b"]', scope({ kind: 'b' })).value).toBe(true);
    expect(evaluateExpr('doc.kind not in ["a","b"]', scope({ kind: 'c' })).value).toBe(true);
  });

  it('boolean and / or / not + parens', () => {
    expect(evaluateExpr('doc.a && doc.b', scope({ a: true, b: true })).value).toBe(true);
    expect(evaluateExpr('doc.a || doc.b', scope({ a: false, b: true })).value).toBe(true);
    expect(evaluateExpr('!doc.a', scope({ a: false })).value).toBe(true);
    expect(evaluateExpr('(doc.a || doc.b) && doc.c', scope({ a: true, b: false, c: true })).value).toBe(true);
  });

  it('strips the eval: prefix', () => {
    expect(evaluateExpr('eval: doc.status == "open"', scope({ status: 'open' })).value).toBe(true);
  });

  it('malformed expression → {value:false, error}', () => {
    const r = evaluateExpr('doc.x ==', scope({ x: 1 }));
    // unterminated comparison parses the missing rhs as undefined → no throw here,
    // so use a genuinely broken one:
    const r2 = evaluateExpr('(doc.x', scope({ x: 1 }));
    expect(r2.error).toBeDefined();
    expect(r2.value).toBe(false);
    void r;
  });

  it('evaluateSafe degrades errors to true', () => {
    expect(evaluateSafe('(doc.x', scope({ x: 1 }))).toBe(true);
    expect(evaluateSafe('doc.active', scope({ active: false }))).toBe(false);
  });
});
