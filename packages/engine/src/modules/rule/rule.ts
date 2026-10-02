import type { BaseDocument } from "../../core/document/base-document.js";
import type { ResponseContext } from "../../core/api/response-context.js";
import type { HookServices } from "../../core/hooks/hook-runner.js";
import { ValidationFailedError } from "../../core/document/document-service.js";
import { clearRuleCache, findRuleLintError, findUnparsableRuleExpression } from "../../core/rules/rule-loader.js";
import type { RuleDefinition } from "../../core/rules/rule-types.js";

/**
 * Rule — before_insert / before_save: refuse a rule the start would refuse as a file, one whose
 * expression does not parse or that cannot run on its entity. Stored, it would fail every save of
 * its entity.
 */
export async function beforeSave(doc: BaseDocument, _ctx?: ResponseContext, services?: HookServices): Promise<void> {
  const rule = doc._data as unknown as RuleDefinition;
  const problem = findUnparsableRuleExpression(rule);
  if (problem) {
    const inCondition = !!rule.condition && findUnparsableRuleExpression({ ...rule, actions: [] }) !== null;
    throw new ValidationFailedError("Rule", [
      { field: inCondition ? "condition" : "actions", message_key: "rule_expression_invalid", params: { error: problem } },
    ]);
  }
  const lint = services?.registry ? findRuleLintError(rule, services.registry) : null;
  // The event is a Select, so a lint of a Rule save can only fail on its actions.
  if (lint) throw new ValidationFailedError("Rule", [{ field: "actions", message_key: "rule_invalid", params: { error: lint } }]);
}

/**
 * Rule — after_insert / on_update / after_delete: the rule engine caches each entity's active
 * rules, so a saved or deleted rule acts from the next save on. The cache is this engine's own; a
 * second pod of the same engine sees the change when its cache runs out.
 */
export async function forgetCachedRules(): Promise<void> {
  clearRuleCache();
}
