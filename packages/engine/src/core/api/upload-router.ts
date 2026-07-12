import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DIGITA } from "@digitaplatform/shared";
import type { FieldDefinition } from "@digitaplatform/shared";
import { extname } from "path";
import { createHash } from "crypto";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import { env } from "../config/env.js";
import { successResponse, errorResponse } from "./response-model.js";
import { createLogger } from "../logging/logger.js";
import { FileNotFoundInStorageError, type StoragePort } from "../storage/storage-port.js";
import {
  resolveStorageKey,
  deleteFileRefCounted,
  deleteBlobIfUnreferenced,
} from "../storage/file-cleanup.js";
import { isValidStoragePath, STORAGE_PATH_RULE } from "../storage/storage-path.js";
import { isThumbnailable, makeThumbnail } from "../storage/thumbnail.js";

const log = createLogger("upload-router");

/** Routes run inside the authenticated scope, so this only guards type-level
 *  optionality of request.user (mirrors import-export-router). */
const GUEST_USER: UserContext = { _id: "Guest", email: "Guest", roles: ["Guest"] };

/** The platform entity whose permission model governs the file routes. */
const FILE_ENTITY = "File";

/**
 * Match a MIME type against the UPLOAD_ALLOWED_TYPES patterns.
 * Supports exact matches ("application/pdf") and trailing-wildcard
 * patterns ("image/*", "application/vnd.openxmlformats-officedocument.*").
 * An empty allow-list means "allow everything".
 */
export function isMimeTypeAllowed(mimetype: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  const mime = normalizeMime(mimetype);
  return allowed.some((pattern) => {
    const p = pattern.trim().toLowerCase();
    if (!p) return false;
    if (p === "*" || p === "*/*") return true;
    if (p.endsWith("*")) return mime.startsWith(p.slice(0, -1));
    return mime === p;
  });
}

/** Lowercase + strip any `; charset=` parameters for comparisons. */
function normalizeMime(mimetype: string): string {
  return (mimetype.split(";")[0] ?? "").trim().toLowerCase();
}

/**
 * MIME types that browsers EXECUTE rather than display. They are refused at
 * upload time regardless of the configurable allow-list (`image/*` would
 * otherwise admit SVG): the download route serves stored bytes back with the
 * uploader-controlled Content-Type, and an inline `text/html` / scripted
 * `image/svg+xml` payload would run in the viewer's origin (stored XSS →
 * token theft). nosniff does NOT protect against explicitly-labeled types.
 */
const FORBIDDEN_ACTIVE_CONTENT = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
]);

export function isForbiddenActiveContent(mimetype: string): boolean {
  return FORBIDDEN_ACTIVE_CONTENT.has(normalizeMime(mimetype));
}

/**
 * Only types that are harmless to RENDER may be served inline with their
 * stored Content-Type. Everything else is forced to `attachment` +
 * `application/octet-stream` so neither a browser tab nor an admin-side
 * `createObjectURL(blob)` (blob.type inherits the response header) can ever
 * interpret untrusted bytes as active content.
 */
export function isSafeInlineType(mimetype: string | undefined): boolean {
  if (!mimetype) return false;
  const mime = normalizeMime(mimetype);
  if (mime === "image/svg+xml") return false; // scriptable
  if (mime.startsWith("image/")) return true;
  return mime === "application/pdf" || mime === "text/plain";
}

/** RFC 6266 content-disposition with both a safe ASCII filename and a UTF-8 filename*. */
export function contentDisposition(disposition: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Sanitize the uploaded file's extension for use inside a storage key.
 * Anything that isn't a plain `.alnum` suffix is dropped — the original
 * name survives untouched in `file_name`, the key only needs a hint for
 * tooling (and must never carry path-relevant characters).
 */
function safeExt(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return /^\.[a-z0-9]+$/.test(ext) ? ext : "";
}

/** Read a text field from a parsed multipart `fields` bag (or undefined). */
function multipartField(fields: Record<string, unknown>, name: string): string | undefined {
  const raw = fields[name];
  const entry = Array.isArray(raw) ? raw[0] : raw;
  const value = (entry as { value?: unknown } | undefined)?.value;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Read the uploaded part fully into a buffer (needed for content-hash dedup),
 * returning null when it exceeds limits.fileSize. @fastify/multipart's
 * toBuffer() THROWS `FST_REQ_FILE_TOO_LARGE` on overflow (unlike the streamed
 * path, which silently sets file.truncated) — both are mapped to null here so
 * the caller can answer a clean 413.
 */
async function readUploadBuffer(data: {
  toBuffer: () => Promise<Buffer>;
  file: { truncated: boolean };
}): Promise<Buffer | null> {
  try {
    const buf = await data.toBuffer();
    return data.file.truncated ? null : buf;
  } catch (err) {
    if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") return null;
    throw err;
  }
}

type StoragePathResolution =
  | { ok: true; storagePath: string }
  | { ok: false; code: string; detail: string };

/**
 * Resolve the storage_path for an attachment target entity. This is the
 * single enforcement point of the no-fallback rule at request time (the
 * boot lint in EntityRegistry catches declaration gaps earlier):
 *
 *   - unknown entity                 → 400 UNKNOWN_ENTITY
 *   - entity without storage_path    → 400 ENTITY_WITHOUT_STORAGE_PATH
 *   - malformed storage_path         → 400 INVALID_STORAGE_PATH (defense in
 *     depth — boot lint should have refused this definition already)
 */
function resolveEntityStoragePath(
  registry: EntityRegistry,
  entityName: string,
): StoragePathResolution {
  if (!registry.has(entityName)) {
    return {
      ok: false,
      code: "UNKNOWN_ENTITY",
      detail: `Unknown entity "${entityName}" — attached_to_entity must name a registered entity`,
    };
  }
  const entity = registry.get(entityName);
  // Defense in depth for DB-seeded definitions that predate storage_path:
  // loadFromDb carries the file value forward, but fall back to the
  // file-loaded snapshot here too so an upload never 400s while the file
  // tree plainly declares the path.
  const storagePath = entity.storage_path ?? registry.getFileEntity(entityName)?.storage_path;
  if (!storagePath) {
    return {
      ok: false,
      code: "ENTITY_WITHOUT_STORAGE_PATH",
      detail:
        `Entity "${entityName}" does not declare a storage_path — uploads against it ` +
        `are not allowed (no default folder, no bucket-root fallback). ` +
        `Declare "storage_path" on the entity definition to enable attachments.`,
    };
  }
  if (!isValidStoragePath(storagePath)) {
    return {
      ok: false,
      code: "INVALID_STORAGE_PATH",
      detail: `Entity "${entityName}" declares an invalid storage_path "${storagePath}" — expected ${STORAGE_PATH_RULE}`,
    };
  }
  return { ok: true, storagePath };
}

/** Find a field by name across an entity's top-level + nested (Table child) fields. */
function findField(
  fields: readonly FieldDefinition[] | undefined,
  name: string,
): FieldDefinition | undefined {
  for (const f of fields ?? []) {
    if (f.fieldname === name) return f;
    const inner = findField(f.child_fields, name);
    if (inner) return inner;
  }
  return undefined;
}

/**
 * Whether attachments uploaded against `<entity>.<field>` are PUBLIC (anonymous
 * read). True only when the field explicitly declares `"public": true` — the
 * generic opt-in. Default false → files stay private. Falls back to the
 * file-loaded snapshot for DB-only definitions (mirrors storage_path resolution).
 */
function isPublicAttachmentField(
  registry: EntityRegistry,
  entityName: string,
  fieldName: string | undefined,
): boolean {
  if (!fieldName || !registry.has(entityName)) return false;
  const field =
    findField(registry.get(entityName).fields, fieldName) ??
    findField(registry.getFileEntity(entityName)?.fields, fieldName);
  return field?.public === true;
}

/**
 * Generate + store a content-addressed PNG thumbnail for a raster upload, under
 * `<storage_path>/thumb-<hash>.png` (dedup'd like the original). A flat `thumb-`
 * prefix (NOT a `/thumb/` subdir) keeps the key within the local backend's
 * 3-segment cap even for a two-segment storage_path (e.g. `web/branding`), which
 * previously produced a 4-segment key and 500'd every raster upload there.
 * Returns the thumbnail storage key, or null for non-images / decode failures
 * (the original is the fallback). Best-effort: never throws.
 */
async function thumbnailForUpload(
  storage: StoragePort,
  storagePath: string,
  contentHash: string,
  buffer: Buffer,
  mimetype: string,
): Promise<string | null> {
  if (!isThumbnailable(mimetype)) return null;
  const thumb = await makeThumbnail(buffer);
  if (!thumb) return null;
  const key = `${storagePath}/thumb-${contentHash}.png`;
  if (!(await storage.exists(key))) {
    await storage.put(key, thumb, "image/png");
  }
  return key;
}

/** Whether the request asked for the thumbnail variant (`?thumb=1`). */
function wantsThumbnail(request: FastifyRequest): boolean {
  const t = (request.query as Record<string, unknown> | undefined)?.["thumb"];
  return t === "1" || t === "true" || t === "";
}

function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  detail: string,
) {
  return reply
    .code(status)
    .send(
      errorResponse(status, code, detail, [{ text: detail, type: "error", show: true }], request.traceId ?? ""),
    );
}

function badRequest(reply: FastifyReply, request: FastifyRequest, code: string, detail: string) {
  return sendError(reply, request, 400, code, detail);
}

export function registerUploadRoutes(
  app: FastifyInstance,
  prefix: string,
  db: MongoDBService,
  storage: StoragePort,
  registry: EntityRegistry,
  permissionChecker: PermissionChecker,
): void {
  // Upload file. The attachment context is REQUIRED — every upload must be
  // attributable to an entity that declares a storage_path. Context fields
  // (attached_to_entity required; attached_to_name / attached_to_field when
  // known) arrive as multipart form fields BEFORE the file part, or as
  // query-string parameters.
  app.post(`${prefix}/upload`, async (request: FastifyRequest, reply: FastifyReply) => {
    // RBAC: uploads create File docs — enforce the File entity's "create"
    // permission (throws → 403 via the global error handler) before touching
    // the multipart stream.
    await permissionChecker.check(request.user ?? GUEST_USER, FILE_ENTITY, "create");

    const data = await request.file();
    if (!data) {
      return badRequest(reply, request, "NO_FILE", "No file uploaded");
    }

    const query = request.query as Record<string, string | undefined>;
    const fields = data.fields as unknown as Record<string, unknown>;
    const attachedToEntity = multipartField(fields, "attached_to_entity") ?? query["attached_to_entity"];
    const attachedToName = multipartField(fields, "attached_to_name") ?? query["attached_to_name"];
    const attachedToField = multipartField(fields, "attached_to_field") ?? query["attached_to_field"];

    if (!attachedToEntity) {
      return badRequest(
        reply,
        request,
        "ATTACHMENT_CONTEXT_REQUIRED",
        "Upload requires an attachment context: send attached_to_entity " +
          "(multipart field before the file part, or query parameter). " +
          "Context-less uploads are forbidden — every file must belong to an " +
          "entity that declares a storage_path.",
      );
    }

    const resolution = resolveEntityStoragePath(registry, attachedToEntity);
    if (!resolution.ok) {
      return badRequest(reply, request, resolution.code, resolution.detail);
    }

    if (isForbiddenActiveContent(data.mimetype)) {
      return badRequest(
        reply,
        request,
        "FILE_TYPE_NOT_ALLOWED",
        `File type "${data.mimetype}" is browser-executable content and cannot be uploaded`,
      );
    }
    if (!isMimeTypeAllowed(data.mimetype, env.UPLOAD_ALLOWED_TYPES)) {
      const detail = `File type "${data.mimetype}" is not allowed. Allowed types: ${env.UPLOAD_ALLOWED_TYPES.join(", ")}`;
      return badRequest(reply, request, "FILE_TYPE_NOT_ALLOWED", detail);
    }

    // Buffer the bytes so we can content-hash them (dedup) — bounded by
    // limits.fileSize (UPLOAD_MAX_SIZE). An overflow is refused BEFORE anything
    // is written, so no corrupt blob is ever stored.
    const buffer = await readUploadBuffer(data);
    if (buffer === null) {
      return sendError(
        reply,
        request,
        413,
        "FILE_TOO_LARGE",
        `File exceeds the maximum upload size (${env.UPLOAD_MAX_SIZE})`,
      );
    }

    // Content-addressed key: identical content → identical key → ONE stored
    // object. The blob is written AFTER the File doc is inserted (below), NOT
    // here — see H6: skipping the put for an already-present key opened a race
    // where a concurrent ref-counted delete removed the blob during the
    // (sequence + thumbnail) window, before this upload's File doc existed to
    // be counted — leaving the new doc pointing at a deleted blob.
    const contentHash = createHash("sha256").update(buffer).digest("hex");
    const storedName = `${resolution.storagePath}/${contentHash}${safeExt(data.filename)}`;

    const user = request.user?.email ?? "system";

    // Public opt-in: a field declaring `"public": true` (e.g. branding logo /
    // login background) stores the blob non-private and serves it through the
    // generic anonymous file route, so it renders pre-login. Everything else
    // stays private (the secure default).
    const isPublic = isPublicAttachmentField(registry, attachedToEntity, attachedToField);

    // A public attachment is served ANONYMOUSLY, so creating one must be authorized:
    // only a caller who can WRITE the target entity may publish content under a
    // `public: true` field. Without this, any authenticated user could upload to a
    // public field (e.g. a branding logo) and have it served to everyone. Private
    // attachments keep the generic authenticated-upload behavior. Throws → 403.
    if (isPublic) {
      await permissionChecker.check(request.user ?? GUEST_USER, attachedToEntity, "write");
    }

    // Allocate the file's _id from the naming sequence.
    const seq = await db.getNextSequence(DIGITA.COLLECTIONS.FILE, "naming_seq", DIGITA.DATABASES.CORE);
    const id = `FILE-${String(seq).padStart(6, "0")}`;

    // Served through the engine's own route — works behind any host/ingress and
    // independently of the storage backend. Public fields use the anonymous route;
    // private ones the authenticated download route.
    const fileUrl = isPublic ? `${prefix}/public/file/${id}` : `${prefix}/file/${id}/download`;

    // Best-effort thumbnail for raster images (content-addressed, dedup'd). The
    // same route serves it via `?thumb=1`; on any failure the original is used.
    const thumbnailKey = (await thumbnailForUpload(storage, resolution.storagePath, contentHash, buffer, data.mimetype)) ?? undefined;

    const fileDoc: Record<string, unknown> = {
      _id: id,
      doctype: "file",
      docstatus: 0,
      file_name: data.filename,
      file_url: fileUrl,
      file_size: buffer.length,
      file_type: data.mimetype,
      storage_key: storedName,
      storage_backend: storage.backend,
      content_hash: contentHash,
      attached_to_entity: attachedToEntity,
      is_private: !isPublic,
      owner: user,
      modified_by: user,
      creation: new Date(),
      modified: new Date(),
    };
    if (thumbnailKey) {
      fileDoc["thumbnail_key"] = thumbnailKey;
      fileDoc["thumbnail_url"] = `${fileUrl}?thumb=1`;
    }
    if (attachedToName) fileDoc["attached_to_name"] = attachedToName;
    if (attachedToField) fileDoc["attached_to_field"] = attachedToField;

    // H6: insert the File doc FIRST so a concurrent ref-counted delete counts
    // this reference, THEN write the blob unconditionally (idempotent — the key
    // is content-addressed). If a delete removed the blob in the small window
    // before the insert committed, this put repairs it. On a storage failure,
    // roll back the just-inserted doc so it never points at a missing blob.
    await db.insertOne(DIGITA.COLLECTIONS.FILE, fileDoc, DIGITA.DATABASES.CORE);
    try {
      await storage.put(storedName, buffer, data.mimetype);
    } catch (err) {
      await db.deleteOne(DIGITA.COLLECTIONS.FILE, id, DIGITA.DATABASES.CORE).catch(() => {});
      throw err;
    }

    log.info(
      {
        file: data.filename,
        size: buffer.length,
        user,
        backend: storage.backend,
        key: storedName,
        entity: attachedToEntity,
        doc: attachedToName,
        field: attachedToField,
      },
      "File uploaded",
    );

    return reply
      .code(201)
      .send(
        successResponse(fileDoc, [
          { text: "file_uploaded", type: "success", show: true },
        ]),
      );
  });

  // Replace file content (multipart) — full "U" of the file CRUD. Validates
  // the allowed types and the SAME entity/storage_path context resolved from
  // the stored doc, writes the new bytes under a NEW uuid key inside the same
  // storage_path, updates the doc, then deletes the old object (write new →
  // update doc → delete old; a failing delete only warns — the doc already
  // points at the new key).
  app.put(`${prefix}/file/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const doc = await db.findOne(DIGITA.COLLECTIONS.FILE, id, DIGITA.DATABASES.CORE);
    if (!doc) {
      return reply
        .code(404)
        .send(
          errorResponse(
            404,
            "FILE_NOT_FOUND",
            `File ${id} not found`,
            [{ text: "file_not_found", type: "error", show: true }],
            request.traceId ?? "",
          ),
        );
    }

    // RBAC: replacing content is a write on the File doc — enforces the
    // entity's declared permissions incl. if_owner (System User may only
    // replace their own files). Throws → 403.
    await permissionChecker.check(
      request.user ?? GUEST_USER,
      FILE_ENTITY,
      "write",
      doc as Record<string, unknown>,
    );

    const attachedToEntity = (doc as Record<string, unknown>)["attached_to_entity"];
    if (typeof attachedToEntity !== "string" || !attachedToEntity) {
      return badRequest(
        reply,
        request,
        "ATTACHMENT_CONTEXT_REQUIRED",
        `File ${id} carries no attached_to_entity — legacy context-less files ` +
          "cannot be replaced in place. Delete it and upload a new file with " +
          "an attachment context instead.",
      );
    }

    const resolution = resolveEntityStoragePath(registry, attachedToEntity);
    if (!resolution.ok) {
      return badRequest(reply, request, resolution.code, resolution.detail);
    }

    // A public attachment is served ANONYMOUSLY; replacing its bytes publishes to
    // everyone, so it must be re-authorized against the TARGET entity even if the
    // caller still passes the File-doc write check (e.g. an owner whose
    // target-entity write grant was since revoked). Mirrors the POST /upload
    // public-field check.
    const storedField = (doc as Record<string, unknown>)["attached_to_field"];
    const replaceIsPublic =
      (doc as Record<string, unknown>)["is_private"] === false ||
      isPublicAttachmentField(
        registry,
        attachedToEntity,
        typeof storedField === "string" ? storedField : undefined,
      );
    if (replaceIsPublic) {
      await permissionChecker.check(request.user ?? GUEST_USER, attachedToEntity, "write");
    }

    const data = await request.file();
    if (!data) {
      return badRequest(reply, request, "NO_FILE", "No file uploaded");
    }

    if (isForbiddenActiveContent(data.mimetype)) {
      return badRequest(
        reply,
        request,
        "FILE_TYPE_NOT_ALLOWED",
        `File type "${data.mimetype}" is browser-executable content and cannot be uploaded`,
      );
    }
    if (!isMimeTypeAllowed(data.mimetype, env.UPLOAD_ALLOWED_TYPES)) {
      const detail = `File type "${data.mimetype}" is not allowed. Allowed types: ${env.UPLOAD_ALLOWED_TYPES.join(", ")}`;
      return badRequest(reply, request, "FILE_TYPE_NOT_ALLOWED", detail);
    }

    // Buffer + hash (dedup), refusing an overflow BEFORE touching the stored
    // object — the existing intact blob + doc stay untouched on overflow.
    const buffer = await readUploadBuffer(data);
    if (buffer === null) {
      return sendError(
        reply,
        request,
        413,
        "FILE_TOO_LARGE",
        `File exceeds the maximum upload size (${env.UPLOAD_MAX_SIZE})`,
      );
    }

    const contentHash = createHash("sha256").update(buffer).digest("hex");
    const oldKey = resolveStorageKey(doc as Record<string, unknown>);
    const oldThumbKey =
      typeof (doc as Record<string, unknown>)["thumbnail_key"] === "string"
        ? ((doc as Record<string, unknown>)["thumbnail_key"] as string)
        : null;
    const newKey = `${resolution.storagePath}/${contentHash}${safeExt(data.filename)}`;

    const user = request.user?.email ?? "system";
    // Regenerate the thumbnail for the new content (cleared when the replacement
    // isn't a raster image). file_url is unchanged, so the ?thumb=1 link is stable.
    const newThumbKey = (await thumbnailForUpload(storage, resolution.storagePath, contentHash, buffer, data.mimetype)) ?? null;
    const changes = {
      file_name: data.filename,
      file_size: buffer.length,
      file_type: data.mimetype,
      storage_key: newKey,
      storage_backend: storage.backend,
      content_hash: contentHash,
      thumbnail_key: newThumbKey,
      thumbnail_url: newThumbKey ? `${(doc as Record<string, unknown>)["file_url"]}?thumb=1` : null,
      modified: new Date(),
      modified_by: user,
    };

    // 2. H6 (replace path): repoint the doc at the new key FIRST so a concurrent
    //    ref-counted delete counts this reference, THEN write the blob
    //    unconditionally (idempotent — content-addressed). If a delete removed a
    //    shared blob in the window before this update committed, the put repairs
    //    it. On a storage failure, restore the pre-replace pointer fields (the old
    //    blob is still present — it is deleted in step 3) so the doc never points
    //    at a missing blob.
    await db.updateOne(DIGITA.COLLECTIONS.FILE, id, changes, DIGITA.DATABASES.CORE);
    try {
      await storage.put(newKey, buffer, data.mimetype);
    } catch (err) {
      const d = doc as Record<string, unknown>;
      await db
        .updateOne(
          DIGITA.COLLECTIONS.FILE,
          id,
          {
            file_name: d["file_name"],
            file_size: d["file_size"],
            file_type: d["file_type"],
            storage_key: d["storage_key"],
            storage_backend: d["storage_backend"],
            content_hash: d["content_hash"],
            thumbnail_key: d["thumbnail_key"] ?? null,
            thumbnail_url: d["thumbnail_url"] ?? null,
          },
          DIGITA.DATABASES.CORE,
        )
        .catch(() => {});
      throw err;
    }

    // 3. Reference-counted delete of the old object — removed only when no other
    //    File doc still points at it (a dedup'd shared blob is kept).
    if (oldKey && oldKey !== newKey) {
      await deleteBlobIfUnreferenced(db, storage, oldKey);
    }
    // The doc now points at the new thumbnail, so the OLD thumbnail blob (which
    // used to leak on every replace) is deleted when no other File doc references it.
    if (oldThumbKey && oldThumbKey !== newThumbKey) {
      await deleteBlobIfUnreferenced(db, storage, oldThumbKey, "thumbnail_key");
    }

    log.info(
      { id, oldKey, newKey, file: data.filename, size: data.file.bytesRead, user, backend: storage.backend },
      "File content replaced",
    );

    return reply.send(
      successResponse({ ...doc, ...changes }, [
        { text: "file_replaced", type: "success", show: true },
      ]),
    );
  });

  // Download file — streams the stored bytes from the storage backend.
  app.get(`${prefix}/file/:id/download`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const doc = await db.findOne(DIGITA.COLLECTIONS.FILE, id, DIGITA.DATABASES.CORE);
    const notFound = () =>
      reply
        .code(404)
        .send(
          errorResponse(
            404,
            "FILE_NOT_FOUND",
            `File ${id} not found`,
            [{ text: "file_not_found", type: "error", show: true }],
            request.traceId ?? "",
          ),
        );

    if (!doc) return notFound();

    // RBAC: same read rule the generic resource API enforces for File docs —
    // System User reads only own files (if_owner), Administrator everything.
    // Uploaded docs are is_private by default; without this check any
    // authenticated role could enumerate the sequential FILE-… ids and pull
    // every private attachment in the system. Throws → 403.
    // Allow if the File read grant passes (owner / Administrator), ELSE fall
    // back to a read check on the DOCUMENT the file is attached to — otherwise a
    // shared document's private attachments 403 for everyone but the uploader.
    // Deny-by-default on the edge: only grant when the parent doc actually loads
    // AND the caller may read THAT doc (with its own if_owner/condition/scope).
    const fileDoc = doc as Record<string, unknown>;
    const actor = request.user ?? GUEST_USER;
    const fileRead = await permissionChecker.hasPermission(actor, FILE_ENTITY, "read", fileDoc);
    if (!fileRead.allowed) {
      let parentGrants = false;
      const parentEntity = fileDoc["attached_to_entity"];
      const parentName = fileDoc["attached_to_name"];
      if (
        typeof parentEntity === "string" &&
        parentEntity &&
        typeof parentName === "string" &&
        parentName &&
        registry.has(parentEntity)
      ) {
        const parentDoc = await db.findOne(
          parentEntity,
          parentName,
          registry.get(parentEntity).database,
        );
        if (parentDoc) {
          const parentRead = await permissionChecker.hasPermission(
            actor,
            parentEntity,
            "read",
            parentDoc as Record<string, unknown>,
          );
          parentGrants = parentRead.allowed;
        }
      }
      if (!parentGrants) {
        // Preserve the original 403 (throws) via the global error handler.
        await permissionChecker.check(actor, FILE_ENTITY, "read", fileDoc);
      }
    }

    // `?thumb=1` serves the generated PNG thumbnail when one exists; otherwise the
    // original blob (back-compat for files uploaded before thumbnailing).
    const wantThumb = wantsThumbnail(request) && typeof doc["thumbnail_key"] === "string";
    const key = wantThumb
      ? (doc["thumbnail_key"] as string)
      : resolveStorageKey(doc as Record<string, unknown>);
    if (!key) return notFound();

    let result;
    try {
      result = await storage.getStream(key);
    } catch (err) {
      if (err instanceof FileNotFoundInStorageError) {
        log.warn({ id, key, backend: storage.backend }, "File doc exists but blob is missing in storage");
        return notFound();
      }
      throw err;
    }

    if (wantThumb) {
      // Generated thumbnails are always render-safe PNGs → inline.
      reply.header("content-type", "image/png");
      if (result.contentLength !== undefined) reply.header("content-length", result.contentLength);
      reply.header("content-disposition", contentDisposition("inline", "thumbnail.png"));
      return reply.send(result.stream);
    }

    const storedType = result.contentType ?? (doc["file_type"] as string | undefined);
    const contentLength =
      result.contentLength ??
      (typeof doc["file_size"] === "number" && doc["file_size"] > 0
        ? (doc["file_size"] as number)
        : undefined);

    // Stored-XSS hardening: only render-safe types are served inline with
    // their stored Content-Type. Everything else (incl. legacy docs uploaded
    // before the active-content deny-list existed) is neutralized to
    // attachment + octet-stream so neither the browser nor the admin's
    // blob-URL viewer can execute it in a trusted origin.
    const safeInline = isSafeInlineType(storedType);
    reply.header("content-type", safeInline ? storedType! : "application/octet-stream");
    if (contentLength !== undefined) reply.header("content-length", contentLength);
    reply.header(
      "content-disposition",
      contentDisposition(
        safeInline ? "inline" : "attachment",
        (doc["file_name"] as string | undefined) ?? key,
      ),
    );
    return reply.send(result.stream);
  });

  // Delete file — removes the stored blob (tolerating already-missing), then the doc.
  app.delete(`${prefix}/file/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const doc = await db.findOne(DIGITA.COLLECTIONS.FILE, id, DIGITA.DATABASES.CORE);
    if (!doc) {
      return reply
        .code(404)
        .send(
          errorResponse(
            404,
            "FILE_NOT_FOUND",
            `File ${id} not found`,
            [{ text: "file_not_found", type: "error", show: true }],
            request.traceId ?? "",
          ),
        );
    }

    // RBAC: enforce the File entity's delete permission incl. if_owner.
    await permissionChecker.check(
      request.user ?? GUEST_USER,
      FILE_ENTITY,
      "delete",
      doc as Record<string, unknown>,
    );

    // Reference-counted: removes the blob only when this is the LAST File doc
    // pointing at it (a dedup'd shared object survives), then deletes the doc.
    await deleteFileRefCounted(db, storage, id);
    log.info({ id, backend: storage.backend }, "File deleted");
    return reply.send(
      successResponse(null, [{ text: "file_deleted", type: "success", show: true }]),
    );
  });
}
