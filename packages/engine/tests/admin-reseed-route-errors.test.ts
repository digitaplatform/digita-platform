// A refused or failed reset reaches the caller with its reason, through the route and the engine's
// error handler: digita-jobs writes `error.detail` into the run record of the demo reset.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => ({ env: { NODE_ENV: "production", DEMO_TENANT: true, SITE_ID: "" } }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));
const { seedAppData } = vi.hoisted(() => ({ seedAppData: vi.fn() }));
vi.mock("../src/core/setup/seed-app-data.js", () => ({ seedAppData }));
vi.mock("../src/core/setup/seed-data-translations.js", () => ({ seedDataTranslations: vi.fn().mockResolvedValue(undefined) }));

import Fastify from "fastify";
import { registerAdminReseedRoutes } from "../src/core/api/admin-reseed-router.js";
import { globalErrorHandler } from "../src/core/api/middleware/error-handler.js";
import { reseedAppData, type ReseedDeps } from "../src/core/setup/reseed-app-data.js";

const deps = {
  db: { listAppDatabases: () => [{ name: "app_x" }], deleteMany: vi.fn().mockResolvedValue(1), updateOne: vi.fn() },
  registry: { getAll: () => [{ name: "Thing", database: "app_x" }] },
  translationService: {},
  appDirs: ["/app"],
  getDomainDirs: () => [],
} as unknown as ReseedDeps;

const app = Fastify();
app.addHook("preHandler", async (request) => {
  (request as { user: unknown }).user = { email: "a@test", roles: ["Administrator"] };
});
app.setErrorHandler(globalErrorHandler);
registerAdminReseedRoutes(app, "/api/v1", deps);
afterAll(() => app.close());

const post = (mode: string) => app.inject({ method: "POST", url: "/api/v1/admin/reseed", payload: { mode } });

beforeEach(() => {
  seedAppData.mockReset().mockResolvedValue(undefined);
});

describe("POST /admin/reseed answers a refused or failed reset with its reason", () => {
  it("answers 409 RESEED_RUNNING, naming both modes, while a reset in the other mode runs", async () => {
    let finish!: () => void;
    seedAppData.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const demo = reseedAppData("demo", deps);
    await vi.waitFor(() => expect(seedAppData).toHaveBeenCalled());

    const res = await post("template");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: {
        code: "RESEED_RUNNING",
        detail: "a reseed in mode demo is running; start the reseed in mode template once it has ended",
      },
      messages: [{ text: "reseed_running", params: { running: "demo", requested: "template" } }],
    });
    finish();
    await demo;
  });

  it("answers 500 RESEED_FAILED with the seed's error when the seed fails twice after the wipe", async () => {
    seedAppData.mockRejectedValue(new Error("E11000 duplicate key"));
    const res = await post("demo");
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      error: {
        code: "RESEED_FAILED",
        detail:
          "the seed failed 2 times after the app data was wiped; the app holds only the rows seeded before the failure: E11000 duplicate key",
      },
      messages: [{ text: "reseed_seed_failed", params: { attempts: "2", error: "E11000 duplicate key" } }],
    });
  });

  it("PLANTED INNOCENT: answers the summary of a reset that ran", async () => {
    const res = await post("demo");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { mode: "demo", rows_deleted: 1 } });
  });
});
