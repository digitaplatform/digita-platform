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
import { LinkValidator } from "../src/core/link/link-validator.js";

function customerEntity(): EntityDefinition {
  return {
    name: "customer",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields: [
      {
        fieldname: "addresses",
        fieldtype: "Table",
        label: "Addresses",
        child_fields: [
          { fieldname: "city", fieldtype: "Data", label: "City" },
        ],
      },
    ],
    permissions: [],
  } as unknown as EntityDefinition;
}

function invoiceEntity(): EntityDefinition {
  return {
    name: "salesInvoice",
    module: "test",
    database: "app",
    naming: { strategy: "auto_increment" },
    fields: [
      {
        fieldname: "invoice_address",
        fieldtype: "Link",
        label: "Address",
        target: "customer",
        target_path: "addresses",
      },
    ],
    permissions: [],
  } as unknown as EntityDefinition;
}

const registry = {
  has: (n: string) => n === "customer" || n === "salesInvoice",
  get: (n: string) => (n === "customer" ? customerEntity() : invoiceEntity()),
} as never;

describe("LinkValidator — target_path sub-row Links", () => {
  it("accepts a composite link whose row exists in the target Table", async () => {
    const db = {
      exists: vi.fn(),
      findOne: vi.fn().mockResolvedValue({
        _id: "CUST-1",
        addresses: [
          { _row_id: "row-aaa", city: "Berlin" },
          { _row_id: "row-bbb", city: "Munich" },
        ],
      }),
    } as never;
    const validator = new LinkValidator(registry, db);
    const errs = await validator.validate(invoiceEntity(), {
      invoice_address: "CUST-1::row-bbb",
    });
    expect(errs).toEqual([]);
  });

  it("rejects a malformed composite value", async () => {
    const db = { exists: vi.fn(), findOne: vi.fn() } as never;
    const validator = new LinkValidator(registry, db);
    const errs = await validator.validate(invoiceEntity(), {
      invoice_address: "no-separator",
    });
    expect(errs.length).toBe(1);
    expect(errs[0]!.message_key).toBe("link_subrow_malformed");
  });

  it("rejects when parent doc is missing", async () => {
    const db = {
      exists: vi.fn(),
      findOne: vi.fn().mockResolvedValue(null),
    } as never;
    const validator = new LinkValidator(registry, db);
    const errs = await validator.validate(invoiceEntity(), {
      invoice_address: "CUST-MISSING::row-aaa",
    });
    expect(errs.length).toBe(1);
    expect(errs[0]!.message_key).toBe("link_not_found");
  });

  it("rejects when row id doesn't match any row in target Table", async () => {
    const db = {
      exists: vi.fn(),
      findOne: vi.fn().mockResolvedValue({
        _id: "CUST-1",
        addresses: [{ _row_id: "row-aaa", city: "Berlin" }],
      }),
    } as never;
    const validator = new LinkValidator(registry, db);
    const errs = await validator.validate(invoiceEntity(), {
      invoice_address: "CUST-1::row-zzz",
    });
    expect(errs.length).toBe(1);
    expect(errs[0]!.message_key).toBe("link_subrow_not_found");
  });

  it("rejects when target Table is missing on the parent", async () => {
    const db = {
      exists: vi.fn(),
      findOne: vi.fn().mockResolvedValue({ _id: "CUST-1" /* no addresses field */ }),
    } as never;
    const validator = new LinkValidator(registry, db);
    const errs = await validator.validate(invoiceEntity(), {
      invoice_address: "CUST-1::row-aaa",
    });
    expect(errs.length).toBe(1);
    expect(errs[0]!.message_key).toBe("link_subrow_table_missing");
  });
});
