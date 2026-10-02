import type { RuleAction, RuleExecContext } from "../rule-types.js";
import { evaluateExpression } from "../rule-expression.js";
import { EngineError } from "../../errors/engine-error.js";

/**
 * A save a validate rule refused. Its message is the rule author's own text, so it reaches the
 * person as it was written, as a parameter of rule_refused, with 400.
 */
export class RuleRefusedError extends EngineError {
  constructor(message: string) {
    super("rule_refused", { message }, 400, "RULE_REFUSED");
    this.message = message;
  }
}

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
        throw new RuleRefusedError(`${rawMessage} (row ${i + 1})`);
      }
    }
    return;
  }
  const ok = evaluateExpression(action.condition, exec);
  if (!ok) throw new RuleRefusedError(rawMessage);
}
