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

async function loadBookWithHooks(hooks: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "reg-hooks-"));
  const file = join(dir, "book.entity.json");
  await writeFile(
    file,
    JSON.stringify({
      name: "Book",
      module: "test",
      database: "app",
      naming: { strategy: "user_set" },
      fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
      hooks,
      permissions: [],
    }),
  );
  const registry = new EntityRegistry();
  const error = await registry.loadAll(dir).then(() => undefined, (e: unknown) => e as Error);
  await rm(dir, { recursive: true, force: true });
  return { registry, file, error };
}

describe("hooks the engine never runs", () => {
  it.each(["has_permission", "on_list_load"])(
    "PLANTED DEFECT: refuses hooks.%s, naming the entity, the key and the file",
    async (key) => {
      const { file, error } = await loadBookWithHooks({ [key]: "book/book.hook" });
      expect(error).toBeInstanceOf(Error);
      expect(error!.message).toContain(file);
      expect(error!.message).toContain('Entity "Book"');
      expect(error!.message).toContain(`hooks.${key}`);
    },
  );

  it("names every such key of one entity at once", async () => {
    const { error } = await loadBookWithHooks({ has_permission: "book/book.mayRead", on_list_load: "book/book.filterList" });
    expect(error!.message).toContain("hooks.has_permission, hooks.on_list_load");
  });

  it("PLANTED INNOCENT: loads an entity whose hooks the engine runs", async () => {
    const hooks = { validate: "book/book.validate", before_save: "book/book.stamp" };
    const { registry, error } = await loadBookWithHooks(hooks);
    expect(error).toBeUndefined();
    expect(registry.get("Book").hooks).toEqual(hooks);
  });
});
