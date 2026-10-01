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
import { fileURLToPath } from "url";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";

const CORE_ENTITIES = fileURLToPath(new URL("../src/entities", import.meta.url));

const data = (fieldname: string) => ({ fieldname, fieldtype: "Data", label: fieldname });
const link = (fieldname: string, target: string) => ({ fieldname, fieldtype: "Link", label: fieldname, target });
const table = (fieldname: string, ...childFields: unknown[]) => ({
  fieldname,
  fieldtype: "Table",
  label: fieldname,
  child_fields: childFields,
});
const entity = (name: string, ...fields: unknown[]) => ({
  name,
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [data("title"), ...fields],
  permissions: [],
});

// The way createApp loads: the engine's own entities first, then one pass per app directory.
async function loadAs(...appDirs: Array<Array<{ name: string }>>): Promise<EntityRegistry> {
  const registry = new EntityRegistry();
  await registry.loadAll(CORE_ENTITIES);
  for (const entities of appDirs) {
    const dir = await mkdtemp(join(tmpdir(), "reg-link-targets-"));
    for (const e of entities) await writeFile(join(dir, `${e.name}.entity.json`), JSON.stringify(e));
    await registry.loadAll(dir);
    await rm(dir, { recursive: true, force: true });
  }
  return registry;
}

describe("a Link whose target no entity directory loaded", () => {
  it("PLANTED DEFECT: names the entity, the field and the target of every one, top level and in a Table", async () => {
    const registry = await loadAs(
      [entity("Book", link("author", "Autor"), table("copies", link("holder", "Reader"))), entity("Shelf")],
      [entity("Author"), entity("Loan", link("book", "Book"), link("reader", "Role"))],
    );
    let message = "";
    try {
      registry.assertLinkTargetsLoaded();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('Book.author links to "Autor", which no loaded entity has');
    expect(message).toContain('Book.copies.holder links to "Reader", which no loaded entity has');
    expect(message).not.toContain("Loan");
  });

  it("offers the nearest loaded entity for a typo, as the 404 of a save does", async () => {
    const registry = await loadAs([entity("Book", link("author", "Autor")), entity("Author")]);
    expect(() => registry.assertLinkTargetsLoaded()).toThrow('did you mean "Author"?');
  });

  it("PLANTED INNOCENT: passes a Link to an entity of another directory, to a core entity and to itself", async () => {
    const registry = await loadAs(
      [entity("Book", link("series", "Book"), table("copies", link("shelf", "Shelf")))],
      [entity("Shelf", link("curator", "Role")), entity("Loan", link("book", "Book"), link("file", "File"))],
    );
    expect(() => registry.assertLinkTargetsLoaded()).not.toThrow();
  });

  it("passes the engine's own entities", async () => {
    const registry = await loadAs();
    expect(() => registry.assertLinkTargetsLoaded()).not.toThrow();
  });
});
