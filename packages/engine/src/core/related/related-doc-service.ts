import type { EntityDefinition } from "@digitaplatform/shared";
import type { DocumentService } from "../document/document-service.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";

export interface RelatedDocResult {
  label: string;
  entity: string;
  count: number;
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
        let count = 0;
        if (
          link.show_count &&
          user &&
          (await this.permissionChecker.hasPermission(user, link.entity, "select")).allowed
        ) {
          count = await this.documentService.count(
            link.entity,
            [{ [link.link_field]: documentName, ...link.filters }],
            user,
          );
        }

        return {
          label: link.label,
          entity: link.entity,
          count,
          icon: link.icon,
        };
      }),
    );
  }
}
