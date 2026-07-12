/**
 * Rule-expression adapter.
 *
 * Rules use the SAME expression grammar as the rest of the platform: the shared
 * jsep-allowlist walker in `core/expression/expression-evaluator.ts`. This file
 * is a thin adapter that (1) binds the rule identifier namespace
 * ({doc,row,item,item_index,user,now}) and (2) handles VALUE-slot tokens
 * (`$now[±ISO-dur]`, `$root.*`, `$user.*`) via the shared view token resolver.
 *
 * The former hand-rolled ~314-line Pratt parser was deleted (D1) — one
 * evaluator, one grammar. Semantics are proven equivalent by
 * `tests/rule-expression-compat.test.ts` (raw-JS comparison operators instead
 * of the old Number()-coercion; missing properties resolve to `null`; unknown
 * roots and prototype-escape segments THROW instead of silently returning
 * undefined — rules run inside the triggering transaction and must fail loud).
 *
 * Slot rules:
 *   - condition / iterate  → expression only (tokens rejected).
 *   - field_mappings values / action.value / action.target_name → VALUE slot:
 *     a `$…` token is resolved via the token resolver, otherwise it is an
 *     expression. `$param.*` is never available in rules (no request params).
 */

import type { UserContext } from "../permissions/types.js";
import {
  evaluateExpressionValueIn,
  assertExpressionParsableIn,
} from "../expression/expression-evaluator.js";
import {
  resolveString,
  parseIsoDuration,
  type ResolverContext,
} from "../view/param-resolver.js";

export interface RuleExprContext {
  doc?: unknown;
  row?: unknown;
  user?: unknown;
  now?: Date;
  [key: string]: unknown;
}

/** The identifier roots a rule expression may reference (== old SAFE_ROOTS). */
export const RULE_ROOTS = ["doc", "row", "item", "item_index", "user", "now"] as const;
const RULE_ROOT_SET = new Set<string>(RULE_ROOTS);

function buildRoots(ctx: RuleExprContext): Record<string, unknown> {
  // Every root is present (value may be undefined) so `row.x` resolves to
  // undefined rather than throwing "Identifier:row" when no row is bound.
  return {
    doc: ctx.doc,
    row: ctx.row,
    item: ctx["item"],
    item_index: ctx["item_index"],
    user: ctx.user,
    now: ctx.now,
  };
}

/**
 * Evaluate a rule EXPRESSION (condition / iterate / non-token value). Throws on
 * parse failure or a disallowed node/root — wrapped for debuggability.
 */
export function evaluateExpression(expr: string, ctx: RuleExprContext): unknown {
  try {
    return evaluateExpressionValueIn(expr, buildRoots(ctx));
  } catch (err) {
    throw new Error(`Expression failed (${expr}): ${(err as Error).message}`);
  }
}

// ── Value-slot tokens ───────────────────────────────────────────────────────

/** Does the string LOOK like a reserved token (so it is NOT an expression)? */
function looksLikeToken(s: string): boolean {
  return (
    s === "$now" ||
    s.startsWith("$now") ||
    s.startsWith("$root.") ||
    s.startsWith("$user.") ||
    s.startsWith("$param.")
  );
}

/** Resolve a value-slot token, throwing (never silently nulling) on failure. */
function resolveValueToken(s: string, ctx: RuleExprContext): unknown {
  if (s.startsWith("$param.")) {
    throw new Error(`$param tokens are not available in rules: "${s}"`);
  }
  const warnings: string[] = [];
  const resolverCtx: ResolverContext = {
    root: (ctx.doc as Record<string, unknown>) ?? null,
    user: (ctx.user as UserContext) ?? ({} as UserContext),
    params: {},
    now: ctx.now ?? new Date(),
    warnings,
  };
  const v = resolveString(s, resolverCtx);
  if (warnings.length) {
    throw new Error(`rule token failed (${s}): ${warnings.join("; ")}`);
  }
  return v;
}

/**
 * Evaluate a VALUE slot (mapping value, action.value, action.target_name): a
 * `$…` token resolves via the token resolver, otherwise it is an expression.
 */
export function evaluateValueSlot(s: string, ctx: RuleExprContext): unknown {
  if (looksLikeToken(s)) return resolveValueToken(s, ctx);
  return evaluateExpression(s, ctx);
}

/** Evaluate every value in a { key: expression|token } map (value slot). */
export function evaluateMapping(
  mapping: Record<string, string>,
  ctx: RuleExprContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(mapping)) {
    out[k] = evaluateValueSlot(s, ctx);
  }
  return out;
}

// ── Seed-time (context-free) validation ─────────────────────────────────────

/** Validate a token's SHAPE at seed time (durations, non-empty paths). */
function assertValueToken(s: string): void {
  if (s.startsWith("$param.")) {
    throw new Error(`$param tokens are not available in rules: "${s}"`);
  }
  if (s === "$now") return;
  const nowOp = s.match(/^\$now\s*([+-])\s*(.+)$/);
  if (nowOp) {
    if (!parseIsoDuration(nowOp[2]!.trim())) {
      throw new Error(`invalid ISO-8601 duration in token "${s}"`);
    }
    return;
  }
  if (s.startsWith("$now")) throw new Error(`malformed $now token "${s}"`);
  const rootMatch = s.match(/^\$root\.(.+)$/);
  if (rootMatch) {
    if (!rootMatch[1]!.trim()) throw new Error(`empty $root path in token "${s}"`);
    return;
  }
  const userMatch = s.match(/^\$user\.(.+)$/);
  if (userMatch) {
    if (!userMatch[1]!.trim()) throw new Error(`empty $user path in token "${s}"`);
    return;
  }
  throw new Error(`unrecognized token "${s}"`);
}

/**
 * Assert a VALUE-slot string is seed-valid: a token (validated for shape) OR a
 * parseable rule expression. Used by the seed guard for field_mappings values,
 * action.value and action.target_name.
 */
export function assertExpressionParsable(expr: string): void {
  if (looksLikeToken(expr)) {
    assertValueToken(expr);
    return;
  }
  assertExpressionParsableIn(expr, RULE_ROOT_SET);
}

/**
 * Assert a CONDITION/ITERATE-slot string is seed-valid: an expression over the
 * rule roots ONLY — tokens are rejected here (they are value-position sugar).
 */
export function assertConditionParsable(expr: string): void {
  assertExpressionParsableIn(expr, RULE_ROOT_SET);
}
