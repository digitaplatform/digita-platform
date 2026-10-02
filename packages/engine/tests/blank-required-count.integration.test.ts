import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { countBlankRequired } from "../src/core/setup/blank-required-count.js";

// A stored document with a blank value in a required field is refused by any later update, so the
// count shows where an operator has to fill or report values before such updates meet them.
const order = {
  name: "CountOrder",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
    { fieldname: "approved", fieldtype: "Check", label: "Approved", required: true },
    { fieldname: "note", fieldtype: "Data", label: "Note" },
    { fieldname: "lines", fieldtype: "Table", label: "Lines", child_fields: [{ fieldname: "item", fieldtype: "Data", label: "Item", required: true }] },
  ],
  permissions: [],
} as unknown as EntityDefinition;

let replSet: MongoMemoryReplSet;
let db: MongoDBService;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  for (const row of [
    { _id: "O-1", title: "Full", approved: true, lines: [{ item: "a" }] },
    { _id: "O-2", title: "   ", approved: false, lines: [{ item: "" }, { item: "b" }] },
    { _id: "O-3", approved: true, note: "secret note", lines: [] },
  ]) {
    await db.insertOne("CountOrder", row as never, "app");
  }
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("the count of stored blank values in required fields", () => {
  it("counts per field the documents an update would refuse, rows of a Table included", async () => {
    expect(await countBlankRequired(db, [order])).toEqual([
      { database: "app", entity: "CountOrder", field: "title", documents: 2 },
      { database: "app", entity: "CountOrder", field: "approved", documents: 1 },
      { database: "app", entity: "CountOrder", field: "lines.item", documents: 1 },
    ]);
  });

  it("answers counts and names only, never a stored value", async () => {
    const text = JSON.stringify(await countBlankRequired(db, [order]));
    expect(text).not.toContain("secret note");
    expect(text).not.toContain("Full");
  });
});
