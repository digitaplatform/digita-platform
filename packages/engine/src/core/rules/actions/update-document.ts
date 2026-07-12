import type { ClientSession } from "mongodb";
import type { UserContext } from "../../permissions/types.js";
import type { RuleAction, RuleExecContext } from "../rule-types.js";
import { evaluateExpression, evaluateMapping, evaluateValueSlot } from "../rule-expression.js";

/**
 * The governed post-submit updater the rule engine late-binds (the full
 * DocumentService satisfies it structurally).
 */
export type SubmittedUpdater = {
  updateSubmitted: (
    doctype: string,
    name: string,
    patch: { set?: Record<string, unknown> },
    user: UserContext,
    ctx: undefined,
    options: { sessionOverride: ClientSession; cause?: { doctype: string; name: string } },
  ) => Promise<unknown>;
};

/**
 * Execute an `update_document` action — a GOVERNED post-submit band patch (F6,
 * Cluster A). Every resolved (target_name, field_mappings) pair is applied via
 * `DocumentService.updateSubmitted`, so it obeys the full band gate: the target
 * MUST be docstatus=1 and every mapping key MUST be `allow_on_submit:true`
 * (docstatus-engine band gate); metadata/version/activity are owned by
 * updateSubmitted. Draft-target cross-doc updates stay hooks-only. An empty
 * diff throws `empty_submitted_patch` — a rule mapping to unchanged values is
 * an error, not a no-op.
 *
 * The write joins the caller's `session` (`sessionOverride`) so it rolls back
 * with the triggering document. RBAC rides the triggering user (D8) — no
 * `skipWritePermCheck`.
 *
 * `iterate` + per-row `condition` + `iterate_child` parity with create_document
 * is preserved.
 */
export async function executeUpdateDocument(
  action: RuleAction,
  exec: RuleExecContext,
  documentService: SubmittedUpdater | undefined,
  session: ClientSession,
): Promise<void> {
  if (!action.target_entity) throw new Error("update_document: target_entity required");
  if (!action.target_name) throw new Error("update_document: target_name required");
  if (!action.field_mappings) throw new Error("update_document: field_mappings required");
  if (!documentService) {
    throw new Error(
      "rule engine: DocumentService not wired — update_document requires the governed updateSubmitted path",
    );
  }

  const target_entity = action.target_entity;
  const target_name = action.target_name;
  const mapping = action.field_mappings as Record<string, string>;
  const user = (exec.user ?? { _id: "system", email: "system", roles: [] }) as UserContext;
  const cause = {
    doctype: exec.entityName ?? "",
    name: String((exec.doc as Record<string, unknown> | undefined)?.["_id"] ?? ""),
  };

  const applyOne = async (ctx: RuleExecContext): Promise<void> => {
    const id = String(evaluateValueSlot(target_name, ctx));
    const updates = evaluateMapping(mapping, ctx);
    await documentService.updateSubmitted(target_entity, id, { set: updates }, user, undefined, {
      sessionOverride: session,
      cause,
    });
  };

  if (action.iterate) {
    const rows = (evaluateExpression(action.iterate, exec) as unknown[]) ?? [];
    for (const row of rows) {
      if (action.condition) {
        const ok = evaluateExpression(action.condition, { ...exec, row });
        if (!ok) continue;
      }
      if (action.iterate_child) {
        const inner =
          (row && typeof row === "object"
            ? (row as Record<string, unknown>)[action.iterate_child]
            : undefined) ?? [];
        const innerArr = Array.isArray(inner) ? inner : [];
        for (let i = 0; i < innerArr.length; i++) {
          await applyOne({ ...exec, row, item: innerArr[i], item_index: i + 1 });
        }
        continue;
      }
      await applyOne({ ...exec, row });
    }
    return;
  }

  await applyOne(exec);
}
