import { DIGITA } from "@digitaplatform/shared";
import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";
import type { Document, Filter } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import { env } from "../config/env.js";
import { toIdStorage } from "../document/id-codec.js";
import { createLogger } from "../logging/logger.js";
import { FILE_FIELD_TYPES } from "./file-cleanup.js";

const log = createLogger("public-field-files");

/**
 * Move the files of an attach field declared `public: true` forward to public. A file uploaded
 * while the field was private is a private `File` with the private URL, and its row holds that
 * URL; afterwards the `File` is public with the public URL, and so is each field and Table cell
 * of that row that holds it. A file moves only when the row its `attached_to_name` names holds it
 * in a public field: the download route already lets a reader of that row read the file, while
 * any other row may hold a URL its writer copied from a file they may not read, and a field of
 * the same name elsewhere in the entity may be private. A file that names no row stays private.
 * The URLs are derived from the id, never read from the `File`, whose `file_url` its owner may
 * rewrite. The row moves first, and a row holding the public URL counts, so a start stopped in
 * between completes the move. Every start reads again the private files that name a row, one
 * lookup of that row by id per path.
 */
export async function publishFilesOfPublicFields(db: MongoDBService, entities: ReadonlyArray<EntityDefinition>): Promise<void> {
  for (const entity of entities) {
    if (!entity.is_virtual) await publishFilesOfEntity(db, entity);
  }
}

async function publishFilesOfEntity(db: MongoDBService, entity: EntityDefinition): Promise<void> {
  const isPublicFile = (f: FieldDefinition) => f.public === true && FILE_FIELD_TYPES.has(f.fieldtype);
  const paths = entity.fields.flatMap((field): { fieldname: string; table?: string }[] => {
    if (isPublicFile(field)) return [{ fieldname: field.fieldname }];
    if (field.fieldtype !== "Table") return [];
    return (field.child_fields ?? []).filter(isPublicFile).map((child) => ({ fieldname: child.fieldname, table: field.fieldname }));
  });
  if (paths.length === 0) return;

  const files = await db.findManyByFilter(
    DIGITA.COLLECTIONS.FILE,
    {
      attached_to_entity: entity.name,
      attached_to_name: { $type: "string" },
      attached_to_field: { $in: [...new Set(paths.map((p) => p.fieldname))] },
      is_private: { $ne: false },
    },
    DIGITA.DATABASES.CORE,
  );
  const rows = db.collection(entity.name, entity.database);
  let published = 0;
  for (const file of files) {
    const id = file["_id"] as string;
    const row = toIdStorage(file["attached_to_name"] as string);
    const inRow = (path: string, url: string) => ({ _id: row, [path]: url }) as unknown as Filter<Document>;
    const privateUrl = `${env.API_PREFIX}/file/${id}/download`;
    const publicUrl = `${env.API_PREFIX}/public/file/${id}`;
    let isHeld = false;
    for (const { fieldname, table } of paths.filter((p) => p.fieldname === file["attached_to_field"])) {
      const path = table ? `${table}.${fieldname}` : fieldname;
      const moved = table
        ? await rows.updateMany(
            inRow(path, privateUrl),
            { $set: { [`${table}.$[cell].${fieldname}`]: publicUrl } },
            { arrayFilters: [{ [`cell.${fieldname}`]: privateUrl }] },
          )
        : await rows.updateMany(inRow(path, privateUrl), { $set: { [path]: publicUrl } });
      isHeld ||= moved.matchedCount > 0 || (await rows.countDocuments(inRow(path, publicUrl), { limit: 1 })) > 0;
    }
    if (!isHeld) continue;
    await db.updateOne(
      DIGITA.COLLECTIONS.FILE,
      id,
      {
        is_private: false,
        file_url: publicUrl,
        ...(typeof file["thumbnail_key"] === "string" ? { thumbnail_url: `${publicUrl}?thumb=1` } : {}),
      },
      DIGITA.DATABASES.CORE,
    );
    published++;
  }
  if (published) log.info({ entity: entity.name, files: published }, "Files of public fields made public");
}
