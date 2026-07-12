import type { ClientSession } from "mongodb";
import type { UserContext } from "../../permissions/types.js";
import type { RuleAction, RuleExecContext } from "../rule-types.js";
import { evaluateExpression, evaluateMapping } from "../rule-expression.js";

export type DocumentInserter = {
  insert: (
    doctype: string,
    data: Record<string, unknown>,
    user: UserContext,
    ctx: undefined,
    session: ClientSession,
  ) => Promise<unknown>;
};

/**
 * Execute a `create_document` action.
 *
 * When `iterate` is set, emits one new document per element of the referenced
 * array (e.g. `doc.lines`), with `row` bound to the current element.
 * Otherwise a single document is created using the mapping directly.
 *
 * Inserts ALWAYS route through DocumentService.insert (late-bound), so they
 * inherit permission checks, validators, fetch-from and lifecycle hooks and
 * join the caller's `session` (rolling back with the triggering document). The
 * former raw db.insertOne fallback was removed (P3): if the DocumentService is
 * not wired the action fails loud rather than writing an ungoverned document.
 */
export async function executeCreateDocument(
  action: RuleAction,
  exec: RuleExecContext,
  session: ClientSession,
  documentService?: DocumentInserter,
): Promise<void> {
  if (!action.target_entity) throw new Error("create_document: target_entity required");
  if (!action.field_mappings) throw new Error("create_document: field_mappings required");

  const target_entity = action.target_entity;
  const mapping = action.field_mappings as Record<string, string>;
  const rows: unknown[] = action.iterate
    ? ((evaluateExpression(action.iterate, exec) as unknown[]) ?? [])
    : [null];

  for (const row of rows) {
    if (action.condition) {
      const ok = evaluateExpression(action.condition, { ...exec, row });
      if (!ok) continue;
    }

    // Second-level iteration: walk row[iterate_child] and emit one doc per
    // inner element. Exposes the inner value as `item` and its 1-based
    // index as `item_index` in the mapping context.
    if (action.iterate_child) {
      const inner =
        (row && typeof row === "object"
          ? (row as Record<string, unknown>)[action.iterate_child]
          : undefined) ?? [];
      const innerArr = Array.isArray(inner) ? inner : [];
      for (let i = 0; i < innerArr.length; i++) {
        const item = innerArr[i];
        const data = evaluateMapping(mapping, { ...exec, row, item, item_index: i + 1 });
        await insertOne(target_entity, data, exec, session, documentService);
      }
      continue;
    }

    const data = evaluateMapping(mapping, { ...exec, row });
    await insertOne(target_entity, data, exec, session, documentService);
  }
}

async function insertOne(
  target_entity: string,
  data: Record<string, unknown>,
  exec: RuleExecContext,
  session: ClientSession,
  documentService: DocumentInserter | undefined,
): Promise<void> {
  if (!documentService) {
    throw new Error(
      "rule engine: DocumentService not wired — create_document requires the governed insert path",
    );
  }
  // Route through DocumentService so permission checks, validators, fetch-from
  // and lifecycle hooks run with the triggering user's context.
  const user = (exec.user ?? { _id: "system", email: "system", roles: [] }) as UserContext;
  await documentService.insert(target_entity, data, user, undefined, session);
}
