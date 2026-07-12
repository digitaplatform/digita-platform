import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import {
  BkResolver,
  businessKeyFields,
  businessKeyOf,
  resolveLinksByBk,
  type BkIndex,
} from "../src/core/import-export/bk-resolver.js";

function entity(opts: Partial<EntityDefinition> & { name: string }): EntityDefinition {
  return {
    module: "test",
    database: "app",
    naming: { strategy: "system" },
    fields: [],
    permissions: [],
    ...opts,
  } as EntityDefinition;
}

describe("businessKeyFields", () => {
  it("normalizes a single-string business_key", () => {
    expect(businessKeyFields(entity({ name: "A", business_key: "code" }))).toEqual(["code"]);
  });
  it("normalizes a composite business_key array", () => {
    expect(
      businessKeyFields(entity({ name: "A", business_key: ["warehouse", "product"] })),
    ).toEqual(["warehouse", "product"]);
  });
  it("returns [] when no business_key", () => {
    expect(businessKeyFields(entity({ name: "A" }))).toEqual([]);
  });
});

describe("businessKeyOf", () => {
  it("single field", () => {
    expect(businessKeyOf({ code: "C1" }, ["code"])).toBe("C1");
  });
  it("composite is NUL-joined (collision-proof internal key)", () => {
    // NUL can never appear in a real value, so composite parts never collide
    // (a printable separator would: ("a b","c") vs ("a","b c")). Matches the
    // boot seed loader — behavior-identical. Never exported (guarded in idToBkMap).
    expect(businessKeyOf({ w: "W1", p: "P1" }, ["w", "p"])).toBe("W1\x00P1");
  });
  it("undefined when a single key is null", () => {
    expect(businessKeyOf({ code: null }, ["code"])).toBeUndefined();
  });
  it("undefined on a partial composite", () => {
    expect(businessKeyOf({ w: "W1" }, ["w", "p"])).toBeUndefined();
  });
});

describe("resolveLinksByBk", () => {
  const fields = [
    { fieldname: "group", fieldtype: "Link", target: "Group" },
    { fieldname: "vendor", fieldtype: "Link", target: "Vendor" }, // no bk index
    {
      fieldname: "lines",
      fieldtype: "Table",
      child_fields: [{ fieldname: "account", fieldtype: "Link", target: "Account" }],
    },
  ] as EntityDefinition["fields"];

  it("resolves a top-level Link by bk and recurses into child tables", () => {
    const idx: BkIndex = new Map([
      ["Group", new Map([["G-CODE", "gid1"]])],
      ["Account", new Map([["ACC-1", "acc1"]])],
    ]);
    const row: Record<string, unknown> = {
      group: "G-CODE",
      vendor: "V-RAW", // target Vendor not in idx → untouched
      lines: [{ account: "ACC-1" }, { account: "ACC-1" }],
    };
    const unresolved = resolveLinksByBk(fields, row, idx);
    expect(row.group).toBe("gid1");
    expect(row.vendor).toBe("V-RAW");
    expect((row.lines as Record<string, unknown>[])[0]!.account).toBe("acc1");
    expect(unresolved).toEqual([]);
  });

  it("reports an unresolved value for a bk-bearing target that matched nothing", () => {
    const idx: BkIndex = new Map([["Group", new Map()], ["Account", new Map()]]);
    const row: Record<string, unknown> = { group: "MISSING", lines: [{ account: "NOPE" }] };
    const unresolved = resolveLinksByBk(fields, row, idx);
    expect(row.group).toBe("MISSING"); // left in place → DocumentService fails loud
    expect(unresolved).toEqual([
      { field: "group", target: "Group", value: "MISSING" },
      { field: "account", target: "Account", value: "NOPE" },
    ]);
  });
});

function mockDb(byColl: Record<string, Record<string, unknown>[]>): MongoDBService {
  return {
    find: vi.fn(async (coll: string, options: { filters?: unknown[] }, _target: string) => {
      const all = byColl[coll] ?? [];
      const filters = options.filters ?? [];
      if (filters.length === 0) return all;
      // Support a single { _id: { $in: [...] } } filter for idToBkMap.
      const f = filters[0] as Record<string, { $in?: string[] }>;
      const ids = f._id?.$in ?? [];
      return all.filter((d) => ids.includes(String(d._id)));
    }),
  } as unknown as MongoDBService;
}

describe("BkResolver.indexEntity", () => {
  it("builds bk → id via targeted projection and keeps pre-existing entries (!idx.has precedence)", async () => {
    const reg = new EntityRegistry();
    const Group = entity({ name: "Group", business_key: "code" });
    reg.register(Group);
    const db = mockDb({ Group: [{ _id: "gid-db", code: "C1" }, { _id: "gid2", code: "C2" }] });
    const resolver = new BkResolver(reg, db);

    const idx = new Map<string, string>([["C1", "gid-uploaded"]]);
    await resolver.indexEntity(Group, idx);

    expect(idx.get("C1")).toBe("gid-uploaded"); // uploaded wins
    expect(idx.get("C2")).toBe("gid2"); // db-only entry added
  });

  it("is a no-op for a bk-less entity", async () => {
    const reg = new EntityRegistry();
    const Thing = entity({ name: "Thing" });
    reg.register(Thing);
    const db = mockDb({});
    const resolver = new BkResolver(reg, db);
    const idx = new Map<string, string>();
    await resolver.indexEntity(Thing, idx);
    expect(idx.size).toBe(0);
    expect(db.find).not.toHaveBeenCalled();
  });
});

describe("BkResolver.indexLinkTargets", () => {
  it("indexes every bk-bearing Link target (top-level + child), skips bk-less, adds self when asked", async () => {
    const reg = new EntityRegistry();
    reg.register(entity({ name: "Group", business_key: "code" }));
    reg.register(entity({ name: "Vendor" })); // no bk → skipped
    reg.register(entity({ name: "Account", business_key: "acc_no" }));
    const Item = entity({
      name: "Item",
      business_key: "item_no",
      fields: [
        { fieldname: "group", fieldtype: "Link", target: "Group" },
        { fieldname: "vendor", fieldtype: "Link", target: "Vendor" },
        { fieldname: "parent", fieldtype: "Link", target: "Item" },
        {
          fieldname: "lines",
          fieldtype: "Table",
          child_fields: [{ fieldname: "account", fieldtype: "Link", target: "Account" }],
        },
      ] as EntityDefinition["fields"],
    });
    reg.register(Item);
    const db = mockDb({
      Group: [{ _id: "g1", code: "G1" }],
      Account: [{ _id: "a1", acc_no: "A1" }],
      Item: [{ _id: "i1", item_no: "I1" }],
    });
    const resolver = new BkResolver(reg, db);

    const idx = await resolver.indexLinkTargets(Item, { includeSelf: true });
    expect(idx.get("Group")?.get("G1")).toBe("g1");
    expect(idx.get("Account")?.get("A1")).toBe("a1");
    expect(idx.get("Item")?.get("I1")).toBe("i1"); // self included
    expect(idx.has("Vendor")).toBe(false); // bk-less → not indexed
  });
});

describe("BkResolver.idToBkMap", () => {
  it("reverse-maps id → bk via ONE $in batch", async () => {
    const reg = new EntityRegistry();
    const Group = entity({ name: "Group", business_key: "code" });
    reg.register(Group);
    const db = mockDb({ Group: [{ _id: "g1", code: "G1" }, { _id: "g2", code: "G2" }] });
    const resolver = new BkResolver(reg, db);

    const map = await resolver.idToBkMap(Group, ["g1", "g2"]);
    expect(map.get("g1")).toBe("G1");
    expect(map.get("g2")).toBe("G2");
    expect(db.find).toHaveBeenCalledTimes(1);
  });
});
