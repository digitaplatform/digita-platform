import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a", MONGODB_APP_DB_PREFIX: "test",
  },
}));
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { LAYOUT_FIELD_TYPES, STORED_FIELD_TYPES } from "@digitaplatform/shared";

const okEntity = (name: string) => ({
  name,
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
  permissions: [],
});

beforeEach(() => warn.mockClear());

describe("EntityRegistry load errors + duplicates (A13)", () => {
  it("FAILS BOOT on a malformed .entity.json (was silently skipped)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reg-load-"));
    await writeFile(join(dir, "broken.entity.json"), "{ this is not valid json ");
    const registry = new EntityRegistry();
    await expect(registry.loadAll(dir)).rejects.toThrow(/^Malformed entity definition .*broken\.entity\.json: /);
    await rm(dir, { recursive: true, force: true });
  });

  it("calls a well-formed file a check refuses refused, naming the entity and the key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reg-refused-"));
    const file = join(dir, "book.entity.json");
    await writeFile(file, JSON.stringify({ ...okEntity("Book"), hooks: { on_list_load: "x" } }));
    const err = await new EntityRegistry().loadAll(dir).then(() => undefined, (e: Error) => e);
    expect(err?.message.startsWith(`Refused entity definition ${file} (entity "Book"): `)).toBe(true);
    expect(err?.message).toContain("hooks.on_list_load");
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ["null", "null", "the file holds null, not an entity object"],
    ["a list", "[]", "the file holds a list, not an entity object"],
    ["a number", "5", "the file holds a number, not an entity object"],
    ["an object without a name", "{}", "the entity has no name"],
    ["a definition without fields", JSON.stringify({ name: "Book", module: "test" }), 'entity "Book" has no fields list'],
  ])("refuses a file that holds %s, naming the file and the reason", async (_what, content, reason) => {
    const dir = await mkdtemp(join(tmpdir(), "reg-shape-"));
    const file = join(dir, "book.entity.json");
    await writeFile(file, content);
    const err = await new EntityRegistry().loadAll(dir).then(() => undefined, (e: Error) => e);
    expect(err?.message).toBe(`Refused entity definition ${file}: ${reason}`);
    await rm(dir, { recursive: true, force: true });
  });

  it("WARNS when a name is redefined from a different file (later wins, override still works)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reg-dup-"));
    await writeFile(join(dir, "a.entity.json"), JSON.stringify({ ...okEntity("Dup"), module: "core" }));
    await writeFile(join(dir, "b.entity.json"), JSON.stringify({ ...okEntity("Dup"), module: "app" }));
    const registry = new EntityRegistry();
    await registry.loadAll(dir);
    // The redefinition is surfaced (no longer silent) …
    expect(
      warn.mock.calls.some((c) => JSON.stringify(c).includes("redefined by a later file")),
    ).toBe(true);
    // … and the later definition still wins (intentional app-over-core override preserved).
    expect(registry.get("Dup").module).toBe("app");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("EntityRegistry refuses an unknown fieldtype at load", () => {
  const loadBook = async (book: Record<string, unknown>): Promise<Error | undefined> => {
    const dir = await mkdtemp(join(tmpdir(), "reg-fieldtype-"));
    await writeFile(join(dir, "book.entity.json"), JSON.stringify({ ...okEntity("Book"), ...book }));
    const err = await new EntityRegistry().loadAll(dir).then(() => undefined, (e: Error) => e);
    await rm(dir, { recursive: true, force: true });
    return err;
  };
  const txet = { fieldname: "title", fieldtype: "Txet", label: "Title" };

  it("refuses it on a field, naming the field and the type", async () => {
    expect((await loadBook({ fields: [txet] }))?.message).toContain('Field "title" of entity "Book" has the unknown fieldtype "Txet"');
  });

  it("refuses it on a Table row field", async () => {
    const lines = { fieldname: "lines", fieldtype: "Table", label: "Lines", child_fields: [txet] };
    expect((await loadBook({ fields: [lines] }))?.message).toContain('Field "title" of Table "Book.lines" has the unknown fieldtype "Txet"');
  });

  it("refuses it on an action's dialog field", async () => {
    const actions = [{ action: "lend", label: "Lend", dialog_fields: [txet] }];
    expect((await loadBook({ actions }))?.message).toContain('Field "title" of action "lend" of entity "Book" has the unknown fieldtype "Txet"');
  });

  it("refuses ReadOnly, a type that is gone: a read-only field is a typed field with read_only", async () => {
    const total = { fieldname: "total", fieldtype: "ReadOnly", label: "Total" };
    expect((await loadBook({ fields: [total] }))?.message).toContain('Field "total" of entity "Book" has the unknown fieldtype "ReadOnly"');
    expect(await loadBook({ fields: [{ ...total, fieldtype: "Currency", read_only: true }] })).toBeUndefined();
  });

  it("PLANTED INNOCENT: loads a file with every valid type", async () => {
    const fields = [...STORED_FIELD_TYPES, ...LAYOUT_FIELD_TYPES].map((fieldtype, i) => ({
      fieldname: `f${i}`,
      fieldtype,
      label: fieldtype,
      ...(fieldtype === "Table" ? { child_fields: [{ fieldname: "note", fieldtype: "Data", label: "Note" }] } : {}),
      ...(fieldtype === "Select" ? { options: ["a", "b"] } : {}),
      ...(fieldtype === "Link" ? { target: "Book" } : {}),
    }));
    expect(await loadBook({ fields })).toBeUndefined();
  });
});

describe("EntityRegistry refuses a field regex that does not compile at load", () => {
  const loadBook = async (fields: Record<string, unknown>[]): Promise<Error | undefined> => {
    const dir = await mkdtemp(join(tmpdir(), "reg-regex-"));
    await writeFile(join(dir, "book.entity.json"), JSON.stringify({ ...okEntity("Book"), fields }));
    const err = await new EntityRegistry().loadAll(dir).then(() => undefined, (e: Error) => e);
    await rm(dir, { recursive: true, force: true });
    return err;
  };

  it("refuses it on a field, naming the entity, the field and the pattern", async () => {
    const err = await loadBook([{ fieldname: "code", fieldtype: "Data", label: "Code", regex: "^[A-Z" }]);
    expect(err?.message).toContain('Field "code" of entity "Book" has the regex "^[A-Z", which does not compile');
  });

  it("refuses it on a Table row field", async () => {
    const child = { fieldname: "code", fieldtype: "Data", label: "Code", regex: "(a" };
    const err = await loadBook([{ fieldname: "lines", fieldtype: "Table", label: "Lines", child_fields: [child] }]);
    expect(err?.message).toContain('Field "code" of Table "Book.lines" has the regex "(a", which does not compile');
  });

  it("PLANTED INNOCENT: loads a regex that compiles", async () => {
    expect(await loadBook([{ fieldname: "code", fieldtype: "Data", label: "Code", regex: "^[A-Z]{2,4}$" }])).toBeUndefined();
  });
});
