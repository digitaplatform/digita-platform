import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DIGITA, type EntityDefinition, type FieldType } from "@digitaplatform/shared";
import { env } from "../config/env.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import { NotFoundError, type DocumentService } from "../document/document-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { LocaleResolver } from "../i18n/locale-resolver.js";
import { PermissionDeniedError, type PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import { listQueryFrom } from "./list-query.js";
import { FileNotFoundInStorageError, type StoragePort } from "../storage/storage-port.js";
import { resolveStorageKey } from "../storage/file-cleanup.js";
import { IMAGE_VARIANT_WIDTHS, ensureImageVariant, hasImageVariants, parseVariantWidth, variantFormatFor } from "../storage/image-variants.js";
import { isSafeInlineType, contentDisposition } from "./upload-router.js";
import { ResponseContext } from "./response-context.js";
import { successResponse, errorResponse } from "./response-model.js";
import { createLogger } from "../logging/logger.js";
import { BadRequestError } from "../view/view-engine.js";
import { EngineError } from "../errors/engine-error.js";
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

  // A menu may name a draft base page whose translated sibling is public. Read only its
  // grouping metadata internally; the existing document gate decides which page ID may replace
  // the Link. An unresolved Link stays as stored, and the renderer omits its unavailable page.
  const localizeMenuPages = async (doctype: string, rows: Record<string, unknown>[], u: UserContext, locale: string) => {
    const entity = registry.get(doctype);
    if (entity.tree?.menu !== "website") return;
    const target = registry.getField(doctype, "page")?.target;
    if (!target || !registry.has(target)) return;
    for (const row of rows) {
      // The public read mask has already run: a masked Link must never be reconstructed.
      if (typeof row["page"] !== "string" || !row["page"]) continue;
      const stored = await db.findOne(doctype, String(row["_id"]), entity.database);
      if (typeof stored?.["site"] !== "string") continue;
      const basePage = await db.findOne(target, row["page"], registry.get(target).database);
      if (!basePage || basePage["site"] !== stored["site"]) continue;
      const match = basePage["locale"] === locale
        ? { _id: basePage["_id"] }
        : typeof basePage["translation_group"] === "string" && basePage["translation_group"]
          ? { translation_group: basePage["translation_group"] }
          : null;
      if (!match) continue;
      try {
        const pages = await documentService.getList(target, { fields: ["_id"], limit: 1, order_by: "_id asc" }, u, undefined, locale, {
          everyRowNeedsRead: true,
          scope: { ...match, site: stored["site"], locale, status: "published" },
        });
        const resolved = pages.data[0]?.["_id"];
        if (typeof resolved === "string" && resolved !== row["page"]) {
          row["page"] = resolved;
          const titles = row["_link_titles"];
          if (titles && typeof titles === "object") delete (titles as Record<string, unknown>)["page"];
        }
      } catch (error) {
        if (!(error instanceof PermissionDeniedError)) throw error;
      }
    }
  };

  // ─── LIST (public, published-gated per row) ────────────
  app.get(`${base}/:doctype`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype } = request.params as { doctype: string };
    const query = request.query as Record<string, unknown>;
    // A public client's page size is clamped below, never refused, so it does not pass the
    // authenticated list's whole-number check.
    const { limit, page_size, ...strict } = query;
    const listQuery = listQueryFrom(strict);

    // DoS guard: clamp any explicit page size into [1, MAX_PUBLIC_PAGE]. A
    // non-positive/non-finite value (0, negative, NaN) is forced to the ceiling —
    // Mongo would otherwise treat limit 0 as unbounded and dump the collection.
    if (page_size) listQuery.page_size = clampPublicPageSize(Number(page_size));
    if (limit) listQuery.limit = clampPublicPageSize(Number(limit));

    const u = user(request);
    const ctx = new ResponseContext();
    // Every row must be readable, not only listable: getList checks each stored row's
    // read permission (its `condition` and any workflow-state strip), which gates
    // drafts even if a caller omits a status filter, and projects only afterwards.
    // `total` and the pages count only the rows the caller may read.
    const locale = await localeOf(request);
    const result = await documentService.getList(doctype, listQuery, u, ctx, locale, {
      everyRowNeedsRead: true,
      scope: siteScope(doctype) ?? undefined,
    });
    await localizeMenuPages(doctype, result.data, u, locale);

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
    const u = user(request);
    const locale = await localeOf(request);
    const doc = await documentService.getDoc(doctype, name, u, ctx, locale);
    // Another site's document reads as not found, so the read never reveals it. It runs after
    // getDoc's permission check, so an entity Guest may not read answers alike for any name. The
    // stored row decides, since the answer masks `site` where the Guest row does not open it.
    const scope = siteScope(doctype);
    if (scope && (await db.count(doctype, [{ _id: name }, scope], registry.get(doctype).database)) === 0) {
      throw new NotFoundError(doctype, name);
    }
    const row = doc.toJSON();
    await localizeMenuPages(doctype, [row], u, locale);
    return reply.send(successResponse(stripInternal(row), ctx.getMessages()));
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
        throw new BadRequestError("public_body_not_object");
      }
      const values = body as Record<string, unknown>;
      const writable = permissionChecker.getWritableFields(GUEST_USER, doctype);
      const refused = guestRefusedKey(entity, writable, values);
      if (refused !== null) {
        throw new BadRequestError("public_field_not_settable", { field: refused, doctype });
      }
      const data: Record<string, unknown> = { ...values };
      const scope = siteScope(doctype);
      if (scope?.["site"] !== undefined) {
        // The insert keeps only what Guest may write, so a site field Guest cannot write would
        // drop the stamp in silence; that is the entity's misconfiguration, not the visitor's.
        if (!writable?.has("site")) {
          throw new EngineError("public_site_not_stampable", { doctype }, 500, "PUBLIC_SITE_NOT_STAMPABLE");
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

    // A width outside the set is refused before anything is read.
    const rawWidth = (request.query as Record<string, unknown> | undefined)?.["w"];
    const width = parseVariantWidth(rawWidth);
    if (rawWidth !== undefined && width === null) {
      return reply
        .code(400)
        .send(
          errorResponse(
            400,
            "BAD_REQUEST",
            `w must be one of ${IMAGE_VARIANT_WIDTHS.join(", ")}`,
            [{ text: "file_width_not_offered", type: "error", show: true }],
            request.traceId ?? "",
          ),
        );
    }
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

    // A width of the set is answered with a variant of a raster image; any other file has no width
    // to scale to and is answered as it is.
    const variantFormat =
      width !== null && !wantThumb && hasImageVariants(doc["file_type"] as string | undefined)
        ? variantFormatFor(request.headers.accept)
        : null;

    let result;
    let variant: string | null = null;
    try {
      if (width !== null && variantFormat) variant = await ensureImageVariant(storage, key, width, variantFormat);
      result = await storage.getStream(variant ?? key);
    } catch (err) {
      if (err instanceof FileNotFoundInStorageError) {
        log.warn({ id, key, backend: storage.backend }, "public file doc exists but blob missing");
        return notFound();
      }
      throw err;
    }

    if (variant) {
      reply.header("content-type", `image/${variantFormat}`);
      reply.header("vary", "Accept");
      if (result.contentLength !== undefined) reply.header("content-length", result.contentLength);
      reply.header("content-disposition", contentDisposition("inline", `w${width}.${variantFormat}`));
      return reply.send(result.stream);
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
