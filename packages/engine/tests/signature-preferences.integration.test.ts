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
import { removeSignaturePreferencesOnce } from "../src/core/database/signature-preferences.js";
import { env } from "../src/core/config/env.js";

const PREFS = DIGITA.COLLECTIONS.USER_PREFERENCE;
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

// A person's own signature pick was kept as the UserPreference ui.signature; the tenant's look
// replaced it, so the rows are removed once per database and every other preference stays.
describe("removeSignaturePreferencesOnce", () => {
  it("removes every ui.signature preference once, keeps the others, and records the run", async () => {
    await db.insertOne(PREFS, { _id: "p1", owner: "ana@veloluck.test", pref_key: "ui.signature", value: "digita" }, CORE);
    await db.insertOne(PREFS, { _id: "p2", owner: "ben@veloluck.test", pref_key: "ui.signature", value: "veloluck-lakeside" }, CORE);
    await db.insertOne(PREFS, { _id: "p3", owner: "ana@veloluck.test", pref_key: "ui.theme_mode", value: "dark" }, CORE);

    await removeSignaturePreferencesOnce(db);

    expect(await db.findManyByFilter(PREFS, { pref_key: "ui.signature" }, CORE)).toEqual([]);
    expect(await db.findOne(PREFS, "p3", CORE)).toMatchObject({ pref_key: "ui.theme_mode", value: "dark" });
    expect(await db.findOne("_migrations", "remove-signature-preferences", CORE)).toMatchObject({ removed: 2 });

    // A row written after the run, by a page still open on an older app, is no reason to run again.
    await db.insertOne(PREFS, { _id: "p4", owner: "ben@veloluck.test", pref_key: "ui.signature", value: "digita" }, CORE);
    await removeSignaturePreferencesOnce(db);
    expect(await db.findOne(PREFS, "p4", CORE)).not.toBeNull();
  });
});
