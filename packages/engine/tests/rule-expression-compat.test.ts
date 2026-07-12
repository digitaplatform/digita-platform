// COMPAT CORPUS — rule-expression evaluator migration proof (D1).
//
// This table locks the observable behaviour of EVERY expression that exists in
// the wild (the 2 shipped rule files + the three rule test files) plus the
// intentional-diff probes, so the F1 migration from the hand-rolled Pratt
// parser to the shared jsep walker is proven equivalent BEFORE the old
// evaluator is deleted.
//
// `PHASE` selects which column the intentional-diff rows assert:
//   - Stage 0 (Pratt still present):  PHASE = "pratt"
//   - Stage 1 (F1, jsep adapter):     PHASE = "jsep"
// Recorded literals (not a live old-vs-new comparison) keep this corpus usable
// forever — after F1 the Pratt code is gone.
import { describe, it, expect } from "vitest";
import {
  evaluateExpression,
  type RuleExprContext,
} from "../src/core/rules/rule-expression.js";

// F1 landed: the Pratt parser is deleted and rule-expression.ts is a jsep
// adapter, so the intentional-diff rows now assert their `jsep` column.
const PHASE: "pratt" | "jsep" = "jsep";

/** Sentinel: this expression THROWS in the given phase. */
const THROWS = Symbol("throws");

type Expected = unknown | typeof THROWS;
interface Row {
  expr: string;
  ctx: RuleExprContext;
  // Either a single `expected` (identical in both worlds) or a per-phase pair.
  expected?: Expected;
  pratt?: Expected;
  jsep?: Expected;
}

function expectedFor(row: Row): Expected {
  if ("pratt" in row || "jsep" in row) {
    return PHASE === "pratt" ? row.pratt : row.jsep;
  }
  return row.expected;
}

function check(row: Row): void {
  const expected = expectedFor(row);
  if (expected === THROWS) {
    expect(() => evaluateExpression(row.expr, row.ctx)).toThrow();
    return;
  }
  const actual = evaluateExpression(row.expr, row.ctx);
  if (expected === undefined) {
    expect(actual).toBeUndefined();
  } else if (expected === null) {
    expect(actual).toBeNull();
  } else if (typeof expected === "object") {
    expect(actual).toEqual(expected);
  } else {
    expect(actual).toBe(expected);
  }
}

// ── Contexts ──────────────────────────────────────────────────────────────
const menu = (doc: Record<string, unknown>): RuleExprContext => ({ doc });
const MENU_COND =
  "(doc.kind == 'tree_root') || (doc.kind == 'group') || (doc.kind == 'divider') || (doc.kind == 'entity' && doc.target_entity) || (doc.kind == 'url' && doc.target_url) || (doc.kind == 'external_link' && doc.target_url)";

const stockNow = new Date("2026-07-05T10:00:00Z");
const stockCtx: RuleExprContext = {
  doc: { warehouse: "WH-1", stocktake_no: "ST-001", lines: [{ product: "P-1", delta: 3 }] },
  row: { product: "P-1", delta: 3 },
  now: stockNow,
};

const exprCtx: RuleExprContext = {
  doc: { qty: 5, status: "open", lines: [1, 2, 3] },
  row: { delta: 2, product: "P-1" },
  user: { email: "a@b.c" },
  item: { x: 7 },
};

// ── 1. UserMenu rule condition against every kind shape ─────────────────────
describe("compat corpus — UserMenu rule condition", () => {
  const rows: Row[] = [
    { expr: MENU_COND, ctx: menu({ kind: "tree_root" }), expected: true },
    { expr: MENU_COND, ctx: menu({ kind: "group" }), expected: true },
    { expr: MENU_COND, ctx: menu({ kind: "divider" }), expected: true },
    // entity WITH target: the `&&` yields the operand (the target string), and
    // the `||` chain returns it — a truthy non-boolean. Identical in both worlds.
    { expr: MENU_COND, ctx: menu({ kind: "entity", target_entity: "Customer" }), expected: "Customer" },
    // entity WITHOUT target → whole chain falsy → false (rule rejects).
    { expr: MENU_COND, ctx: menu({ kind: "entity" }), expected: false },
    { expr: MENU_COND, ctx: menu({ kind: "url", target_url: "http://x" }), expected: "http://x" },
    { expr: MENU_COND, ctx: menu({ kind: "url" }), expected: false },
    { expr: MENU_COND, ctx: menu({ kind: "external_link", target_url: "http://x" }), expected: "http://x" },
    { expr: MENU_COND, ctx: menu({ kind: "unknown" }), expected: false },
  ];
  for (const row of rows) {
    it(`${JSON.stringify(row.ctx.doc)}`, () => check(row));
  }
});

// ── 2. Stocktake rule strings ───────────────────────────────────────────────
describe("compat corpus — stocktake rule", () => {
  const rows: Row[] = [
    { expr: "doc.lines", ctx: stockCtx, expected: [{ product: "P-1", delta: 3 }] },
    { expr: "row.delta != 0", ctx: stockCtx, expected: true },
    { expr: "row.delta != 0", ctx: { row: { delta: 0 } }, expected: false },
    // The mapping table from rule-expression.test.ts:108-131.
    { expr: "now", ctx: stockCtx, expected: stockNow },
    { expr: "doc.warehouse", ctx: stockCtx, expected: "WH-1" },
    { expr: "row.product", ctx: stockCtx, expected: "P-1" },
    { expr: "row.delta", ctx: stockCtx, expected: 3 },
    { expr: "'adjustment'", ctx: stockCtx, expected: "adjustment" },
    { expr: "'Stocktake'", ctx: stockCtx, expected: "Stocktake" },
    { expr: "doc.stocktake_no", ctx: stockCtx, expected: "ST-001" },
    {
      expr: "'Stocktake adjustment ' + doc.stocktake_no",
      ctx: stockCtx,
      expected: "Stocktake adjustment ST-001",
    },
  ];
  for (const row of rows) {
    it(`${row.expr}`, () => check(row));
  }
});

// ── 3. Every expression in the rule test files ──────────────────────────────
describe("compat corpus — rule test-file expressions", () => {
  const rows: Row[] = [
    { expr: "doc.qty", ctx: exprCtx, expected: 5 },
    { expr: "row.delta", ctx: exprCtx, expected: 2 },
    { expr: "user.email", ctx: exprCtx, expected: "a@b.c" },
    { expr: "item.x", ctx: exprCtx, expected: 7 },
    { expr: "doc.qty * 2", ctx: exprCtx, expected: 10 },
    { expr: "doc.status == 'open'", ctx: exprCtx, expected: true },
    { expr: "doc.lines.length", ctx: exprCtx, expected: 3 },
    { expr: "doc.qty || 0", ctx: exprCtx, expected: 5 },
    { expr: "row.missing || 42", ctx: exprCtx, expected: 42 },
    { expr: "doc.status && doc.qty", ctx: exprCtx, expected: 5 },
    { expr: "row.missing || doc.qty", ctx: exprCtx, expected: 5 },
  ];
  for (const row of rows) {
    it(`${row.expr}`, () => check(row));
  }
});

// ── 4. Intentional-diff probes (Pratt vs jsep raw-JS, D1 locked) ────────────
describe("compat corpus — intentional diffs", () => {
  const rows: Row[] = [
    // Missing property identity: Pratt `undefined`, jsep `null` (both falsy,
    // only the identity of the falsy operand changes). `&&` returns the left.
    { expr: "row.missing && doc.qty", ctx: exprCtx, pratt: undefined, jsep: null },
    // Relational coercion: Pratt Number()-coerces operands, jsep uses raw JS.
    { expr: "'5' < '10'", ctx: exprCtx, pratt: true, jsep: false },
    // Missing operand in arithmetic: Pratt Number(undefined)=NaN; jsep null+1=1.
    { expr: "doc.missing + 1", ctx: exprCtx, pratt: NaN, jsep: 1 },
    // Security probes: Pratt silently returns undefined (root not allowlisted);
    // the jsep adapter THROWS (no such root in the map) — posture improves,
    // still no data leak.
    {
      expr: "session.client.options.credentials.password",
      ctx: { doc: {}, session: { client: { options: { credentials: { password: "PW" } } } } } as RuleExprContext,
      pratt: undefined,
      jsep: THROWS,
    },
    { expr: "entityName", ctx: { doc: {}, entityName: "Widget" } as RuleExprContext, pratt: undefined, jsep: THROWS },
    { expr: "doc.__proto__", ctx: menu({ kind: "x" }), pratt: undefined, jsep: THROWS },
    { expr: "doc.constructor", ctx: menu({ kind: "x" }), pratt: undefined, jsep: THROWS },
    // Newly-legal ternary: Pratt has no `?:` (unexpected char) → throws;
    // jsep supports it.
    { expr: "doc.qty > 0 ? 'y' : 'n'", ctx: exprCtx, pratt: THROWS, jsep: "y" },
  ];
  for (const row of rows) {
    it(`${row.expr}`, () => check(row));
  }
});

// ── 5. Tokens are invalid in the condition/expression slot in BOTH worlds ────
// ($now / $root become valid TOKENS in value slots after F1 — proven in the
// rule-expression + seed-guard tests, not here.)
describe("compat corpus — tokens rejected in expression slot", () => {
  it("$now throws as a bare expression", () => {
    expect(() => evaluateExpression("$now", exprCtx)).toThrow();
  });
  it("$root.warehouse throws as a bare expression", () => {
    expect(() => evaluateExpression("$root.warehouse", exprCtx)).toThrow();
  });
});
