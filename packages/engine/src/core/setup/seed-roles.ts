import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { runForwardMigrationOnce } from "../database/forward-migration.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("seed-roles");

const DEFAULT_ROLES = [
  {
    _id: "Administrator",
    name: "Administrator",
    label: "Administrator",
    is_custom: false,
  },
  {
    _id: "System User",
    name: "System User",
    label: "System User",
    is_custom: false,
  },
  {
    _id: "Guest",
    name: "Guest",
    label: "Guest",
    is_custom: false,
  },
];

export async function seedRoles(db: MongoDBService): Promise<void> {
  await db.ensureCollection(DIGITA.COLLECTIONS.ROLE, DIGITA.DATABASES.IDENTITY);

  for (const role of DEFAULT_ROLES) {
    const existing = await db.findOne(DIGITA.COLLECTIONS.ROLE, role._id, DIGITA.DATABASES.IDENTITY, undefined, { includeDeleted: true });
    if (existing?.["deleted"] != null) continue;
    if (!existing) {
      await db.insertOne(
        DIGITA.COLLECTIONS.ROLE,
        {
          ...role,
          doctype: "role",
          docstatus: 0,
          owner: "system",
          modified_by: "system",
          creation: new Date(),
          modified: new Date(),
        },
        DIGITA.DATABASES.IDENTITY,
      );
      log.info({ role: role._id }, "Role seeded");
    } else if (!(existing as Record<string, unknown>)["name"]) {
      // Back-fill `name` field for roles that pre-date the split (label/_id only).
      const updated = await db.updateOne(DIGITA.COLLECTIONS.ROLE, role._id, { name: role.name }, DIGITA.DATABASES.IDENTITY,
        undefined, { deleted: null });
      if (updated) log.info({ role: role._id }, "Role.name back-filled");
    }
  }
}

/**
 * "Website User" was seeded as a system role, but nothing gave it a meaning: no engine honors it
 * and no permission row names it. The seed no longer writes it, and its stored row is removed,
 * once per database.
 */
export async function removeWebsiteUserRoleOnce(db: MongoDBService): Promise<void> {
  await runForwardMigrationOnce(db, "remove-website-user-role", async () => {
    await db.deleteOne(DIGITA.COLLECTIONS.ROLE, "Website User", DIGITA.DATABASES.IDENTITY);
    return {};
  });
}
