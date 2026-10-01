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

import type { EntityDefinition } from "@digitaplatform/shared";
import { resolveDefaults } from "../src/core/defaults/default-resolver.js";
import { validateEntityDataZod } from "../src/core/entity/entity-validator-zod.js";
import { ZodSchemaBuilder } from "../src/core/entity/zod-schema-builder.js";

/**
 * The record form sends a new record without a required field whose default is an
 * `eval:` expression, because only the engine can evaluate it. Insert fills the field
 * from the expression before it validates, so the field passes when the expression
 * yields a value and is refused with field_required when it yields nothing.
 */

const loan = {
  name: "Loan",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  permissions: [],
  fields: [
    { fieldname: "branch", fieldtype: "Data", label: "Branch" },
    { fieldname: "desk", fieldtype: "Data", label: "Desk", required: true, default: "eval:doc.branch" },
  ],
} as unknown as EntityDefinition;

function insertErrors(data: Record<string, unknown>): string[][] {
  const filled = resolveDefaults(loan, data, "ann@example.com");
  return validateEntityDataZod(loan, filled, new ZodSchemaBuilder()).errors.map((e) => [e.field, e.message_key]);
}

describe("a required field with an eval: default on insert", () => {
  it("is filled from the expression and passes", () => {
    expect(resolveDefaults(loan, { branch: "Zurich" }, "ann@example.com")["desk"]).toBe("Zurich");
    expect(insertErrors({ branch: "Zurich" })).toEqual([]);
  });

  it("is refused with field_required when the expression yields nothing", () => {
    expect(insertErrors({})).toEqual([["desk", "field_required"]]);
  });
});
