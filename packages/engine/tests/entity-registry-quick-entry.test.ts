import { describe, it, expect, expectTypeOf, vi } from "vitest";

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
import type { EntityDefinition } from "@digitaplatform/shared";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";

/**
 * No screen opens a quick entry dialog, so an author who set allow_quick_entry and
 * quick_entry_fields waited for a dialog that never came. The definition offers neither key,
 * and the registry hands the app no quick entry flag of its own.
 */
describe("quick entry", () => {
  it("is no key of an entity definition", () => {
    expectTypeOf<EntityDefinition>().not.toHaveProperty("allow_quick_entry");
    expectTypeOf<EntityDefinition>().not.toHaveProperty("quick_entry_fields");
  });

  it("is no flag the registry sets on a loaded entity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quick-entry-"));
    try {
      await writeFile(
        join(dir, "book.entity.json"),
        JSON.stringify({
          name: "Book",
          module: "test",
          database: "app",
          naming: { strategy: "user_set" },
          fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
          permissions: [],
        }),
      );
      const registry = new EntityRegistry();
      await registry.loadAll(dir);
      expect(registry.get("Book")).not.toHaveProperty("allow_quick_entry");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
