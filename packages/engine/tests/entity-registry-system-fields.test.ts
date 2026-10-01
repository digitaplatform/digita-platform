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

// BaseDocument.toMongo writes the first list on every document, BaseDocument.addChild the second
// on every Table row.
const DOCUMENT_FIELDS = ["_id", "doctype", "docstatus", "owner", "modified_by", "creation", "modified"];
const ROW_FIELDS = ["idx", "_row_id"];

const data = (fieldname: string) => ({ fieldname, fieldtype: "Data", label: fieldname });
const table = (...childNames: string[]) => ({
  fieldname: "services",
  fieldtype: "Table",
  label: "Services",
  child_fields: childNames.map(data),
});

async function loadBike(fields: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), "reg-system-fields-"));
  const file = join(dir, "bike.entity.json");
  await writeFile(
    file,
    JSON.stringify({
      name: "Bike",
      module: "test",
      database: "app",
      naming: { strategy: "user_set" },
      fields,
      permissions: [],
    }),
  );
  const registry = new EntityRegistry();
  const error = await registry.loadAll(dir).then(() => undefined, (e: unknown) => e as Error);
  await rm(dir, { recursive: true, force: true });
  return { registry, file, error };
}

describe("fields named after a system field", () => {
  it.each(DOCUMENT_FIELDS)(
    "PLANTED DEFECT: refuses a top-level field %s, naming the entity, the field and the reserved names",
    async (name) => {
      const { file, error } = await loadBike([data("title"), data(name)]);
      expect(error).toBeInstanceOf(Error);
      expect(error!.message).toContain(file);
      expect(error!.message).toContain(`Field "${name}" of entity "Bike"`);
      expect(error!.message).toContain(`reserved: ${DOCUMENT_FIELDS.join(", ")}`);
    },
  );

  it.each(ROW_FIELDS)(
    "PLANTED DEFECT: refuses the field %s of a Table row, naming the Table, the field and the reserved names",
    async (name) => {
      const { file, error } = await loadBike([data("title"), table("part", name)]);
      expect(error).toBeInstanceOf(Error);
      expect(error!.message).toContain(file);
      expect(error!.message).toContain(`Field "${name}" of Table "Bike.services"`);
      expect(error!.message).toContain(`reserved: ${ROW_FIELDS.join(", ")}`);
    },
  );

  it("PLANTED INNOCENT: loads an entity without such a field", async () => {
    const { registry, error } = await loadBike([data("title"), data("customer"), table("part", "hours")]);
    expect(error).toBeUndefined();
    expect(registry.get("Bike").fields.map((f) => f.fieldname)).toEqual(["title", "customer", "services"]);
  });

  it("PLANTED INNOCENT: loads the names the engine does not write where they stand", async () => {
    // amended_from is declared by apps and only filled by the amend flow; idx is a row field and
    // owner is no row field.
    const { registry, error } = await loadBike([data("amended_from"), data("idx"), table("owner")]);
    expect(error).toBeUndefined();
    expect(registry.get("Bike").fields).toHaveLength(3);
  });
});
