import { randomUUID } from "crypto";
import type { ClientSession } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA, type EntityDefinition } from "@digitaplatform/shared";
import { calculateChanges, type FieldChange } from "../document/change-tracker.js";
import type { BaseDocument } from "../document/base-document.js";
import { createLogger } from "../logging/logger.js";
import { readStoredRow } from "../entity/field-types.js";

const log = createLogger("version-service");

export interface Version {
  _id?: string;
  entity: string;
  document_name: string;
  changed_by: string;
  timestamp: Date;
  changes: FieldChange[];
}

/** Each change's old and new value as a reader of the document gets it: a Password value is hidden. */
export function readVersionChanges(version: Version, entity: EntityDefinition): Version {
  const read = (field: string, value: unknown) => readStoredRow(entity, { [field]: value })[field];
  return {
    ...version,
    changes: version.changes.map((c) => ({ ...c, old: read(c.field, c.old), new: read(c.field, c.new) })),
  };
}

export class VersionService {
  constructor(private db: MongoDBService) {}

  /** Remove only this record's history when its retained row is physically purged. */
  async deleteVersions(entity: string, documentName: string, session: ClientSession): Promise<number> {
    return this.db.deleteMany("_versions", { entity, document_name: documentName }, DIGITA.DATABASES.AUDITS, session);
  }

  /**
   * Store a version entry. Pass `session` to enlist the write into the
   * caller's transaction so the version is rolled back if the parent
   * doc-write fails (and never written without a parent doc).
   */
  async createVersion(
    doc: BaseDocument,
    user: string,
    session?: ClientSession,
  ): Promise<void> {
    return this.createVersionFromChanges(
      doc.doctype,
      doc._id,
      calculateChanges(doc),
      user,
      session,
    );
  }

  /**
   * Store a version entry from a pre-computed change set. Used by
   * `updateSubmitted` to record ROW-GRANULAR child-table diffs (path
   * `table[row_id].cell`) instead of the whole-array old→new pair that
   * `calculateChanges` produces. `createVersion` delegates here, so the
   * common path is unchanged.
   */
  async createVersionFromChanges(
    doctype: string,
    name: string,
    changes: FieldChange[],
    user: string,
    session?: ClientSession,
  ): Promise<void> {
    if (changes.length === 0) return;

    const version: Version = {
      entity: doctype,
      document_name: name,
      changed_by: user,
      timestamp: new Date(),
      changes,
    };

    await this.db.insertOne(
      "_versions",
      {
        ...version,
        _id: `${doctype}:${name}:${Date.now()}:${randomUUID()}`,
      },
      DIGITA.DATABASES.AUDITS,
      session,
    );

    log.debug(
      {
        entity: doctype,
        name,
        changes_count: changes.length,
      },
      "Version created",
    );
  }

  /**
   * Get version history for a document.
   */
  async getVersions(entity: string, documentName: string, limit: number = 20): Promise<Version[]> {
    const docs = await this.db.find(
      "_versions",
      {
        filters: [{ entity, document_name: documentName }],
        order_by: "timestamp desc",
        limit,
      },
      DIGITA.DATABASES.AUDITS,
    );
    return docs as unknown as Version[];
  }

  /**
   * Global audit-log query — recent field-level changes across ALL documents
   * (backs the admin "Audit log" view). Optional filters: entity / changed_by.
   */
  async queryVersions(
    filters: Record<string, unknown>,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ data: Version[]; total: number }> {
    const f = Object.keys(filters).length > 0 ? [filters] : [];
    const [data, total] = await Promise.all([
      this.db.find(
        "_versions",
        { filters: f, order_by: "timestamp desc", limit, offset },
        DIGITA.DATABASES.AUDITS,
      ),
      this.db.count("_versions", f, DIGITA.DATABASES.AUDITS),
    ]);
    return { data: data as unknown as Version[], total };
  }
}
