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

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";

// A broken expression falls back at run time to its safe default without a word: a required
// field on every save, a locked field, a refused move. The entity file is refused instead.
describe("an entity file whose expression does not parse", () => {
  it("is refused, naming the file, the place and the parser's message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reg-expression-"));
    const file = join(dir, "Book.entity.json");
    await writeFile(file, JSON.stringify({
      name: "Book", module: "test", database: "app", naming: { strategy: "user_set" },
      fields: [
        { fieldname: "kind", fieldtype: "Data", label: "Kind" },
        { fieldname: "reason", fieldtype: "Data", label: "Reason", mandatory_depends_on: "eval:doc.kind ==" },
      ],
      permissions: [],
    }));
    const error = await new EntityRegistry().loadAll(dir).then(() => undefined, (e: unknown) => e as Error);
    await rm(dir, { recursive: true, force: true });
    expect(error?.message).toContain(file);
    expect(error?.message).toContain("reason.mandatory_depends_on does not parse (unexpected end of expression");
  });
});
