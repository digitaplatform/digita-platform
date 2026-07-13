import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { EntityDefinition } from "@digitaplatform/shared";
import { DIGITA } from "@digitaplatform/shared";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { UnknownDoctypeError } from "../entity/entity-registry.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import { SchemaMigrator } from "../database/schema-migrator.js";
import { IndexManager } from "../database/index-manager.js";
import { requireAdministrator } from "../auth/require-admin.js";
import { callerIsInternal } from "../auth/audience.js";
import { successResponse, errorResponse } from "./response-model.js";
import { ResponseContext } from "./response-context.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("meta-router");

/**
 * Engine-internal / config doctypes that should NOT appear as navigable app
 * entities (the operator UI's fallback dashboard + command palette iterate the
 * navigable set). Settings singletons are surfaced via a curated settings menu.
 */
const INTERNAL_CORE = new Set([
  "Entity",
  "Translation",
  "Language",
  "Role",
  "Permission",
  "Rule",
  "View",
  "Workspace",
  "ListPreference",
  "UserPreference",
  "File",
  "DocShare",
  "Log",
  "Setting",
  "BrandingSetting",
]);

/**
 * Coarse role-based select gate for the meta LISTING (which entities to show) —
 * NOT the security boundary (the resource endpoints enforce full RBAC incl.
 * scope/if_owner). Administrator bypasses. Keeps the catalog free of entities the
 * caller would 403 on. scope/if_owner are intentionally ignored here (listing is
 * coarse; per-row access is still enforced downstream).
 */
function canSelectEntity(entity: EntityDefinition, roles: Set<string>, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return (entity.permissions ?? []).some(
    (p) => roles.has(p.role) && (p.select === 1 || p.read === 1),
  );
}

/**
 * Register meta endpoints for entity definitions.
 */
export function registerMetaRoutes(
  app: FastifyInstance,
  prefix: string,
  registry: EntityRegistry,
  db: MongoDBService,
  permissionChecker: PermissionChecker,
): void {
  /** Build the soft-404 the FE speculatively probes for (router fall-through,
   *  stale tabs) — reused for "unknown" AND "not selectable by this caller" so
   *  the latter doesn't reveal that a hidden entity exists. */
  const softNotFound = (request: FastifyRequest, reply: FastifyReply, doctype: string, suggestion?: string) =>
    reply.code(404).send(
      errorResponse(
        404,
        "ENTITY_NOT_FOUND",
        suggestion
          ? `Entity "${doctype}" is not registered; did you mean "${suggestion}"?`
          : `Entity "${doctype}" is not registered`,
        [
          {
            text: suggestion ? "entity_not_found_suggestion" : "entity_not_found",
            type: "error",
            show: true,
            params: { doctype, did_you_mean: suggestion ?? "" },
          },
        ],
        request.traceId ?? "",
      ),
    );

  // Get single entity metadata — audience-PROJECTED (P-SEC/R3). The projection is
  // keyed on the AUDIENCE, not the role: INTERNAL operators (Administrator AND the
  // far more common System User, plus service principals and — transitionally —
  // any token without a `tiers` claim) get the definition VERBATIM, because the
  // operator UI computes field/action visibility from entity.permissions +
  // perm_level client-side (digita-platform/packages/ui/src/lib/permissions.ts, PrintMenu, ListPage,
  // evaluate-field). Only the EXTERNAL audience must not enumerate the internal
  // schema: its fields are limited to what it can read, the whole permissions[]
  // array (roles, scope, condition expressions) + states are stripped, and a
  // doctype it cannot select 404s (same soft shape as unknown, so existence isn't
  // revealed). Keying on role instead of audience would break System-User operators.
  app.get(`${prefix}/meta/:doctype`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { doctype } = request.params as { doctype: string };
    let entity: EntityDefinition;
    try {
      entity = registry.get(doctype);
    } catch (err) {
      if (!(err instanceof UnknownDoctypeError)) throw err;
      return softNotFound(request, reply, err.doctype, err.suggestion ?? undefined);
    }

    // Internal operators: unchanged behaviour (the FE needs the permission matrix).
    if (callerIsInternal(request.user)) {
      return reply.send(successResponse(entity));
    }

    // External audience: gate + project.
    const roles = new Set(request.user?.roles ?? []);
    if (!canSelectEntity(entity, roles, false)) {
      // 404 (not 403) so an external caller can't probe which internal entities exist.
      return softNotFound(request, reply, doctype);
    }
    const readable = permissionChecker.getReadableFields(request.user!, doctype);
    const projected: EntityDefinition = {
      ...entity,
      fields: readable ? entity.fields.filter((f) => readable.has(f.fieldname)) : entity.fields,
      permissions: [],
      states: undefined,
    };
    return reply.send(successResponse(projected));
  });

  // List all entity summaries the caller can select, each flagged `navigable`
  // (a real app entity vs engine plumbing) for the operator UI's catalog.
  app.get(`${prefix}/meta`, async (request: FastifyRequest, reply: FastifyReply) => {
    const roles = new Set(request.user?.roles ?? []);
    const isAdmin = roles.has("Administrator");
    const entities = registry
      .getAll()
      .filter((e) => canSelectEntity(e, roles, isAdmin))
      .map((e) => ({
        name: e.name,
        module: e.module,
        database: e.database,
        label: e.label ?? e.name,
        label_plural: e.label_plural,
        icon: e.icon,
        color: e.color,
        is_submittable: e.is_submittable,
        is_single: e.is_single,
        is_log: e.is_log,
        track_changes: e.track_changes,
        navigable: !INTERNAL_CORE.has(e.name) && !e.is_log,
      }));
    return reply.send(successResponse(entities));
  });

  // Create a new entity definition
  app.post(`${prefix}/meta`, async (request: FastifyRequest, reply: FastifyReply) => {
    // P-SEC/R4: entity-definition mutations hot-reload the permission matrix —
    // an ungated PUT could grant a caller full rights. Administrator only.
    if (!requireAdministrator(request, reply)) return;
    const data = request.body as EntityDefinition;
    const user = request.user?.email ?? "system";

    if (!data.name || !data.module || !data.database || !data.fields) {
      return reply
        .code(400)
        .send(
          errorResponse(
            400,
            "VALIDATION_ERROR",
            "name, module, database, and fields are required",
            [{ text: "entity_required_fields", type: "error", show: true }],
            request.traceId ?? "",
          ),
        );
    }

    if (registry.has(data.name)) {
      return reply
        .code(409)
        .send(
          errorResponse(
            409,
            "DUPLICATE_KEY",
            `Entity "${data.name}" already exists`,
            [{ text: "entity_already_exists", type: "error", show: true }],
            request.traceId ?? "",
          ),
        );
    }

    // Insert into MongoDB
    await db.insertOne(
      DIGITA.COLLECTIONS.ENTITY,
      {
        _id: data.name,
        ...data,
        owner: user,
        modified_by: user,
        creation: new Date(),
        modified: new Date(),
      },
      DIGITA.DATABASES.CORE,
    );

    // Register in memory
    registry.register(data);

    // Run schema migration for the new entity
    const migrator = new SchemaMigrator(db);
    await migrator.migrate(data);

    const ctx = new ResponseContext();
    ctx.success("entity_created", { name: data.name });
    log.info({ entity: data.name, user }, "Entity definition created");

    return reply.code(201).send(successResponse(data, ctx.getMessages()));
  });

  // Update an entity definition
  app.put(`${prefix}/meta/:doctype`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdministrator(request, reply)) return; // P-SEC/R4
    const { doctype } = request.params as { doctype: string };
    const updates = request.body as Partial<EntityDefinition>;
    const user = request.user?.email ?? "system";

    if (!registry.has(doctype)) {
      return reply
        .code(404)
        .send(
          errorResponse(
            404,
            "NOT_FOUND",
            `Entity "${doctype}" not found`,
            [{ text: "entity_not_found", type: "error", show: true }],
            request.traceId ?? "",
          ),
        );
    }

    // Merge with existing
    const existing = registry.get(doctype);
    const merged: EntityDefinition = {
      ...existing,
      ...updates,
      name: doctype, // name is immutable
    };

    // Update in MongoDB
    await db.updateOne(
      DIGITA.COLLECTIONS.ENTITY,
      doctype,
      {
        ...merged,
        modified_by: user,
        modified: new Date(),
      },
      DIGITA.DATABASES.CORE,
    );

    // Reload in memory
    registry.register(merged);

    // Re-run index migration if fields changed
    if (updates.fields || updates.indexes) {
      const indexManager = new IndexManager(db);
      await indexManager.ensureIndexes(merged);
    }

    const ctx = new ResponseContext();
    ctx.success("entity_updated", { name: doctype });
    log.info({ entity: doctype, user }, "Entity definition updated");

    return reply.send(successResponse(merged, ctx.getMessages()));
  });

  // Delete an entity definition
  app.delete(`${prefix}/meta/:doctype`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdministrator(request, reply)) return; // P-SEC/R4
    const { doctype } = request.params as { doctype: string };
    const user = request.user?.email ?? "system";

    if (!registry.has(doctype)) {
      return reply
        .code(404)
        .send(
          errorResponse(
            404,
            "NOT_FOUND",
            `Entity "${doctype}" not found`,
            [{ text: "entity_not_found", type: "error", show: true }],
            request.traceId ?? "",
          ),
        );
    }

    const entity = registry.get(doctype);

    // Block deletion of core entities
    if (entity.module === "core") {
      return reply
        .code(403)
        .send(
          errorResponse(
            403,
            "PERMISSION_DENIED",
            "Cannot delete core entity definitions",
            [{ text: "cannot_delete_core_entity", type: "error", show: true }],
            request.traceId ?? "",
          ),
        );
    }

    // Remove from MongoDB
    await db.deleteOne(DIGITA.COLLECTIONS.ENTITY, doctype, DIGITA.DATABASES.CORE);

    const ctx = new ResponseContext();
    ctx.success("entity_deleted", { name: doctype });
    log.info({ entity: doctype, user }, "Entity definition deleted");

    return reply.send(successResponse({ name: doctype, deleted: true }, ctx.getMessages()));
  });
}
