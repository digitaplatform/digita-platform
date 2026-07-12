import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import { applyScopeFilters } from "../permissions/scope-filter.js";
import { env } from "../config/env.js";

export interface SearchResult {
  entity: string;
  _id: string;
  title: string;
  description?: string;
}

export class GlobalSearchService {
  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
    private permissionChecker: PermissionChecker,
  ) {}

  /**
   * Search across all entities marked with in_global_search.
   */
  async search(query: string, user: UserContext, limit: number = 20): Promise<SearchResult[]> {
    // Clamp the caller-controlled limit: this fans out into parallel,
    // unindexed, non-anchored regex scans across every in_global_search
    // collection, so an unbounded limit is a DoS vector. Cap at 50 and fall
    // back to the default (20) for NaN / <= 0.
    const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 20), 50);
    const results: SearchResult[] = [];
    const entities = this.registry.getAll().filter((e) => e.in_global_search);

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    await Promise.all(
      entities.map(async (entity) => {
        const searchFields = entity.search_fields ?? [];
        if (searchFields.length === 0) return;

        // Same gate as getList / link search: no select grant on this collection
        // → the user must not enumerate it through global search. Skip (don't
        // throw) so one denied collection doesn't fail the whole cross-entity search.
        const { allowed } = await this.permissionChecker.hasPermission(
          user,
          entity.name,
          "select",
        );
        if (!allowed) return;

        const orConditions = searchFields.map((field) => ({
          [field]: { $regex: escaped, $options: "i" },
        }));

        // Scope narrowing (if_owner / permission.scope) — same semantics as getList.
        const mongoFilter = applyScopeFilters(
          entity,
          user,
          { $or: orConditions },
          env.PERMISSION_SCOPE_ENABLED,
        );

        const titleField = entity.title_field ?? "_id";
        const docs = await this.db.find(
          entity.name,
          {
            filters: [mongoFilter as Record<string, unknown>],
            fields: ["_id", titleField],
            limit: Math.ceil(safeLimit / entities.length) || 5,
          },
          entity.database,
        );

        for (const doc of docs) {
          const d = doc as Record<string, unknown>;
          results.push({
            entity: entity.name,
            _id: String(d["_id"]),
            title: String(d[titleField] ?? d["_id"]),
          });
        }
      }),
    );

    return results.slice(0, safeLimit);
  }
}
