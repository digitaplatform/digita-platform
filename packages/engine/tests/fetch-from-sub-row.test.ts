import { describe, it, expect, vi } from "vitest";
import type { EntityDefinition } from "@digitaplatform/shared";
import { FetchFromResolver } from "../src/core/fetch/fetch-from-resolver.js";
import { buildSubRowLink } from "../src/core/document/row-id.js";

// Registry stub: every target resolves to the same database.
const registry = { get: () => ({ database: "app" }) } as never;

// db.find stub: filter the fixed parent docs by the queried `_id: { $in: [...] }`.
const PARENTS: Record<string, Record<string, unknown>> = {
  P1: { _id: "P1", rows: [{ _row_id: "R9", some_value: "HELLO" }] },
};
function makeDb() {
  return {
    find: vi.fn(async (_target: string, query: { filters: Array<Record<string, unknown>> }) => {
      const idFilter = query.filters[0]?.["_id"] as { $in: string[] } | undefined;
      const ids = idFilter?.$in ?? [];
      return ids.map((id) => PARENTS[id]).filter(Boolean);
    }),
  } as never;
}

const childEntity: EntityDefinition = {
  name: "ChildDoc",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [
    { fieldname: "parent_ref", fieldtype: "Link", label: "Parent", target: "ParentDoc", target_path: "rows" },
    { fieldname: "parent_value", fieldtype: "Data", label: "Value", fetch_from: "parent_ref.some_value" },
  ],
  permissions: [],
} as unknown as EntityDefinition;

describe("FetchFromResolver — sub-row (target_path) Links", () => {
  it("resolves fetch_from from a sub-row composite Link value", async () => {
    const resolver = new FetchFromResolver(registry, makeDb());
    const result = await resolver.resolve(childEntity, {
      parent_ref: buildSubRowLink("P1", "R9"),
    });
    expect(result.parent_value).toBe("HELLO");
  });

  it("skips (does not throw) when the composite is malformed", async () => {
    const resolver = new FetchFromResolver(registry, makeDb());
    const result = await resolver.resolve(childEntity, { parent_ref: "P1-no-separator" });
    expect(result.parent_value).toBeUndefined();
  });
});
