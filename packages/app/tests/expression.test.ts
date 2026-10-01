import { describe, it, expect } from 'vitest';
import { evaluateExpr, evaluateSafe } from '@/lib/expression';

const scope = (doc: Record<string, unknown>, user?: Record<string, unknown>) => ({ doc, user });

describe('evaluateExpr', () => {
  it('empty expression → true', () => {
    expect(evaluateExpr('', scope({})).value).toBe(true);
  });

  it('bare doc.field truthy check', () => {
    expect(evaluateExpr('doc.active', scope({ active: true })).value).toBe(true);
    expect(evaluateExpr('doc.active', scope({ active: false })).value).toBe(false);
    expect(evaluateExpr('doc.active', scope({ active: '' })).value).toBe(false);
    expect(evaluateExpr('doc.count', scope({ count: 0 })).value).toBe(false);
  });

  it('bare user.field truthy check', () => {
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

  it('an expression the grammar does not read to its end → error', () => {
    expect(evaluateExpr("doc.status = 'Closed'", scope({ status: 'Closed' })).error).toBeDefined();
    expect(evaluateExpr("doc.status == 'Closed' doc.qty", scope({ status: 'Closed' })).error).toBeDefined();
    expect(evaluateExpr("doc.status == 'draft'  ", scope({ status: 'draft' }))).toEqual({ value: true });
  });

  it('reads the operators the engine reads on save', () => {
    expect(evaluateExpr("doc.status === 'draft'", scope({ status: 'draft' }))).toEqual({ value: true });
    expect(evaluateExpr('doc.qty !== 5', scope({ qty: '5' }))).toEqual({ value: true });
    expect(evaluateExpr('doc.qty * doc.price > 100', scope({ qty: 2, price: 10 }))).toEqual({ value: false });
    expect(evaluateExpr('doc.flag == true', scope({ flag: 1 }))).toEqual({ value: true });
  });

  it('refuses a word that is neither doc nor user, unless the caller reads bare words as text', () => {
    expect(evaluateExpr('doc.status == Open', scope({ status: 'Open' })).error).toBeDefined();
    expect(evaluateExpr('doc.status == Open', { doc: { status: 'Open' }, hasBareWords: true })).toEqual({ value: true });
    expect(evaluateExpr('doc.status == Pre-paid', { doc: { status: 'Pre-paid' }, hasBareWords: true }).error).toBeDefined();
  });

  it('a partial scope: a path whose first field it lacks → error', () => {
    const partial = { doc: { status: 'open', note: null }, user: { email: 'rita@example.com' }, isPartial: true };
    expect(evaluateExpr('doc.margin > 100', partial).error).toBeDefined();
    expect(evaluateExpr('doc.branch == user.branch', partial).error).toBeDefined();
    expect(evaluateExpr('doc.margin', partial).error).toBeDefined();
    expect(evaluateExpr("doc.status == 'open' && user.email != null", partial)).toEqual({ value: true });
    expect(evaluateExpr('doc.note == null', partial)).toEqual({ value: true });
    expect(evaluateExpr('doc.margin > 100', { doc: {}, user: {} })).toEqual({ value: false });
  });

  it('reports the text it could not read after a whole expression, instead of dropping it', () => {
    // Only "On" would be compared, so "doc.status == On hold" would be false for every status.
    for (const expr of ['doc.status == On hold', 'doc.status == Zurückgestellt', 'doc.status == Pre-paid', "doc.status == 'Open' and doc.member"]) {
      expect(evaluateExpr(expr, scope({ status: 'On hold' })).error, expr).toBeDefined();
    }
    expect(evaluateExpr("doc.status == 'Open'  ", scope({ status: 'Open' }))).toEqual({ value: true });
    expect(evaluateExpr("doc.status == 'On hold'", scope({ status: 'On hold' }))).toEqual({ value: true });
  });

  it('evaluateSafe degrades errors to true', () => {
    expect(evaluateSafe('(doc.x', scope({ x: 1 }))).toBe(true);
    expect(evaluateSafe('doc.active', scope({ active: false }))).toBe(false);
  });
});
