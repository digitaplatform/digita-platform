import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { readVersionChanges, type VersionService } from "../version/version-service.js";
import { requireAdministrator } from "../auth/require-admin.js";
import { successResponse } from "./response-model.js";

/**
 * Audit log — the field-level change history (`_versions`) across ALL
 * documents. Distinct from the activity log (`/activity`, the operation/action
 * stream): the audit log answers "what data changed, before→after, by whom"
 * for compliance, the activity log answers "who did what action".
 */
export function registerAuditLogRoutes(
  app: FastifyInstance,
  prefix: string,
  versionService: VersionService,
  registry: EntityRegistry,
): void {
  // Global audit log — recent field-level changes (with optional filters).
  // Administrator-gated: this cross-entity stream carries raw old→new values for
  // every changed field of every tracked entity, bypassing per-entity RBAC and
  // perm_level masking. The H1 fix gated the per-document sidebar versions route;
  // this closes the same leak on the global route.
  app.get(`${prefix}/audit`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdministrator(request, reply)) return;
    const query = request.query as Record<string, string>;
    const filters: Record<string, unknown> = {};

    if (query["entity"]) filters["entity"] = query["entity"];
    if (query["user"]) filters["changed_by"] = query["user"];

    const limit = parseInt(query["limit"] ?? "50", 10);
    const offset = parseInt(query["offset"] ?? "0", 10);

    const result = await versionService.queryVersions(filters, limit, offset);
    // A row of an entity no longer registered has no field types left to read it by, so it goes out as stored.
    const data = result.data.map((v) => (registry.has(v.entity) ? readVersionChanges(v, registry.get(v.entity)) : v));
    return reply.send(
      successResponse(data, [], {
        total: result.total,
        page: Math.floor(offset / limit) + 1,
        page_size: limit,
        total_pages: Math.ceil(result.total / limit),
      }),
    );
  });
}
