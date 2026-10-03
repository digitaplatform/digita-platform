import { describe, it, expect, vi, beforeEach } from "vitest";
import { OPERATOR_FIELDS } from "@digitaplatform/shared";

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
import { PermissionChecker, PermissionDeniedError } from "../src/core/permissions/permission-checker.js";
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
    tenantTimeZone: () => "UTC",
    permissionChecker: {
      check: vi.fn().mockResolvedValue(undefined),
      hasConditionalRowRead: vi.fn(() => false),
      getReadableFieldsOnEveryRow: vi.fn((_user: unknown, entity: string) => {
        if (entity === "Employee") return opts.readable;
        return opts.readableByLookup?.get(entity) ?? null;
      }),
    },
  } as never;
}

const user = { _id: "u1", email: "u@example.com", roles: ["Salesperson"] } as never;
const rctx = { root: null, user, params: {}, now: new Date(), warnings: [] };

describe("runAggregateSection — operator fields without an admitting read row", () => {
  const clerk = { _id: "c1", email: "clerk@example.com", roles: ["Clerk"] } as never;
  const registry = {
    has: (name: string) => name === "Employee",
    get: () => ({
      name: "Employee", database: "app",
      fields: [{ fieldname: "title", fieldtype: "Data" }],
      permissions: [
        { role: "Clerk", level: 0, select: 1 },
        { role: "Clerk", level: 1, read: 1, if_owner: true },
      ],
    }),
  } as never;
  const deps = () => ({
    registry,
    permissionChecker: new PermissionChecker(registry),
    db: { aggregate: vi.fn().mockResolvedValue([{ _id: "E1", owner: "other@test", modified_by: "other@test", count: 1 }]) },
    tenantTimeZone: () => "UTC",
  });
  const section = (pipeline: Array<Record<string, unknown>>) => ({ key: "k", kind: "aggregate" as const, entity: "Employee", pipeline });

  it.each(["owner", "modified_by"])("refuses a projection of the denied %s", async (field) => {
    const services = deps();
    await expect(runAggregateSection(section([{ $project: { [field]: 1 } }]), rctx, clerk, services as never))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    expect(services.db.aggregate).not.toHaveBeenCalled();
  });

  it("removes denied operator fields before the pipeline and in the final output mask", async () => {
    const services = deps();
    expect(await runAggregateSection(section([]), rctx, clerk, services as never)).toEqual([{ _id: "E1", count: 1 }]);
    const pipeline = services.db.aggregate.mock.calls[0]![1] as Array<Record<string, unknown>>;
    expect(pipeline).toContainEqual({ $unset: expect.arrayContaining(["owner", "modified_by"]) });
  });
});

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

  it("admin sees protected fields (getReadableFieldsOnEveryRow returns null → bypass)", async () => {
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
      tenantTimeZone: () => "UTC",
      permissionChecker: {
        check: vi.fn().mockResolvedValue(undefined),
        hasConditionalRowRead: vi.fn(() => false),
        getReadableFieldsOnEveryRow: vi.fn(() => null),
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

  it("reads $$ROOT as the whole document and skips $$NOW", () => {
    const refs = collectFieldReferences(
      [{ $project: { x: "$$ROOT", y: "$$NOW" } }],
      "Employee",
      reg,
    );
    const sources = refs.filter((r) => r.origin === "source").map((r) => r.field);
    expect(sources).toEqual(["*"]);
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

// A view's aggregate reads every row the level-0 read admits, so a field level
// granted only on some rows (if_owner, condition, scope) must not count for it.
describe("runAggregateSection — field levels granted only on some rows", () => {
  function realDeps(level1: Record<string, unknown>): never {
    const reg = {
      has: (n: string) => n === "Employee",
      get: () => ({
        name: "Employee",
        database: "app",
        permissions: [
          { role: "Clerk", level: 0, read: 1 },
          { role: "Clerk", level: 1, read: 1, ...level1 },
        ],
        fields: [
          { fieldname: "dept", fieldtype: "Data" },
          { fieldname: "salary", fieldtype: "Currency", perm_level: 1 },
        ],
      }),
    } as never;
    const checker = Object.assign(new PermissionChecker(reg), { check: vi.fn() });
    return {
      db: { aggregate: vi.fn().mockResolvedValue([{ _id: null, total: 1 }]) },
      registry: reg,
      permissionChecker: checker,
    } as never;
  }
  const clerk = { _id: "c1", email: "clerk@example.com", roles: ["Clerk"] } as never;
  const sumSalaries = {
    key: "k",
    kind: "aggregate" as const,
    entity: "Employee",
    pipeline: [{ $group: { _id: null, total: { $sum: "$salary" } } }],
  };

  it("refuses to sum a field the user reads only on documents it owns", async () => {
    await expect(
      runAggregateSection(sumSalaries, rctx, clerk, realDeps({ if_owner: 1 })),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses to sum a field the user reads only under a condition", async () => {
    await expect(
      runAggregateSection(sumSalaries, rctx, clerk, realDeps({ condition: 'doc.status != "Closed"' })),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("sums a field the user reads on every document", async () => {
    await expect(runAggregateSection(sumSalaries, rctx, clerk, realDeps({}))).resolves.toEqual([
      { _id: null, total: 1 },
    ]);
  });
});

// A level-0 read with a `condition` cannot become the security $match, and a row cannot be
// re-checked after a reshaping stage, so an aggregate over such an entity is refused.
describe("runAggregateSection — rows a read condition hides", () => {
  function conditionDeps(postRead: Record<string, unknown>): never {
    const defs: Record<string, unknown> = {
      Post: {
        name: "Post",
        database: "app",
        permissions: [{ role: "Guest", level: 0, select: 1, read: 1, ...postRead }],
        fields: [{ fieldname: "status", fieldtype: "Data" }],
      },
      Comment: {
        name: "Comment",
        database: "app",
        permissions: [{ role: "Guest", level: 0, select: 1, read: 1 }],
        fields: [{ fieldname: "post", fieldtype: "Link", target: "Post" }],
      },
    };
    const reg = { has: (n: string) => n in defs, get: (n: string) => defs[n] } as never;
    const checker = Object.assign(new PermissionChecker(reg), { check: vi.fn() });
    return {
      db: { aggregate: vi.fn().mockResolvedValue([{ n: 24 }]) },
      registry: reg,
      permissionChecker: checker,
    } as never;
  }
  const guest = { _id: "g", email: "guest@example.com", roles: ["Guest"] } as never;
  const countPosts = { key: "k", kind: "aggregate" as const, entity: "Post", pipeline: [{ $count: "n" }] };
  const published = { condition: 'doc.status == "published"' };

  it("refuses to count the rows of an entity the reader reads only under a condition", async () => {
    await expect(runAggregateSection(countPosts, rctx, guest, conditionDeps(published))).rejects.toMatchObject({
      name: "PermissionDeniedError",
      code: "aggregate_bypasses_read_condition",
      params: { doctype: "Post" },
    });
  });

  it("refuses a $lookup into an entity the reader reads only under a condition", async () => {
    const section = {
      key: "k",
      kind: "aggregate" as const,
      entity: "Comment",
      pipeline: [{ $lookup: { from: "Post", localField: "post", foreignField: "_id", as: "posts" } }],
    };
    await expect(runAggregateSection(section, rctx, guest, conditionDeps(published))).rejects.toMatchObject({
      name: "PermissionDeniedError",
      code: "lookup_bypasses_read_condition",
      params: { doctype: "Post" },
    });
  });

  it("counts the rows of an entity the reader reads without a condition", async () => {
    await expect(runAggregateSection(countPosts, rctx, guest, conditionDeps({}))).resolves.toEqual([{ n: 24 }]);
  });
});

describe("runAggregateSection — names an earlier stage produced", () => {
  const everyField = new Set(["name", "dept", "dept_id", "salary", ...OPERATOR_FIELDS]);
  const section = (pipeline: Array<Record<string, unknown>>) => ({ key: "k", kind: "aggregate" as const, entity: "Employee", pipeline });

  it("runs the grouped, projected and sorted pipeline for a reader of every field, not only an Administrator", async () => {
    const pipeline = [
      { $group: { _id: { month: "$dept", category: "$name" }, n: { $sum: 1 } } },
      { $project: { category: "$_id.category", month: "$_id.month", n: 1 } },
      { $sort: { month: 1 } },
      { $match: { n: { $gt: 0 } } },
    ];
    await expect(runAggregateSection(section(pipeline), rctx, user, makeDeps({ readable: everyField }))).resolves.toEqual([]);
  });

  it("groups by $dateToString without reading its arguments as fields", async () => {
    const pipeline = [{ $group: { _id: { $dateToString: { format: "%Y-%m", date: "$dept" } }, n: { $sum: 1 } } }];
    await expect(runAggregateSection(section(pipeline), rctx, user, makeDeps({ readable: everyField }))).resolves.toEqual([]);
    const sources = collectFieldReferences(pipeline, "Employee", fakeRegistry).filter((r) => r.origin === "source").map((r) => r.field);
    expect(sources).toEqual(["dept"]);
  });

  it("still refuses a protected field named before the first reshaping stage", async () => {
    const partial = new Set(["name", "dept", "dept_id"]);
    const pipeline = [{ $sort: { salary: 1 } }, { $group: { _id: "$dept", n: { $sum: 1 } } }];
    await expect(runAggregateSection(section(pipeline), rctx, user, makeDeps({ readable: partial }))).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses $$ROOT before a reshape to a reader who does not read every field, and allows it to one who does", async () => {
    const partial = new Set(["name", "dept", "dept_id"]);
    const pipeline = [{ $group: { _id: null, rows: { $push: "$$ROOT" } } }];
    await expect(runAggregateSection(section(pipeline), rctx, user, makeDeps({ readable: partial }))).rejects.toThrow(PermissionDeniedError);
    await expect(runAggregateSection(section(pipeline), rctx, user, makeDeps({ readable: everyField }))).resolves.toEqual([]);
  });

  it("reads $$ROOT after a reshape as the reshaped document, not the entity's", async () => {
    const partial = new Set(["name", "dept", "dept_id"]);
    const pipeline = [{ $group: { _id: "$dept", n: { $sum: 1 } } }, { $project: { group: "$$ROOT" } }];
    await expect(runAggregateSection(section(pipeline), rctx, user, makeDeps({ readable: partial }))).resolves.toEqual([]);
  });
});

// A reader of Employee `name`, `dept` and `dept_id`, not `salary`, and of Department `name`, not
// `budget`. Each refused pipeline hands a protected value on, as a run against MongoDB shows.
describe("runAggregateSection — every way a stage hands a protected field on", () => {
  const partial = new Set(["name", "dept", "dept_id"]);
  const deps = () => makeDeps({ readable: partial, readableByLookup: new Map([["Department", new Set(["name"])]]) });
  const section = (pipeline: Array<Record<string, unknown>>) => ({ key: "k", kind: "aggregate" as const, entity: "Employee", pipeline });
  const join = { $lookup: { from: "Department", localField: "dept_id", foreignField: "_id", as: "d" } };

  const refused: Array<[string, Array<Record<string, unknown>>]> = [
    ["an exclusion $project, then a read of salary", [{ $project: { name: 0 } }, { $addFields: { x: "$salary" } }]],
    ["an exclusion of _id, then a sum of salary", [{ $project: { _id: 0 } }, { $group: { _id: "$dept", total: { $sum: "$salary" } } }]],
    ["an exclusion $project, then a sort by salary", [{ $project: { name: 0 } }, { $sort: { salary: -1 } }]],
    ["an exclusion $project, then a match on salary", [{ $project: { name: 0 } }, { $match: { salary: { $gt: 5000 } } }]],
    ["a path through a $lookup's as to budget", [join, { $addFields: { leak: { $first: "$d.budget" } } }]],
    ["a $lookup, an $unwind and a group by budget", [join, { $unwind: "$d" }, { $group: { _id: "$d.budget", n: { $sum: 1 } } }]],
    ["the joined documents copied under another name", [join, { $addFields: { copy: "$d" } }]],
    ["a $facet branch that hands the documents on whole", [{ $facet: { all: [{ $match: { dept: "CH" } }] } }]],
    ["a $facet branch that hands joined documents on", [{ $facet: { all: [join, { $project: { name: 1, d: 1 } }] } }]],
    ["a $lookup.let bound to salary", [{ $lookup: { from: "Department", let: { s: "$salary" }, pipeline: [{ $match: { $expr: { $gt: ["$$s", 0] } } }, { $project: { name: 1 } }], as: "d" } }]],
    ["$getField by a plain name", [{ $addFields: { x: { $getField: "salary" } } }]],
    ["$getField with a computed name", [{ $addFields: { x: { $getField: { field: { $literal: "salary" } } } } }]],
    ["an inclusion of budget written as a number other than 1", [join, { $project: { "d.budget": 2 } }]],
    ["a $lookup whose from is not an entity name", [{ $lookup: { from: { db: "local", coll: "oplog.rs" }, pipeline: [], as: "o" } }]],
    ["a $lookup matched on salary", [{ $lookup: { from: "Employee", localField: "dept", foreignField: "salary", as: "hit" } }]],
  ];
  for (const [what, pipeline] of refused) {
    it(`refuses ${what}`, async () => {
      await expect(runAggregateSection(section(pipeline), rctx, user, deps())).rejects.toThrow(PermissionDeniedError);
    });
  }

  const allowed: Array<[string, Array<Record<string, unknown>>]> = [
    ["PLANTED INNOCENT: an exclusion of salary, then a read of name", [{ $project: { salary: 0 } }, { $addFields: { x: "$name" } }]],
    ["PLANTED INNOCENT: a $lookup, an $unwind and a group by the joined name", [join, { $unwind: "$d" }, { $group: { _id: "$d.name", n: { $sum: 1 } } }]],
    ["PLANTED INNOCENT: a $lookup kept under its own name", [join, { $project: { name: 1, d: 1 } }]],
    ["PLANTED INNOCENT: a $facet branch that counts", [{ $facet: { total: [{ $count: "n" }] } }]],
    ["PLANTED INNOCENT: a $lookup.let bound to name", [{ $lookup: { from: "Department", let: { n: "$name" }, pipeline: [{ $match: { $expr: { $eq: ["$name", "$$n"] } } }, { $project: { name: 1 } }], as: "d" } }]],
    ["PLANTED INNOCENT: $getField by a readable name", [{ $addFields: { x: { $getField: "name" } } }]],
  ];
  for (const [what, pipeline] of allowed) {
    it(`allows ${what.replace("PLANTED INNOCENT: ", "")} (PLANTED INNOCENT)`, async () => {
      await expect(runAggregateSection(section(pipeline), rctx, user, deps())).resolves.toEqual([]);
    });
  }
});
