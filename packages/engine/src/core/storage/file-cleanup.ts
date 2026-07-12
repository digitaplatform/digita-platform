import { basename } from "path";
import { DIGITA } from "@digitaplatform/shared";
import type { FilterEntry } from "../database/mongodb-service.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { StoragePort } from "./storage-port.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("file-cleanup");

const FILE = DIGITA.COLLECTIONS.FILE;
const CORE = DIGITA.DATABASES.CORE;

/** Field types whose value is a file_url pointing at a File doc. */
export const FILE_FIELD_TYPES = new Set(["Attach", "AttachImage", "Image"]);

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

/**
 * Delete a File doc + its stored blob, REFERENCE-COUNTED: the blob is removed
 * only when no OTHER File doc shares the same content-addressed storage_key, so
 * dedup'd uploads that share one object are safe. Blob deletion is best-effort
 * (an orphaned blob is recoverable; a wrongly-deleted shared blob is not). The
 * File doc is always removed. Idempotent — a missing File doc is a no-op.
 */
export async function deleteFileRefCounted(
  db: MongoDBService,
  storage: StoragePort,
  fileId: string,
): Promise<void> {
  const doc = (await db.findOne(FILE, fileId, CORE)) as Record<string, unknown> | null;
  if (!doc) return;
  const blobKey = resolveStorageKey(doc);
  const sharedKey = typeof doc["storage_key"] === "string" ? doc["storage_key"] : null;
  if (blobKey) {
    const refs = sharedKey
      ? await db.count(FILE, [["storage_key", "=", sharedKey]] as FilterEntry[], CORE)
      : 1;
    if (refs <= 1) {
      try {
        await storage.delete(blobKey);
      } catch (err) {
        log.warn(
          { fileId, blobKey, err },
          "Failed to delete blob during file cleanup — orphaned blob left behind",
        );
      }
    } else {
      log.info({ fileId, blobKey, refs }, "Blob kept — still referenced by other File docs");
    }
  }
  // The generated thumbnail is a SEPARATE object (thumbnail_key) that used to leak
  // on every delete. Ref-count it independently — thumbnails are content-addressed,
  // so a dedup'd thumbnail shared by another File doc survives. Counted before the
  // doc is removed, so this doc is included (refs <= 1 ⇒ we are the last owner).
  const thumbKey = typeof doc["thumbnail_key"] === "string" ? doc["thumbnail_key"] : null;
  if (thumbKey) {
    const tRefs = await db.count(FILE, [["thumbnail_key", "=", thumbKey]] as FilterEntry[], CORE);
    if (tRefs <= 1) {
      try {
        await storage.delete(thumbKey);
      } catch (err) {
        log.warn({ fileId, thumbKey, err }, "Failed to delete thumbnail blob during file cleanup");
      }
    }
  }
  await db.deleteOne(FILE, fileId, CORE);
}

/**
 * Delete a blob only when NO File doc references its key (reference count 0).
 * Used by the replace path after the doc has been repointed at the new key.
 * Best-effort.
 */
export async function deleteBlobIfUnreferenced(
  db: MongoDBService,
  storage: StoragePort,
  key: string,
  refField: "storage_key" | "thumbnail_key" = "storage_key",
): Promise<void> {
  const refs = await db.count(FILE, [[refField, "=", key]] as FilterEntry[], CORE);
  if (refs > 0) return;
  try {
    await storage.delete(key);
  } catch (err) {
    log.warn({ key, refField, err }, "Failed to delete unreferenced blob — orphan left behind");
  }
}

/**
 * Best-effort cleanup of every File referenced by a document's attach fields —
 * used by the document-delete cascade. Never throws (cleanup must not fail the
 * owning operation); each File is reference-counted via deleteFileRefCounted.
 */
export async function cleanupDocumentAttachments(
  db: MongoDBService,
  storage: StoragePort,
  fields: ReadonlyArray<{ fieldname: string; fieldtype: string }>,
  data: Record<string, unknown>,
): Promise<void> {
  for (const id of collectAttachFileIds(fields, data)) {
    try {
      await deleteFileRefCounted(db, storage, id);
    } catch (err) {
      log.warn({ fileId: id, err }, "Attachment cleanup failed for one file");
    }
  }
}
