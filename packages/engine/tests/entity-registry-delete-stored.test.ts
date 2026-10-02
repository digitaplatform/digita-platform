import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a", MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => {
  const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  return { createLogger: () => log, getRootLogger: () => log };
});

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { EntityDefinition } from "@digitaplatform/shared";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { ZodSchemaBuilder } from "../src/core/entity/zod-schema-builder.js";
import { validateEntityDataZod } from "../src/core/entity/entity-validator-zod.js";

const entity = (name: string, label: string) => ({
  name,
  label,
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
  permissions: [],
});

describe("EntityRegistry.deleteStoredDefinition", () => {
  it("answers an entity file's definition again once its stored one is deleted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reg-delete-stored-"));
    await writeFile(join(dir, "Book.entity.json"), JSON.stringify(entity("Book", "Book from file")));
    const registry = new EntityRegistry();
    await registry.loadAll(dir);
    // What loadFromDb or PUT /meta puts in place of the file's definition.
    registry.register(entity("Book", "Book as stored") as unknown as EntityDefinition);

    expect(registry.deleteStoredDefinition("Book")?.label).toBe("Book from file");
    expect(registry.get("Book").label).toBe("Book from file");
    await rm(dir, { recursive: true, force: true });
  });

  it("validates a write against the file's definition again, not the deleted one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reg-delete-stored-schema-"));
    const withQty = (fieldtype: string) => ({
      ...entity("Book", "Book"),
      fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }, { fieldname: "qty", fieldtype, label: "Qty" }],
    });
    await writeFile(join(dir, "Book.entity.json"), JSON.stringify(withQty("Int")));
    const registry = new EntityRegistry();
    await registry.loadAll(dir);
    registry.register(withQty("Data") as unknown as EntityDefinition);
    const builder = new ZodSchemaBuilder();
    expect(validateEntityDataZod(registry.get("Book"), { qty: "many" }, builder).valid).toBe(true);

    registry.deleteStoredDefinition("Book");

    expect(validateEntityDataZod(registry.get("Book"), { qty: "many" }, builder).valid).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("stops serving an entity no file defines", () => {
    const registry = new EntityRegistry();
    registry.register(entity("Made", "Made through meta") as unknown as EntityDefinition);

    expect(registry.deleteStoredDefinition("Made")).toBeUndefined();
    expect(registry.has("Made")).toBe(false);
  });
});
