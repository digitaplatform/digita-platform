import type { EntityDefinition } from "@digitaplatform/shared";
import { calendarDay, LAYOUT_FIELD_TYPES, ROW_ID_FIELD } from "@digitaplatform/shared";

/** Who a default is resolved for, and the tenant's time zone, whose day `__today__` names. */
export interface DefaultContext {
  user: string;
  userName?: string;
  timeZone: string;
}
import { evaluateExpressionValue } from "../expression/expression-evaluator.js";

/**
 * Resolve default values for a new document.
 * Handles static values, magic tokens, and `eval:` expression defaults
 * (evaluated against the document being built, e.g. `eval:doc.qty * doc.rate`).
 */
export function resolveDefaults(
  entity: EntityDefinition,
  data: Record<string, unknown>,
  who: DefaultContext,
): Record<string, unknown> {
  const result = { ...data };
  applyFieldDefaults(entity.fields, result, who);

  // H-P5: child-table rows have their own field defaults (e.g. a line date that
  // defaults to __today__, or an eval:). These were never applied — the loop only
  // touched header fields — so a magic-token default on a line stayed the literal
  // "__today__" (an unsaveable Date, a silently-wrong Data value). Apply each Table
  // field's child-field defaults to every submitted row.
  for (const field of entity.fields) {
    if (field.fieldtype !== "Table" || !field.child_fields) continue;
    const rows = result[field.fieldname];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row && typeof row === "object") {
        applyFieldDefaults(field.child_fields, row as Record<string, unknown>, who);
      }
    }
  }

  return result;
}

/**
 * Apply child-field defaults to child rows that were NEWLY ADDED on an update
 * (a row whose `_row_id` is not among the originally-loaded rows). Insert already
 * defaults every row via resolveDefaults; update() skipped defaults entirely, so
 * a line added during a later edit received no __today__/__user__/eval default,
 * unlike the identical line at insert. Header fields and existing rows are left
 * untouched — only unset fields on brand-new rows are filled.
 */
export function applyNewChildRowDefaults(
  entity: EntityDefinition,
  data: Record<string, unknown>,
  original: Record<string, unknown>,
  who: DefaultContext,
): void {
  for (const field of entity.fields) {
    if (field.fieldtype !== "Table" || !field.child_fields) continue;
    const rows = data[field.fieldname];
    if (!Array.isArray(rows)) continue;

    const originalRows = original[field.fieldname];
    const existingRowIds = new Set<string>(
      Array.isArray(originalRows)
        ? originalRows
            .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
            .map((r) => r[ROW_ID_FIELD])
            .filter((rid): rid is string => typeof rid === "string" && rid !== "")
        : [],
    );

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const rid = (row as Record<string, unknown>)[ROW_ID_FIELD];
      // Existing row (known _row_id) → leave as-is. New row (no/unknown id) → default.
      if (typeof rid === "string" && existingRowIds.has(rid)) continue;
      applyFieldDefaults(field.child_fields, row as Record<string, unknown>, who);
    }
  }
}

/** Apply each field's default to `target` (a header doc or a child-table row). */
function applyFieldDefaults(
  fields: EntityDefinition["fields"],
  target: Record<string, unknown>,
  who: DefaultContext,
): void {
  for (const field of fields) {
    if (LAYOUT_FIELD_TYPES.includes(field.fieldtype)) continue;
    if (field.default === undefined) continue;

    // Only apply default if field is not already set.
    if (
      target[field.fieldname] !== undefined &&
      target[field.fieldname] !== null &&
      target[field.fieldname] !== ""
    ) {
      continue;
    }

    // `eval:` defaults are expressions evaluated against the row/doc-in-progress.
    // evaluateExpressionValue strips the prefix and safe-defaults to null.
    if (typeof field.default === "string" && field.default.startsWith("eval:")) {
      target[field.fieldname] = evaluateExpressionValue(field.default, {
        doc: target,
        user: { email: who.user, full_name: who.userName ?? who.user },
      });
    } else {
      target[field.fieldname] = resolveMagicDefault(field.default, who);
    }
  }
}

function resolveMagicDefault(value: unknown, who: DefaultContext): unknown {
  if (typeof value !== "string") return value;

  switch (value) {
    case "__today__":
      return calendarDay(new Date(), who.timeZone); // YYYY-MM-DD
    case "__now__":
      return new Date();
    case "__user__":
      return who.user;
    case "__username__":
      return who.userName ?? who.user;
    default:
      return value;
  }
}
