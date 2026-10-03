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

const deletedRecordId = (entity: string, name: string): string => `${entity}:${name}`;

export class DeletedRecords {
  constructor(private readonly db: MongoDBService) {}

  /** Keep a record that is being deleted. A record of the same name deleted before is replaced:
   *  one name has one deleted record, the one a restore brings back. */
  async keep(
    entry: Omit<DeletedRecord, "_id" | "deleted_at">,
    session: ClientSession,
  ): Promise<void> {
    const _id = deletedRecordId(entry.entity, entry.document_name);
    await this.db.upsertOne(DELETED_COLLECTION, _id, { _id, ...entry, deleted_at: new Date() }, DIGITA.DATABASES.AUDITS, session);
  }

  async find(entity: string, name: string, session?: ClientSession): Promise<DeletedRecord | null> {
    return (await this.db.findOne(DELETED_COLLECTION, deletedRecordId(entity, name), DIGITA.DATABASES.AUDITS, session)) as DeletedRecord | null;
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

  async remove(entity: string, name: string, session: ClientSession): Promise<void> {
    await this.db.deleteOne(DELETED_COLLECTION, deletedRecordId(entity, name), DIGITA.DATABASES.AUDITS, session);
  }

  /** Forget the deleted records of `entities`, as a reset of their data does. */
  async clear(entities: string[]): Promise<number> {
    return this.db.deleteMany(DELETED_COLLECTION, { entity: { $in: entities } } satisfies Document, DIGITA.DATABASES.AUDITS);
  }
}
