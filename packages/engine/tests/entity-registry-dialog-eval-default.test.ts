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

// The app seeds an action dialog without `eval:` defaults, which read a document being saved, and the
// engine runs the action with the params as sent: such a default would reach the hook as no value.
const entity = (dialogDefault: string) => ({
  name: "Shipment",
  module: "test",
  database: "app",
  naming: { strategy: "uuid" },
  fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
  permissions: [],
  actions: [
    {
      action: "reschedule",
      label: "Reschedule",
      dialog_fields: [{ fieldname: "new_date", fieldtype: "Date", label: "New date", default: dialogDefault }],
    },
  ],
});

async function load(dialogDefault: string): Promise<{ registry: EntityRegistry; error: Error | undefined; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "reg-dialog-eval-"));
  const file = join(dir, "Shipment.entity.json");
  await writeFile(file, JSON.stringify(entity(dialogDefault)));
  const registry = new EntityRegistry();
  const error = await registry.loadAll(dir).then(() => undefined, (e: unknown) => e as Error);
  await rm(dir, { recursive: true, force: true });
  return { registry, error, file };
}

describe("an eval: default on an action dialog field", () => {
  it("is refused at load, naming the file, the action and the field", async () => {
    const { error, file } = await load("eval:doc.planned_date");
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain(file);
    expect(error!.message).toContain('"reschedule"');
    expect(error!.message).toContain('"new_date"');
    expect(error!.message).toContain("eval:");
  });

  it("loads a dialog field with a token default", async () => {
    const { registry, error } = await load("__today__");
    expect(error).toBeUndefined();
    expect(registry.get("Shipment").actions?.[0]?.dialog_fields?.[0]?.default).toBe("__today__");
  });
});
