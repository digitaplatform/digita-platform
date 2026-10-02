import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

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

import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { NamingService } from "../src/core/document/naming-service.js";
import { seedAppData } from "../src/core/setup/seed-app-data.js";

// A demo tier seeds documents with their own ids under an `expression` naming. The first new
// document after the seed takes the number after the highest seeded one, with no skipped candidate.
const YEAR = String(new Date().getFullYear());
const entity = (name: string, expression: string): EntityDefinition =>
  ({
    name,
    module: "test",
    database: "app",
    naming: { strategy: "expression", expression },
    fields: [{ fieldname: "branch", fieldtype: "Data", label: "Branch" }],
    permissions: [],
  }) as unknown as EntityDefinition;

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let registry: EntityRegistry;
let naming: NamingService;
let dir: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection("_sequences", "app");
  registry = new EntityRegistry();
  naming = new NamingService(db);
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "seed-expression-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seed(def: EntityDefinition, ids: string[], extra: (i: number) => Record<string, unknown> = () => ({})) {
  registry.register(def);
  await db.ensureCollection(def.name, "app");
  await writeFile(join(dir, `${def.name}.seed.json`), JSON.stringify(ids.map((_id, i) => ({ _id, ...extra(i) }))));
  await seedAppData(db, registry, naming, [dir]);
}

const counter = async (sequence: string) =>
  ((await db.findOne("_sequences", sequence, "app")) as Record<string, unknown> | null)?.["naming_seq"];

const numbered = (from: number, to: number, format: (n: number) => string) =>
  Array.from({ length: to - from + 1 }, (_, i) => format(from + i));

describe("the naming counter of an expression after a seed", () => {
  it("gives the first new document the number after the highest seeded one", async () => {
    const def = entity("SeedWorkOrder", "WO-{YYYY}-{#####}");
    await seed(def, numbered(1, 400, (n) => `WO-${YEAR}-${String(n).padStart(5, "0")}`));
    // The seed itself moved the counter, so the insert finds 401 free at once instead of walking 400.
    expect(await counter("SeedWorkOrder")).toBe(400);
    expect(await naming.generateId(def, {})).toBe(`WO-${YEAR}-00401`);
  });

  it("lets a new document follow more than 2000 seeded ids of one series", async () => {
    const def = entity("SeedQuote", "Q-{#####}");
    await seed(def, numbered(1, 2100, (n) => `Q-${String(n).padStart(5, "0")}`));
    expect(await naming.generateId(def, {})).toBe("Q-02101");
  });

  it("moves each series counter of a series-bound expression", async () => {
    const def = entity("SeedInvoice", "INV-{####:branch}");
    await seed(def, ["INV-ZH-0007", "INV-ZH-0003", "INV-BE-0012"], (i) => ({ branch: ["ZH", "ZH", "BE"][i] }));
    expect(await naming.generateId(def, { branch: "ZH" })).toBe("INV-ZH-0008");
    expect(await naming.generateId(def, { branch: "BE" })).toBe("INV-BE-0013");
  });

  it("leaves the counter alone for a seeded id the expression could not have made", async () => {
    const def = entity("SeedLegacy", "L-{###}");
    await seed(def, ["LEGACY-900", "L-abc"]);
    expect(await naming.generateId(def, {})).toBe("L-001");
  });
});
