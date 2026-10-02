import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";
import { ROW_ID_FIELD } from "@digitaplatform/shared";
import type { ValidationError } from "./types.js";

/**
 * Enforce compound-key uniqueness within rows of a Table field.
 *
 * Configured per Table field via `field.row_unique: string[][]`, where each
 * inner array names a tuple of child fieldnames whose combined value must
 * be unique across all rows.
 *
 * Example:
 *
 *   "row_unique": [["purpose", "is_default"]]
 *
 * → at most one row may have any given `(purpose, is_default)` pair.
 *
 * Empty / null / undefined values participate as the literal value — two
 * rows that both have `is_default: undefined` for the same `purpose` are a
 * duplicate.
 *
 * Every Table also keeps its `_row_id` unique. A row is found by it: a sub-row
 * Link, a patch, and an update that keeps a gated cell from the stored row. A
 * row without one gets a new id when it is stored.
 */
export function validateRowUniqueness(
  entity: EntityDefinition,
  data: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const field of entity.fields) {
    if (field.fieldtype !== "Table") continue;
    const rows = data[field.fieldname];
    if (!Array.isArray(rows) || rows.length < 2) continue;

    const rowsWithId = (rows as Array<Record<string, unknown>>).map((row) => {
      const rowId = row?.[ROW_ID_FIELD];
      return typeof rowId === "string" && rowId !== "" ? row : undefined;
    });
    errors.push(...findRepeatedRows(field, rowsWithId, [ROW_ID_FIELD]));
    for (const keys of field.row_unique ?? []) {
      if (keys.length > 0) errors.push(...findRepeatedRows(field, rows as Array<Record<string, unknown>>, keys));
    }
  }

  return errors;
}

/** One error per row whose `keys` repeat an earlier row's; an `undefined` row takes no part. */
function findRepeatedRows(
  field: FieldDefinition,
  rows: Array<Record<string, unknown> | undefined>,
  keys: string[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const composite = keys.map((k) => stringify(row[k])).join("\u0001");
    const prior = seen.get(composite);
    if (prior !== undefined) {
      // A person counts rows from 1; the field path keeps the engine's own index.
      const rowNumbers = `${prior + 1},${i + 1}`;
      const byRowId = keys.length === 1 && keys[0] === ROW_ID_FIELD;
      errors.push(
        byRowId
          ? {
              field: `${field.fieldname}[${i}]`,
              code: "table_row_repeated",
              message: `${field.label} rows ${prior + 1} and ${i + 1} are the same row twice`,
              params: { field: field.label, rows: rowNumbers },
            }
          : {
              field: `${field.fieldname}[${i}]`,
              code: "table_row_unique_violation",
              message: `${field.label} rows ${prior + 1} and ${i + 1} have the same (${keys.join(", ")})`,
              params: { field: field.label, rows: rowNumbers, keys: keys.join(", ") },
            },
      );
    } else {
      seen.set(composite, i);
    }
  }
  return errors;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "\u0000";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
