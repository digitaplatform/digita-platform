import { describe, it, expect, vi } from "vitest";

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

import type { EntityDefinition } from "@digitaplatform/shared";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";

function entity(opts: Partial<EntityDefinition> & { name: string }): EntityDefinition {
  return {
    module: "test",
    database: "erp_master",
    naming: { strategy: "user_set" },
    fields: [],
    permissions: [],
    ...opts,
  } as EntityDefinition;
}

function scopedEntity(): EntityDefinition {
  return entity({
    name: "ScopedDoc",
    permissions: [
      { role: "Administrator", level: 0, read: 1, write: 1 },
      { role: "Zone Manager", level: 0, read: 1, scope: { field: "zone", user_field: "zone" } },
    ],
  } as unknown as EntityDefinition);
}

describe("EntityRegistry.auditUnenforcedScopes", () => {
  it("reports every scope declaration while enforcement is off", () => {
    const reg = new EntityRegistry();
    reg.register(scopedEntity());
    expect(reg.auditUnenforcedScopes(false)).toEqual([
      { entity: "ScopedDoc", role: "Zone Manager", field: "zone", user_field: "zone" },
    ]);
  });

  it("reports nothing when enforcement is on", () => {
    const reg = new EntityRegistry();
    reg.register(scopedEntity());
    expect(reg.auditUnenforcedScopes(true)).toEqual([]);
  });

  it("reports nothing when no entity declares a scope", () => {
    const reg = new EntityRegistry();
    reg.register(entity({ name: "PlainDoc" }));
    expect(reg.auditUnenforcedScopes(false)).toEqual([]);
  });
});
