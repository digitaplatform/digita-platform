import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

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
    TRANSLATION_SOURCE: "file",
    TRANSLATION_FALLBACK_LOCALE: "en",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { seedAppData } from "../src/core/setup/seed-app-data.js";
import type { NamingService } from "../src/core/document/naming-service.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;

const targetEntity = (): EntityDefinition =>
  ({
    name: "SnapTarget",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields: [{ fieldname: "name", fieldtype: "Data", label: "Name" }],
    permissions: [],
  }) as unknown as EntityDefinition;

const docEntity = (): EntityDefinition =>
  ({
    name: "SnapDoc",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    is_submittable: true,
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title" },
      {
        fieldname: "target",
        fieldtype: "Link",
        label: "Target",
        target: "SnapTarget",
        freeze: { flatten: [{ from: "name", as: "target_name_at_doc" }] },
      },
    ],
    permissions: [],
  }) as unknown as EntityDefinition;

// Same freeze, but `system` naming: the seed row carries NO explicit _id, so the
// engine mints a native ObjectId into __seedId. This is the COMMON real-world case
// (SalesInvoice, PurchaseInvoice, … all use system naming) and the one Pass 5 used
// to silently skip because it only looked at a string row["_id"].
const sysDocEntity = (): EntityDefinition =>
  ({
    name: "SnapSysDoc",
    module: "test",
    database: "app",
    naming: { strategy: "system" },
    is_submittable: true,
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title" },
      {
        fieldname: "target",
        fieldtype: "Link",
        label: "Target",
        target: "SnapTarget",
        freeze: { flatten: [{ from: "name", as: "target_name_at_doc" }] },
      },
    ],
    permissions: [],
  }) as unknown as EntityDefinition;

function registry(): EntityRegistry {
  const reg = new EntityRegistry();
  reg.register(targetEntity());
  reg.register(docEntity());
  reg.register(sysDocEntity());
  return reg;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("seedAppData — Pass 5 seals snapshot/freeze on seeded submitted docs (A3)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "digita-seed-snap-"));
    await db.ensureCollection("SnapTarget", "app");
    await db.ensureCollection("SnapDoc", "app");
    await db.ensureCollection("SnapSysDoc", "app");
    await db.deleteMany("SnapTarget", {}, "app");
    await db.deleteMany("SnapDoc", {}, "app");
    await db.deleteMany("SnapSysDoc", {}, "app");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("populates the freeze-flatten field on a docstatus:1 seed row; leaves a draft untouched", async () => {
    await writeFile(join(dir, "SnapTarget.seed.json"), JSON.stringify([{ _id: "T1", name: "Acme GmbH" }]), "utf-8");
    await writeFile(
      join(dir, "SnapDoc.seed.json"),
      JSON.stringify([
        { _id: "D1", docstatus: 1, title: "submitted", target: "T1" },
        { _id: "D2", docstatus: 0, title: "draft", target: "T1" },
      ]),
      "utf-8",
    );

    await seedAppData(db, registry(), {} as NamingService, [dir]);

    const submitted = await db.findOne("SnapDoc", "D1", "app");
    expect(submitted?.["target_name_at_doc"]).toBe("Acme GmbH"); // sealed by Pass 5
    expect(submitted?.["target_snapshot"]).toBeTruthy(); // the freeze sub-object

    const draft = await db.findOne("SnapDoc", "D2", "app");
    expect(draft?.["target_name_at_doc"]).toBeUndefined(); // drafts seal at their real submit
  });

  it("seals freeze fields on a `system`-named submitted seed row (no explicit _id)", async () => {
    await writeFile(join(dir, "SnapTarget.seed.json"), JSON.stringify([{ _id: "T1", name: "Acme GmbH" }]), "utf-8");
    // No _id → the engine mints an ObjectId into __seedId. Before the fix, Pass 5
    // skipped this row (row["_id"] was undefined) and the freeze field stayed blank.
    await writeFile(
      join(dir, "SnapSysDoc.seed.json"),
      JSON.stringify([{ docstatus: 1, title: "sys-submitted", target: "T1" }]),
      "utf-8",
    );

    await seedAppData(db, registry(), {} as NamingService, [dir]);

    const rows = await db.find("SnapSysDoc", {}, "app");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["target_name_at_doc"]).toBe("Acme GmbH"); // sealed by Pass 5 despite ObjectId _id
    expect(rows[0]?.["target_snapshot"]).toBeTruthy();
  });

  it("a dangling reference in ONE submitted seed row is skipped (warn), not fatal — valid rows still seal", async () => {
    await writeFile(join(dir, "SnapTarget.seed.json"), JSON.stringify([{ _id: "T1", name: "Acme GmbH" }]), "utf-8");
    // Second row points at a target that does not exist — a real submit would reject
    // it, but a demo reseed must not abort wholesale (mirrors the live JournalEntry.
    // lines.account → missing Account case that surfaced once Pass 5 stopped skipping
    // system-named entities).
    await writeFile(
      join(dir, "SnapSysDoc.seed.json"),
      JSON.stringify([
        { docstatus: 1, title: "good", target: "T1" },
        { docstatus: 1, title: "dangling", target: "DOES-NOT-EXIST" },
      ]),
      "utf-8",
    );

    await expect(seedAppData(db, registry(), {} as NamingService, [dir])).resolves.not.toThrow();

    const rows = await db.find("SnapSysDoc", {}, "app");
    const good = rows.find((r) => r["title"] === "good");
    const bad = rows.find((r) => r["title"] === "dangling");
    expect(good?.["target_name_at_doc"]).toBe("Acme GmbH"); // valid row sealed
    expect(bad?.["target_name_at_doc"]).toBeUndefined(); // dangling row skipped, not sealed, no throw
  });
});
