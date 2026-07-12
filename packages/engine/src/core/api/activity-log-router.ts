import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ActivityLogService } from "../logging/activity-log-service.js";
import type { DocumentService } from "../document/document-service.js";
import type { UserContext } from "../permissions/types.js";
import { requireAdministrator } from "../auth/require-admin.js";
import { successResponse } from "./response-model.js";

export function registerActivityLogRoutes(
  app: FastifyInstance,
  prefix: string,
  activityLogService: ActivityLogService,
  documentService: DocumentService,
): void {
  // Shared read gate (mirrors the H1 sidebar fix). getDoc enforces the exact
  // same read authorization a direct document read gets (RBAC + condition +
  // scope + if_owner + role-visibility + doc-share) and throws 403/404 on
  // denial — so a user who cannot read the document cannot enumerate its
  // activity stream (who did what, when).
  const assertCanRead = (request: FastifyRequest, doctype: string, name: string) =>
    documentService.getDoc(doctype, name, request.user as UserContext | undefined);

  // Get activity for a specific document
  app.get(
    `${prefix}/activity/:entity/:name`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { entity, name } = request.params as { entity: string; name: string };
      await assertCanRead(request, entity, name);
      const query = request.query as Record<string, string>;
      const limit = parseInt(query["limit"] ?? "50", 10);

      const logs = await activityLogService.getLog(entity, name, limit);
      return reply.send(successResponse(logs));
    },
  );

  // Get all activity (with optional filters). Administrator-gated: this
  // cross-entity operation stream leaks who did what, document names and
  // changed-field lists across every entity, bypassing per-entity RBAC — the
  // same leak the H1 fix closed on the per-document sidebar route.
  app.get(`${prefix}/activity`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdministrator(request, reply)) return;
    const query = request.query as Record<string, string>;
    const filters: Record<string, unknown> = {};

    if (query["entity"]) filters["entity"] = query["entity"];
    if (query["user"]) filters["user"] = query["user"];
    if (query["action"]) filters["action"] = query["action"];

    const limit = parseInt(query["limit"] ?? "50", 10);
    const offset = parseInt(query["offset"] ?? "0", 10);

    const result = await activityLogService.query(filters, limit, offset);
    return reply.send(
      successResponse(result.data, [], {
        total: result.total,
        page: Math.floor(offset / limit) + 1,
        page_size: limit,
        total_pages: Math.ceil(result.total / limit),
      }),
    );
  });
}
