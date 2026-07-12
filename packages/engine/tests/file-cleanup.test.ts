import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1,
    MONGODB_MAX_POOL: 5,
    MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users",
    MONGODB_LOGS_DB: "test_logs",
    MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin",
    MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { deleteFileRefCounted, parseFileId, collectAttachFileIds } from "../src/core/storage/file-cleanup.js";
import type { FieldDefinition } from "@digitaplatform/shared";

// Mock db.count keyed by "<field>:<key>" → ref count; storage.delete records keys.
function harness(fileDoc: Record<string, unknown>, counts: Record<string, number> = {}) {
  const deleted: string[] = [];
  const db = {
    findOne: vi.fn(async () => fileDoc),
    count: vi.fn(async (_coll: string, filter: Array<[string, string, string]>) => {
      const [field, , key] = filter[0]!;
      return counts[`${field}:${key}`] ?? 0;
    }),
    deleteOne: vi.fn(async () => {}),
  };
  const storage = {
    delete: vi.fn(async (key: string) => {
      deleted.push(key);
    }),
  };
  return { db, storage, deleted };
}

describe("deleteFileRefCounted — thumbnail cleanup (audit 362)", () => {
  it("removes the thumbnail blob when this is the last File owning it", async () => {
    const doc = { _id: "FILE-1", storage_key: "p/main", thumbnail_key: "p/thumb" };
    const { db, storage, deleted } = harness(doc, {
      "storage_key:p/main": 1,
      "thumbnail_key:p/thumb": 1,
    });
    await deleteFileRefCounted(db as never, storage as never, "FILE-1");
    expect(deleted).toContain("p/main");
    expect(deleted).toContain("p/thumb"); // previously leaked
    expect(db.deleteOne).toHaveBeenCalledOnce();
  });

  it("keeps a thumbnail blob still shared by another File doc", async () => {
    const doc = { _id: "FILE-1", storage_key: "p/main", thumbnail_key: "p/thumb" };
    const { db, storage, deleted } = harness(doc, {
      "storage_key:p/main": 1,
      "thumbnail_key:p/thumb": 2, // dedup'd — another File still points at it
    });
    await deleteFileRefCounted(db as never, storage as never, "FILE-1");
    expect(deleted).toContain("p/main");
    expect(deleted).not.toContain("p/thumb");
  });

  it("no-ops the thumbnail step for a File without a thumbnail", async () => {
    const doc = { _id: "FILE-1", storage_key: "p/main" };
    const { db, storage, deleted } = harness(doc, { "storage_key:p/main": 1 });
    await deleteFileRefCounted(db as never, storage as never, "FILE-1");
    expect(deleted).toEqual(["p/main"]);
  });
});

describe("parseFileId — private and public file URLs", () => {
  it("parses a private download URL", () => {
    expect(parseFileId("/api/v1/file/FILE-000001/download")).toBe("FILE-000001");
  });

  it("parses a public file URL (no /download suffix)", () => {
    expect(parseFileId("/api/v1/public/file/FILE-000002")).toBe("FILE-000002");
  });

  it("returns null for non-string / unrelated values", () => {
    expect(parseFileId(null)).toBeNull();
    expect(parseFileId(42)).toBeNull();
    expect(parseFileId("https://example.com/not-a-file")).toBeNull();
  });

  it("collectAttachFileIds sees a public attachment URL (leak closed end-to-end)", () => {
    const fields = [{ fieldname: "logo", fieldtype: "AttachImage", label: "Logo" }] as unknown as FieldDefinition[];
    expect(collectAttachFileIds(fields, { logo: "/api/v1/public/file/FILE-000003" })).toEqual([
      "FILE-000003",
    ]);
  });

  it("collectAttachFileIds recurses into Table child_fields (child-row leak closed)", () => {
    const fields = [
      { fieldname: "logo", fieldtype: "AttachImage" },
      {
        fieldname: "lines",
        fieldtype: "Table",
        child_fields: [
          { fieldname: "doc", fieldtype: "Attach" },
          { fieldname: "qty", fieldtype: "Int" },
        ],
      },
    ] as unknown as FieldDefinition[];
    const data = {
      logo: "/api/v1/public/file/FILE-1",
      lines: [
        { doc: "/api/v1/file/FILE-2/download", qty: 1 },
        { doc: "/api/v1/file/FILE-3/download", qty: 2 },
        { qty: 3 }, // no attach → safely skipped
      ],
    };
    expect(collectAttachFileIds(fields, data).sort()).toEqual(["FILE-1", "FILE-2", "FILE-3"]);
  });

  it("collectAttachFileIds tolerates a Table with missing / non-array rows", () => {
    const fields = [
      { fieldname: "lines", fieldtype: "Table", child_fields: [{ fieldname: "doc", fieldtype: "Attach" }] },
    ] as unknown as FieldDefinition[];
    expect(collectAttachFileIds(fields, {})).toEqual([]);
    expect(collectAttachFileIds(fields, { lines: "nope" })).toEqual([]);
  });
});
