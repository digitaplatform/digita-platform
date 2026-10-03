import type { ClientSession, Document } from "mongodb";
import { DIGITA } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";

/**
 * Where a deleted record waits until a restore or the purge: one row per record in `_deleted` of
 * the audits database, beside `_versions`. The record leaves its entity's collection, so every read
 * of that collection (lists, get, count, links, search, exports, imports, the delete protection,
 * unique indexes, the website and reports) passes it over without a filter of its own.
 */
export const DELETED_COLLECTION = "_deleted";

export interface DeletedRecord {
  _id: string;
  entity: string;
  document_name: string;
  deleted_at: Date;
  deleted_by: string;
  /** The row as its entity's collection stored it, child rows included. */
  record: Record<string, unknown>;
  /** The record's data translations, as the core database stored them. */
  translations: Record<string, unknown>[];
}

/** One deletion: a record of the same name deleted again later is a deletion of its own. */
const deletedRecordId = (entity: string, name: string, deletedAt: Date): string => `${entity}:${name}:${deletedAt.getTime()}`;

export class DeletedRecords {
  constructor(private readonly db: MongoDBService) {}

  /** Keep a record that is being deleted. Every deletion is kept, also of a name deleted before,
   *  so only the purge ever removes one. */
  async keep(
    entry: Omit<DeletedRecord, "_id" | "deleted_at">,
    session: ClientSession,
  ): Promise<void> {
    const deletedAt = new Date();
    const _id = deletedRecordId(entry.entity, entry.document_name, deletedAt);
    await this.db.insertOne(DELETED_COLLECTION, { _id, ...entry, deleted_at: deletedAt }, DIGITA.DATABASES.AUDITS, session);
  }

  /** The deletion of `name` at `deletedAt`. */
  async find(entity: string, name: string, deletedAt: Date, session?: ClientSession): Promise<DeletedRecord | null> {
    return (await this.db.findOne(DELETED_COLLECTION, deletedRecordId(entity, name, deletedAt), DIGITA.DATABASES.AUDITS, session)) as DeletedRecord | null;
  }

  /** The entity's deleted records, the latest first. */
  async list(entity: string): Promise<DeletedRecord[]> {
    // ponytail: reads every deleted record of the entity; page in the database if one entity
    // gathers more deleted records within its retention than a list can hold.
    const rows = await this.db.aggregate(
      DELETED_COLLECTION,
      [{ $match: { entity } }, { $sort: { deleted_at: -1, _id: 1 } }],
      DIGITA.DATABASES.AUDITS,
    );
    return rows as unknown as DeletedRecord[];
  }

  async remove(deleted: DeletedRecord, session: ClientSession): Promise<void> {
    await this.db.deleteOne(DELETED_COLLECTION, deleted._id, DIGITA.DATABASES.AUDITS, session);
  }

  /** Forget the deleted records of `entities`, as a reset of their data does. */
  async clear(entities: string[]): Promise<number> {
    return this.db.deleteMany(DELETED_COLLECTION, { entity: { $in: entities } } satisfies Document, DIGITA.DATABASES.AUDITS);
  }
}
