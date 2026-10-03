import { DIGITA, JOBS_CURSOR_PARAM, type ActionChunkResult } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { DocumentService } from "../document/document-service.js";
import { toIdStorage } from "../document/id-codec.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { HookRunner } from "../hooks/hook-runner.js";

const CHUNK_SIZE = 100;
interface Cursor {
  entity: string;
  after?: string;
  completed: number;
  records: number;
  files: number;
  versions: number;
  translations: number;
}

/** Uses the existing job protocol. Every record commits independently, so a failed chunk can retry. */
export function registerPurgeDeletedAction(
  db: MongoDBService, registry: EntityRegistry, hookRunner: HookRunner, documentService: DocumentService,
): void {
  hookRunner.registerAction(DIGITA.COLLECTIONS.SETTING, "purge_deleted", async (doc, _ctx, services): Promise<ActionChunkResult> => {
    if (!services?.user || services.session) throw new Error("Physical purge needs its actor and its own transactions");
    const months = Number(doc.get("deleted_retention_months") ?? 12);
    if (![12, 18, 24, 30].includes(months)) throw new RangeError("Invalid deleted record retention");
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const entities = registry.getAll().sort((a, b) =>
      Number(a.name === DIGITA.COLLECTIONS.FILE) - Number(b.name === DIGITA.COLLECTIONS.FILE) || a.name.localeCompare(b.name));
    const raw = services.actionParams?.[JOBS_CURSOR_PARAM];
    if (raw !== undefined && typeof raw !== "string") throw new RangeError("Invalid purge cursor");
    const state: Cursor = typeof raw === "string" && raw ? JSON.parse(raw) as Cursor : {
      entity: entities[0]?.name ?? "", completed: 0, records: 0, files: 0, versions: 0, translations: 0,
    };
    if (!state || typeof state !== "object") throw new RangeError("Invalid purge cursor");
    let index = entities.findIndex((entity) => entity.name === state.entity);
    if (index < 0 || (state.after !== undefined && typeof state.after !== "string") ||
      [state.completed, state.records, state.files, state.versions, state.translations].some((n) => !Number.isSafeInteger(n) || n < 0)) {
      throw new RangeError("Invalid purge cursor");
    }
    const entity = entities[index]!;
    const filter = {
      deleted: { $type: "date", $lt: cutoff },
      // Aggregation comparisons order mixed string/ObjectId identities as the same sort does.
      ...(state.after ? { $expr: { $gt: ["$_id", { $literal: toIdStorage(state.after) }] } } : {}),
    };
    const rows = await db.aggregate(entity.name, [{ $match: filter }, { $sort: { _id: 1 } }, { $limit: CHUNK_SIZE }], entity.database, undefined, { includeDeleted: true });
    for (const row of rows) {
      const result = await documentService.purgeDoc(entity.name, String(row["_id"]), services.user, { deletedBefore: cutoff });
      state.completed++;
      state.records += Number(result.purged) + (entity.name === DIGITA.COLLECTIONS.FILE ? 0 : result.files_deleted);
      state.files += result.files_deleted;
      state.versions += result.versions_deleted;
      state.translations += result.translations_deleted;
    }
    if (rows.length < CHUNK_SIZE) {
      index++;
      state.entity = entities[index]?.name ?? "";
      delete state.after;
    } else {
      state.after = String(rows.at(-1)!["_id"]);
    }
    const done = index >= entities.length;
    return {
      done,
      ...(done ? {} : { cursor: JSON.stringify(state) }),
      progress: { completed: state.completed, message: `${state.records} records purged; ${state.completed} checked` },
      ...(done ? { result: { records_purged: state.records, files_deleted: state.files,
        versions_deleted: state.versions, translations_deleted: state.translations, retention_months: months } } : {}),
    };
  });
}
