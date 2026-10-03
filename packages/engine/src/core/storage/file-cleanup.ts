import { basename } from "path";
import { DIGITA, FILE_FIELD_TYPES as FILE_URL_FIELD_TYPES, type EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { StoragePort } from "./storage-port.js";
import { deleteImageVariants, hasImageVariants } from "./image-variants.js";
import { createLogger } from "../logging/logger.js";
import { fileAttachmentBlockers } from "../link/delete-protection.js";
import { toIdStorage, toIdString } from "../document/id-codec.js";

const log = createLogger("file-cleanup");

const FILE = DIGITA.COLLECTIONS.FILE;
const CORE = DIGITA.DATABASES.CORE;

/** The shared field types whose value is a file_url pointing at a File doc, as a set to look up. */
export const FILE_FIELD_TYPES: ReadonlySet<string> = new Set(FILE_URL_FIELD_TYPES);

/**
 * Resolve the storage key for a File doc. Docs written since the StoragePort
 * refactor carry `storage_key`; legacy docs only have `file_url:
 * "/uploads/<storedName>"` — derive the key from that so pre-existing dev files
 * stay resolvable from local storage.
 */
export function resolveStorageKey(doc: Record<string, unknown>): string | null {
  if (typeof doc["storage_key"] === "string" && doc["storage_key"]) {
    return doc["storage_key"];
  }
  const url = doc["file_url"];
  if (typeof url === "string" && url.startsWith("/uploads/")) {
    const key = basename(url);
    if (key) return key;
  }
  return null;
}

/**
 * Extract the File _id from an engine file URL — both the private download route
 * (`.../file/<id>/download`) and the anonymous public route (`.../public/file/<id>`,
 * which has NO `/download` suffix). Public attachments (branding logos, web images)
 * must be parseable too, or they are invisible to cleanup and leak forever.
 */
export function parseFileId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /\/(?:public\/file|file)\/([^/?#]+)(?:\/download)?/.exec(value);
  return m ? m[1]! : null;
}

/** File ids referenced by the attach-type fields (Attach/AttachImage/Image) of a document. */
type AttachScanField = {
  fieldname: string;
  fieldtype: string;
  child_fields?: ReadonlyArray<AttachScanField>;
};

export function collectAttachFileIds(
  fields: ReadonlyArray<AttachScanField>,
  data: Record<string, unknown>,
): string[] {
  const ids: string[] = [];
  for (const f of fields) {
    if (FILE_FIELD_TYPES.has(f.fieldtype)) {
      const id = parseFileId(data[f.fieldname]);
      if (id) ids.push(id);
      continue;
    }
    // Recurse into Table child rows — child-row Attach/AttachImage files leaked
    // on delete/replace because this collector only scanned top-level fields.
    if (f.fieldtype === "Table" && f.child_fields) {
      const attachChildFields = f.child_fields.filter((cf) => FILE_FIELD_TYPES.has(cf.fieldtype));
      if (attachChildFields.length === 0) continue;
      const rows = data[f.fieldname];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        for (const cf of attachChildFields) {
          const id = parseFileId(r[cf.fieldname]);
          if (id) ids.push(id);
        }
      }
    }
  }
  return ids;
}

/** Mark an unreferenced File in place, retaining its bytes until purge. */
export async function softDeleteFile(
  db: MongoDBService,
  fileId: string,
  user: { email: string },
  entities: readonly EntityDefinition[],
): Promise<void> {
  const id = toIdString(toIdStorage(fileId));
  await db.withTransaction(async (session) => {
    await db.touchGuard(`attachment:${id}`, session);
    const doc = await db.findOne(FILE, id, CORE, session);
    if (!doc || (await fileAttachmentBlockers(db, id, entities, session)).length > 0) return;
    const deleted = new Date();
    await db.updateOne(FILE, id, { deleted, deleted_by: user.email, modified: deleted, modified_by: user.email }, CORE, session, { deleted: null });
  });
}

/**
 * Delete a blob only when NO File doc references its key (reference count 0).
 * Used by the replace path after the doc has been repointed at the new key.
 * `fileType` is the blob's own type, which says whether width variants of it can
 * exist. Best-effort.
 */
export async function deleteBlobIfUnreferenced(
  db: MongoDBService,
  storage: StoragePort,
  key: string,
  refField: "storage_key" | "thumbnail_key" = "storage_key",
  fileType?: string,
): Promise<void> {
  try {
    await db.withTransaction(async (session) => {
      await db.touchGuard(`blob:${key}`, session);
      const refs = await db.count(FILE, [{ $or: [{ storage_key: key }, { thumbnail_key: key }, { file_url: `/uploads/${key}` }] }], CORE, session, { includeDeleted: true });
      if (refs > 0) return;
      await storage.delete(key);
      // The width variants are made of the blob and share its reference count.
      if (refField === "storage_key" && hasImageVariants(fileType)) await deleteImageVariants(storage, key);
    });
  } catch (err) {
    log.warn({ key, refField, err }, "Failed to delete unreferenced blob — orphan left behind");
  }
}

/**
 * Delete the files a document stopped naming, by its update or its delete. Only a file the
 * document owns goes: one bound to it, or the user's own loose upload. A record can name a file
 * it does not own, a colleague's or one bound to another record; that file stays. Never throws,
 * because a cleanup must not fail the operation that owns it; a failure is logged. Its File row
 * is marked deleted in place, and its bytes wait for purge.
 */
export async function cleanupDocumentAttachments(
  db: MongoDBService,
  fileIds: ReadonlyArray<string>,
  document: { entity: string; name: string },
  user: { _id: string; email: string },
  entities: readonly EntityDefinition[],
): Promise<void> {
  for (const fileId of fileIds) {
    try {
      const file = (await db.findOne(FILE, fileId, CORE)) as Record<string, unknown> | null;
      if (!file) continue;
      const isOwned = file["attached_to_name"]
        ? file["attached_to_entity"] === document.entity && file["attached_to_name"] === document.name
        : file["owner"] === user.email;
      if (isOwned) await softDeleteFile(db, fileId, user, entities);
    } catch (err) {
      log.warn({ fileId, ...document, err }, "Attachment cleanup failed for one file");
    }
  }
}
