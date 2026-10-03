import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1,
    MONGODB_MAX_POOL: 5,
    MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users",
    MONGODB_LOGS_DB: "test_logs",
    MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin",
    MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { createReplicaFixture, type ReplicaFixture } from "./cloud-mongo.js";
import { DIGITA } from "@digitaplatform/shared";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { dropGlobalSearchTextIndexOnce } from "../src/core/database/global-search-text-index.js";
import { env } from "../src/core/config/env.js";

const CORE = DIGITA.DATABASES.CORE;

let replSet: ReplicaFixture;
let db: MongoDBService;

beforeAll(async () => {
  replSet = await createReplicaFixture({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

// A field's in_global_search built the text index idx_global_search, which no query read. The key
// is gone, so the index leaves every collection that has it, once per database.
describe("dropGlobalSearchTextIndexOnce", () => {
  const entity = (name: string) => ({ name, database: "app" }) as unknown as EntityDefinition;

  it("drops the index where it stands, keeps every other index, passes a collection that does not exist, and records the run", async () => {
    const books = db.collection("Book", "app");
    await books.createIndex({ title: "text" }, { name: "idx_global_search" });
    await books.createIndex({ isbn: 1 }, { name: "idx_isbn" });
    await db.collection("Author", "app").createIndex({ name: 1 }, { name: "idx_name" });

    await dropGlobalSearchTextIndexOnce(db, [entity("Book"), entity("Author"), entity("NeverWritten")]);

    expect((await books.indexes()).map((i) => i.name).sort()).toEqual(["_id_", "idx_isbn"]);
    expect(await db.findOne("_migrations", "drop-global-search-text-index", CORE)).toMatchObject({ dropped: ["Book"] });

    // An index built after the run, by an engine still on an older release, is no reason to run again.
    await books.createIndex({ title: "text" }, { name: "idx_global_search" });
    await dropGlobalSearchTextIndexOnce(db, [entity("Book")]);
    expect((await books.indexes()).map((i) => i.name)).toContain("idx_global_search");
  });
});
