import { vi, describe, it, expect } from "vitest";

// Stub env + logger so importing the adapter / permission-checker doesn't demand
// MONGODB_URI. AUTH_ISSUER / AUTH_AUDIENCE are intentionally left undefined so
// the locally-signed test tokens (no iss/aud claims) verify; APP_NAME is empty
// because each test pins the engine's app explicitly via buildTestAuth(app);
// PERMISSION_SCOPE_ENABLED is false so the check exercises only role grants.
vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    APP_NAME: "",
    PERMISSION_SCOPE_ENABLED: false,
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import { scopeRolesToApp } from "../src/core/permissions/types.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import { buildTestAuth } from "./_test-auth.js";

// Minimal in-memory registry mirroring permission-checker.test.ts.
class MockEntityRegistry {
  private entities = new Map<string, EntityDefinition>();
  register(entity: EntityDefinition): void {
    this.entities.set(entity.name, entity);
  }
  get(name: string): EntityDefinition {
    return this.entities.get(name)!;
  }
}

// An entity that grants read ONLY to the bare role "Manager" — so a token must
// carry an honored "<app>:Manager" (stripped to "Manager") to read it. There is
// deliberately NO Administrator grant, so admin access can only come from the
// PermissionChecker's tenant-global Administrator bypass.
function managerReadableEntity(name: string): EntityDefinition {
  return {
    name,
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
    permissions: [{ role: "Manager", level: 0, select: 1, read: 1 }],
  };
}

// ─── Pure scoping logic (D3) ────────────────────────────────────────────────
describe("scopeRolesToApp (per-app role scoping, D3)", () => {
  it("drops another app's roles entirely", () => {
    expect(scopeRolesToApp(["erp:Manager"], "buildproject")).toEqual([]);
  });

  it("strips this app's prefix before permission mapping", () => {
    expect(scopeRolesToApp(["erp:Manager"], "erp")).toEqual(["Manager"]);
  });

  it("honors the tenant-global super-roles unprefixed in every app", () => {
    expect(scopeRolesToApp([SYSTEM_ROLES.ADMINISTRATOR], "buildproject")).toEqual([
      SYSTEM_ROLES.ADMINISTRATOR,
    ]);
    expect(scopeRolesToApp([SYSTEM_ROLES.SYSTEM_USER], "erp")).toEqual([SYSTEM_ROLES.SYSTEM_USER]);
  });

  it("keeps only this app's roles when a token mixes apps", () => {
    expect(
      scopeRolesToApp(
        ["erp:Sales", "buildproject:Manager", SYSTEM_ROLES.ADMINISTRATOR],
        "buildproject",
      ),
    ).toEqual(["Manager", SYSTEM_ROLES.ADMINISTRATOR]);
  });

  it("passes all roles through unchanged when APP_NAME is empty (legacy/dev)", () => {
    expect(scopeRolesToApp(["erp:Manager", "Manager"], "")).toEqual(["erp:Manager", "Manager"]);
  });

  it("de-duplicates after stripping", () => {
    expect(scopeRolesToApp(["erp:Manager", "Manager"], "erp")).toEqual(["Manager"]);
  });
});

// ─── End-to-end: token → JWKS verify → scope → permission ───────────────────
describe("engine honors only its own app's roles (token → verify → permission)", () => {
  it("an erp-only token resolves to ZERO permissions in a buildproject engine", async () => {
    const { authn, sign } = await buildTestAuth("buildproject");
    const token = await sign({ sub: "u1", email: "u1@example.com", roles: ["erp:Manager"] });

    const identity = await authn.verifyAccessToken(token);
    expect(identity.user.roles).toEqual([]); // erp:Manager dropped in a buildproject engine

    const registry = new MockEntityRegistry();
    registry.register(managerReadableEntity("BuildDoc"));
    const checker = new PermissionChecker(registry as never);

    const result = await checker.hasPermission(identity.user, "BuildDoc", "read");
    expect(result.allowed).toBe(false);
  });

  it("the same erp token IS authorized in an erp engine (prefix stripped to Manager)", async () => {
    const { authn, sign } = await buildTestAuth("erp");
    const token = await sign({ sub: "u1", email: "u1@example.com", roles: ["erp:Manager"] });

    const identity = await authn.verifyAccessToken(token);
    expect(identity.user.roles).toEqual(["Manager"]);

    const registry = new MockEntityRegistry();
    registry.register(managerReadableEntity("ErpDoc"));
    const checker = new PermissionChecker(registry as never);

    const result = await checker.hasPermission(identity.user, "ErpDoc", "read");
    expect(result.allowed).toBe(true);
  });

  it("Administrator is honored in BOTH a buildproject and an erp engine", async () => {
    for (const app of ["buildproject", "erp"] as const) {
      const { authn, sign } = await buildTestAuth(app);
      const token = await sign({
        sub: "admin",
        email: "admin@example.com",
        roles: [SYSTEM_ROLES.ADMINISTRATOR],
      });

      const identity = await authn.verifyAccessToken(token);
      expect(identity.user.roles).toEqual([SYSTEM_ROLES.ADMINISTRATOR]);

      const registry = new MockEntityRegistry();
      registry.register(managerReadableEntity(`Doc_${app}`)); // no Administrator grant
      const checker = new PermissionChecker(registry as never);

      // Allowed purely via the tenant-global Administrator bypass.
      const result = await checker.hasPermission(identity.user, `Doc_${app}`, "read");
      expect(result.allowed).toBe(true);
    }
  });
});

// ─── H18: token-type gate ───────────────────────────────────────────────────
// Access, refresh and pending tokens share one signing key / iss / aud — only
// `typ` distinguishes them. A refresh or (pre-2FA) pending token presented as a
// bearer must NOT verify as an access token.
describe("H18 — token type gate", () => {
  it("rejects a non-access token (refresh/pending) presented as a bearer", async () => {
    const { authn, sign } = await buildTestAuth("erp");
    const refresh = await sign({ sub: "u@x", email: "u@x", roles: ["erp:Manager"], typ: "refresh" });
    await expect(authn.verifyAccessToken(refresh)).rejects.toThrow(/token type/i);
  });

  it("accepts a normal access token", async () => {
    const { authn, sign } = await buildTestAuth("erp");
    const access = await sign({ sub: "u@x", email: "u@x", roles: ["erp:Manager"] });
    const id = await authn.verifyAccessToken(access);
    expect(id.user.email).toBe("u@x");
  });
});
