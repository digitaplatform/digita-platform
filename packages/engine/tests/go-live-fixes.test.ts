import { describe, it, expect, vi } from "vitest";

// base-document pulls the logger in transitively; stub it (+ env) so this pure
// unit test never demands MONGODB_URI.
vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "a", MONGODB_CORE_DB: "c", MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { injectRowIds } from "../src/core/document/base-document.js";

describe("injectRowIds (seed _row_id fix)", () => {
  it("injects _row_id on plain-object rows that lack one, preserves existing ids", () => {
    const data: Record<string, unknown> = {
      scalar: 5,
      addresses: [{ city: "A" }, { city: "B", _row_id: "keep-me" }],
    };
    const mutated = injectRowIds(data);
    const rows = data.addresses as Array<Record<string, unknown>>;
    expect(typeof rows[0]!._row_id).toBe("string");
    expect((rows[0]!._row_id as string).length).toBeGreaterThan(0);
    expect(rows[1]!._row_id).toBe("keep-me");
    expect(mutated).toEqual(["addresses"]); // only the mutated key reported
  });

  it("is a no-op for non-array values and fully-populated arrays", () => {
    const data: Record<string, unknown> = { name: "x", rows: [{ _row_id: "a" }] };
    expect(injectRowIds(data)).toEqual([]);
  });

  it("is idempotent", () => {
    const data: Record<string, unknown> = { rows: [{ a: 1 }] };
    injectRowIds(data);
    const id = (data.rows as Array<Record<string, unknown>>)[0]!._row_id;
    expect(injectRowIds(data)).toEqual([]); // nothing new to mint
    expect((data.rows as Array<Record<string, unknown>>)[0]!._row_id).toBe(id);
  });
});
