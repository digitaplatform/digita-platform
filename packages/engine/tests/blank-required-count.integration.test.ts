import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test",
    ENTITIES_DIR: "", APP_DIRS: [],
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { DIGITA } from "@digitaplatform/shared";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { countBlankRequired, countBlankRequiredInApp } from "../src/core/setup/blank-required-count.js";

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

describe("blank means what the save refuses", () => {
  const cases = {
    name: "BlankCase",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields: [
      { fieldname: "text", fieldtype: "Data", label: "Text", required: true },
      { fieldname: "rating", fieldtype: "Rating", label: "Rating", required: true },
      { fieldname: "tags", fieldtype: "Tag", label: "Tags", required: true },
      { fieldname: "check", fieldtype: "Check", label: "Check", required: true },
      { fieldname: "details", fieldtype: "SectionBreak", label: "Details", required: true },
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        child_fields: [
          { fieldname: "item", fieldtype: "Data", label: "Item", required: true },
          { fieldname: "memo", fieldtype: "Data", label: "Memo" },
        ],
      },
    ],
    permissions: [],
  } as unknown as EntityDefinition;

  beforeAll(async () => {
    for (const row of [
      { _id: "B-1", text: "\u00a0", rating: "0", tags: [""], check: 0, lines: [{ item: "a", memo: "" }] },
      { _id: "B-2", text: null, rating: 0, tags: ["a"], check: false, lines: [{ item: "\u3000" }] },
      { _id: "B-3", rating: 0.5, tags: ["b"], check: true, lines: [] },
      { _id: "B-4", text: "ok", rating: 3, tags: ["c"], check: true, lines: [{ item: "b" }] },
    ]) {
      await db.insertOne("BlankCase", row as never, "app");
    }
  });

  it("counts a Unicode space, a stored null, a missing key, a Rating of \"0\" and an unticked Check; never a Tag holding one empty string", async () => {
    expect(await countBlankRequired(db, [cases])).toEqual([
      { database: "app", entity: "BlankCase", field: "text", documents: 3 },
      { database: "app", entity: "BlankCase", field: "rating", documents: 2 },
      { database: "app", entity: "BlankCase", field: "tags", documents: 0 },
      { database: "app", entity: "BlankCase", field: "check", documents: 2 },
      { database: "app", entity: "BlankCase", field: "lines.item", documents: 1 },
    ]);
  });

  it("counts past a document that holds no Table at all", async () => {
    await db.insertOne("BlankCase", { _id: "B-5", text: "ok", rating: 3, tags: ["d"], check: true } as never, "app");
    const counts = await countBlankRequired(db, [cases]);
    expect(counts.find((c) => c.field === "lines.item")?.documents).toBe(1);
    await db.deleteOne("BlankCase", "B-5", "app");
  });

  it("skips a virtual entity", async () => {
    const virtual = { ...cases, name: "BlankCase", is_virtual: true } as EntityDefinition;
    expect(await countBlankRequired(db, [virtual])).toEqual([]);
  });
});

describe("the count of the app the engine runs", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "count-app-"));
    const app = join(root, "shopapp");
    const entity = (name: string, database?: string) => JSON.stringify({
      name, module: "test", database, naming: { strategy: "user_set" },
      fields: [{ fieldname: "title", fieldtype: "Data", label: "Title", required: true }], permissions: [],
    });
    await mkdir(join(root, "core"), { recursive: true });
    await mkdir(join(app, "entities"), { recursive: true });
    await mkdir(join(app, "sales", "entities"), { recursive: true });
    await writeFile(join(app, "entities", "AppThing.entity.json"), entity("AppThing", "app"));
    await writeFile(join(app, "sales", "entities", "SalesThing.entity.json"), entity("SalesThing"));
    Object.assign(env, { ENTITIES_DIR: join(root, "core"), APP_DIRS: [app] });
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("counts an entity /meta created at run time, which only the database holds", async () => {
    await db.insertOne(
      DIGITA.COLLECTIONS.ENTITY,
      {
        _id: "RunTimeThing", name: "RunTimeThing", module: "test", database: "app", naming: { strategy: "user_set" },
        fields: [{ fieldname: "title", fieldtype: "Data", label: "Title", required: true }], permissions: [],
      },
      DIGITA.DATABASES.CORE,
    );
    expect(await countBlankRequiredInApp(db)).toContainEqual({ database: "app", entity: "RunTimeThing", field: "title", documents: 0 });
  });

  it("counts the entities of the app's files and of its domains, as the boot loads them", async () => {
    const counts = await countBlankRequiredInApp(db);
    expect(counts).toContainEqual({ database: "app", entity: "AppThing", field: "title", documents: 0 });
    expect(counts).toContainEqual({ database: `${basename(join(root, "shopapp"))}_sales`, entity: "SalesThing", field: "title", documents: 0 });
  });
});
