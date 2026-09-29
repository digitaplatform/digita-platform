import type { EntityDefinition } from "@digitaplatform/shared";
import { FieldValueError, getFieldTypeHandler, isStoredFieldType } from "../entity/field-types.js";
import { foreignPasswordValue } from "../entity/password-cipher.js";

/**
 * Serialize a row through the field-type handlers exactly like the write path
 * (DocumentService.serializeFields, which is private). Without it the raw JSON
 * values are inserted verbatim — e.g. a Date field stays an ISO string, which a
 * time-series collection rejects (the time_field MUST be a BSON Date →
 * MongoServerError BadValue). Mirrors serializeFields; keep them in sync.
 *
 * Shared by the seed loader (`seed-app-data.ts`) and the import pipeline
 * (`import-service.ts`) so the "mirrors serializeFields" invariant lives in ONE
 * place.
 */
export function serializeRowForStorage(
  entity: EntityDefinition,
  row: Record<string, unknown>,
): Record<string, unknown> {
  // A seed or import row carries a Password value as text, never in the stored form.
  const foreign = foreignPasswordValue(entity, row);
  if (foreign) throw new FieldValueError(foreign, "field_password_not_as_stored", { field: foreign });
  const result: Record<string, unknown> = {};
  for (const field of entity.fields) {
    if (!isStoredFieldType(field.fieldtype)) continue;
    const value = row[field.fieldname];
    if (value === undefined) continue;
    result[field.fieldname] = getFieldTypeHandler(field.fieldtype).toStorage(value, field);
  }
  // Pass through keys that aren't declared fields (and skip _-prefixed system
  // keys — the caller sets _id/owner/timestamps).
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith("_") || result[key] !== undefined) continue;
    if (!entity.fields.find((f) => f.fieldname === key)) result[key] = value;
  }
  return result;
}
