import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { runAggregateSection } from "../src/core/view/section-runners/aggregate-section.js";
import { PermissionDeniedError } from "../src/core/permissions/permission-checker.js";
import {
  collectFieldReferences,
} from "../src/core/view/section-runners/pipeline-field-walker.js";

const fakeRegistry = {
  has: (n: string) => ["Employee", "Department"].includes(n),
  get: (n: string) => {
    if (n === "Department") {
      return {
        name: "Department",
        database: "app",
        permissions: [],
        fields: [
          { fieldname: "name", fieldtype: "Data" },
          { fieldname: "budget", fieldtype: "Currency", perm_level: 1 },
        ],
      };
    }
    return {
      name: "Employee",
      database: "app",
      permissions: [],
      fields: [
        { fieldname: "name", fieldtype: "Data" },
        { fieldname: "dept", fieldtype: "Data" },
        { fieldname: "dept_id", fieldtype: "Link", target: "Department" },
        { fieldname: "salary", fieldtype: "Currency", perm_level: 2 },
      ],
    };
  },
} as never;

function makeDeps(opts: {
  readable: Set<string> | null;
  readableByLookup?: Map<string, Set<string> | null>;
  rows?: unknown[];
}): never {
  return {
    db: { aggregate: vi.fn().mockResolvedValue(opts.rows ?? []) },
    registry: fakeRegistry,
    permissionChecker: {
      check: vi.fn().mockResolvedValue(undefined),
      getReadableFields: vi.fn((_user: unknown, entity: string) => {
        if (entity === "Employee") return opts.readable;
        return opts.readableByLookup?.get(entity) ?? null;
      }),
    },
  } as never;
}

const user = { _id: "u1", email: "u@example.com", roles: ["Salesperson"] } as never;
const rctx = { root: null, user, params: {}, now: new Date(), warnings: [] };

describe("runAggregateSection — field-level perm_level enforcement", () => {
  it("rejects pipeline that references a protected field on the source entity", async () => {
    const deps = makeDeps({
      readable: new Set(["dept", "name"]), // salary NOT readable
    });
    const section = {
      key: "k",
      kind: "aggregate" as const,
      entity: "Employee",
      pipeline: [
        { $group: { _id: "$dept", total: { $sum: "$salary" } } },
      ],
    };
    await expect(
      runAggregateSection(section, rctx, user, deps),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("accepts pipeline that only references readable fields", async () => {
    const deps = makeDeps({
      readable: new Set(["dept", "name", "salary"]),
      rows: [{ _id: "DE", count: 3 }],
    });
    const section = {
      key: "k",
      kind: "aggregate" as const,
      entity: "Employee",
      pipeline: [{ $group: { _id: "$dept", count: { $sum: 1 } } }],
    };
    const out = await runAggregateSection(section, rctx, user, deps);
    expect(out).toEqual([{ _id: "DE", count: 3 }]);
  });

  it("admin sees protected fields (getReadableFields returns null → bypass)", async () => {
    const deps = makeDeps({
      readable: null, // admin
      rows: [{ _id: "DE", total: 999 }],
    });
    const section = {
      key: "k",
      kind: "aggregate" as const,
      entity: "Employee",
      pipeline: [
        { $group: { _id: "$dept", total: { $sum: "$salary" } } },
      ],
    };
    await expect(
      runAggregateSection(section, rctx, user, deps),
    ).resolves.toBeDefined();
  });

  it("rejects when the protected field is on a $lookup target entity", async () => {
    const deps = makeDeps({
      readable: new Set(["dept_id", "name"]),
      readableByLookup: new Map([
        ["Department", new Set(["name"])], // budget NOT readable on Department
      ]),
    });
    const section = {
      key: "k",
      kind: "aggregate" as const,
      entity: "Employee",
      pipeline: [
        {
          $lookup: {
            from: "Department",
            localField: "dept_id",
            foreignField: "_id",
            as: "dept_doc",
            pipeline: [
              { $project: { name: 1, budget: 1 } },
            ],
          },
        },
      ],
    };
    await expect(
      runAggregateSection(section, rctx, user, deps),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("strips protected source-named keys from output rows (defence in depth)", async () => {
    const deps = makeDeps({
      readable: new Set(["dept", "name"]),
      // Pipeline references only readable fields, but the projection forwards
      // a hand-crafted column also called `salary` (e.g. via $literal).
      rows: [{ _id: "DE", name: "Ada", salary: 99999 }],
    });
    const section = {
      key: "k",
      kind: "aggregate" as const,
      entity: "Employee",
      pipeline: [
        { $project: { dept: 1, name: 1 } },
      ],
    };
    const out = await runAggregateSection(section, rctx, user, deps);
    expect(out[0]).toEqual({ _id: "DE", name: "Ada" }); // salary stripped
  });

  it("H4: masks perm_level fields inside a bare $lookup's nested output docs", async () => {
    // The pipeline never references `budget`, so the static field-walker doesn't
    // reject it — but the bare $lookup emits full Department docs including the
    // perm_level-gated `budget`. It must be stripped from the nested output.
    const deps = makeDeps({
      readable: new Set(["dept_id", "name"]),
      readableByLookup: new Map([["Department", new Set(["name"])]]), // budget NOT readable
      rows: [{ _id: "e1", name: "Ada", dept_doc: [{ _id: "d1", name: "Sales", budget: 500000 }] }],
    });
    const section = {
      key: "k",
      kind: "aggregate" as const,
      entity: "Employee",
      pipeline: [
        { $lookup: { from: "Department", localField: "dept_id", foreignField: "_id", as: "dept_doc" } },
      ],
    };
    const out = await runAggregateSection(section, rctx, user, deps);
    expect(out[0]!["dept_doc"]).toEqual([{ _id: "d1", name: "Sales" }]); // budget stripped
  });

  it("H3: refuses a $lookup into an entity the user reads only via if_owner", async () => {
    const reg = {
      has: (n: string) => ["Employee", "Order"].includes(n),
      get: (n: string) =>
        n === "Order"
          ? {
              name: "Order",
              database: "app",
              permissions: [{ role: "Salesperson", read: 1, level: 0, if_owner: true }],
              fields: [{ fieldname: "total", fieldtype: "Currency" }],
            }
          : {
              name: "Employee",
              database: "app",
              permissions: [],
              fields: [
                { fieldname: "name", fieldtype: "Data" },
                { fieldname: "order_id", fieldtype: "Link", target: "Order" },
              ],
            },
    };
    const deps = {
      db: { aggregate: vi.fn().mockResolvedValue([]) },
      registry: reg,
      permissionChecker: {
        check: vi.fn().mockResolvedValue(undefined),
        getReadableFields: vi.fn(() => null),
      },
    } as never;
    const section = {
      key: "k",
      kind: "aggregate" as const,
      entity: "Employee",
      pipeline: [
        { $lookup: { from: "Order", localField: "order_id", foreignField: "_id", as: "orders" } },
      ],
    };
    await expect(runAggregateSection(section, rctx, user, deps)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});

describe("collectFieldReferences — token / system-var skipping", () => {
  const reg = fakeRegistry;

  it("skips $$ROOT and $$NOW", () => {
    const refs = collectFieldReferences(
      [{ $project: { x: "$$ROOT", y: "$$NOW" } }],
      "Employee",
      reg,
    );
    const sources = refs.filter((r) => r.origin === "source");
    expect(sources.length).toBe(0);
  });

  it("skips $root.x / $user.x / $param.x in VALUE positions (keys are still source refs)", () => {
    // Keys `x`, `y`, `z` ARE legitimate source-field filters (Mongo
    // dot-notation match). The token VALUES are not field references.
    const refs = collectFieldReferences(
      [{ $match: { x: "$root.id", y: "$user.email", z: "$param.q" } }],
      "Employee",
      reg,
    );
    const sourceFields = refs
      .filter((r) => r.origin === "source")
      .map((r) => r.field);
    // Keys recorded:
    expect(sourceFields).toContain("x");
    expect(sourceFields).toContain("y");
    expect(sourceFields).toContain("z");
    // Token VALUES not recorded (no field named `root`, `user`, `param`):
    expect(sourceFields).not.toContain("root");
    expect(sourceFields).not.toContain("user");
    expect(sourceFields).not.toContain("param");
  });

  it("records source ref for $field expressions", () => {
    const refs = collectFieldReferences(
      [{ $group: { _id: "$dept", t: { $sum: "$salary" } } }],
      "Employee",
      reg,
    );
    const sources = refs.filter((r) => r.origin === "source").map((r) => r.field);
    expect(sources).toContain("dept");
    expect(sources).toContain("salary");
  });

  it("changes context entity inside $lookup.pipeline", () => {
    const refs = collectFieldReferences(
      [
        {
          $lookup: {
            from: "Department",
            localField: "dept_id",
            foreignField: "_id",
            as: "dept",
            pipeline: [{ $project: { budget: 1 } }],
          },
        },
      ],
      "Employee",
      reg,
    );
    const fromDept = refs.filter((r) => r.entity === "Department");
    expect(fromDept.some((r) => r.field === "budget")).toBe(true);
  });
});
