import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a", MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// An entity that declares `tree` gets the tree block from the engine, so no tree names its own
// parent field.
const group = (extra: Record<string, unknown> = {}) => ({
  name: "CustomerGroup",
  module: "test",
  database: "app",
  naming: { strategy: "system" },
  tree: {},
  fields: [{ fieldname: "discount", fieldtype: "Float", label: "Discount" }],
  permissions: [],
  ...extra,
});

/** Loads entity files as boot does, and answers the registry or the refusal. */
async function load(...definitions: Record<string, unknown>[]): Promise<{ registry: EntityRegistry; error?: Error }> {
  const dir = await mkdtemp(join(tmpdir(), "reg-tree-"));
  for (const d of definitions) await writeFile(join(dir, `${String(d["name"])}.entity.json`), JSON.stringify(d));
  const registry = new EntityRegistry();
  const error = await registry.loadAll(dir).then(() => undefined, (e: unknown) => e as Error);
  await rm(dir, { recursive: true, force: true });
  return { registry, error };
}

const shapeOf = (entity: EntityDefinition) =>
  entity.fields.map((f) => [f.fieldname, f.fieldtype, f.target ?? null, f.required ?? false]);

describe("the tree block", () => {
  it("gives an entity file with tree the node's fields, the tree's indexes and its title field", async () => {
    const { registry, error } = await load(group());
    expect(error).toBeUndefined();
    const entity = registry.get("CustomerGroup");
    expect(shapeOf(entity)).toEqual([
      ["discount", "Float", null, false],
      ["label", "Data", null, true],
      ["parent", "Link", "CustomerGroup", false],
      ["position", "Int", null, false],
      ["icon", "Data", null, false],
      ["active", "Check", null, false],
    ]);
    expect(entity.fields.find((f) => f.fieldname === "label")?.translatable).toBe(true);
    expect(entity.fields.find((f) => f.fieldname === "active")?.default).toBe(1);
    expect(entity.title_field).toBe("label");
    expect(entity.indexes?.map((i) => [i.name, i.fields])).toEqual([
      ["idx_tree_parent", ["parent"]],
      ["idx_tree_ancestors", ["_ancestors"]],
    ]);
  });

  it("adds kind, and its index, with tree.kind", async () => {
    const entity = (await load(group({ tree: { kind: true } }))).registry.get("CustomerGroup");
    expect(entity.fields.find((f) => f.fieldname === "kind")).toMatchObject({ fieldtype: "Data", required: true });
    expect(entity.indexes?.map((i) => i.name)).toContain("idx_tree_kind");
  });

  it("adds the fields of the app menu, and reads its nodes by their roles", async () => {
    const entity = (await load(group({ name: "UserMenu", tree: { menu: "app" } }))).registry.get("UserMenu");
    expect(shapeOf(entity).slice(6)).toEqual([
      ["target_entity", "Data", null, false],
      ["target_url", "Data", null, false],
      ["filter_json", "JSON", null, false],
      ["roles", "JSON", null, false],
    ]);
    expect(entity.role_visibility_field).toBe("roles");
  });

  it("adds the fields of the website menu", async () => {
    const entity = (await load(group({ name: "WebMenu", tree: { menu: "website" } }))).registry.get("WebMenu");
    expect(shapeOf(entity).slice(6)).toEqual([
      ["site", "Link", "WebSite", true],
      ["location", "Select", null, true],
      ["page", "Link", "WebPage", false],
      ["href", "Data", null, false],
    ]);
  });

  it("keeps a block field the entity writes with the block's shape, under its own label", async () => {
    const own = { fieldname: "label", fieldtype: "Data", label: "Group name", required: true };
    const { registry } = await load(group({ fields: [own] }));
    const entity = registry.get("CustomerGroup");
    expect(entity.fields.filter((f) => f.fieldname === "label")).toEqual([expect.objectContaining({ label: "Group name" })]);
    expect(entity.fields.find((f) => f.fieldname === "label")?.translatable).toBe(true);
    expect(registry.getTranslatableFields("CustomerGroup")).toContain("label");
  });

  it("preserves the block's semantics on stored custom-caption fields", async () => {
    const stored = group({
      fields: [
        { fieldname: "label", fieldtype: "Data", label: "Stored caption", required: true, translatable: false },
        { fieldname: "active", fieldtype: "Check", label: "Available" },
      ],
    });
    const db = { find: vi.fn(async () => [stored]) } as unknown as MongoDBService;
    const registry = new EntityRegistry();
    await registry.loadFromDb(db);
    expect(registry.getTranslatableFields("CustomerGroup")).toContain("label");
    expect(registry.get("CustomerGroup").fields.find((f) => f.fieldname === "active"))
      .toMatchObject({ label: "Available", default: 1 });
  });

  it("refuses a field of another shape under a block field's name, naming the entity and the field", async () => {
    const { error } = await load(group({ fields: [{ fieldname: "parent", fieldtype: "Data", label: "Parent" }] }));
    expect(error?.message).toContain('entity "CustomerGroup": the field "parent" takes the name of a field the tree block brings, with another fieldtype and target');
  });

  it("refuses a second app menu in one app, naming both", async () => {
    const { error } = await load(group({ name: "MenuA", tree: { menu: "app" } }), group({ name: "MenuB", tree: { menu: "app" } }));
    expect(error?.message).toContain('entities "MenuA" and "MenuB" are both drawn by the app menu');
  });

  it("PLANTED INNOCENT: loads an app menu beside a website menu", async () => {
    const { error } = await load(group({ name: "MenuA", tree: { menu: "app" } }), group({ name: "MenuB", tree: { menu: "website" } }));
    expect(error).toBeUndefined();
  });

  it("passes a stored definition read back unchanged, and gives a stored one the block it lacks", async () => {
    const { registry } = await load(group({ tree: { kind: true } }));
    const stored = JSON.parse(JSON.stringify(registry.get("CustomerGroup"))) as EntityDefinition;
    const bare = { ...group({ name: "OldGroup" }), fields: [{ fieldname: "discount", fieldtype: "Float", label: "Discount" }] };
    const db = { find: vi.fn(async () => [JSON.parse(JSON.stringify(stored)), bare]) } as unknown as MongoDBService;
    const fresh = new EntityRegistry();
    await fresh.loadFromDb(db);
    expect(fresh.get("CustomerGroup").fields).toEqual(stored.fields);
    expect(fresh.get("CustomerGroup").indexes).toEqual(stored.indexes);
    expect(fresh.get("OldGroup").fields.map((f) => f.fieldname)).toEqual(["discount", "label", "parent", "position", "icon", "active"]);
  });

  it("leaves out a stored definition whose field clashes with the block, and goes on", async () => {
    const clash = { ...group({ name: "Clash" }), fields: [{ fieldname: "position", fieldtype: "Data", label: "Position" }] };
    const db = { find: vi.fn(async () => [clash, group({ name: "Fine" })]) } as unknown as MongoDBService;
    const fresh = new EntityRegistry();
    await fresh.loadFromDb(db);
    expect([fresh.has("Clash"), fresh.has("Fine")]).toEqual([false, true]);
  });
});
