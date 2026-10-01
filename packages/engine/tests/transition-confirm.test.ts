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
 * A transition with `confirm: true` makes the record page ask before it moves the state.
 * The registry loads the key with the transition, and the meta route hands the app the
 * transitions as loaded.
 */
describe("the confirm of a transition", () => {
  it("is loaded with the transition", async () => {
    const dir = await mkdtemp(join(tmpdir(), "transition-confirm-"));
    try {
      await writeFile(
        join(dir, "work-order.entity.json"),
        JSON.stringify({
          name: "WorkOrder",
          module: "test",
          database: "app",
          naming: { strategy: "user_set" },
          fields: [{ fieldname: "status", fieldtype: "Select", label: "Status", options: ["in_progress", "ready"] }],
          permissions: [],
          states: [{ name: "in_progress", is_initial: true }, { name: "ready" }],
          transitions: [
            { from: "in_progress", to: "ready", allowed_roles: [], confirm: true },
            { from: "ready", to: "in_progress", allowed_roles: [] },
          ],
        }),
      );
      const registry = new EntityRegistry();
      await registry.loadAll(dir);
      const [toReady, back] = registry.get("WorkOrder").transitions!;
      expect(toReady!.confirm).toBe(true);
      expect(back).not.toHaveProperty("confirm");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
