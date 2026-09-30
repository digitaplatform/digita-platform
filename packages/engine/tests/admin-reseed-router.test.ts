import { describe, it, expect, vi, beforeEach } from "vitest";

// The reseed route's two guards: Administrator only, and only on an app engine of a demo tenant,
// in production and outside it. A body without a mode is refused after both guards, so a 400
// INVALID_MODE proves a request passed them without running a reseed.
vi.mock("../src/core/config/env.js", () => ({ env: { NODE_ENV: "production", DEMO_TENANT: false, SITE_ID: "" } }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));
const { reseedAppData } = vi.hoisted(() => ({ reseedAppData: vi.fn() }));
vi.mock("../src/core/setup/reseed-app-data.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/setup/reseed-app-data.js")>()),
  reseedAppData,
}));

import type { FastifyInstance } from "fastify";
import { env } from "../src/core/config/env.js";
import { registerAdminReseedRoutes } from "../src/core/api/admin-reseed-router.js";
import type { ReseedDeps } from "../src/core/setup/reseed-app-data.js";

type Handler = (request: unknown, reply: unknown) => Promise<unknown>;

let reseed: Handler;
registerAdminReseedRoutes(
  { post: (_path: string, handler: Handler) => (reseed = handler) } as unknown as FastifyInstance,
  "/api/v1",
  {} as ReseedDeps,
);

interface Engine {
  demoTenant: boolean;
  siteId?: string;
  nodeEnv?: string;
}

async function call(engine: Engine, roles: string[], body: Record<string, unknown> = {}) {
  Object.assign(env, { NODE_ENV: engine.nodeEnv ?? "production", DEMO_TENANT: engine.demoTenant, SITE_ID: engine.siteId ?? "" });
  let status = 200;
  let sent: unknown;
  const reply = {
    code: (code: number) => ((status = code), reply),
    send: (payload: unknown) => ((sent = payload), reply),
  };
  await reseed({ user: { email: "a@test", roles }, body }, reply);
  return { status, body: sent };
}

const disabled = { status: 403, body: { error: { code: "RESEED_DISABLED" } } };
const passed = { status: 400, body: { error: { code: "INVALID_MODE" } } };

beforeEach(() => reseedAppData.mockReset());

describe("POST /admin/reseed", () => {
  it("refuses a caller who is no Administrator, on an app engine of a demo tenant too", async () => {
    expect(await call({ demoTenant: true }, ["System User"], { mode: "demo" })).toMatchObject({
      status: 403,
      body: { error: { code: "FORBIDDEN" } },
    });
    expect(reseedAppData).not.toHaveBeenCalled();
  });

  it("refuses on a tenant that is no demo, in production and outside it, naming the rule", async () => {
    expect(await call({ demoTenant: false }, ["Administrator"], { mode: "demo" })).toMatchObject({
      status: 403,
      body: {
        error: {
          code: "RESEED_DISABLED",
          detail: "the reseed runs only on an app engine of a demo tenant: DEMO_TENANT on and SITE_ID empty",
        },
      },
    });
    expect(await call({ demoTenant: false, nodeEnv: "development" }, ["Administrator"])).toMatchObject(disabled);
    expect(reseedAppData).not.toHaveBeenCalled();
  });

  it("refuses on a website engine of a demo tenant, whose site a reseed would empty", async () => {
    expect(await call({ demoTenant: true, siteId: "show" }, ["Administrator"])).toMatchObject(disabled);
    expect(await call({ demoTenant: true, siteId: "show", nodeEnv: "development" }, ["Administrator"])).toMatchObject(disabled);
  });

  it("passes on an app engine of a demo tenant, in production and outside it", async () => {
    expect(await call({ demoTenant: true }, ["Administrator"])).toMatchObject(passed);
    expect(await call({ demoTenant: true, nodeEnv: "development" }, ["Administrator"])).toMatchObject(passed);
  });

  it("runs the reseed in the mode asked for once both guards pass", async () => {
    reseedAppData.mockResolvedValue({ mode: "template" });
    expect(await call({ demoTenant: true }, ["Administrator"], { mode: "template" })).toMatchObject({
      status: 200,
      body: { success: true, data: { mode: "template" } },
    });
    expect(reseedAppData).toHaveBeenCalledWith("template", {});
  });
});
