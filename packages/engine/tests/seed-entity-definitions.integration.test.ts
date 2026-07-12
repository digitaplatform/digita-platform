import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_core", MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { seedEntityDefinitions } from "../src/core/setup/seed-entity-definitions.js";
import { DIGITA } from "@digitaplatform/shared";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;

const ENTITY = DIGITA.COLLECTIONS.ENTITY;
const CORE = DIGITA.DATABASES.CORE;

function defWith(fields: string[]): EntityDefinition {
  return {
    name: "WidgetDef",
    module: "test",
    database: "core",
    naming: { strategy: "user_set" },
    fields: fields.map((f) => ({ fieldname: f, fieldtype: "Data", label: f })),
    permissions: [],
  } as unknown as EntityDefinition;
}

function fieldNames(row: Record<string, unknown>): string[] {
  return (row.fields as Array<{ fieldname: string }>).map((f) => f.fieldname);
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("seedEntityDefinitions — file is the source of truth", () => {
  it("re-seeds a changed file definition on every boot (adds new field, drops removed)", async () => {
    const reg = new EntityRegistry();

    // v1 deploy: fields [a, legacy]
    reg.register(defWith(["a", "legacy"]));
    await seedEntityDefinitions(db, reg);
    const v1 = (await db.findOne(ENTITY, "WidgetDef", CORE)) as Record<string, unknown>;
    expect(fieldNames(v1)).toEqual(["a", "legacy"]);
    const creation = v1.creation;

    // v2 deploy: `legacy` removed, `b` added — same name, changed file def.
    reg.register(defWith(["a", "b"]));
    await seedEntityDefinitions(db, reg);
    const v2 = (await db.findOne(ENTITY, "WidgetDef", CORE)) as Record<string, unknown>;

    expect(fieldNames(v2)).toContain("b"); // new file field flows to the DB, no wipe/reload
    expect(fieldNames(v2)).not.toContain("legacy"); // removed file field is dropped (full replace)
    expect(v2.creation).toEqual(creation); // creation preserved across re-seeds
  });
});
