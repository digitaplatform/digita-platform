import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DIGITA } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { DocumentService } from "../document/document-service.js";
import type { LocaleResolver } from "../i18n/locale-resolver.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import type { ListQuery } from "../database/filter-builder.js";
import { FileNotFoundInStorageError, type StoragePort } from "../storage/storage-port.js";
import { resolveStorageKey } from "../storage/file-cleanup.js";
import { isSafeInlineType, contentDisposition } from "./upload-router.js";
import { ResponseContext } from "./response-context.js";
import { successResponse, errorResponse } from "./response-model.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("public-router");

/** Identity for an anonymous request: the built-in "Guest" role. An entity is
 *  reachable here ONLY if it grants Guest read/select in its own permissions. */
const GUEST_USER: UserContext = { _id: "Guest", email: "Guest", roles: ["Guest"] };

/** Hard cap on the anonymous page size — there is no login barrier here, so an
 *  unbounded page_size would be a trivial memory-exhaustion DoS. */
const MAX_PUBLIC_PAGE = 200;

/** Clamp a caller-supplied page size into [1, MAX_PUBLIC_PAGE]. A non-positive or
 *  non-finite value (0, negative, NaN) must NOT pass through: Mongo treats a
 *  `.limit(0)` / absent limit as UNBOUNDED, so it would dump the whole collection
 *  and defeat the cap — force it to the ceiling instead. */
function clampPublicPageSize(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return MAX_PUBLIC_PAGE;
  return Math.min(n, MAX_PUBLIC_PAGE);
}

/** Operator-identity fields stripped from every public response (a public CMS
 *  must not expose the editing operator's email/login id or who last changed it). */
const PUBLIC_OMIT = ["owner", "modified_by"] as const;
function stripInternal<T extends Record<string, unknown>>(row: T): T {
  for (const k of PUBLIC_OMIT) delete row[k];
  return row;
}

/**
 * GENERIC, content-agnostic PUBLIC (anonymous) READ surface.
 *
 * Registered under an optionalAuth scope: an unauthenticated request is treated
 * as the Guest role; an authenticated request keeps its real identity (so an
 * editor token can preview drafts). The engine never learns what entity this
 * serves — opt-in is entirely the entity's own `{ role: "Guest", read: 1 }`
 * permission. Read-only: NO mutations are exposed here.
 *
 * Draft gating is defense-in-depth: a per-doc permission `condition`
 * (e.g. `eval:doc.status=='published'`) is enforced by getDoc, and LIST results
 * are additionally re-checked per row against the same read permission — so a
 * list can never surface a document the caller could not read singly.
 */
export function registerPublicRoutes(
  app: FastifyInstance,
  prefix: string,
  deps: {
    db: MongoDBService;
    documentService: DocumentService;
    permissionChecker: PermissionChecker;
    storage: StoragePort;
    localeResolver: LocaleResolver;
  },
): void {
  const { db, documentService, permissionChecker, storage, localeResolver } = deps;
  const base = `${prefix}/public/resource`;
  const user = (request: FastifyRequest): UserContext => request.user ?? GUEST_USER;
  // Anonymous visitors carry no token language → negotiate from Accept-Language;
  // an authenticated editor previewing keeps their language.
  const localeOf = (request: FastifyRequest): Promise<string> =>
    localeResolver.resolveLanguage(
      user(request).language,
      request.headers["accept-language"] as string | undefined,
    );

  // ─── LIST (public, published-gated per row) ────────────
  app.get(`${base}/:doctype`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype } = request.params as { doctype: string };
    const query = request.query as Record<string, unknown>;
    const listQuery: ListQuery = {
      fields: query["fields"] ? JSON.parse(query["fields"] as string) : undefined,
      filters: query["filters"] ? JSON.parse(query["filters"] as string) : undefined,
      or_filters: query["or_filters"] ? JSON.parse(query["or_filters"] as string) : undefined,
      order_by: query["order_by"] as string,
      limit: query["limit"] ? Number(query["limit"]) : undefined,
      offset: query["offset"] ? Number(query["offset"]) : undefined,
      page: query["page"] ? Number(query["page"]) : undefined,
      page_size: query["page_size"] ? Number(query["page_size"]) : undefined,
      search: query["search"] as string,
    };
    // DoS guard: clamp any explicit page size into [1, MAX_PUBLIC_PAGE]. A
    // non-positive/non-finite value (0, negative, NaN) is forced to the ceiling —
    // Mongo would otherwise treat limit 0 as unbounded and dump the collection.
    if (listQuery.page_size != null) listQuery.page_size = clampPublicPageSize(listQuery.page_size);
    if (listQuery.limit != null) listQuery.limit = clampPublicPageSize(listQuery.limit);

    const u = user(request);
    const ctx = new ResponseContext();
    const result = await documentService.getList(doctype, listQuery, u, ctx, await localeOf(request));

    // applyScopeFilters (used by getList) does NOT evaluate per-doc `condition`,
    // so re-check each row's read permission here — defense-in-depth that gates
    // drafts even if a caller omits a status filter. `total` reflects the query
    // (callers should pass their own published filter for exact pagination; the
    // re-check is a safety net, not the primary gate).
    const visible: Record<string, unknown>[] = [];
    for (const row of result.data) {
      if ((await permissionChecker.hasPermission(u, doctype, "read", row)).allowed) {
        visible.push(stripInternal(row));
      }
    }

    return reply.send(
      successResponse(visible, ctx.getMessages(), {
        total: result.total,
        page: result.page,
        page_size: result.page_size,
        total_pages: result.total_pages,
      }),
    );
  });

  // ─── READ ONE (public; getDoc enforces the per-doc condition) ──
  app.get(`${base}/:doctype/:name`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype, name } = request.params as { doctype: string; name: string };
    const ctx = new ResponseContext();
    const doc = await documentService.getDoc(doctype, name, user(request), ctx, await localeOf(request));
    return reply.send(successResponse(stripInternal(doc.toJSON()), ctx.getMessages()));
  });

  // ─── PUBLIC FILE (only non-private blobs; no RBAC, is_private is the sole gate) ──
  app.get(`${prefix}/public/file/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const doc = (await db.findOne(DIGITA.COLLECTIONS.FILE, id, DIGITA.DATABASES.CORE)) as
      | Record<string, unknown>
      | null;
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
    // Sole gate: serve ONLY explicitly-public files. is_private defaults to true,
    // so private (non-public) attachments can never leak through this route —
    // and a 404 (not 403) hides their existence from anonymous callers.
    if (doc["is_private"] !== false) return notFound();

    // `?thumb=1` → the generated PNG thumbnail when present, else the original.
    const q = request.query as Record<string, unknown> | undefined;
    const wantThumb =
      (q?.["thumb"] === "1" || q?.["thumb"] === "true" || q?.["thumb"] === "") &&
      typeof doc["thumbnail_key"] === "string";
    const key = wantThumb ? (doc["thumbnail_key"] as string) : resolveStorageKey(doc);
    if (!key) return notFound();

    let result;
    try {
      result = await storage.getStream(key);
    } catch (err) {
      if (err instanceof FileNotFoundInStorageError) {
        log.warn({ id, key, backend: storage.backend }, "public file doc exists but blob missing");
        return notFound();
      }
      throw err;
    }

    if (wantThumb) {
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

    // Same stored-XSS hardening as the authenticated download route: only
    // render-safe types are served inline; everything else is forced to
    // attachment + octet-stream so untrusted bytes can never execute.
    const safeInline = isSafeInlineType(storedType);
    reply.header("content-type", safeInline ? storedType! : "application/octet-stream");
    if (contentLength !== undefined) reply.header("content-length", contentLength);
    reply.header(
      "content-disposition",
      contentDisposition(safeInline ? "inline" : "attachment", (doc["file_name"] as string | undefined) ?? key),
    );
    return reply.send(result.stream);
  });

  log.info("Public read routes registered (/public/resource, /public/file)");
}
