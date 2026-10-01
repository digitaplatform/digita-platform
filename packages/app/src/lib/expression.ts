/**
 * The form's reading of depends_on / mandatory_depends_on / read_only_depends_on and of the
 * other conditions the engine also judges. It parses with the grammar of
 * `@digitaplatform/shared`, the one the engine uses on save, over the roots `{ doc, user }`.
 *
 * `evaluateExpr` returns `{ value, error }` so the CALLER owns the safe-degrade
 * direction: visibility fails OPEN, mandatory/read_only fail CLOSED. A parse
 * failure never throws and never silently weakens a constraint. The `eval:`
 * prefix is stripped.
 */

import {
  ExpressionError,
  evaluateNode,
  isTruthy,
  parseExpression,
  rootFieldsOf,
  stripEvalPrefix,
  type ExprNode,
} from '@digitaplatform/shared';

export interface EvalScope {
  doc: Record<string, unknown>;
  user?: Record<string, unknown>;
  /** The roots hold only part of what the expression may read, so a path whose first field
   *  they lack is an error, never `undefined`. */
  isPartial?: boolean;
  /** A name other than `doc` and `user` is text, as an app author writes `doc.status == Open`
   *  in a report link's show_if, which only the app reads. A field expression has no such
   *  names, since the engine refuses them on save. */
  hasBareWords?: boolean;
}

export interface EvalResult {
  value: boolean;
  error?: string;
}

const ROOTS = ['doc', 'user'] as const;

function resolveRoot(scope: EvalScope, name: string): unknown {
  if (name === 'doc') return scope.doc;
  if (name === 'user') return scope.user;
  if (scope.hasBareWords) return name;
  throw new ExpressionError(`unknown name "${name}"`);
}

/** A partial scope cannot judge a field it does not hold, nor a root read as a whole. */
function assertHeld(scope: EvalScope, node: ExprNode): void {
  for (const root of ROOTS) {
    const fields = rootFieldsOf(node, root);
    if (!fields) throw new Error(`${root} is not held whole`);
    const held = root === 'user' ? scope.user : scope.doc;
    for (const field of fields) {
      if (held?.[field] === undefined) throw new Error(`${root}.${field} is not held`);
    }
  }
}

const COMPARISONS = new Set(['==', '!=', '===', '!==', '<', '<=', '>', '>=', 'in', 'not in']);

/** A bare word is text only where it is compared, so `Pre-paid` is not read as `Pre - paid`. */
function assertBareWordsCompared(node: ExprNode, isCompared = false): void {
  switch (node.type) {
    case 'Identifier':
      if (!isCompared && node.name !== 'doc' && node.name !== 'user') {
        throw new ExpressionError(`"${node.name}" is not compared`);
      }
      return;
    case 'Member':
      return assertBareWordsCompared(node.object);
    case 'Array':
      return node.elements.forEach((element) => assertBareWordsCompared(element, true));
    case 'Unary':
      return assertBareWordsCompared(node.argument);
    case 'Binary': {
      const compared = COMPARISONS.has(node.operator);
      assertBareWordsCompared(node.left, compared);
      return assertBareWordsCompared(node.right, compared);
    }
    case 'Conditional':
      assertBareWordsCompared(node.test);
      assertBareWordsCompared(node.consequent);
      return assertBareWordsCompared(node.alternate);
  }
}

/** Evaluate an expression, exposing parse errors so the caller owns the degrade direction. */
export function evaluateExpr(expr: string, scope: EvalScope): EvalResult {
  if (!expr) return { value: true };
  try {
    const node = parseExpression(stripEvalPrefix(expr));
    if (scope.isPartial) assertHeld(scope, node);
    if (scope.hasBareWords) assertBareWordsCompared(node);
    return { value: isTruthy(evaluateNode(node, (name) => resolveRoot(scope, name))) };
  } catch (e) {
    return { value: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Convenience boolean: parse errors degrade to `true` (back-compat with the admin port). */
export function evaluateSafe(expr: string, scope: EvalScope): boolean {
  const r = evaluateExpr(expr, scope);
  return r.error ? true : r.value;
}
