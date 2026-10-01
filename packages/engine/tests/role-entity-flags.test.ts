import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { seedRoles } from "../src/core/setup/seed-roles.js";

/**
 * A Role's "Disabled" and "Desk Access" never did anything: permission rows match role names, and
 * the token's tiers decide who enters the desk. The entity offers neither, and the seed writes neither.
 */
describe("the Role entity", () => {
  it("offers no disabled or desk_access field", () => {
    const role = JSON.parse(readFileSync(new URL("../src/entities/Role.entity.json", import.meta.url), "utf8")) as {
      fields: Array<{ fieldname: string }>;
    };
    expect(role.fields.map((f) => f.fieldname)).toEqual(["name", "label", "is_custom"]);
  });

  it("is seeded without them", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const db = {
      ensureCollection: async () => {},
      findOne: async () => null,
      insertOne: async (_c: string, doc: Record<string, unknown>) => void inserted.push(doc),
    } as unknown as MongoDBService;
    await seedRoles(db);
    expect(inserted.map((r) => r["_id"])).toEqual(["Administrator", "System User", "Website User", "Guest"]);
    expect(inserted.filter((r) => "disabled" in r || "desk_access" in r)).toEqual([]);
  });
});
