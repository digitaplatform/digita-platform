import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { DocumentShareService } from "../src/core/permissions/document-share-service.js";

/**
 * A share's "Notify User" never sent anything: the engine has no notice channel. The entity offers
 * no such field, and the share service only reads shares; the resource route, with the docshare
 * hook's access check, is the one way to write one.
 */
describe("a document share", () => {
  it("offers no notify field", () => {
    const share = JSON.parse(readFileSync(new URL("../src/entities/DocShare.entity.json", import.meta.url), "utf8")) as {
      fields: Array<{ fieldname: string }>;
    };
    expect(share.fields.map((f) => f.fieldname)).not.toContain("notify");
  });

  it("is never written by the share service, which skips the docshare hook", () => {
    const methods = Object.getOwnPropertyNames(DocumentShareService.prototype);
    expect(methods.filter((m) => m === "share" || m === "unshare")).toEqual([]);
  });
});
