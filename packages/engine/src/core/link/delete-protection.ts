import type { ClientSession } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { FILE_FIELD_TYPES, type EntityDefinition, type FieldDefinition } from "@digitaplatform/shared";
import { createLogger } from "../logging/logger.js";
import { toIdStorage } from "../document/id-codec.js";

const log = createLogger("delete-protection");

export interface DeleteBlocker {
  entity: string;
  fieldname: string;
  count: number;
}

/**
 * Check if a document is referenced by other documents.
 * If so, deletion should be blocked.
 */
export class DeleteProtection {
  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
  ) {}

  async check(doctype: string, name: string, session?: ClientSession): Promise<DeleteBlocker[]> {
    const blockers: DeleteBlocker[] = doctype === "File"
      ? await fileAttachmentBlockers(this.db, name, this.registry.getAll(), session)
      : [];
    const incomingLinks = this.registry.getIncomingLinks(doctype);

    for (const link of incomingLinks) {
      const linkDb = this.registry.get(link.entity).database;
      // Sub-row Links store composite values "<parent_id>::<row_id>" so an
      // exact-equality probe misses them. Match by prefix instead.
      const linkValueFilter = link.target_path
        ? { $regex: `^${escapeRegex(name)}::` }
        : name;
      const filter = { [link.fieldname]: linkValueFilter };
      const count = await this.db.count(link.entity, [filter], linkDb, session);

      if (count > 0) {
        blockers.push({
          entity: link.entity,
          fieldname: link.fieldname,
          count,
        });
      }
    }

    if (blockers.length > 0) {
      log.debug({ doctype, name, blockers }, "Delete blocked by references");
    }

    return blockers;
  }
}

/** File bytes must remain available while any live or retained parent names them. */
export async function fileAttachmentBlockers(
  db: MongoDBService,
  fileId: string,
  entities: readonly EntityDefinition[],
  session?: ClientSession,
): Promise<DeleteBlocker[]> {
  const blockers: DeleteBlocker[] = [];
  const storedId = toIdStorage(fileId);
  const fileUrl = { $regex: `/(?:public/file|file)/${escapeRegex(String(storedId))}(?:/download)?(?:[?#]|$)`,
    ...(typeof storedId === "string" ? {} : { $options: "i" }) };
  for (const entity of entities) {
    const paths = attachmentPaths(entity.fields);
    if (!paths.length) continue;
    // Marking a parent cannot create a gap in this read: both sides of that transition hold it.
    const count = await db.count(entity.name, [{ $or: paths.map((path) => ({ [path]: fileUrl })) }],
      entity.database, session, { includeDeleted: true });
    if (count > 0) blockers.push({ entity: entity.name, fieldname: paths.join(", "), count });
  }
  return blockers;
}

function attachmentPaths(fields: readonly FieldDefinition[], prefix = ""): string[] {
  return fields.flatMap((field) => {
    const path = `${prefix}${field.fieldname}`;
    if (FILE_FIELD_TYPES.some((type) => type === field.fieldtype)) return [path];
    return field.fieldtype === "Table" ? attachmentPaths(field.child_fields ?? [], `${path}.`) : [];
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
