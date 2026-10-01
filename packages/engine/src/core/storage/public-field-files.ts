import { DIGITA } from "@digitaplatform/shared";
import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";
import type { AnyBulkWriteOperation, ClientSession, Document, Filter } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import { env } from "../config/env.js";
import { toIdStorage, toIdString } from "../document/id-codec.js";
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
 * rewrite. The row moves first and gets a new `modified`, so a form loaded before the move gets a
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
  const publicFiles = await db
    .collection(DIGITA.COLLECTIONS.FILE, DIGITA.DATABASES.CORE)
    .find({ _id: { $in: [...new Set(holders.map((h) => h.id))] }, is_private: false } as unknown as Filter<Document>, { projection: { _id: 1 }, session })
    .toArray();
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

  const files = await db
    .collection(DIGITA.COLLECTIONS.FILE, DIGITA.DATABASES.CORE)
    .find(
      {
        attached_to_entity: entity.name,
        attached_to_name: { $type: "string" },
        attached_to_field: { $in: [...new Set(paths.map((p) => p.fieldname))] },
        is_private: { $ne: false },
      },
      { projection: { attached_to_name: 1, attached_to_field: 1, thumbnail_key: 1 } },
    )
    .toArray();
  if (files.length === 0) return;

  // One read of the named rows per batch, instead of queries per file and path.
  const rows = db.collection(entity.name, entity.database);
  const rowOf = new Map<string, Document>();
  const tops = [...new Set(paths.map((p) => p.table ?? p.fieldname))];
  const rowIds = [...new Set(files.map((file) => toIdString(toIdStorage(file["attached_to_name"] as string))))];
  for (let i = 0; i < rowIds.length; i += BATCH) {
    const batch = rowIds.slice(i, i + BATCH).map((id) => toIdStorage(id));
    const found = await rows.find({ _id: { $in: batch } } as unknown as Filter<Document>, { projection: Object.fromEntries(tops.map((top) => [top, 1])) }).toArray();
    for (const row of found) rowOf.set(toIdString(row["_id"]), row);
  }

  const rowMoves: AnyBulkWriteOperation<Document>[] = [];
  const fileMoves: AnyBulkWriteOperation<Document>[] = [];
  for (const file of files) {
    const id = file["_id"] as unknown as string;
    const rowId = toIdString(toIdStorage(file["attached_to_name"] as string));
    const row = rowOf.get(rowId);
    if (!row) continue;
    const privateUrl = `${env.API_PREFIX}/file/${id}/download`;
    const publicUrl = `${env.API_PREFIX}/public/file/${id}`;
    let isHeld = false;
    for (const { fieldname, table } of paths.filter((p) => p.fieldname === file["attached_to_field"])) {
      // A Table value that is not a list holds no rows, and an update of its cells would throw.
      const values = table ? (Array.isArray(row[table]) ? (row[table] as unknown[]).map((cell) => (cell as Record<string, unknown> | null)?.[fieldname]) : []) : [row[fieldname]];
      if (values.includes(privateUrl)) {
        const path = table ? `${table}.${fieldname}` : fieldname;
        // The filter holds the private URL, so a row that changed since the read is left as it is.
        const filter = { _id: toIdStorage(rowId), [path]: privateUrl, ...(table ? { [table]: { $type: "array" } } : {}) } as unknown as Filter<Document>;
        rowMoves.push({
          updateOne: table
            ? { filter, update: { $set: { [`${table}.$[cell].${fieldname}`]: publicUrl, modified: new Date() } }, arrayFilters: [{ [`cell.${fieldname}`]: privateUrl }] }
            : { filter, update: { $set: { [path]: publicUrl, modified: new Date() } } },
        });
      }
      isHeld ||= values.includes(privateUrl) || values.includes(publicUrl);
    }
    if (!isHeld) continue;
    fileMoves.push({
      updateOne: {
        filter: { _id: id } as unknown as Filter<Document>,
        update: {
          $set: {
            is_private: false,
            file_url: publicUrl,
            ...(typeof file["thumbnail_key"] === "string" ? { thumbnail_url: `${publicUrl}?thumb=1` } : {}),
          },
        },
      },
    });
  }
  // The rows move before their files, so a start stopped in between finds a row holding the
  // public URL and completes the move.
  for (let i = 0; i < rowMoves.length; i += BATCH) await rows.bulkWrite(rowMoves.slice(i, i + BATCH), { ordered: false });
  const fileRows = db.collection(DIGITA.COLLECTIONS.FILE, DIGITA.DATABASES.CORE);
  for (let i = 0; i < fileMoves.length; i += BATCH) await fileRows.bulkWrite(fileMoves.slice(i, i + BATCH), { ordered: false });
  const published = fileMoves.length;
  if (published) log.info({ entity: entity.name, files: published }, "Files of public fields made public");
}
