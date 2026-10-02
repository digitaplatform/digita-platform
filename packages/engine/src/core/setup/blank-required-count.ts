import type { EntityDefinition } from "@digitaplatform/shared";
import { LAYOUT_FIELD_TYPES } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import { EntityRegistry } from "../entity/entity-registry.js";
import { isMissing } from "../entity/field-to-zod.js";
import { loadAppEntityFiles } from "./load-app-entity-files.js";

/** One counted field: how many stored documents an update would refuse for it. */
export interface BlankRequiredCount {
  database: string;
  entity: string;
  /** `field`, or `table.field` for a required field of a Table row. */
  field: string;
  documents: number;
}

/**
 * Count, per entity and required field, the stored documents with a value there that the save
 * refuses as missing (`isMissing`, the rule every save applies), which any later update of the
 * document refuses. Read-only, and it answers counts, never a value. A field required only through
 * `mandatory_depends_on` is not counted.
 */
export async function countBlankRequired(db: MongoDBService, entities: EntityDefinition[]): Promise<BlankRequiredCount[]> {
  const out: BlankRequiredCount[] = [];
  for (const entity of entities) {
    if (entity.is_child || entity.is_virtual) continue;
    const fields = (entity.fields ?? []).filter((f) => !LAYOUT_FIELD_TYPES.includes(f.fieldtype));
    const required = fields.filter((f) => f.required);
    const tables = fields
      .filter((f) => f.fieldtype === "Table")
      .map((table) => ({ table, cells: (table.child_fields ?? []).filter((c) => c.required && !LAYOUT_FIELD_TYPES.includes(c.fieldtype)) }))
      .filter(({ cells }) => cells.length > 0);
    if (required.length === 0 && tables.length === 0) continue;
    const projected = [...required, ...tables.map(({ table }) => table)].map((f) => f.fieldname);
    const rows = (await db.find(entity.name, { fields: projected }, entity.database)) as Record<string, unknown>[];
    for (const field of required) {
      const documents = rows.filter((row) => isMissing(field, row[field.fieldname])).length;
      out.push({ database: entity.database, entity: entity.name, field: field.fieldname, documents });
    }
    for (const { table, cells } of tables) {
      for (const cell of cells) {
        const documents = rows.filter((row) => {
          const tableRows = row[table.fieldname];
          return Array.isArray(tableRows) && tableRows.some((r) => isMissing(cell, (r as Record<string, unknown> | null)?.[cell.fieldname]));
        }).length;
        out.push({ database: entity.database, entity: entity.name, field: `${table.fieldname}.${cell.fieldname}`, documents });
      }
    }
  }
  return out;
}

/** Count for the app the engine runs, with its definitions loaded as the boot loads them. */
export async function countBlankRequiredInApp(db: MongoDBService): Promise<BlankRequiredCount[]> {
  const registry = new EntityRegistry();
  await loadAppEntityFiles(db, registry);
  await registry.loadFromDb(db);
  return countBlankRequired(db, registry.getAll());
}
