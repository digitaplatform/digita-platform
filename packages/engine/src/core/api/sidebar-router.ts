import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { VersionService, Version } from "../version/version-service.js";
import type { DocumentShareService } from "../permissions/document-share-service.js";
import type { RelatedDocService } from "../related/related-doc-service.js";
import type { DocumentService } from "../document/document-service.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import { successResponse } from "./response-model.js";

export function registerSidebarRoutes(
  app: FastifyInstance,
  prefix: string,
  registry: EntityRegistry,
  relatedDocService: RelatedDocService,
  versionService: VersionService,
  shareService: DocumentShareService,
  documentService: DocumentService,
  permissionChecker: PermissionChecker,
): void {
  const basePath = `${prefix}/resource`;

  // Shared read gate (H1). getDoc enforces the exact same read authorization a
  // direct document read gets (RBAC + condition + scope + if_owner +
  // role-visibility + doc-share) and throws 403/404 on denial — so a user who
  // cannot read the document cannot enumerate its versions / shares / related.
  const assertCanRead = (request: FastifyRequest, doctype: string, name: string) =>
    documentService.getDoc(doctype, name, request.user as UserContext | undefined);

  // ─── Related Documents ────────────────────────────────
  app.get(
    `${basePath}/:doctype/:name/related`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      await assertCanRead(request, doctype, name);
      const entity = registry.get(doctype);
      const related = await relatedDocService.getRelatedDocs(entity, name, request.user as UserContext | undefined);
      return reply.send(successResponse(related));
    },
  );

  // ─── Version History ──────────────────────────────────
  app.get(
    `${basePath}/:doctype/:name/versions`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      await assertCanRead(request, doctype, name);
      const query = request.query as Record<string, string>;
      const limit = parseInt(query["limit"] ?? "20", 10);
      const versions = await versionService.getVersions(doctype, name, limit);
      // Mask field-level changes the user may not read (perm_level), mirroring
      // getDoc's field filtering — a version row must not leak a gated field's
      // old/new values. `null` = all fields readable (admin / unrestricted).
      const user = request.user as UserContext | undefined;
      const readable = user ? permissionChecker.getReadableFields(user, doctype) : null;
      const result = readable ? versions.map((v) => maskVersionChanges(v, readable)) : versions;
      return reply.send(successResponse(result));
    },
  );

  // ─── Document Shares ──────────────────────────────────
  app.get(
    `${basePath}/:doctype/:name/shares`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      await assertCanRead(request, doctype, name);
      const shares = await shareService.getShares(doctype, name);
      return reply.send(successResponse(shares));
    },
  );
}

/** Drop change entries whose field the user may not read (perm_level gating). */
function maskVersionChanges(version: Version, readable: Set<string>): Version {
  return { ...version, changes: version.changes.filter((c) => readable.has(c.field)) };
}
