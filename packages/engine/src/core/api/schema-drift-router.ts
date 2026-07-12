import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import { successResponse } from "./response-model.js";

/**
 * Admin: schema-drift snapshot captured during the most recent
 * `EntityRegistry.loadFromDb`, plus a reseed action to overwrite the DB
 * definition with the file-loaded one. Empty array when no drift was
 * observed. Administrator-only — drift typically reveals internal field
 * names that lower-privileged users have no business reading.
 */
export function registerSchemaDriftRoutes(
  app: FastifyInstance,
  prefix: string,
  registry: EntityRegistry,
  db: MongoDBService,
): void {
  app.get(`${prefix}/admin/schema-drift`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!user || !user.roles?.includes("Administrator")) {
      return reply.code(403).send({ success: false, error: { code: "FORBIDDEN" } });
    }
    const drift = registry.getDriftSnapshots();
    return reply.send(successResponse(drift));
  });

  // Reseed: overwrite the DB definition for one entity with its file-loaded
  // snapshot. Destructive — wipes admin edits. Returns the new drift
  // snapshot (should be empty for the reseeded entity).
  app.post(
    `${prefix}/admin/schema-drift/:entity/reseed`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!user || !user.roles?.includes("Administrator")) {
        return reply.code(403).send({ success: false, error: { code: "FORBIDDEN" } });
      }
      const { entity } = request.params as { entity: string };
      if (!registry.getFileEntity(entity)) {
        return reply.code(404).send({
          success: false,
          error: {
            code: "NO_FILE_SOURCE",
            detail: `Entity "${entity}" has no file-loaded definition to reseed from`,
          },
        });
      }
      await registry.reseedFromFile(db, entity);
      return reply.send(successResponse({ entity, drift: registry.getDriftSnapshots() }));
    },
  );
}
