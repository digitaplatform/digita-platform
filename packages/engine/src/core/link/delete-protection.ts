import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("delete-protection");

export interface DeleteBlocker {
  entity: string;
  fieldname: string;
  count: number;
}

/**
 * Check if a document is referenced by other documents.
 * If so, deletion should be blocked.
 */
export class DeleteProtection {
  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
  ) {}

  async check(doctype: string, name: string): Promise<DeleteBlocker[]> {
    const blockers: DeleteBlocker[] = [];
    const incomingLinks = this.registry.getIncomingLinks(doctype);

    for (const link of incomingLinks) {
      const linkDb = this.registry.get(link.entity).database;
      // Sub-row Links store composite values "<parent_id>::<row_id>" so an
      // exact-equality probe misses them. Match by prefix instead.
      const linkValueFilter = link.target_path
        ? { $regex: `^${escapeRegex(name)}::` }
        : name;
      const filter = { [link.fieldname]: linkValueFilter };
      const count = await this.db.count(link.entity, [filter], linkDb);

      if (count > 0) {
        blockers.push({
          entity: link.entity,
          fieldname: link.fieldname,
          count,
        });
      }
    }

    if (blockers.length > 0) {
      log.debug({ doctype, name, blockers }, "Delete blocked by references");
    }

    return blockers;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
