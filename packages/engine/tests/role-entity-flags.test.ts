import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { removeWebsiteUserRoleOnce, seedRoles } from "../src/core/setup/seed-roles.js";

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
    expect(inserted.map((r) => r["_id"])).toEqual(["Administrator", "System User", "Guest"]);
    expect(inserted.filter((r) => "disabled" in r || "desk_access" in r)).toEqual([]);
  });
});

/** "Website User" was seeded, but nothing gave it a meaning; its stored row goes once per database. */
describe("the unread system role Website User", () => {
  function fakeDb(rows: Map<string, Record<string, unknown>>) {
    return {
      findOne: async (collection: string, id: string) => rows.get(`${collection}/${id}`) ?? null,
      upsertOne: async (collection: string, id: string, doc: Record<string, unknown>) => void rows.set(`${collection}/${id}`, doc),
      deleteOne: async (collection: string, id: string) => void rows.delete(`${collection}/${id}`),
    } as unknown as MongoDBService;
  }

  it("is removed from a database that holds it, once", async () => {
    const rows = new Map<string, Record<string, unknown>>([
      ["Role/Website User", { _id: "Website User" }],
      ["Role/Guest", { _id: "Guest" }],
    ]);
    const db = fakeDb(rows);
    await removeWebsiteUserRoleOnce(db);
    expect(rows.has("Role/Website User")).toBe(false);
    expect(rows.has("Role/Guest")).toBe(true);
    expect(rows.has("_migrations/remove-website-user-role")).toBe(true);

    // A row that appears afterwards is not this migration's to remove.
    rows.set("Role/Website User", { _id: "Website User" });
    await removeWebsiteUserRoleOnce(db);
    expect(rows.has("Role/Website User")).toBe(true);
  });
});

