import type { BaseDocument } from "../../core/document/base-document.js";
import { getRoleRegistry } from "../../core/permissions/role-registry.js";

/**
 * Role — before_save hook.
 *
 * Block mutation of the immutable `name` field. `name` is the code identifier
 * referenced by user.roles and entity permissions across the whole platform;
 * renaming it would break every reference. `label` is the editable display name.
 */
export async function beforeSave(doc: BaseDocument): Promise<void> {
  if (!doc.hasChanged("name")) return;
  const previous = doc.getPreviousValue("name") as string | undefined;
  const current = doc.get("name") as string | undefined;
  if (previous && current && previous !== current) {
    throw new Error("role_name_immutable");
  }
}

/**
 * Keep RoleRegistry in sync when a new role is created via the API,
 * so user.roles validation and entity permission checks accept it immediately.
 */
export async function afterInsert(doc: BaseDocument): Promise<void> {
  const name = doc.get("name") as string | undefined;
  if (name) getRoleRegistry().register(name);
}

/**
 * Drop a role from the registry after deletion.
 */
export async function afterDelete(doc: BaseDocument): Promise<void> {
  const name = doc.get("name") as string | undefined;
  if (name) getRoleRegistry().unregister(name);
}
