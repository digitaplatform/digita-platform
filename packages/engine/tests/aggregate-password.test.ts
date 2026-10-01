import { describe, it, expect, vi } from "vitest";
import type { AggregateSection } from "@digitaplatform/shared";

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

// A stored Password value never leaves the engine (#78); a view section of
// kind aggregate returned the stored rows as they are (#85).
const entities: Record<string, unknown> = {
  Vault: {
    name: "Vault",
    database: "app",
    permissions: [],
    fields: [
      { fieldname: "title", fieldtype: "Data" },
      { fieldname: "secret", fieldtype: "Password" },
      { fieldname: "vault_id", fieldtype: "Link", target: "Vault" },
    ],
  },
  Note: {
    name: "Note",
    database: "app",
    permissions: [],
    fields: [
      { fieldname: "title", fieldtype: "Data" },
      { fieldname: "vault_id", fieldtype: "Link", target: "Vault" },
    ],
  },
};
const registry = { has: (n: string) => n in entities, get: (n: string) => entities[n] } as never;

function deps(rows: unknown[]) {
  const aggregate = vi.fn().mockResolvedValue(rows);
  return {
    deps: {
      db: { aggregate },
      registry,
      tenantTimeZone: () => "UTC",
      permissionChecker: {
        check: vi.fn().mockResolvedValue(undefined),
        getReadableFieldsOnEveryRow: vi.fn(() => null), // an Administrator: every field readable
        hasConditionalRowRead: vi.fn(() => false), // #86: and no read condition
      },
    } as never,
    aggregate,
  };
}

const user = { _id: "u1", email: "admin@example.com", roles: ["Administrator"] } as never;
const rctx = { root: null, user, params: {}, now: new Date(), warnings: [] };
const section = (entity: string, pipeline: unknown[]) =>
  ({ key: "k", kind: "aggregate" as const, entity, pipeline }) as AggregateSection;
const stored = { _id: "V-1", title: "Mail server", secret: "hunter2-first", modified: new Date("2026-09-29T10:00:00Z") };

describe("an aggregate section over an entity with a Password field", () => {
  it("hides the stored value in rows that keep the row shape", async () => {
    const d = deps([stored]);
    const rows = await runAggregateSection(section("Vault", [{ $sort: { modified: -1 } }, { $limit: 5 }]), rctx, user, d.deps);
    expect(rows[0]!["title"]).toBe("Mail server");
    expect(rows[0]!["secret"]).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain("hunter2");
  });

  it("never asks the database for the value: the pipeline drops it before any stage", async () => {
    const d = deps([]);
    await runAggregateSection(section("Vault", [{ $addFields: { n: 1 } }]), rctx, user, d.deps);
    expect(d.aggregate.mock.calls[0]![1]).toEqual([{ $unset: ["secret"] }, { $addFields: { n: 1 } }]);
  });

  it.each([
    ["$project: { secret: 1 }", [{ $project: { title: 1, secret: 1 } }]],
    ["$project under another name", [{ $project: { s: "$secret" } }]],
    ["$addFields under another name", [{ $addFields: { s: "$secret" } }]],
    ["$group by it", [{ $group: { _id: "$secret", n: { $sum: 1 } } }]],
    ["$group with $first", [{ $group: { _id: "$title", s: { $first: "$secret" } } }]],
    ["$match on it", [{ $match: { secret: "hunter2-first" } }]],
    ["$sort on it", [{ $sort: { secret: 1 } }]],
    ["a $lookup sub-pipeline that projects it", [{ $lookup: { from: "Vault", as: "v", pipeline: [{ $project: { secret: 1 } }] } }]],
    ["a $facet branch that projects it", [{ $facet: { a: [{ $project: { s: "$secret" } }] } }]],
  ])("refuses a pipeline that outputs it through %s", async (_name, pipeline) => {
    const d = deps([]);
    await expect(runAggregateSection(section("Vault", pipeline), rctx, user, d.deps)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(d.aggregate).not.toHaveBeenCalled();
  });

  it("hides it in the rows a $lookup joins from that entity", async () => {
    const d = deps([{ _id: "N-1", title: "Note", vault: [stored] }]);
    const rows = await runAggregateSection(
      section("Note", [{ $lookup: { from: "Vault", localField: "vault_id", foreignField: "_id", as: "vault" } }]),
      rctx, user, d.deps,
    );
    expect((rows[0]!["vault"] as Record<string, unknown>[])[0]!["title"]).toBe("Mail server");
    expect(JSON.stringify(rows)).not.toContain("hunter2");
  });

  it("gives a $lookup without a sub-pipeline one that drops it before the rows join, in a $facet branch too", async () => {
    const d = deps([]);
    const bare = { from: "Vault", localField: "vault_id", foreignField: "_id", as: "vault" };
    await runAggregateSection(
      section("Note", [{ $lookup: bare }, { $facet: { a: [{ $lookup: bare }] } }]),
      rctx, user, d.deps,
    );
    // The join on the key field that holds both stored forms of an id (id-form-lookup.ts).
    const joined = [
      expect.objectContaining({ $set: expect.objectContaining({ __join_key: expect.anything() }) }),
      { $lookup: { ...bare, localField: "__join_key", pipeline: [{ $unset: ["secret"] }] } },
      { $unset: "__join_key" },
    ];
    expect(d.aggregate.mock.calls[0]![1]).toEqual([...joined, { $facet: { a: joined } }]);
  });

  it("drops it before a $lookup sub-pipeline from that entity runs", async () => {
    const d = deps([]);
    await runAggregateSection(
      section("Note", [{ $lookup: { from: "Vault", as: "vault", pipeline: [{ $limit: 1 }] } }]),
      rctx, user, d.deps,
    );
    expect(d.aggregate.mock.calls[0]![1]).toEqual([{ $lookup: { from: "Vault", as: "vault", pipeline: [{ $unset: ["secret"] }, { $limit: 1 }] } }]);
  });

  it("leaves a pipeline over an entity without a Password field as it is", async () => {
    const d = deps([{ _id: "N-1", title: "Note" }]);
    const rows = await runAggregateSection(section("Note", [{ $sort: { title: 1 } }]), rctx, user, d.deps);
    expect(d.aggregate.mock.calls[0]![1]).toEqual([{ $sort: { title: 1 } }]);
    expect(rows).toEqual([{ _id: "N-1", title: "Note" }]);
  });
});
