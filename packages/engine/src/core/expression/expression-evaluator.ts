/**
 * Safe expression evaluator for depends_on, mandatory_depends_on,
 * read_only_depends_on, permission conditions, and show_if expressions.
 *
 * Implementation: parses and evaluates with the expression grammar of
 * `@digitaplatform/shared`, the one the form uses too, so a field locks in the
 * form as it does on save. Identifiers are resolved here; any identifier not
 * on the allowlist throws and the caller safe-defaults (visible / null).
 * No `new Function`, no globals, no prototypes.
 *
 * Supported syntax:
 *   Literals: numbers, strings, booleans, null, undefined, arrays
 *   Identifiers: only `doc` and `user`
 *   Member access: static `.field` on doc/user/their child objects
 *     (no computed `[…]`, no method calls, blocked names: constructor,
 *     prototype, __proto__)
 *   Binary: ==, !=, ===, !==, >, >=, <, <=, +, -, *, /, %, in, not in
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
 *   "doc.customer"  (truthy check)
 */

import {
  ExpressionError,
  evaluateNode,
  identifiersOf,
  isTruthy,
  parseExpression,
  rootFieldsOf,
  stripEvalPrefix,
} from "@digitaplatform/shared";

export interface ExpressionContext {
  doc: Record<string, unknown>;
  user?: Record<string, unknown>;
}

const ALLOWED_IDENTIFIERS = new Set(["doc", "user"]);

export class UnsafeExpressionError extends Error {
  constructor(public detail: string) {
    super(`Unsafe expression: ${detail}`);
    this.name = "UnsafeExpressionError";
  }
}

/**
 * Resolves a bare identifier (`doc`, `user`, `now`, …) to its runtime value.
 * The shared evaluator reads identifiers ONLY through this closure, so a caller
 * that wants a different identifier namespace (the rule engine's
 * {doc,row,item,item_index,user,now}) just passes a different resolver while
 * the operator/member/prototype-guard semantics stay bit-identical.
 */
export type IdentifierResolver = (name: string) => unknown;

/**
 * Default resolver for depends_on / show_if / permission conditions: only
 * `doc` and `user` are visible, matching ALLOWED_IDENTIFIERS.
 */
function contextResolver(ctx: ExpressionContext): IdentifierResolver {
  return (name: string) => {
    if (!ALLOWED_IDENTIFIERS.has(name)) {
      throw new UnsafeExpressionError(`Identifier:${name}`);
    }
    return name === "doc" ? ctx.doc : (ctx.user ?? {});
  };
}

/**
 * Evaluate an expression string against a document and optional user context.
 * Returns true/false for conditional expressions. On parse error or a
 * disallowed identifier it returns `safeDefault` — `true` for visibility
 * expressions (depends_on/show_if: a broken expr shows the field) but callers
 * gating ACCESS (permission conditions) MUST pass `false` so a typo'd condition
 * fails CLOSED (denies) instead of silently granting.
 */
/**
 * The top-level `doc` fields an expression reads, for a caller that loads only
 * those; `undefined` when it cannot name them (a parse failure, or `doc` read as
 * a whole), so the caller loads the whole row.
 */
export function docFieldsOf(expression: string): string[] | undefined {
  try {
    return rootFieldsOf(parseExpression(stripEvalPrefix(expression)), "doc");
  } catch (e) {
    if (e instanceof ExpressionError) return undefined;
    throw e;
  }
}

export function evaluateExpression(
  expression: string,
  context: ExpressionContext,
  safeDefault = true,
): boolean {
  if (!expression) return true;

  try {
    const ast = parseExpression(stripEvalPrefix(expression));
    return isTruthy(evaluateNode(ast, contextResolver(context)));
  } catch {
    // Parse failure or disallowed identifier → caller-chosen safe default.
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

  try {
    const ast = parseExpression(stripEvalPrefix(expression));
    return evaluateNode(ast, contextResolver(context));
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
  const ast = parseExpression(expression);
  const resolveId: IdentifierResolver = (name) => {
    if (!Object.hasOwn(roots, name)) throw new UnsafeExpressionError(`Identifier:${name}`);
    return roots[name];
  };
  return evaluateNode(ast, resolveId);
}

/**
 * Assert that a field expression, a transition condition, an action's `show_if` or a permission
 * condition parses, `eval:` prefix and all, and reads only `doc` and `user`, as `evaluateExpression`
 * does at run time, where a broken one falls back to its safe default without a word.
 */
export function assertFieldExpressionParsable(expression: string): void {
  assertExpressionParsableIn(stripEvalPrefix(expression), ALLOWED_IDENTIFIERS);
}

/**
 * Assert (no runtime context) that `expression` parses and every node is on the
 * allowlist, with identifiers restricted to `allowedRoots`. Throws with the
 * offending token in the message. Used when an entity loads, so an unparsable or
 * disallowed field expression fails loud at boot instead of inside every save.
 */
export function assertExpressionParsableIn(
  expression: string,
  allowedRoots: Set<string>,
): void {
  const ast = parseExpression(expression);
  for (const name of identifiersOf(ast)) {
    if (!allowedRoots.has(name)) throw new UnsafeExpressionError(`Identifier:${name}`);
  }
}
