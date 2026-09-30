import type { ClientSession } from "mongodb";
import { DIGITA } from "@digitaplatform/shared";
import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { PermissionDeniedError, type PermissionChecker } from "../permissions/permission-checker.js";
import type { UserContext } from "../permissions/types.js";
import { readStoredRow } from "../entity/field-types.js";
import { collectAttachFileIds } from "./file-cleanup.js";

export interface FileAccessDeps {
  db: MongoDBService;
  registry: EntityRegistry;
  permissionChecker: PermissionChecker;
}

/**
 * Whether `actor` may read the file `fileDoc`: through the File read grant (its uploader, an
 * Administrator), or through read on the document the file is bound to, judged on the stored row.
 * The download route asks here, a save asks here for every file it newly names (insert, update, a
 * submitted patch, an import and its dry run), and a copy asks for every file it clones; the clone
 * of a colleague's loose upload stays theirs and loose. So neither a save nor a copy
 * opens a file to a user the download refuses. File ids are sequential, so a path that skipped
 * this would let any user name any file.
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

/**
 * Refuse a save that newly names a file the saver may not read, or a file id no File has. File
 * ids are sequential, so without this a user could name a colleague's file, or the id the next
 * upload will get, and read it through a copy's clone. A ref the save keeps from the stored row
 * (`before`) passes.
 */
export async function assertAttachFilesReadable(
  deps: FileAccessDeps,
  entity: EntityDefinition,
  data: Record<string, unknown>,
  before: ReadonlySet<string>,
  user: UserContext,
  session?: ClientSession,
): Promise<void> {
  const added = new Set(collectAttachFileIds(entity.fields, data).filter((fileId) => !before.has(fileId)));
  if (added.size === 0) return;
  const files = await deps.db.find(
    DIGITA.COLLECTIONS.FILE,
    { filters: [{ _id: { $in: [...added] } }] },
    DIGITA.DATABASES.CORE,
    session,
  );
  // An id no File has yet is refused too: the next upload could take it.
  if (files.length < added.size) throw new PermissionDeniedError(user.email, DIGITA.COLLECTIONS.FILE, "read");
  for (const file of files) {
    if (!(await mayReadFile(deps, user, file as Record<string, unknown>))) {
      throw new PermissionDeniedError(user.email, DIGITA.COLLECTIONS.FILE, "read");
    }
  }
}
