import { describe, it, expect } from "vitest";
import {
  evaluateExpression,
  evaluateExpressionValue,
  evaluateExpressionValueIn,
  assertExpressionParsableIn,
} from "../src/core/expression/expression-evaluator.js";
import type { ExpressionContext } from "../src/core/expression/expression-evaluator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(
  doc: Record<string, unknown>,
  user?: Record<string, unknown>,
): ExpressionContext {
  return { doc, user };
}

// ---------------------------------------------------------------------------
// 1. Empty / null / falsy expression
// ---------------------------------------------------------------------------

describe("evaluateExpression — empty / null expression", () => {
  it("returns true for empty string", () => {
    expect(evaluateExpression("", ctx({}))).toBe(true);
  });

  it("returns true for whitespace-only string", () => {
    // The function trims the expression; after trim it becomes "", but
    // the initial falsy guard fires first (empty string is falsy).
    expect(evaluateExpression("   ", ctx({}))).toBe(true);
  });

  // Testing JS callers passing null/undefined (cast through unknown).
  it("returns true for null", () => {
    expect(evaluateExpression(null as unknown as string, ctx({}))).toBe(true);
  });

  it("returns true for undefined", () => {
    expect(
      evaluateExpression(undefined as unknown as string, ctx({})),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1b. safeDefault — visibility fails OPEN, access conditions fail CLOSED
// ---------------------------------------------------------------------------

describe("evaluateExpression — safeDefault on parse error", () => {
  // A single '=' is an AssignmentExpression → disallowed node → throws internally.
  const broken = "eval:doc.status = 'published'";

  it("defaults to true (fail-open) for visibility expressions", () => {
    expect(evaluateExpression(broken, ctx({ status: "draft" }))).toBe(true);
  });

  it("defaults to false (fail-CLOSED) when safeDefault=false (access conditions)", () => {
    expect(evaluateExpression(broken, ctx({ status: "draft" }), false)).toBe(false);
    // A well-formed access condition still evaluates normally.
    expect(
      evaluateExpression("eval:doc.status=='published'", ctx({ status: "published" }), false),
    ).toBe(true);
    expect(
      evaluateExpression("eval:doc.status=='published'", ctx({ status: "draft" }), false),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. "eval:" prefix stripping
// ---------------------------------------------------------------------------

describe("evaluateExpression — eval: prefix stripping", () => {
  it("strips 'eval:' prefix and evaluates the remainder", () => {
    expect(
      evaluateExpression("eval:doc.status=='Active'", ctx({ status: "Active" })),
    ).toBe(true);
  });

  it("strips 'eval:' with leading whitespace in remainder", () => {
    expect(
      evaluateExpression("eval:  doc.status=='Active'", ctx({ status: "Active" })),
    ).toBe(true);
  });

  it("does NOT strip 'eval:' when it appears mid-string (treated as normal expr)", () => {
    // "noteval:doc.status" does not start with "eval:" so it goes through
    // the AST path. That will likely fail / return true as default.
    expect(
      evaluateExpression("noteval:doc.status", ctx({ status: "Active" })),
    ).toBe(true); // falls through to error-safe default
  });

  it("prefix stripping works even when the expression itself is a truthy check", () => {
    expect(
      evaluateExpression("eval:doc.customer", ctx({ customer: "Acme" })),
    ).toBe(true);
  });

  it("prefix stripping works when the field is falsy", () => {
    expect(
      evaluateExpression("eval:doc.customer", ctx({ customer: "" })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Simple truthy checks — "doc.fieldname"
// ---------------------------------------------------------------------------

describe("evaluateExpression — simple truthy field check", () => {
  it("returns true when string field has a value", () => {
    expect(evaluateExpression("doc.name", ctx({ name: "Alice" }))).toBe(true);
  });

  it("returns false when string field is empty string", () => {
    expect(evaluateExpression("doc.name", ctx({ name: "" }))).toBe(false);
  });

  it("returns false when field is null", () => {
    expect(evaluateExpression("doc.status", ctx({ status: null }))).toBe(false);
  });

  it("returns false when field is undefined (missing key)", () => {
    expect(evaluateExpression("doc.status", ctx({}))).toBe(false);
  });

  it("returns false when field is 0", () => {
    expect(evaluateExpression("doc.qty", ctx({ qty: 0 }))).toBe(false);
  });

  it("returns true when field is a non-zero number", () => {
    expect(evaluateExpression("doc.qty", ctx({ qty: 42 }))).toBe(true);
  });

  it("returns false when field is false", () => {
    expect(evaluateExpression("doc.active", ctx({ active: false }))).toBe(false);
  });

  it("returns true when field is true", () => {
    expect(evaluateExpression("doc.active", ctx({ active: true }))).toBe(true);
  });

  it("returns false when field is an empty array", () => {
    expect(evaluateExpression("doc.items", ctx({ items: [] }))).toBe(false);
  });

  it("returns true when field is a non-empty array", () => {
    expect(
      evaluateExpression("doc.items", ctx({ items: ["a", "b"] })),
    ).toBe(true);
  });

  it("returns true when field is a non-null object", () => {
    expect(evaluateExpression("doc.meta", ctx({ meta: { x: 1 } }))).toBe(true);
  });

  it("does NOT treat 'doc.field.nested' as a simple truthy check (goes to AST)", () => {
    // The regex only matches exactly "doc.<word>"; nested access hits evaluateAst.
    // After replacement the expression becomes something JS can't parse — returns true.
    expect(
      evaluateExpression("doc.address.city", ctx({ address: { city: "Berlin" } })),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Comparison operators
//
// The assignment guard regex /(?<![=!<>])=(?!=)/ blocks bare assignment (x=1)
// while allowing all comparison operators (==, ===, !=, !==, >=, <=).
// The negative lookbehind ensures the `=` is not preceded by =, !, <, or >.
// ---------------------------------------------------------------------------

describe("evaluateExpression — comparison operators", () => {
  const docCtx = ctx({ status: "Active", total: 100, docstatus: 1 });

  // --- Equality operators ---

  it("== equal — true when values match", () => {
    expect(evaluateExpression("eval:doc.status=='Active'", docCtx)).toBe(true);
  });

  it("== equal — false when values differ", () => {
    expect(evaluateExpression("eval:doc.status=='Cancelled'", docCtx)).toBe(false);
  });

  it("=== strict equal — true when values match", () => {
    expect(evaluateExpression("eval:doc.docstatus===1", docCtx)).toBe(true);
  });

  it("!= not equal — true when values differ", () => {
    expect(
      evaluateExpression("eval:doc.status!='Cancelled'", docCtx),
    ).toBe(true);
  });

  it("!== strict not equal — true when type differs", () => {
    expect(
      evaluateExpression("eval:doc.docstatus!=='1'", docCtx),
    ).toBe(true);
  });

  it(">= greater or equal — true at boundary", () => {
    expect(evaluateExpression("eval:doc.total>=100", docCtx)).toBe(true);
  });

  it("<= less or equal — true at boundary", () => {
    expect(evaluateExpression("eval:doc.total<=100", docCtx)).toBe(true);
  });

  // --- evaluateExpressionValue with comparison operators ---

  it("== in evaluateExpressionValue — returns true for matching values", () => {
    expect(
      evaluateExpressionValue("eval:doc.status=='Active'", docCtx),
    ).toBe(true);
  });

  it(">= in evaluateExpressionValue — returns true at boundary", () => {
    expect(
      evaluateExpressionValue("eval:doc.total>=100", docCtx),
    ).toBe(true);
  });

  // --- Greater/less than ---

  it("> greater than — true", () => {
    expect(evaluateExpression("eval:doc.total>50", docCtx)).toBe(true);
  });

  it("> greater than — false", () => {
    expect(evaluateExpression("eval:doc.total>200", docCtx)).toBe(false);
  });

  it("< less than — true (passes through correctly)", () => {
    expect(evaluateExpression("eval:doc.total<200", docCtx)).toBe(true);
  });

  it("< less than — false (passes through correctly)", () => {
    expect(evaluateExpression("eval:doc.total<50", docCtx)).toBe(false);
  });

  it("> with numeric literal zero — false when field is 0", () => {
    expect(evaluateExpression("eval:doc.total>0", ctx({ total: 0 }))).toBe(false);
  });

  it("> with negative field value", () => {
    expect(evaluateExpression("eval:doc.balance>0", ctx({ balance: -5 }))).toBe(false);
  });

  it("< with negative comparand", () => {
    expect(evaluateExpression("eval:doc.balance<0", ctx({ balance: -5 }))).toBe(true);
  });

  it("missing doc field substituted as null — null > 0 → false", () => {
    expect(evaluateExpression("eval:doc.nonexistent>0", ctx({}))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Logical operators
//
// Expressions that use only `>` and `<` (without trailing `=`) pass through
// correctly. Expressions mixing `==` etc. are blocked (safe default = true).
// Pure boolean/numeric expressions and those using only `>` / `<` work fine.
// ---------------------------------------------------------------------------

describe("evaluateExpression — logical operators", () => {
  const docCtx = ctx({
    status: "Active",
    total: 200,
    docstatus: 1,
  });

  // --- Pure > / < comparisons work correctly ---

  it("&& with two > checks — both true → true", () => {
    expect(
      evaluateExpression("eval:doc.total>100 && doc.total<300", docCtx),
    ).toBe(true);
  });

  it("&& with two > checks — one false → false", () => {
    expect(
      evaluateExpression("eval:doc.total>100 && doc.total>500", docCtx),
    ).toBe(false);
  });

  it("|| with > checks — first true → true", () => {
    expect(
      evaluateExpression("eval:doc.total>500 || doc.total>100", docCtx),
    ).toBe(true);
  });

  it("|| with > checks — both false → false", () => {
    expect(
      evaluateExpression("eval:doc.total>500 || doc.total>1000", docCtx),
    ).toBe(false);
  });

  it("! negation of > — negates true → false", () => {
    expect(
      evaluateExpression("eval:!(doc.total>100)", docCtx),
    ).toBe(false);
  });

  it("! negation of > — negates false → true", () => {
    expect(
      evaluateExpression("eval:!(doc.total>500)", docCtx),
    ).toBe(true);
  });

  it("pure boolean && without field comparison", () => {
    expect(
      evaluateExpression("eval:true && true", ctx({})),
    ).toBe(true);
  });

  it("pure boolean && — one false", () => {
    expect(
      evaluateExpression("eval:true && false", ctx({})),
    ).toBe(false);
  });

  it("pure boolean || — both false", () => {
    expect(
      evaluateExpression("eval:false || false", ctx({})),
    ).toBe(false);
  });

  it("pure boolean || — one true", () => {
    expect(
      evaluateExpression("eval:false || true", ctx({})),
    ).toBe(true);
  });

  // --- Expressions with == now evaluate correctly ---

  it("&& mixing == and > — false because total>500 is false", () => {
    expect(
      evaluateExpression(
        "eval:doc.status=='Active' && doc.total>500",
        docCtx,
      ),
    ).toBe(false);
  });

  it("complex chain with == — true because status matches and total>0", () => {
    expect(
      evaluateExpression(
        "eval:(doc.status=='Active' || doc.status=='Draft') && doc.total>0",
        docCtx,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Ternary operator
//
// All comparison operators work in ternary conditions now that the
// assignment guard uses a negative lookbehind.
// ---------------------------------------------------------------------------

describe("evaluateExpression — ternary operator", () => {
  it("ternary with == condition — evaluateExpressionValue returns truthy branch", () => {
    expect(
      evaluateExpressionValue(
        "eval:doc.status=='Active' ? 'yes' : 'no'",
        ctx({ status: "Active" }),
      ),
    ).toBe("yes");
  });

  it("ternary with == condition — evaluateExpression returns true (truthy string result)", () => {
    expect(
      evaluateExpression(
        "eval:doc.status=='Active' ? 'yes' : 'no'",
        ctx({ status: "Active" }),
      ),
    ).toBe(true);
  });

  // Ternaries with > / < work correctly
  it("ternary with > condition — evaluateExpressionValue returns truthy branch value", () => {
    expect(
      evaluateExpressionValue(
        "eval:doc.qty>0 ? doc.qty : 0",
        ctx({ qty: 5 }),
      ),
    ).toBe(5);
  });

  it("ternary with > condition — evaluateExpressionValue returns falsy branch value", () => {
    expect(
      evaluateExpressionValue(
        "eval:doc.qty>0 ? doc.qty : 0",
        ctx({ qty: 0 }),
      ),
    ).toBe(0);
  });

  it("ternary using boolean field — truthy branch, result is a string → evaluateExpression true", () => {
    expect(
      evaluateExpression(
        "eval:doc.active ? 'enabled' : ''",
        ctx({ active: true }),
      ),
    ).toBe(true);
  });

  it("ternary using boolean field — falsy branch is empty string → evaluateExpression false", () => {
    expect(
      evaluateExpression(
        "eval:doc.active ? 'enabled' : ''",
        ctx({ active: false }),
      ),
    ).toBe(false);
  });

  it("ternary returning numbers — evaluateExpressionValue returns number", () => {
    expect(
      evaluateExpressionValue(
        "eval:doc.qty>10 ? 100 : 0",
        ctx({ qty: 20 }),
      ),
    ).toBe(100);
  });

  it("ternary with arithmetic — evaluateExpressionValue returns computed number", () => {
    expect(
      evaluateExpressionValue(
        "eval:doc.flag ? doc.a+doc.b : 0",
        ctx({ flag: true, a: 3, b: 4 }),
      ),
    ).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 7. User context access
//
// user.field tokens are substituted exactly like doc.field. Expressions that
// then use `==` etc. are still blocked by the /=(?!=)/ guard (returning the
// safe default). Only expressions free of trailing-= operators evaluate fully.
// ---------------------------------------------------------------------------

describe("evaluateExpression — user context", () => {
  // Substitution of user fields happens, but == is then blocked → true
  it("user.role=='admin' — blocked by ==, returns safe default true", () => {
    expect(
      evaluateExpression(
        "eval:user.role=='admin'",
        ctx({}, { role: "admin" }),
      ),
    ).toBe(true);
  });

  it("user.role=='admin' with mismatched role — false", () => {
    expect(
      evaluateExpression(
        "eval:user.role=='admin'",
        ctx({}, { role: "viewer" }),
      ),
    ).toBe(false);
  });

  it("missing user.field substituted as null — null > 0 is false", () => {
    expect(
      evaluateExpression("eval:user.level>0", ctx({}, { name: "Alice" })),
    ).toBe(false);
  });

  it("user.field>threshold — passes through correctly when user field exists", () => {
    expect(
      evaluateExpression("eval:user.level>2", ctx({}, { level: 5 })),
    ).toBe(true);
  });

  it("user.field>threshold — false when field is below threshold", () => {
    expect(
      evaluateExpression("eval:user.level>10", ctx({}, { level: 5 })),
    ).toBe(false);
  });

  it("user object absent — user.field substituted as null — null > 0 is false", () => {
    expect(
      evaluateExpression("eval:user.role>0", ctx({})),
    ).toBe(false);
  });

  it("combined doc and user > expressions — both true", () => {
    expect(
      evaluateExpression(
        "eval:doc.total>0 && user.level>1",
        ctx({ total: 100 }, { level: 3 }),
      ),
    ).toBe(true);
  });

  it("combined doc and user > expressions — one false", () => {
    expect(
      evaluateExpression(
        "eval:doc.total>0 && user.level>10",
        ctx({ total: 100 }, { level: 3 }),
      ),
    ).toBe(false);
  });

  it("evaluateExpressionValue returns raw user field value", () => {
    expect(
      evaluateExpressionValue("eval:user.level", ctx({}, { level: 3 })),
    ).toBe(3);
  });

  it("evaluateExpressionValue returns true for user.role=='admin' match", () => {
    expect(
      evaluateExpressionValue(
        "eval:user.role=='admin'",
        ctx({}, { role: "admin" }),
      ),
    ).toBe(true);
  });

  it("user.missing==null — true because missing field resolves to null", () => {
    expect(
      evaluateExpression(
        "eval:user.missing==null",
        ctx({}, { role: "admin" }),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Unsafe token blocking
// ---------------------------------------------------------------------------

describe("evaluateExpression — unsafe token blocking", () => {
  // Each unsafe expression should return true (the default safe value).

  const safeDefault = true;

  it("blocks 'function' keyword", () => {
    expect(
      evaluateExpression(
        "eval:(function(){return false})()",
        ctx({}),
      ),
    ).toBe(safeDefault);
  });

  it("blocks 'eval' keyword", () => {
    expect(
      evaluateExpression("eval:eval('1+1')", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'new' keyword", () => {
    expect(
      evaluateExpression("eval:new Date()", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'delete' keyword", () => {
    expect(
      evaluateExpression("eval:delete doc", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'typeof' keyword", () => {
    expect(
      evaluateExpression("eval:typeof doc.x", ctx({ x: 1 })),
    ).toBe(safeDefault);
  });

  it("blocks 'void' keyword", () => {
    expect(
      evaluateExpression("eval:void 0", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'throw' keyword", () => {
    expect(
      evaluateExpression("eval:throw new Error()", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'import' keyword", () => {
    expect(
      evaluateExpression("eval:import('fs')", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'require' keyword", () => {
    expect(
      evaluateExpression("eval:require('fs')", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'process' keyword", () => {
    expect(
      evaluateExpression("eval:process.env", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'global' keyword", () => {
    expect(
      evaluateExpression("eval:global.x", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'window' keyword", () => {
    expect(
      evaluateExpression("eval:window.location", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'document' keyword", () => {
    // Note: the literal string "document" in the expression hits the /\bdocument\b/ guard.
    expect(
      evaluateExpression("eval:document.cookie", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'console' keyword", () => {
    expect(
      evaluateExpression("eval:console.log(1)", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'setTimeout'", () => {
    expect(
      evaluateExpression("eval:setTimeout(()=>{},0)", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'setInterval'", () => {
    expect(
      evaluateExpression("eval:setInterval(()=>{},0)", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'Promise'", () => {
    expect(
      evaluateExpression("eval:Promise.resolve(true)", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'Proxy'", () => {
    expect(
      evaluateExpression("eval:Proxy", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks 'Reflect'", () => {
    expect(
      evaluateExpression("eval:Reflect.ownKeys({})", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks simple assignment operator (=)", () => {
    // After doc field substitution the expression has no doc.x tokens.
    // We craft one that passes substitution but then has a bare assignment.
    expect(
      evaluateExpression("eval:1==1 ? (x=1) : 0", ctx({})),
    ).toBe(safeDefault);
  });

  it("== is NOT blocked — comparison operators work correctly", () => {
    expect(
      evaluateExpression("eval:1==1", ctx({})),
    ).toBe(true);
  });

  it("=== is NOT blocked — strict equality works", () => {
    expect(
      evaluateExpression("eval:1===1", ctx({})),
    ).toBe(true);
  });

  it("!= is NOT blocked — inequality works", () => {
    expect(
      evaluateExpression("eval:1!=2", ctx({})),
    ).toBe(true);
  });

  it("1==2 evaluates to false (not blocked)", () => {
    expect(
      evaluateExpression("eval:1==2", ctx({})),
    ).toBe(false);
  });

  it("blocks bracket access via .[ pattern", () => {
    expect(
      evaluateExpression("eval:obj.['key']", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks .constructor access", () => {
    expect(
      evaluateExpression("eval:x.constructor", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks .prototype access", () => {
    expect(
      evaluateExpression("eval:Array.prototype.push", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks .__proto__ access", () => {
    expect(
      evaluateExpression("eval:x.__proto__", ctx({})),
    ).toBe(safeDefault);
  });

  it("blocks template literals (backtick)", () => {
    expect(
      evaluateExpression("eval:`hello`=='hello'", ctx({})),
    ).toBe(safeDefault);
  });
});

// ---------------------------------------------------------------------------
// 9. evaluateExpressionValue — raw value return
// ---------------------------------------------------------------------------

describe("evaluateExpressionValue", () => {
  it("returns null for empty expression", () => {
    expect(evaluateExpressionValue("", ctx({}))).toBeNull();
  });

  it("returns the raw field value for simple truthy check", () => {
    expect(
      evaluateExpressionValue("doc.total", ctx({ total: 500 })),
    ).toBe(500);
  });

  it("returns null when field is missing (undefined → null)", () => {
    expect(evaluateExpressionValue("doc.total", ctx({}))).toBeNull();
  });

  it("returns null when field is null", () => {
    expect(
      evaluateExpressionValue("doc.customer", ctx({ customer: null })),
    ).toBeNull();
  });

  it("returns raw string value from field access", () => {
    expect(
      evaluateExpressionValue("doc.name", ctx({ name: "Alice" })),
    ).toBe("Alice");
  });

  it("returns raw array from field access", () => {
    const items = [1, 2, 3];
    expect(
      evaluateExpressionValue("doc.items", ctx({ items })),
    ).toEqual(items);
  });

  it("returns raw numeric result from arithmetic expression", () => {
    expect(
      evaluateExpressionValue("eval:doc.qty*doc.rate", ctx({ qty: 3, rate: 50 })),
    ).toBe(150);
  });

  it("returns ternary truthy branch for == match", () => {
    expect(
      evaluateExpressionValue(
        "eval:doc.status=='Active' ? 'open' : 'closed'",
        ctx({ status: "Active" }),
      ),
    ).toBe("open");
  });

  it("returns false for == comparison when values differ", () => {
    expect(
      evaluateExpressionValue(
        "eval:doc.status=='Active'",
        ctx({ status: "Inactive" }),
      ),
    ).toBe(false);
  });

  it("returns boolean true for > comparison (passes through correctly)", () => {
    expect(
      evaluateExpressionValue(
        "eval:doc.total>0",
        ctx({ total: 10 }),
      ),
    ).toBe(true);
  });

  it("returns boolean false for > comparison that is false", () => {
    expect(
      evaluateExpressionValue(
        "eval:doc.total>100",
        ctx({ total: 10 }),
      ),
    ).toBe(false);
  });

  it("returns null when unsafe token detected (not true like evaluateExpression)", () => {
    expect(
      evaluateExpressionValue("eval:require('fs')", ctx({})),
    ).toBeNull();
  });

  it("returns null for unsafe template literal expression", () => {
    expect(
      evaluateExpressionValue("eval:`hello`", ctx({})),
    ).toBeNull();
  });

  it("strips eval: prefix correctly", () => {
    expect(
      evaluateExpressionValue("eval:doc.qty*2", ctx({ qty: 7 })),
    ).toBe(14);
  });

  it("accesses user field via simple doc.field path — returns raw value", () => {
    // evaluateExpressionValue for "user.level" (no eval: prefix) goes through
    // the simple /^doc\.\w+$/ path only for doc fields. "user.level" is not a
    // simple doc field so it goes through evaluateAst substitution + evaluation.
    // user.level → 3 (JSON) — no unsafe tokens — evaluates to 3.
    expect(
      evaluateExpressionValue(
        "eval:user.level",
        ctx({}, { level: 3 }),
      ),
    ).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 10. Error handling — malformed / unparseable expressions
// ---------------------------------------------------------------------------

describe("evaluateExpression — error handling", () => {
  it("returns true for syntax error expression (safe default)", () => {
    expect(
      evaluateExpression("eval:doc.status ==== 'Active'", ctx({ status: "Active" })),
    ).toBe(true);
  });

  it("returns true for unclosed parenthesis", () => {
    expect(
      evaluateExpression("eval:(doc.total > 0", ctx({ total: 5 })),
    ).toBe(true);
  });

  it("returns true for completely invalid JS", () => {
    expect(
      evaluateExpression("eval:??? not valid", ctx({})),
    ).toBe(true);
  });

  it("evaluateExpressionValue returns null for syntax error", () => {
    expect(
      evaluateExpressionValue("eval:doc.status ==== 'Active'", ctx({})),
    ).toBeNull();
  });

  it("evaluateExpressionValue returns null for malformed expression with unclosed string", () => {
    // The unclosed string causes a SyntaxError, so evaluateExpressionValue returns null.
    expect(
      evaluateExpressionValue("eval:doc.status == 'Active", ctx({ status: "Active" })),
    ).toBeNull();
  });

  it("evaluateExpressionValue returns null for completely invalid JS", () => {
    expect(
      evaluateExpressionValue("eval:!@#$%", ctx({})),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. isTruthy edge cases (exercised through evaluateExpression simple checks)
// ---------------------------------------------------------------------------

describe("isTruthy edge cases via simple truthy check", () => {
  it("0 is falsy", () => {
    expect(evaluateExpression("doc.qty", ctx({ qty: 0 }))).toBe(false);
  });

  it("negative number is truthy", () => {
    expect(evaluateExpression("doc.qty", ctx({ qty: -1 }))).toBe(true);
  });

  it("positive float is truthy", () => {
    expect(evaluateExpression("doc.rate", ctx({ rate: 0.001 }))).toBe(true);
  });

  it("0.0 is falsy", () => {
    expect(evaluateExpression("doc.rate", ctx({ rate: 0.0 }))).toBe(false);
  });

  it("false boolean is falsy", () => {
    expect(evaluateExpression("doc.active", ctx({ active: false }))).toBe(false);
  });

  it("true boolean is truthy", () => {
    expect(evaluateExpression("doc.active", ctx({ active: true }))).toBe(true);
  });

  it("null is falsy", () => {
    expect(evaluateExpression("doc.ref", ctx({ ref: null }))).toBe(false);
  });

  it("undefined (missing key) is falsy", () => {
    expect(evaluateExpression("doc.ref", ctx({}))).toBe(false);
  });

  it("empty string is falsy", () => {
    expect(evaluateExpression("doc.name", ctx({ name: "" }))).toBe(false);
  });

  it("non-empty string is truthy", () => {
    expect(evaluateExpression("doc.name", ctx({ name: "x" }))).toBe(true);
  });

  it("empty array is falsy", () => {
    expect(evaluateExpression("doc.items", ctx({ items: [] }))).toBe(false);
  });

  it("non-empty array is truthy", () => {
    expect(evaluateExpression("doc.items", ctx({ items: [0] }))).toBe(true);
  });

  it("plain object (non-null) is truthy", () => {
    expect(
      evaluateExpression("doc.meta", ctx({ meta: {} })),
    ).toBe(true);
  });

  it("NaN is truthy (isTruthy has no NaN check — NaN passes all guards)", () => {
    // NaN !== null, !== undefined, !== "", !== 0 (NaN !== 0), !== false,
    // and Array.isArray(NaN) === false, so isTruthy(NaN) === true.
    expect(evaluateExpression("doc.val", ctx({ val: NaN }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. Full evaluation path — doc field substitution details
// ---------------------------------------------------------------------------

describe("evaluateExpression — field substitution and edge cases", () => {
  it("missing doc field substituted as null literal — null > 0 → false", () => {
    expect(
      evaluateExpression("eval:doc.nonexistent>0", ctx({})),
    ).toBe(false);
  });

  it("string field is JSON-stringified — == comparison works correctly", () => {
    expect(
      evaluateExpression(
        "eval:doc.status=='Active'",
        ctx({ status: "Active" }),
      ),
    ).toBe(true);
  });

  it("boolean field with > — true when field is true (true > 0 is true in JS)", () => {
    // true > 0 → true (JS coerces true to 1)
    expect(
      evaluateExpression("eval:doc.flag>0", ctx({ flag: true })),
    ).toBe(true);
  });

  it("boolean field with > — false when field is false (false > 0 is false)", () => {
    // false > 0 → false (JS coerces false to 0, 0 > 0 is false)
    expect(
      evaluateExpression("eval:doc.flag>0", ctx({ flag: false })),
    ).toBe(false);
  });

  it("array field with == null — false because array is not null", () => {
    expect(
      evaluateExpression(
        "eval:doc.roles==null",
        ctx({ roles: ["admin", "user"] }),
      ),
    ).toBe(false);
  });

  it("multiple doc fields in > expression — all substituted correctly", () => {
    // a=1, b=2, c=3; 1>0 && 2>1 && 3>2 → true
    expect(
      evaluateExpression(
        "eval:doc.a>0 && doc.b>1 && doc.c>2",
        ctx({ a: 1, b: 2, c: 3 }),
      ),
    ).toBe(true);
  });

  it("arithmetic on substituted fields", () => {
    expect(
      evaluateExpressionValue(
        "eval:doc.qty*doc.rate",
        ctx({ qty: 4, rate: 25 }),
      ),
    ).toBe(100);
  });

  it("missing field in arithmetic results in null*number → 0", () => {
    // null * 5 → 0 in JS
    expect(
      evaluateExpressionValue("eval:doc.qty*5", ctx({})),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 13. THROWING variants over an arbitrary identifier namespace (rule engine)
// ---------------------------------------------------------------------------

describe("evaluateExpressionValueIn — arbitrary-root throwing evaluator", () => {
  it("resolves identifiers from the supplied roots map", () => {
    expect(evaluateExpressionValueIn("doc.qty * 2", { doc: { qty: 5 } })).toBe(10);
    expect(evaluateExpressionValueIn("row.delta", { row: { delta: 3 } })).toBe(3);
    expect(evaluateExpressionValueIn("now", { now: 42 })).toBe(42);
  });

  it("THROWS on an unknown root (does not safe-default)", () => {
    expect(() => evaluateExpressionValueIn("session.secret", { doc: {} })).toThrow(/Identifier/);
  });

  it("THROWS on a forbidden property", () => {
    expect(() => evaluateExpressionValueIn("doc.constructor", { doc: {} })).toThrow();
    expect(() => evaluateExpressionValueIn("doc.__proto__", { doc: {} })).toThrow();
  });

  it("THROWS on unparsable input (rules must fail loud)", () => {
    expect(() => evaluateExpressionValueIn("doc.x ==== 1", { doc: {} })).toThrow();
  });

  it("missing property resolves to null (matches view evaluator)", () => {
    expect(evaluateExpressionValueIn("doc.missing", { doc: {} })).toBeNull();
  });
});

describe("assertExpressionParsableIn — context-free allowlist assertion", () => {
  const roots = new Set(["doc", "row", "user", "now"]);
  it("passes a valid expression over the allowed roots", () => {
    expect(() => assertExpressionParsableIn("doc.a > 0 && row.b != 1", roots)).not.toThrow();
    expect(() => assertExpressionParsableIn("doc.x > 0 ? 'y' : 'n'", roots)).not.toThrow();
  });
  it("throws on a disallowed root", () => {
    expect(() => assertExpressionParsableIn("session.secret", roots)).toThrow(/Identifier/);
  });
  it("throws on a forbidden property", () => {
    expect(() => assertExpressionParsableIn("doc.__proto__", roots)).toThrow();
  });
  it("throws on unparsable input", () => {
    expect(() => assertExpressionParsableIn("doc.x ==== 1", roots)).toThrow();
  });
  it("throws on a disallowed node type (call expression)", () => {
    expect(() => assertExpressionParsableIn("doc.f()", roots)).toThrow();
  });
});

describe("evaluateExpression — sandbox hardening (attack strings safe-default)", () => {
  // Every attack expression here MUST safe-default to `true` (visibility) without
  // throwing or executing anything. Failing safe-default = code execution slipped
  // through the AST allowlist.

  it("blocks Object.constructor escape", () => {
    expect(
      evaluateExpression("eval:doc.x.constructor", ctx({ x: "y" })),
    ).toBe(true);
  });

  it("blocks __proto__ access", () => {
    expect(
      evaluateExpression("eval:doc.__proto__", ctx({})),
    ).toBe(true);
  });

  it("blocks prototype access", () => {
    expect(
      evaluateExpression("eval:doc.x.prototype", ctx({ x: "y" })),
    ).toBe(true);
  });

  it("blocks function calls (CallExpression rejected)", () => {
    expect(
      evaluateExpression("eval:alert(1)", ctx({})),
    ).toBe(true);
  });

  it("blocks `new` constructors", () => {
    // jsep doesn't even parse `new` by default; ensure the evaluator
    // safe-defaults rather than crashing.
    expect(
      evaluateExpression("eval:new Date()", ctx({})),
    ).toBe(true);
  });

  it("blocks computed member access — doc[\"constructor\"]", () => {
    expect(
      evaluateExpression("eval:doc['constructor']", ctx({})),
    ).toBe(true);
  });

  it("blocks template literals via parse failure", () => {
    expect(
      evaluateExpression("eval:`${doc.x}`", ctx({ x: "y" })),
    ).toBe(true);
  });

  it("blocks identifier outside doc/user/undefined", () => {
    expect(
      evaluateExpression("eval:globalThis", ctx({})),
    ).toBe(true);
    expect(
      evaluateExpression("eval:process", ctx({})),
    ).toBe(true);
    expect(
      evaluateExpression("eval:Math.max(1,2)", ctx({})),
    ).toBe(true);
  });

  it("blocks assignments", () => {
    // `x = 1` isn't valid in expression position to most parsers; jsep may
    // treat as Compound. Either way the evaluator rejects.
    expect(
      evaluateExpression("eval:doc.x = 5", ctx({ x: "y" })),
    ).toBe(true);
  });

  it("blocks comma-separated compound expressions", () => {
    expect(
      evaluateExpression("eval:1, doc.x", ctx({ x: "y" })),
    ).toBe(true);
  });
});
