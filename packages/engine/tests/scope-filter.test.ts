import { describe, it, expect } from "vitest";
import {
  applyScopeFilters,
  applyRoleVisibilityFilter,
  isRoleVisible,
  permissionRowsFor,
  scopeValueMatches,
} from "../src/core/permissions/scope-filter.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import type { UserContext } from "../src/core/permissions/types.js";

// Minimal entity factory — only `permissions` matters for scope filtering.
function entityWith(perms: unknown[]): EntityDefinition {
  return { name: "Doc", permissions: perms } as unknown as EntityDefinition;
}
function user(roles: string[], extra: Record<string, unknown> = {}): UserContext {
  return { _id: "u1", email: "u1@test.local", roles, ...extra } as unknown as UserContext;
}
const P = (role: string, opts: Record<string, unknown> = {}) => ({
  role,
  level: 0,
  read: 1,
  ...opts,
});

describe("applyScopeFilters (D10c — union/OR semantics)", () => {
  it("Administrator sees everything (filters untouched)", () => {
    const e = entityWith([P("Sales", { scope: { field: "dept", user_field: "department" } })]);
    expect(applyScopeFilters(e, user(["Administrator"], { department: "X" }), {})).toEqual({});
  });

  it("single scoped role → flat field filter", () => {
    const e = entityWith([P("Sales", { scope: { field: "dept", user_field: "department" } })]);
    expect(applyScopeFilters(e, user(["Sales"], { department: "Sales" }), {})).toEqual({ dept: "Sales" });
  });

  it("two roles with DIFFERENT scope fields → OR (union), not AND", () => {
    const e = entityWith([
      P("Sales", { scope: { field: "dept", user_field: "department" } }),
      P("Region", { scope: { field: "region", user_field: "region" } }),
    ]);
    const r = applyScopeFilters(e, user(["Sales", "Region"], { department: "Sales", region: "EU" }), {});
    expect(r).toEqual({ $or: [{ dept: "Sales" }, { region: "EU" }] });
  });

  it("if_owner role → owner filter; combined with scope role → OR", () => {
    const e = entityWith([
      P("Sales", { scope: { field: "dept", user_field: "department" } }),
      P("Self", { if_owner: true }),
    ]);
    const r = applyScopeFilters(e, user(["Sales", "Self"], { department: "Sales" }), {});
    expect(r).toEqual({ $or: [{ dept: "Sales" }, { owner: "u1@test.local" }] });
  });

  it("counts only a level-0 read row: an unrestricted read row of a higher level opens no rows", () => {
    const e = entityWith([P("Sales", { if_owner: true }), P("Sales", { level: 1 })]);
    expect(applyScopeFilters(e, user(["Sales"]), {})).toEqual({ owner: "u1@test.local" });
  });

  it("an unrestricted read role (no scope, no if_owner) → no scope filter", () => {
    const e = entityWith([
      P("Sales", { scope: { field: "dept", user_field: "department" } }),
      P("Manager"), // unrestricted read
    ]);
    expect(applyScopeFilters(e, user(["Sales", "Manager"], { department: "Sales" }), {})).toEqual({});
  });

  it("a single perm with BOTH scope and if_owner → AND them (row must match scope AND be owned)", () => {
    const e = entityWith([
      P("Sales", { scope: { field: "dept", user_field: "department" }, if_owner: true }),
    ]);
    const r = applyScopeFilters(e, user(["Sales"], { department: "Sales" }), {});
    expect(r).toEqual({ $and: [{ dept: "Sales" }, { owner: "u1@test.local" }] });
  });

  it("scope configured but user has no value → sees nothing (no leak)", () => {
    const e = entityWith([P("Sales", { scope: { field: "dept", user_field: "department" } })]);
    expect(applyScopeFilters(e, user(["Sales"], {}), {})).toEqual({ _id: { $in: [] } });
  });

  it("multiple conditions AND-combine with pre-existing filters", () => {
    const e = entityWith([
      P("Sales", { scope: { field: "dept", user_field: "department" } }),
      P("Self", { if_owner: true }),
    ]);
    const r = applyScopeFilters(e, user(["Sales", "Self"], { department: "Sales" }), { status: "open" });
    expect(r).toEqual({ $and: [{ status: "open" }, { $or: [{ dept: "Sales" }, { owner: "u1@test.local" }] }] });
  });

  it("no read permission → filters untouched", () => {
    const e = entityWith([P("Other", { read: 0 })]);
    expect(applyScopeFilters(e, user(["Other"]), { a: 1 })).toEqual({ a: 1 });
  });

  it("ANDs the caller's filter with a scope on the same field instead of replacing it", () => {
    const e = entityWith([P("Sales", { scope: { field: "dept", user_field: "department" } })]);
    expect(applyScopeFilters(e, user(["Sales"], { department: "Sales" }), { dept: { $regex: "Sal" } })).toEqual({
      $and: [{ dept: { $regex: "Sal" } }, { dept: "Sales" }],
    });
  });

  it("a user value that is a list matches a row through any of its members, in a list and in one row", () => {
    const e = entityWith([P("Sales", { scope: { field: "dept", user_field: "departments" } })]);
    expect(applyScopeFilters(e, user(["Sales"], { departments: ["A", "B"] }), {})).toEqual({ dept: { $in: ["A", "B"] } });
    expect(scopeValueMatches("B", ["A", "B"])).toBe(true);
    expect(scopeValueMatches(["C", "B"], ["A", "B"])).toBe(true);
    expect(scopeValueMatches("C", ["A", "B"])).toBe(false);
    expect(scopeValueMatches("A", [])).toBe(false);
  });
});

describe("permissionRowsFor — a row is meant for the roles its role_visibility_field lists", () => {
  const declared = [P("System User", { select: 1 }), P("Desk", { select: 1, condition: "eval:doc.status == 'Open'" })];
  const listed = (): EntityDefinition =>
    ({ name: "Workspace", role_visibility_field: "roles", permissions: declared }) as unknown as EntityDefinition;

  it("lets each role that no declared row names select and read the rows that list one of the user's roles", () => {
    const scoped = { level: 0, select: 1, read: 1, scope: { field: "roles", user_field: "roles" } };
    expect(permissionRowsFor(listed(), user(["Reception", "Technician"]))).toEqual([
      { role: "Reception", ...scoped },
      { role: "Technician", ...scoped },
    ]);
  });

  it("keeps the declared rows for a user whose role a declared row names, so a listed role never widens them", () => {
    expect(permissionRowsFor(listed(), user(["System User", "Reception"]))).toBe(declared);
    expect(permissionRowsFor(listed(), user(["Desk"]))).toBe(declared);
  });

  it("gives nothing, and does not fail, on an entity that declares no permissions", () => {
    const bare = { name: "Workspace", role_visibility_field: "roles" } as unknown as EntityDefinition;
    expect(permissionRowsFor(bare, user(["Reception"]))).toEqual([]);
    expect(applyScopeFilters(bare, user(["Reception"]), { a: 1 })).toEqual({ a: 1 });
  });

  it("gives Guest, a user with no role and an entity without the field only the declared rows", () => {
    expect(permissionRowsFor(listed(), user(["Guest"]))).toBe(declared);
    expect(permissionRowsFor(listed(), user([]))).toEqual([]);
    expect(permissionRowsFor(entityWith(declared), user(["Reception"]))).toEqual(declared);
  });
});

describe("applyRoleVisibilityFilter / isRoleVisible", () => {
  const wsEntity = (): EntityDefinition =>
    ({ name: "Workspace", role_visibility_field: "roles", permissions: [] }) as unknown as EntityDefinition;
  const plain = (): EntityDefinition =>
    ({ name: "Doc", permissions: [] }) as unknown as EntityDefinition;

  it("entity without role_visibility_field → unchanged + always visible", () => {
    expect(applyRoleVisibilityFilter(plain(), user(["X"]), { a: 1 })).toEqual({ a: 1 });
    expect(isRoleVisible(plain(), user(["X"]), { roles: ["Y"] })).toBe(true);
  });

  it("Administrator bypasses the visibility filter", () => {
    expect(applyRoleVisibilityFilter(wsEntity(), user(["Administrator"]), {})).toEqual({});
    expect(isRoleVisible(wsEntity(), user(["Administrator"]), { roles: ["Manager"] })).toBe(true);
  });

  it("non-admin → OR(empty/absent/intersects) filter", () => {
    const f = applyRoleVisibilityFilter(wsEntity(), user(["Manager"]), {}) as { $or: unknown[] };
    expect(f.$or).toEqual([
      { roles: { $exists: false } },
      { roles: null },
      { roles: { $size: 0 } },
      { roles: { $in: ["Manager"] } },
    ]);
  });

  it("isRoleVisible: empty/absent roles = visible to all; non-empty needs intersection", () => {
    const u = user(["Operator"]);
    expect(isRoleVisible(wsEntity(), u, {})).toBe(true); // absent
    expect(isRoleVisible(wsEntity(), u, { roles: [] })).toBe(true); // empty
    expect(isRoleVisible(wsEntity(), u, { roles: ["Operator"] })).toBe(true); // intersects
    expect(isRoleVisible(wsEntity(), u, { roles: ["Manager"] })).toBe(false); // disjoint
  });
});
