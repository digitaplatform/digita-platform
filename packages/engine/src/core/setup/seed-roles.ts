import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("seed-roles");

const DEFAULT_ROLES = [
  {
    _id: "Administrator",
    name: "Administrator",
    label: "Administrator",
    desk_access: true,
    disabled: false,
    is_custom: false,
  },
  {
    _id: "System User",
    name: "System User",
    label: "System User",
    desk_access: true,
    disabled: false,
    is_custom: false,
  },
  {
    _id: "Website User",
    name: "Website User",
    label: "Website User",
    desk_access: false,
    disabled: false,
    is_custom: false,
  },
  {
    _id: "Guest",
    name: "Guest",
    label: "Guest",
    desk_access: false,
    disabled: false,
    is_custom: false,
  },
];

export async function seedRoles(db: MongoDBService): Promise<void> {
  await db.ensureCollection(DIGITA.COLLECTIONS.ROLE, DIGITA.DATABASES.IDENTITY);

  for (const role of DEFAULT_ROLES) {
    const existing = await db.findOne(DIGITA.COLLECTIONS.ROLE, role._id, DIGITA.DATABASES.IDENTITY);
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
      await db.updateOne(DIGITA.COLLECTIONS.ROLE, role._id, { name: role.name }, DIGITA.DATABASES.IDENTITY);
      log.info({ role: role._id }, "Role.name back-filled");
    }
  }
}
