import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a", MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// A broken expression falls back at run time to its safe default without a word: a required
// field on every save, a locked field, a refused move. The entity file is refused instead.
describe("an entity file whose expression does not parse", () => {
  it("is refused, naming the file, the place and the parser's message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reg-expression-"));
    const file = join(dir, "Book.entity.json");
    await writeFile(file, JSON.stringify({
      name: "Book", module: "test", database: "app", naming: { strategy: "user_set" },
      fields: [
        { fieldname: "kind", fieldtype: "Data", label: "Kind" },
        { fieldname: "reason", fieldtype: "Data", label: "Reason", mandatory_depends_on: "eval:doc.kind ==" },
      ],
      permissions: [],
    }));
    const error = await new EntityRegistry().loadAll(dir).then(() => undefined, (e: unknown) => e as Error);
    await rm(dir, { recursive: true, force: true });
    expect(error?.message).toContain(file);
    expect(error?.message).toContain("reason.mandatory_depends_on does not parse (unexpected end of expression");
  });
});

describe("expression validation at definition boundaries", () => {
  const definition = (extra: Record<string, unknown> = {}): EntityDefinition => ({
    name: "Book", module: "test", database: "app", naming: { strategy: "user_set" },
    fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
    permissions: [], ...extra,
  } as unknown as EntityDefinition);

  it.each([1, 0, false, null, {}, []].map((value) => [value]))("PLANTED DEFECT: refuses a non-string permission condition %j", (condition) => {
    expect(() => new EntityRegistry().prepareDefinition(definition({
      permissions: [{ role: "Clerk", level: 0, read: 1, condition }],
    }))).toThrow('permissions[0].condition must be a string');
  });

  it.each([
    [{ fieldname: "reason", fieldtype: "Data", label: "Reason", read_only_depends_on: "doc.locked ==" }, "reason.read_only_depends_on"],
    [{ fieldname: "lines", fieldtype: "Table", label: "Lines", child_fields: [{ fieldname: "qty", fieldtype: "Int", label: "Qty", mandatory_depends_on: "doc.need ==" }] }, "lines.qty.mandatory_depends_on"],
  ])("PLANTED DEFECT: checks an action dialog's expression %j", (field, place) => {
    expect(() => new EntityRegistry().prepareDefinition(definition({
      actions: [{ action: "lend", label: "Lend", opens_dialog: true, dialog_fields: [field] }],
    }))).toThrow(`action lend ${place} does not parse`);
  });

  it("PLANTED DEFECT: skips a malformed stored expression without replacing the file definition", async () => {
    const registry = new EntityRegistry();
    const file = definition();
    registry.register(file);
    const invalid = definition({ fields: [{ fieldname: "reason", fieldtype: "Data", label: "Reason", mandatory_depends_on: "doc.kind ==" }] });
    const valid = { ...definition(), name: "Shelf" };
    const db = { find: vi.fn().mockResolvedValue([invalid, valid]) } as unknown as MongoDBService;
    await registry.loadFromDb(db);
    expect(registry.get("Book")).toBe(file);
    expect(registry.get("Shelf")).toBe(valid);
    const noFile = new EntityRegistry();
    await noFile.loadFromDb(db);
    expect(noFile.has("Book")).toBe(false);
    expect(noFile.has("Shelf")).toBe(true);
  });

  it("PLANTED INNOCENT: accepts valid dialog expressions, omitted and empty conditions, and stored definitions", async () => {
    const valid = definition({
      actions: [{ action: "lend", label: "Lend", opens_dialog: true, dialog_fields: [{ fieldname: "reason", fieldtype: "Data", label: "Reason", read_only_depends_on: "eval:doc.locked == 1" }] }],
      permissions: [{ role: "Clerk", level: 0, read: 1 }, { role: "Reader", level: 0, read: 1, condition: "" }],
    });
    const registry = new EntityRegistry();
    expect(() => registry.prepareDefinition(valid)).not.toThrow();
    await registry.loadFromDb({ find: vi.fn().mockResolvedValue([valid]) } as unknown as MongoDBService);
    expect(registry.get("Book")).toBe(valid);
  });
});
