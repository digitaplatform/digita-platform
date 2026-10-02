import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import type { ViewDefinition } from "@digitaplatform/shared";
import { ViewEngine, BadRequestError, ViewNotFoundError } from "../src/core/view/view-engine.js";
import { ResponseContext } from "../src/core/api/response-context.js";
import { PermissionDeniedError } from "../src/core/permissions/permission-checker.js";
import { NotFoundError } from "../src/core/document/document-service.js";
import type { UserContext } from "../src/core/permissions/types.js";

const user: UserContext = { _id: "u1", email: "ada@example.com", roles: ["System User"] };

function makeDeps() {
  const documentService = {
    getDoc: vi.fn(),
    getList: vi.fn(),
  };
  const db = {
    aggregate: vi.fn().mockResolvedValue([]),
  };
  const registry = {
    get: vi.fn().mockReturnValue({
      name: "salesInvoice",
      database: "app",
      permissions: [],
      fields: [],
    }),
    has: vi.fn().mockReturnValue(true),
  };
  const permissionChecker = {
    check: vi.fn().mockResolvedValue(undefined),
    // Default mocks return null (= all fields readable, admin-equivalent)
    // so the new aggregation field-masking layer doesn't block these tests
    // which exercise other concerns.
    getReadableFieldsOnEveryRow: vi.fn().mockReturnValue(null),
    hasConditionalRowRead: vi.fn().mockReturnValue(false),
  };
  return { documentService, db, registry, permissionChecker, tenantTimeZone: () => "UTC" };
}

function makeView(overrides: Partial<ViewDefinition> = {}): ViewDefinition {
  return {
    _id: "v1",
    name: "Test",
    source: { entity: "customer", param: "id" },
    anchored: true,
    params: [{ name: "id", type: "string", required: true }],
    sections: [
      {
        key: "addresses",
        kind: "list",
        entity: "customerAddress",
        filter: [["customer", "=", "$root._id"]],
        limit: 5,
      },
    ],
    ...overrides,
  };
}

describe("ViewEngine — anchored happy path", () => {
  let deps: ReturnType<typeof makeDeps>;
  let exec: ViewEngine;
  beforeEach(() => {
    deps = makeDeps();
    exec = new ViewEngine(deps as never);
  });

  it("loads root and runs each section", async () => {
    deps.documentService.getDoc.mockResolvedValue({ toJSON: () => ({ _id: "CUST-1" }) });
    deps.documentService.getList.mockResolvedValue({
      data: [{ _id: "ADR-1", customer: "CUST-1" }],
      total: 1, page: 1, page_size: 5, total_pages: 1,
    });
    const ctx = new ResponseContext();
    const view = makeView();
    const out = await exec.execute(view, { rootName: "CUST-1", query: {} }, user, ctx);
    expect(out.source).toEqual({ _id: "CUST-1" });
    expect((out.sections["addresses"] as unknown[]).length).toBe(1);
    expect(deps.documentService.getList).toHaveBeenCalledOnce();
    const callArgs = deps.documentService.getList.mock.calls[0]!;
    expect(callArgs[0]).toBe("customerAddress");
    // filter[0][2] should be substituted to root id
    expect(callArgs[1].filters[0]).toEqual(["customer", "=", "CUST-1"]);
  });

  it("refuses to execute a disabled view (enabled:false → not found, no sections run)", async () => {
    const ctx = new ResponseContext();
    const view = makeView({ enabled: false });
    await expect(
      exec.execute(view, { rootName: "CUST-1", query: {} }, user, ctx),
    ).rejects.toThrow(ViewNotFoundError);
    // Short-circuits before touching data.
    expect(deps.documentService.getDoc).not.toHaveBeenCalled();
  });
});

describe("ViewEngine — permission denial in section", () => {
  it("emits a path-tagged warning, returns [] for the section, others succeed", async () => {
    const deps = makeDeps();
    deps.documentService.getDoc.mockResolvedValue({ toJSON: () => ({ _id: "CUST-1" }) });
    // First call (addresses) succeeds, second (recent_invoices) denies.
    deps.documentService.getList
      .mockResolvedValueOnce({ data: [{ _id: "A" }], total: 1, page: 1, page_size: 5, total_pages: 1 })
      .mockRejectedValueOnce(PermissionDeniedError.forAction("salesInvoice", "select"));

    const view = makeView({
      sections: [
        { key: "addresses", kind: "list", entity: "customerAddress",
          filter: [["customer", "=", "$root._id"]] },
        { key: "recent_invoices", kind: "list", entity: "salesInvoice",
          filter: [["customer", "=", "$root._id"]] },
      ],
    });
    const ctx = new ResponseContext();
    const out = await new ViewEngine(deps as never).execute(
      view, { rootName: "CUST-1", query: {} }, user, ctx,
    );
    expect((out.sections["addresses"] as unknown[]).length).toBe(1);
    expect(out.sections["recent_invoices"]).toEqual([]);
    // Only a section that ran names the entity of its rows, so a denied one reveals no entity.
    expect(out.entities).toEqual({ addresses: "customerAddress" });
    const msgs = ctx.getMessages();
    const warn = msgs.find((m) => m.path === "/sections/recent_invoices");
    expect(warn?.code).toBe("omitted_no_permission");
  });
});

describe("ViewEngine — link section whose optional param the request omits", () => {
  const linkView = () =>
    makeView({
      anchored: false,
      source: undefined,
      params: [{ name: "customer", type: "string" }],
      sections: [{ key: "customer", kind: "link", entity: "customer", target: "$param.customer" }],
    });

  it("names no entity to a caller who may not read the section's entity", async () => {
    const deps = makeDeps();
    deps.permissionChecker.check.mockRejectedValue(PermissionDeniedError.forAction("customer", "read"));
    const out = await new ViewEngine(deps as never).execute(linkView(), { query: {} }, user, new ResponseContext());
    expect(out.sections["customer"]).toBeNull();
    expect(out.entities).toEqual({});
    expect(deps.documentService.getDoc).not.toHaveBeenCalled();
  });

  it("names the entity to a caller who may read it, with no row", async () => {
    const deps = makeDeps();
    const out = await new ViewEngine(deps as never).execute(linkView(), { query: {} }, user, new ResponseContext());
    expect(out.sections["customer"]).toBeNull();
    expect(out.entities).toEqual({ customer: "customer" });
  });
});

describe("ViewEngine — link section", () => {
  const linkView = (fields?: string[]) =>
    makeView({
      anchored: false,
      source: undefined,
      params: [{ name: "customer", type: "string" }],
      sections: [
        { key: "customer", kind: "link", entity: "customer", target: "$param.customer", ...(fields ? { fields } : {}) },
      ],
    });
  const row = { _id: "CUST-1", name: "Acme AG", city: "Arth" };

  it("returns the linked row, read as the caller, and names its entity", async () => {
    const deps = makeDeps();
    deps.documentService.getDoc.mockResolvedValue({ toJSON: () => row });
    const ctx = new ResponseContext();
    const out = await new ViewEngine(deps as never).execute(linkView(), { query: { customer: "CUST-1" } }, user, ctx);
    expect(out.sections["customer"]).toEqual(row);
    expect(out.entities).toEqual({ customer: "customer" });
    expect(deps.documentService.getDoc).toHaveBeenCalledWith("customer", "CUST-1", user, ctx, ctx.locale);
  });

  it("keeps only the fields the section lists", async () => {
    const deps = makeDeps();
    deps.documentService.getDoc.mockResolvedValue({ toJSON: () => row });
    const out = await new ViewEngine(deps as never).execute(
      linkView(["name"]), { query: { customer: "CUST-1" } }, user, new ResponseContext(),
    );
    expect(out.sections["customer"]).toEqual({ name: "Acme AG" });
  });

  it("gives a caller who may not read the target no row, a warning and no entity", async () => {
    const deps = makeDeps();
    deps.documentService.getDoc.mockRejectedValue(PermissionDeniedError.forAction("customer", "read"));
    const ctx = new ResponseContext();
    const out = await new ViewEngine(deps as never).execute(linkView(), { query: { customer: "CUST-1" } }, user, ctx);
    expect(out.sections["customer"]).toBeNull();
    expect(out.entities).toEqual({});
    expect(ctx.getMessages().find((m) => m.path === "/sections/customer")?.code).toBe("omitted_no_permission");
  });

  it("gives a target that no longer exists no row and the warning omitted_not_found", async () => {
    const deps = makeDeps();
    deps.documentService.getDoc.mockRejectedValue(new NotFoundError("customer", "CUST-9"));
    const ctx = new ResponseContext();
    const out = await new ViewEngine(deps as never).execute(linkView(), { query: { customer: "CUST-9" } }, user, ctx);
    expect(out.sections["customer"]).toBeNull();
    expect(ctx.getMessages().find((m) => m.path === "/sections/customer")?.code).toBe("omitted_not_found");
  });
});

describe("ViewEngine — list section expand", () => {
  const expandView = (as?: string) =>
    makeView({
      anchored: false,
      source: undefined,
      params: [],
      sections: [
        {
          key: "invoices",
          kind: "list",
          entity: "salesInvoice",
          expand: { field: "customer", entity: "customer", fields: ["name"], ...(as ? { as } : {}) },
        },
      ],
    });
  const page = (data: Record<string, unknown>[]) => ({ data, total: data.length, page: 1, page_size: 20, total_pages: 1 });
  const invoices = [
    { _id: "I-1", customer: "C-1" },
    { _id: "I-2", customer: "C-2" },
    { _id: "I-3", customer: "C-1" },
    { _id: "I-4" },
  ];

  it("adds the linked row's fields to each row, from one read of the distinct ids made as the caller", async () => {
    const deps = makeDeps();
    deps.documentService.getList
      .mockResolvedValueOnce(page(invoices))
      .mockResolvedValueOnce(page([{ _id: "C-1", name: "Acme AG" }, { _id: "C-2", name: "Beta GmbH" }]));
    const ctx = new ResponseContext();
    const out = await new ViewEngine(deps as never).execute(expandView(), { query: {} }, user, ctx);
    expect(out.sections["invoices"]).toEqual([
      { _id: "I-1", customer: "C-1", customer_doc: { _id: "C-1", name: "Acme AG" } },
      { _id: "I-2", customer: "C-2", customer_doc: { _id: "C-2", name: "Beta GmbH" } },
      { _id: "I-3", customer: "C-1", customer_doc: { _id: "C-1", name: "Acme AG" } },
      { _id: "I-4", customer_doc: null },
    ]);
    expect(deps.documentService.getList).toHaveBeenCalledTimes(2);
    const [entity, query, caller, callCtx] = deps.documentService.getList.mock.calls[1]!;
    expect(entity).toBe("customer");
    expect(query).toEqual({ filters: [["_id", "in", ["C-1", "C-2"]]], fields: ["name"], limit: 2 });
    expect(caller).toBe(user);
    expect(callCtx).toBe(ctx);
  });

  it("leaves a row whose linked row the caller may not read unexpanded, under the name `as` gives", async () => {
    const deps = makeDeps();
    // getList answers only the customers the caller may read; C-2 is not one of them.
    deps.documentService.getList
      .mockResolvedValueOnce(page(invoices))
      .mockResolvedValueOnce(page([{ _id: "C-1", name: "Acme AG" }]));
    const out = await new ViewEngine(deps as never).execute(expandView("buyer"), { query: {} }, user, new ResponseContext());
    const rows = out.sections["invoices"] as Record<string, unknown>[];
    expect(rows.map((r) => r["buyer"])).toEqual([{ _id: "C-1", name: "Acme AG" }, null, { _id: "C-1", name: "Acme AG" }, null]);
    expect(rows.some((r) => "customer_doc" in r)).toBe(false);
  });
});

describe("ViewEngine — root resolution", () => {
  it("bubbles NotFoundError when root is missing", async () => {
    const deps = makeDeps();
    deps.documentService.getDoc.mockRejectedValue(new NotFoundError("customer", "MISSING"));
    const ctx = new ResponseContext();
    await expect(
      new ViewEngine(deps as never).execute(
        makeView(), { rootName: "MISSING", query: {} }, user, ctx,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError when anchored view called without rootName", async () => {
    const deps = makeDeps();
    const ctx = new ResponseContext();
    await expect(
      new ViewEngine(deps as never).execute(makeView(), { query: {} }, user, ctx),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("ViewEngine — aggregate section", () => {
  it("checks RBAC and prepends nothing for Administrator", async () => {
    const deps = makeDeps();
    const adminUser: UserContext = { _id: "a", email: "admin", roles: ["Administrator"] };
    deps.documentService.getDoc.mockResolvedValue({ toJSON: () => ({ _id: "CUST-1" }) });
    deps.db.aggregate.mockResolvedValue([{ _id: "PROD-1", last_price: 10 }]);

    const view = makeView({
      sections: [{
        key: "last_price",
        kind: "aggregate",
        entity: "salesInvoice",
        pipeline: [
          { $match: { customer: "$root._id" } },
          { $unwind: "$lines" },
          { $group: { _id: "$lines.product", last_price: { $first: "$lines.unit_price" } } },
        ],
      }],
    });
    const ctx = new ResponseContext();
    const out = await new ViewEngine(deps as never).execute(
      view, { rootName: "CUST-1", query: {} }, adminUser, ctx,
    );
    expect((out.sections["last_price"] as unknown[]).length).toBe(1);
    expect(deps.db.aggregate).toHaveBeenCalledOnce();
    const pipeline = deps.db.aggregate.mock.calls[0]![1];
    // Admin -> applyScopeFilters returns empty -> no security $match prepended
    // and the user pipeline is preserved verbatim with token resolution applied.
    expect(pipeline[0]).toEqual({ $match: { customer: "CUST-1" } });
  });
});

describe("ViewEngine — section-level fallback policy", () => {
  it("'silent' suppresses warning text", async () => {
    const deps = makeDeps();
    deps.documentService.getDoc.mockResolvedValue({ toJSON: () => ({ _id: "CUST-1" }) });
    deps.documentService.getList.mockRejectedValue(
      PermissionDeniedError.forAction("salesInvoice", "select"),
    );
    const view = makeView({
      sections: [{
        key: "x", kind: "list", entity: "salesInvoice",
        filter: [["customer", "=", "$root._id"]],
        permission_fallback: "silent",
      }],
    });
    const ctx = new ResponseContext();
    const out = await new ViewEngine(deps as never).execute(
      view, { rootName: "CUST-1", query: {} }, user, ctx,
    );
    expect(out.sections["x"]).toEqual([]);
    expect(ctx.getMessages().filter((m) => m.path === "/sections/x").length).toBe(0);
  });

  it("'error' rethrows", async () => {
    const deps = makeDeps();
    deps.documentService.getDoc.mockResolvedValue({ toJSON: () => ({ _id: "CUST-1" }) });
    deps.documentService.getList.mockRejectedValue(
      PermissionDeniedError.forAction("salesInvoice", "select"),
    );
    const view = makeView({
      sections: [{
        key: "x", kind: "list", entity: "salesInvoice",
        filter: [["customer", "=", "$root._id"]],
        permission_fallback: "error",
      }],
    });
    const ctx = new ResponseContext();
    await expect(
      new ViewEngine(deps as never).execute(view, { rootName: "CUST-1", query: {} }, user, ctx),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
