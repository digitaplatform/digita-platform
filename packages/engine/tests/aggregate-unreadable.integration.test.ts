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
// The field walker can be switched off, so a probe shows what the runner's own guards hold
// for a shape the walker does not know.
const walker = vi.hoisted(() => ({ off: false }));
vi.mock("../src/core/view/section-runners/pipeline-field-walker.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/core/view/section-runners/pipeline-field-walker.js")>();
  return {
    ...original,
    collectFieldReferences: (...args: Parameters<typeof original.collectFieldReferences>) =>
      walker.off ? [] : original.collectFieldReferences(...args),
  };
});

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { env } from "../src/core/config/env.js";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { runAggregateSection } from "../src/core/view/section-runners/aggregate-section.js";
import { PermissionDeniedError } from "../src/core/permissions/permission-checker.js";

// A reader of Employee `name`, `dept`, `dept_id` and the `payments` rows without their `amount`,
// not `salary`, and of Department `title` and the `lines` rows without their `cost`, not
// `budget`, and of every field of Tag. Whatever a pipeline's syntax, the rows it answers this
// reader carry no salary, budget, amount or cost, and nothing in them depends on one: swapping
// the values among the rows changes nothing.
const entities: Record<string, unknown> = {
  Employee: {
    name: "Employee", database: "app", permissions: [],
    fields: [
      { fieldname: "name", fieldtype: "Data" },
      { fieldname: "dept", fieldtype: "Data" },
      { fieldname: "dept_id", fieldtype: "Link", target: "Department" },
      { fieldname: "salary", fieldtype: "Currency", perm_level: 2 },
      {
        fieldname: "payments", fieldtype: "Table",
        child_fields: [{ fieldname: "ref", fieldtype: "Data" }, { fieldname: "amount", fieldtype: "Currency", perm_level: 1 }],
      },
    ],
  },
  Department: {
    name: "Department", database: "app", permissions: [],
    fields: [
      { fieldname: "title", fieldtype: "Data" },
      { fieldname: "budget", fieldtype: "Currency", perm_level: 1 },
      {
        fieldname: "lines", fieldtype: "Table",
        child_fields: [{ fieldname: "item", fieldtype: "Data" }, { fieldname: "cost", fieldtype: "Currency", perm_level: 1 }],
      },
    ],
  },
  Tag: { name: "Tag", database: "app", permissions: [], fields: [{ fieldname: "label", fieldtype: "Data" }] },
};
const registry = { has: (n: string) => n in entities, get: (n: string) => entities[n] } as never;
const user = { _id: "u1", email: "u@example.com", roles: ["Clerk"] } as never;
const rctx = { root: null, user, params: {}, now: new Date(), warnings: [] };
const partial = new Map<string, Set<string> | null>([
  ["Employee", new Set(["name", "dept", "dept_id", "payments"])],
  ["Department", new Set(["title", "lines"])],
  ["Tag", null],
]);
const partialChildren = new Map<string, Set<string>>([
  ["Employee.payments", new Set(["_row_id", "idx", "ref"])],
  ["Department.lines", new Set(["_row_id", "idx", "item"])],
]);
const everyField = new Map<string, Set<string> | null>([
  ["Employee", null],
  ["Department", null],
  ["Tag", null],
]);

const SALARIES = [91001, 42002, 77003];
const BUDGETS = [555001, 555002];
const AMOUNTS = [71001, 72001, 73001];
const COSTS = [81001, 82001];
const join = { $lookup: { from: "Department", localField: "dept_id", foreignField: "_id", as: "d" } };

let replSet: MongoMemoryReplSet;
let db: MongoDBService;

/** Store the protected values; `turn` rotates them among the rows. */
async function storeValues(turn: number): Promise<void> {
  const at = <T>(list: T[], i: number): T => list[(i + turn) % list.length]!;
  for (const [i, id] of ["E1", "E2", "E3"].entries()) {
    await db.updateOne(
      "Employee",
      id,
      { salary: at(SALARIES, i), payments: [{ _row_id: `${id}-p`, idx: 0, ref: `${id}-ref`, amount: at(AMOUNTS, i) }] },
      "app",
    );
  }
  for (const [i, id] of ["D1", "D2"].entries()) {
    await db.updateOne(
      "Department",
      id,
      { budget: at(BUDGETS, i), lines: [{ _row_id: `${id}-l`, idx: 0, item: `${id}-item`, cost: at(COSTS, i) }] },
      "app",
    );
  }
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.insertOne("Department", { _id: "D1", title: "Ops" }, "app");
  await db.insertOne("Department", { _id: "D2", title: "Dev" }, "app");
  await db.insertOne("Tag", { _id: "T1", label: "any" }, "app");
  await db.insertOne("Employee", { _id: "E1", name: "Anna", dept: "CH", dept_id: "D1" }, "app");
  await db.insertOne("Employee", { _id: "E2", name: "Ben", dept: "DE", dept_id: "D2" }, "app");
  await db.insertOne("Employee", { _id: "E3", name: "Cleo", dept: "DE", dept_id: "D2" }, "app");
  await storeValues(0);
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

/** What a pipeline answers a reader: its rows, or that it was refused. */
async function outcome(pipeline: unknown[], readable: Map<string, Set<string> | null>, walkerOff = false): Promise<unknown> {
  walker.off = walkerOff;
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
          getReadableChildFieldsOnEveryRow: vi.fn((_u: unknown, entity: string, table: string) =>
            readable === partial ? (partialChildren.get(`${entity}.${table}`) ?? null) : null,
          ),
          hasConditionalRowRead: vi.fn(() => false),
        },
      } as never,
    );
  } catch (err) {
    if (err instanceof PermissionDeniedError) return "refused";
    throw err;
  } finally {
    walker.off = false;
  }
}

const probes: Array<[string, unknown[]]> = [
  ["an exclusion $project, then a read of salary", [{ $project: { name: 0 } }, { $addFields: { x: "$salary" } }]],
  ["an exclusion of _id, then a sum of salary", [{ $project: { _id: 0 } }, { $group: { _id: "$dept", total: { $sum: "$salary" } } }, { $sort: { _id: 1 } }]],
  ["an exclusion $project, then a sort by salary", [{ $project: { name: 0 } }, { $sort: { salary: -1 } }]],
  ["an exclusion $project, then a match on salary", [{ $project: { name: 0 } }, { $match: { salary: { $gt: 50000 } } }]],
  ["a path through a $lookup's as to budget", [join, { $addFields: { leak: { $first: "$d.budget" } } }]],
  ["a $lookup, an $unwind and a group by budget", [join, { $unwind: "$d" }, { $group: { _id: "$d.budget", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]],
  ["a $facet branch that hands the documents on whole", [{ $facet: { all: [{ $match: { dept: "DE" } }] } }]],
  ["a $lookup.let bound to salary", [{ $lookup: { from: "Department", let: { s: "$salary" }, pipeline: [{ $match: { $expr: { $gt: ["$$s", 50000] } } }, { $project: { title: 1 } }], as: "d" } }]],
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
  // A nested $lookup.pipeline and a $facet branch that the field check lets through: the $unset
  // at the head of the sub-pipeline is what keeps the budget out.
  ["a nested pipeline that reads budget after a reshape", [{ $lookup: { from: "Department", localField: "dept_id", foreignField: "_id", as: "d", pipeline: [{ $project: { title: { x: 0 } } }, { $addFields: { b: "$budget" } }] } }]],
  ["a $facet branch with such a nested pipeline", [{ $facet: { a: [{ $project: { name: 1, dept_id: 1 } }, { $lookup: { from: "Department", localField: "dept_id", foreignField: "_id", as: "d", pipeline: [{ $project: { title: { x: 0 } } }, { $addFields: { b: "$budget" } }] } }] } }]],
  // A $lookup's foreignField is matched on the stored rows: on a hidden field it tells who holds a guess.
  ["a foreignField oracle on salary under a dotted as", [{ $lookup: { from: "Tag", as: "x.y", pipeline: [{ $addFields: { guess: 91001 } }, { $lookup: { from: "Employee", localField: "guess", foreignField: "salary", as: "hit" } }, { $project: { n: { $size: "$hit" }, who: "$hit.name" } }] } }]],
  ["a foreignField oracle on a child amount", [{ $lookup: { from: "Tag", as: "t", pipeline: [{ $addFields: { guess: 71001 } }, { $lookup: { from: "Employee", localField: "guess", foreignField: "payments.amount", as: "hit" } }, { $project: { n: { $size: "$hit" }, who: "$hit.name" } }] } }]],
  // A child field of a readable Table that the reader may not read.
  ["the bare rows with their payments", [{ $match: {} }]],
  ["a sort by a child amount", [{ $sort: { "payments.amount": -1 } }, { $project: { name: 1 } }]],
  ["a match on a child amount", [{ $match: { "payments.amount": { $gt: 72000 } } }, { $project: { name: 1 } }]],
  ["an $unwind of payments and their amounts", [{ $unwind: "$payments" }, { $project: { amt: "$payments.amount" } }]],
  ["a sum of the child amounts per person", [{ $unwind: "$payments" }, { $group: { _id: "$name", total: { $sum: "$payments.amount" } } }, { $sort: { _id: 1 } }]],
  ["an inclusion of the payments", [{ $project: { payments: 1 } }]],
  ["a joined child cost", [join, { $addFields: { c: "$d.lines.cost" } }]],
  ["a group by a joined child cost", [join, { $unwind: "$d" }, { $unwind: "$d.lines" }, { $group: { _id: "$d.lines.cost", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]],
  // A $lookup inside a $lookup's sub-pipeline.
  ["a $lookup nested in a sub-pipeline that reads budget after a reshape", [{ $lookup: { from: "Tag", as: "t", pipeline: [{ $lookup: { from: "Department", pipeline: [{ $project: { title: { x: 0 } } }, { $addFields: { b: "$budget" } }], as: "d" } }, { $project: { label: "$d.b" } }] } }]],
  // A foreignField through an array index, and one on a Table whose rows hold a hidden child field.
  ["a foreignField oracle through an array index", [{ $lookup: { from: "Tag", as: "t", pipeline: [{ $addFields: { guess: 72001 } }, { $lookup: { from: "Employee", localField: "guess", foreignField: "payments.0.amount", as: "hit" } }, { $project: { n: { $size: "$hit" }, who: "$hit.name" } }] } }]],
  ["a foreignField oracle on a whole Table row", [{ $lookup: { from: "Tag", as: "t", pipeline: [{ $addFields: { guess: { _row_id: "E1-p", idx: 0, ref: "E1-ref", amount: 71001 } } }, { $lookup: { from: "Employee", localField: "guess", foreignField: "payments", as: "hit" } }, { $project: { n: { $size: "$hit" }, who: "$hit.name" } }] } }]],
];

describe("an aggregate section never answers a reader a value of a field they may not read", () => {
  for (const [what, pipeline] of probes) {
    for (const walkerOff of [false, true]) {
      it(`through ${what}${walkerOff ? ", with the field walker off" : ""}: no protected value, and nothing that depends on one`, async () => {
        const before = await outcome(pipeline, partial, walkerOff);
        await storeValues(1);
        try {
          const after = await outcome(pipeline, partial, walkerOff);
          const text = JSON.stringify(before);
          for (const value of [...SALARIES, ...BUDGETS, ...AMOUNTS, ...COSTS]) expect(text).not.toContain(String(value));
          expect(after).toEqual(before);
        } finally {
          await storeValues(0);
        }
      });
    }
  }

  it("PLANTED INNOCENT: a reader of every field gets the values, so the probes can see them", async () => {
    const rows = await outcome([{ $project: { name: 0 } }, { $addFields: { x: "$salary" } }], everyField);
    expect(JSON.stringify(rows)).toContain("91001");
    const joined = await outcome([join, { $addFields: { leak: { $first: "$d.budget" } } }], everyField);
    expect(JSON.stringify(joined)).toContain("555001");
    expect(JSON.stringify(await outcome([{ $match: {} }], everyField))).toContain("71001");
  });

  it("PLANTED INNOCENT: the partial reader keeps the readable child fields of a Table", async () => {
    const rows = (await outcome([{ $project: { payments: 1 } }, { $sort: { _id: 1 } }], partial)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r["payments"])).toEqual([
      [{ _row_id: "E1-p", idx: 0, ref: "E1-ref" }],
      [{ _row_id: "E2-p", idx: 0, ref: "E2-ref" }],
      [{ _row_id: "E3-p", idx: 0, ref: "E3-ref" }],
    ]);
  });

  it("PLANTED INNOCENT: the joined rows keep the fields and child fields the reader may read", async () => {
    for (const walkerOff of [false, true]) {
      const rows = (await outcome([{ $project: { dept_id: 1 } }, join, { $sort: { _id: 1 } }], partial, walkerOff)) as Array<Record<string, unknown>>;
      expect(rows[0]!["d"]).toEqual([{ _id: "D1", title: "Ops", lines: [{ _row_id: "D1-l", idx: 0, item: "D1-item" }] }]);
    }
  });

  it("PLANTED INNOCENT: the oracle pipelines answer a reader of every field, so they can tell", async () => {
    const hit = await outcome([{ $lookup: { from: "Tag", as: "t", pipeline: [{ $addFields: { guess: { _row_id: "E1-p", idx: 0, ref: "E1-ref", amount: 71001 } } }, { $lookup: { from: "Employee", localField: "guess", foreignField: "payments", as: "hit" } }, { $project: { who: "$hit.name" } }] } }, { $project: { t: 1 } }, { $limit: 1 }], everyField);
    expect(JSON.stringify(hit)).toContain("Anna");
    const indexed = await outcome([{ $lookup: { from: "Tag", as: "t", pipeline: [{ $addFields: { guess: 72001 } }, { $lookup: { from: "Employee", localField: "guess", foreignField: "payments.0.amount", as: "hit" } }, { $project: { who: "$hit.name" } }] } }, { $project: { t: 1 } }, { $limit: 1 }], everyField);
    expect(JSON.stringify(indexed)).toContain("Ben");
  });

  it("refuses a $lookup whose from names no entity, such as { db, coll }", async () => {
    await expect(
      outcome([{ $lookup: { from: { db: "local", coll: "oplog.rs" }, pipeline: [], as: "o" } }], partial),
    ).resolves.toBe("refused");
  });
});
