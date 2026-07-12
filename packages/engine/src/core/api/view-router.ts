import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { UserContext } from "../permissions/types.js";
import { ResponseContext } from "./response-context.js";
import { successResponse } from "./response-model.js";
import type { ViewRegistry } from "../view/view-registry.js";
import { ViewEngine, ViewNotFoundError } from "../view/view-engine.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("view-router");
const GUEST_USER: UserContext = { _id: "Guest", email: "Guest", roles: ["Guest"] };

function getUser(request: FastifyRequest): UserContext {
  return request.user ?? GUEST_USER;
}

function viewOrThrow(registry: ViewRegistry, name: string) {
  if (!registry.has(name)) throw new ViewNotFoundError(name);
  return registry.get(name);
}

/**
 * GET /api/v1/view/:viewName
 * GET /api/v1/view/:viewName/:rootName
 *
 * Single generic dispatcher — the view metadata decides everything else.
 */
export function registerViewRoutes(
  app: FastifyInstance,
  prefix: string,
  registry: ViewRegistry,
  executor: ViewEngine,
): void {
  const basePath = `${prefix}/view`;

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { viewName: string; rootName?: string };
    const view = viewOrThrow(registry, params.viewName);
    const ctx = new ResponseContext();

    const result = await executor.execute(
      view,
      {
        rootName: params.rootName,
        query: (request.query as Record<string, string>) ?? {},
      },
      getUser(request),
      ctx,
    );

    return reply.send(successResponse(result, ctx.getMessages()));
  };

  app.get(`${basePath}/:viewName`, handler);
  app.get(`${basePath}/:viewName/:rootName`, handler);

  log.info({ views: registry.getAll().length }, "View routes registered");
}
