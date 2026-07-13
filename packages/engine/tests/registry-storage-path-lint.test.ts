import { describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";

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

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { isValidStoragePath } from "../src/core/storage/storage-path.js";

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

describe("isValidStoragePath", () => {
  it("accepts plain lowercase folders", () => {
    expect(isValidStoragePath("customers")).toBe(true);
    expect(isValidStoragePath("product-images")).toBe(true);
    expect(isValidStoragePath("a_1")).toBe(true);
  });

  it("accepts exactly one nesting level", () => {
    expect(isValidStoragePath("erp/customers")).toBe(true);
  });

  it("rejects everything outside the rule", () => {
    expect(isValidStoragePath("")).toBe(false);
    expect(isValidStoragePath("Customers")).toBe(false); // uppercase
    expect(isValidStoragePath("/customers")).toBe(false); // leading slash
    expect(isValidStoragePath("customers/")).toBe(false); // trailing slash
    expect(isValidStoragePath("a/b/c")).toBe(false); // double nesting
    expect(isValidStoragePath("../escape")).toBe(false); // traversal
    expect(isValidStoragePath("a/..")).toBe(false);
    expect(isValidStoragePath("a b")).toBe(false); // whitespace
    expect(isValidStoragePath("a\\b")).toBe(false); // backslash
  });
});

describe("EntityRegistry.auditAttachStoragePaths (boot lint)", () => {
  it("reports an entity with a top-level Attach field but no storage_path", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "Supplier",
        fields: [{ fieldname: "logo", fieldtype: "AttachImage", label: "Logo" }],
      } as EntityDefinition),
    );
    const offenders = reg.auditAttachStoragePaths();
    expect(offenders).toHaveLength(1);
    expect(offenders[0]!.entity).toBe("Supplier");
    expect(offenders[0]!.problem).toContain("logo");
    expect(offenders[0]!.problem).toContain("no storage_path");
  });

  it("reports an Attach field hidden inside Table child_fields", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "Product",
        fields: [
          {
            fieldname: "images",
            fieldtype: "Table",
            label: "Images",
            child_fields: [{ fieldname: "image", fieldtype: "AttachImage", label: "Image" }],
          },
        ],
      } as EntityDefinition),
    );
    const offenders = reg.auditAttachStoragePaths();
    expect(offenders).toHaveLength(1);
    expect(offenders[0]!.problem).toContain("images.image");
  });

  it("passes when the entity declares a valid storage_path", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "Customer",
        storage_path: "customers",
        fields: [{ fieldname: "profile_image", fieldtype: "AttachImage", label: "Profile image" }],
      } as EntityDefinition),
    );
    expect(reg.auditAttachStoragePaths()).toEqual([]);
  });

  it("reports an INVALID storage_path even when Attach fields are present", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "Customer",
        storage_path: "Customers/", // uppercase + trailing slash
        fields: [{ fieldname: "profile_image", fieldtype: "AttachImage", label: "Profile image" }],
      } as EntityDefinition),
    );
    const offenders = reg.auditAttachStoragePaths();
    expect(offenders).toHaveLength(1);
    expect(offenders[0]!.problem).toContain("invalid");
  });

  it("reports an invalid storage_path on an entity WITHOUT Attach fields (declaration typo)", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "Misconfigured",
        storage_path: "a/b/c",
        fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
      } as EntityDefinition),
    );
    expect(reg.auditAttachStoragePaths()).toHaveLength(1);
  });

  it("exempts metadata-only entities (File-style: Data fields, no Attach fieldtypes)", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "File",
        fields: [
          { fieldname: "file_name", fieldtype: "Data", label: "File Name" },
          { fieldname: "attached_to_entity", fieldtype: "Data", label: "Attached To Entity" },
          { fieldname: "storage_key", fieldtype: "Data", label: "Storage Key" },
        ],
      } as EntityDefinition),
    );
    expect(reg.auditAttachStoragePaths()).toEqual([]);
  });

  it("lists EVERY offender, not just the first", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "A",
        fields: [{ fieldname: "doc", fieldtype: "Attach", label: "Doc" }],
      } as EntityDefinition),
    );
    reg.register(
      entity({
        name: "B",
        fields: [{ fieldname: "img", fieldtype: "AttachImage", label: "Img" }],
      } as EntityDefinition),
    );
    const offenders = reg.auditAttachStoragePaths();
    expect(offenders.map((o) => o.entity).sort()).toEqual(["A", "B"]);
  });

  // NOTE: the former "carries storage_path forward in loadFromDb" per-field
  // workaround was removed. A DB row that predates a file field (or prop) is now
  // healed GENERICALLY by the file-authoritative re-seed — seedEntityDefinitions
  // overwrites every DB definition from its file on each boot (no runtime schema
  // editing exists to protect). See tests/seed-entity-definitions.integration.test.ts.

  it("keeps the DB storage_path when it differs from the file, and reports it as drift", async () => {
    const dir = await mkdtemp(join(tmpdir(), "digita-registry-"));
    try {
      const fileDef = {
        name: "DriftCustomer",
        module: "test",
        database: "core",
        naming: { strategy: "user_set" },
        storage_path: "customers",
        fields: [{ fieldname: "img", fieldtype: "AttachImage", label: "Img" }],
        permissions: [],
      };
      await writeFile(join(dir, "driftCustomer.entity.json"), JSON.stringify(fileDef));
      const reg = new EntityRegistry();
      await reg.loadAll(dir);

      const dbRow = JSON.parse(JSON.stringify(fileDef)) as Record<string, unknown>;
      dbRow["storage_path"] = "legacy_folder";
      await reg.loadFromDb({ find: async () => [dbRow] } as unknown as MongoDBService);

      expect(reg.get("DriftCustomer").storage_path).toBe("legacy_folder"); // DB wins
      const drift = reg.getDriftSnapshots();
      expect(drift).toHaveLength(1);
      expect(drift[0]!.entity).toBe("DriftCustomer");
      expect(drift[0]!.drift.join("; ")).toContain("storage_path differs");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("the real loaded entity tree is clean: every Attach entity declares storage_path", async () => {
    // Regression net for the engine's own definitions. The erp app now lives in
    // the separate digita-apps repo — include it when checked out as a sibling
    // (local / integration), skip it in engine-only CI (the erp tree is audited
    // by digita-apps' own CI). The engine-entity audit always runs.
    const reg = new EntityRegistry();
    await reg.loadAll("./src/entities");
    const erp = "../../../digita-apps/erp";
    if (existsSync(erp)) await reg.loadAll(erp);
    expect(reg.auditAttachStoragePaths()).toEqual([]);
  });
});
