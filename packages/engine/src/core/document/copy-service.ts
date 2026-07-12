import type { EntityDefinition } from "@digitaplatform/shared";
import { LAYOUT_FIELD_TYPES } from "@digitaplatform/shared";

/**
 * Create a copy of document data, respecting no_copy flags.
 */
export function copyDocumentData(
  entity: EntityDefinition,
  sourceData: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};

  for (const field of entity.fields) {
    if (LAYOUT_FIELD_TYPES.includes(field.fieldtype)) continue;
    if (field.no_copy) continue;
    if (field.fieldname === "docstatus") continue;

    const value = sourceData[field.fieldname];

    if (field.fieldtype === "Table" && Array.isArray(value)) {
      // Deep copy child rows, reset idx
      copy[field.fieldname] = (value as Record<string, unknown>[]).map((row, idx) => {
        let rowCopy: Record<string, unknown>;
        if (field.child_fields) {
          rowCopy = {};
          for (const childField of field.child_fields) {
            if (childField.no_copy) continue;
            if (LAYOUT_FIELD_TYPES.includes(childField.fieldtype)) continue;
            rowCopy[childField.fieldname] = row[childField.fieldname];
          }
        } else {
          // No declared child_fields: pass the row through verbatim instead of
          // wiping it down to {idx}. Drop the stable per-row identity so insert()
          // re-stamps a fresh _row_id (matching the declared-child_fields path).
          rowCopy = { ...row };
          delete rowCopy["_row_id"];
        }
        rowCopy["idx"] = idx;
        return rowCopy;
      });
    } else {
      copy[field.fieldname] = value;
    }
  }

  // Reset standard fields
  delete copy["_id"];
  copy["docstatus"] = 0;

  // Drop the business-key field(s) so insert() regenerates a fresh key. Copying
  // them verbatim collides with the unique index (E11000) when a numbered
  // document (business_key_series) is copied/amended — insert() only regenerates
  // the series when the field is empty. business_key may be a single field name
  // or an array of them.
  const businessKey = entity.business_key;
  if (typeof businessKey === "string") {
    delete copy[businessKey];
  } else if (Array.isArray(businessKey)) {
    for (const bk of businessKey) delete copy[bk];
  }

  // Reset the workflow state to the entity's initial state so a fresh copy /
  // amendment starts at the beginning of its lifecycle instead of inheriting
  // the source's advanced state (which, combined with the docstatus:0 reset
  // above, would otherwise be an impossible "draft-but-Approved" pair). Only
  // entities that declare an is_initial state are touched — a plain
  // (non-workflow) `status` field is left untouched.
  const initialState = (entity.states ?? []).find((s) => s.is_initial)?.value;
  if (initialState !== undefined) {
    copy[entity.workflow_field ?? "status"] = initialState;
  }

  return copy;
}
