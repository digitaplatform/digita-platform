import type { EntityDefinition, LinkDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import { applyScopeFilters } from "../permissions/scope-filter.js";
import { env } from "../config/env.js";

export interface RelatedDocResult {
  label: string;
  entity: string;
  count: number;
  icon?: string;
}

export class RelatedDocService {
  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
    private permissionChecker: PermissionChecker,
  ) {}

  async getRelatedDocs(
    entity: EntityDefinition,
    documentName: string,
    user?: UserContext,
  ): Promise<RelatedDocResult[]> {
    if (!entity.links?.length) return [];

    const results: RelatedDocResult[] = [];

    await Promise.all(
      entity.links.map(async (link) => {
        const linkEntity = this.registry.get(link.entity);

        // Authorize the COUNTED entity, not just the parent (H1 gated the parent
        // read only). Skip the count unless the caller may `select` the linked
        // entity, and narrow the count filter by the same scope/if_owner rules
        // getList / LinkSearchService apply — otherwise the count leaks rows the
        // per-record read gate forbids (cross-company / cross-owner enumeration).
        let count = 0;
        if (
          link.show_count &&
          user &&
          (await this.permissionChecker.hasPermission(user, link.entity, "select")).allowed
        ) {
          let filter: Record<string, unknown> = {
            [link.link_field]: documentName,
          };
          if (link.filters) {
            Object.assign(filter, link.filters);
          }
          filter = applyScopeFilters(linkEntity, user, filter, env.PERMISSION_SCOPE_ENABLED);
          count = await this.db.count(link.entity, [filter], linkEntity.database);
        }

        results.push({
          label: link.label,
          entity: link.entity,
          count,
          icon: link.icon,
        });
      }),
    );

    return results;
  }
}
