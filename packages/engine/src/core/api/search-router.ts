import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { GlobalSearchService } from "../search/global-search-service.js";
import type { LinkSearchService } from "../link/link-search-service.js";
import type { UserContext } from "../permissions/types.js";
import { successResponse } from "./response-model.js";

const GUEST_USER: UserContext = { _id: "Guest", email: "Guest", roles: ["Guest"] };

function getUser(request: FastifyRequest): UserContext {
  return request.user ?? GUEST_USER;
}

/**
 * Register search API endpoints.
 */
export function registerSearchRoutes(
  app: FastifyInstance,
  prefix: string,
  globalSearchService: GlobalSearchService,
  linkSearchService: LinkSearchService,
): void {
  // Global search across all entities
  app.get(`${prefix}/search`, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const q = query["q"] ?? "";
    const limit = parseInt(query["limit"] ?? "20", 10);

    if (!q || q.length < 2) {
      return reply.send(successResponse([]));
    }

    const results = await globalSearchService.search(q, getUser(request), limit);
    return reply.send(successResponse(results));
  });

  // Link search — typeahead for Link field dropdowns. When `target_path` is
  // passed the search expands into sub-row results (composite `_id`s of
  // form `<parent>::<row_id>`).
  app.get(`${prefix}/search/:entity`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { entity } = request.params as { entity: string };
    const query = request.query as Record<string, string>;
    const q = query["q"] ?? "";
    const limit = parseInt(query["limit"] ?? "20", 10);
    const targetPath = query["target_path"] || undefined;
    // Comma-separated field list → columns returned per row (search-dialog picker).
    const columns = query["fields"]
      ? query["fields"]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    let filters: Record<string, unknown> | undefined;
    if (query["filters"]) {
      try {
        filters = JSON.parse(query["filters"]);
      } catch {
        // ignore invalid filters
      }
    }

    const results = await linkSearchService.search(
      entity,
      q,
      getUser(request),
      filters,
      limit,
      targetPath,
      columns,
    );
    return reply.send(successResponse(results));
  });
}
