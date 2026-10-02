import type { EntityDefinition } from "@digitaplatform/shared";
import { isFieldAllowed } from "../database/filter-builder.js";
import { GatedListTooBroadError, type DocumentService } from "../document/document-service.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";

export interface RelatedDocResult {
  label: string;
  entity: string;
  /** Absent where the link filters on a field the caller may not filter on: its count would
   *  show what that field hides. */
  count?: number;
  /** Why `count` is absent where counting the link was refused, so one refused link never
   *  costs the other links their counts. */
  error?: string;
  icon?: string;
}

export class RelatedDocService {
  constructor(
    private documentService: DocumentService,
    private permissionChecker: PermissionChecker,
  ) {}

  async getRelatedDocs(
    entity: EntityDefinition,
    documentName: string,
    user?: UserContext,
  ): Promise<RelatedDocResult[]> {
    if (!entity.links?.length) return [];

    // One answer per link, in the order the links are declared: a caller matches answers to its
    // links by position, since two links may share an entity and a label.
    return Promise.all(
      entity.links.map(async (link): Promise<RelatedDocResult> => {
        // Authorize the COUNTED entity, not just the parent (H1 gated the parent
        // read only). Skip the count unless the caller may `select` the linked
        // entity, and count what `count` answers the caller: the rows a list of
        // the linked entity shows, after scope, role visibility and read condition.
        let count: number | undefined = 0;
        let error: string | undefined;
        if (
          link.show_count &&
          user &&
          (await this.permissionChecker.hasPermission(user, link.entity, "select")).allowed
        ) {
          // The link's filter is the engine's, not the caller's, so a field outside the caller's
          // allow-list skips this count instead of refusing the whole answer.
          const filter = { [link.link_field]: documentName, ...link.filters };
          const allowed = this.permissionChecker.getFilterAllowlist(user, link.entity);
          try {
            count = Object.keys(filter).every((field) => isFieldAllowed(field, allowed))
              ? await this.documentService.count(link.entity, [], user, { scope: filter })
              : undefined;
          } catch (err) {
            if (!(err instanceof GatedListTooBroadError)) throw err;
            count = undefined;
            error = err.message;
          }
        }

        return {
          label: link.label,
          entity: link.entity,
          count,
          error,
          icon: link.icon,
        };
      }),
    );
  }
}
