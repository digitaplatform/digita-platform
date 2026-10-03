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
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { createReplicaFixture, type ReplicaFixture } from "./cloud-mongo.js";
import { DIGITA } from "@digitaplatform/shared";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { clearSeededDensityOnce, seedBrandingSettings } from "../src/core/setup/seed-branding-settings.js";
import { env } from "../src/core/config/env.js";

const BRANDING = DIGITA.COLLECTIONS.BRANDING_SETTING;
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

beforeEach(async () => {
  await db.deleteMany(BRANDING, {}, CORE);
  await db.deleteMany("_migrations", {}, CORE);
});

const density = async () => (await db.findOne(BRANDING, "branding", CORE))?.["density"];

// The seed wrote `density: "comfortable"` into every tenant's branding, a value nobody chose. Once
// the tenant's density applies to everyone without their own, it must not stand in for a choice.
describe("the tenant's density", () => {
  it("a new tenant's branding holds no density", async () => {
    await seedBrandingSettings(db);
    expect(await density()).toBeUndefined();
  });

  it("the seeded comfortable is cleared once, and a density set afterwards stays", async () => {
    await db.insertOne(BRANDING, { _id: "branding", docstatus: 0, density: "comfortable" }, CORE);
    await clearSeededDensityOnce(db);
    expect(await density()).toBeNull();

    await db.updateOne(BRANDING, "branding", { density: "comfortable" }, CORE);
    await clearSeededDensityOnce(db);
    expect(await density()).toBe("comfortable");
  });

  it("a density an Administrator set other than the seeded one stays", async () => {
    await db.insertOne(BRANDING, { _id: "branding", docstatus: 0, density: "compact" }, CORE);
    await clearSeededDensityOnce(db);
    expect(await density()).toBe("compact");
  });
});
