import { activeRecordsFilter, DIGITA } from "@digitaplatform/shared";
import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";
import type { AnyBulkWriteOperation, ClientSession, Document, Filter } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import { env } from "../config/env.js";
import { toIdStorage } from "../document/id-codec.js";
import { createLogger } from "../logging/logger.js";
import { FILE_FIELD_TYPES, parseFileId } from "./file-cleanup.js";

const log = createLogger("public-field-files");

/** Rows read, and writes sent, per round trip. */
const BATCH = 1000;

/**
 * Move the files of an attach field declared `public: true` forward to public. A file uploaded
 * while the field was private is a private `File` with the private URL, and its row holds that
 * URL; afterwards the `File` is public with the public URL, and so is each public field and Table
 * cell of that row that holds it. A file moves only when the row its `attached_to_name` names
 * holds it in a public field: the download route already lets a reader of that row read the file,
 * while another row may hold a URL copied from a file its writer may not read, which a save
 * refuses (`assertAttachFilesReadable`) but a row written before that check may hold, and a field
 * of the same name elsewhere in the entity may be private. A file that names no row stays private.
 * The URLs are derived from the id, never read from the `File`, whose `file_url` its owner may
 * rewrite. Each batch moves its rows and files in one transaction with a new `modified`, so a form loaded before the move gets a
 * conflict instead of saving the private URL back; a row holding the public URL counts, so a start
 * stopped in between completes the move. Every start reads again the private files that name a
 * row, and their rows, in one query per thousand, so a tenant with thousands of files starts in
 * seconds; the moves go as bulk writes.
 */
export async function publishFilesOfPublicFields(db: MongoDBService, entities: ReadonlyArray<EntityDefinition>): Promise<void> {
  for (const entity of entities) {
    if (!entity.is_virtual) await publishFilesOfEntity(db, entity);
  }
}

/** The public attach fields of an entity, a Table's public attach cells with their Table. */
function publicFilePaths(entity: EntityDefinition): { fieldname: string; table?: string }[] {
  const isPublicFile = (f: FieldDefinition) => f.public === true && FILE_FIELD_TYPES.has(f.fieldtype);
  return entity.fields.flatMap((field): { fieldname: string; table?: string }[] => {
    if (isPublicFile(field)) return [{ fieldname: field.fieldname }];
    if (field.fieldtype !== "Table") return [];
    return (field.child_fields ?? []).filter(isPublicFile).map((child) => ({ fieldname: child.fieldname, table: field.fieldname }));
  });
}

/**
 * Put the public URL in place of the private URL of a public file, in each public field and Table
 * cell of a document a save writes. The boot step moves a row once; a client that kept the private
 * URL and saves without If-Match would write it back, and no later start repairs it, because the
 * file is public already. Answers the fields it changed.
 */
export async function usePublicUrlsOfPublicFiles(
  db: MongoDBService,
  entity: EntityDefinition,
  data: Record<string, unknown>,
  session?: ClientSession,
): Promise<string[]> {
  const holders: { holder: Record<string, unknown>; fieldname: string; top: string; id: string }[] = [];
  for (const { fieldname, table } of publicFilePaths(entity)) {
    const cells = table ? (Array.isArray(data[table]) ? (data[table] as unknown[]) : []) : [data];
    for (const cell of cells) {
      if (!cell || typeof cell !== "object") continue;
      const holder = cell as Record<string, unknown>;
      const value = holder[fieldname];
      const id = parseFileId(value);
      if (id && value === `${env.API_PREFIX}/file/${id}/download`) holders.push({ holder, fieldname, top: table ?? fieldname, id });
    }
  }
  if (holders.length === 0) return [];
  const publicFiles = await db.find(
    DIGITA.COLLECTIONS.FILE,
    { filters: [{ _id: { $in: [...new Set(holders.map((h) => h.id))] }, is_private: false }], fields: ["_id"] },
    DIGITA.DATABASES.CORE, session,
  );
  const isPublic = new Set(publicFiles.map((file) => String(file["_id"])));
  const changed = new Set<string>();
  for (const { holder, fieldname, top, id } of holders) {
    if (!isPublic.has(id)) continue;
    holder[fieldname] = `${env.API_PREFIX}/public/file/${id}`;
    changed.add(top);
  }
  return [...changed];
}

async function publishFilesOfEntity(db: MongoDBService, entity: EntityDefinition): Promise<void> {
  const paths = publicFilePaths(entity);
  if (paths.length === 0) return;
  const candidateFilter = { attached_to_entity: entity.name, attached_to_name: { $type: "string" },
    attached_to_field: { $in: [...new Set(paths.map((p) => p.fieldname))] }, is_private: { $ne: false } };
  const candidates = await db.find(DIGITA.COLLECTIONS.FILE, {
    filters: [candidateFilter],
    fields: ["_id"],
  }, DIGITA.DATABASES.CORE);
  const tops = [...new Set(paths.map((p) => p.table ?? p.fieldname))];
  let published = 0;
  for (let i = 0; i < candidates.length; i += BATCH) {
    published += await db.withTransaction(async (session) => {
      const files = await db.findManyByFilter(DIGITA.COLLECTIONS.FILE, {
        ...candidateFilter,
        _id: { $in: candidates.slice(i, i + BATCH).map((file) => toIdStorage(String(file._id))) },
      } as unknown as Filter<Document>, DIGITA.DATABASES.CORE, session);
      if (files.length === 0) return 0;
      const rowIds = [...new Set(files.map((file) => String(file.attached_to_name)))];
      const found = await db.find(entity.name, {
        filters: [{ _id: { $in: rowIds } }], fields: tops,
      }, entity.database, session);
      const rowOf = new Map(found.map((row) => [String(row._id), row]));
      const rowMoves: AnyBulkWriteOperation<Document>[] = [];
      const fileMoves: AnyBulkWriteOperation<Document>[] = [];
      const touched = new Set<string>();
      for (const file of files) {
        const id = String(file._id);
        const rowId = String(file.attached_to_name);
        const row = rowOf.get(rowId);
        if (!row) continue;
        const privateUrl = `${env.API_PREFIX}/file/${id}/download`;
        const publicUrl = `${env.API_PREFIX}/public/file/${id}`;
        let isHeld = false;
        for (const { fieldname, table } of paths.filter((p) => p.fieldname === file.attached_to_field)) {
          const values = table ? (Array.isArray(row[table]) ? (row[table] as unknown[]).map((cell) => (cell as Record<string, unknown> | null)?.[fieldname]) : []) : [row[fieldname]];
          if (values.includes(privateUrl)) {
            const path = table ? `${table}.${fieldname}` : fieldname;
            const filter = activeRecordsFilter({ _id: toIdStorage(rowId), [path]: privateUrl, ...(table ? { [table]: { $type: "array" } } : {}) }) as Filter<Document>;
            rowMoves.push({ updateOne: table
              ? { filter, update: { $set: { [`${table}.$[cell].${fieldname}`]: publicUrl } }, arrayFilters: [{ [`cell.${fieldname}`]: privateUrl }] }
              : { filter, update: { $set: { [path]: publicUrl } } },
            });
          }
          isHeld ||= values.includes(privateUrl) || values.includes(publicUrl);
        }
        if (!isHeld) continue;
        // Write the parent even if its URL already moved, so a concurrent deletion
        // conflicts with this transaction before its retained attachment becomes public.
        if (!touched.has(rowId)) {
          touched.add(rowId);
          rowMoves.push({ updateOne: {
            filter: activeRecordsFilter({ _id: toIdStorage(rowId) }) as Filter<Document>,
            update: { $set: { modified: new Date(), modified_by: "system" } },
          } });
        }
        fileMoves.push({ updateOne: {
          filter: activeRecordsFilter({ _id: toIdStorage(id) }) as Filter<Document>,
          update: { $set: { is_private: false, file_url: publicUrl,
            ...(typeof file.thumbnail_key === "string" ? { thumbnail_url: `${publicUrl}?thumb=1` } : {}),
            modified: new Date(), modified_by: "system",
          } },
        } });
      }
      if (rowMoves.length) await db.collection(entity.name, entity.database).bulkWrite(rowMoves, { ordered: false, session });
      if (fileMoves.length) await db.collection(DIGITA.COLLECTIONS.FILE, DIGITA.DATABASES.CORE).bulkWrite(fileMoves, { ordered: false, session });
      return fileMoves.length;
    });
  }
  if (published) log.info({ entity: entity.name, files: published }, "Files of public fields made public");
}
