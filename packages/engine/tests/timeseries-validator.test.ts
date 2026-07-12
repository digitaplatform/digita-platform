import { describe, it, expect, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a", MONGODB_APP_DB_PREFIX: "test",
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

async function loadEntity(json: Record<string, unknown>): Promise<EntityRegistry> {
  const dir = await mkdtemp(join(tmpdir(), "ts-validator-"));
  await writeFile(join(dir, "x.entity.json"), JSON.stringify(json));
  const r = new EntityRegistry();
  await r.loadAll(dir);
  await rm(dir, { recursive: true, force: true });
  return r;
}

const base = (override: Record<string, unknown>) => ({
  name: "stockMovement",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment" },
  fields: [
    { fieldname: "posted_at", fieldtype: "Datetime", label: "Posted At", idx: 1 },
    { fieldname: "product", fieldtype: "Link", label: "Product", target: "product", idx: 2 },
  ],
  permissions: [],
  ...override,
});

describe("entity-registry — time_series validation", () => {
  it("accepts a valid time-series config", async () => {
    const r = await loadEntity(
      base({
        time_series: { time_field: "posted_at", meta_field: "product", granularity: "seconds" },
      }),
    );
    expect(r.get("stockMovement").time_series).toBeDefined();
  });

  it("strips when time_field is missing", async () => {
    const r = await loadEntity(
      base({ time_series: { meta_field: "product" } as never }),
    );
    expect(r.get("stockMovement").time_series).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("strips when time_field is not a Datetime/Date", async () => {
    const r = await loadEntity(
      base({ time_series: { time_field: "product" /* a Link */ } }),
    );
    expect(r.get("stockMovement").time_series).toBeUndefined();
  });

  it("strips when meta_field is not declared", async () => {
    const r = await loadEntity(
      base({ time_series: { time_field: "posted_at", meta_field: "phantom" } }),
    );
    expect(r.get("stockMovement").time_series).toBeUndefined();
  });

  it("strips when is_submittable is true", async () => {
    const r = await loadEntity(
      base({
        is_submittable: true,
        time_series: { time_field: "posted_at" },
      }),
    );
    expect(r.get("stockMovement").time_series).toBeUndefined();
  });

  it("strips when track_changes is true", async () => {
    const r = await loadEntity(
      base({
        track_changes: true,
        time_series: { time_field: "posted_at" },
      }),
    );
    expect(r.get("stockMovement").time_series).toBeUndefined();
  });
});
