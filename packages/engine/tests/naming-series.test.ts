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
import { NamingService } from "../src/core/document/naming-service.js";

interface MockDb {
  getNextSequence: ReturnType<typeof vi.fn>;
  existsByField: ReturnType<typeof vi.fn>;
  callsByKey: Map<string, number>;
}

function makeDb(): MockDb {
  const callsByKey = new Map<string, number>();
  const getNextSequence = vi.fn(async (seqName: string) => {
    const next = (callsByKey.get(seqName) ?? 0) + 1;
    callsByKey.set(seqName, next);
    return next;
  });
  // No pre-existing documents in these unit tests — the naming self-heal
  // loop (see naming-service.ts resolveUniqueSequence) always finds the
  // first candidate free, exercising the common (no-collision) path.
  const existsByField = vi.fn(async () => false);
  return { getNextSequence, existsByField, callsByKey };
}

describe("NamingService — generic series-bound counters", () => {
  it("partitions counter by an arbitrary field on the doc", async () => {
    const db = makeDb();
    const naming = new NamingService(db as never);
    const e: EntityDefinition = {
      name: "branchInvoice",
      module: "test",
      database: "app",
      naming: { strategy: "expression", expression: "BR-{#####:branch}" },
      fields: [],
      permissions: [],
    } as unknown as EntityDefinition;
    expect(await naming.generateId(e, { branch: "DE" })).toBe("BR-DE-00001");
    expect(await naming.generateId(e, { branch: "DE" })).toBe("BR-DE-00002");
    expect(await naming.generateId(e, { branch: "AT" })).toBe("BR-AT-00001");
    // Distinct sequence names per partition value:
    expect(db.callsByKey.get("branchInvoice:DE")).toBe(2);
    expect(db.callsByKey.get("branchInvoice:AT")).toBe(1);
  });

  it("works with a year-label field — apps populate the field; platform stays neutral", async () => {
    // Demonstrates the recommended pattern: the app projects a year label
    // onto the doc (via fetch_from / hook / explicit input) and the
    // platform's expression token references it as a regular field. No
    // hard-coded `fiscal_year` keyword in the platform.
    const db = makeDb();
    const naming = new NamingService(db as never);
    const e: EntityDefinition = {
      name: "salesInvoice",
      module: "test",
      database: "app",
      naming: { strategy: "expression", expression: "INV-{#####:fiscal_year_label}" },
      fields: [],
      permissions: [],
    } as unknown as EntityDefinition;
    expect(
      await naming.generateId(e, { fiscal_year_label: "2026" }),
    ).toBe("INV-2026-00001");
    expect(
      await naming.generateId(e, { fiscal_year_label: "2026" }),
    ).toBe("INV-2026-00002");
    expect(
      await naming.generateId(e, { fiscal_year_label: "2027" }),
    ).toBe("INV-2027-00001");
  });

  it("bare {####} stays a global per-entity counter (backwards compatible)", async () => {
    const db = makeDb();
    const naming = new NamingService(db as never);
    const e: EntityDefinition = {
      name: "X",
      module: "test",
      database: "app",
      naming: { strategy: "expression", expression: "X-{#####}" },
      fields: [],
      permissions: [],
    } as unknown as EntityDefinition;
    expect(await naming.generateId(e, {})).toBe("X-00001");
    expect(await naming.generateId(e, {})).toBe("X-00002");
  });

  it("throws when the series-token field is empty/missing", async () => {
    const db = makeDb();
    const naming = new NamingService(db as never);
    const e: EntityDefinition = {
      name: "X",
      module: "test",
      database: "app",
      naming: { strategy: "expression", expression: "X-{#####:branch}" },
      fields: [],
      permissions: [],
    } as unknown as EntityDefinition;
    await expect(naming.generateId(e, {})).rejects.toThrow(/branch/);
  });
});

describe("NamingService — H23 field-token injection", () => {
  it("strips naming metacharacters from interpolated field values", async () => {
    const db = makeDb();
    const naming = new NamingService(db as never);
    const e: EntityDefinition = {
      name: "Doc",
      module: "test",
      database: "app",
      naming: { strategy: "expression", expression: "{code}-{#####}" },
      fields: [],
      permissions: [],
    } as unknown as EntityDefinition;
    // A user field value carrying a sequence token must not inject it: the `{`,
    // `}`, `#`, `:` are stripped, so the injected `{###}` vanishes and the REAL
    // `{#####}` still resolves to the counter (once).
    const id = await naming.generateId(e, { code: "{###}" });
    expect(id).toBe("-00001");
    expect(db.callsByKey.get("Doc")).toBe(1);
  });

  it("keeps a normal field value but drops stray metacharacters", async () => {
    const db = makeDb();
    const naming = new NamingService(db as never);
    const e: EntityDefinition = {
      name: "Doc2",
      module: "test",
      database: "app",
      naming: { strategy: "expression", expression: "{code}-{###}" },
      fields: [],
      permissions: [],
    } as unknown as EntityDefinition;
    expect(await naming.generateId(e, { code: "AB#12" })).toBe("AB12-001");
  });

  it("does not interpret `$`-substitution patterns in a series value", async () => {
    // A series value containing a String.replace substitution pattern (e.g. `$&`)
    // must be inserted VERBATIM into the permanent key, not re-expand the matched
    // `{#####:branch}` token back into the business key.
    const db = makeDb();
    const naming = new NamingService(db as never);
    const e: EntityDefinition = {
      name: "branchInvoice",
      module: "test",
      database: "app",
      naming: { strategy: "expression", expression: "BR-{#####:branch}" },
      fields: [],
      permissions: [],
    } as unknown as EntityDefinition;
    expect(await naming.generateId(e, { branch: "$&" })).toBe("BR-$&-00001");
  });
});
