import { describe, it, expect } from "vitest";
import {
  applyScopeFilters,
  applyRoleVisibilityFilter,
  isRoleVisible,
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

  // Multi-company gate: with enforceScope=false a scope-only role is treated as
  // unrestricted (the feature stays inert until its env gate + auth claim land).
  it("enforceScope=false → scope ignored (unrestricted), if_owner still honored", () => {
    const scoped = entityWith([P("Sales", { scope: { field: "company", user_field: "company" } })]);
    expect(applyScopeFilters(scoped, user(["Sales"], { company: "ACME" }), {}, false)).toEqual({});

    const owned = entityWith([P("Self", { if_owner: true })]);
    expect(applyScopeFilters(owned, user(["Self"]), {}, false)).toEqual({ owner: "u1@test.local" });
  });

  it("enforceScope=true (default) → company scope applied", () => {
    const e = entityWith([P("Sales", { scope: { field: "company", user_field: "company" } })]);
    expect(applyScopeFilters(e, user(["Sales"], { company: "ACME" }), {})).toEqual({ company: "ACME" });
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
