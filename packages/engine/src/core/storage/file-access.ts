import { DIGITA } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import { readStoredRow } from "../entity/field-types.js";

export interface FileAccessDeps {
  db: MongoDBService;
  registry: EntityRegistry;
  permissionChecker: PermissionChecker;
}

/**
 * Whether `actor` may read the file `fileDoc`: through the File read grant (its uploader, an
 * Administrator), or through read on the document the file is bound to, judged on the stored row.
 * The download route, a save that names a file and a copy that clones one all ask here, so no path
 * reaches a file the download would refuse. File ids are sequential, so a path that skipped this
 * would let any user name any file.
 */
export async function mayReadFile(deps: FileAccessDeps, actor: UserContext, fileDoc: Record<string, unknown>): Promise<boolean> {
  if ((await deps.permissionChecker.hasPermission(actor, DIGITA.COLLECTIONS.FILE, "read", fileDoc)).allowed) return true;
  const parentEntity = fileDoc["attached_to_entity"];
  const parentName = fileDoc["attached_to_name"];
  if (typeof parentEntity !== "string" || !parentEntity || typeof parentName !== "string" || !parentName) return false;
  if (!deps.registry.has(parentEntity)) return false;
  const parentDefinition = deps.registry.get(parentEntity);
  const parentDoc = await deps.db.findOne(parentEntity, parentName, parentDefinition.database);
  if (!parentDoc) return false;
  const parentRead = await deps.permissionChecker.hasPermission(
    actor,
    parentEntity,
    "read",
    readStoredRow(parentDefinition, parentDoc as Record<string, unknown>),
  );
  return parentRead.allowed;
}
