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
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import { TimeSeriesImmutableError } from "../src/core/document/document-service.js";
import { DocumentService } from "../src/core/document/document-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";

function tsEntity(): EntityDefinition {
  return {
    name: "stockMovement",
    module: "test",
    database: "app",
    naming: { strategy: "auto_increment" },
    track_changes: false,
    is_submittable: false,
    time_series: { time_field: "posted_at", meta_field: "product" },
    fields: [
      { fieldname: "posted_at", fieldtype: "Datetime", label: "Posted At" },
      { fieldname: "product", fieldtype: "Data", label: "Product" },
      { fieldname: "quantity", fieldtype: "Float", label: "Quantity" },
    ],
    permissions: [
      { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1 },
    ],
  } as unknown as EntityDefinition;
}

describe("DocumentService.update — time-series immutability", () => {
  it("rejects a patch that touches non-meta fields", async () => {
    const registry = new EntityRegistry();
    registry.register(tsEntity());

    const db = {
      findOne: vi.fn().mockResolvedValue({
        _id: "SM-1",
        posted_at: new Date(),
        product: "P-1",
        quantity: 5,
        docstatus: 0,
      }),
      withTransaction: vi.fn(),
    } as never;

    const docService = new DocumentService({
      registry,
      db,
      permissionChecker: new PermissionChecker(registry),
      hookRunner: { run: vi.fn(), runComputedHooks: vi.fn(), runFieldChangeHooks: vi.fn() } as never,
      linkValidator: { validate: vi.fn().mockResolvedValue([]) } as never,
      linkTitleResolver: { resolve: vi.fn(), resolveForList: vi.fn() } as never,
      fetchFromResolver: { resolve: vi.fn().mockResolvedValue({}) } as never,
      deleteProtection: { check: vi.fn() } as never,
      cancelProtection: { check: vi.fn() } as never,
      versionService: { createVersion: vi.fn() } as never,
      viewLogService: { logView: vi.fn() } as never,
      activityLogService: { log: vi.fn() } as never,
      translationService: {} as never,
    });

    const admin = { _id: "a", email: "admin", roles: [SYSTEM_ROLES.ADMINISTRATOR] };
    await expect(
      docService.update("stockMovement", "SM-1", { quantity: 99 }, admin as never),
    ).rejects.toBeInstanceOf(TimeSeriesImmutableError);
  });
});
