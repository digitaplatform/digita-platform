import { describe, it, expect, vi, beforeEach } from "vitest";

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

import type { EntityDefinition } from "@digitaplatform/shared";
import {
  PeriodCloseValidator,
  PeriodClosedError,
  NoMatchingPeriodError,
  AmbiguousPeriodError,
  DateOutsidePeriodError,
} from "../src/core/period/period-close-validator.js";

const journalEntity = (override: Partial<EntityDefinition> = {}): EntityDefinition => ({
  name: "journalEntry",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [
    { fieldname: "posting_date", fieldtype: "Date", label: "Posting Date" },
    { fieldname: "fiscal_period", fieldtype: "Link", label: "Period", target: "fiscalPeriod" },
  ],
  permissions: [],
  period_check: {
    date_field: "posting_date",
    period_entity: "fiscalPeriod",
    period_field: "fiscal_period",
    block_on: ["submit"],
  },
  ...override,
}) as unknown as EntityDefinition;

const fiscalPeriodEntity = (override: Partial<EntityDefinition> = {}): EntityDefinition => ({
  name: "fiscalPeriod",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [
    { fieldname: "start_date", fieldtype: "Date", label: "Start" },
    { fieldname: "end_date", fieldtype: "Date", label: "End" },
    { fieldname: "is_closed", fieldtype: "Check", label: "Closed" },
    { fieldname: "fiscal_year", fieldtype: "Link", label: "Year", target: "fiscalYear" },
  ],
  permissions: [],
  ...override,
}) as unknown as EntityDefinition;

const fiscalYearEntity = (): EntityDefinition => ({
  name: "fiscalYear",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [
    { fieldname: "start_date", fieldtype: "Date", label: "Start" },
    { fieldname: "end_date", fieldtype: "Date", label: "End" },
    { fieldname: "is_closed", fieldtype: "Check", label: "Closed" },
  ],
  permissions: [],
} as unknown as EntityDefinition);

function makeRegistry(byName: Record<string, EntityDefinition>) {
  return {
    has: (n: string) => n in byName,
    get: (n: string) => {
      const e = byName[n];
      if (!e) throw new Error(`unknown entity ${n}`);
      return e;
    },
  } as never;
}

interface DbState {
  byId?: Record<string, Record<string, unknown>>;
  byDate?: Record<string, Record<string, unknown>>;
  /** Multiple periods covering a date → exercises AmbiguousPeriodError (A3). */
  byDateMany?: Record<string, Record<string, unknown>[]>;
}

function dateKeyOf(filter: Record<string, unknown>): string | null {
  const orBranches = (filter as { $or?: Array<Record<string, unknown>> }).$or;
  const candidates = orBranches ?? [filter];
  for (const c of candidates) {
    const start = (c as { start_date?: { $lte?: Date | string } })["start_date"]?.$lte;
    if (!start) continue;
    return (start instanceof Date ? start : new Date(String(start))).toISOString().slice(0, 10);
  }
  return null;
}

function makeDb(state: DbState = {}): {
  findOne: ReturnType<typeof vi.fn>;
  findOneByFilter: ReturnType<typeof vi.fn>;
  findManyByFilter: ReturnType<typeof vi.fn>;
} {
  return {
    findOne: vi.fn((_coll: string, id: string) => Promise.resolve(state.byId?.[id] ?? null)),
    findOneByFilter: vi.fn((_coll: string, filter: Record<string, unknown>) => {
      const key = dateKeyOf(filter);
      return Promise.resolve((key && state.byDate?.[key]) ?? null);
    }),
    findManyByFilter: vi.fn((_coll: string, filter: Record<string, unknown>) => {
      const key = dateKeyOf(filter);
      if (key && state.byDateMany?.[key]) return Promise.resolve(state.byDateMany[key]);
      const hit = key ? state.byDate?.[key] : undefined;
      return Promise.resolve(hit ? [hit] : []);
    }),
  };
}

describe("PeriodCloseValidator — direct period_field lookup", () => {
  let validator: PeriodCloseValidator;
  beforeEach(() => {
    const registry = makeRegistry({
      journalEntry: journalEntity(),
      fiscalPeriod: fiscalPeriodEntity(),
    });
    const db = makeDb({
      byId: {
        "FP-OPEN": { _id: "FP-OPEN", is_closed: false },
        "FP-CLOSED": { _id: "FP-CLOSED", is_closed: true },
      },
    });
    validator = new PeriodCloseValidator(registry, db as never);
  });

  it("passes when the linked period is open", async () => {
    await expect(
      validator.assertPeriodOpen(journalEntity(), { fiscal_period: "FP-OPEN" }, "submit"),
    ).resolves.toBeUndefined();
  });

  it("throws PeriodClosedError when the linked period is closed", async () => {
    await expect(
      validator.assertPeriodOpen(journalEntity(), { fiscal_period: "FP-CLOSED" }, "submit"),
    ).rejects.toBeInstanceOf(PeriodClosedError);
  });

  it("ignores phases that are not in block_on (default = submit only)", async () => {
    // block_on defaults to ["submit"] when omitted; "update" should pass.
    const noBlockEntity = journalEntity({ period_check: {
      date_field: "posting_date",
      period_entity: "fiscalPeriod",
      period_field: "fiscal_period",
    } });
    await expect(
      validator.assertPeriodOpen(noBlockEntity, { fiscal_period: "FP-CLOSED" }, "update"),
    ).resolves.toBeUndefined();
    await expect(
      validator.assertPeriodOpen(noBlockEntity, { fiscal_period: "FP-CLOSED" }, "submit"),
    ).rejects.toBeInstanceOf(PeriodClosedError);
  });
});

describe("PeriodCloseValidator — by-date lookup", () => {
  it("finds period by date range when period_field is absent", async () => {
    const entity = journalEntity({
      period_check: { date_field: "posting_date", period_entity: "fiscalPeriod", block_on: ["submit"] },
    });
    const registry = makeRegistry({ journalEntry: entity, fiscalPeriod: fiscalPeriodEntity() });
    const db = makeDb({ byDate: { "2026-04-15": { _id: "FP-Q2", is_closed: true } } });
    const v = new PeriodCloseValidator(registry, db as never);
    await expect(
      v.assertPeriodOpen(entity, { posting_date: "2026-04-15" }, "submit"),
    ).rejects.toBeInstanceOf(PeriodClosedError);
  });

  it("throws NoMatchingPeriodError when no period covers the date", async () => {
    const entity = journalEntity({
      period_check: { date_field: "posting_date", period_entity: "fiscalPeriod", block_on: ["submit"] },
    });
    const registry = makeRegistry({ journalEntry: entity, fiscalPeriod: fiscalPeriodEntity() });
    const db = makeDb();
    const v = new PeriodCloseValidator(registry, db as never);
    await expect(
      v.assertPeriodOpen(entity, { posting_date: "2026-04-15" }, "submit"),
    ).rejects.toBeInstanceOf(NoMatchingPeriodError);
  });

  it("throws AmbiguousPeriodError when MULTIPLE periods cover the date (A3)", async () => {
    const entity = journalEntity({
      period_check: { date_field: "posting_date", period_entity: "fiscalPeriod", block_on: ["submit"] },
    });
    const registry = makeRegistry({ journalEntry: entity, fiscalPeriod: fiscalPeriodEntity() });
    const db = makeDb({
      byDateMany: { "2026-04-15": [{ _id: "FP-A", is_closed: false }, { _id: "FP-B", is_closed: false }] },
    });
    const v = new PeriodCloseValidator(registry, db as never);
    await expect(
      v.assertPeriodOpen(entity, { posting_date: "2026-04-15" }, "submit"),
    ).rejects.toBeInstanceOf(AmbiguousPeriodError);
  });
});

describe("PeriodCloseValidator — cache freshness + date-range (audit 369/376)", () => {
  const registry = makeRegistry({
    journalEntry: journalEntity(),
    fiscalPeriod: fiscalPeriodEntity(),
  });

  it("re-reads is_closed live so a period closed within the cache TTL is not bypassed (369)", async () => {
    const state: DbState = { byId: { "FP-X": { _id: "FP-X", is_closed: false } } };
    const db = makeDb(state);
    const v = new PeriodCloseValidator(registry, db as never);
    // Open → passes AND caches the open doc.
    await expect(
      v.assertPeriodOpen(journalEntity(), { fiscal_period: "FP-X" }, "submit"),
    ).resolves.toBeUndefined();
    // Period gets closed within the cache window.
    state.byId!["FP-X"]!["is_closed"] = true;
    // Must now be blocked despite the still-cached open doc.
    await expect(
      v.assertPeriodOpen(journalEntity(), { fiscal_period: "FP-X" }, "submit"),
    ).rejects.toThrow(PeriodClosedError);
  });

  it("throws DateOutsidePeriodError when the doc date is outside its referenced period (376)", async () => {
    const state: DbState = {
      byId: {
        "FP-Q2": { _id: "FP-Q2", is_closed: false, start_date: "2026-04-01", end_date: "2026-06-30" },
      },
    };
    const db = makeDb(state);
    const v = new PeriodCloseValidator(registry, db as never);
    await expect(
      v.assertPeriodOpen(
        journalEntity(),
        { fiscal_period: "FP-Q2", posting_date: "2026-01-15" },
        "submit",
      ),
    ).rejects.toThrow(DateOutsidePeriodError);
  });

  it("accepts a Datetime date_field on the period's LAST day (day-granularity boundary)", async () => {
    const state: DbState = {
      byId: {
        "FP-Q2": { _id: "FP-Q2", is_closed: false, start_date: "2026-04-01", end_date: "2026-06-30" },
      },
    };
    const db = makeDb(state);
    const v = new PeriodCloseValidator(registry, db as never);
    // 2026-06-30T14:30 carries a time-of-day: a raw timestamp compare against the
    // date-only end_date (parsed to 00:00) used to reject it as DateOutsidePeriod.
    await expect(
      v.assertPeriodOpen(
        journalEntity(),
        { fiscal_period: "FP-Q2", posting_date: "2026-06-30T14:30:00.000Z" },
        "submit",
      ),
    ).resolves.toBeUndefined();
    // Lower bound: a time-of-day on the FIRST day must also pass.
    await expect(
      v.assertPeriodOpen(
        journalEntity(),
        { fiscal_period: "FP-Q2", posting_date: "2026-04-01T09:00:00.000Z" },
        "submit",
      ),
    ).resolves.toBeUndefined();
  });
});

describe("PeriodCloseValidator — fiscal-year cascade", () => {
  it("treats an open period in a closed parent year as closed", async () => {
    const period = fiscalPeriodEntity({
      period_check: {
        date_field: "start_date",
        period_entity: "fiscalYear",
        period_field: "fiscal_year",
        block_on: ["submit"],
      },
    });
    const registry = makeRegistry({
      journalEntry: journalEntity(),
      fiscalPeriod: period,
      fiscalYear: fiscalYearEntity(),
    });
    const db = makeDb({
      byId: {
        "FP-OPEN": { _id: "FP-OPEN", is_closed: false, fiscal_year: "FY-CLOSED" },
        "FY-CLOSED": { _id: "FY-CLOSED", is_closed: true },
      },
    });
    const v = new PeriodCloseValidator(registry, db as never);
    await expect(
      v.assertPeriodOpen(journalEntity(), { fiscal_period: "FP-OPEN" }, "submit"),
    ).rejects.toBeInstanceOf(PeriodClosedError);
  });
});

describe("PeriodCloseValidator — cache", () => {
  it("caches the period resolution but re-reads is_closed live each check (369)", async () => {
    const registry = makeRegistry({
      journalEntry: journalEntity(),
      fiscalPeriod: fiscalPeriodEntity(),
    });
    const db = makeDb({
      byId: { "FP-OPEN": { _id: "FP-OPEN", is_closed: false } },
    });
    const v = new PeriodCloseValidator(registry, db as never);
    await v.assertPeriodOpen(journalEntity(), { fiscal_period: "FP-OPEN" }, "submit"); // resolve + live
    await v.assertPeriodOpen(journalEntity(), { fiscal_period: "FP-OPEN" }, "submit"); // cached resolve + live
    // Call 2 skips the resolution (cached), but the close-flag is re-read live every
    // check (the 369 anti-bypass), so 3 findOne total — never fewer than one per check.
    expect(db.findOne).toHaveBeenCalledTimes(3);
    expect(v.cacheSize()).toBe(1);
  });
});

describe("PeriodCloseValidator — silent skip", () => {
  it("returns without checking when period_check is absent", async () => {
    const entity = { ...journalEntity(), period_check: undefined };
    const registry = makeRegistry({ journalEntry: entity, fiscalPeriod: fiscalPeriodEntity() });
    const db = makeDb();
    const v = new PeriodCloseValidator(registry, db as never);
    await expect(
      v.assertPeriodOpen(entity, { fiscal_period: "anything" }, "submit"),
    ).resolves.toBeUndefined();
    expect(db.findOne).not.toHaveBeenCalled();
  });
});
