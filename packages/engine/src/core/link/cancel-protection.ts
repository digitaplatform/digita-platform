import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("cancel-protection");

export interface CancelBlocker {
  entity: string;
  fieldname: string;
  count: number;
}

/**
 * Forward immutability — block cancel of a document while submitted
 * downstream documents reference it.
 *
 * Mirror of `DeleteProtection`, but with two differences:
 * 1. Only counts incoming references from `is_submittable: true` entities.
 *    Non-submittable references (e.g. an audit Log row, a Permission scope)
 *    do not constitute "the document was forwarded".
 * 2. Filters by `docstatus: 1` — only currently-submitted downstream docs
 *    block cancel. Drafts can be cleaned up by the operator first; cancelled
 *    downstreams already lost their forward chain.
 *
 * Sub-row links (composite `<parent_id>::<row_id>`) are handled via a regex
 * prefix match — relevant for completeness even though the current apps have no
 * submittable→submittable sub-row links.
 */
export class CancelProtection {
  constructor(
    private registry: EntityRegistry,
    private db: MongoDBService,
  ) {}

  async check(
    doctype: string,
    name: string,
    session?: import("mongodb").ClientSession,
  ): Promise<CancelBlocker[]> {
    const blockers: CancelBlocker[] = [];
    const incomingLinks = this.registry.getIncomingLinks(doctype);

    for (const link of incomingLinks) {
      const referencingEntity = this.registry.get(link.entity);
      if (!referencingEntity.is_submittable) continue;

      const linkDb = referencingEntity.database;
      const linkValueFilter = link.target_path
        ? { $regex: `^${escapeRegex(name)}::` }
        : name;

      // Dotted child-table fieldnames are matched correctly by MongoDB
      // dot-notation array matching, so no branch is needed.
      const filter = { [link.fieldname]: linkValueFilter, docstatus: 1 };

      const count = await this.db.count(link.entity, [filter], linkDb, session);

      if (count > 0) {
        blockers.push({
          entity: link.entity,
          fieldname: link.fieldname,
          count,
        });
      }
    }

    if (blockers.length > 0) {
      log.debug({ doctype, name, blockers }, "Cancel blocked by submitted downstream docs");
    }

    return blockers;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
