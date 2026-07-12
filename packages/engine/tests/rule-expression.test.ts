// Security + correctness tests for the rule-expression evaluator.
//
// C2 regression: the evaluation context handed to the evaluator also carries
// the live database `session` (a driver ClientSession whose
// `.client.options.credentials` exposes the shared-cluster password) and the
// internal `entityName`. Before the fix, `resolvePath` walked any dot-path from
// any context key, so an operator-authored rule expression like
// `session.client.options.credentials.password` read the cluster secret through
// pure property access (no function call). The fix allowlists the data roots a
// rule may reference and blocks prototype-escape segments.
import { describe, it, expect } from "vitest";
import {
  evaluateExpression,
  evaluateMapping,
  type RuleExprContext,
} from "../src/core/rules/rule-expression.js";

describe("rule-expression sandbox (C2)", () => {
  // Mirrors the real context rule-engine.ts builds: data fields plus the live
  // session object carrying a secret.
  const SECRET = "SUPER_SECRET_CLUSTER_PW";
  const attackCtx: RuleExprContext = {
    doc: { qty: 5 },
    session: { client: { options: { credentials: { password: SECRET } } } },
    entityName: "Widget",
  };

  it("cannot read the live session (cluster DB password) via a path expression", () => {
    // The unified evaluator has no `session` root — the identifier resolver
    // THROWS (posture upgrade over the old silent-undefined). No secret leaks.
    expect(() =>
      evaluateExpression("session.client.options.credentials.password", attackCtx),
    ).toThrow(/Identifier/);
  });

  it("cannot exfiltrate the session secret through a field mapping (set_value vector)", () => {
    expect(() =>
      evaluateMapping({ note: "session.client.options.credentials.password" }, attackCtx),
    ).toThrow(/Identifier/);
  });

  it("cannot reach the internal entityName root", () => {
    expect(() => evaluateExpression("entityName", attackCtx)).toThrow(/Identifier/);
  });

  it("blocks prototype-escape segments", () => {
    const ctx: RuleExprContext = { doc: { qty: 1 } };
    expect(() => evaluateExpression("doc.__proto__", ctx)).toThrow();
    expect(() => evaluateExpression("doc.constructor", ctx)).toThrow();
    expect(() => evaluateExpression("doc.__proto__.polluted", ctx)).toThrow();
  });
});

describe("rule-expression legit paths still work", () => {
  const ctx: RuleExprContext = {
    doc: { qty: 5, status: "open", lines: [1, 2, 3] },
    row: { delta: 2, product: "P-1" },
    user: { email: "a@b.c" },
    item: { x: 7 },
  };

  it("reads allowlisted roots", () => {
    expect(evaluateExpression("doc.qty", ctx)).toBe(5);
    expect(evaluateExpression("row.delta", ctx)).toBe(2);
    expect(evaluateExpression("user.email", ctx)).toBe("a@b.c");
    expect(evaluateExpression("item.x", ctx)).toBe(7);
  });

  it("supports arithmetic, comparison and array length", () => {
    expect(evaluateExpression("doc.qty * 2", ctx)).toBe(10);
    expect(evaluateExpression("doc.status == 'open'", ctx)).toBe(true);
    expect(evaluateExpression("row.delta != 0", ctx)).toBe(true);
    expect(evaluateExpression("doc.lines.length", ctx)).toBe(3);
  });

  it("evaluates a field mapping the way a rule action does", () => {
    const out = evaluateMapping({ product: "row.product", quantity: "row.delta" }, ctx);
    expect(out).toEqual({ product: "P-1", quantity: 2 });
  });

  it("|| and && return operands (JS semantics), not coerced booleans", () => {
    // `x || default` must keep x's VALUE — collapsing it to true/false corrupts a
    // numeric field the mapping writes to.
    expect(evaluateExpression("doc.qty || 0", ctx)).toBe(5);
    expect(evaluateExpression("row.missing || 42", ctx)).toBe(42);
    expect(evaluateExpression("doc.status && doc.qty", ctx)).toBe(5); // both truthy → last
    expect(evaluateExpression("row.missing && doc.qty", ctx)).toBeNull(); // first falsy (null) → it
    // A mapping using the `|| default` idiom persists the operand, not a boolean.
    expect(evaluateMapping({ q: "row.missing || doc.qty" }, ctx)).toEqual({ q: 5 });
  });
});

describe("stocktake rule mappings evaluate (C3)", () => {
  // Mirrors the shipped erp rule field_mappings after the C3 rewrite to
  // supported rule-expression syntax (see
  // digitaapps/erp/stock/rules/stocktake-on-submit-emit-movements.rule.json).
  // Pre-fix these used $now/$root and unquoted string literals, so every
  // evaluation threw ("unexpected char: $") or resolved to undefined.
  const now = new Date("2026-07-05T10:00:00Z");
  const ctx: RuleExprContext = {
    doc: { warehouse: "WH-1", stocktake_no: "ST-001", lines: [{ product: "P-1", delta: 3 }] },
    row: { product: "P-1", delta: 3 },
    now,
  };

  it("resolves every mapping to its intended value without throwing", () => {
    const out = evaluateMapping(
      {
        posted_at: "now",
        warehouse: "doc.warehouse",
        product: "row.product",
        quantity: "row.delta",
        kind: "'adjustment'",
        source_doctype: "'Stocktake'",
        source_name: "doc.stocktake_no",
        narration: "'Stocktake adjustment ' + doc.stocktake_no",
      },
      ctx,
    );
    expect(out).toEqual({
      posted_at: now,
      warehouse: "WH-1",
      product: "P-1",
      quantity: 3,
      kind: "adjustment",
      source_doctype: "Stocktake",
      source_name: "ST-001",
      narration: "Stocktake adjustment ST-001",
    });
  });

  it("still evaluates the rule condition row.delta != 0", () => {
    expect(evaluateExpression("row.delta != 0", ctx)).toBe(true);
    expect(evaluateExpression("row.delta != 0", { row: { delta: 0 } })).toBe(false);
  });
});
