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

import { CancelProtection } from "../src/core/link/cancel-protection.js";

interface IncomingLink {
  entity: string;
  fieldname: string;
  target_path?: string;
}

function makeRegistry(opts: {
  incomingLinks: IncomingLink[];
  entities: Record<string, { is_submittable: boolean; database: string }>;
}) {
  return {
    getIncomingLinks: () => opts.incomingLinks,
    get: (name: string) => {
      const e = opts.entities[name];
      if (!e) throw new Error(`Unknown entity ${name}`);
      return e;
    },
  } as never;
}

describe("CancelProtection", () => {
  it("blocks cancel when a submitted downstream doc references this", async () => {
    const registry = makeRegistry({
      incomingLinks: [{ entity: "SalesDeliveryNote", fieldname: "source_order" }],
      entities: { SalesDeliveryNote: { is_submittable: true, database: "erp_sales" } },
    });
    const count = vi.fn().mockResolvedValue(1);
    const db = { count } as never;
    const cp = new CancelProtection(registry, db);

    const blockers = await cp.check("SalesOrder", "SO-2026-00001");

    expect(blockers).toEqual([
      { entity: "SalesDeliveryNote", fieldname: "source_order", count: 1 },
    ]);
    // The query must filter docstatus=1 — only submitted downstreams block.
    expect(count).toHaveBeenCalledWith(
      "SalesDeliveryNote",
      [{ source_order: "SO-2026-00001", docstatus: 1 }],
      "erp_sales",
      undefined,
    );
  });

  it("returns no blockers when no downstream references exist", async () => {
    const registry = makeRegistry({
      incomingLinks: [{ entity: "SalesDeliveryNote", fieldname: "source_order" }],
      entities: { SalesDeliveryNote: { is_submittable: true, database: "erp_sales" } },
    });
    const db = { count: vi.fn().mockResolvedValue(0) } as never;
    const cp = new CancelProtection(registry, db);

    const blockers = await cp.check("SalesOrder", "SO-2026-00099");

    expect(blockers).toEqual([]);
  });

  it("ignores incoming links from non-submittable entities", async () => {
    // Permission references SalesOrder (e.g. for scope), but cancelling
    // SalesOrder shouldn't be blocked by Permission rules.
    const registry = makeRegistry({
      incomingLinks: [{ entity: "Permission", fieldname: "allow_value" }],
      entities: { Permission: { is_submittable: false, database: "core" } },
    });
    const count = vi.fn();
    const db = { count } as never;
    const cp = new CancelProtection(registry, db);

    const blockers = await cp.check("SalesOrder", "SO-2026-00001");

    expect(blockers).toEqual([]);
    expect(count).not.toHaveBeenCalled();
  });

  it("does not block when downstream docs are draft (docstatus=0)", async () => {
    // Only docstatus=1 references block. db.count is invoked with the
    // docstatus=1 filter — drafts are filtered out at the query level.
    const registry = makeRegistry({
      incomingLinks: [{ entity: "SalesDeliveryNote", fieldname: "source_order" }],
      entities: { SalesDeliveryNote: { is_submittable: true, database: "erp_sales" } },
    });
    const count = vi.fn().mockResolvedValue(0); // simulating: 0 submitted hits
    const db = { count } as never;
    const cp = new CancelProtection(registry, db);

    const blockers = await cp.check("SalesOrder", "SO-2026-00001");

    expect(blockers).toEqual([]);
    expect(count).toHaveBeenCalledWith(
      "SalesDeliveryNote",
      [{ source_order: "SO-2026-00001", docstatus: 1 }],
      "erp_sales",
      undefined,
    );
  });

  it("aggregates blockers from multiple downstream entity types", async () => {
    const registry = makeRegistry({
      incomingLinks: [
        { entity: "SalesDeliveryNote", fieldname: "source_order" },
        { entity: "SalesInvoice", fieldname: "source_order" },
      ],
      entities: {
        SalesDeliveryNote: { is_submittable: true, database: "erp_sales" },
        SalesInvoice: { is_submittable: true, database: "erp_sales" },
      },
    });
    const count = vi
      .fn()
      .mockResolvedValueOnce(2) // 2 DNs
      .mockResolvedValueOnce(1); // 1 Invoice
    const db = { count } as never;
    const cp = new CancelProtection(registry, db);

    const blockers = await cp.check("SalesOrder", "SO-2026-00001");

    expect(blockers).toHaveLength(2);
    expect(blockers).toEqual(
      expect.arrayContaining([
        { entity: "SalesDeliveryNote", fieldname: "source_order", count: 2 },
        { entity: "SalesInvoice", fieldname: "source_order", count: 1 },
      ]),
    );
  });

  it("uses prefix-regex match for sub-row links (target_path)", async () => {
    const registry = makeRegistry({
      incomingLinks: [
        { entity: "SomeSubmittable", fieldname: "addr_link", target_path: "addresses" },
      ],
      entities: { SomeSubmittable: { is_submittable: true, database: "erp_sales" } },
    });
    const count = vi.fn().mockResolvedValue(1);
    const db = { count } as never;
    const cp = new CancelProtection(registry, db);

    await cp.check("Customer", "CUST-000001");

    // Composite link values look like "CUST-000001::row-aaa" — the count
    // query must match by prefix, not equality.
    expect(count).toHaveBeenCalledWith(
      "SomeSubmittable",
      [{ addr_link: { $regex: "^CUST-000001::" }, docstatus: 1 }],
      "erp_sales",
      undefined,
    );
  });

  it("escapes regex metacharacters in the doc id when matching sub-row links", async () => {
    const registry = makeRegistry({
      incomingLinks: [
        { entity: "Foo", fieldname: "ref", target_path: "addresses" },
      ],
      entities: { Foo: { is_submittable: true, database: "erp_sales" } },
    });
    const count = vi.fn().mockResolvedValue(0);
    const db = { count } as never;
    const cp = new CancelProtection(registry, db);

    // An id containing regex metachars (`.`, `+`) must be escaped in the
    // regex so it matches literally, not as a wildcard.
    await cp.check("Customer", "CUST-1.0+x");

    expect(count).toHaveBeenCalledWith(
      "Foo",
      [{ ref: { $regex: "^CUST-1\\.0\\+x::" }, docstatus: 1 }],
      "erp_sales",
      undefined,
    );
  });
});
