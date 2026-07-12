import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => {
  return { env: { MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test" } };
});
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { NamingService } from "../src/core/document/naming-service.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let namingService: NamingService;

function makeEntity(overrides: Partial<EntityDefinition> = {}): EntityDefinition {
  return {
    name: "TestEntity",
    module: "test",
    database: "app",
    naming: { strategy: "auto_increment" },
    fields: [],
    permissions: [],
    ...overrides,
  } as EntityDefinition;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection("_sequences", "app");
  namingService = new NamingService(db);
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("NamingService Integration", () => {
  // ── auto_increment strategy ──────────────────────────────

  describe("auto_increment strategy", () => {
    it("generates padded sequential IDs with default pad_length of 5", async () => {
      const entity = makeEntity({
        name: "AutoInc_Default",
        naming: { strategy: "auto_increment" },
      });
      await db.ensureCollection("_sequences", "app");

      const id1 = await namingService.generateId(entity, {});
      const id2 = await namingService.generateId(entity, {});
      const id3 = await namingService.generateId(entity, {});

      expect(id1).toBe("00001");
      expect(id2).toBe("00002");
      expect(id3).toBe("00003");
    });

    it("generates IDs with custom prefix and pad_length", async () => {
      const entity = makeEntity({
        name: "AutoInc_Custom",
        naming: { strategy: "auto_increment", prefix: "INV-", pad_length: 4 },
      });

      const id1 = await namingService.generateId(entity, {});
      const id2 = await namingService.generateId(entity, {});

      expect(id1).toBe("INV-0001");
      expect(id2).toBe("INV-0002");
    });

    it("sequences are isolated per entity name", async () => {
      const entityA = makeEntity({
        name: "AutoInc_IsoA",
        naming: { strategy: "auto_increment", prefix: "A-", pad_length: 3 },
      });
      const entityB = makeEntity({
        name: "AutoInc_IsoB",
        naming: { strategy: "auto_increment", prefix: "B-", pad_length: 3 },
      });

      const a1 = await namingService.generateId(entityA, {});
      const b1 = await namingService.generateId(entityB, {});
      const a2 = await namingService.generateId(entityA, {});
      const b2 = await namingService.generateId(entityB, {});

      expect(a1).toBe("A-001");
      expect(a2).toBe("A-002");
      expect(b1).toBe("B-001");
      expect(b2).toBe("B-002");
    });
  });

  // ── uuid strategy ────────────────────────────────────────

  describe("uuid strategy", () => {
    it("generates valid UUID v4 strings", async () => {
      const entity = makeEntity({
        name: "UuidEntity",
        naming: { strategy: "uuid" },
      });

      const id = await namingService.generateId(entity, {});
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("generates unique IDs each time", async () => {
      const entity = makeEntity({
        name: "UuidEntity2",
        naming: { strategy: "uuid" },
      });

      const id1 = await namingService.generateId(entity, {});
      const id2 = await namingService.generateId(entity, {});
      expect(id1).not.toBe(id2);
    });
  });

  // ── by_field strategy ────────────────────────────────────

  describe("by_field strategy", () => {
    it("uses specified field value as ID", async () => {
      const entity = makeEntity({
        name: "ByFieldEntity",
        naming: { strategy: "by_field", field: "slug" },
      });

      const id = await namingService.generateId(entity, { slug: "my-document" });
      expect(id).toBe("my-document");
    });

    it("throws when field is missing in naming config", async () => {
      const entity = makeEntity({
        name: "ByFieldNoConfig",
        naming: { strategy: "by_field" },
      });

      await expect(namingService.generateId(entity, { slug: "test" }))
        .rejects.toThrow(/requires "field"/);
    });

    it("throws when field value is empty in data", async () => {
      const entity = makeEntity({
        name: "ByFieldEmpty",
        naming: { strategy: "by_field", field: "slug" },
      });

      await expect(namingService.generateId(entity, {}))
        .rejects.toThrow(/is required for naming/);
    });
  });

  // ── expression strategy ──────────────────────────────────

  describe("expression strategy", () => {
    it("evaluates expression with date tokens and sequence", async () => {
      const entity = makeEntity({
        name: "ExprEntity",
        naming: { strategy: "expression", expression: "INV-{YYYY}-{####}" },
      });

      const id = await namingService.generateId(entity, {});
      const year = new Date().getFullYear();
      expect(id).toMatch(new RegExp(`^INV-${year}-\\d{4}$`));
    });

    it("evaluates expression with field tokens", async () => {
      const entity = makeEntity({
        name: "ExprFieldEntity",
        naming: { strategy: "expression", expression: "{department}-{YYYY}-{###}" },
      });

      const id = await namingService.generateId(entity, { department: "HR" });
      const year = new Date().getFullYear();
      expect(id).toMatch(new RegExp(`^HR-${year}-\\d{3}$`));
    });

    it("throws when expression is missing", async () => {
      const entity = makeEntity({
        name: "ExprMissing",
        naming: { strategy: "expression" },
      });

      await expect(namingService.generateId(entity, {}))
        .rejects.toThrow(/requires "expression"/);
    });
  });

  // ── user_set strategy ────────────────────────────────────

  describe("user_set strategy", () => {
    it("uses _id from data as the document name", async () => {
      const entity = makeEntity({
        name: "UserSetEntity",
        naming: { strategy: "user_set" },
      });

      const id = await namingService.generateId(entity, { _id: "my-custom-id" });
      expect(id).toBe("my-custom-id");
    });

    it("throws when _id is not provided", async () => {
      const entity = makeEntity({
        name: "UserSetNoId",
        naming: { strategy: "user_set" },
      });

      await expect(namingService.generateId(entity, {}))
        .rejects.toThrow(/Name \(_id\) is required/);
    });
  });

  // ── generateSeries: series-token field validation ────────

  describe("generateSeries series-token field validation", () => {
    it("throws a typed NamingSeriesFieldEmptyError (not a raw Error) when a series token field is empty", async () => {
      const entity = makeEntity({
        name: "SeriesDoc",
        business_key: "code",
        business_key_series: "SO-{#####:period_label}",
        fields: [{ fieldname: "period_label", fieldtype: "Data", label: "Period" }],
      });

      await expect(
        namingService.generateSeries(entity, "SO-{####:period_label}", {
          /* period_label empty */
        }),
      ).rejects.toMatchObject({
        name: "NamingSeriesFieldEmptyError",
        field: "period_label",
        entity: "SeriesDoc",
      });
    });
  });

  // ── self-heal on sequence drift ───────────────────────────
  //
  // schema-migrator.ts `initializeSequence` only creates the `_sequences`
  // counter if absent, starting at 0 — it is never re-synced against
  // documents that already exist (seeded/imported data, or a partial reset
  // that recreated the counter but not the collection). These tests
  // reproduce that drift directly: pre-insert documents under the keys the
  // counter's next values would produce, then assert naming skips past them
  // instead of handing out a key that already exists.

  describe("self-heal on sequence drift", () => {
    it("auto_increment: skips business keys already occupied by pre-existing documents", async () => {
      const entity = makeEntity({
        name: "SelfHeal_AutoInc",
        naming: { strategy: "auto_increment", pad_length: 5 },
      });

      // Simulate drift: documents "00001".."00003" already exist (e.g. from
      // a seed/import) while the `_sequences` counter for this entity is
      // still at its fresh initial value (0 — no prior generateId call).
      await db.insertOne(entity.name, { _id: "00001" }, "app");
      await db.insertOne(entity.name, { _id: "00002" }, "app");
      await db.insertOne(entity.name, { _id: "00003" }, "app");

      const id1 = await namingService.generateId(entity, {});
      expect(id1).toBe("00004");
      // Without the self-heal, id1 would be "00001" and this insert would
      // throw a duplicate-key error (E11000) against the pre-existing doc —
      // exactly the failure mode described in the bug report.
      await db.insertOne(entity.name, { _id: id1 as string }, "app");

      // Continuity: the counter is left correctly advanced for next time.
      const id2 = await namingService.generateId(entity, {});
      expect(id2).toBe("00005");
      await db.insertOne(entity.name, { _id: id2 as string }, "app");
    });

    it("expression bare {####}: skips occupied _id values the same way", async () => {
      const entity = makeEntity({
        name: "SelfHeal_ExprBare",
        naming: { strategy: "expression", expression: "DOC-{####}" },
      });

      await db.insertOne(entity.name, { _id: "DOC-0001" }, "app");

      const id1 = await namingService.generateId(entity, {});
      expect(id1).toBe("DOC-0002");
      await db.insertOne(entity.name, { _id: id1 as string }, "app");
    });

    it("generateSeries: skips occupied business_key values (a non-_id field)", async () => {
      const entity = makeEntity({
        name: "SelfHeal_Series",
        naming: { strategy: "system" },
        business_key: "code",
        business_key_series: "REC-{#####:period_label}",
        fields: [{ fieldname: "period_label", fieldtype: "Data", label: "Period" }],
      });
      // The business key lives in `code`, not `_id` — enforce uniqueness on
      // it the way a real entity schema would, so a collision would
      // genuinely throw a duplicate-key error pre-fix.
      await db.createIndex(entity.name, { code: 1 }, "app", { unique: true });

      await db.insertOne(entity.name, { _id: "doc-a", code: "REC-2026-00001" }, "app");
      await db.insertOne(entity.name, { _id: "doc-b", code: "REC-2026-00002" }, "app");

      const code1 = await namingService.generateSeries(
        entity,
        "REC-{#####:period_label}",
        { period_label: "2026" },
      );
      expect(code1).toBe("REC-2026-00003");
      await db.insertOne(entity.name, { _id: "doc-c", code: code1 }, "app");

      // Continuity for the same partition.
      const code2 = await namingService.generateSeries(
        entity,
        "REC-{#####:period_label}",
        { period_label: "2026" },
      );
      expect(code2).toBe("REC-2026-00004");
      await db.insertOne(entity.name, { _id: "doc-d", code: code2 }, "app");
    });

    it("common path (no collision) still does exactly one getNextSequence + one existence check", async () => {
      const entity = makeEntity({
        name: "SelfHeal_NoCollision",
        naming: { strategy: "auto_increment", pad_length: 5 },
      });

      const getNextSequenceSpy = vi.spyOn(db, "getNextSequence");
      const existsByFieldSpy = vi.spyOn(db, "existsByField");

      const id1 = await namingService.generateId(entity, {});
      expect(id1).toBe("00001");
      expect(getNextSequenceSpy).toHaveBeenCalledTimes(1);
      expect(existsByFieldSpy).toHaveBeenCalledTimes(1);

      getNextSequenceSpy.mockRestore();
      existsByFieldSpy.mockRestore();
    });
  });

});
