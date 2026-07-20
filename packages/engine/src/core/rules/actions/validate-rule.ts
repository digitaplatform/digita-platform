import type { RuleAction, RuleExecContext } from "../rule-types.js";
import { evaluateExpression } from "../rule-expression.js";

/**
 * Execute a `validate` rule action — throws when `condition` evaluates
 * falsy. Used to abort the triggering operation mid-rule (the thrown
 * error rolls back the enclosing transaction).
 *
 * When `iterate` is set, the condition is evaluated per-row; failure of
 * any single row throws with the row index attached to the message.
 */
export async function executeValidate(
  action: RuleAction,
  exec: RuleExecContext,
): Promise<void> {
  if (!action.condition) throw new Error("validate: condition required");
  const rawMessage =
    (action as { message?: string }).message ?? action.error_message ?? "Rule validation failed";

  if (action.iterate) {
    const rows = (evaluateExpression(action.iterate, exec) as unknown[]) ?? [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const ok = evaluateExpression(action.condition, { ...exec, row });
      if (!ok) {
        throw new Error(`${rawMessage} (row ${i + 1})`);
      }
    }
    return;
  }
  const ok = evaluateExpression(action.condition, exec);
  if (!ok) throw new Error(rawMessage);
}
