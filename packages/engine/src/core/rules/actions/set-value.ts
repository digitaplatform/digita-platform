import type { RuleAction, RuleExecContext } from "../rule-types.js";
import { evaluateValueSlot } from "../rule-expression.js";

/**
 * Execute a `set_value` action — an IN-MEMORY mutation of the triggering doc
 * (NO db write). Governed by the pipeline: at pre-write events (validate,
 * before_submit) the value flows through Zod and is persisted via getChanges().
 *
 * It writes BOTH:
 *   - `exec.doc[field]` — so later actions/rules in the same dispatch see it;
 *   - `exec.mutations[field]` — so the DocumentService dispatch site can mark
 *     the field dirty (a bare `_data` write is otherwise dropped by
 *     getChanges(), see base-document.ts:130-138).
 *
 * The event gate that forbids set_value at post-write events lives in
 * RuleEngine.execute (all call sites covered, including the workflow path which
 * hands rules a throwaway COPY).
 */
export function executeSetValue(action: RuleAction, exec: RuleExecContext): void {
  if (!action.field) throw new Error("set_value: field required");
  if (!action.value) throw new Error("set_value: value (expression) required");
  const v = evaluateValueSlot(action.value, exec);
  (exec.doc as Record<string, unknown>)[action.field] = v;
  exec.mutations[action.field] = v;
}
