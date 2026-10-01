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

/**
 * An action's author says what it does in `confirm_message`, and the app asks it in the
 * action's confirm dialog. The registry loads the key with the action, so the record page
 * receives it with the action.
 */
describe("the confirm message of an action", () => {
  it("is loaded with the action", async () => {
    const dir = await mkdtemp(join(tmpdir(), "action-confirm-"));
    try {
      await writeFile(
        join(dir, "work-order.entity.json"),
        JSON.stringify({
          name: "WorkOrder",
          module: "test",
          database: "app",
          naming: { strategy: "user_set" },
          fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
          permissions: [],
          actions: [
            {
              label: "Book parts",
              action: "bookParts",
              confirm: true,
              confirm_message: "Takes the parts of this work order out of stock.",
            },
            { label: "Print", action: "printOrder" },
          ],
        }),
      );
      const registry = new EntityRegistry();
      await registry.loadAll(dir);
      const [bookParts, print] = registry.get("WorkOrder").actions!;
      expect(bookParts!.confirm_message).toBe("Takes the parts of this work order out of stock.");
      expect(print).not.toHaveProperty("confirm_message");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
