import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AggregateSection } from "@digitaplatform/shared";

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

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { env } from "../src/core/config/env.js";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { runAggregateSection } from "../src/core/view/section-runners/aggregate-section.js";
import { PermissionDeniedError } from "../src/core/permissions/permission-checker.js";

// A reader of Employee `name`, `dept` and `dept_id`, not `salary`, and of Department `name`, not
// `budget`. Whatever a pipeline's syntax, the rows it answers this reader carry no salary and no
// budget, and nothing in them depends on one: swapping the values among the rows changes nothing.
const entities: Record<string, unknown> = {
  Employee: {
    name: "Employee", database: "app", permissions: [],
    fields: [
      { fieldname: "name", fieldtype: "Data" },
      { fieldname: "dept", fieldtype: "Data" },
      { fieldname: "dept_id", fieldtype: "Link", target: "Department" },
      { fieldname: "salary", fieldtype: "Currency", perm_level: 2 },
    ],
  },
  Department: {
    name: "Department", database: "app", permissions: [],
    fields: [
      { fieldname: "name", fieldtype: "Data" },
      { fieldname: "budget", fieldtype: "Currency", perm_level: 1 },
    ],
  },
};
const registry = { has: (n: string) => n in entities, get: (n: string) => entities[n] } as never;
const user = { _id: "u1", email: "u@example.com", roles: ["Clerk"] } as never;
const rctx = { root: null, user, params: {}, now: new Date(), warnings: [] };
const partial = new Map<string, Set<string> | null>([
  ["Employee", new Set(["name", "dept", "dept_id"])],
  ["Department", new Set(["name"])],
]);
const everyField = new Map<string, Set<string> | null>([
  ["Employee", null],
  ["Department", null],
]);

const SALARIES = [91001, 42002, 77003];
const BUDGETS = [555001, 555002];
const join = { $lookup: { from: "Department", localField: "dept_id", foreignField: "_id", as: "d" } };

let replSet: MongoMemoryReplSet;
let db: MongoDBService;

async function storeValues(salaries: number[], budgets: number[]): Promise<void> {
  for (const [i, id] of ["E1", "E2", "E3"].entries()) {
    await db.updateOne("Employee", id, { salary: salaries[i] }, "app");
  }
  for (const [i, id] of ["D1", "D2"].entries()) await db.updateOne("Department", id, { budget: budgets[i] }, "app");
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.insertOne("Department", { _id: "D1", name: "Ops" }, "app");
  await db.insertOne("Department", { _id: "D2", name: "Dev" }, "app");
  await db.insertOne("Employee", { _id: "E1", name: "Anna", dept: "CH", dept_id: "D1" }, "app");
  await db.insertOne("Employee", { _id: "E2", name: "Ben", dept: "DE", dept_id: "D2" }, "app");
  await db.insertOne("Employee", { _id: "E3", name: "Cleo", dept: "DE", dept_id: "D2" }, "app");
  await storeValues(SALARIES, BUDGETS);
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

/** What a pipeline answers a reader: its rows, or that it was refused. */
async function outcome(pipeline: unknown[], readable: Map<string, Set<string> | null>): Promise<unknown> {
  try {
    return await runAggregateSection(
      { key: "k", kind: "aggregate", entity: "Employee", pipeline } as AggregateSection,
      rctx,
      user,
      {
        db,
        registry,
        permissionChecker: {
          check: vi.fn().mockResolvedValue(undefined),
          getReadableFieldsOnEveryRow: vi.fn((_u: unknown, entity: string) => readable.get(entity) ?? null),
          hasConditionalRowRead: vi.fn(() => false),
        },
      } as never,
    );
  } catch (err) {
    if (err instanceof PermissionDeniedError) return "refused";
    throw err;
  }
}

const probes: Array<[string, unknown[]]> = [
  ["an exclusion $project, then a read of salary", [{ $project: { name: 0 } }, { $addFields: { x: "$salary" } }]],
  ["an exclusion of _id, then a sum of salary", [{ $project: { _id: 0 } }, { $group: { _id: "$dept", total: { $sum: "$salary" } } }]],
  ["an exclusion $project, then a sort by salary", [{ $project: { name: 0 } }, { $sort: { salary: -1 } }]],
  ["an exclusion $project, then a match on salary", [{ $project: { name: 0 } }, { $match: { salary: { $gt: 50000 } } }]],
  ["a path through a $lookup's as to budget", [join, { $addFields: { leak: { $first: "$d.budget" } } }]],
  ["a $lookup, an $unwind and a group by budget", [join, { $unwind: "$d" }, { $group: { _id: "$d.budget", n: { $sum: 1 } } }]],
  ["a $facet branch that hands the documents on whole", [{ $facet: { all: [{ $match: { dept: "DE" } }] } }]],
  ["a $lookup.let bound to salary", [{ $lookup: { from: "Department", let: { s: "$salary" }, pipeline: [{ $match: { $expr: { $gt: ["$$s", 50000] } } }, { $project: { name: 1 } }], as: "d" } }]],
  ["$getField by a plain name", [{ $addFields: { x: { $getField: "salary" } } }]],
  ["a nested exclusion object, then a read of salary", [{ $project: { name: { x: 0 } } }, { $addFields: { leak: "$salary" } }]],
  ["a nested exclusion object, then a sort by salary", [{ $project: { name: { x: 0 } } }, { $sort: { salary: -1 } }]],
  ["a nested inclusion of the joined budget", [join, { $project: { name: 1, d: { budget: 1 } } }, { $addFields: { leak: { $first: "$d.budget" } } }]],
  ["a merge into the joined rows", [join, { $addFields: { d: { x: 1 } } }, { $addFields: { leak: { $first: "$d.budget" } } }]],
  ["a $facet branch after a nested exclusion", [{ $facet: { a: [{ $project: { name: { x: 0 } } }, { $limit: 2 }] } }]],
  ["$top sorted by salary", [{ $group: { _id: "$dept", top: { $top: { sortBy: { salary: -1 }, output: "$name" } } } }, { $sort: { _id: 1 } }]],
  ["$topN sorted by salary", [{ $group: { _id: null, top: { $topN: { n: 3, sortBy: { salary: -1 }, output: "$name" } } } }]],
  ["$jsonSchema on salary", [{ $match: { $jsonSchema: { properties: { salary: { minimum: 80000 } } } } }]],
  ["an inclusion of the joined rows by 2", [join, { $project: { name: 1, d: 2 } }, { $addFields: { leak: { $first: "$d.budget" } } }]],
  ["a dotted as, then a read of budget", [{ $lookup: { from: "Department", localField: "dept_id", foreignField: "_id", as: "x.y" } }, { $addFields: { leak: { $first: "$x.y.budget" } } }]],
  ["a dotted as alone", [{ $lookup: { from: "Department", localField: "dept_id", foreignField: "_id", as: "x.y" } }]],
];

describe("an aggregate section never answers a reader a value of a field they may not read", () => {
  for (const [what, pipeline] of probes) {
    it(`through ${what}: no protected value, and nothing that depends on one`, async () => {
      const before = await outcome(pipeline, partial);
      await storeValues([SALARIES[1]!, SALARIES[2]!, SALARIES[0]!], [BUDGETS[1]!, BUDGETS[0]!]);
      try {
        const after = await outcome(pipeline, partial);
        const text = JSON.stringify(before);
        for (const value of [...SALARIES, ...BUDGETS]) expect(text).not.toContain(String(value));
        expect(after).toEqual(before);
      } finally {
        await storeValues(SALARIES, BUDGETS);
      }
    });
  }

  it("PLANTED INNOCENT: a reader of every field gets the values, so the probes can see them", async () => {
    const rows = await outcome([{ $project: { name: 0 } }, { $addFields: { x: "$salary" } }], everyField);
    expect(JSON.stringify(rows)).toContain("91001");
    const joined = await outcome([join, { $addFields: { leak: { $first: "$d.budget" } } }], everyField);
    expect(JSON.stringify(joined)).toContain("555001");
  });
});
