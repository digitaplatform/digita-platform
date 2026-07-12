import type { EntityDefinition } from "@digitaplatform/shared";
import { BadRequestError } from "../view/view-engine.js";

/**
 * Decode string CSV cells to the JS types the write pipeline expects, driven by
 * each column's declared fieldtype. This runs BEFORE the field-type handlers'
 * `toStorage` because some handlers are lossy on raw strings — critically the
 * Check handler is `Boolean(value)`, so the string "false" would coerce to
 * `true`. Numeric/Date handlers already parse strings, so those pass through.
 *
 * - empty cell → key absent (so a blank column doesn't overwrite a value)
 * - Check → "true"/"1" → true, "false"/"0" → false, else 400
 * - Table / JSON → `JSON.parse`, else 400
 * - unknown column → passed through unchanged (the import service rejects it)
 */
export function decodeCsvRows(
  entity: EntityDefinition,
  rows: Record<string, string>[],
): Record<string, unknown>[] {
  const byName = new Map(entity.fields.map((f) => [f.fieldname, f] as const));
  return rows.map((raw, i) => {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(raw)) {
      if (val === "" || val == null) continue; // blank → absent
      const field = byName.get(key);
      if (!field) {
        out[key] = val; // unknown column — let the service fail loud
        continue;
      }
      switch (field.fieldtype) {
        case "Check": {
          const s = String(val).trim().toLowerCase();
          if (s === "true" || s === "1") out[key] = true;
          else if (s === "false" || s === "0") out[key] = false;
          else
            throw new BadRequestError(
              `import_invalid_cell: row ${i + 1} column "${key}" expected a boolean, got "${val}"`,
            );
          break;
        }
        case "Table":
        case "JSON": {
          try {
            out[key] = JSON.parse(val);
          } catch {
            throw new BadRequestError(
              `import_invalid_cell: row ${i + 1} column "${key}" is not valid JSON`,
            );
          }
          break;
        }
        default:
          out[key] = val; // Int/Float/Date/etc. handlers parse strings themselves
      }
    }
    return out;
  });
}
