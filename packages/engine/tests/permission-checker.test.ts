import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// PermissionChecker now imports env (permission-scope gate). Stub it so the
// module graph doesn't demand MONGODB_URI; the object is mutable so the scope
// tests can toggle PERMISSION_SCOPE_ENABLED at runtime.
vi.mock("../src/core/config/env.js", () => ({
  env: { PERMISSION_SCOPE_ENABLED: false },
}));

import { env } from "../src/core/config/env.js";

// Mock the logger so env.ts is never evaluated during tests (it requires MONGODB_URI)
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import { PermissionChecker, PermissionDeniedError } from "../src/core/permissions/permission-checker.js";
import type { UserContext } from "../src/core/permissions/types.js";

// ─── Mock EntityRegistry ─────────────────────────────────────────────────────

class MockEntityRegistry {
  private entities = new Map<string, EntityDefinition>();
  register(entity: EntityDefinition) { this.entities.set(entity.name, entity); }
  get(name: string): EntityDefinition { return this.entities.get(name)!; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<EntityDefinition> = {}): EntityDefinition {
  return {
    name: "TestDoc",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title" },
      { fieldname: "amount", fieldtype: "Currency", label: "Amount" },
      { fieldname: "secret", fieldtype: "Data", label: "Secret", perm_level: 1 },
    ],
    permissions: [],
    ...overrides,
  };
}

function makeUser(overrides: Partial<UserContext> = {}): UserContext {
  return {
    _id: "user-001",
    email: "user@example.com",
    roles: ["System User"],
    ...overrides,
  };
}

function adminUser(): UserContext {
  return {
    _id: "admin-001",
    email: "admin@example.com",
    roles: [SYSTEM_ROLES.ADMINISTRATOR],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PermissionChecker", () => {
  let registry: MockEntityRegistry;
  let checker: PermissionChecker;

  beforeEach(() => {
    registry = new MockEntityRegistry();
    checker = new PermissionChecker(registry as never);
  });

  // ── Administrator bypass ──────────────────────────────────────────────────

  describe("Administrator bypass", () => {
    it("hasPermission returns allowed=true for Administrator on any action", async () => {
      registry.register(makeEntity({ permissions: [] }));
      const result = await checker.hasPermission(adminUser(), "TestDoc", "read");
      expect(result).toEqual({ allowed: true });
    });

    it("check does not throw for Administrator even with no permissions defined", async () => {
      registry.register(makeEntity({ permissions: [] }));
      await expect(checker.check(adminUser(), "TestDoc", "delete")).resolves.toBeUndefined();
    });

    it("getReadableFields returns null (all fields) for Administrator", () => {
      registry.register(makeEntity());
      expect(checker.getReadableFields(adminUser(), "TestDoc")).toBeNull();
    });

    it("getWritableFields returns null (all fields) for Administrator", () => {
      registry.register(makeEntity());
      expect(checker.getWritableFields(adminUser(), "TestDoc")).toBeNull();
    });

    it("filterFieldsForRead returns original data unchanged for Administrator", () => {
      registry.register(makeEntity());
      const data = { title: "Hello", amount: 42, secret: "shh" };
      expect(checker.filterFieldsForRead(adminUser(), "TestDoc", data)).toEqual(data);
    });
  });

  // ── No permissions defined ────────────────────────────────────────────────

  describe("No permissions defined", () => {
    it("hasPermission returns allowed=false with reason when permissions array is empty", async () => {
      registry.register(makeEntity({ permissions: [] }));
      const result = await checker.hasPermission(makeUser(), "TestDoc", "read");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("No permissions defined");
    });

    it("check throws PermissionDeniedError when no permissions defined", async () => {
      registry.register(makeEntity({ permissions: [] }));
      await expect(checker.check(makeUser(), "TestDoc", "read")).rejects.toThrow(PermissionDeniedError);
    });
  });

  // ── No matching role ──────────────────────────────────────────────────────

  describe("No matching role", () => {
    it("hasPermission returns allowed=false when user has no matching role", async () => {
      registry.register(makeEntity({
        permissions: [{ role: "Manager", level: 0, read: 1 }],
      }));
      const result = await checker.hasPermission(makeUser({ roles: ["Guest"] }), "TestDoc", "read");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("No matching role");
    });

    it("check throws PermissionDeniedError when user role does not match", async () => {
      registry.register(makeEntity({
        permissions: [{ role: "Manager", level: 0, read: 1 }],
      }));
      await expect(
        checker.check(makeUser({ roles: ["Guest"] }), "TestDoc", "read"),
      ).rejects.toThrow(PermissionDeniedError);
    });
  });

  // ── Action types ──────────────────────────────────────────────────────────

  describe("All 14 action types", () => {
    const actions = [
      "select", "read", "write", "create", "delete",
      "submit", "cancel", "amend", "print", "email",
      "export", "import", "share", "report",
    ] as const;

    for (const action of actions) {
      it(`grants "${action}" when perm has ${action}=1`, async () => {
        registry.register(makeEntity({
          permissions: [{ role: "System User", level: 0, [action]: 1 }],
        }));
        const result = await checker.hasPermission(makeUser(), "TestDoc", action);
        expect(result.allowed).toBe(true);
      });

      it(`denies "${action}" when perm has ${action}=0`, async () => {
        registry.register(makeEntity({
          permissions: [{ role: "System User", level: 0, [action]: 0 }],
        }));
        const result = await checker.hasPermission(makeUser(), "TestDoc", action);
        expect(result.allowed).toBe(false);
      });
    }

    it("denies unknown action string", async () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, read: 1 }],
      }));
      const result = await checker.hasPermission(makeUser(), "TestDoc", "unknown_action");
      expect(result.allowed).toBe(false);
    });
  });

  // ── if_owner ──────────────────────────────────────────────────────────────

  describe("if_owner", () => {
    beforeEach(() => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, read: 1, if_owner: true }],
      }));
    });

    it("allows when doc.owner matches user email", async () => {
      const result = await checker.hasPermission(
        makeUser({ email: "user@example.com" }),
        "TestDoc",
        "read",
        { owner: "user@example.com" },
      );
      expect(result.allowed).toBe(true);
    });

    it("allows when doc.owner matches user._id", async () => {
      const result = await checker.hasPermission(
        makeUser({ _id: "user-001", email: "user@example.com" }),
        "TestDoc",
        "read",
        { owner: "user-001" },
      );
      expect(result.allowed).toBe(true);
    });

    it("denies when doc.owner does not match user", async () => {
      const result = await checker.hasPermission(
        makeUser({ _id: "user-001", email: "user@example.com" }),
        "TestDoc",
        "read",
        { owner: "someone-else@example.com" },
      );
      expect(result.allowed).toBe(false);
    });

    it("allows when no doc is provided (if_owner only applies with doc)", async () => {
      // Without doc, if_owner is not evaluated — perm passes normally
      // The current implementation only checks if_owner when doc is provided
      const result = await checker.hasPermission(
        makeUser(),
        "TestDoc",
        "read",
        undefined,
      );
      expect(result.allowed).toBe(true);
    });
  });

  // ── condition ─────────────────────────────────────────────────────────────

  describe("condition evaluation", () => {
    it("allows when condition evaluates to true (truthy field check)", async () => {
      // Use a simple truthy check — expression evaluator fully supports "doc.field"
      registry.register(makeEntity({
        permissions: [{
          role: "System User",
          level: 0,
          read: 1,
          condition: "doc.is_approved",
        }],
      }));
      const result = await checker.hasPermission(
        makeUser(),
        "TestDoc",
        "read",
        { is_approved: true },
      );
      expect(result.allowed).toBe(true);
    });

    it("denies when condition evaluates to false (falsy field check)", async () => {
      // Use a simple truthy check — "doc.is_approved" is falsy when undefined/false/0
      registry.register(makeEntity({
        permissions: [{
          role: "System User",
          level: 0,
          read: 1,
          condition: "doc.is_approved",
        }],
      }));
      const result = await checker.hasPermission(
        makeUser(),
        "TestDoc",
        "read",
        { is_approved: false },
      );
      expect(result.allowed).toBe(false);
    });

    it("allows when condition uses numeric comparison and evaluates true", async () => {
      // Use > comparison — not blocked by the expression evaluator's safety filter
      registry.register(makeEntity({
        permissions: [{
          role: "System User",
          level: 0,
          read: 1,
          condition: "eval:doc.docstatus > 0",
        }],
      }));
      const result = await checker.hasPermission(
        makeUser(),
        "TestDoc",
        "read",
        { docstatus: 1 },
      );
      expect(result.allowed).toBe(true);
    });

    it("denies when condition uses numeric comparison and evaluates false", async () => {
      registry.register(makeEntity({
        permissions: [{
          role: "System User",
          level: 0,
          read: 1,
          condition: "eval:doc.grand_total > 0",
        }],
      }));
      const result = await checker.hasPermission(
        makeUser(),
        "TestDoc",
        "read",
        { grand_total: 0 },
      );
      expect(result.allowed).toBe(false);
    });

    it("skips condition check when doc is not provided", async () => {
      registry.register(makeEntity({
        permissions: [{
          role: "System User",
          level: 0,
          read: 1,
          // This condition would be false if doc.is_approved is absent/falsy,
          // but without a doc the condition branch is skipped entirely → perm passes
          condition: "doc.is_approved",
        }],
      }));
      // No doc → condition branch is not entered → perm passes
      const result = await checker.hasPermission(makeUser(), "TestDoc", "read");
      expect(result.allowed).toBe(true);
    });
  });

  // ── scope ─────────────────────────────────────────────────────────────────

  describe("scope", () => {
    // Scope enforcement is gated by PERMISSION_SCOPE_ENABLED (off by default so it
    // stays inert until the principal carries the scope claim); enable it here.
    beforeEach(() => {
      (env as { PERMISSION_SCOPE_ENABLED: boolean }).PERMISSION_SCOPE_ENABLED = true;
      registry.register(makeEntity({
        permissions: [{
          role: "System User",
          level: 0,
          read: 1,
          scope: { field: "department", user_field: "department" },
        }],
      }));
    });
    afterEach(() => {
      (env as { PERMISSION_SCOPE_ENABLED: boolean }).PERMISSION_SCOPE_ENABLED = false;
    });

    it("allows when doc scope field matches user scope field", async () => {
      const result = await checker.hasPermission(
        makeUser({ department: "Engineering" }),
        "TestDoc",
        "read",
        { department: "Engineering" },
      );
      expect(result.allowed).toBe(true);
    });

    it("denies when doc scope field does not match user scope field", async () => {
      const result = await checker.hasPermission(
        makeUser({ department: "Engineering" }),
        "TestDoc",
        "read",
        { department: "Sales" },
      );
      expect(result.allowed).toBe(false);
    });

    it("skips scope check when doc is not provided", async () => {
      const result = await checker.hasPermission(
        makeUser({ department: "Engineering" }),
        "TestDoc",
        "read",
        undefined,
      );
      expect(result.allowed).toBe(true);
    });

    it("allows when the doc scope field is an ARRAY containing the user's value (membership)", async () => {
      // Aligns single-doc read with the Mongo list filter, which matches array
      // membership — a doc belonging to several scopes is visible to each.
      const result = await checker.hasPermission(
        makeUser({ department: "Engineering" }),
        "TestDoc",
        "read",
        { department: ["Engineering", "Sales"] },
      );
      expect(result.allowed).toBe(true);
    });

    it("denies when the doc scope array does not contain the user's value", async () => {
      const result = await checker.hasPermission(
        makeUser({ department: "Engineering" }),
        "TestDoc",
        "read",
        { department: ["Sales", "Finance"] },
      );
      expect(result.allowed).toBe(false);
    });
  });

  // ── Multiple roles — first match wins ─────────────────────────────────────

  describe("multiple matching roles", () => {
    it("grants access if any matching permission allows the action", async () => {
      registry.register(makeEntity({
        permissions: [
          { role: "System User", level: 0, read: 0 },
          { role: "Editor", level: 0, read: 1 },
        ],
      }));
      const result = await checker.hasPermission(
        makeUser({ roles: ["System User", "Editor"] }),
        "TestDoc",
        "read",
      );
      expect(result.allowed).toBe(true);
    });

    it("denies if all matching permissions deny the action", async () => {
      registry.register(makeEntity({
        permissions: [
          { role: "System User", level: 0, read: 0 },
          { role: "Editor", level: 0, read: 0 },
        ],
      }));
      const result = await checker.hasPermission(
        makeUser({ roles: ["System User", "Editor"] }),
        "TestDoc",
        "read",
      );
      expect(result.allowed).toBe(false);
    });
  });

  // ── check() throws ────────────────────────────────────────────────────────

  describe("check()", () => {
    it("resolves without error when permission is granted", async () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, read: 1 }],
      }));
      await expect(checker.check(makeUser(), "TestDoc", "read")).resolves.toBeUndefined();
    });

    it("throws PermissionDeniedError with correct user/entity/action", async () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, read: 0 }],
      }));
      const err = await checker.check(makeUser(), "TestDoc", "read").catch((e) => e);
      expect(err).toBeInstanceOf(PermissionDeniedError);
      expect(err.user).toBe("user@example.com");
      expect(err.entity).toBe("TestDoc");
      expect(err.action).toBe("read");
      expect(err.message).toContain("Permission denied");
    });
  });

  // ── getReadableFields ─────────────────────────────────────────────────────

  describe("getReadableFields", () => {
    it("returns null for Administrator (all fields readable)", () => {
      registry.register(makeEntity({
        permissions: [{ role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, read: 1 }],
      }));
      expect(checker.getReadableFields(adminUser(), "TestDoc")).toBeNull();
    });

    it("returns Set of fields at readable perm_level when perm has read=1", () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, read: 1 }],
      }));
      const fields = checker.getReadableFields(makeUser(), "TestDoc");
      expect(fields).not.toBeNull();
      expect(fields!.has("title")).toBe(true);
      expect(fields!.has("amount")).toBe(true);
    });

    it("excludes fields at perm_level 1 when only level 0 read perm exists", () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, read: 1 }],
      }));
      const fields = checker.getReadableFields(makeUser(), "TestDoc");
      expect(fields!.has("secret")).toBe(false); // secret is perm_level 1
    });

    it("includes level-1 fields when user has level-1 read permission", () => {
      registry.register(makeEntity({
        permissions: [
          { role: "System User", level: 0, read: 1 },
          { role: "System User", level: 1, read: 1 },
        ],
      }));
      const fields = checker.getReadableFields(makeUser(), "TestDoc");
      expect(fields!.has("secret")).toBe(true);
    });

    it("always includes standard system fields", () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, read: 1 }],
      }));
      const fields = checker.getReadableFields(makeUser(), "TestDoc");
      for (const sf of ["_id", "doctype", "docstatus", "owner", "modified_by", "creation", "modified"]) {
        expect(fields!.has(sf)).toBe(true);
      }
    });

    it("returns Set with only standard fields when user has no read perm at any level", () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, read: 0 }],
      }));
      const fields = checker.getReadableFields(makeUser(), "TestDoc");
      expect(fields!.has("title")).toBe(false);
      expect(fields!.has("_id")).toBe(true); // standard fields always present
    });
  });

  // ── getWritableFields ─────────────────────────────────────────────────────

  describe("getWritableFields", () => {
    it("returns null for Administrator", () => {
      registry.register(makeEntity());
      expect(checker.getWritableFields(adminUser(), "TestDoc")).toBeNull();
    });

    it("returns writable fields based on perm_level write permission", () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, write: 1 }],
      }));
      const fields = checker.getWritableFields(makeUser(), "TestDoc");
      expect(fields!.has("title")).toBe(true);
      expect(fields!.has("amount")).toBe(true);
    });

    it("excludes read_only fields even if perm level matches", () => {
      registry.register(makeEntity({
        fields: [
          { fieldname: "title", fieldtype: "Data", label: "Title" },
          { fieldname: "locked", fieldtype: "Data", label: "Locked", read_only: true },
        ],
        permissions: [{ role: "System User", level: 0, write: 1 }],
      }));
      const fields = checker.getWritableFields(makeUser(), "TestDoc");
      expect(fields!.has("title")).toBe(true);
      expect(fields!.has("locked")).toBe(false);
    });

    it("excludes File.is_private from writable fields — a client can't flip a private file public", () => {
      // Mirrors the File entity: System User has if_owner write, but is_private is
      // read_only (server-managed at upload), so filterFieldsForWrite drops it.
      registry.register(
        makeEntity({
          fields: [
            { fieldname: "title", fieldtype: "Data", label: "Title" },
            { fieldname: "is_private", fieldtype: "Check", label: "Private", read_only: true },
          ],
          permissions: [{ role: "System User", level: 0, write: 1, if_owner: true }],
        }),
      );
      const fields = checker.getWritableFields(makeUser(), "TestDoc");
      expect(fields!.has("title")).toBe(true);
      expect(fields!.has("is_private")).toBe(false);
    });

    it("gates a conditional perm_level — an if_owner level-1 read exposes level-1 fields only on OWNED docs (H-P1)", () => {
      registry.register(
        makeEntity({
          permissions: [
            { role: "System User", level: 0, read: 1 }, // unconditional level-0 read
            { role: "System User", level: 1, read: 1, if_owner: true }, // level-1 only for own docs
          ],
        }),
      );
      const u = makeUser({ email: "user@example.com" });
      // Own doc → the level-1 "secret" field is readable.
      expect(checker.getReadableFields(u, "TestDoc", { owner: "user@example.com" })!.has("secret")).toBe(
        true,
      );
      // Not-owned doc (still readable via level-0) → level-1 field is masked.
      const other = checker.getReadableFields(u, "TestDoc", { owner: "someone-else@x.io" });
      expect(other!.has("title")).toBe(true);
      expect(other!.has("secret")).toBe(false);
      // No doc (field-SET query) → the conditional level is a potential grant.
      expect(checker.getReadableFields(u, "TestDoc")!.has("secret")).toBe(true);
    });

    it("excludes level-1 fields when user only has level-0 write perm", () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, write: 1 }],
      }));
      const fields = checker.getWritableFields(makeUser(), "TestDoc");
      expect(fields!.has("secret")).toBe(false);
    });

    it("returns empty Set when write=0", () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, write: 0 }],
      }));
      const fields = checker.getWritableFields(makeUser(), "TestDoc");
      expect(fields!.size).toBe(0);
    });
  });

  // ── filterFieldsForRead ───────────────────────────────────────────────────

  describe("filterFieldsForRead", () => {
    it("returns all data unchanged for Administrator (null readable fields)", () => {
      registry.register(makeEntity());
      const data = { title: "T", amount: 99, secret: "x", _custom: "y" };
      expect(checker.filterFieldsForRead(adminUser(), "TestDoc", data)).toEqual(data);
    });

    it("strips fields not in readable set", () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, read: 1 }],
      }));
      // secret is perm_level 1, not readable at level 0
      const data = { title: "Hello", amount: 10, secret: "hidden" };
      const result = checker.filterFieldsForRead(makeUser(), "TestDoc", data);
      expect(result.title).toBe("Hello");
      expect(result.amount).toBe(10);
      expect("secret" in result).toBe(false);
    });

    it("keeps fields starting with underscore regardless of readable set", () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, read: 1 }],
      }));
      const data = { title: "Hello", _meta: "internal", _rev: 42 };
      const result = checker.filterFieldsForRead(makeUser(), "TestDoc", data);
      expect(result._meta).toBe("internal");
      expect(result._rev).toBe(42);
    });

    it("keeps standard system fields that are always readable", () => {
      registry.register(makeEntity({
        permissions: [{ role: "System User", level: 0, read: 1 }],
      }));
      const data = { title: "T", owner: "admin@example.com", docstatus: 0 };
      const result = checker.filterFieldsForRead(makeUser(), "TestDoc", data);
      expect(result.owner).toBe("admin@example.com");
      expect(result.docstatus).toBe(0);
    });
  });

  // ─── State-strip enforcement (B.1) ────────────────────────────────────────
  describe("workflow state permission strips", () => {
    function workflowEntity(): EntityDefinition {
      return makeEntity({
        states: [
          { value: "draft", color: "gray" },
          {
            value: "approved",
            color: "green",
            permissions: [{ role: "Salesperson", write: 0, delete: 0 }],
          },
        ],
        permissions: [
          { role: "Salesperson", level: 0, read: 1, write: 1, delete: 1 },
          { role: "Manager", level: 0, read: 1, write: 1, delete: 1 },
        ],
      });
    }

    it("strips `write` for the role flagged in the current state", async () => {
      registry.register(workflowEntity());
      checker.setWorkflowEngine({
        resolveStateOverride(_e, doc, role) {
          if (!doc) return null;
          const state = doc["status"];
          if (state !== "approved") return null;
          if (role !== "Salesperson") return null;
          return { role: "Salesperson", write: 0, delete: 0 };
        },
      });
      const sales = makeUser({ roles: ["Salesperson"] });
      const draft = await checker.hasPermission(sales, "TestDoc", "write", { status: "draft" });
      expect(draft.allowed).toBe(true);
      const approved = await checker.hasPermission(sales, "TestDoc", "write", { status: "approved" });
      expect(approved.allowed).toBe(false);
    });

    it("multi-role: another non-stripped role still grants the action", async () => {
      registry.register(workflowEntity());
      checker.setWorkflowEngine({
        resolveStateOverride(_e, doc, role) {
          if (doc?.["status"] !== "approved") return null;
          if (role !== "Salesperson") return null;
          return { role: "Salesperson", write: 0 };
        },
      });
      // User with BOTH roles — Manager has no strip, so write is allowed.
      const both = makeUser({ roles: ["Salesperson", "Manager"] });
      const result = await checker.hasPermission(both, "TestDoc", "write", { status: "approved" });
      expect(result.allowed).toBe(true);
    });

    it("administrator bypasses state strips", async () => {
      registry.register(workflowEntity());
      checker.setWorkflowEngine({
        resolveStateOverride() {
          return { role: SYSTEM_ROLES.ADMINISTRATOR, write: 0 };
        },
      });
      const result = await checker.hasPermission(adminUser(), "TestDoc", "write", { status: "approved" });
      expect(result.allowed).toBe(true);
    });

    it("strip on `delete` blocks delete but leaves `read` intact", async () => {
      registry.register(workflowEntity());
      checker.setWorkflowEngine({
        resolveStateOverride(_e, doc, role) {
          if (doc?.["status"] !== "approved") return null;
          if (role !== "Salesperson") return null;
          return { role: "Salesperson", write: 0, delete: 0 };
        },
      });
      const sales = makeUser({ roles: ["Salesperson"] });
      const read = await checker.hasPermission(sales, "TestDoc", "read", { status: "approved" });
      expect(read.allowed).toBe(true);
      const del = await checker.hasPermission(sales, "TestDoc", "delete", { status: "approved" });
      expect(del.allowed).toBe(false);
    });

    it("no override declared → behaves identically to no workflowEngine", async () => {
      registry.register(workflowEntity());
      checker.setWorkflowEngine({
        resolveStateOverride() { return null; },
      });
      const sales = makeUser({ roles: ["Salesperson"] });
      const result = await checker.hasPermission(sales, "TestDoc", "write", { status: "draft" });
      expect(result.allowed).toBe(true);
    });
  });

  describe("read_only_depends_on server-side lock (A12)", () => {
    beforeEach(() => {
      registry.register(
        makeEntity({
          fields: [
            { fieldname: "status", fieldtype: "Data", label: "Status" },
            {
              fieldname: "discount",
              fieldtype: "Currency",
              label: "Discount",
              read_only_depends_on: "eval:doc.status=='approved'",
            },
          ],
          permissions: [{ role: "System User", level: 0, read: 1, write: 1 }],
        } as Partial<EntityDefinition>),
      );
    });
    const stored = { status: "approved", discount: 10 };

    it("rejects a write that CHANGES a currently-locked field", () => {
      expect(() =>
        checker.filterFieldsForWrite(makeUser(), "TestDoc", { discount: 90 }, stored),
      ).toThrow(PermissionDeniedError);
    });

    it("allows resending the UNCHANGED locked value (normal UI save)", () => {
      const out = checker.filterFieldsForWrite(makeUser(), "TestDoc", { discount: 10 }, stored);
      expect(out["discount"]).toBe(10);
    });

    it("allows changing the field when the lock condition is false", () => {
      const out = checker.filterFieldsForWrite(
        makeUser(),
        "TestDoc",
        { discount: 90 },
        { status: "draft", discount: 10 },
      );
      expect(out["discount"]).toBe(90);
    });
  });
});
