import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";
import { LAYOUT_FIELD_TYPES } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";

/** One counted field: how many stored documents an update would refuse for it. */
export interface BlankRequiredCount {
  database: string;
  entity: string;
  /** `field`, or `table.field` for a required field of a Table row. */
  field: string;
  documents: number;
}

/**
 * The stored value a required field refuses since every save validates the whole document:
 * the same rule as `isMissing` of field-to-zod, as a Mongo condition on `path`. A missing,
 * null or blank text value; an unticked Check; a Rating of 0.
 */
export function missingValueCondition(field: FieldDefinition, path: string): Record<string, unknown> {
  const blank: Record<string, unknown>[] = [{ [path]: { $exists: false } }, { [path]: null }, { [path]: { $regex: "^\\s*$" } }];
  if (field.fieldtype === "Check") blank.push({ [path]: false }, { [path]: 0 });
  if (field.fieldtype === "Rating") blank.push({ [path]: 0 });
  return { $or: blank };
}

/**
 * Count, per entity and required field, the stored documents with a blank value there, which
 * any later update of the document refuses. Read-only, and it answers counts, never a value.
 */
export async function countBlankRequired(db: MongoDBService, entities: EntityDefinition[]): Promise<BlankRequiredCount[]> {
  const out: BlankRequiredCount[] = [];
  for (const entity of entities) {
    if (entity.is_child || entity.is_virtual) continue;
    for (const field of entity.fields ?? []) {
      if (LAYOUT_FIELD_TYPES.includes(field.fieldtype)) continue;
      if (field.required) {
        const documents = await db.count(entity.name, [missingValueCondition(field, field.fieldname)], entity.database);
        out.push({ database: entity.database, entity: entity.name, field: field.fieldname, documents });
      }
      if (field.fieldtype !== "Table") continue;
      for (const child of field.child_fields ?? []) {
        if (!child.required || LAYOUT_FIELD_TYPES.includes(child.fieldtype)) continue;
        const row = missingValueCondition(child, child.fieldname);
        const documents = await db.count(entity.name, [{ [field.fieldname]: { $elemMatch: row } }], entity.database);
        out.push({ database: entity.database, entity: entity.name, field: `${field.fieldname}.${child.fieldname}`, documents });
      }
    }
  }
  return out;
}
