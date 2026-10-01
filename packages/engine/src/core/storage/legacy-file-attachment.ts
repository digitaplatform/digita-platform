import { DIGITA } from "@digitaplatform/shared";
import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import { runForwardMigrationOnce } from "../database/forward-migration.js";
import { collectAttachFileIds, FILE_FIELD_TYPES } from "./file-cleanup.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("legacy-file-attachment");

const FILE = DIGITA.COLLECTIONS.FILE;
const CORE = DIGITA.DATABASES.CORE;

export interface LegacyLooseFilesReport {
  attached: number;
  named_by_several: number;
  named_by_other_owner: number;
}

/** Run attachLegacyLooseFiles once per database; its row in `_migrations` keeps the run's counts. */
export async function attachLegacyLooseFilesOnce(db: MongoDBService, entities: ReadonlyArray<EntityDefinition>): Promise<void> {
  await runForwardMigrationOnce(db, "attach-legacy-loose-files", () => attachLegacyLooseFiles(db, entities));
}

/**
 * An app upload saved before a save attached it to its document names no document, so only its
 * uploader and an Administrator may read it, and clearing the record that names it leaves it
 * behind. Attach each such loose File to the one document of its entity that names it, in a field
 * or a Table cell, when that document's owner uploaded it. That is the rule of a save's own
 * attachment, so a reference planted in another user's record attaches nothing. A file named by
 * several documents, or by a document of another owner, stays loose and is counted. An attached
 * file is no longer loose, so a second run attaches nothing.
 */
export async function attachLegacyLooseFiles(
  db: MongoDBService,
  entities: ReadonlyArray<EntityDefinition>,
): Promise<LegacyLooseFilesReport> {
  const report: LegacyLooseFilesReport = { attached: 0, named_by_several: 0, named_by_other_owner: 0 };
  const looseFilesByEntity = new Map<string, Record<string, unknown>[]>();
  for (const file of await db.findManyByFilter(FILE, { attached_to_name: null, attached_to_entity: { $type: "string" } }, CORE)) {
    const entityName = file["attached_to_entity"] as string;
    looseFilesByEntity.set(entityName, [...(looseFilesByEntity.get(entityName) ?? []), file]);
  }

  for (const entity of entities) {
    const looseFiles = looseFilesByEntity.get(entity.name);
    const paths = attachPaths(entity);
    if (!looseFiles || paths.length === 0 || entity.is_virtual) continue;
    const looseIds = new Set(looseFiles.map((file) => String(file["_id"])));
    const namingDocs = new Map<string, Record<string, unknown>[]>();
    const docs = await db.find(
      entity.name,
      { filters: [{ $or: paths.map((path) => ({ [path]: { $type: "string" } })) }], fields: ["owner", ...paths] },
      entity.database,
    );
    for (const doc of docs) {
      for (const fileId of new Set(collectAttachFileIds(entity.fields, doc))) {
        if (looseIds.has(fileId)) namingDocs.set(fileId, [...(namingDocs.get(fileId) ?? []), doc]);
      }
    }

    for (const file of looseFiles) {
      const named = namingDocs.get(String(file["_id"])) ?? [];
      if (named.length > 1) report.named_by_several++;
      else if (named.length === 1 && named[0]!["owner"] !== file["owner"]) report.named_by_other_owner++;
      else if (named.length === 1) {
        // Pinned to the loose state, so a file a save attached meanwhile keeps its document.
        const isAttached = await db.updateOne(FILE, String(file["_id"]), { attached_to_name: String(named[0]!["_id"]) }, CORE, undefined, {
          attached_to_name: null,
        });
        if (isAttached) report.attached++;
      }
    }
  }

  log.info(report, "Legacy loose files attached to the document that names them");
  return report;
}

/** The paths of an entity's attach fields, a Table's attach cells as `<table>.<cell>`. */
function attachPaths(entity: EntityDefinition): string[] {
  return entity.fields.flatMap((field) => {
    if (FILE_FIELD_TYPES.has(field.fieldtype)) return [field.fieldname];
    if (field.fieldtype !== "Table") return [];
    return (field.child_fields ?? []).filter((cell) => FILE_FIELD_TYPES.has(cell.fieldtype)).map((cell) => `${field.fieldname}.${cell.fieldname}`);
  });
}
