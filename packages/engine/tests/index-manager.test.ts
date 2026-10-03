import { describe, it, expect, vi } from "vitest";
import { IndexManager } from "../src/core/database/index-manager.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { EntityDefinition } from "@digitaplatform/shared";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

describe("IndexManager — deleted index contract", () => {
  it("creates default idx_deleted on every collection alongside standard indexes", async () => {
    const created: Array<{ collection: string; spec: unknown; db: string; options: unknown }> = [];
    const db = {
      createIndex: vi.fn(async (collection: string, spec: unknown, dbTarget: string, options: unknown) => {
        created.push({ collection, spec, db: dbTarget, options });
      }),
    };

    const entity: EntityDefinition = {
      name: "SimpleDoc",
      module: "test",
      database: "app",
      naming: { strategy: "user_set" },
      fields: [],
    } as unknown as EntityDefinition;

    const manager = new IndexManager(db as unknown as MongoDBService);
    await manager.ensureIndexes(entity);

    const deletedIdx = created.find((c) => (c.options as { name: string })?.name === "idx_deleted");
    expect(deletedIdx).toEqual({
      collection: "SimpleDoc",
      spec: { deleted: 1 },
      db: "app",
      options: { name: "idx_deleted" },
    });
  });

  it("pruneOrphanIndexes preserves declared idx_deleted and drops undeclared index", async () => {
    const dropped: string[] = [];
    const mockCollection = {
      indexes: vi.fn(async () => [
        { name: "_id_" },
        { name: "idx_creation" },
        { name: "idx_modified" },
        { name: "idx_owner" },
        { name: "idx_deleted" },
        { name: "idx_legacy_orphan" },
      ]),
      dropIndex: vi.fn(async (name: string) => {
        dropped.push(name);
      }),
    };

    const db = {
      collection: vi.fn(() => mockCollection),
    };

    const entity: EntityDefinition = {
      name: "PruneDoc",
      module: "test",
      database: "app",
      naming: { strategy: "user_set" },
      fields: [],
    } as unknown as EntityDefinition;

    const manager = new IndexManager(db as unknown as MongoDBService);
    const result = await manager.pruneOrphanIndexes(entity);

    expect(result).toEqual(["idx_legacy_orphan"]);
    expect(dropped).toEqual(["idx_legacy_orphan"]);
    expect(mockCollection.dropIndex).not.toHaveBeenCalledWith("idx_deleted");
    expect(mockCollection.dropIndex).not.toHaveBeenCalledWith("_id_");
  });
});
