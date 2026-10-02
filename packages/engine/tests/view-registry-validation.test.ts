// A stored View row reaches the view runner only when it passes the checks a View file passes at
// load: a row an Administrator saved, or one that overrides a file, is judged the same way.
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import type { ViewDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import { ViewRegistry } from "../src/core/view/view-registry.js";

/** An unanchored view of one list section with `limit`. */
const listView = (id: string, limit: number) =>
  ({ _id: id, name: id, anchored: false, sections: [{ key: "rows", kind: "list", entity: "Book", limit }] }) as unknown as ViewDefinition;
const unionView = (id: string) =>
  ({
    _id: id, name: id, anchored: false,
    sections: [{ key: "x", kind: "aggregate", entity: "Book", pipeline: [{ $unionWith: { coll: "secrets" } }] }],
  }) as unknown as ViewDefinition;
const storedRows = (rows: ViewDefinition[]) => ({ find: async () => rows }) as unknown as MongoDBService;

describe("a stored View row", () => {
  it("PLANTED DEFECT: is not served when it fails the checks, a list without a limit or a $unionWith", async () => {
    const registry = new ViewRegistry();
    await registry.loadFromDb(storedRows([listView("no-limit", 0), unionView("union")]));
    expect([registry.has("no-limit"), registry.has("union")]).toEqual([false, false]);
  });

  it("leaves its file version in force when it fails the checks", async () => {
    const registry = new ViewRegistry();
    registry.cacheFileVersion(listView("books", 20));
    await registry.loadFromDb(storedRows([listView("books", 0)]));
    expect((registry.get("books").sections[0] as { limit?: number }).limit).toBe(20);
  });

  it("PLANTED INNOCENT: is served when it passes them", async () => {
    const registry = new ViewRegistry();
    await registry.loadFromDb(storedRows([listView("books", 50)]));
    expect((registry.get("books").sections[0] as { limit?: number }).limit).toBe(50);
  });
});
