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

import { FILE_FIELD_TYPES } from "@digitaplatform/shared";
import { softDeleteFile, deleteBlobIfUnreferenced, parseFileId, collectAttachFileIds } from "../src/core/storage/file-cleanup.js";
import { DeleteProtection } from "../src/core/link/delete-protection.js";
import type { EntityDefinition, FieldDefinition } from "@digitaplatform/shared";
import type { StoragePort } from "../src/core/storage/storage-port.js";

describe("File records retained until purge", () => {
  it("PLANTED DEFECT: marks the File in place in a transaction and touches the attachment guard", async () => {
    const file = { _id: "FILE-1", storage_key: "p/main", thumbnail_key: "p/thumb" };
    const mockSession = { id: "mock-session" };
    const db = {
      withTransaction: vi.fn(async (cb: (session: unknown) => Promise<unknown>) => cb(mockSession)),
      touchGuard: vi.fn(async () => {}),
      findOne: vi.fn(async () => file),
      updateOne: vi.fn(async (_name, _id, changes) => { Object.assign(file, changes); return true; }),
      deleteOne: vi.fn(),
    };
    await softDeleteFile(db as never, "FILE-1", { email: "operator" }, []);
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    expect(db.touchGuard).toHaveBeenCalledWith("attachment:FILE-1", mockSession);
    expect(db.findOne).toHaveBeenCalledWith("File", "FILE-1", "core", mockSession);
    expect(file).toMatchObject({ storage_key: "p/main", thumbnail_key: "p/thumb", deleted: expect.any(Date), deleted_by: "operator" });
    expect(db.deleteOne).not.toHaveBeenCalled();
  });

  it.each([true, false])("PLANTED DEFECT / INNOCENT: a retained row holds its attachment %s", async (held) => {
    const mockSession = { id: "mock-session-2" };
    const db = {
      withTransaction: vi.fn(async (cb: (session: unknown) => Promise<unknown>) => cb(mockSession)),
      touchGuard: vi.fn(async () => {}),
      findOne: vi.fn(async () => ({ _id: "FILE-1", storage_key: "p/main" })),
      count: vi.fn(async () => held ? 1 : 0),
      updateOne: vi.fn(async () => true),
    };
    const entity = { name: "Book", database: "app", fields: [{ fieldname: "lines", fieldtype: "Table", child_fields: [{ fieldname: "attachment", fieldtype: "Attach" }] }] } as unknown as EntityDefinition;
    await softDeleteFile(db as never, "FILE-1", { email: "operator" }, [entity]);
    expect(db.updateOne.mock.calls).toHaveLength(held ? 0 : 1);
    expect(db.count).toHaveBeenCalledWith("Book", [{ $or: [{ "lines.attachment": { $regex: expect.stringContaining("FILE-1") } }] }], "app", mockSession, { includeDeleted: true });
  });

  it("PLANTED DEFECT: ordinary File deletion uses the same guard in the caller's transaction", async () => {
    const entity = { name: "Book", database: "app", fields: [{ fieldname: "attachment", fieldtype: "Attach" }] } as unknown as EntityDefinition;
    const db = { count: vi.fn(async () => 1) };
    const registry = { getIncomingLinks: () => [], getAll: () => [entity] };
    const session = { transaction: "same caller" };
    const blockers = await new DeleteProtection(registry as never, db as never).check("File", "FILE-1", session as never);
    expect(blockers).toEqual([{ entity: "Book", fieldname: "attachment", count: 1 }]);
    expect(db.count).toHaveBeenCalledWith("Book", [{ $or: [{ attachment: { $regex: expect.stringContaining("FILE-1") } }] }], "app", session, { includeDeleted: true });
  });
});

describe("deleteBlobIfUnreferenced", () => {
  it("deletes blob and width variants when reference count is zero within a transaction", async () => {
    const mockSession = { id: "blob-session" };
    const db = {
      withTransaction: vi.fn(async (cb: (session: unknown) => Promise<unknown>) => cb(mockSession)),
      touchGuard: vi.fn(async () => {}),
      count: vi.fn(async () => 0),
    };
    const storage: StoragePort = {
      backend: "local",
      delete: vi.fn(async () => {}),
      exists: vi.fn(async () => true),
      put: vi.fn(async () => {}),
      getStream: vi.fn(async () => ({} as never)),
    };
    await deleteBlobIfUnreferenced(db as never, storage, "image-key.png", "storage_key", "image/png");
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    expect(db.touchGuard).toHaveBeenCalledWith("blob:image-key.png", mockSession);
    expect(db.count).toHaveBeenCalledWith(
      "File",
      [{ $or: [{ storage_key: "image-key.png" }, { thumbnail_key: "image-key.png" }, { file_url: "/uploads/image-key.png" }] }],
      "core",
      mockSession,
      { includeDeleted: true },
    );
    expect(storage.delete).toHaveBeenCalledWith("image-key.png");
  });

  it("skips storage deletion when references remain in the database", async () => {
    const mockSession = { id: "blob-session-refs" };
    const db = {
      withTransaction: vi.fn(async (cb: (session: unknown) => Promise<unknown>) => cb(mockSession)),
      touchGuard: vi.fn(async () => {}),
      count: vi.fn(async () => 1),
    };
    const storage: StoragePort = {
      backend: "local",
      delete: vi.fn(async () => {}),
      exists: vi.fn(async () => true),
      put: vi.fn(async () => {}),
      getStream: vi.fn(async () => ({} as never)),
    };
    await deleteBlobIfUnreferenced(db as never, storage, "busy-key.pdf", "storage_key");
    expect(db.touchGuard).toHaveBeenCalledWith("blob:busy-key.pdf", mockSession);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("handles storage deletion failure without throwing (best effort)", async () => {
    const db = {
      withTransaction: vi.fn(async () => { throw new Error("Storage I/O exploded"); }),
    };
    const storage: StoragePort = {
      backend: "local",
      delete: vi.fn(),
      exists: vi.fn(),
      put: vi.fn(),
      getStream: vi.fn(),
    };
    await expect(deleteBlobIfUnreferenced(db as never, storage, "err-key.png")).resolves.toBeUndefined();
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

describe("the file field types the engine scans", () => {
  it("PLANTED DEFECT: finds the file of every type the shared set names, Image too", () => {
    expect(FILE_FIELD_TYPES).toContain("Image");
    for (const fieldtype of FILE_FIELD_TYPES) {
      const fields = [{ fieldname: "file", fieldtype }] as unknown as FieldDefinition[];
      expect(collectAttachFileIds(fields, { file: "/api/v1/file/FILE-000001/download" }), fieldtype).toEqual(["FILE-000001"]);
    }
  });

  it("PLANTED INNOCENT: finds no file in a field of another type that holds a file URL", () => {
    const fields = [{ fieldname: "note", fieldtype: "Data" }] as unknown as FieldDefinition[];
    expect(collectAttachFileIds(fields, { note: "/api/v1/file/FILE-000001/download" })).toEqual([]);
  });
});
