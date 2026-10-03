import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a",
    MONGODB_APP_DB_PREFIX: "test",
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

async function loadEntity(json: Record<string, unknown>): Promise<EntityRegistry> {
  const dir = await mkdtemp(join(tmpdir(), "period-check-"));
  await writeFile(join(dir, "x.entity.json"), JSON.stringify(json));
  const r = new EntityRegistry();
  try {
    await r.loadAll(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return r;
}

/** The message a refused period_check stops the load with, naming the entity and the fault. */
const refusal = (fault: string) =>
  `period_check of entity "journalEntry" is invalid: ${fault}`;

const baseJournal = (override: Record<string, unknown>) => ({
  name: "journalEntry",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [
    { fieldname: "posting_date", fieldtype: "Date", label: "Posting Date", idx: 1 },
    { fieldname: "fiscal_period", fieldtype: "Link", label: "Period", target: "fiscalPeriod", idx: 2 },
    { fieldname: "amount", fieldtype: "Currency", label: "Amount", idx: 3 },
  ],
  permissions: [],
  ...override,
});

describe("entity-registry — period_check validation", () => {
  it("accepts a valid period_check with period_field link", async () => {
    const r = await loadEntity(
      baseJournal({
        period_check: {
          date_field: "posting_date",
          period_entity: "fiscalPeriod",
          period_field: "fiscal_period",
        },
      }),
    );
    expect(r.get("journalEntry").period_check).toBeDefined();
  });

  it("refuses the load when date_field is missing", async () => {
    await expect(
      loadEntity(baseJournal({ period_check: { period_entity: "fiscalPeriod" } })),
    ).rejects.toThrow(refusal("date_field required"));
  });

  it("refuses the load when date_field is not Date/Datetime", async () => {
    await expect(
      loadEntity(baseJournal({ period_check: { date_field: "amount", period_entity: "fiscalPeriod" } })),
    ).rejects.toThrow(refusal("date_field must be Date/Datetime (got Currency)"));
  });

  it("refuses the load when period_field is not a Link", async () => {
    await expect(
      loadEntity(
        baseJournal({
          period_check: { date_field: "posting_date", period_entity: "fiscalPeriod", period_field: "amount" },
        }),
      ),
    ).rejects.toThrow(refusal("period_field must be Link (got Currency)"));
  });

  it("refuses the load when block_on contains an unknown phase or is no list", async () => {
    await expect(
      loadEntity(
        baseJournal({
          period_check: { date_field: "posting_date", period_entity: "fiscalPeriod", block_on: ["submit", "explode"] },
        }),
      ),
    ).rejects.toThrow(refusal("block_on contains unknown phases: explode"));
    await expect(
      loadEntity(
        baseJournal({ period_check: { date_field: "posting_date", period_entity: "fiscalPeriod", block_on: "submit" } }),
      ),
    ).rejects.toThrow(refusal("block_on must be a list of phases"));
  });

  it("keeps require_period: false", async () => {
    const r = await loadEntity(
      baseJournal({
        period_check: { date_field: "posting_date", period_entity: "fiscalPeriod", require_period: false },
      }),
    );
    expect(r.get("journalEntry").period_check?.require_period).toBe(false);
  });

  it("refuses the load when require_period is not a boolean", async () => {
    await expect(
      loadEntity(
        baseJournal({
          period_check: { date_field: "posting_date", period_entity: "fiscalPeriod", require_period: "false" },
        }),
      ),
    ).rejects.toThrow(refusal("require_period must be a boolean"));
  });


});
