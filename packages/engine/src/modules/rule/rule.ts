import type { BaseDocument } from "../../core/document/base-document.js";
import { ValidationFailedError } from "../../core/document/document-service.js";
import { findUnparsableRuleExpression } from "../../core/rules/rule-loader.js";
import type { RuleDefinition } from "../../core/rules/rule-types.js";

/**
 * Rule — before_insert / before_save: refuse a rule with an expression that does not parse, as
 * the start refuses a rule file with one. Stored, it would fail every save of its entity.
 */
export async function beforeSave(doc: BaseDocument): Promise<void> {
  const rule = doc._data as unknown as RuleDefinition;
  const problem = findUnparsableRuleExpression(rule);
  if (!problem) return;
  const inCondition = !!rule.condition && findUnparsableRuleExpression({ ...rule, actions: [] }) !== null;
  throw new ValidationFailedError("Rule", [
    { field: inCondition ? "condition" : "actions", message_key: "rule_expression_invalid", params: { error: problem } },
  ]);
}
