import { describe, it, expect, vi, beforeEach } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a",
    MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";

beforeEach(() => warn.mockClear());

async function loadEntity(json: Record<string, unknown>): Promise<EntityRegistry> {
  const dir = await mkdtemp(join(tmpdir(), "period-check-"));
  await writeFile(join(dir, "x.entity.json"), JSON.stringify(json));
  const r = new EntityRegistry();
  await r.loadAll(dir);
  await rm(dir, { recursive: true, force: true });
  return r;
}

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

  it("strips when date_field is missing", async () => {
    const r = await loadEntity(
      baseJournal({ period_check: { period_entity: "fiscalPeriod" } }),
    );
    expect(r.get("journalEntry").period_check).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("strips when date_field is not Date/Datetime", async () => {
    const r = await loadEntity(
      baseJournal({
        period_check: { date_field: "amount", period_entity: "fiscalPeriod" },
      }),
    );
    expect(r.get("journalEntry").period_check).toBeUndefined();
  });

  it("strips when period_field is not a Link", async () => {
    const r = await loadEntity(
      baseJournal({
        period_check: {
          date_field: "posting_date",
          period_entity: "fiscalPeriod",
          period_field: "amount",
        },
      }),
    );
    expect(r.get("journalEntry").period_check).toBeUndefined();
  });

  it("strips when block_on contains an unknown phase", async () => {
    const r = await loadEntity(
      baseJournal({
        period_check: {
          date_field: "posting_date",
          period_entity: "fiscalPeriod",
          block_on: ["submit", "explode" as unknown as "submit"],
        },
      }),
    );
    expect(r.get("journalEntry").period_check).toBeUndefined();
  });

  it("strips when entity also declares time_series (mutually exclusive)", async () => {
    const r = await loadEntity(
      baseJournal({
        period_check: { date_field: "posting_date", period_entity: "fiscalPeriod" },
        time_series: { time_field: "posting_date" },
      }),
    );
    expect(r.get("journalEntry").period_check).toBeUndefined();
  });
});
