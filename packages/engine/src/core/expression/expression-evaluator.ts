/**
 * Safe expression evaluator for depends_on, mandatory_depends_on,
 * read_only_depends_on, permission conditions, and show_if expressions.
 *
 * Implementation: parses with `jsep` to a JS expression AST, then walks
 * the AST with an ALLOWLIST evaluator. Any node type, operator, or
 * identifier not on the allowlist throws and the caller safe-defaults
 * (visible / null). No `new Function`, no globals, no prototypes.
 *
 * Supported syntax:
 *   Literals: numbers, strings, booleans, null, undefined, arrays
 *   Identifiers: only `doc`, `user`, `undefined` (true/false/null are literals)
 *   Member access: static `.field` on doc/user/their child objects
 *     (no computed `[…]`, no method calls, blocked names: constructor,
 *     prototype, __proto__)
 *   Binary: ==, !=, ===, !==, >, >=, <, <=, +, -, *, /, %, in
 *   Logical: &&, ||
 *   Unary: !, -, +
 *   Ternary: a ? b : c
 *
 * Context: doc.fieldname, user.fieldname (and arbitrarily-nested member access)
 *
 * Example expressions:
 *   "eval:doc.status=='Active'"
 *   "eval:doc.grand_total > 0 && doc.status != 'Cancelled'"
 *   "eval:doc.docstatus == 1"
 *   "doc.customer"  (truthy check — fast path)
 */

import jsep from "jsep";

export interface ExpressionContext {
  doc: Record<string, unknown>;
  user?: Record<string, unknown>;
}

interface AstNode {
  type: string;
  [key: string]: unknown;
}

const ALLOWED_IDENTIFIERS = new Set(["doc", "user", "undefined"]);

// jsep emits BinaryExpression for `&&` and `||` (not LogicalExpression), so
// they live in this set and are short-circuited inside the BinaryExpression
// handler below.
const ALLOWED_BINARY = new Set([
  "==",
  "!=",
  "===",
  "!==",
  ">",
  ">=",
  "<",
  "<=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "in",
  "&&",
  "||",
]);

const ALLOWED_LOGICAL = new Set(["&&", "||"]);

const ALLOWED_UNARY = new Set(["!", "-", "+"]);

const FORBIDDEN_PROPERTY_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

export class UnsafeExpressionError extends Error {
  constructor(public detail: string) {
    super(`Unsafe expression: ${detail}`);
    this.name = "UnsafeExpressionError";
  }
}

/**
 * Resolves a bare identifier (`doc`, `user`, `now`, …) to its runtime value.
 * `evalNode` reads identifiers ONLY through this closure — every other node
 * type (member access, operators, literals) is root-agnostic — so a caller
 * that wants a different identifier namespace (the rule engine's
 * {doc,row,item,item_index,user,now}) just passes a different resolver while
 * the operator/member/prototype-guard semantics stay bit-identical.
 */
export type IdentifierResolver = (name: string) => unknown;

/**
 * Default resolver for depends_on / show_if / permission conditions: only
 * `doc`, `user`, `undefined` are visible, matching ALLOWED_IDENTIFIERS.
 */
function contextResolver(ctx: ExpressionContext): IdentifierResolver {
  return (name: string) => {
    if (!ALLOWED_IDENTIFIERS.has(name)) {
      throw new UnsafeExpressionError(`Identifier:${name}`);
    }
    switch (name) {
      case "doc":
        return ctx.doc;
      case "user":
        return ctx.user ?? {};
      case "undefined":
        return undefined;
    }
    throw new UnsafeExpressionError(`Identifier:${name}`);
  };
}

function evalNode(node: AstNode, resolveId: IdentifierResolver): unknown {
  switch (node.type) {
    case "Literal":
      return node.value;

    case "Identifier": {
      const name = node.name as string;
      return resolveId(name);
    }

    case "MemberExpression": {
      // Static `.field` only — no computed `[…]` access.
      if (node.computed) {
        throw new UnsafeExpressionError("MemberExpression:computed");
      }
      const object = evalNode(node.object as AstNode, resolveId);
      const property = node.property as AstNode;
      if (property.type !== "Identifier") {
        throw new UnsafeExpressionError("MemberExpression:property-type");
      }
      const propName = property.name as string;
      if (FORBIDDEN_PROPERTY_NAMES.has(propName)) {
        throw new UnsafeExpressionError(`MemberExpression:${propName}`);
      }
      if (object === null || object === undefined) return null;
      const v = (object as Record<string, unknown>)[propName];
      // Treat missing properties as `null` (not `undefined`) so arithmetic
      // matches the previous `JSON.stringify(value ?? null)` substitution
      // semantics — e.g. `doc.qty * 5` with `qty` unset → 0, not NaN.
      return v === undefined ? null : v;
    }

    case "BinaryExpression": {
      const op = node.operator as string;
      if (!ALLOWED_BINARY.has(op)) {
        throw new UnsafeExpressionError(`BinaryExpression:${op}`);
      }
      // jsep emits `&&`/`||` as BinaryExpression. Short-circuit so the
      // right side isn't unnecessarily evaluated (and side-effect-free
      // semantics — though our evaluator has no side effects).
      if (op === "&&") {
        const left = evalNode(node.left as AstNode, resolveId);
        return left ? evalNode(node.right as AstNode, resolveId) : left;
      }
      if (op === "||") {
        const left = evalNode(node.left as AstNode, resolveId);
        return left ? left : evalNode(node.right as AstNode, resolveId);
      }
      const left = evalNode(node.left as AstNode, resolveId);
      const right = evalNode(node.right as AstNode, resolveId);
      switch (op) {
        case "==":
          return left == right;
        case "!=":
          return left != right;
        case "===":
          return left === right;
        case "!==":
          return left !== right;
        case ">":
          return (left as number) > (right as number);
        case ">=":
          return (left as number) >= (right as number);
        case "<":
          return (left as number) < (right as number);
        case "<=":
          return (left as number) <= (right as number);
        case "+":
          return (left as number) + (right as number);
        case "-":
          return (left as number) - (right as number);
        case "*":
          return (left as number) * (right as number);
        case "/":
          return (left as number) / (right as number);
        case "%":
          return (left as number) % (right as number);
        case "in": {
          if (Array.isArray(right)) return right.includes(left);
          // Reject `in` on objects to avoid prototype-chain probing.
          return false;
        }
      }
      throw new UnsafeExpressionError(`BinaryExpression:${op}`);
    }

    case "LogicalExpression": {
      // Some jsep configurations emit LogicalExpression instead of
      // BinaryExpression for `&&`/`||`. Handle both for portability.
      const op = node.operator as string;
      if (!ALLOWED_LOGICAL.has(op)) {
        throw new UnsafeExpressionError(`LogicalExpression:${op}`);
      }
      const left = evalNode(node.left as AstNode, resolveId);
      if (op === "&&") {
        return left ? evalNode(node.right as AstNode, resolveId) : left;
      }
      // ||
      return left ? left : evalNode(node.right as AstNode, resolveId);
    }

    case "UnaryExpression": {
      const op = node.operator as string;
      if (!ALLOWED_UNARY.has(op)) {
        throw new UnsafeExpressionError(`UnaryExpression:${op}`);
      }
      const arg = evalNode(node.argument as AstNode, resolveId);
      switch (op) {
        case "!":
          return !arg;
        case "-":
          return -(arg as number);
        case "+":
          return +(arg as number);
      }
      throw new UnsafeExpressionError(`UnaryExpression:${op}`);
    }

    case "ConditionalExpression": {
      const test = evalNode(node.test as AstNode, resolveId);
      return test
        ? evalNode(node.consequent as AstNode, resolveId)
        : evalNode(node.alternate as AstNode, resolveId);
    }

    case "ArrayExpression": {
      const elements = node.elements as AstNode[];
      return elements.map((el) => evalNode(el, resolveId));
    }

    // Anything else (CallExpression, ThisExpression, NewExpression, Compound,
    // SequenceExpression, AssignmentExpression, UpdateExpression,
    // TaggedTemplateExpression, …) is rejected.
    default:
      throw new UnsafeExpressionError(`NodeType:${node.type}`);
  }
}

/**
 * Evaluate an expression string against a document and optional user context.
 * Returns true/false for conditional expressions. On parse error or a
 * disallowed AST node it returns `safeDefault` — `true` for visibility
 * expressions (depends_on/show_if: a broken expr shows the field) but callers
 * gating ACCESS (permission conditions) MUST pass `false` so a typo'd condition
 * fails CLOSED (denies) instead of silently granting.
 */
export function evaluateExpression(
  expression: string,
  context: ExpressionContext,
  safeDefault = true,
): boolean {
  if (!expression) return true;

  let expr = expression.trim();
  if (expr.startsWith("eval:")) {
    expr = expr.slice(5).trim();
  }

  // Fast path: bare `doc.field` truthy check
  if (/^doc\.\w+$/.test(expr)) {
    const field = expr.split(".")[1]!;
    return isTruthy(context.doc[field]);
  }

  try {
    const ast = jsep(expr) as unknown as AstNode;
    const result = evalNode(ast, contextResolver(context));
    return Boolean(result);
  } catch {
    // Parse failure or disallowed node → caller-chosen safe default.
    return safeDefault;
  }
}

/**
 * Evaluate an expression and return the raw result (not just boolean).
 * Used for default values like "doc.outstanding". Safe-defaults to `null`.
 *
 * NOTE: not yet wired into a production path, but a fully-tested feature
 * (raw-value expression eval) — kept intentionally, not dead code.
 */
export function evaluateExpressionValue(expression: string, context: ExpressionContext): unknown {
  if (!expression) return null;

  let expr = expression.trim();
  if (expr.startsWith("eval:")) {
    expr = expr.slice(5).trim();
  }

  if (/^doc\.\w+$/.test(expr)) {
    const field = expr.split(".")[1]!;
    return context.doc[field] ?? null;
  }

  try {
    const ast = jsep(expr) as unknown as AstNode;
    return evalNode(ast, contextResolver(context));
  } catch {
    return null;
  }
}

/**
 * THROWING raw-value evaluator over an arbitrary identifier namespace.
 *
 * Unlike `evaluateExpression`/`evaluateExpressionValue` (which safe-default on
 * a bad expression because a broken depends_on should still render the field),
 * this variant is for the RULE ENGINE: rules run inside the triggering
 * document's transaction, so a bad expression MUST fail loud (throw → rollback)
 * rather than silently resolve to null. Identifiers resolve from `roots`
 * (e.g. {doc,row,item,item_index,user,now}); every other node type reuses the
 * exact same operator/member/prototype-guard walker, so semantics are
 * bit-identical to the view evaluator.
 */
export function evaluateExpressionValueIn(
  expression: string,
  roots: Record<string, unknown>,
): unknown {
  const ast = jsep(expression) as unknown as AstNode;
  const resolveId: IdentifierResolver = (name) => {
    if (name === "undefined") return undefined;
    if (!(name in roots)) throw new UnsafeExpressionError(`Identifier:${name}`);
    return roots[name];
  };
  return evalNode(ast, resolveId);
}

/**
 * Assert (no runtime context) that `expression` parses and every node is on the
 * allowlist, with identifiers restricted to `allowedRoots`. Throws with the
 * offending token in the message. Used at rule-seed time so an unparsable /
 * disallowed rule expression fails loud at boot instead of inside every
 * triggering transaction.
 */
export function assertExpressionParsableIn(
  expression: string,
  allowedRoots: Set<string>,
): void {
  const ast = jsep(expression) as unknown as AstNode;
  assertNode(ast, allowedRoots);
}

function assertNode(node: AstNode, allowedRoots: Set<string>): void {
  switch (node.type) {
    case "Literal":
      return;
    case "Identifier": {
      const name = node.name as string;
      if (name === "undefined") return;
      if (!allowedRoots.has(name)) {
        throw new UnsafeExpressionError(`Identifier:${name}`);
      }
      return;
    }
    case "MemberExpression": {
      if (node.computed) throw new UnsafeExpressionError("MemberExpression:computed");
      const property = node.property as AstNode;
      if (property.type !== "Identifier") {
        throw new UnsafeExpressionError("MemberExpression:property-type");
      }
      const propName = property.name as string;
      if (FORBIDDEN_PROPERTY_NAMES.has(propName)) {
        throw new UnsafeExpressionError(`MemberExpression:${propName}`);
      }
      assertNode(node.object as AstNode, allowedRoots);
      return;
    }
    case "BinaryExpression": {
      const op = node.operator as string;
      if (!ALLOWED_BINARY.has(op)) throw new UnsafeExpressionError(`BinaryExpression:${op}`);
      assertNode(node.left as AstNode, allowedRoots);
      assertNode(node.right as AstNode, allowedRoots);
      return;
    }
    case "LogicalExpression": {
      const op = node.operator as string;
      if (!ALLOWED_LOGICAL.has(op)) throw new UnsafeExpressionError(`LogicalExpression:${op}`);
      assertNode(node.left as AstNode, allowedRoots);
      assertNode(node.right as AstNode, allowedRoots);
      return;
    }
    case "UnaryExpression": {
      const op = node.operator as string;
      if (!ALLOWED_UNARY.has(op)) throw new UnsafeExpressionError(`UnaryExpression:${op}`);
      assertNode(node.argument as AstNode, allowedRoots);
      return;
    }
    case "ConditionalExpression": {
      assertNode(node.test as AstNode, allowedRoots);
      assertNode(node.consequent as AstNode, allowedRoots);
      assertNode(node.alternate as AstNode, allowedRoots);
      return;
    }
    case "ArrayExpression": {
      for (const el of node.elements as AstNode[]) assertNode(el, allowedRoots);
      return;
    }
    default:
      throw new UnsafeExpressionError(`NodeType:${node.type}`);
  }
}

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value === "") return false;
  if (value === 0) return false;
  if (value === false) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}
