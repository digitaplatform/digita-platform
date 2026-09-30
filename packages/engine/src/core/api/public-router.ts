import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DIGITA, type EntityDefinition, type FieldType } from "@digitaplatform/shared";
import { env } from "../config/env.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import { NotFoundError, type DocumentService } from "../document/document-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { LocaleResolver } from "../i18n/locale-resolver.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import { listQueryFrom } from "./list-query.js";
import { FileNotFoundInStorageError, type StoragePort } from "../storage/storage-port.js";
import { resolveStorageKey } from "../storage/file-cleanup.js";
import { isSafeInlineType, contentDisposition } from "./upload-router.js";
import { ResponseContext } from "./response-context.js";
import { successResponse, errorResponse } from "./response-model.js";
import { createLogger } from "../logging/logger.js";
import { BadRequestError } from "../view/view-engine.js";
import { parseBodyLimit } from "./http-options.js";

const log = createLogger("public-router");

/** Identity for an anonymous request: the built-in "Guest" role. An entity is
 *  reachable here ONLY if it grants Guest read/select in its own permissions. */
export const GUEST_USER: UserContext = { _id: "Guest", email: "Guest", roles: ["Guest"] };

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

/** The field types a guest may set on a public create: plain values that name no other record and
 *  no file, and carry no markup the operator's app would render. */
const GUEST_SETTABLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "Data", "Text", "SmallText", "Int", "Float", "Currency", "Percent", "Check",
  "Date", "Datetime", "Time", "Select", "Phone", "Rating", "Color",
]);

/** The fields an entity's id is made of: the `by_field` field, or every `{field}` an `expression`
 *  interpolates (naming-service.ts). A visitor may set none of them, so a visitor never picks an
 *  id. */
function namingFields(entity: EntityDefinition): Set<string> {
  const naming = entity.naming;
  if (naming?.strategy === "by_field" && naming.field) return new Set([naming.field]);
  if (naming?.strategy === "expression" && naming.expression) {
    return new Set([...naming.expression.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));
  }
  return new Set();
}

/** The first body key a guest may not set on a public create, or null. An undeclared or
 *  `_`-prefixed key never passes, nor a field the id is made of; a declared field passes when Guest
 *  may write it and its type is a plain value. */
function guestRefusedKey(
  entity: EntityDefinition,
  writable: Set<string> | null,
  body: Record<string, unknown>,
): string | null {
  const idFields = namingFields(entity);
  for (const key of Object.keys(body)) {
    const field = entity.fields.find((f) => f.fieldname === key);
    if (!field || idFields.has(key) || !GUEST_SETTABLE_TYPES.has(field.fieldtype) || !writable?.has(key)) {
      return key;
    }
  }
  return null;
}

/**
 * GENERIC, content-agnostic PUBLIC (anonymous) READ surface.
 *
 * Registered under an optionalAuth scope: an unauthenticated request is treated
 * as the Guest role; an authenticated request keeps its real identity (so an
 * editor token can preview drafts). The engine never learns what entity this
 * serves — opt-in is entirely the entity's own `{ role: "Guest", read: 1 }`
 * permission. The one write is the public create below, opened the same way by a
 * Guest row that grants `create` and `write`. A website engine
 * (env.SITE_ID set) serves only its own site's rows; see `siteScope`.
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
    registry: EntityRegistry;
  },
): void {
  const { db, documentService, permissionChecker, storage, localeResolver, registry } = deps;
  const base = `${prefix}/public/resource`;
  const user = (request: FastifyRequest): UserContext => request.user ?? GUEST_USER;
  // Anonymous visitors carry no token language → negotiate from Accept-Language;
  // an authenticated editor previewing keeps their language.
  const localeOf = (request: FastifyRequest): Promise<string> =>
    localeResolver.resolveLanguage(
      user(request).language,
      request.headers["accept-language"] as string | undefined,
    );

  // ─── SITE SCOPE ────────────────────────────────────────
  // Several domains of one tenant can each run a website engine; each serves
  // only its own site. WebSite is the site, keyed by `_id`; an entity with a
  // `site` link to WebSite is scoped by that field. No SITE_ID, no scope. The scope is the
  // engine's, not the caller's, so it holds whether or not the Guest row opens the field.
  const siteScope = (doctype: string): Record<string, string> | null => {
    if (!env.SITE_ID) return null;
    if (doctype === "WebSite") return { _id: env.SITE_ID };
    if (registry.has(doctype) && registry.getField(doctype, "site")?.target === "WebSite") {
      return { site: env.SITE_ID };
    }
    return null;
  };

  // ─── LIST (public, published-gated per row) ────────────
  app.get(`${base}/:doctype`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype } = request.params as { doctype: string };
    const query = request.query as Record<string, unknown>;
    const listQuery = listQueryFrom(query);

    // DoS guard: clamp any explicit page size into [1, MAX_PUBLIC_PAGE]. A
    // non-positive/non-finite value (0, negative, NaN) is forced to the ceiling —
    // Mongo would otherwise treat limit 0 as unbounded and dump the collection.
    if (listQuery.page_size != null) listQuery.page_size = clampPublicPageSize(listQuery.page_size);
    if (listQuery.limit != null) listQuery.limit = clampPublicPageSize(listQuery.limit);

    const u = user(request);
    const ctx = new ResponseContext();
    // Every row must be readable, not only listable: getList checks each stored row's
    // read permission (its `condition` and any workflow-state strip), which gates
    // drafts even if a caller omits a status filter, and projects only afterwards.
    // `total` and the pages count only the rows the caller may read.
    const result = await documentService.getList(doctype, listQuery, u, ctx, await localeOf(request), {
      everyRowNeedsRead: true,
      scope: siteScope(doctype) ?? undefined,
    });

    return reply.send(
      successResponse(result.data.map(stripInternal), ctx.getMessages(), {
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
    // Another site's document reads as not found, so the read never reveals it. It runs after
    // getDoc's permission check, so an entity Guest may not read answers alike for any name. The
    // stored row decides, since the answer masks `site` where the Guest row does not open it.
    const scope = siteScope(doctype);
    if (scope && (await db.count(doctype, [{ _id: name }, scope], registry.get(doctype).database)) === 0) {
      throw new NotFoundError(doctype, name);
    }
    return reply.send(successResponse(stripInternal(doc.toJSON()), ctx.getMessages()));
  });

  // ─── CREATE (public, always as Guest) ──────────────────
  // It runs as Guest whatever session the request carries, so a signed-in browser gains nothing
  // here, and the entity's own Guest row decides: `create` lets Guest in, and the fields its row
  // lets Guest write are the fields a body may set. Any other key is refused, not dropped, so an
  // entity that opens this route cannot take a field by accident. On a website engine a
  // site-scoped entity gets its site from the engine. The answer is the new id and nothing else.
  app.post(
    `${base}/:doctype`,
    {
      bodyLimit: parseBodyLimit(env.API_PUBLIC_CREATE_MAX_BODY_SIZE, "API_PUBLIC_CREATE_MAX_BODY_SIZE"),
      config: {
        rateLimit: { max: env.API_PUBLIC_CREATE_RATE_LIMIT_MAX, timeWindow: env.API_PUBLIC_CREATE_RATE_LIMIT_WINDOW },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype } = request.params as { doctype: string };
      const entity = registry.get(doctype);
      await permissionChecker.check(GUEST_USER, doctype, "create");
      const body = request.body;
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new BadRequestError("The body must be an object of field values");
      }
      const values = body as Record<string, unknown>;
      const writable = permissionChecker.getWritableFields(GUEST_USER, doctype);
      const refused = guestRefusedKey(entity, writable, values);
      if (refused !== null) {
        throw new BadRequestError(`"${refused}" is not a field a guest may set on ${doctype}`);
      }
      const data: Record<string, unknown> = { ...values };
      const scope = siteScope(doctype);
      if (scope?.["site"] !== undefined) {
        // The insert keeps only what Guest may write, so a site field Guest cannot write would
        // drop the stamp in silence; that is the entity's misconfiguration, not the visitor's.
        if (!writable?.has("site")) {
          throw new Error(`${doctype} is site-scoped, but its Guest row cannot write "site", so the public create cannot stamp it`);
        }
        data["site"] = scope["site"];
      }
      const doc = await documentService.insert(doctype, data, GUEST_USER);
      return reply.code(201).send(successResponse({ _id: doc._id }));
    },
  );

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
