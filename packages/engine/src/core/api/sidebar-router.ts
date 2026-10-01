import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { readVersionChanges, type VersionService, type Version } from "../version/version-service.js";
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

  // Shared read gate (H1). It enforces the exact same read authorization a
  // direct document read gets (RBAC + condition + scope + if_owner +
  // role-visibility + doc-share) and throws 403/404 on denial — so a user who
  // cannot read the document cannot enumerate its versions / shares / related.
  // It logs no view, as opening these panels is no read of the record.
  const assertCanRead = (request: FastifyRequest, doctype: string, name: string) =>
    documentService.assertCanRead(doctype, name, request.user as UserContext | undefined);

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
      const doc = await assertCanRead(request, doctype, name);
      const query = request.query as Record<string, string>;
      const limit = parseInt(query["limit"] ?? "20", 10);
      const versions = await versionService.getVersions(doctype, name, limit);
      // Mask field-level changes the user may not read (perm_level), mirroring
      // getDoc's field filtering — a version row must not leak a gated field's
      // old/new values. The document is passed so an if_owner / condition / scope
      // level grant counts only where it holds on it; without it every such grant
      // counts. `null` = all fields readable (admin / unrestricted).
      const user = request.user as UserContext | undefined;
      const readable = user ? permissionChecker.getReadableFields(user, doctype, doc._data) : null;
      const result =
        user && readable
          ? versions.map((v) =>
              maskVersionChanges(v, readable, (table) =>
                permissionChecker.getReadableChildFields(user, doctype, table, doc._data),
              ),
            )
          : versions;
      const entity = registry.get(doctype);
      return reply.send(successResponse(result.map((v) => readVersionChanges(v, entity))));
    },
  );

  // ─── View Log ─────────────────────────────────────────
  app.get(
    `${basePath}/:doctype/:name/views`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { doctype, name } = request.params as { doctype: string; name: string };
      const query = request.query as Record<string, string>;
      const limit = parseInt(query["limit"] ?? "20", 10);
      const views = await documentService.getViewLog(doctype, name, request.user as UserContext | undefined, limit);
      return reply.send(successResponse(views));
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

/**
 * Drop change entries whose field the user may not read (perm_level gating). A Table's change
 * holds its rows whole, so each old and new row keeps only the cells the user may read.
 */
function maskVersionChanges(
  version: Version,
  readable: Set<string>,
  readableCells: (table: string) => Set<string> | null,
): Version {
  return {
    ...version,
    changes: version.changes
      .filter((c) => readable.has(c.field))
      .map((c) => {
        const cells = readableCells(c.field);
        return cells ? { ...c, old: keepCells(c.old, cells), new: keepCells(c.new, cells) } : c;
      }),
  };
}

function keepCells(rows: unknown, cells: Set<string>): unknown {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) =>
    row && typeof row === "object" ? Object.fromEntries(Object.entries(row).filter(([cell]) => cells.has(cell))) : row,
  );
}
